/**
 * ADR-HOST-002 §4 — the file editing backend, edit by edit: conditional writes, byte/UTF-16/whole
 * replace via temp + rename, create without overwrite, delete, rename, pre-image rollback,
 * root confinement and non-file sources refused.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import {
  revisionId,
  type AssetRevision,
  type PayloadStore,
  type SubjectEditTarget,
} from '@modkitx-x3/sdk'
import { createFileEditingBackend, openFileArtifactSource } from '@modkitx-x3/host/node'

const scratch = mkdtempSync(join(tmpdir(), 'x3-file-backend-'))
const outside = mkdtempSync(join(tmpdir(), 'x3-file-backend-outside-'))
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const payloads: PayloadStore = {
  async open() {
    throw new Error('no staged payloads in this test')
  },
}

async function pinned(path: string) {
  const source = await openFileArtifactSource(path)
  const ref = { id: source.ref.id, uri: source.ref.uri }
  const revision: AssetRevision = {
    bindings: { content: source.revision },
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: 'content',
      source: ref,
      revision: source.revision,
    }),
  }
  const target: SubjectEditTarget = {
    targetId: 'content',
    subjectUri: ref.uri,
    ownerSource: ref,
    semanticPath: [],
    expectedRevision: revision,
  }
  return { ref, revision, target }
}

const inline = (bytes: Uint8Array) => ({ kind: 'inline' as const, bytes })

describe('file editing backend', () => {
  it('reports the live revision in the S7 vocabulary and refuses a conditional write that lost', async () => {
    const path = join(scratch, 'a.bin')
    writeFileSync(path, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
    const backend = createFileEditingBackend({ roots: [scratch] })
    const { ref, revision, target } = await pinned(path)
    const live = await backend.currentRevision(target)
    expect(String(live.bindings['content']).startsWith('provider-token:')).toBe(true)
    expect(canonicalJsonStringify(live)).toBe(canonicalJsonStringify(revision))
    // the file moves on → the pinned revision is no longer live → conditional write lost
    writeFileSync(path, Uint8Array.from([9, 9, 9]))
    await expect(
      backend.apply(
        {
          operation: 'replace',
          targetId: 'content',
          source: ref,
          payload: inline(Uint8Array.from([0])),
        },
        { transactionId: 't-lost', payloads, expectedRevision: revision },
      ),
    ).rejects.toMatchObject({ code: 'x3.host/edit-conditional-write-lost' })
    expect([...readFileSync(path)]).toEqual([9, 9, 9])
    await backend.dispose()
  })

  it('byte-range, UTF-16 and whole-source replaces land atomically and roll back from the pre-image', async () => {
    const path = join(scratch, 'b.txt')
    writeFileSync(path, 'héllo wörld')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const { ref, revision } = await pinned(path)
    // byte range: replace the 'wörld' bytes (UTF-8 'ö' is two bytes) with 'there'
    const bytes = readFileSync(path)
    const start = bytes.indexOf('w')
    const first = await backend.apply(
      {
        operation: 'replace',
        targetId: 'content',
        source: ref,
        range: { kind: 'bytes', offset: BigInt(start), length: BigInt(bytes.length - start) },
        payload: inline(new TextEncoder().encode('there')),
      },
      { transactionId: 't1', payloads, expectedRevision: revision },
    )
    expect(readFileSync(path, 'utf8')).toBe('héllo there')
    expect(first.after.bindings['content']).not.toBe(revision.bindings['content'])
    // UTF-16 range: offsets count code units of the decoded text
    const second = await backend.apply(
      {
        operation: 'replace',
        targetId: 'content',
        source: ref,
        range: { kind: 'utf16', offset: 0, length: 5 },
        payload: { kind: 'text', text: 'HELLO' },
      },
      { transactionId: 't1', payloads, expectedRevision: first.after },
    )
    expect(readFileSync(path, 'utf8')).toBe('HELLO there')
    // whole source
    const third = await backend.apply(
      {
        operation: 'replace',
        targetId: 'content',
        source: ref,
        payload: { kind: 'text', text: 'x' },
      },
      { transactionId: 't1', payloads, expectedRevision: second.after },
    )
    expect(readFileSync(path, 'utf8')).toBe('x')
    // rollback restores the bytes of the earliest pre-image of this transaction for the file
    const restored = await backend.rollback?.(
      't1',
      {
        operation: 'replace',
        targetId: 'content',
        source: ref,
        payload: { kind: 'text', text: '' },
      },
      revision,
    )
    expect(readFileSync(path, 'utf8')).toBe('héllo wörld')
    expect(restored?.bindings['content']).not.toBe(third.after.bindings['content'])
    // no temp files linger
    expect(readdirSync(scratch).filter(name => name.startsWith('.x3-edit-'))).toEqual([])
    await backend.dispose()
  })

  it('creates without overwriting, deletes, renames, and stays inside its roots', async () => {
    const path = join(scratch, 'c.bin')
    writeFileSync(path, Uint8Array.from([1]))
    const backend = createFileEditingBackend({ roots: [scratch] })
    const { ref, revision } = await pinned(path)
    const created = await backend.apply(
      {
        operation: 'create',
        targetId: 'content',
        source: ref,
        newPath: 'created.bin',
        payload: inline(Uint8Array.from([7, 7])),
      },
      { transactionId: 't2', payloads, expectedRevision: revision },
    )
    expect([...readFileSync(join(scratch, 'created.bin'))]).toEqual([7, 7])
    expect(created.after.bindings['content']).toBeDefined()
    await expect(
      backend.apply(
        {
          operation: 'create',
          targetId: 'content',
          source: ref,
          newPath: 'created.bin',
          payload: inline(Uint8Array.from([1])),
        },
        { transactionId: 't2', payloads, expectedRevision: revision },
      ),
    ).rejects.toThrow()
    await backend.apply(
      { operation: 'rename', targetId: 'content', source: ref, newPath: 'renamed.bin' },
      { transactionId: 't2', payloads, expectedRevision: revision },
    )
    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(scratch, 'renamed.bin'))).toBe(true)
    const renamedRef = {
      id: pathToFileURL(join(scratch, 'renamed.bin')).href,
      uri: pathToFileURL(join(scratch, 'renamed.bin')).href,
    }
    const renamed = await pinned(join(scratch, 'renamed.bin'))
    await backend.apply(
      { operation: 'delete', targetId: 'content', source: renamedRef },
      { transactionId: 't2', payloads, expectedRevision: renamed.revision },
    )
    expect(existsSync(join(scratch, 'renamed.bin'))).toBe(false)
    // confinement: a source outside the roots and a non-file source are refused before any stat
    const elsewhere = join(outside, 'x.bin')
    writeFileSync(elsewhere, Uint8Array.from([1]))
    const outsideRef = { id: pathToFileURL(elsewhere).href, uri: pathToFileURL(elsewhere).href }
    await expect(
      backend.apply(
        {
          operation: 'replace',
          targetId: 'content',
          source: outsideRef,
          payload: inline(new Uint8Array()),
        },
        { transactionId: 't3', payloads, expectedRevision: revision },
      ),
    ).rejects.toMatchObject({ code: 'x3.host/edit-path-outside-roots' })
    await expect(
      backend.currentRevision({
        targetId: 'content',
        subjectUri: 'memory://x',
        ownerSource: { id: 'memory://x', uri: 'memory://x' },
        semanticPath: [],
        expectedRevision: {
          bindings: { content: revisionId('provider-token:x') },
          compositionFingerprint: 'x',
        },
      }),
    ).rejects.toMatchObject({ code: 'x3.host/edit-source-not-file' })
    await backend.dispose()
  })
})
