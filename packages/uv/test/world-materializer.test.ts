import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { revisionId, type ArtifactByteSource, type AssetInput, type ContributionContext, type ResourceBudget } from '@modkit/sdk'
import { createCodec as createRotationCodec } from '../src/world/codec.js'

import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldScenePageRequest,
  WorldSceneItem,
} from '@modkit/sdk/maps'
import {
  createUvwWorldSceneSource,
  materializeWorldToUvw,
  parseUvwProfile,
  serializeUvwProfile,
} from '../src/world/index.js'

const snapshotId = 'measured-world-revision'
const layerId = 'native:terrain'
const items: readonly WorldSceneItem[] = Object.freeze([
  terrain(0, 0, 0, 0),
  terrain(1, 0, 1, 0),
  terrain(0, 1, 2, -1),
  terrain(1, 1, 3, -1),
])

function terrain(x: number, y: number, height: number, z: number): WorldSceneItem {
  return Object.freeze({
    facet: 'terrain',
    id: `${String(x)}:${String(y)}`,
    layerId,
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x,
    y,
    heightBase: height,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: Object.freeze({ x, y: height, z }),
  })
}

const info: CandidateWorldSceneInfo = Object.freeze({
  contract: 'example.publisher/world-source',
  major: 1,
  maturity: 'publisher-candidate',
  snapshotId,
  mapId: 'measured-world',
  coordinateSpaces: Object.freeze([
    Object.freeze({
      id: 'uvw-canonical',
      horizontalAxes: Object.freeze(['x', 'z'] as const),
      verticalAxis: 'y',
      handedness: 'right',
      linearUnit: 'example-game-unit',
      rotationUnit: 'radian',
      origin: 'measured',
    }),
  ]),
  crossSpaceTransforms: Object.freeze([
    Object.freeze({ from: 'map-native', to: 'uvw-canonical', state: 'known' }),
  ]),
  bounds: Object.freeze([
    Object.freeze({
      facet: 'terrain',
      coordinateSpaceId: 'uvw-canonical',
      x: Object.freeze({ state: 'known', minimum: 0, maximum: 1 }),
      y: Object.freeze({ state: 'known', minimum: 0, maximum: 3 }),
      z: Object.freeze({ state: 'known', minimum: -1, maximum: 0 }),
    }),
  ]),
  uvwTransform: Object.freeze({
    schemaVersion: 1,
    snapshotId,
    sourceCoordinateSpaceId: 'map-native',
    targetCoordinateSpaceId: 'uvw-canonical',
    basis: Object.freeze({
      handedness: 'right',
      upAxis: 'y',
      forwardAxis: '+z',
      unit: 'source-unit',
      sourceUnit: 'example-game-unit',
      unitsPerCell: 1,
    }),
    axes: Object.freeze({
      x: Object.freeze({ sourceAxis: 'x', scale: 1, offset: 0 }),
      y: Object.freeze({ sourceAxis: 'z', scale: 1, offset: 0 }),
      z: Object.freeze({ sourceAxis: 'y', scale: -1, offset: 0 }),
    }),
    heightfield: Object.freeze({
      columns: 2,
      rows: 2,
      cellSize: 1,
      origin: Object.freeze([0, 0, -1] as const),
      sourceRowOrder: 'reverse',
    }),
    bounds: Object.freeze({
      coordinateSpaceId: 'uvw-canonical',
      minimum: Object.freeze({ x: 0, y: 0, z: -1 }),
      maximum: Object.freeze({ x: 1, y: 3, z: 0 }),
    }),
    proof: Object.freeze({
      kind: 'adapter-qualification',
      method: 'sealed-legacy-differential',
      oracle: 'fixture',
      corpus: '2x2',
      sourceDigests: Object.freeze({ input: `sha256:${'1'.repeat(64)}` as const }),
      tupleCount: 4,
      comparison: 'ieee-754-binary64-exact',
      nativeTupleDigest: `sha256:${'2'.repeat(64)}` as const,
      canonicalTupleDigest: `sha256:${'3'.repeat(64)}` as const,
    }),
  }),
  facets: Object.freeze([
    Object.freeze({
      facet: 'terrain',
      layerId,
      state: 'available',
      itemCount: 4,
      lods: Object.freeze(['exact']),
    }),
  ]),
  provenance: Object.freeze([]),
  unknownFacets: Object.freeze(['water']),
  lossPolicy: 'explicit-partial',
  complete: true,
})

function source(pageSize: number, sourceInfo = info): CandidateWorldSceneSource {
  return Object.freeze({
    contract: 'example.publisher/world-source',
    major: 1,
    snapshotId,
    info: () => Promise.resolve(sourceInfo),
    page: (request: WorldScenePageRequest) => {
      const offset = request.cursor === undefined ? 0 : Number(request.cursor)
      const selected = items.slice(offset, offset + pageSize)
      const next = offset + selected.length
      return Promise.resolve(
        Object.freeze({
          snapshotId,
          facet: request.facet,
          state: 'available' as const,
          items: selected,
          ...(next < items.length ? { nextCursor: String(next) } : {}),
        }),
      )
    },
  })
}

const options = Object.freeze({ maxPageItems: 4, maxTerrainItems: 4, maxOutputBytes: 64_000 })

