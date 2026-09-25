import { describe, expect, it } from 'vitest'
import { diagnostic } from '@modkit/core'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneSource,
  WorldSceneLayerItem,
  WorldScenePage,
  WorldScenePageRequest,
} from '@modkit/sdk/maps'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkit/sdk/maps'
import type { TransportSource } from '@modkit/sdk'
import {
  createWorldEditState,
  commitWorldObjectMove,
  drawCandidateWorld,
  inspectCandidateWorld,
  pickWorldObject,
  previewWorldObjectMove,
  rejectWorldObjectMove,
  selectWorldObject,
  watchTransportedWorld,
  worldModelAssetStatus,
} from '@modkit/ui/world'

const contract = 'example.publisher/world-source'
const snapshotId = 'example-snapshot'
const layer: WorldSceneLayerItem = Object.freeze({
  facet: 'layers',
  id: 'layer:objects',
  layerId: 'layer:objects',
  kind: 'objects',
  state: 'available',
  itemCount: 1,
  lods: Object.freeze(['exact']),
})
const info: CandidateWorldSceneInfo = Object.freeze({
  contract,
  major: 1,
  maturity: 'publisher-candidate',
  snapshotId,
  mapId: 'example-world',
  coordinateSpaces: Object.freeze([
    Object.freeze({
      id: 'native',
      horizontalAxes: Object.freeze(['east', 'north'] as const),
      verticalAxis: 'up',
      handedness: 'publisher-native',
      linearUnit: 'publisher-unit',
      rotationUnit: 'publisher-angle',
      origin: 'publisher-origin',
    }),
  ]),
  crossSpaceTransforms: Object.freeze([]),
  bounds: Object.freeze([
    Object.freeze({
      facet: 'objects',
      coordinateSpaceId: 'native',
      x: Object.freeze({ state: 'known', minimum: 0, maximum: 1 }),
      y: Object.freeze({ state: 'known', minimum: 0, maximum: 1 }),
      z: Object.freeze({ state: 'known', minimum: 0, maximum: 1 }),
    }),
  ]),
  facets: Object.freeze([
    Object.freeze({
      facet: 'objects',
      layerId: layer.layerId,
      state: 'available',
      itemCount: 1,
      lods: Object.freeze(['exact']),
    }),
  ]),
  provenance: Object.freeze([]),
  unknownFacets: Object.freeze(['lighting']),
  lossPolicy: 'explicit-partial',
  complete: true,
})

