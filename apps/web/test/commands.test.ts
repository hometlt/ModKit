import { describe, expect, it } from 'vitest'
import {
  commandRequest,
  COMMAND_CANCELLED,
  type CommandRequest,
  type SubjectOpenRequest,
} from '@modkitx-x3/host'
import { createWebCommandProtocol, type WebCommandSubjectAuthorization } from '../src/commands.js'
import type { WebFileAccess } from '../src/files.js'

const request = (id: string): Omit<SubjectOpenRequest, 'path' | 'signal' | 'source'> => ({
  intent: 'full',
  grant: { id: `grant:${id}`, classes: ['read-source'] },
  budget: {
    maxInputBytes: 1024n,
    maxDepth: 8,
    maxNodes: 32,
    maxScalarBytes: 1024,
    maxDiagnostics: 8,
  },
})

function authority(id: string): {
  readonly subject: WebCommandSubjectAuthorization
  readonly reads: { count: number }
} {
  const bytes = new TextEncoder().encode('fixture')
  const file = {
    name: `${id}.fixture`,
    size: bytes.byteLength,
    lastModified: 7,
    slice: () => ({ arrayBuffer: async () => bytes.slice().buffer }),
  }
  const handle = { kind: 'file' as const, name: file.name, getFile: async () => file }
  const reads = { count: 0 }
  const access: WebFileAccess = {
    label: `root:${id}`,
    writeGrant: { queryPermission: async () => 'granted' },
    list: async () => [],
    sizeOf: entryId => (entryId === id ? bytes.byteLength : undefined),
    handleOf: entryId => (entryId === id ? handle : undefined),
    snapshotOf: async entryId =>
      entryId === id ? { size: bytes.byteLength, lastModified: file.lastModified } : undefined,
    async read(entryId, maximum, signal) {
      signal?.throwIfAborted()
      if (entryId !== id) throw new TypeError('outside root')
      reads.count += 1
      return bytes.slice(0, maximum)
    },
  }
  return {
    reads,
    subject: {
      access,
      entry: { id, name: file.name, directory: false, size: bytes.byteLength },
      request: request(id),
    },
  }
}

const opened = (signal?: AbortSignal) => {
  signal?.throwIfAborted()
  return {
    state: 'opened',
    descriptor: { identity: { formatId: 'fixture', formatLabel: 'Fixture' }, operations: [] },
    selected: { contributionId: 'fixture/codec', variantId: 'portable', confidence: 1 },
    candidates: [],
    diagnostics: [],
    session: {
      descriptor: async () => ({
        identity: { formatId: 'fixture', formatLabel: 'Fixture' },
        operations: [],
      }),
      dispose: async () => undefined,
    },
  } as never
}

