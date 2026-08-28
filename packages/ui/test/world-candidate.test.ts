import { describe, expect, it } from 'vitest'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneSource,
  WorldSceneLayerItem,
  WorldScenePage,
  WorldScenePageRequest,
} from '@modkitx-x3/sdk/maps'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkitx-x3/sdk/maps'
import { drawCandidateWorld, inspectCandidateWorld } from '@modkitx-x3/ui/world'

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
})
