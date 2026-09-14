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