describe('PWA command protocol authority', () => {
  it('requires explicit root/handle/read grant, caps leases and refuses raw or revoked refs', async () => {
    const protocol = createWebCommandProtocol(
      { open: async item => opened(item.signal) },
      {
        maxAuthorizations: 1,
      },
    )
    const a = authority('a')
    const { writeGrant, ...withoutRootAuthority } = a.subject.access
    expect(writeGrant).toBeDefined()
    expect(() =>
      protocol.authorize({
        ...a.subject,
        access: withoutRootAuthority,
      }),
    ).toThrow(/root authority/u)
    expect(() =>
      protocol.authorize({
        ...a.subject,
        access: { ...a.subject.access, handleOf: () => undefined },
      }),
    ).toThrow(/not a file handle/u)
    expect(() =>
      protocol.authorize({
        ...a.subject,
        request: { ...a.subject.request, grant: { id: 'readless', classes: [] } },
      }),
    ).toThrow(/read-source/u)

    const lease = protocol.authorize(a.subject)
    expect(lease.ref).toBe('modkit-pwa-subject:1')
    expect(lease).toMatchObject({ root: 'root:a', handle: 'a' })
    expect(protocol.authorizedSubjects).toBe(1)
    expect(() => protocol.authorize(authority('b').subject)).toThrow(
      /permitted subject authorizations/u,
    )

    const raw = await protocol.execute(commandRequest('subject.open', { subject: 'a.fixture' }))
    expect(raw.result).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/not authorized/u),
    })
    expect(a.reads.count).toBe(0)
    expect(lease.revoke()).toBe(true)
    expect(lease.revoke()).toBe(false)
    const revoked = await protocol.execute(commandRequest('subject.open', { subject: lease.ref }))
    expect(revoked.result).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/not authorized/u),
    })

    const retargeted = authority('stable')
    const stableProtocol = createWebCommandProtocol({ open: async item => opened(item.signal) })
    const stableLease = stableProtocol.authorize(retargeted.subject)
    Object.defineProperty(retargeted.subject.access, 'handleOf', {
      value: () => ({ kind: 'file', name: 'different', getFile: async () => undefined }),
    })
    const changed = await stableProtocol.execute(
      commandRequest('subject.open', { subject: stableLease.ref }),
    )
    expect(changed.result).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/file handle .* changed/u),
    })
    expect(retargeted.reads.count).toBe(0)

    const movedRoot = authority('root-stable')
    const rootProtocol = createWebCommandProtocol({ open: async item => opened(item.signal) })
    const rootLease = rootProtocol.authorize(movedRoot.subject)
    Object.defineProperty(movedRoot.subject.access, 'writeGrant', {
      value: { queryPermission: async () => 'granted' },
    })
    const changedRoot = await rootProtocol.execute(
      commandRequest('subject.open', { subject: rootLease.ref }),
    )
    expect(changedRoot.result).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/root authority .* changed/u),
    })
    expect(movedRoot.reads.count).toBe(0)
  })

  it('forwards progress, cancellation and protocol errors through the host endpoint', async () => {
    const progress: string[] = []
    const immediate = createWebCommandProtocol({ open: async item => opened(item.signal) })
    const ok = authority('ok')
    const lease = immediate.authorize(ok.subject)
    const receipt = await immediate.execute(
      commandRequest('subject.open', { subject: lease.ref }),
      { runId: 'progress', progress: item => progress.push(item.step) },
    )
    expect(receipt.result).toMatchObject({ state: 'ok', data: { formatId: 'fixture' } })
    expect(progress).toEqual(['open'])
    expect(ok.reads.count).toBe(1)

    const slow = createWebCommandProtocol({
      open: async item =>
        await new Promise((_, reject) => {
          const abort = new Error('cancelled')
          abort.name = 'AbortError'
          item.signal?.addEventListener('abort', () => reject(abort), { once: true })
        }),
    })
    const slowLease = slow.authorize(authority('slow').subject)
    const running = slow.execute(commandRequest('subject.open', { subject: slowLease.ref }), {
      runId: 'slow-run',
    })
    expect(slow.cancel('slow-run')).toBe(true)
    expect((await running).result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })
    expect(slow.cancel('slow-run')).toBe(false)

    await expect(
      immediate.execute({
        ...commandRequest('subject.open', { subject: lease.ref }),
        schemaVersion: 'modkit-command-protocol-99',
      } as unknown as CommandRequest),
    ).rejects.toThrow(/unsupported command protocol/u)
  })

  it('reports live runs and terminal disposal revokes handles, aborts work and refuses reuse', async () => {
    const protocol = createWebCommandProtocol({
      open: async item =>
        await new Promise((_, reject) => {
          const abort = new Error('page closed')
          abort.name = 'AbortError'
          item.signal?.addEventListener('abort', () => reject(abort), { once: true })
        }),
    })
    const lease = protocol.authorize(authority('lifecycle').subject)
    const running = protocol.execute(commandRequest('subject.open', { subject: lease.ref }), {
      runId: 'page-run',
    })
    expect(protocol.activeRuns).toBe(1)
    const disposing = protocol.dispose()
    expect(protocol.closed).toBe(true)
    expect(protocol.authorizedSubjects).toBe(0)
    expect((await running).result).toMatchObject({ state: 'failed', code: COMMAND_CANCELLED })
    await disposing
    expect(protocol.activeRuns).toBe(0)
    await expect(
      protocol.execute(commandRequest('subject.open', { subject: lease.ref })),
    ).rejects.toThrow(/closed/u)
    expect(() => protocol.authorize(authority('later').subject)).toThrow(/closed/u)
    await expect(protocol.dispose()).resolves.toBeUndefined()
  })
})
