import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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

    const incomplete = await materializeWorldToUvw(source(2), {
      ...options,
      maxTerrainItems: 3,
    })
    expect(incomplete.refusalCodes).toEqual(['terrain-budget-exceeded'])
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
              materials: materialIds.map((materialId, sourceIndex) => ({ materialId, sourceIndex })),
            }, {
              facet: 'layers', id: 'native:water', layerId: 'native:water',
              kind: 'water', state: 'available', itemCount: 1, lods: ['exact'],
              waterMaterials: [{ materialId: 'pool_blue', color: [0, 0, 1, 1] }],
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
    const layer = parseUvwProfile(result.bytes).spaces[0]?.layers.find(item => item.kind === 'terrain-materials')
    expect(layer?.kind).toBe('terrain-materials')
    if (layer?.kind !== 'terrain-materials') return
    expect(layer.materials.map(material => material.id)).toEqual(['material-ground-a-red', 'material-ground-a-yellow'])
    expect(layer.samples?.[0]?.map(sample => sample.weights[0]?.materialId)).toEqual([
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
      const raster = parseUvwProfile(rasterResult.bytes).spaces[0]?.layers.find(item => item.kind === 'terrain-materials')
      expect(raster?.kind).toBe('terrain-materials')
      if (raster?.kind === 'terrain-materials')
        expect(raster.weightRasters?.[0]?.materialIds).toEqual(['material-ground-a-yellow', 'material-ground-a-red'])
    }
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