describe('production world to UVW materializer', () => {
  it('reverses native material cells and their corners while keeping terminal padding terminal', async () => {
    const measured: CandidateWorldSceneInfo = {
      ...info,
      uvwTransform: {
        ...info.uvwTransform!,
        heightfield: {
          columns: 3,
          rows: 3,
          cellSize: 1,
          origin: [0, 0, -2],
          sourceRowOrder: 'reverse',
        },
        bounds: {
          coordinateSpaceId: 'uvw-canonical',
          minimum: { x: 0, y: 0, z: -2 },
          maximum: { x: 2, y: 8, z: 0 },
        },
      },
      facets: [
        { facet: 'terrain', layerId, state: 'available', itemCount: 9, lods: ['exact'] },
        {
          facet: 'terrain-materials',
          layerId: 'materials',
          state: 'available',
          itemCount: 9,
          lods: ['exact'],
        },
      ],
    }
    const alpha = [0, 0.25, 0.5, 1] as const
    const uv = [
      [0, 0],
      [2, 0],
      [2, 3],
      [0, 3],
    ] as const
    const native: CandidateWorldSceneSource = {
      ...source(32),
      info: async () => measured,
      page: async request => {
        const selected: WorldSceneItem[] =
          request.facet === 'layers'
            ? [
                {
                  facet: 'layers',
                  id: 'materials',
                  layerId: 'materials',
                  kind: 'terrain-materials',
                  state: 'available',
                  itemCount: 9,
                  lods: ['exact'],
                  grid: {
                    columns: 3,
                    rows: 3,
                    cellSize: 1,
                    origin: [0, 0, -2],
                    coordinateSpaceId: 'uvw-canonical',
                  },
                  materials: [{ materialId: 'grass', atlas: { rows: 4 } }],
                },
              ]
            : Array.from({ length: 9 }, (_, index) => {
                const x = index % 3,
                  y = Math.floor(index / 3)
                return request.facet === 'terrain'
                  ? terrain(x, y, index, 0 - y)
                  : ({
                      facet: 'terrain-materials',
                      id: String(index),
                      layerId: 'materials',
                      coordinateSpaceId: 'height-grid',
                      lod: 'exact',
                      x,
                      y,
                      textureIndex: index,
                      uvwPosition: { x, y: 0, z: 0 - y },
                      ...(y === 2 || x === 2
                        ? { weights: [{ materialId: 'grass', weight: 1 }] }
                        : {
                            cornerUv: uv,
                            layers: [
                              {
                                materialId: 'grass',
                                tile: { column: x, row: y },
                                cornerAlpha: alpha,
                              },
                              {
                                materialId: 'grass',
                                tile: { column: 2, row: 2 },
                                drawOrder: 10,
                                clipPolygon: [
                                  [0, 0],
                                  [1, 0],
                                  [0, 1],
                                ],
                              },
                            ],
                          }),
                    } as WorldSceneItem)
              })
        return { snapshotId, facet: request.facet, state: 'available', items: selected }
      },
    }
    const result = await materializeWorldToUvw(native, {
      ...options,
      maxPageItems: 32,
      maxTerrainItems: 9,
      maxFacetItems: 32,
    })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    const material = result.document.spaces[0]!.layers.find(
      layer => layer.kind === 'terrain-materials',
    )!
    if (material.kind !== 'terrain-materials') throw new Error('missing materials')
    expect(material.samples?.[0]?.[0]?.layers?.[0]).toEqual({
      materialId: 'grass',
      tile: { column: 0, row: 1 },
      cornerAlpha: [1, 0.5, 0.25, 0],
    })
    expect(material.samples?.[1]?.[0]?.layers?.[0]?.tile.row).toBe(0)
    expect(material.samples?.[0]?.[0]?.cornerUv).toEqual([uv[3], uv[2], uv[1], uv[0]])
    expect(material.samples?.[2]?.[0]?.layers).toBeUndefined()
    expect(material.materials[0]?.atlas).toEqual({ rows: 4, tileTop: 'local-y-0' })
    expect(result.lostFields).toContainEqual({
      path: 'world.terrain-materials.layers.clipPolygon',
      count: 4,
    })
    expect(result.lostFields).toContainEqual({
      path: 'world.terrain-materials.layers.drawOrder',
      count: 4,
    })
    const reopened = await materializeWorldToUvw(
      createUvwWorldSceneSource(result.document, { snapshotId: 'detached', maxPageSize: 32 }),
      { ...options, maxPageItems: 32, maxTerrainItems: 9, maxFacetItems: 32 },
    )
    expect(reopened.state).toBe('materialized')
    if (reopened.state === 'materialized') expect(reopened.bytes).toEqual(result.bytes)
    const bad = {
      ...native,
      page: async (request: WorldScenePageRequest) => {
        const page = await native.page(request)
        return {
          ...page,
          items: page.items.map((item, index) =>
            item.facet === 'terrain-materials' && index === 0 ? { ...item, y: -1 } : item,
          ),
        }
      },
    }
    expect(
      (
        await materializeWorldToUvw(bad, {
          ...options,
          maxPageItems: 32,
          maxTerrainItems: 9,
          maxFacetItems: 32,
        })
      ).state,
    ).toBe('refused')
  })

  it('is deterministic across page sizes and reopens as the current spaces profile', async () => {
    const one = await materializeWorldToUvw(source(1), options)
    const three = await materializeWorldToUvw(source(3), options)
    expect(one.state).toBe('materialized')
    expect(three.state).toBe('materialized')
    if (one.state !== 'materialized' || three.state !== 'materialized') return
    expect(three.bytes).toEqual(one.bytes)
    expect(three.artifactDigest).toBe(one.artifactDigest)
    expect(parseUvwProfile(one.bytes)).toEqual(one.document)
    expect(one.document.spaces[0]).toMatchObject({
      id: 'main',
      basis: { unit: 'source-unit', sourceUnit: 'example-game-unit' },
      bounds: { min: [0, 0, -1], max: [1, 3, 0] },
      layers: [{ samples: [[2, 3], [0, 1]] }],
    })
    expect(one.excludedFacetIds).toEqual(['world.unknown.water'])
  })

  it('refuses missing proof and incomplete exact grids by name', async () => {
    const { uvwTransform: _omitted, ...infoWithoutTransform } = info
    const noTransform = await materializeWorldToUvw(
      source(4, Object.freeze(infoWithoutTransform)),
      options,
    )
    expect(noTransform.refusalCodes).toEqual(['canonical-transform-missing'])

    // a transform the world source refused is named with its reason, not reported as never published
    const refused = await materializeWorldToUvw(
      source(4, Object.freeze({ ...infoWithoutTransform, uvwTransformRefusal: 'its proof is short' })),
      options,
    )
    expect(refused.refusalCodes).toEqual(['canonical-transform-invalid'])
    expect(refused.state === 'refused' && refused.refusals[0]?.message).toContain('its proof is short')

    const incomplete = await materializeWorldToUvw(source(2), {
      ...options,
      maxTerrainItems: 3,
    })
    expect(incomplete.refusalCodes).toEqual(['terrain-budget-exceeded'])
  })

  it('writes noDataValue where the layer leaves out samples with no ground (П26)', async () => {
    const holed = items.filter(item => item.id !== '1:1')
    const holedInfo: CandidateWorldSceneInfo = {
      ...info,
      uvwTransform: {
        ...info.uvwTransform!,
        bounds: { ...info.uvwTransform!.bounds, maximum: { x: 1, y: 2, z: 0 } },
      },
      facets: [{ ...info.facets[0]!, itemCount: 3 }],
    }
    const layer = {
      facet: 'layers',
      id: layerId,
      layerId,
      kind: 'terrain',
      state: 'available',
      itemCount: 3,
      lods: ['exact'],
      grid: {
        columns: 2,
        rows: 2,
        cellSize: 1,
        origin: [0, 0, -1],
        coordinateSpaceId: 'uvw-canonical',
        noDataValue: -9999,
      },
    } as const
    const holedSource = (declared: boolean): CandidateWorldSceneSource => ({
      ...source(4, holedInfo),
      page: (request: WorldScenePageRequest) =>
        Promise.resolve({
          snapshotId,
          facet: request.facet,
          state: 'available' as const,
          items: request.facet === 'layers' ? (declared ? [layer] : []) : holed,
        }),
    })
    const result = await materializeWorldToUvw(holedSource(true), options)
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    // (1, 1) ends the last source row, which reverses into the first canonical row
    expect(result.document.spaces[0]?.layers[0]).toMatchObject({
      noDataValue: -9999,
      samples: [
        [2, -9999],
        [0, 1],
      ],
    })
    // the same items without the declaration are an incomplete grid
    const undeclared = await materializeWorldToUvw(holedSource(false), options)
    expect(undeclared.refusalCodes).toEqual(['terrain-grid-invalid'])
  })

  it('keeps a partial object facet, losing alone the objects without a canonical place', async () => {
    const objectsLayerId = 'native:objects'
    const objectInfo: CandidateWorldSceneInfo = {
      ...info,
      unknownFacets: [],
      facets: [
        ...info.facets,
        { facet: 'objects', layerId: objectsLayerId, state: 'partial', itemCount: 4, lods: ['exact'] },
      ],
    }
    const object = (id: string, placed: boolean, extra: object = {}) => ({
      facet: 'objects' as const,
      id,
      layerId: objectsLayerId,
      coordinateSpaceId: 'map-native',
      kind: 'doodad' as const,
      objectId: 1,
      position: { x: 0, y: 0, z: 0 },
      ...(placed
        ? { uvwPosition: { x: 0.5, y: 1, z: -0.5 }, uvwRotation: [0, 0, 0, 1] as const }
        : {}),
      ...extra,
    })
    const terrainSource = source(4, objectInfo)
    const objectSource: CandidateWorldSceneSource = {
      ...terrainSource,
      page: request => {
        if (request.facet === 'layers')
          return Promise.resolve({
            snapshotId,
            facet: 'layers',
            state: 'available',
            items: [{
              facet: 'layers', id: objectsLayerId, layerId: objectsLayerId,
              kind: 'objects', state: 'partial', itemCount: 4, lods: ['exact'],
            }],
          })
        if (request.facet === 'objects')
          return Promise.resolve({
            snapshotId,
            facet: 'objects',
            state: 'available',
            items: [
              object('native:tree-1', true),
              object('native:start-1', false),
              object('native:tree-1', true),
              object('native:cliff-1', true, { derivedFrom: 'cliffs' }),
              object('native:preview-1', true, { derivedFrom: 'objects' }),
            ],
          })
        return terrainSource.page(request)
      },
    }
    const result = await materializeWorldToUvw(objectSource, {
      ...options,
      maxPageItems: 8,
      maxFacetItems: 64,
    })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.excludedFacetIds).not.toContain('world.objects')
    expect(result.omittedObjects).toBe(2)
    const layer = result.document.spaces[0]?.layers.find(item => item.kind === 'objects')
    expect(layer?.kind === 'objects' && layer.instances.map(instance => instance.id)).toEqual(['tree-1'])
  })

  it('names in its receipt every field of a kept facet the UVW leaves out (П23)', async () => {
    const objectsLayerId = 'native:objects'
    const lightingLayerId = 'native:lighting'
    const gatewaysLayerId = 'native:gateways'
    const lossInfo: CandidateWorldSceneInfo = {
      ...info,
      unknownFacets: [],
      facets: [
        ...info.facets,
        {
          facet: 'objects',
          layerId: objectsLayerId,
          state: 'available',
          itemCount: 2,
          lods: ['exact'],
        },
        {
          facet: 'lighting',
          layerId: lightingLayerId,
          state: 'available',
          itemCount: 1,
          lods: ['exact'],
        },
        {
          facet: 'gateways',
          layerId: gatewaysLayerId,
          state: 'available',
          itemCount: 1,
          lods: ['exact'],
        },
      ],
    }
    const placed = (id: string, extra: object) => ({
      facet: 'objects' as const,
      id,
      layerId: objectsLayerId,
      coordinateSpaceId: 'map-native',
      kind: 'unit' as const,
      objectId: 1,
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0.5, y: 1, z: -0.5 },
      uvwRotation: [0, 0, 0, 1] as const,
      ...extra,
    })
    const terrainSource = source(4, lossInfo)
    const lossSource: CandidateWorldSceneSource = {
      ...terrainSource,
      page: request => {
        if (request.facet === 'layers')
          return Promise.resolve({
            snapshotId,
            facet: 'layers',
            state: 'available',
            items: [
              {
                facet: 'layers',
                id: objectsLayerId,
                layerId: objectsLayerId,
                kind: 'objects',
                state: 'available',
                itemCount: 2,
                lods: ['exact'],
              },
              {
                facet: 'layers',
                id: lightingLayerId,
                layerId: lightingLayerId,
                kind: 'lighting',
                state: 'available',
                itemCount: 1,
                lods: ['exact'],
              },
              {
                facet: 'layers',
                id: gatewaysLayerId,
                layerId: gatewaysLayerId,
                kind: 'gateways',
                state: 'available',
                itemCount: 1,
                lods: ['exact'],
              },
            ],
          })
        // a gateway's native ends are what its canonical ends stand for: nothing is lost
        if (request.facet === 'gateways')
          return Promise.resolve({
            snapshotId,
            facet: 'gateways',
            state: 'available',
            items: [
              {
                facet: 'gateways',
                id: 'native:gateway-1',
                layerId: gatewaysLayerId,
                coordinateSpaceId: 'map-native',
                x1: 0,
                y1: 0,
                x2: 1,
                y2: 0,
                uvwStart: { x: 0, y: 0, z: 0 },
                uvwEnd: { x: 1, y: 0, z: 0 },
              },
            ],
          })
        if (request.facet === 'objects')
          return Promise.resolve({
            snapshotId,
            facet: 'objects',
            state: 'available',
            items: [
              // a tinted marine whose model only the host can resolve, and a plain one
              placed('native:marine-1', {
                presentationTint: [1, 0.5, 0.5],
                resourceIds: ['model:marine'],
              }),
              placed('native:marine-2', {
                presentationTint: [1, 1, 1],
                presentationAnimation: {
                  name: 'Stand',
                  groups: ['Work'],
                  loop: true,
                  speed: 1,
                  randomStart: true,
                },
              }),
            ],
          })
        if (request.facet === 'lighting')
          return Promise.resolve({
            snapshotId,
            facet: 'lighting',
            state: 'available',
            items: [
              {
                facet: 'lighting',
                id: 'native:environment',
                layerId: lightingLayerId,
                coordinateSpaceId: 'uvw-canonical',
                ambientColor: [0.2, 0.2, 0.2],
                ambientIntensity: 1,
                directional: [],
                fog: { color: [1, 1, 1], density: 0.1, falloff: 0, startingHeight: 0 },
              },
            ],
          })
        return terrainSource.page(request)
      },
    }
    const result = await materializeWorldToUvw(lossSource, { ...options, maxFacetItems: 64 })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    expect(result.lostFields).toEqual([
      { path: 'world.lighting.fog', count: 1 },
      { path: 'world.objects.resourceIds (not packaged)', count: 1 },
    ])
    // the object's tint and initial clip are UVW object fields (Runtime 02.10), read back as written
    const instances = result.document.spaces[0]?.layers.flatMap(layer =>
      layer.kind === 'objects' ? layer.instances : [],
    )
    expect(instances?.map(instance => instance.presentationTint)).toEqual([
      [1, 0.5, 0.5],
      [1, 1, 1],
    ])
    expect(instances?.[1]?.presentationAnimation).toEqual({
      name: 'Stand',
      groups: ['Work'],
      loop: true,
      speed: 1,
      randomStart: true,
    })
    const reopened = createUvwWorldSceneSource(result.document, {
      snapshotId: 'reopened',
      maxPageSize: 64,
    })
    const objectLayer = (await reopened.page({ facet: 'layers', limit: 64 })).items.find(
      item => item.facet === 'layers' && item.kind === 'objects',
    )
    const page = await reopened.page({
      facet: 'objects',
      layerId: objectLayer!.layerId,
      limit: 64,
    })
    expect(
      page.items.map(item => item.facet === 'objects' && item.presentationAnimation?.name),
    ).toEqual([undefined, 'Stand'])
  })
  it('turns a map-native light into UVW axes', async () => {
    const lightingLayerId = 'native:lighting'
    const lightingInfo: CandidateWorldSceneInfo = {
      ...info,
      unknownFacets: [],
      facets: [
        ...info.facets,
        { facet: 'lighting', layerId: lightingLayerId, state: 'available', itemCount: 1, lods: ['exact'] },
      ],
    }
    const terrainSource = source(4, lightingInfo)
    const lightingSource: CandidateWorldSceneSource = {
      ...terrainSource,
      page: request => {
        if (request.facet === 'layers')
          return Promise.resolve({
            snapshotId,
            facet: 'layers',
            state: 'available',
            items: [{
              facet: 'layers', id: lightingLayerId, layerId: lightingLayerId,
              kind: 'lighting', state: 'available', itemCount: 1, lods: ['exact'],
            }],
          })
        if (request.facet === 'lighting')
          return Promise.resolve({
            snapshotId,
            facet: 'lighting',
            state: 'available',
            items: [{
              facet: 'lighting', id: 'native:environment', layerId: lightingLayerId,
              coordinateSpaceId: 'map-native', ambientColor: [0.2, 0.2, 0.2], ambientIntensity: 1,
              // z up in map-native: the sun shines down
              directional: [{ id: 'sun', direction: [1, 2, -2], color: [1, 1, 1], intensity: 1 }],
            }],
          })
        return terrainSource.page(request)
      },
    }
    const result = await materializeWorldToUvw(lightingSource, { ...options, maxFacetItems: 64 })
    if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
    const layer = result.document.spaces[0]?.layers.find(item => item.kind === 'lighting')
    const direction = layer?.kind === 'lighting' ? layer.directional[0]?.direction : undefined
    // (x, y, z) -> (x, z, -y), renormalized: down along UVW -y
    expect(direction?.[0]).toBeCloseTo(1 / 3, 12)
    expect(direction?.[1]).toBeCloseTo(-2 / 3, 12)
    expect(direction?.[2]).toBeCloseTo(-2 / 3, 12)
  })

  it('keeps publisher material references joined after UVW id normalization', async () => {
    const materialsLayerId = 'native:materials'
    const materialIds = ['ground-a_yellow', 'ground-a_red'] as const
    const materialInfo: CandidateWorldSceneInfo = {
      ...info,
      unknownFacets: [],
      facets: [
        ...info.facets,
        { facet: 'terrain-materials', layerId: materialsLayerId, state: 'available', itemCount: 4, lods: ['exact'] },
        { facet: 'water', layerId: 'native:water', state: 'available', itemCount: 1, lods: ['exact'] },
      ],
    }
    const terrainSource = source(4, materialInfo)
    const materialSource: CandidateWorldSceneSource = {
      ...terrainSource,
      page: request => {
        if (request.facet === 'layers')
          return Promise.resolve({
            snapshotId,
            facet: 'layers',
            state: 'available',
            items: [{
              facet: 'layers', id: materialsLayerId, layerId: materialsLayerId,
              kind: 'terrain-materials', state: 'available', itemCount: 4, lods: ['exact'],
              grid: { columns: 2, rows: 2, cellSize: 1, origin: [0, 0, -1], coordinateSpaceId: 'height-grid' },
              materials: materialIds.map((materialId, sourceIndex) => ({
                materialId,
                sourceIndex,
                ...(sourceIndex === 1 ? { overlayAlpha: 'coverage' as const } : {}),
                normalEncoding: 'rgb-inverted-y' as const,
                ...(sourceIndex === 1 ? { specularEncoding: 'gloss' as const } : {}),
                ...(sourceIndex === 1 ? { baseColorFactor: [0.5, 0.25, 1, 1] as const } : {}),
              })),
            }, {
              facet: 'layers', id: 'native:water', layerId: 'native:water',
              kind: 'water', state: 'available', itemCount: 1, lods: ['exact'],
              waterMaterials: [{ materialId: 'pool_blue', color: [0, 0, 1, 1],
                compositing: 'multiply', occludedLikeTerrain: false,
                causticsFalloff: 0, normalResourceId: 'water-normal',
                causticsFrameResourceIds: ['frame-1', 'frame-2'],
              }],
            }],
          })
        if (request.facet === 'terrain-materials')
          return Promise.resolve({
            snapshotId,
            facet: 'terrain-materials',
            state: 'available',
            items: [0, 1, 2, 3].map(index => ({
              facet: 'terrain-materials' as const,
              id: `sample-${index}`,
              layerId: materialsLayerId,
              coordinateSpaceId: 'height-grid' as const,
              lod: 'exact' as const,
              x: index % 2,
              y: Math.floor(index / 2),
              textureIndex: index % 2,
              weights: [{ materialId: materialIds[index % 2]!, weight: 1 }],
            })),
          })
        if (request.facet === 'water')
          return Promise.resolve({
            snapshotId,
            facet: 'water',
            state: 'available',
            items: [{
              facet: 'water', id: 'zone:blue', layerId: 'native:water',
              coordinateSpaceId: 'map-native', zoneId: 1, templateId: 'blue',
              minimum: { x: 0, y: 0 }, maximum: { x: 1, y: 1 },
              uvwMinimum: { x: 0, z: -1 }, uvwMaximum: { x: 1, z: 0 },
              uvwElevation: 1, materialId: 'pool_blue',
            }],
          })
        return terrainSource.page(request)
      },
    }
    const result = await materializeWorldToUvw(materialSource, { ...options, maxFacetItems: 8 })
    expect(result.state).toBe('materialized')
    if (result.state !== 'materialized') return
    expect(result.lostFields).toContainEqual({ path: 'world.terrain-materials.materials.overlayAlpha', count: 1 })
    const catalogLosses = [
      { path: 'world.terrain-materials.materials.normalEncoding', count: 2 },
      { path: 'world.terrain-materials.materials.specularEncoding', count: 1 },
      ...['compositing', 'occludedLikeTerrain', 'causticsFalloff', 'normalResourceId', 'causticsFrameResourceIds']
        .map(field => ({ path: `world.water.materials.${field}`, count: 1 })),
    ]
    expect(result.lostFields).toEqual(expect.arrayContaining(catalogLosses))
    expect(result.lostFields.map(field => field.path)).not.toContain('world.water.materials.color')
    expect(result.lostFields.map(field => field.path)).not.toContain('world.terrain-materials.materials.baseColorFactor')
    const layer = parseUvwProfile(result.bytes).spaces[0]?.layers.find(item => item.kind === 'terrain-materials')
    expect(layer?.kind).toBe('terrain-materials')
    if (layer?.kind !== 'terrain-materials') return
    expect(layer.materials.map(material => material.id)).toEqual(['material-ground-a-red', 'material-ground-a-yellow'])
    expect(layer.materials.map(material => material.baseColorFactor)).toEqual([[0.5, 0.25, 1, 1], undefined])
    expect(layer.samples?.[0]?.map(sample => sample.weights?.[0]?.materialId)).toEqual([
      'material-ground-a-yellow', 'material-ground-a-red',
    ])
    const water = parseUvwProfile(result.bytes).spaces[0]?.layers.find(item => item.kind === 'water')
    expect(water?.kind).toBe('water')
    if (water?.kind === 'water') {
      expect(water.materials?.[0]?.id).toBe('material-pool-blue')
      expect(water.zones[0]?.materialId).toBe('material-pool-blue')
    }

    const rasterInfo: CandidateWorldSceneInfo = {
      ...materialInfo,
      facets: materialInfo.facets.map(facet => facet.facet === 'terrain-materials'
        ? { ...facet, lods: ['raster-exact'] }
        : facet),
    }
    const rasterSource: CandidateWorldSceneSource = {
      ...materialSource,
      info: () => Promise.resolve(rasterInfo),
      page: async request => {
        const page = await materialSource.page(request)
        if (request.facet !== 'layers') return page
        return {
          ...page,
          items: page.items.map(item => item.facet === 'layers' && item.kind === 'terrain-materials'
            ? {
                ...item,
                lods: ['raster-exact'],
                weightRasters: [{
                  resourceId: 'warzone-ground-weights:0',
                  width: 2, height: 2, materialIds, encoding: 'rgba8-unorm' as const,
                  normalization: 'sum' as const,
                }],
              }
            : item),
        }
      },
    }
    const rasterResult = await materializeWorldToUvw(rasterSource, { ...options, maxFacetItems: 8 })
    expect(rasterResult.state).toBe('materialized')
    if (rasterResult.state === 'materialized') {
      expect(rasterResult.lostFields).toContainEqual({ path: 'world.terrain-materials.materials.overlayAlpha', count: 1 })
      expect(rasterResult.lostFields).toEqual(expect.arrayContaining(catalogLosses))
      const raster = parseUvwProfile(rasterResult.bytes).spaces[0]?.layers.find(item => item.kind === 'terrain-materials')
      expect(raster?.kind).toBe('terrain-materials')
      if (raster?.kind === 'terrain-materials') {
        expect(raster.weightRasters?.[0]?.materialIds).toEqual(['material-ground-a-yellow', 'material-ground-a-red'])
        expect(raster.materials.find(material => material.id === 'material-ground-a-red')?.baseColorFactor)
          .toEqual([0.5, 0.25, 1, 1])
      }
    }
    // a raster the publisher approximated is written all the same and named among the lost fields
    const presentationSource: CandidateWorldSceneSource = {
      ...rasterSource,
      page: async request => {
        const page = await rasterSource.page(request)
        if (request.facet !== 'layers') return page
        return {
          ...page,
          items: page.items.map(item =>
            item.facet === 'layers' && item.weightRasters !== undefined
              ? {
                  ...item,
                  weightRasters: item.weightRasters.map(raster => ({
                    ...raster,
                    derivation: 'presentation' as const,
                  })),
                }
              : item,
          ),
        }
      },
    }
    const presented = await materializeWorldToUvw(presentationSource, {
      ...options,
      maxFacetItems: 8,
    })
    if (presented.state !== 'materialized') throw new Error(JSON.stringify(presented.refusals))
    expect(presented.lostFields).toContainEqual({
      path: 'world.layers.weightRasters.derivation',
      count: 1,
    })
    if (rasterResult.state === 'materialized')
      expect(rasterResult.lostFields.map(field => field.path)).not.toContain(
        'world.layers.weightRasters.derivation',
      )
  })

  it('round-trips every admitted facet from a canonical source at different page sizes', async () => {
    const bytes = await readFile(
      fileURLToPath(
        new URL(
          '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json',
          import.meta.url,
        ),
      ),
    )
    const document = parseUvwProfile(bytes)
    const materialize = (pageSize: number) =>
      materializeWorldToUvw(
        createUvwWorldSceneSource(document, {
          snapshotId: 'canonical-renderable-world',
          maxPageSize: pageSize,
        }),
        {
          maxPageItems: pageSize,
          maxTerrainItems: 128,
          maxFacetItems: 128,
          maxOutputBytes: 256_000,
        },
      )
    const one = await materialize(1)
    const seven = await materialize(7)
    expect(one.state).toBe('materialized')
    expect(seven.state).toBe('materialized')
    if (one.state !== 'materialized' || seven.state !== 'materialized') return
    expect(one.bytes).toEqual(seven.bytes)
    expect(one.bytes).toEqual(serializeUvwProfile(document))
    expect(one.artifactDigest).toBe(seven.artifactDigest)
    expect(one.excludedFacetIds).toEqual([])
  })
})