describe('generic publisher-candidate world harness', () => {
  it('refreshes a dynamic world for transport snapshots only', async () => {
    const snapshot = {
      state: 'paused' as const,
      positionMs: 0,
      durationMs: 1000,
      rate: 1,
      seekable: true,
      live: false,
      tracks: [],
      controls: {},
    }
    const transport: TransportSource = {
      async snapshot() {
        return snapshot
      },
      async *events() {
        yield { kind: 'snapshot', snapshot }
        yield {
          kind: 'diagnostic',
          diagnostic: {
            id: 'test-diagnostic',
            code: 'test/diagnostic',
            category: 'structure',
            severity: 'information',
            message: 'ignored by the world refresh binding',
          },
        }
        yield { kind: 'snapshot', snapshot: { ...snapshot, positionMs: 500 } }
      },
    }
    let refreshes = 0
    await watchTransportedWorld(transport, async () => {
      refreshes += 1
    })
    expect(refreshes).toBe(2)
  })

  it('consumes an arbitrary publisher structurally with bounded layer/item requests', async () => {
    const requests: unknown[] = []
    const source: CandidateWorldSceneSource = Object.freeze({
      contract,
      major: 1,
      snapshotId,
      info: () => Promise.resolve(info),
      page(request: WorldScenePageRequest): Promise<WorldScenePage> {
        requests.push(request)
        return Promise.resolve(
          request.facet === 'layers'
            ? Object.freeze({
                snapshotId,
                facet: 'layers',
                state: 'available',
                items: Object.freeze([layer]),
              })
            : Object.freeze({
                snapshotId,
                facet: request.facet,
                state: 'available',
                items: Object.freeze([
                  Object.freeze({
                    facet: 'objects' as const,
                    id: 'object:1',
                    layerId: layer.layerId,
                    coordinateSpaceId: 'native',
                    kind: 'point' as const,
                    objectId: 1,
                    position: Object.freeze({ x: 0, y: 0, z: 0 }),
                  }),
                ]),
              }),
        )
      },
    })
    const model = await inspectCandidateWorld(source, { maxLayers: 2, maxItemsPerLayer: 3 })
    expect(model).toMatchObject({ contract, snapshotId })
    expect(model.layers[0]?.page.items[0]).toMatchObject({ facet: 'objects', objectId: 1 })
    expect(requests).toEqual([
      { facet: 'layers', limit: 2 },
      { facet: 'objects', layerId: 'layer:objects', lod: 'exact', limit: 3 },
    ])
  })

  it('drains bounded layer pages independently from the retained item budget', async () => {
    const pagedLayer = Object.freeze({ ...layer, itemCount: 5 })
    const limits: number[] = []
    const source: CandidateWorldSceneSource = Object.freeze({
      contract,
      major: 1,
      snapshotId,
      info: () => Promise.resolve(info),
      page(request: WorldScenePageRequest): Promise<WorldScenePage> {
        if (request.facet === 'layers') {
          return Promise.resolve(
            Object.freeze({
              snapshotId,
              facet: 'layers',
              state: 'available',
              items: Object.freeze([pagedLayer]),
            }),
          )
        }
        limits.push(request.limit)
        const offset = request.cursor === undefined ? 0 : Number(request.cursor)
        const end = Math.min(5, offset + request.limit)
        return Promise.resolve(
          Object.freeze({
            snapshotId,
            facet: 'objects',
            state: 'available',
            items: Object.freeze(
              Array.from({ length: end - offset }, (_, index) => {
                const objectId = offset + index
                return Object.freeze({
                  facet: 'objects' as const,
                  id: `object:${String(objectId)}`,
                  layerId: layer.layerId,
                  coordinateSpaceId: 'native',
                  kind: 'point' as const,
                  objectId,
                  position: Object.freeze({ x: objectId, y: 0, z: 0 }),
                })
              }),
            ),
            ...(end === 5 ? {} : { nextCursor: String(end) }),
          }),
        )
      },
    })
    const model = await inspectCandidateWorld(source, {
      maxLayers: 2,
      maxItemsPerLayer: 5,
      maxPageItems: 2,
    })
    expect(limits).toEqual([2, 2, 1])
    expect(model.layers[0]?.page.items.map(item => item.id)).toEqual([
      'object:0',
      'object:1',
      'object:2',
      'object:3',
      'object:4',
    ])
    expect(model.layers[0]?.page.nextCursor).toBeUndefined()
  })

  it('rejects identity drift and cancellation before paging', async () => {
    const mismatched: CandidateWorldSceneSource = {
      contract,
      major: 1,
      snapshotId: 'stale-snapshot',
      info: () => Promise.resolve(info),
      page: () => Promise.reject(new Error('must not page')),
    }
    await expect(
      inspectCandidateWorld(mismatched, { maxLayers: 1, maxItemsPerLayer: 1 }),
    ).rejects.toThrow(/identity changed/u)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(
      inspectCandidateWorld(mismatched, {
        maxLayers: 1,
        maxItemsPerLayer: 1,
        signal: cancelled.signal,
      }),
    ).rejects.toThrow()
  })

  it('acquires a joined model once through the bounded world model route', async () => {
    const resourceLayer = {
      facet: 'layers' as const,
      id: 'layer:resources',
      layerId: 'layer:resources',
      kind: 'resources' as const,
      state: 'available' as const,
      itemCount: 1,
      lods: ['exact'] as const,
    }
    const resourceInfo = {
      ...info,
      facets: [
        ...info.facets,
        {
          facet: 'resources' as const,
          layerId: resourceLayer.layerId,
          state: 'available' as const,
          itemCount: 1,
          lods: ['exact'] as const,
        },
      ],
    }
    let acquisitions = 0
    const source: CandidateWorldSceneSource = {
      contract,
      major: 1,
      snapshotId,
      info: async () => resourceInfo,
      async page(request) {
        if (request.facet === 'layers')
          return { snapshotId, facet: 'layers', state: 'available', items: [layer, resourceLayer] }
        if (request.facet === 'resources')
          return {
            snapshotId,
            facet: 'resources',
            state: 'available',
            items: [
              {
                facet: 'resources',
                id: 'resource:marine',
                layerId: resourceLayer.layerId,
                namespace: 'Unit',
                entityId: 'Marine',
                resolved: true,
                objectIds: ['object:1'],
                modelResource: {
                  id: 'marine',
                  logicalId: 'Assets/Marine.m3',
                  role: 'sidecar',
                  scopes: ['current-mount'],
                },
              },
            ],
          }
        return {
          snapshotId,
          facet: 'objects',
          state: 'available',
          items: [
            {
              facet: 'objects',
              id: 'object:1',
              layerId: layer.layerId,
              coordinateSpaceId: 'map-native',
              kind: 'unit',
              objectId: 1,
              resourceId: 'resource:marine',
              position: { x: 0, y: 0, z: 0 },
            },
          ],
        }
      },
      async model() {
        acquisitions += 1
        return {
          state: 'converted',
          sourceKey: 'marine',
          meshes: [{ id: 'mesh', primitiveIds: ['p'] }],
          primitives: [
            {
              id: 'p',
              topology: 'triangles',
              positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            },
          ],
          diagnostics: [],
          complete: true,
        }
      },
    }
    const model = await inspectCandidateWorld(source, { maxLayers: 4, maxItemsPerLayer: 8 })
    expect(model.models?.get('resource:marine')).toMatchObject({
      state: 'converted',
      sourceKey: 'marine',
    })
    expect(acquisitions).toBe(1)
  })

  it('reuses models only inside the same snapshot and exact bounded acquisition profile', async () => {
    let acquisitions = 0
    const source = (nextSnapshotId: string): CandidateWorldSceneSource => {
      const resourceLayer: WorldSceneLayerItem = {
        facet: 'layers',
        id: `${nextSnapshotId}:resources`,
        layerId: `${nextSnapshotId}:resources`,
        kind: 'resources',
        state: 'available',
        itemCount: 1,
        lods: ['exact'],
      }
      return {
        contract,
        major: 1,
        snapshotId: nextSnapshotId,
        info: async () => ({ ...info, snapshotId: nextSnapshotId }),
        async page(request) {
          if (request.facet === 'layers') {
            return {
              snapshotId: nextSnapshotId,
              facet: 'layers',
              state: 'available',
              items: [resourceLayer],
            }
          }
          return {
            snapshotId: nextSnapshotId,
            facet: 'resources',
            state: 'available',
            items: [
              {
                facet: 'resources',
                id: 'resource:marine',
                layerId: resourceLayer.layerId,
                namespace: 'Unit',
                entityId: 'Marine',
                resolved: true,
                objectIds: [],
                modelResource: {
                  id: 'marine',
                  logicalId: 'Assets/Marine.m3',
                  role: 'sidecar',
                  scopes: ['current-mount'],
                },
              },
            ],
          }
        },
        async model() {
          acquisitions += 1
          return {
            state: 'converted',
            sourceKey: `${nextSnapshotId}:model-revision`,
            meshes: [],
            primitives: [],
            diagnostics: [],
            complete: true,
          }
        },
      }
    }
    const firstSource = source('snapshot-a')
    const first = await inspectCandidateWorld(firstSource, {
      maxLayers: 2,
      maxItemsPerLayer: 4,
      maxModelBytes: 1024,
    })
    const reused = await inspectCandidateWorld(firstSource, {
      maxLayers: 2,
      maxItemsPerLayer: 4,
      maxModelBytes: 1024,
      previous: first,
    })
    expect(reused.models?.get('resource:marine')).toBe(first.models?.get('resource:marine'))
    expect(acquisitions).toBe(1)
    expect(first.loadPerformance).toMatchObject({
      coldStart: true,
      layerPageRequests: 1,
      modelRequests: 1,
      reusedModels: 0,
    })
    expect(reused.loadPerformance).toMatchObject({
      coldStart: false,
      layerPageRequests: 1,
      modelRequests: 0,
      reusedModels: 1,
    })
    expect(
      [
        first.loadPerformance.infoMilliseconds,
        first.loadPerformance.layerCatalogMilliseconds,
        first.loadPerformance.layerAcquisitionMilliseconds,
        first.loadPerformance.modelAcquisitionMilliseconds,
        first.loadPerformance.terrainTextureAcquisitionMilliseconds,
        first.loadPerformance.totalMilliseconds,
      ].every(value => Number.isFinite(value) && value >= 0),
    ).toBe(true)

    const changed = await inspectCandidateWorld(source('snapshot-b'), {
      maxLayers: 2,
      maxItemsPerLayer: 4,
      maxModelBytes: 1024,
      previous: reused,
    })
    expect(changed.models?.get('resource:marine')).toMatchObject({
      state: 'converted',
      sourceKey: 'snapshot-b:model-revision',
    })
    expect(acquisitions).toBe(2)

    await inspectCandidateWorld(firstSource, {
      maxLayers: 2,
      maxItemsPerLayer: 4,
      maxModelBytes: 2048,
      previous: first,
    })
    expect(acquisitions).toBe(3)
  })

  it('bounds per-model bytes, acquisition concurrency and resource count', async () => {
    const resourceLayer: WorldSceneLayerItem = {
      facet: 'layers',
      id: 'resources',
      layerId: 'resources',
      kind: 'resources',
      state: 'available',
      itemCount: 3,
      lods: ['exact'],
    }
    let active = 0
    let maximumActive = 0
    const requestedBytes: number[] = []
    const requestedIds: string[] = []
    const source: CandidateWorldSceneSource = {
      contract,
      major: 1,
      snapshotId,
      info: async () => info,
      async page(request) {
        if (request.facet === 'layers') {
          return { snapshotId, facet: 'layers', state: 'available', items: [resourceLayer] }
        }
        return {
          snapshotId,
          facet: 'resources',
          state: 'available',
          items: ['a', 'b', 'c'].map(id => ({
            facet: 'resources' as const,
            id,
            layerId: resourceLayer.layerId,
            namespace: 'Model',
            entityId: id,
            resolved: true,
            objectIds: Array.from(
              { length: id === 'a' ? 1 : id === 'b' ? 3 : 2 },
              (_, index) => `${id}:${String(index)}`,
            ),
            modelResource: {
              id,
              logicalId: `${id}.m3`,
              role: 'sidecar' as const,
              scopes: ['current-mount'] as const,
            },
          })),
        }
      },
      async model(resourceId, request) {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        requestedIds.push(resourceId)
        requestedBytes.push(request.maxBytes)
        await Promise.resolve()
        active -= 1
        return {
          state: 'converted',
          sourceKey: 'revision',
          meshes: [],
          primitives: [],
          diagnostics: [],
          complete: true,
        }
      },
    }
    const bounded = await inspectCandidateWorld(source, {
      maxLayers: 2,
      maxItemsPerLayer: 4,
      maxModels: 2,
      maxModelBytes: 100,
      maxConcurrentModelAcquisitions: 1,
    })
    expect(requestedIds).toEqual(['b', 'c'])
    // A model is never asked for more than the whole budget.
    expect(requestedBytes).toEqual([100, 100])
    expect(maximumActive).toBe(1)
    expect(bounded.models?.get('a')).toMatchObject({ state: 'unresolved' })
    expect(bounded.models?.get('a')?.diagnostics[0]?.code).toBe(
      'x3.ui/world-model-budget-exhausted',
    )
  })

  it('does not admit a socket-only child ahead of a model that can be placed on its own', async () => {
    const resourceLayer: WorldSceneLayerItem = {
      facet: 'layers',
      id: 'resources',
      layerId: 'resources',
      kind: 'resources',
      state: 'available',
      itemCount: 2,
      lods: ['exact'],
    }
    const requestedIds: string[] = []
    const source: CandidateWorldSceneSource = {
      contract,
      major: 1,
      snapshotId,
      info: async () => info,
      async page(request) {
        if (request.facet === 'layers') {
          return { snapshotId, facet: 'layers', state: 'available', items: [layer, resourceLayer] }
        }
        if (request.facet === 'objects') {
          return {
            snapshotId,
            facet: 'objects',
            state: 'available',
            // The child is attached to more objects than the parent, yet cannot be drawn without it.
            items: ['1', '2', '3'].map(id => ({
              facet: 'objects' as const,
              id: `object:${id}`,
              layerId: layer.layerId,
              coordinateSpaceId: 'map-native',
              kind: 'structure',
              objectId: Number(id),
              position: { x: 0, y: 0, z: 0 },
              resourceIds: id === '1' ? ['body', 'tool'] : ['tool'],
              modelComponents: [
                ...(id === '1' ? [{ id: 'body-instance', resourceId: 'body' }] : []),
                {
                  id: 'tool-instance',
                  resourceId: 'tool',
                  parentId: 'body-instance',
                  parentSocketId: 'connector-1',
                },
              ],
            })),
          }
        }
        return {
          snapshotId,
          facet: 'resources',
          state: 'available',
          items: ['body', 'tool'].map(id => ({
            facet: 'resources' as const,
            id,
            layerId: resourceLayer.layerId,
            namespace: 'Model',
            entityId: id,
            resolved: true,
            objectIds: id === 'body' ? ['object:1'] : ['object:1', 'object:2', 'object:3'],
            modelResource: {
              id,
              logicalId: `${id}.m3`,
              role: 'sidecar' as const,
              scopes: ['current-mount'] as const,
            },
          })),
        }
      },
      async model(resourceId) {
        requestedIds.push(resourceId)
        return {
          state: 'converted',
          sourceKey: 'revision',
          meshes: [],
          primitives: [],
          diagnostics: [],
          complete: true,
        }
      },
    }
    await inspectCandidateWorld(source, { maxLayers: 2, maxItemsPerLayer: 8, maxModels: 1 })
    expect(requestedIds).toEqual(['body'])
  })

  it('loads every model; past the byte budget only their textures shrink', async () => {
    // A count of 64 left Amphion's doodads unloaded; a budget that left models out dropped half of
    // them across VS Code's webview channel, where shared textures arrive once per model.
    const ids = Array.from({ length: 100 }, (_, index) => `m${String(index).padStart(3, '0')}`)
    const resourceLayer: WorldSceneLayerItem = {
      facet: 'layers', id: 'resources', layerId: 'resources', kind: 'resources',
      state: 'available', itemCount: ids.length, lods: ['exact'],
    }
    const shared = new Uint8Array(1024 * 1024)
    const textureBudgets: number[] = []
    const source: CandidateWorldSceneSource = {
      contract,
      major: 1,
      snapshotId,
      info: async () => info,
      async page(request) {
        if (request.facet === 'layers') {
          return { snapshotId, facet: 'layers', state: 'available', items: [resourceLayer] }
        }
        return {
          snapshotId, facet: 'resources', state: 'available',
          items: ids.map(id => ({
            facet: 'resources' as const, id, layerId: resourceLayer.layerId, namespace: 'Model',
            entityId: id, resolved: true, objectIds: [`${id}:0`],
            modelResource: { id, logicalId: `${id}.m3`, role: 'sidecar' as const, scopes: ['current-mount'] as const },
          })),
        }
      },
      async model(_resourceId, request) {
        textureBudgets.push(request.maxTextureTotalBytes ?? 0)
        // Each model carries 100 KiB of its own and a 1 MiB texture every model shares.
        return {
          state: 'converted', sourceKey: 'revision', meshes: [], diagnostics: [], complete: true,
          primitives: [{ id: 'p', topology: 'triangles', positions: new Float32Array(25_600) }],
          textures: [{ id: 't', width: 512, height: 512, rgba: shared }],
        }
      },
    }
    const everything = await inspectCandidateWorld(source, {
      maxLayers: 2, maxItemsPerLayer: 256, maxConcurrentModelAcquisitions: 1,
    })
    expect(worldModelAssetStatus(everything)).toEqual({ total: 100, converted: 100, partial: false })
    expect(new Set(textureBudgets)).toEqual(new Set([2 * 1024 * 1024]))

    // 1 MiB shared once, then 100 KiB per model: 8 MiB are spent after the 72nd model.
    textureBudgets.length = 0
    const spent = await inspectCandidateWorld(source, {
      maxLayers: 2, maxItemsPerLayer: 256, maxConcurrentModelAcquisitions: 1,
      maxModelBytes: 8 * 1024 * 1024,
    })
    expect(worldModelAssetStatus(spent)).toEqual({ total: 100, converted: 100, partial: false })
    expect(textureBudgets.slice(0, 72)).toEqual(Array(72).fill(2 * 1024 * 1024))
    expect(textureBudgets.slice(72)).toEqual(Array(28).fill(256 * 1024))
    expect(spent.models?.get(ids[72]!)?.diagnostics.at(-1)).toMatchObject({
      severity: 'information',
      code: 'x3.ui/world-model-textures-reduced',
    })
  })

  it('asks a model that needs more for what it needs; one that throws does not stop the rest', async () => {
    const ids = ['big', 'broken', 'huge', 'plain', 'textured']
    const resourceLayer: WorldSceneLayerItem = {
      facet: 'layers', id: 'resources', layerId: 'resources', kind: 'resources',
      state: 'available', itemCount: ids.length, lods: ['exact'],
    }
    const asked: [string, number][] = []
    const tooLarge = (maxBytes: number, requiredBytes: number) => ({
      state: 'unresolved' as const,
      diagnostics: [
        diagnostic('warning', 'x3.host/model-resource-too-large', 'needs more', undefined, {
          maxBytes,
          requiredBytes,
        }),
      ],
    })
    const source: CandidateWorldSceneSource = {
      contract,
      major: 1,
      snapshotId,
      info: async () => info,
      async page(request) {
        if (request.facet === 'layers') {
          return { snapshotId, facet: 'layers', state: 'available', items: [resourceLayer] }
        }
        return {
          snapshotId, facet: 'resources', state: 'available',
          items: ids.map(id => ({
            facet: 'resources' as const, id, layerId: resourceLayer.layerId, namespace: 'Model',
            entityId: id, resolved: true, objectIds: [`${id}:0`],
            modelResource: { id, logicalId: `${id}.m3`, role: 'sidecar' as const, scopes: ['current-mount'] as const },
          })),
        }
      },
      async model(resourceId, request) {
        asked.push([resourceId, request.maxBytes])
        // DefendersCity_Biker_Bar is 4.07 MiB: just over the first ask.
        if (resourceId === 'big' && request.maxBytes < 4_270_000) return tooLarge(request.maxBytes, 4_270_000)
        if (resourceId === 'huge') return tooLarge(request.maxBytes, 64 * 1024 * 1024)
        if (resourceId === 'broken') throw new RangeError('model primitive exceeds maxBytes budget')
        // Its UVM fits the first ask, its textures then do not: both share maxBytes.
        if (resourceId === 'textured' && request.maxBytes < 3_000_000 + 2 * 1024 * 1024)
          return {
            state: 'converted', sourceKey: 'revision', uvmBytes: new Uint8Array(3_000_000),
            meshes: [], primitives: [], complete: true,
            diagnostics: [diagnostic('warning', 'x3.host/resource-budget-exceeded', 'Raster reads exceed the budget.')],
          }
        return { state: 'converted', sourceKey: 'revision', meshes: [], primitives: [], diagnostics: [], complete: true }
      },
    }
    const world = await inspectCandidateWorld(source, {
      maxLayers: 2, maxItemsPerLayer: 8, maxConcurrentModelAcquisitions: 1,
    })
    const first = 4 * 1024 * 1024
    expect(asked).toEqual([
      ['big', first], ['big', 4_270_000 + 2 * 1024 * 1024],
      ['broken', first], ['broken', 24 * 1024 * 1024],
      ['huge', first],
      ['plain', first],
      ['textured', first], ['textured', 3_000_000 + 2 * 1024 * 1024],
    ])
    expect(world.models?.get('textured')?.diagnostics).toEqual([])
    expect(world.models?.get('big')?.state).toBe('converted')
    expect(world.models?.get('plain')?.state).toBe('converted')
    expect(world.models?.get('huge')?.diagnostics[0]?.code).toBe('x3.host/model-resource-too-large')
    expect(world.models?.get('broken')?.diagnostics[0]).toMatchObject({
      code: 'x3.ui/world-model-failed',
      message: expect.stringContaining('model primitive exceeds maxBytes budget'),
    })
  })

  it('draws terrain and placed objects from the admitted common source without game branches', async () => {
    const commonInfo = Object.freeze({ ...info, contract: WORLD_SCENE_SOURCE_CONTRACT })
    const terrainLayer: WorldSceneLayerItem = Object.freeze({
      facet: 'layers',
      id: 'layer:terrain',
      layerId: 'layer:terrain',
      kind: 'terrain',
      state: 'available',
      itemCount: 1,
      lods: Object.freeze(['exact']),
    })
    const source: WorldSceneSource = Object.freeze({
      contract: WORLD_SCENE_SOURCE_CONTRACT,
      major: 1,
      snapshotId,
      info: () => Promise.resolve(commonInfo),
      page(request: WorldScenePageRequest): Promise<WorldScenePage> {
        if (request.facet === 'layers') {
          return Promise.resolve({
            snapshotId,
            facet: 'layers',
            state: 'available',
            items: [terrainLayer, layer],
          })
        }
        if (request.facet === 'terrain') {
          return Promise.resolve({
            snapshotId,
            facet: 'terrain',
            state: 'available',
            items: [
              {
                facet: 'terrain',
                id: 'terrain:0',
                layerId: terrainLayer.layerId,
                coordinateSpaceId: 'height-grid',
                lod: 'exact',
                x: 0,
                y: 0,
                heightBase: 12,
                heightAdjustment: 0,
                mask: 0,
                mapNativePosition: { x: 128, y: 256, z: 24 },
              },
            ],
          })
        }
        return Promise.resolve({
          snapshotId,
          facet: 'objects',
          state: 'available',
          items: [
            {
              facet: 'objects',
              id: 'object:1',
              layerId: layer.layerId,
              coordinateSpaceId: 'map-native',
              kind: 'structure',
              objectId: 1,
              position: { x: 128, y: 256, z: 0 },
            },
          ],
        })
      },
    })
    const model = await inspectCandidateWorld(source, { maxLayers: 4, maxItemsPerLayer: 8 })
    const calls: string[] = []
    const context = {
      fillStyle: '',
      clearRect: () => calls.push('clear'),
      fillRect: () => calls.push('terrain'),
      beginPath: () => calls.push('begin'),
      arc: () => calls.push('object'),
      fill: () => calls.push('fill'),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement
    drawCandidateWorld(canvas, model)
    expect([canvas.width, canvas.height]).toEqual([720, 480])
    expect(calls).toEqual(['clear', 'terrain', 'begin', 'object', 'fill'])
  })

  it('meshes terrain and draws water, native cliffs, pathing and regions in the common scene', () => {
    const facets = [
      ['terrain', 'exact'],
      ['terrain-materials', 'exact'],
      ['water', 'exact'],
      ['cliffs', 'exact'],
      ['objects', 'exact'],
      ['navigation', 'sampled'],
      ['regions', 'exact'],
    ] as const
    const terrain = Array.from({ length: 9 }, (_, index) => ({
      facet: 'terrain' as const,
      id: `t:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact' as const,
      x: index % 3,
      y: Math.floor(index / 3),
      heightBase: index === 4 ? 3 : 0,
      heightAdjustment: 0,
      mask: 0,
    }))
    const items: Record<string, readonly unknown[]> = {
      terrain,
      'terrain-materials': terrain.map(item => ({
        facet: 'terrain-materials',
        id: `m:${item.id}`,
        layerId: 'terrain-materials',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: item.x,
        y: item.y,
        textureIndex: (item.x + item.y) % 2,
      })),
      water: [
        {
          facet: 'water',
          id: 'w:0',
          layerId: 'water',
          coordinateSpaceId: 'map-native',
          zoneId: 0,
          templateId: 'Water',
          minimum: { x: 0, y: 0 },
          maximum: { x: 1, y: 1 },
          elevation: 9.25,
        },
      ],
      cliffs: terrain.map(item => ({
        facet: 'cliffs',
        id: `c:${item.id}`,
        layerId: 'cliffs',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: item.x,
        y: item.y,
        level: item.x > 0 ? 1 : 0,
        authored: true,
      })),
      objects: [
        {
          facet: 'objects',
          id: 'o:1',
          layerId: 'objects',
          coordinateSpaceId: 'map-native',
          kind: 'unit',
          objectId: 1,
          position: { x: 0.25, y: 0.25, z: 0 },
        },
        {
          facet: 'objects',
          id: 'o:2',
          layerId: 'objects',
          coordinateSpaceId: 'map-native',
          kind: 'unit',
          objectId: 2,
          position: { x: 1.75, y: 1.5, z: 0 },
          rotation: 1.5,
        },
      ],
      navigation: [
        {
          facet: 'navigation',
          id: 'n:0',
          layerId: 'navigation',
          coordinateSpaceId: 'navigation-grid',
          lod: 'sampled',
          x: 1,
          y: 1,
          flags: 4,
        },
      ],
      regions: [
        {
          facet: 'regions',
          id: 'r:0',
          layerId: 'regions',
          coordinateSpaceId: 'map-native',
          regionId: 1,
          name: 'center',
          shapes: [{ kind: 'circle', center: { x: 1, y: 1 }, radius: 0.5, rawParameters: {} }],
        },
      ],
    }
    const model = {
      contract,
      major: 1 as const,
      snapshotId,
      info,
      layers: facets.map(([kind, lod]) => ({
        layer: {
          facet: 'layers' as const,
          id: kind,
          layerId: kind,
          kind,
          state: 'available' as const,
          itemCount: items[kind]?.length ?? 0,
          lods: [lod],
        },
        page: { snapshotId, facet: kind, state: 'available' as const, items: items[kind] ?? [] },
      })),
    }
    const calls: string[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      clearRect: () => calls.push('clear'),
      fillRect: () => calls.push('rect'),
      beginPath: () => calls.push('begin'),
      moveTo: () => calls.push('move'),
      lineTo: () => calls.push('line'),
      closePath: () => calls.push('close'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
      arc: () => calls.push('arc'),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement
    const stats = drawCandidateWorld(canvas, model as never)
    expect(stats).toEqual({
      terrainTriangles: 8,
      terrainTexturedTriangles: 0,
      terrainSplatFallbackCells: 0,
      waterPolygons: 1,
      cliffEdges: 3,
      cliffTriangles: 0,
      objectInstances: 2,
      modelTriangles: 0,
      navigationSamples: 1,
      gatewaySegments: 0,
      regionShapes: 1,
      diagnosticPlaceholders: 2,
      shadowCasterTriangles: 0,
      shadowMapSize: 0,
    })
    expect(calls.filter(item => item === 'fill').length).toBeGreaterThanOrEqual(7)
  })

  it('draws two transformed instances from one host-converted common model resource', () => {
    const objects = [
      {
        facet: 'objects' as const,
        id: 'o:1',
        layerId: 'objects',
        coordinateSpaceId: 'map-native',
        resourceId: 'resource:marine',
        kind: 'unit' as const,
        objectId: 1,
        position: { x: 0, y: 0, z: 0 },
      },
      {
        facet: 'objects' as const,
        id: 'o:2',
        layerId: 'objects',
        coordinateSpaceId: 'map-native',
        resourceId: 'resource:marine',
        kind: 'unit' as const,
        objectId: 2,
        position: { x: 2, y: 1, z: 0 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: 2, z: 2 },
      },
    ]
    const commonModel = {
      state: 'converted' as const,
      sourceKey: 'marine-m3',
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles' as const,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        },
      ],
      diagnostics: [],
      complete: true,
    }
    const model = {
      contract,
      major: 1 as const,
      snapshotId,
      info,
      layers: [
        {
          layer,
          page: { snapshotId, facet: 'objects', state: 'available' as const, items: objects },
        },
      ],
      models: new Map([['resource:marine', commonModel]]),
    }
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      arc() {},
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement
    expect(drawCandidateWorld(canvas, model as never)).toMatchObject({
      objectInstances: 2,
      modelTriangles: 2,
      diagnosticPlaceholders: 0,
    })
  })

  it('keeps selection, move preview and stale rollback independent from persistence', () => {
    const object = {
      facet: 'objects' as const,
      id: 'o:7',
      layerId: 'objects',
      coordinateSpaceId: 'map-native',
      kind: 'unit' as const,
      objectId: 7,
      position: { x: 10, y: 20, z: 2 },
    }
    const model = {
      contract,
      major: 1 as const,
      snapshotId,
      info,
      layers: [
        {
          layer,
          page: { snapshotId, facet: 'objects', state: 'available' as const, items: [object] },
        },
      ],
      loadPerformance: {
        coldStart: true,
        infoMilliseconds: 0,
        layerCatalogMilliseconds: 0,
        layerAcquisitionMilliseconds: 0,
        modelAcquisitionMilliseconds: 0,
        terrainTextureAcquisitionMilliseconds: 0,
        totalMilliseconds: 0,
        layerPageRequests: 1,
        reusedLayers: 0,
        modelRequests: 0,
        reusedModels: 0,
        terrainTextureRequests: 0,
        reusedTerrainTextures: 0,
      },
    }
    expect(pickWorldObject(model, { x: 10.1, y: 20.1 }, 1)?.objectId).toBe(7)
    const selected = selectWorldObject(createWorldEditState('revision-1'), object)
    const preview = previewWorldObjectMove(selected, { x: 3, y: -2 })
    expect(preview).toMatchObject({ status: 'preview', preview: { x: 13, y: 18, z: 2 } })
    expect(rejectWorldObjectMove(preview, 'stale revision', true)).toMatchObject({
      status: 'stale',
      preview: { x: 10, y: 20, z: 2 },
      confirmed: { x: 10, y: 20, z: 2 },
    })
    expect(selectWorldObject(preview, undefined)).toEqual({
      sourceRevision: 'revision-1',
      status: 'idle',
    })
  })

  it('submits move intent through operation, authorization and commit, then waits for refresh', async () => {
    const object = {
      facet: 'objects' as const,
      id: 'o:9',
      layerId: 'objects',
      coordinateSpaceId: 'map-native',
      kind: 'unit' as const,
      objectId: 9,
      position: { x: 1, y: 2, z: 3 },
    }
    const state = previewWorldObjectMove(
      selectWorldObject(createWorldEditState('revision-9'), object),
      { x: 4, y: 5 },
    )
    let operationInput: unknown
    const plan = {
      planId: 'plan',
      targets: [],
      edits: [],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'semantic', preservesUnknownData: true, notes: [] },
      diagnostics: [],
    }
    const result = await commitWorldObjectMove(state, {
      descriptor: {
        operations: [{ id: 'edit-world', handlerId: 'handler', state: 'available' }],
      } as never,
      operations: {
        async invoke(_handler: unknown, input: unknown) {
          operationInput = input
          return { state: 'ok', output: { kind: 'edit-plan', plan }, diagnostics: [] } as never
        },
      } as never,
      operationId: 'edit-world',
      moveObjectKind: 'object.update',
      authorization: {
        async request() {
          return { grant: { id: 'grant', classes: ['read-source', 'write-source'] } }
        },
      } as never,
      coordinator: {
        async prepare() {
          return { state: 'ready', prepared: { id: 'prepared' } }
        },
        async commit() {
          return { state: 'committed', receipt: { transactionId: 'tx' } }
        },
      } as never,
    })
    expect(operationInput).toEqual({
      expectedSourceRevision: 'revision-9',
      edits: [{ kind: 'object.update', objectId: 9, patch: { position: { x: 5, y: 7, z: 3 } } }],
    })
    expect(result).toMatchObject({
      status: 'idle',
      confirmed: { x: 1, y: 2, z: 3 },
      preview: { x: 1, y: 2, z: 3 },
      message: 'saved; awaiting refreshed world snapshot',
    })
  })

  it('reuses unchanged heavy layer pages across an object-only snapshot update', async () => {
    const calls: string[] = []
    const makeSource = (nextSnapshot: string, objectX: number): CandidateWorldSceneSource => {
      const terrainLayer = {
        facet: 'layers' as const,
        id: `${nextSnapshot}:terrain`,
        layerId: `${nextSnapshot}:terrain`,
        kind: 'terrain' as const,
        state: 'available' as const,
        itemCount: 1,
        lods: ['exact'],
        contentRevision: 'terrain:same',
      }
      const objectLayer = {
        facet: 'layers' as const,
        id: `${nextSnapshot}:objects`,
        layerId: `${nextSnapshot}:objects`,
        kind: 'objects' as const,
        state: 'available' as const,
        itemCount: 1,
        lods: ['exact'],
        contentRevision: `objects:${objectX}`,
      }
      return {
        contract,
        major: 1,
        snapshotId: nextSnapshot,
        info: async () => ({ ...info, snapshotId: nextSnapshot }),
        page: async request => {
          calls.push(`${nextSnapshot}:${request.facet}`)
          if (request.facet === 'layers')
            return {
              snapshotId: nextSnapshot,
              facet: 'layers',
              state: 'available',
              items: [terrainLayer, objectLayer],
            }
          if (request.facet === 'terrain')
            return {
              snapshotId: nextSnapshot,
              facet: 'terrain',
              state: 'available',
              items: [
                {
                  facet: 'terrain',
                  id: 't',
                  layerId: terrainLayer.layerId,
                  coordinateSpaceId: 'height-grid',
                  lod: 'exact',
                  x: 0,
                  y: 0,
                  heightBase: 1,
                  heightAdjustment: 0,
                  mask: 0,
                },
              ],
            }
          return {
            snapshotId: nextSnapshot,
            facet: 'objects',
            state: 'available',
            items: [
              {
                facet: 'objects',
                id: 'o',
                layerId: objectLayer.layerId,
                coordinateSpaceId: 'map-native',
                kind: 'unit',
                objectId: 1,
                position: { x: objectX, y: 0, z: 0 },
              },
            ],
          }
        },
      }
    }
    const first = await inspectCandidateWorld(makeSource('snapshot-a', 1), {
      maxLayers: 4,
      maxItemsPerLayer: 4,
    })
    calls.length = 0
    const second = await inspectCandidateWorld(makeSource('snapshot-b', 2), {
      maxLayers: 4,
      maxItemsPerLayer: 4,
      previous: first,
    })
    expect(calls).toEqual(['snapshot-b:layers', 'snapshot-b:objects'])
    expect(second.reusedLayerKinds).toEqual(['terrain'])
    expect(second.loadPerformance.reusedLayers).toBe(1)
    expect(second.loadPerformance.layerPageRequests).toBe(1)
    expect(second.layers.find(item => item.layer.kind === 'terrain')?.page.snapshotId).toBe(
      'snapshot-b',
    )
    expect(second.layers.find(item => item.layer.kind === 'objects')?.page.items[0]).toMatchObject({
      position: { x: 2 },
    })
  })
})
