/**
 * S13 — the browser editing backend, driven by structural fakes of the File System Access API
 * (the same way the browser worker backend is tested): conditional writes against the revision the
 * PWA pins its sources with, a swap-file write that only lands on close, pre-image rollback, and
 * honest refusals for what a file handle cannot do.
 */
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import type { AssetRevision, PayloadStore, SubjectEditTarget } from '@modkitx-x3/sdk'
import {
  createBrowserEditingBackend,
  type BrowserWritableFile,
  type BrowserWritableFileHandle,
} from '@modkitx-x3/host/browser'

const payloads: PayloadStore = {
  async open() {
    throw new Error('no staged payloads in this test')
  },
}

/** A file that behaves like the API: writes are staged and replace the file only on `close()`. */
function fakeFile(initial: string, name = 'doc.txt') {
  // the wire type is the general one: what the backend hands us may view any buffer
  let bytes: Uint8Array<ArrayBufferLike> = new TextEncoder().encode(initial)
  let lastModified = 1_000
  let aborted = 0
  const handle: BrowserWritableFileHandle = {
    name,
    async getFile() {
      const snapshot = bytes
      return {
        size: snapshot.byteLength,
        lastModified,
        slice: (start: number, end: number) => ({
          async arrayBuffer() {
            const part = snapshot.slice(start, end)
            const copy = new ArrayBuffer(part.byteLength)
            new Uint8Array(copy).set(part)
            return copy
          },
        }),
      }
    },
    async createWritable(): Promise<BrowserWritableFile> {
      let staged: Uint8Array | undefined
      return {
        async write(data) {
          staged = data
        },
        async close() {
          if (staged !== undefined) {
            bytes = staged
            lastModified += 1
          }
        },
        async abort() {
          aborted += 1
          staged = undefined
        },
      }
    },
  }
  return {
    handle,
    text: () => new TextDecoder().decode(bytes),
    aborts: () => aborted,
    touch: (next: string) => {
      bytes = new TextEncoder().encode(next)
      lastModified += 1
    },
  }
}

const source = { id: 'file-picker://doc.txt', uri: 'file-picker://doc.txt' }

async function pinned(
  backend: ReturnType<typeof createBrowserEditingBackend>,
): Promise<{ revision: AssetRevision; target: SubjectEditTarget }> {
  const target: SubjectEditTarget = {
    targetId: 'content',
    subjectUri: source.uri,
    ownerSource: source,
    semanticPath: [],
    expectedRevision: {
      bindings: { content: 'provider-token:seed' as never },
      compositionFingerprint: 'seed',
    },
  }
  const revision = await backend.currentRevision(target)
  return { revision, target: { ...target, expectedRevision: revision } }
}

describe('browser editing backend', () => {
  it('replaces a byte range through a swap file and reports a revision it read back', async () => {
    const file = fakeFile('hello world')
    const backend = createBrowserEditingBackend({ handleFor: () => file.handle })
    const { revision } = await pinned(backend)
    expect(String(revision.bindings['content'])).toBe('provider-token:11-1000')

    const result = await backend.apply(
      {
        operation: 'replace',
        targetId: 'content',
        source,
        range: { kind: 'bytes', offset: 6n, length: 5n },
        payload: { kind: 'text', text: 'there' },
      },
      { transactionId: 't1', payloads, expectedRevision: revision },
    )
    expect(file.text()).toBe('hello there')
    // the revision came from a fresh snapshot, not from a prediction
    expect(String(result.after.bindings['content'])).toBe('provider-token:11-1001')
    expect(canonicalJsonStringify(result.after)).not.toBe(canonicalJsonStringify(revision))
    await backend.dispose()
  })

  it('refuses a write whose revision moved underneath it, and leaves the file alone', async () => {
    const file = fakeFile('original')
    const backend = createBrowserEditingBackend({ handleFor: () => file.handle })
    const { revision } = await pinned(backend)
    file.touch('changed by someone else')
    await expect(
      backend.apply(
        {
          operation: 'replace',
          targetId: 'content',
          source,
          payload: { kind: 'text', text: 'mine' },
        },
        { transactionId: 't2', payloads, expectedRevision: revision },
      ),
    ).rejects.toMatchObject({ code: 'x3.host/edit-conditional-write-lost' })
    expect(file.text()).toBe('changed by someone else')
    await backend.dispose()
  })

  it('rolls back to the pre-image it kept for the transaction', async () => {
    const file = fakeFile('one')
    const backend = createBrowserEditingBackend({ handleFor: () => file.handle })
    const first = await pinned(backend)
    const applied = await backend.apply(
      { operation: 'replace', targetId: 'content', source, payload: { kind: 'text', text: 'two' } },
      { transactionId: 't3', payloads, expectedRevision: first.revision },
    )
    await backend.apply(
      {
        operation: 'replace',
        targetId: 'content',
        source,
        payload: { kind: 'text', text: 'three' },
      },
      { transactionId: 't3', payloads, expectedRevision: applied.after },
    )
    expect(file.text()).toBe('three')
    const restored = await backend.rollback?.(
      't3',
      { operation: 'replace', targetId: 'content', source, payload: { kind: 'text', text: '' } },
      first.revision,
    )
    // the pre-image is the state the transaction found, not the previous step
    expect(file.text()).toBe('one')
    expect(restored).toBeDefined()
    await backend.dispose()
  })

  it('refuses what a file handle cannot do, and a source with no handle at all', async () => {
    const file = fakeFile('x')
    const backend = createBrowserEditingBackend({
      handleFor: id => (id === source.id ? file.handle : undefined),
    })
    const { revision } = await pinned(backend)
    for (const edit of [
      { operation: 'delete' as const, targetId: 'content', source },
      { operation: 'rename' as const, targetId: 'content', source, newPath: 'other.txt' },
    ]) {
      await expect(
        backend.apply(edit, { transactionId: 't4', payloads, expectedRevision: revision }),
      ).rejects.toMatchObject({ code: 'x3.host/edit-operation-unsupported' })
    }
    expect(backend.profile.supportsRename).toBe(false)
    const elsewhere = { id: 'file-picker://other.txt', uri: 'file-picker://other.txt' }
    await expect(
      backend.apply(
        {
          operation: 'replace',
          targetId: 'content',
          source: elsewhere,
          payload: { kind: 'text', text: 'y' },
        },
        { transactionId: 't4', payloads, expectedRevision: revision },
      ),
    ).rejects.toMatchObject({ code: 'x3.host/edit-source-not-writable' })
    expect(file.text()).toBe('x')
    await backend.dispose()
  })
})