describe('the game-view preset of a world (spaces[].camera)', () => {
  const camera = { projection: 'orthographic', azimuthDegrees: 45, elevationDegrees: 30 } as const

  it('writes the publisher preset, reads it back and keeps it through a reopened world', async () => {
    const written = await materializeWorldToUvw(source(4, { ...info, camera }), options)
    expect(written.state).toBe('materialized')
    if (written.state !== 'materialized') return
    expect(written.document.spaces[0]?.camera).toEqual(camera)
    expect(parseUvwProfile(written.bytes).spaces[0]?.camera).toEqual(camera)
    const reopened = createUvwWorldSceneSource(written.document, {
      snapshotId: 'camera',
      maxPageSize: 64,
    })
    const reopenedInfo = await reopened.info()
    expect(reopenedInfo.camera).toEqual(camera)
    expect(reopenedInfo.canonicalArtifact?.spaces[0]?.camera).toEqual(camera)
    // a reopened world rebuilt as UVW keeps its preset, byte for byte
    const again = await materializeWorldToUvw(reopened as never, { ...options, maxFacetItems: 64 })
    expect(again.state).toBe('materialized')
    if (again.state === 'materialized') {
      expect(again.document.spaces[0]?.camera).toEqual(camera)
      expect(again.artifactDigest).toBe(written.artifactDigest)
    }
    // no preset, no camera: nothing is defaulted
    const plain = await materializeWorldToUvw(source(4), options)
    if (plain.state === 'materialized')
      expect(plain.document.spaces[0]).not.toHaveProperty('camera')
  })

  it('refuses a preset the profile does not admit', async () => {
    const written = await materializeWorldToUvw(source(4), options)
    if (written.state !== 'materialized') throw new Error('no fixture world')
    const withCamera = (value: unknown) =>
      new TextEncoder().encode(
        JSON.stringify({
          ...written.document,
          spaces: [{ ...written.document.spaces[0], camera: value }],
        }),
      )
    expect(
      parseUvwProfile(
        withCamera({ projection: 'perspective', fieldOfViewDegrees: 70, drawDistance: 192 }),
      ).spaces[0]?.camera,
    ).toEqual({
      projection: 'perspective',
      fieldOfViewDegrees: 70,
      drawDistance: 192,
    })
    for (const value of [
      { projection: 'orthographic', fieldOfViewDegrees: 60 },
      { projection: 'orthographic', elevationDegrees: 95 },
      { projection: 'perspective', drawDistance: 0 },
      { projection: 'isometric' },
      { projection: 'orthographic', zoom: 2 },
      { azimuthDegrees: 45 },
    ])
      expect(() => parseUvwProfile(withCamera(value)), JSON.stringify(value)).toThrow()
  })
})


