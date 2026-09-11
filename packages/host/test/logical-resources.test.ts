import { describe, expect, it, vi } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type InputSearchScope,
  type LogicalResourceDiscoveryResult,
  type LogicalResourcePort,
  type ResourceBudget,
  type ResourceResolution,
  type ResourceSessionPort,
} from '@modkit/sdk'
import {
  createSubjectLogicalResources,
  type SubjectLogicalResourceState,
} from '../src/logical-resources.js'
import {
  logicalResourcesFromWire,
  wireLogicalResources,
  type WireLogicalResourcePort,
} from '../src/execution/logical-resources.js'
import { ABI_LOGICAL_RESOURCES, RUNTIME_ABI_SURFACES } from '../src/execution/abi-surfaces.js'
import { createEndpoint } from '../src/execution/endpoint.js'
import { createSurfaceRegistry } from '../src/execution/surface.js'
import type { FramePort } from '../src/execution/index.js'

const revision = revisionId('provider-token:logical-resource-test')
const budget: ResourceBudget = {
  maxInputBytes: 100n,
  maxDepth: 4,
  maxNodes: 8,
  maxScalarBytes: 64,
  maxDiagnostics: 8,
}
const requirement = {
  id: 'animation',
  logicalId: 'walk.m3a',
  role: 'sidecar',
  scopes: ['workspace-dependency-layer'],
} as const
const request = { role: 'sidecar', extension: '.m3a' } as const
const provenance = {
  requirementId: requirement.id,
  logicalId: requirement.logicalId,
  role: requirement.role,
  state: 'resolved',
  revision,
  bytes: 4n,
  cached: false,
  scopes: requirement.scopes,
} as const
const complete = (): Extract<LogicalResourceDiscoveryResult, { state: 'complete' }> => ({
  state: 'complete',
  candidates: [{ logicalId: 'walk.m3a', rootId: 'r', expectedRevision: revision, size: 4n }],
  receipt: { complete: true, pages: 1, entries: 1, candidates: 1, bytes: 4n },
})

function deferred<T>() {
  let complete: (value: T) => void = () => {
    throw new Error('Promise not initialized')
  }
  const promise = new Promise<T>(resolve => {
    complete = resolve
  })
  return { promise, complete }
}

function fixture(budgetOverrides: Partial<ResourceBudget> = {}) {
  const bytes = new Uint8Array([11, 22, 33, 44])
  const release = vi.fn(async () => undefined)
  const read = vi.fn(async (offset: bigint, length: number): Promise<Uint8Array> =>
    bytes.subarray(Number(offset), Number(offset) + length),
  )
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: 'logical', uri: 'memory:logical' },
    revision,
    size: 4n,
    read,
    async *stream() {
      yield bytes
    },
  }
  const resolve = vi.fn(async (): Promise<ResourceResolution> => ({
    state: 'resolved',
    revision,
    provenance,
    lease: { value: source, release },
  }))
  const resources: ResourceSessionPort = {
    sessionId: 'resources',
    revision,
    state: () => 'live',
    resolve,
    provenance: () => [provenance],
    dispose: vi.fn(async () => undefined),
  }
  const state: SubjectLogicalResourceState = {
    live: true,
    reservedBytes: 0,
    resolveCalls: 0,
    discoveryCalls: 0,
    resources,
  }
  let authorized = true
  const discover = vi.fn(async (): Promise<LogicalResourceDiscoveryResult> => complete())
  const port = createSubjectLogicalResources({
    state,
    budget: { ...budget, ...budgetOverrides },
    isAuthorized: () => authorized,
    policies: [{ ...request, discover }],
  })
  return {
    state,
    port,
    source,
    resources,
    bytes,
    resolve,
    read,
    release,
    discover,
    revoke: () => {
      authorized = false
    },
  }
}

