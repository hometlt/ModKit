import { expect, it } from 'vitest'
import type { ArtifactByteSource, ResourceSessionPort } from '@modkit/sdk'
import type { OpenSubjectResult } from '../src/subject-open.js'
import { createSubjectModelResources } from '../src/model-resources.js'

const budget = {
  maxInputBytes: 100000n,
  maxScalarBytes: 100000,
  maxDepth: 16,
  maxNodes: 1000,
  maxDiagnostics: 30,
}
const request = {
  requirement: {
    id: 'child',
    logicalId: 'Child.m3',
    role: 'sidecar' as const,
    scopes: ['sibling-directory'] as const,
  },
  maxBytes: 4096,
  metersPerSourceUnit: 0.01,
}
function fixture(settings: { mutates?: boolean; cycle?: boolean; afterInvoke?: () => void } = {}) {
  let closed = 0,
    released = 0,
    opens = 0,
    invokes = 0
  const owned: (() => Promise<void>)[] = []
  const source = {
    kind: 'bytes',
    ref: { id: 'child', uri: 'memory://child' },
    revision: 'child-revision',
    size: 20n,
  } as unknown as ArtifactByteSource
  const resources = {
    async resolve() {
      return {
        state: 'resolved',
        lease: {
          value: source,
          async release() {
            released++
          },
        },
        revision: source.revision,
        provenance: {
          logicalId: 'Child.m3',
          requirementId: 'child',
          role: 'sidecar',
          state: 'resolved',
          cached: false,
          scopes: ['sibling-directory'],
        },
      }
    },
  } as unknown as ResourceSessionPort
  const state = { live: true, reservedBytes: 0, resources }
  const port = createSubjectModelResources({
    state,
    budget,
    isAuthorized: () => state.live,
    own: release => owned.push(release),
    ancestors: settings.cycle ? ['child@child-revision'] : ['root@revision'],
    async open(_source, path) {
      opens++
      expect(path).toBe('Child.m3')
      return {
        state: 'opened',
        diagnostics: [],
        resources,
        descriptor: {
          operations: [
            {
              id: 'model.export-uvm',
              handlerId: 'convert',
              state: 'available',
              mutatesSource: settings.mutates ?? false,
            },
          ],
        },
        session: {
          async dispose() {
            closed++
          },
          operations() {
            return {
              async invoke(handler: string, input: unknown) {
                invokes++
                expect(handler).toBe('convert')
                expect(input).toEqual({ schemaVersion: 1, metersPerSourceUnit: 0.01 })
                settings.afterInvoke?.()
                return {
                  state: 'ok',
                  output: { kind: 'bytes', value: Uint8Array.of(1, 2, 3) },
                  diagnostics: [],
                }
              },
            }
          },
        },
      } as unknown as OpenSubjectResult
    },
  })
  return { port, state, owned, counts: () => ({ closed, released, opens, invokes }) }
}
it('uses the published read-only conversion and holds its scoped resources until idempotent release', async () => {
  const f = fixture(),
    lease = await f.port.acquire(request)
  expect(lease.value.result).toMatchObject({
    state: 'converted',
    bytes: Uint8Array.of(1, 2, 3),
    sourceKey: 'child@child-revision',
  })
  expect(f.state.reservedBytes).toBe(4096)
  const cycle = await lease.value.acquire({ ...request, maxBytes: 1024 })
  expect(cycle.value.result.state).toBe('unresolved')
  expect(cycle.value.result.diagnostics[0]?.message).toContain('cycle')
  expect(f.counts().opens).toBe(1)
  await cycle.release()
  await f.owned[0]!()
  await lease.release()
  expect(f.state.reservedBytes).toBe(0)
  expect(f.counts()).toEqual({ closed: 1, released: 2, opens: 1, invokes: 1 })
  await expect(lease.value.acquire(request)).resolves.toMatchObject({
    value: { result: { state: 'unresolved' } },
  })
})
it('never invokes mutating exports or opens cyclic resources and releases refusal paths', async () => {
  for (const settings of [{ mutates: true }, { cycle: true }]) {
    const f = fixture(settings),
      lease = await f.port.acquire(request)
    expect(lease.value.result.state).toBe('unresolved')
    expect(f.counts().invokes).toBe(0)
    expect(f.state.reservedBytes).toBe(0)
    expect(f.counts().released).toBe(1)
  }
})
it('cancellation after conversion closes the child and returns every reservation', async () => {
  const controller = new AbortController(),
    f = fixture({ afterInvoke: () => controller.abort() })
  await expect(f.port.acquire(request, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(f.state.reservedBytes).toBe(0)
  expect(f.counts().closed).toBe(1)
  expect(f.counts().released).toBe(1)
})

it('repeated frames keep one parent cleanup registration instead of retaining released child sessions', async () => {
  const f = fixture()
  for (let frame = 0; frame < 5; frame++) {
    const lease = await f.port.acquire(request)
    expect(lease.value.result.state).toBe('converted')
    await lease.release()
  }
  expect(f.owned).toHaveLength(1)
  expect(f.state.reservedBytes).toBe(0)
  expect(f.counts().closed).toBe(5)
})
