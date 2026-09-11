import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type InputSearchScope,
  type LogicalResourceReadBatchRequest,
  type LogicalResourceRequirement,
  type ResourceResolution,
  type RevisionId,
  type ResourceSessionPort,
} from '@modkit/sdk'
import { createSubjectLogicalResources } from '../src/logical-resources.js'

const revision: RevisionId = revisionId('provider-token:batch')
const budget = {
  maxInputBytes: 4096n,
  maxDepth: 8,
  maxNodes: 32,
  maxScalarBytes: 4096,
  maxDiagnostics: 16,
}
const requirement = (id: string): LogicalResourceRequirement => ({
  id,
  logicalId: `${id}.m3a`,
  role: 'sidecar',
  scopes: ['current-mount'],
})
const request = (
  ids: readonly string[],
  overrides: Partial<LogicalResourceReadBatchRequest> = {},
): LogicalResourceReadBatchRequest => ({
  items: ids.map(id => ({ requirement: requirement(id), expectedRevision: revision, size: 4n })),
  concurrency: 4,
  readTimeoutMs: 100,
  totalTimeoutMs: 1000,
  maxBytes: 4096n,
  ...overrides,
})
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred is not initialized')
  }
  const promise = new Promise<T>(yes => {
    resolve = yes
  })
  return { promise, resolve }
}
function resolved(
  id: string,
  read?: ArtifactByteSource['read'],
  size = 4n,
  sourceRevision = revision,
) {
  const release = vi.fn(async () => undefined)
  const bytes = new Uint8Array([1, 2, 3, Number(id) || 4])
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id, uri: `memory:${id}` },
    size,
    revision: sourceRevision,
    read: read ?? (async () => bytes),
    async *stream() {
      yield bytes
    },
  }
  const resolution: ResourceResolution = {
    state: 'resolved',
    revision: sourceRevision,
    lease: { value: source, release },
    provenance: {
      requirementId: id,
      logicalId: `${id}.m3a`,
      role: 'sidecar',
      state: 'resolved',
      cached: false,
      scopes: ['current-mount'],
      revision: sourceRevision,
      bytes: size,
    },
  }
  return { resolution, release }
}
function fixture(resolve: ResourceSessionPort['resolve']) {
  let authorized = true
  const resources: ResourceSessionPort = {
    sessionId: 'batch',
    revision,
    state: () => 'live',
    resolve,
    provenance: () => [],
    dispose: async () => undefined,
  }
  const state = { live: true, reservedBytes: 0, resolveCalls: 0, discoveryCalls: 0, resources }
  const port = createSubjectLogicalResources({ state, budget, isAuthorized: () => authorized })
  return {
    port,
    state,
    revoke: () => {
      authorized = false
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('host-owned resource batch', () => {
  it('owns returned Buffer bytes independently of the provider allocation', async () => {
    const bytes = Buffer.from([1, 2, 3, 4])
    const lease = resolved('1', async () => bytes)
    lease.release.mockImplementation(async () => {
      bytes.fill(9)
    })
    const f = fixture(async () => lease.resolution)
    const batch = await f.port.readBatch(request(['1']))
    bytes[0] = 99
    expect(batch).toMatchObject({
      state: 'complete',
      items: [{ state: 'read', bytes: new Uint8Array([1, 2, 3, 4]) }],
    })
  })
  it('captures scopes by bounded index without invoking a custom array iterator', async () => {
    const scopes: InputSearchScope[] = ['current-mount']
    scopes[Symbol.iterator] = () => {
      throw new Error('Unbounded iterator must never execute')
    }
    const resolve = vi.fn(async (req: LogicalResourceRequirement) => resolved(req.id).resolution)
    const f = fixture(resolve)
    expect(
      await f.port.readBatch(
        request([], { items: [{ requirement: { ...requirement('1'), scopes } }] }),
      ),
    ).toMatchObject({ state: 'complete', bytes: 4n })
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ scopes: ['current-mount'] })
  })
  it('retains a timed-out cleanup allocation across batches until release actually completes', async () => {
    vi.useFakeTimers()
    const releaseGate = deferred<undefined>()
    const held = resolved('1', async () => new Uint8Array(4096), 4096n)
    held.release.mockImplementation(async () => releaseGate.promise)
    const nextRead = vi.fn(async () => new Uint8Array(4))
    const next = resolved('2', nextRead)
    const f = fixture(async req => (req.id === '1' ? held.resolution : next.resolution))
    const first = f.port.readBatch(
      request([], { items: [{ requirement: requirement('1'), size: 4096n }] }),
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(await first).toMatchObject({
      state: 'complete',
      items: [{ reason: 'deadline-exceeded' }],
    })
    expect(f.state.reservedBytes).toBe(0)
    expect(await f.port.readBatch(request(['2']))).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      items: [],
    })
    expect(nextRead).not.toHaveBeenCalled()
    releaseGate.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(await f.port.readBatch(request(['2']))).toMatchObject({ state: 'complete', bytes: 4n })
    expect(held.release).toHaveBeenCalledTimes(1)
  })
  it('shares the active backend call ceiling across concurrent batches', async () => {
    vi.useFakeTimers()
    const gate = deferred<ResourceResolution>()
    const lease = resolved('1')
    const resolve = vi.fn(async () => gate.promise)
    const f = fixture(resolve)
    const first = f.port.readBatch(request(['1', '2', '3', '4']))
    await vi.advanceTimersByTimeAsync(0)
    expect(await f.port.readBatch(request(['5']))).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
    })
    expect(resolve).toHaveBeenCalledTimes(4)
    gate.resolve(lease.resolution)
    expect(await first).toMatchObject({ state: 'complete', bytes: 16n })
  })
  it('caps active work at four and returns source order after out-of-order completion', async () => {
    const pending = Array.from({ length: 6 }, () => deferred<Uint8Array>())
    const leases = pending.map((p, index) => resolved(String(index), async () => p.promise))
    const calls: string[] = []
    const f = fixture(async req => {
      calls.push(req.id)
      const lease = leases[Number(req.id)]
      if (lease === undefined) throw new Error('Unexpected resource')
      return lease.resolution
    })
    vi.useFakeTimers()
    const result = f.port.readBatch(request(['0', '1', '2', '3', '4', '5'], { concurrency: 20 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['0', '1', '2', '3'])
    pending[3]?.resolve(new Uint8Array([3, 3, 3, 3]))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['0', '1', '2', '3', '4'])
    for (const [index, p] of pending.entries())
      p.resolve(new Uint8Array([index, index, index, index]))
    const batch = await result
    expect(batch.state).toBe('complete')
    if (batch.state !== 'complete') throw new Error(batch.message)
    expect(batch.items.map(item => (item.state === 'read' ? item.bytes[0] : -1))).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    expect(batch.bytes).toBe(24n)
    for (const lease of leases) expect(lease.release).toHaveBeenCalledTimes(1)
    expect(f.state.reservedBytes).toBe(0)
  })

  it('captures queued requirements, sizes and revisions before yielding', async () => {
    vi.useFakeTimers()
    const gate = deferred<Uint8Array>()
    const first = resolved('first', async () => gate.promise)
    const second = resolved('second')
    const calls: string[] = []
    const f = fixture(async req => {
      calls.push(req.logicalId)
      return calls.length === 1 ? first.resolution : second.resolution
    })
    const mutable = { ...requirement('second'), scopes: ['current-mount'] as InputSearchScope[] }
    const items = [
      { requirement: requirement('first'), size: 4n, expectedRevision: revision },
      { requirement: mutable, size: 4n, expectedRevision: revision },
    ]
    const batch = f.port.readBatch(request([], { items, concurrency: 1 }))
    mutable.logicalId = 'changed.m3a'
    mutable.scopes.length = 0
    items[1] = {
      requirement: requirement('other'),
      size: 99n,
      expectedRevision: revisionId('provider-token:other'),
    }
    await vi.advanceTimersByTimeAsync(0)
    gate.resolve(new Uint8Array(4))
    expect(await batch).toMatchObject({ state: 'complete', bytes: 8n })
    expect(calls).toEqual(['first.m3a', 'second.m3a'])
  })

  it('refuses the combined declared extent before resolving anything', async () => {
    const resolve = vi.fn(async () => resolved('1').resolution)
    const f = fixture(resolve)
    expect(await f.port.readBatch(request(['1', '2'], { maxBytes: 7n }))).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      items: [],
      bytes: 0n,
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('includes completed buffers in the dynamic extent ceiling and discards the staged batch', async () => {
    const leases = [resolved('1'), resolved('2')]
    const f = fixture(async req => {
      const selected = leases[Number(req.id) - 1]
      if (selected === undefined) throw new Error('No lease')
      return selected.resolution
    })
    const batch = await f.port.readBatch(
      request([], {
        items: ['1', '2'].map(id => ({ requirement: requirement(id) })),
        concurrency: 1,
        maxBytes: 7n,
      }),
    )
    expect(batch).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      items: [],
      bytes: 0n,
    })
    for (const lease of leases) expect(lease.release).toHaveBeenCalledTimes(1)
  })

  it.each(['revision', 'size'] as const)(
    'refuses a changed discovered %s and releases its lease',
    async mismatch => {
      const lease = resolved(
        '1',
        undefined,
        mismatch === 'size' ? 5n : 4n,
        mismatch === 'revision' ? revisionId('provider-token:new') : revision,
      )
      const f = fixture(async () => lease.resolution)
      expect(await f.port.readBatch(request(['1']))).toMatchObject({
        state: 'refused',
        reason: 'source-revision-changed',
        items: [],
      })
      expect(lease.release).toHaveBeenCalledTimes(1)
    },
  )

  it('reports a short read without presenting its partial bytes as a source', async () => {
    const lease = resolved('1', async () => new Uint8Array(2))
    const f = fixture(async () => lease.resolution)
    expect(await f.port.readBatch(request(['1']))).toMatchObject({
      state: 'complete',
      bytes: 0n,
      items: [{ state: 'unresolved', reason: 'size-mismatch' }],
    })
    expect(lease.release).toHaveBeenCalledTimes(1)
  })

  it('retires a timed-out resolver slot and releases a late lease exactly once', async () => {
    vi.useFakeTimers()
    const gate = deferred<ResourceResolution>()
    const lease = resolved('1')
    let forwarded: AbortSignal | undefined
    const resolve = vi.fn(async (_req: LogicalResourceRequirement, signal?: AbortSignal) => {
      forwarded = signal
      return gate.promise
    })
    const f = fixture(resolve)
    const batch = f.port.readBatch(request(['1', '2'], { concurrency: 1 }))
    await vi.advanceTimersByTimeAsync(100)
    expect(await batch).toMatchObject({
      state: 'complete',
      bytes: 0n,
      items: [{ reason: 'deadline-exceeded' }, { reason: 'deadline-exceeded' }],
    })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(forwarded?.aborted).toBe(true)
    gate.resolve(lease.resolution)
    await vi.advanceTimersByTimeAsync(0)
    expect(lease.release).toHaveBeenCalledTimes(1)
  })

  it('holds an in-flight byte reservation until an uncooperative read settles', async () => {
    vi.useFakeTimers()
    const gate = deferred<Uint8Array>()
    const lease = resolved('1', async () => gate.promise)
    const f = fixture(async () => lease.resolution)
    const batch = f.port.readBatch(request(['1']))
    await vi.advanceTimersByTimeAsync(100)
    expect(await batch).toMatchObject({
      state: 'complete',
      bytes: 0n,
      items: [{ reason: 'deadline-exceeded' }],
    })
    expect(f.state.reservedBytes).toBe(4)
    gate.resolve(new Uint8Array(4))
    await vi.advanceTimersByTimeAsync(0)
    expect(f.state.reservedBytes).toBe(0)
    expect(lease.release).toHaveBeenCalledTimes(1)
  })

  it('discards successful staged buffers when the total duration expires', async () => {
    vi.useFakeTimers()
    const gate = deferred<Uint8Array>()
    const first = resolved('1')
    const late = resolved('2', async () => gate.promise)
    const f = fixture(async req => (req.id === '1' ? first.resolution : late.resolution))
    const batch = f.port.readBatch(request(['1', '2'], { readTimeoutMs: 1000, totalTimeoutMs: 50 }))
    await vi.advanceTimersByTimeAsync(50)
    expect(await batch).toMatchObject({
      state: 'refused',
      reason: 'deadline-exceeded',
      items: [],
      bytes: 0n,
    })
    gate.resolve(new Uint8Array(4))
    await vi.advanceTimersByTimeAsync(0)
    expect(first.release).toHaveBeenCalledTimes(1)
    expect(late.release).toHaveBeenCalledTimes(1)
  })

  it('propagates caller cancellation while retaining late cleanup', async () => {
    vi.useFakeTimers()
    const gate = deferred<Uint8Array>()
    const lease = resolved('1', async () => gate.promise)
    const f = fixture(async () => lease.resolution)
    const controller = new AbortController()
    const batch = f.port.readBatch(request(['1']), controller.signal)
    const rejected = expect(batch).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    gate.resolve(new Uint8Array(4))
    await vi.advanceTimersByTimeAsync(0)
    expect(lease.release).toHaveBeenCalledTimes(1)
    expect(f.state.reservedBytes).toBe(0)
  })

  it('does not publish bytes after the read grant is revoked', async () => {
    const f = fixture(
      async () =>
        resolved('1', async () => {
          f.revoke()
          return new Uint8Array(4)
        }).resolution,
    )
    expect(await f.port.readBatch(request(['1']))).toMatchObject({
      state: 'refused',
      reason: 'permission-missing',
      items: [],
    })
  })

  it('snapshots host naming context and bounds a discovery callback that ignores cancellation', async () => {
    vi.useFakeTimers()
    const f = fixture(async () => resolved('1').resolution)
    const context = { primaryLogicalId: 'models/unit.m3', rootId: 'approved' }
    let hanging = false
    let forwarded: AbortSignal | undefined
    const port = createSubjectLogicalResources({
      state: f.state,
      budget,
      isAuthorized: () => true,
      policies: [
        {
          role: 'sidecar',
          extension: '.m3a',
          timeoutMs: 20,
          async discover({ signal }) {
            forwarded = signal
            if (hanging) return new Promise(() => undefined)
            return {
              state: 'complete',
              context,
              candidates: [],
              receipt: { complete: true, pages: 0, entries: 0, candidates: 0, bytes: 0n },
            }
          },
        },
      ],
    })
    const result = await port.discover({ role: 'sidecar', extension: '.m3a', timeoutMs: 100 })
    context.primaryLogicalId = '../unapproved.m3'
    expect(result).toMatchObject({
      state: 'complete',
      context: { primaryLogicalId: 'models/unit.m3', rootId: 'approved' },
    })
    expect(await port.discover({ role: 'sidecar', extension: '.m3a' })).toMatchObject({
      state: 'refused',
      reason: 'namespace-invalid',
    })
    hanging = true
    const timed = port.discover({ role: 'sidecar', extension: '.m3a', timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await timed).toMatchObject({
      state: 'refused',
      reason: 'deadline-exceeded',
      candidates: [],
    })
    expect(forwarded?.aborted).toBe(true)
  })
})