describe('UVW authored rotation and optional absolute visual orientation', () => {
  const authored = [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)] as const
  const shown = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const
  async function fixture(presentation: unknown) {
    const raw = JSON.parse(await readFile(fileURLToPath(new URL(
      '../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-renderable-world.uvw.json', import.meta.url,
    )), 'utf8')) as { spaces: { layers: { kind: string; instances?: Record<string, unknown>[] }[] }[] }
    const instance = raw.spaces[0]!.layers.find(layer => layer.kind === 'objects')!.instances![0]!
    instance['rotation'] = authored
    if (presentation !== undefined) instance['presentationRotation'] = presentation
    return new TextEncoder().encode(JSON.stringify(raw))
  }

  it.each([
    undefined, [0, 0, 0, 1], authored, shown, [0, -Math.SQRT1_2, 0, -Math.SQRT1_2],
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  ])('preserves presence and full XYZW through source pages and wire roundtrip (%j)', async presentation => {
    const doc = parseUvwProfile(await fixture(presentation))
    const original = serializeUvwProfile(doc)
    const layer = doc.spaces[0]!.layers.find(layer => layer.kind === 'objects')!
    if (layer.kind !== 'objects') throw new Error('missing objects')
    expect(layer.instances[0]!.rotation).toEqual(authored)
    expect(Object.hasOwn(layer.instances[0]!, 'presentationRotation')).toBe(presentation !== undefined)
    expect(layer.instances[0]!.presentationRotation).toEqual(presentation)
    for (const pageSize of [1, 7]) {
      const reopened = createUvwWorldSceneSource(doc, { snapshotId: 'rotations', maxPageSize: pageSize })
      const sourceInfo = await reopened.info()
      const page = await reopened.page({ facet: 'objects', layerId: sourceInfo.facets.find(f => f.facet === 'objects')!.layerId, limit: pageSize })
      const object = page.items.find(item => item.facet === 'objects' && item.id.endsWith(':instance-a'))
      if (object?.facet !== 'objects') throw new Error('missing first object')
      expect(object.uvwRotation).toEqual(authored)
      expect(object.uvwPresentationRotation).toEqual(presentation)
      const result = await materializeWorldToUvw(reopened, { maxPageItems: pageSize, maxTerrainItems: 128, maxFacetItems: 128, maxOutputBytes: 256000 })
      if (result.state !== 'materialized') throw new Error(JSON.stringify(result))
      expect(result.bytes).toEqual(original)
      expect(result.lostFields).toEqual([])
    }
  })

  it.each([null, 0, 'identity', [], [0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2],
    [NaN, 0, 0, 1], [Infinity, 0, 0, 1], [0, 0, '0', 1], [0, 0, 0, 1, 0],
  ])('refuses invalid optional quaternion %j', async invalid => {
    const bytes = await fixture(invalid)
    expect(() => parseUvwProfile(bytes)).toThrow()
  })

  it('preserves both rotations and unrelated fields through the real position-edit codec handler', async () => {
    const bytes = await fixture(shown)
    const original = bytes.slice()
    const revision = revisionId('content-hash.sha256:rotation-codec-fixture')
    const budgets: ResourceBudget = { maxInputBytes: 64000000n, maxDepth: 64, maxNodes: 1000000, maxScalarBytes: 128000000, maxDiagnostics: 1000 }
    const context: ContributionContext = {
      budgets, diagnostics: { report: () => undefined },
      contracts: {
        async resolve() { throw new Error('no service dependency expected') },
        async resolveUnknown() { throw new Error('no service dependency expected') },
      },
    }
    const asset: ArtifactByteSource = {
      kind: 'bytes', ref: { id: 'rotation-fixture', uri: 'memory://world/rotation.uvw' }, revision, size: BigInt(bytes.length),
      async read(offset, length, signal) { signal?.throwIfAborted(); return bytes.slice(Number(offset), Number(offset) + length) },
      async *stream() { yield bytes },
    }
    const binding = { sourceKind: 'candidate' as const, bindingId: 'content', role: 'content', ownership: 'owned' as const, source: asset.ref, revision }
    const input: AssetInput = {
      originKind: 'single', bindings: [binding], primaryBindingId: 'content',
      revisions: { topology: 'single', revision, bindings: [{ bindingId: 'content', revision }], compositionFingerprint: 'rotation-codec-fixture' },
      bindingsFor: () => [], async openBinding() { return { value: asset, async release() {} } },
    }
    const session = await createRotationCodec(context).open(input, 'full', budgets)
    try {
      const request = { expectedSourceRevision: revision, edits: [{ kind: 'object.update', objectId: 0, patch: { position: { x: 4.25, y: 5.5, z: 6.75 } } }] }
      const edited = await session.operations().invoke('edit-uvw-document', request)
      if (edited.state !== 'ok' || edited.output.kind !== 'edit-plan') throw new Error('no edit plan')
      expect(edited.output.plan.edits).toHaveLength(1)
      const replacement = edited.output.plan.edits[0]
      if (replacement?.operation !== 'replace' || replacement.payload.kind !== 'inline') throw new Error('no owned replacement bytes')
      const beforeLayer = parseUvwProfile(bytes).spaces[0]!.layers.find(layer => layer.kind === 'objects')!
      const afterLayer = parseUvwProfile(replacement.payload.bytes).spaces[0]!.layers.find(layer => layer.kind === 'objects')!
      if (beforeLayer.kind !== 'objects' || afterLayer.kind !== 'objects') throw new Error('missing objects')
      const { position: _beforePosition, ...unchangedBefore } = beforeLayer.instances[0]!
      const { position: afterPosition, ...unchangedAfter } = afterLayer.instances[0]!
      expect(afterPosition).toEqual([4.25, 5.5, 6.75])
      expect(unchangedAfter).toEqual(unchangedBefore)
      expect(afterLayer.instances[1]).toEqual(beforeLayer.instances[1])
      await expect(session.operations().invoke('edit-uvw-document', { ...request, expectedSourceRevision: 'content-hash.sha256:stale' })).rejects.toThrow(/stale.*revision/iu)
      expect(bytes).toEqual(original)
    } finally { await session.dispose() }
  }, 20_000) // Same bound as the existing source-backed UVW codec integration cases.
})
