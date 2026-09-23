import { expect, it } from 'vitest'
import type { ArtifactByteSource, ResourceSessionPort } from '@modkit/sdk'
import type { OpenSubjectResult } from '../src/subject-open.js'
import { createSubjectModelResources, type ModelResourceProfile } from '../src/model-resources.js'

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
function fixture(
  settings: {
    mutates?: boolean
    cycle?: boolean
    uvmScene?: boolean
    uvmFacets?: boolean
    afterInvoke?: () => void
    omitUnits?: boolean
    cacheable?: boolean
    receiptConfidence?: string
    companionRevision?: string
    evidenceRevision?: string
    companionUsesBinding?: boolean
    units?: number
    beforeInvoke?: (signal?: AbortSignal) => Promise<void>
    beforeUvmOpen?: () => void
    uvmBytes?: Uint8Array
    exportWarning?: boolean
  } = {},
) {
  let nativeClosed = 0,
    uvmClosed = 0,
    released = 0,
    opens = 0,
    invokes = 0,
    nativeSceneReads = 0,
    uvmSceneReads = 0,
    sceneReleased = 0,
    facetReleased = 0
  const owned: (() => Promise<void>)[] = []
  const profiles: ModelResourceProfile[] = []
  const source = {
    kind: 'bytes',
    ref: { id: 'child', uri: 'memory://child' },
    revision: 'child-revision',
    size: 20n,
  } as unknown as ArtifactByteSource
  const textureSource = {
    kind: 'bytes',
    ref: { id: 'texture', uri: 'memory://texture' },
    revision: 'texture-revision',
    size: 4n,
  } as unknown as ArtifactByteSource
  const resources = {
    async resolve(requirement: { logicalId: string }) {
      const texture = requirement.logicalId === 'Assets/Marine_Diffuse.dds'
      return {
        state: 'resolved',
        lease: {
          value: texture ? textureSource : source,
          async release() {
            released++
          },
        },
        revision: texture ? textureSource.revision : source.revision,
        provenance: {
          logicalId: requirement.logicalId,
          requirementId: texture ? 'texture' : 'child',
          role: texture ? 'texture' : 'sidecar',
          state: 'resolved',
          cached: false,
          scopes: ['sibling-directory'],
        },
      }
    },
  } as unknown as ResourceSessionPort
  const syntheticUvmResources = {
    async resolve(requirement: { logicalId: string }) {
      return {
        state: 'unresolved',
        diagnostic: {
          severity: 'warning',
          code: 'test/synthetic-uvm-resource-unavailable',
          message: `synthetic UVM origin cannot resolve ${requirement.logicalId}`,
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
    onProfile: profile => profiles.push(profile),
    ancestors: settings.cycle ? ['child@child-revision'] : ['root@revision'],
    async open(openedSource, path) {
      opens++
      if (path === 'Assets/Marine_Diffuse.dds') {
        expect(openedSource).toBe(textureSource)
        return {
          state: 'opened',
          diagnostics: [],
          descriptor: {
            operations: [],
            dataSources: [{ contract: 'common.view/raster-image-source', major: 1 }],
          },
          session: {
            async dispose() {},
            async dataSource() {
              return {
                value: {
                  async info() {
                    return {
                      width: 1,
                      height: 1,
                      depth: 1,
                      layers: 1,
                      faces: 1,
                      mipLevels: 1,
                      frames: 1,
                      channels: 4,
                      bitDepth: 8,
                      colorSpace: 'srgb',
                      alphaMode: 'straight',
                      orientation: 'top-left',
                      decodedAccess: true,
                    }
                  },
                  async readRegion() {
                    return {
                      width: 1,
                      height: 1,
                      rowStride: 4,
                      pixelFormat: 'rgba8',
                      pixels: Uint8Array.of(20, 40, 60, 255),
                    }
                  },
                },
                async release() {},
              }
            },
          },
        } as unknown as OpenSubjectResult
      }
      if (path === 'Child.uvm') {
        settings.beforeUvmOpen?.()
        expect(openedSource.ref.id).toBe('child#model.export-uvm')
        expect(openedSource.revision).toContain('model.export-uvm')
        const expected = settings.uvmBytes ?? Uint8Array.of(1, 2, 3)
        expect(await openedSource.read(0n, 8)).toEqual(expected.slice(0, 8))
        const streamed: number[] = []
        for await (const chunk of openedSource.stream()) streamed.push(...chunk)
        expect(streamed).toEqual([...expected])
        return {
          state: 'opened',
          diagnostics: [],
          resources: settings.uvmFacets ? syntheticUvmResources : resources,
          descriptor: {
            operations: [],
            ...(settings.uvmFacets
              ? {
                  dataSources: [
                    { contract: 'common.view/model-skeleton-source', major: 1 },
                    { contract: 'common.view/model-animation-source', major: 1 },
                    { contract: 'common.view/model-material-source', major: 1 },
                    { contract: 'common.view/model-resource-refs-source', major: 1 },
                    { contract: 'common.view/model-socket-source', major: 1 },
                  ],
                }
              : {}),
          },
          session: {
            async dispose() {
              uvmClosed++
            },
            async dataSource(contract: string) {
              if (contract === 'common.view/model-skeleton-source') {
                if (!settings.uvmFacets) throw new Error('UVM skeleton unavailable')
                return {
                  value: {
                    async bindings() {
                      return {
                        items: [
                          {
                            partId: 'triangle',
                            boneIndex: 0,
                            boneName: 'root',
                            provenance: 'direct',
                            hierarchyId: 'skin',
                            parentBoneIndex: null,
                            nodeId: 'root',
                            localPose: {
                              translation: [0, 0, 0],
                              rotation: [0, 0, 0, 1],
                              scale: [1, 1, 1],
                            },
                            inverseBindMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                          },
                        ],
                      }
                    },
                  },
                  async release() {
                    facetReleased++
                  },
                }
              }
              if (contract === 'common.view/model-animation-source') {
                if (!settings.uvmFacets) throw new Error('UVM animations unavailable')
                return {
                  value: {
                    async clips() {
                      return {
                        items: [
                          {
                            id: 'idle',
                            name: 'Idle',
                            kind: 'animation',
                            provenance: 'direct',
                            frames: 2,
                            durationSeconds: 1,
                            looping: true,
                            channels: [
                              {
                                target: 'root',
                                kind: 'translation',
                                firstFrame: 0,
                                lastFrame: 1,
                                interpolation: 'linear',
                                samples: [
                                  { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
                                  { frame: 1, timeSeconds: 1, value: [1, 0, 0] },
                                ],
                              },
                            ],
                          },
                        ],
                      }
                    },
                  },
                  async release() {
                    facetReleased++
                  },
                }
              }
              if (contract === 'common.view/model-material-source') {
                if (!settings.uvmFacets) throw new Error('UVM materials unavailable')
                return {
                  value: {
                    async materials() {
                      return { items: [{ id: 'material', name: 'Material' }] }
                    },
                  },
                  async release() {
                    facetReleased++
                  },
                }
              }
              if (contract === 'common.view/model-resource-refs-source') {
                if (!settings.uvmFacets) throw new Error('UVM resources unavailable')
                return {
                  value: {
                    async references() {
                      return {
                        items: [
                          {
                            id: 'Assets/Marine_Diffuse.dds',
                            role: 'texture',
                            provenance: 'reference-only',
                          },
                        ],
                      }
                    },
                  },
                  async release() {
                    facetReleased++
                  },
                }
              }
              if (contract === 'common.view/model-socket-source') {
                if (!settings.uvmFacets) throw new Error('UVM sockets unavailable')
                return {
                  value: {
                    async sockets() {
                      return {
                        items: [
                          {
                            id: 'weapon',
                            nodeId: 'root',
                            role: 'weapon',
                            sourceName: 'Ref_Weapon',
                          },
                        ],
                      }
                    },
                  },
                  async release() {
                    facetReleased++
                  },
                }
              }
              uvmSceneReads++
              if (!settings.uvmScene) throw new Error('UVM scene unavailable')
              return {
                value: {
                  async info() {
                    return {
                      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
                      nodeCount: 1,
                      meshCount: 1,
                    }
                  },
                  async nodes() {
                    return {
                      items: [
                        {
                          id: 'root',
                          childIds: [],
                          meshIds: ['mesh'],
                          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
                        },
                      ],
                    }
                  },
                  async meshes() {
                    return { items: [{ id: 'mesh', primitiveIds: ['triangle'] }] }
                  },
                  async primitive() {
                    return {
                      id: 'triangle',
                      topology: 'triangles',
                      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                    }
                  },
                },
                async release() {
                  sceneReleased++
                },
              }
            },
          },
        } as unknown as OpenSubjectResult
      }
      expect(path).toBe('Child.m3')
      expect(openedSource).toBe(source)
      let disposed = false
      return {
        state: 'opened',
        diagnostics: [],
        resources: {
          ...resources,
          async resolve(...args: Parameters<ResourceSessionPort['resolve']>) {
            if (disposed) throw new Error('native overlay disposed')
            return resources.resolve(...args)
          },
        },
        detectionSelectionText: 'test-model-codec@1',
        lockText: 'test-codec-policy@1',
        descriptor: {
          revision: 'provider-token:native-composition',
          ...(settings.cacheable
            ? {
                interpretation: 'codec',
                origin: { kind: 'single', binding: { id: 'content', revision: source.revision } },
                metadata: [
                  {
                    id: 'uv-projection-receipt',
                    entries: [
                      {
                        key: 'receipt',
                        value: {
                          subjectRevision: 'provider-token:native-composition',
                          confidence: settings.receiptConfidence ?? 'high',
                          companions: [
                            settings.companionUsesBinding
                              ? { state: 'bound', bindingId: 'content' }
                              : {
                                  state: 'bound',
                                  revision: settings.companionRevision ?? 'm3a-v1',
                                },
                          ],
                          evidence: [
                            {
                              kind: 'observed',
                              statement: `sidecar revision ${settings.evidenceRevision ?? 'v1'}`,
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              }
            : {}),
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
            disposed = true
            nativeClosed++
          },
          operations() {
            return {
              async invoke(handler: string, input: unknown, options?: { signal?: AbortSignal }) {
                invokes++
                expect(handler).toBe('convert')
                expect(input).toEqual(
                  settings.omitUnits
                    ? { schemaVersion: 1 }
                    : { schemaVersion: 1, metersPerSourceUnit: settings.units ?? 0.01 },
                )
                await settings.beforeInvoke?.(options?.signal)
                options?.signal?.throwIfAborted()
                settings.afterInvoke?.()
                return {
                  state: 'ok',
                  output: { kind: 'bytes', value: settings.uvmBytes ?? Uint8Array.of(1, 2, 3) },
                  diagnostics: settings.exportWarning
                    ? [{ severity: 'warning', code: 'test/partial', message: 'partial projection' }]
                    : [],
                }
              },
            }
          },
          async dataSource() {
            nativeSceneReads++
            throw new Error('the native session must never provide the world-render scene')
          },
        },
      } as unknown as OpenSubjectResult
    },
  })
  return {
    port,
    state,
    owned,
    profiles,
    source,
    counts: () => ({
      nativeClosed,
      uvmClosed,
      released,
      opens,
      invokes,
      nativeSceneReads,
      uvmSceneReads,
      sceneReleased,
      facetReleased,
    }),
  }
}
it('uses the published read-only conversion and holds its scoped resources until idempotent release', async () => {
  const f = fixture(),
    lease = await f.port.acquire(request)
  expect(lease.value.result).toMatchObject({
    state: 'converted',
    bytes: Uint8Array.of(1, 2, 3),
    sourceKey:
      'child|provider-token:native-composition|model.export-uvm|convert|schemaVersion=1|metersPerSourceUnit=0.01',
  })
  expect(f.state.reservedBytes).toBe(4096)
  const cycle = await lease.value.acquire({ ...request, maxBytes: 1024 })
  expect(cycle.value.result.state).toBe('unresolved')
  expect(cycle.value.result.diagnostics[0]?.message).toContain('cycle')
  expect(f.counts().opens).toBe(2)
  await cycle.release()
  await f.owned[0]!()
  await lease.release()
  expect(f.state.reservedBytes).toBe(0)
  expect(f.counts()).toEqual({
    nativeClosed: 1,
    uvmClosed: 1,
    released: 2,
    opens: 2,
    invokes: 1,
    nativeSceneReads: 0,
    uvmSceneReads: 1,
    sceneReleased: 0,
    facetReleased: 0,
  })
  await expect(lease.value.acquire(request)).resolves.toMatchObject({
    value: { result: { state: 'unresolved' } },
  })
})
it('does not invent physical metres when the source conversion scale is unproven', async () => {
  const f = fixture({ omitUnits: true })
  const lease = await f.port.acquire({
    requirement: request.requirement,
    maxBytes: request.maxBytes,
  })
  expect(lease.value.result).toMatchObject({
    state: 'converted',
    sourceKey:
      'child|provider-token:native-composition|model.export-uvm|convert|schemaVersion=1|metersPerSourceUnit=source-unit',
  })
  await lease.release()
})
it('renders only from the exported and reopened source-free UVM facets', async () => {
  const f = fixture({ uvmScene: true, uvmFacets: true })
  const lease = await f.port.acquire(request)
  const nodes = await lease.value.nodes?.({ limit: 4 })
  expect(nodes).toMatchObject({ items: [{ id: 'root', meshIds: ['mesh'] }] })
  expect(nodes?.items[0]?.transform[12]).toBe(2)
  expect(await lease.value.meshes?.({ limit: 4 })).toEqual({
    items: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  })
  expect(await lease.value.primitive?.('triangle', { maxBytes: 1024 })).toMatchObject({
    topology: 'triangles',
  })
  expect(await lease.value.skeletonBindings?.({ limit: 4 })).toMatchObject({
    items: [{ partId: 'triangle', boneIndex: 0, nodeId: 'root' }],
  })
  expect(await lease.value.animationClips?.({ limit: 4 })).toMatchObject({
    items: [{ id: 'idle', kind: 'animation', channels: [{ target: 'root' }] }],
  })
  expect(await lease.value.materials?.({ limit: 4 })).toEqual({
    items: [{ id: 'material', name: 'Material' }],
  })
  expect(await lease.value.resourceReferences?.({ limit: 4 })).toMatchObject({
    items: [{ id: 'Assets/Marine_Diffuse.dds', role: 'texture' }],
  })
  expect(await lease.value.sockets?.({ limit: 4 })).toMatchObject({
    items: [{ id: 'weapon', nodeId: 'root', role: 'weapon', sourceName: 'Ref_Weapon' }],
  })
  expect(
    await lease.value.readRaster({
      kind: 'logical',
      requirement: {
        id: 'texture',
        logicalId: 'Assets/Marine_Diffuse.dds',
        role: 'texture',
        scopes: ['sibling-directory'],
      },
      maxBytes: 64,
    }),
  ).toMatchObject({
    state: 'decoded',
    region: { pixels: Uint8Array.of(20, 40, 60, 255) },
  })
  expect(f.counts()).toMatchObject({ nativeSceneReads: 0, uvmSceneReads: 1, opens: 3 })
  await lease.release()
  expect(f.counts()).toMatchObject({
    nativeClosed: 1,
    uvmClosed: 1,
    sceneReleased: 1,
    facetReleased: 5,
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
  expect(f.counts()).toMatchObject({ nativeClosed: 1, uvmClosed: 0 })
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
  expect(f.counts()).toMatchObject({ nativeClosed: 5, uvmClosed: 5, opens: 10 })
})

it('queues concurrent conversions behind the shared byte ceiling instead of refusing them transiently', async () => {
  const f = fixture()
  const largeRequest = { ...request, maxBytes: 60_000 }
  const first = await f.port.acquire(largeRequest)
  let secondSettled = false
  const secondPromise = f.port.acquire(largeRequest).then(value => {
    secondSettled = true
    return value
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(secondSettled).toBe(false)
  expect(f.state.reservedBytes).toBe(60_000)
  await first.release()
  const second = await secondPromise
  expect(second.value.result.state).toBe('converted')
  expect(f.state.reservedBytes).toBe(60_000)
  await second.release()
  expect(f.state.reservedBytes).toBe(0)
})

it('cancels a queued conversion without leaking a byte reservation', async () => {
  const f = fixture()
  const largeRequest = { ...request, maxBytes: 60_000 }
  const first = await f.port.acquire(largeRequest)
  const controller = new AbortController()
  const queued = f.port.acquire(largeRequest, controller.signal)
  controller.abort()
  await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.state.reservedBytes).toBe(60_000)
  await first.release()
  expect(f.state.reservedBytes).toBe(0)
})

it('reuses complete UVM bytes but reopens both codecs and keeps fresh native DDS resources', async () => {
  const f = fixture({ cacheable: true, uvmScene: true, uvmFacets: true })
  const first = await f.port.acquire(request)
  expect(first.value.result.state).toBe('converted')
  if (first.value.result.state === 'converted') first.value.result.bytes.fill(99)
  await first.release()
  const second = await f.port.acquire(request)
  expect(second.value.result).toMatchObject({ state: 'converted', bytes: Uint8Array.of(1, 2, 3) })
  expect(await second.value.nodes?.({ limit: 1 })).toMatchObject({ items: [{ id: 'root' }] })
  expect(
    await second.value.readRaster({
      kind: 'logical',
      requirement: {
        id: 'texture',
        logicalId: 'Assets/Marine_Diffuse.dds',
        role: 'texture',
        scopes: ['sibling-directory'],
      },
      maxBytes: 64,
    }),
  ).toMatchObject({ state: 'decoded', region: { pixels: Uint8Array.of(20, 40, 60, 255) } })
  await second.release()
  expect(f.counts()).toMatchObject({
    invokes: 1,
    nativeClosed: 2,
    uvmClosed: 2,
    sceneReleased: 2,
    facetReleased: 10,
  })
  expect(f.profiles.map(profile => [profile.cache, profile.exportInvocations])).toEqual([
    ['miss', 1],
    ['hit', 0],
  ])
  expect(f.profiles[1]?.exportUvmMs).toBe(0)
  for (const profile of f.profiles) {
    for (const [key, value] of Object.entries(profile)) {
      if (key.endsWith('Ms')) expect(value).toBeGreaterThanOrEqual(0)
    }
    expect(profile.totalMs).toBeGreaterThanOrEqual(profile.nativeOpenMs + profile.exportUvmMs)
  }
  expect(f.state.reservedBytes).toBeGreaterThan(0)
  await f.owned[0]!()
  expect(f.state.reservedBytes).toBe(0)
  expect((await f.port.acquire(request)).value.result.state).toBe('unresolved')
})

it('misses when source revision, companion receipt, evidence or units change and isolates subject ports', async () => {
  const settings = {
    cacheable: true,
    uvmScene: true,
    companionRevision: 'm3a-v1',
    evidenceRevision: 'v1',
    units: 0.01,
  }
  const f = fixture(settings)
  const acquireAndRelease = async () => {
    const lease = await f.port.acquire({ ...request, metersPerSourceUnit: settings.units })
    expect(lease.value.result.state).toBe('converted')
    await lease.release()
  }
  await acquireAndRelease()
  Object.assign(f.source, { revision: 'changed-native-revision' })
  await acquireAndRelease()
  settings.companionRevision = 'm3a-v2'
  await acquireAndRelease()
  settings.units = 0.02
  await acquireAndRelease()
  settings.evidenceRevision = 'v2'
  await acquireAndRelease()
  await acquireAndRelease()
  expect(f.counts().invokes).toBe(5)
  const other = fixture({ cacheable: true, uvmScene: true })
  const lease = await other.port.acquire(request)
  expect(other.counts().invokes).toBe(1)
  await lease.release()
  await f.owned[0]!()
  await other.owned[0]!()
})

it('uses origin binding revisions and clears cached projections when the resource scope changes', async () => {
  const f = fixture({ cacheable: true, uvmScene: true, companionUsesBinding: true })
  await (await f.port.acquire(request)).release()
  await (await f.port.acquire(request)).release()
  expect(f.counts().invokes).toBe(1)
  f.state.resources = { ...f.state.resources }
  await (await f.port.acquire(request)).release()
  expect(f.counts().invokes).toBe(2)
  await f.owned[0]!()
  expect(f.state.reservedBytes).toBe(0)
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0))

it('single-flights equivalent concurrent exports with independent live leases', async () => {
  const started = deferred(),
    unblock = deferred()
  const f = fixture({
    cacheable: true,
    uvmScene: true,
    beforeInvoke: async () => {
      started.resolve()
      await unblock.promise
    },
  })
  const first = f.port.acquire(request)
  await started.promise
  const second = f.port.acquire(request)
  await nextTurn()
  expect(f.counts().invokes).toBe(1)
  unblock.resolve()
  const leases = await Promise.all([first, second])
  expect(leases.map(lease => lease.value.result.state)).toEqual(['converted', 'converted'])
  expect(f.profiles.map(profile => profile.cache)).toEqual(['miss', 'shared-hit'])
  await leases[0]!.release()
  expect(await leases[1]!.value.nodes?.({ limit: 1 })).toMatchObject({ items: [{ id: 'root' }] })
  await leases[1]!.release()
  await f.owned[0]!()
  expect(f.counts()).toMatchObject({ invokes: 1, nativeClosed: 2, uvmClosed: 2 })
  expect(f.state.reservedBytes).toBe(0)
})

it.each(['leader', 'waiter'])(
  'canceling the %s does not cancel the other consumer or poison reuse',
  async canceled => {
    const started = deferred(),
      unblock = deferred(),
      abort = new AbortController()
    let conversions = 0
    const f = fixture({
      cacheable: true,
      uvmScene: true,
      beforeInvoke: async () => {
        if (++conversions === 1) {
          started.resolve()
          await unblock.promise
        }
      },
    })
    const leader = f.port.acquire(request, canceled === 'leader' ? abort.signal : undefined)
    await started.promise
    const waiter = f.port.acquire(request, canceled === 'waiter' ? abort.signal : undefined)
    await nextTurn()
    const rejected = expect(canceled === 'leader' ? leader : waiter).rejects.toMatchObject({
      name: 'AbortError',
    })
    abort.abort()
    unblock.resolve()
    await rejected
    const survivor = await (canceled === 'leader' ? waiter : leader)
    expect(survivor.value.result.state).toBe('converted')
    await survivor.release()
    const again = await f.port.acquire(request)
    expect(again.value.result.state).toBe('converted')
    expect(f.counts().invokes).toBe(canceled === 'leader' ? 2 : 1)
    await again.release()
    await f.owned[0]!()
    expect(f.state.reservedBytes).toBe(0)
  },
)

it('caches deterministic partial projections but not warned exports or unrenderable UVM', async () => {
  const partial = fixture({ cacheable: true, uvmScene: true, receiptConfidence: 'partial' })
  for (let i = 0; i < 2; i++) await (await partial.port.acquire(request)).release()
  expect(partial.counts().invokes).toBe(1)
  await partial.owned[0]!()
  for (const overrides of [{ exportWarning: true }, { uvmScene: false }]) {
    const f = fixture({ cacheable: true, uvmScene: true, ...overrides })
    for (let i = 0; i < 2; i++) await (await f.port.acquire(request)).release()
    expect(f.counts().invokes).toBe(2)
    expect(f.state.reservedBytes).toBe(0)
    await f.owned[0]!()
  }
  let attempts = 0
  const f = fixture({
    cacheable: true,
    uvmScene: true,
    beforeInvoke: async () => {
      if (++attempts === 1) throw new Error('temporary export failure')
    },
  })
  const first = await f.port.acquire(request)
  expect(first.value.result.state).toBe('unresolved')
  const second = await f.port.acquire(request)
  expect(second.value.result.state).toBe('converted')
  await second.release()
  await (await f.port.acquire(request)).release()
  expect(f.counts().invokes).toBe(2)
  await f.owned[0]!()
  expect(f.state.reservedBytes).toBe(0)
})

it('bounds retained bytes, evicts for new reservations and checks maxBytes again on a cache hit', async () => {
  const f = fixture({ cacheable: true, uvmScene: true })
  for (let i = 0; i < 20; i++) {
    Object.assign(f.source, { revision: `revision-${i}` })
    await (await f.port.acquire(request)).release()
    expect(f.state.reservedBytes).toBeLessThanOrEqual(budget.maxScalarBytes / 8)
  }
  Object.assign(f.source, { revision: 'revision-0' })
  await (await f.port.acquire(request)).release()
  expect(f.counts().invokes).toBe(21)
  const tooSmall = await f.port.acquire({ ...request, maxBytes: 2 })
  expect(tooSmall.value.result.state).toBe('unresolved')
  expect(f.counts().invokes).toBe(21)
  const entireBudget = await f.port.acquire({ ...request, maxBytes: budget.maxScalarBytes })
  expect(entireBudget.value.result.state).toBe('converted')
  expect(f.state.reservedBytes).toBe(budget.maxScalarBytes)
  await entireBudget.release()
  expect(f.state.reservedBytes).toBe(0)
  await f.owned[0]!()
})

it('rechecks authority and cancellation after reopening a cached UVM', async () => {
  for (const revoke of [false, true]) {
    const settings: Parameters<typeof fixture>[0] = { cacheable: true, uvmScene: true }
    const f = fixture(settings),
      abort = new AbortController()
    await (await f.port.acquire(request)).release()
    settings.beforeUvmOpen = () => {
      if (revoke) f.state.live = false
      else abort.abort()
    }
    const acquisition = f.port.acquire(request, abort.signal)
    if (revoke) expect((await acquisition).value.result.state).toBe('unresolved')
    else await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.counts().invokes).toBe(1)
    await f.owned[0]!()
    expect(f.state.reservedBytes).toBe(0)
    expect(f.counts()).toMatchObject({ nativeClosed: 2, uvmClosed: 2 })
  }
})

it('disposes a subject during single-flight work without retaining its completed bytes', async () => {
  const started = deferred(),
    unblock = deferred()
  const f = fixture({
    cacheable: true,
    uvmScene: true,
    beforeInvoke: async () => {
      started.resolve()
      await unblock.promise
    },
  })
  const first = f.port.acquire(request)
  await started.promise
  const second = f.port.acquire(request)
  await nextTurn()
  await f.owned[0]!()
  expect((await second).value.result.state).toBe('unresolved')
  unblock.resolve()
  const leases = await Promise.all([first, second])
  expect(leases.map(lease => lease.value.result.state)).toEqual(['unresolved', 'unresolved'])
  expect(f.counts()).toMatchObject({ invokes: 1, nativeClosed: 2 })
  expect(f.state.reservedBytes).toBe(0)
})