describe('bounded post-open logical resource port', () => {
  it('retains ordered host-selected scopes as an immutable owned snapshot', async () => {
    const f = fixture({ maxScalarBytes: 256 }),
      result = complete()
    const scopes: InputSearchScope[] = [
      'explicit-user-selection',
      'current-mount',
      'sibling-directory',
      'enclosing-container',
      'workspace-dependency-layer',
    ]
    const expected = [...scopes]
    Object.assign(result.candidates[0] ?? {}, { scopes })
    f.discover.mockResolvedValue(result)
    const captured = await f.port.discover(request)
    expect(captured.state).toBe('complete')
    const actual = captured.candidates[0]?.scopes
    expect(actual).toEqual(expected)
    expect(Object.isFrozen(actual)).toBe(true)
    scopes.reverse()
    scopes[0] = 'current-mount'
    expect(actual).toEqual(expected)
  })
  it('keeps absent candidate scopes absent for the existing workspace default', async () => {
    const f = fixture()
    const captured = await f.port.discover(request)
    expect(captured).toEqual(complete())
    expect(captured.candidates[0]).not.toHaveProperty('scopes')
  })
  it('captures the scope extent once and ignores custom iteration and appended entries', async () => {
    const f = fixture({ maxScalarBytes: 256 }),
      result = complete()
    let lengthReads = 0
    const values: InputSearchScope[] = ['sibling-directory']
    Object.defineProperty(values, 0, {
      get() {
        values.push('current-mount')
        return 'sibling-directory'
      },
    })
    const scopes = new Proxy(values, {
      get(target, key, receiver) {
        if (key === 'length') lengthReads += 1
        if (key === Symbol.iterator) throw new Error('Scope iteration must not run')
        return Reflect.get(target, key, receiver)
      },
    })
    Object.assign(result.candidates[0] ?? {}, { scopes })
    f.discover.mockResolvedValue(result)
    const captured = await f.port.discover(request)
    expect(captured.state).toBe('complete')
    expect(captured.candidates[0]?.scopes).toEqual(['sibling-directory'])
    expect(lengthReads).toBe(1)
    expect(values).toHaveLength(2)
  })
  it.each([
    ['unknown', ['unknown-scope']],
    ['empty', []],
    ['oversized', Array.from({ length: 6 }, () => 'current-mount')],
    ['duplicate', ['current-mount', 'current-mount']],
    ['sparse', Array(1)],
    ['not an array', 'current-mount'],
  ])('refuses the entire discovery batch for %s candidate scopes', async (_name, scopes) => {
    const f = fixture({ maxScalarBytes: 256 }),
      result = complete()
    const first = result.candidates[0]
    if (first === undefined) throw new Error('Missing fixture candidate')
    const second = { ...first, logicalId: 'run.m3a' }
    Object.assign(second, { scopes })
    f.discover.mockResolvedValue({
      ...result,
      candidates: [first, second],
      receipt: { complete: true, pages: 1, entries: 2, candidates: 2, bytes: 8n },
    })
    expect(await f.port.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'namespace-invalid',
      candidates: [],
    })
  })
  it('includes candidate scopes in the aggregate UTF8 scalar budget', async () => {
    const result = complete(),
      scopes: InputSearchScope[] = ['current-mount']
    const candidate = result.candidates[0]
    if (candidate === undefined) throw new Error('Missing fixture candidate')
    Object.assign(candidate, { logicalId: '走.m3a', scopes })
    const exact = new TextEncoder().encode(
      candidate.logicalId + candidate.expectedRevision + candidate.rootId + scopes.join(''),
    ).length
    const tight = fixture({ maxScalarBytes: exact - 1 }),
      fits = fixture({ maxScalarBytes: exact })
    tight.discover.mockResolvedValue(result)
    fits.discover.mockResolvedValue(result)
    expect(await tight.port.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      candidates: [],
    })
    expect(await fits.port.discover(request)).toEqual(result)
  })
  it('captures exactly the declared candidate count when an accessor appends to the source array', async () => {
    const f = fixture(),
      result = complete()
    const first = result.candidates[0]
    if (first === undefined) throw new Error('Missing fixture candidate')
    const candidates = [first]
    Object.defineProperty(candidates, 0, {
      get() {
        candidates.push({ ...first, logicalId: 'hidden.m3a' })
        return first
      },
    })
    f.discover.mockResolvedValue({ ...result, candidates })
    const captured = await f.port.discover(request)
    expect(captured).toEqual(complete())
    expect(candidates).toHaveLength(2)
  })
  it('shares resolution and discovery call budgets between contexts, including cache hits', async () => {
    const f = fixture()
    f.resolve.mockResolvedValue({
      state: 'resolved',
      revision,
      provenance: { ...provenance, cached: true },
      lease: { value: f.source, release: f.release },
    })
    const options = {
      state: f.state,
      budget: { ...budget, maxNodes: 2 },
      isAuthorized: () => true,
      policies: [{ ...request, discover: f.discover }],
    }
    const first = createSubjectLogicalResources(options),
      second = createSubjectLogicalResources(options)
    for (const port of [first, second]) {
      expect(await port.discover(request)).toMatchObject({ state: 'complete' })
      const r = await port.resolve(requirement)
      if (r.state !== 'resolved') throw new Error('Expected admitted cache hit')
      expect(r.provenance.cached).toBe(true)
      await r.lease.release()
    }
    expect(await first.resolve(requirement)).toMatchObject({
      state: 'unresolved',
      reason: 'budget-exceeded',
    })
    expect(await second.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      candidates: [],
    })
    expect(f.resolve).toHaveBeenCalledTimes(2)
    expect(f.discover).toHaveBeenCalledTimes(2)
    expect(f.state.resolveCalls).toBe(2)
    expect(f.state.discoveryCalls).toBe(2)
  })
  it('refuses provenance grown beyond the consumer budget by another host consumer', async () => {
    const f = fixture()
    f.state.resources = {
      ...f.resources,
      provenance: () => Array.from({ length: 9 }, () => provenance),
    }
    await expect(f.port.provenance()).rejects.toThrow('record budget')
  })
  it('refuses immediately before open without discovery or resolution I/O', async () => {
    const f = fixture()
    f.state.live = false
    expect(await f.port.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'context-unavailable',
      candidates: [],
    })
    expect(await f.port.resolve(requirement)).toMatchObject({
      state: 'unresolved',
      reason: 'session-disposed',
    })
    expect(f.discover).not.toHaveBeenCalled()
    expect(f.resolve).not.toHaveBeenCalled()
  })
  it('selects only registered role and extension; host roots never enter the result', async () => {
    const f = fixture()
    expect(await f.port.discover({ ...request, extension: '.M3A' })).toEqual(complete())
    expect(await f.port.discover({ ...request, extension: '.other' })).toMatchObject({
      state: 'refused',
      reason: 'request-unsupported',
    })
    expect(await f.port.discover({ ...request, prefix: '/' } as typeof request)).toMatchObject({
      state: 'refused',
      reason: 'request-invalid',
    })
    expect(f.discover).toHaveBeenCalledTimes(1)
    const context = f.discover.mock.calls[0]
    expect(context).toEqual([{ budget, signal: expect.any(AbortSignal) }])
  })
  it('snapshots policy selection and caller request before asynchronous work', async () => {
    const f = fixture(),
      pending = deferred<LogicalResourceDiscoveryResult>()
    const policy = { ...request, discover: vi.fn(() => pending.promise) }
    const port = createSubjectLogicalResources({
      state: f.state,
      budget,
      policies: [policy],
      isAuthorized: () => true,
    })
    const mutable = { role: 'sidecar' as const, extension: '.m3a' }
    const running = port.discover(mutable)
    mutable.extension = '.other'
    policy.discover = vi.fn(async () => {
      throw new Error('replacement must not run')
    })
    pending.complete(complete())
    expect(await running).toEqual(complete())
  })
  it('copies discovery output and removes host-only receipt metadata', async () => {
    const f = fixture(),
      result = complete()
    Object.assign(result.receipt, { searches: [{ prefix: 'private-root' }] })
    f.discover.mockResolvedValue(result)
    const captured = await f.port.discover(request)
    expect(captured.receipt).not.toHaveProperty('searches')
    Object.assign(result.candidates[0] ?? {}, { logicalId: 'changed.m3a' })
    expect(captured.candidates[0]?.logicalId).toBe('walk.m3a')
    expect(Object.isFrozen(captured.candidates[0])).toBe(true)
  })
  it.each([
    [
      'duplicate',
      (r: LogicalResourceDiscoveryResult) => ({
        ...r,
        candidates: [r.candidates[0], r.candidates[0]],
        receipt: { ...r.receipt, entries: 2, candidates: 2, bytes: 8n },
      }),
    ],
    ['sparse', (r: LogicalResourceDiscoveryResult) => ({ ...r, candidates: Array(1) })],
    [
      'revision',
      (r: LogicalResourceDiscoveryResult) => ({
        ...r,
        candidates: [{ ...r.candidates[0], expectedRevision: 'invalid' }],
      }),
    ],
    [
      'size',
      (r: LogicalResourceDiscoveryResult) => ({
        ...r,
        candidates: [{ ...r.candidates[0], size: -1n }],
      }),
    ],
    [
      'nonfinite',
      (r: LogicalResourceDiscoveryResult) => ({ ...r, receipt: { ...r.receipt, pages: Infinity } }),
    ],
    [
      'overflow',
      (r: LogicalResourceDiscoveryResult) => ({
        ...r,
        receipt: { ...r.receipt, entries: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ],
    [
      'byte receipt mismatch',
      (r: LogicalResourceDiscoveryResult) => ({ ...r, receipt: { ...r.receipt, bytes: 5n } }),
    ],
    [
      'traversal',
      (r: LogicalResourceDiscoveryResult) => ({
        ...r,
        candidates: [{ ...r.candidates[0], logicalId: '../walk.m3a' }],
      }),
    ],
  ])('refuses %s without publishing partial candidates', async (_name, mutate) => {
    const f = fixture()
    f.discover.mockResolvedValue(mutate(complete()) as LogicalResourceDiscoveryResult)
    expect(await f.port.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'namespace-invalid',
      candidates: [],
    })
  })
  it('enforces independent candidate and receipt budgets', async () => {
    const f = fixture()
    f.discover.mockResolvedValue({
      ...complete(),
      receipt: { complete: true, pages: 1, entries: 9, candidates: 1, bytes: 4n },
    })
    expect(await f.port.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      candidates: [],
    })
    f.discover.mockResolvedValue({
      state: 'complete',
      candidates: [{ logicalId: 'walk.m3a', rootId: 'r', expectedRevision: revision, size: 65n }],
      receipt: { complete: true, pages: 1, entries: 1, candidates: 1, bytes: 65n },
    })
    expect(await f.port.discover(request)).toMatchObject({
      state: 'refused',
      reason: 'budget-exceeded',
      candidates: [],
    })
  })
  it('rejects duplicate registrations before invoking a policy', () => {
    const f = fixture()
    expect(() =>
      createSubjectLogicalResources({
        state: f.state,
        budget,
        isAuthorized: () => true,
        policies: [
          { ...request, discover: f.discover },
          { ...request, extension: '.M3A', discover: f.discover },
        ],
      }),
    ).toThrow('unique')
    expect(f.discover).not.toHaveBeenCalled()
  })
  it('revokes pending discovery and never publishes its candidates', async () => {
    const f = fixture(),
      pending = deferred<LogicalResourceDiscoveryResult>()
    f.discover.mockReturnValue(pending.promise)
    const running = f.port.discover(request)
    f.revoke()
    pending.complete(complete())
    expect(await running).toMatchObject({
      state: 'refused',
      reason: 'permission-missing',
      candidates: [],
    })
  })
  it('cleans up a newly resolved lease when authorization is revoked during resolution', async () => {
    const f = fixture(),
      pending = deferred<ResourceResolution>()
    const resolution = await f.resolve()
    f.resolve.mockReturnValue(pending.promise)
    const running = f.port.resolve(requirement)
    f.revoke()
    pending.complete(resolution)
    await expect(running).rejects.toThrow('live readable')
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('owns returned bytes, guards extent, and releases only once', async () => {
    const f = fixture(),
      r = await f.port.resolve(requirement)
    if (r.state !== 'resolved' || r.lease.value.kind !== 'bytes') throw new Error('No bytes')
    const bytes = await r.lease.value.read(0n, 4)
    bytes[0] = 0
    expect(f.bytes[0]).toBe(11)
    await expect(r.lease.value.read(0n, 5)).rejects.toThrow('bounded extent')
    await r.lease.release()
    await r.lease.release()
    await expect(r.lease.value.read(0n, 1)).rejects.toThrow('released')
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.state.reservedBytes).toBe(0)
  })
  it('revokes a pending byte read and returns its reserved budget', async () => {
    const f = fixture(),
      pending = deferred<Uint8Array>(),
      r = await f.port.resolve(requirement)
    if (r.state !== 'resolved' || r.lease.value.kind !== 'bytes') throw new Error('No bytes')
    f.read.mockReturnValue(pending.promise)
    const running = r.lease.value.read(0n, 4)
    expect(f.state.reservedBytes).toBe(4)
    f.state.live = false
    pending.complete(f.bytes)
    await expect(running).rejects.toThrow('live readable')
    expect(f.state.reservedBytes).toBe(0)
    await r.lease.release()
  })
  it('releases namespace results without exposing namespace methods', async () => {
    const f = fixture()
    f.resolve.mockResolvedValue({
      state: 'resolved',
      revision,
      provenance,
      lease: {
        release: f.release,
        value: {
          kind: 'namespace',
          ref: f.source.ref,
          revision,
          openNamespace: vi.fn(async () => {
            throw new Error('Must not open')
          }),
        },
      },
    })
    expect(await f.port.resolve(requirement)).toMatchObject({
      state: 'unresolved',
      reason: 'scope-unsupported',
    })
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('aborts pending resolution with cleanup and refuses provenance after disposal', async () => {
    const f = fixture(),
      pending = deferred<ResourceResolution>(),
      controller = new AbortController()
    const resolution = await f.resolve()
    f.resolve.mockReturnValue(pending.promise)
    const running = f.port.resolve(requirement, controller.signal)
    controller.abort()
    pending.complete(resolution)
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(await f.port.provenance()).toEqual([provenance])
    f.state.live = false
    await expect(f.port.provenance()).rejects.toThrow('live readable')
  })
})

async function rpcPort(port: LogicalResourcePort) {
  const listeners = [new Set<(frame: unknown) => void>(), new Set<(frame: unknown) => void>()]
  const transport = (side: 0 | 1): FramePort => ({
    post(frame, transfer) {
      const copy = structuredClone(frame, { transfer: [...transfer] })
      queueMicrotask(() => {
        for (const listener of listeners[side === 0 ? 1 : 0] ?? []) listener(copy)
      })
    },
    onFrame(listener) {
      listeners[side]?.add(listener)
      return () => {
        listeners[side]?.delete(listener)
      }
    },
  })
  const surfaces = createSurfaceRegistry(RUNTIME_ABI_SURFACES)
  const host = createEndpoint({
    role: 'host',
    port: transport(0),
    session: 'logical',
    generation: 1,
    surfaces,
  })
  const worker = createEndpoint({
    role: 'worker',
    port: transport(1),
    session: 'logical',
    generation: 1,
    surfaces,
    loader: async () => ({ module: wireLogicalResources(port), surface: ABI_LOGICAL_RESOURCES }),
  })
  const loaded = await host.load({
    moduleUrl: 'memory:logical',
    contributionId: 'org.example/logical',
    variantId: 'test',
    artifactDigest: 'sha256:test',
  })
  return {
    port: logicalResourcesFromWire(
      host.materialize(loaded.root) as unknown as WireLogicalResourcePort,
    ),
    close: async () => {
      await host.close('done')
      await worker.peerClosed('done')
    },
  }
}

describe('logical resource RPC lease boundary', () => {
  it('transports a complete bounded batch as values and keeps its leases in the host', async () => {
    const f = fixture({ maxScalarBytes: 1024 }),
      rpc = await rpcPort(f.port)
    try {
      const batch = await rpc.port.readBatch({
        items: [{ requirement, expectedRevision: revision, size: 4n }],
        concurrency: 4,
        readTimeoutMs: 1000,
        totalTimeoutMs: 2000,
        maxBytes: 4n,
      })
      expect(batch).toEqual({
        state: 'complete',
        bytes: 4n,
        items: [{ state: 'read', bytes: f.bytes, revision, provenance }],
      })
      expect(f.release).toHaveBeenCalledTimes(1)
      expect(batch).not.toHaveProperty('lease')
    } finally {
      await rpc.close()
    }
  })
  it('serializes discovery, resolved byte leases, streaming and provenance using ABI surfaces', async () => {
    const f = fixture(),
      rpc = await rpcPort(f.port)
    try {
      expect(await rpc.port.discover(request)).toEqual(complete())
      const r = await rpc.port.resolve(requirement)
      if (r.state !== 'resolved' || r.lease.value.kind !== 'bytes') throw new Error('No byte lease')
      expect(await r.lease.value.read(1n, 2)).toEqual(new Uint8Array([22, 33]))
      const chunks: Uint8Array[] = []
      for await (const chunk of r.lease.value.stream()) chunks.push(chunk)
      expect(chunks).toEqual([f.bytes])
      expect(await rpc.port.provenance()).toEqual([provenance])
      await r.lease.release()
      await r.lease.release()
      expect(f.release).toHaveBeenCalledTimes(1)
      expect(rpc.port).not.toHaveProperty('dispose')
    } finally {
      await rpc.close()
    }
  })
  it('serializes an unresolved result without opening a source and releases forgotten resolved leases at endpoint close', async () => {
    const f = fixture(),
      rpc = await rpcPort(f.port)
    f.state.live = false
    expect(await rpc.port.resolve(requirement)).toMatchObject({
      state: 'unresolved',
      reason: 'session-disposed',
    })
    expect(f.release).not.toHaveBeenCalled()
    f.state.live = true
    expect(await rpc.port.resolve(requirement)).toMatchObject({ state: 'resolved' })
    await rpc.close()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
})
