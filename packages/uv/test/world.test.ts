import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { isModkitError } from '@modkit/core'
import {
  canonicalizeUvwProfile,
  createUvwWorldSceneSource,
  materializeWorldToUvw,
  parseUvwProfile,
  serializeUvwProfile,
  validateUvwProfile,
  type UvwProfileDocument,
} from '../src/world/index.js'

const fixture = (name: string): Promise<Uint8Array> =>
  readFile(
    fileURLToPath(
      new URL(`../../../vendor/multiverse-specs/specs/world/fixtures/${name}`, import.meta.url),
    ),
  )

function errorCode(run: () => unknown): string | undefined {
  try {
    run()
    return undefined
  } catch (error) {
    return isModkitError(error) ? error.code : undefined
  }
}

describe('UVW 1.0 production document', () => {
  it('validates water frame sequences and resource closure without deduplicating frames', async () => {
    const input = JSON.parse(new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')))
    const water = input.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'water')
    const resources = input.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'resources')
    const id = resources.resources[0].id
    water.materials = [{ id: 'water-extra', color: [0, 0, 1, 1], normalResourceId: id,
      causticsFrameResourceIds: [id, id], causticsFalloff: 0 }]
    for (const zone of water.zones) zone.materialId = 'water-extra'
    expect(() => validateUvwProfile(input)).not.toThrow()
    for (const frames of [[], [null], ['missing-resource'], 1]) {
      water.materials[0].causticsFrameResourceIds = frames
      expect(() => validateUvwProfile(input)).toThrow()
    }
    water.materials[0].causticsFrameResourceIds = [id]
    for (const falloff of [-1, null, '0']) {
      water.materials[0].causticsFalloff = falloff
      expect(() => validateUvwProfile(input)).toThrow()
    }
  })
  it('admits only generated cliff doodads and preserves their marker without creating authored placements', async () => {
    const input = JSON.parse(new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')))
    const objects = input.spaces[0].layers.find((item: { kind: string }) => item.kind === 'objects')
    const item = objects.instances[0]
    item.objectKind = 'doodad'
    item.derivedFrom = 'cliffs'
    const parsed = parseUvwProfile(serializeUvwProfile(validateUvwProfile(input)))
    const layer = parsed.spaces[0]!.layers.find(row => row.kind === 'objects')!
    if (layer.kind !== 'objects') throw new Error('missing fixture objects')
    expect(layer.instances.find(row => row.id === item.id)?.derivedFrom).toBe('cliffs')
    for (const invalid of ['objects', 'terrain', '', null, 1]) {
      item.derivedFrom = invalid
      expect(() => validateUvwProfile(input)).toThrow(/derived cliff/)
    }
    item.derivedFrom = 'cliffs'
    item.objectKind = 'unit'
    expect(() => validateUvwProfile(input)).toThrow(/derived cliff/)
  })
  it('retains layers-only atlas samples and inactive weights without sorting authored layers', async () => {
    const input = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    )
    const layer = input.spaces[0].layers.find(
      (item: { kind: string }) => item.kind === 'terrain-materials',
    )
    const materialId = layer.materials[0].id
    layer.materials[0].atlas = { rows: 4, tileTop: 'local-y-0' }
    const layers = [
      { materialId, tile: { column: 2, row: 3 }, cornerAlpha: [0, 0.25, 0.75, 1] },
      { materialId, tile: { column: 0, row: 1 }, cornerAlpha: [1, 0, 1, 0] },
    ]
    layer.samples[0][0] = { layers }
    layer.samples[0][1].layers = layers.slice().reverse()
    const document = parseUvwProfile(serializeUvwProfile(validateUvwProfile(input)))
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'ordered-tiles',
      maxPageSize: 32,
    })
    const result = await materializeWorldToUvw(source, {
      maxPageItems: 32,
      maxTerrainItems: 1000,
      maxFacetItems: 1000,
      maxOutputBytes: 1 << 20,
    })
    expect(result.state, JSON.stringify(result.refusals)).toBe('materialized')
    if (result.state !== 'materialized') return
    const rebuilt = result.document.spaces[0]!.layers.find(
      item => item.kind === 'terrain-materials',
    )!
    if (rebuilt.kind !== 'terrain-materials') throw new Error('missing material layer')
    expect(rebuilt.samples?.[0]?.[0]).toEqual({ layers })
    expect(rebuilt.samples?.[0]?.[1]).toEqual(layer.samples[0][1])
    expect(rebuilt.materials[0]?.atlas).toEqual(layer.materials[0].atlas)
    expect(result.lostFields.some(field => field.path.endsWith('.layers'))).toBe(false)
    const bad = structuredClone(input)
    const sample = bad.spaces[0].layers.find(
      (item: { kind: string }) => item.kind === 'terrain-materials',
    ).samples[0][0]
    sample.layers[0].cornerAlpha[0] = 2
    expect(() => validateUvwProfile(bad)).toThrow()
    sample.layers = []
    expect(() => validateUvwProfile(bad)).toThrow()
  })

  it('retains admitted corner UVs through parsing, source pages and generic reconstruction', async () => {
    const input = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    )
    const layer = input.spaces[0].layers.find(
      (layer: { kind: string }) => layer.kind === 'terrain-materials',
    )
    const corners = [
      [-0.25, 1.5],
      [0.75, 1.25],
      [1.125, -0.5],
      [0.125, -0.75],
    ]
    layer.samples[0][0].cornerUv = corners
    layer.samples[0][0].uvTransform = { offset: [0.2, 0.3], scale: [2, -1], rotation: 0.5 }
    const document = validateUvwProfile(input)
    expect(parseUvwProfile(serializeUvwProfile(document))).toEqual(canonicalizeUvwProfile(document))
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'cliff-uv-fixture',
      maxPageSize: 32,
    })
    const layers = await source.page({ facet: 'layers', limit: 32 })
    const materials = layers.items.find(
      item => item.facet === 'layers' && item.kind === 'terrain-materials',
    )!
    const page = await source.page({
      facet: 'terrain-materials',
      layerId: materials.layerId,
      lod: 'exact',
      limit: 32,
    })
    expect(page.items[0]).toMatchObject({
      cornerUv: corners,
      uvTransform: layer.samples[0][0].uvTransform,
    })
    const reconstructed = await materializeWorldToUvw(source, {
      maxPageItems: 32,
      maxTerrainItems: 1000,
      maxFacetItems: 1000,
      maxOutputBytes: 1 << 20,
    })
    expect(reconstructed.state, JSON.stringify(reconstructed.refusals)).toBe('materialized')
    if (reconstructed.state !== 'materialized') return
    const reopened = parseUvwProfile(reconstructed.bytes)
    const result = reopened.spaces[0]!.layers.find(layer => layer.kind === 'terrain-materials')!
    expect(result.kind === 'terrain-materials' && result.samples?.[0]?.[0]?.cornerUv).toEqual(
      corners,
    )
    expect(reconstructed.lostFields.some(field => field.path.endsWith('.cornerUv'))).toBe(false)
    const malformed = structuredClone(input)
    malformed.spaces[0].layers.find(
      (layer: { kind: string }) => layer.kind === 'terrain-materials',
    ).samples[0][0].cornerUv = [[0, 0]]
    expect(() => validateUvwProfile(malformed)).toThrow(/four corner UV/)
    layer.samples[0][0].cornerUv[0][0] = Number.POSITIVE_INFINITY
    expect(() => validateUvwProfile(input)).toThrow()
  })

  it('preserves the published player roster and exact starts through source materialization', async () => {
    const document = parseUvwProfile(await fixture('uvw-players.uvw.json'))
    const originalSpace = document.spaces[0]
    if (originalSpace === undefined) throw new Error('fixture has no space')
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'players-fixture',
      maxPageSize: 3,
    })
    const info = await source.info()
    expect(info.canonicalArtifact?.spaces[0]).toMatchObject({
      players: originalSpace.players,
      startPositions: originalSpace.startPositions,
    })
    expect(info.players).toEqual([
      { id: 0, name: 'Neutral' },
      {
        id: 1,
        name: 'Player One',
        color: [1, 0, 0],
        colorRamp: [
          [0.25, 0, 0],
          [1, 0, 0],
        ],
      },
    ])
    const result = await materializeWorldToUvw(source, {
      maxPageItems: 3,
      maxTerrainItems: 64,
      maxFacetItems: 128,
      maxOutputBytes: 64_000,
    })
    expect(result.state).toBe('materialized')
    if (result.state !== 'materialized') throw new Error('published player fixture was refused')
    const reopened = parseUvwProfile(result.bytes)
    expect(reopened.spaces[0]?.players).toEqual(originalSpace.players)
    expect(reopened.spaces[0]?.startPositions).toEqual(originalSpace.startPositions)
    expect(reopened.spaces[0]?.startPositions?.[0]?.position).toEqual([2, 0.75, 2])
    expect(serializeUvwProfile(reopened)).toEqual(serializeUvwProfile(document))
    expect(result.lostFields).toEqual([])
  })

  it('keeps legacy players unbound, empty tables authoritative and unassigned starts valid', async () => {
    const document = parseUvwProfile(await fixture('uvw-players.uvw.json'))
    const originalSpace = document.spaces[0]
    if (originalSpace === undefined) throw new Error('fixture has no space')
    const legacySpace = { ...originalSpace }
    delete legacySpace.players
    delete legacySpace.startPositions
    expect(
      validateUvwProfile({ ...document, spaces: [legacySpace] }).spaces[0]?.players,
    ).toBeUndefined()
    expect(() =>
      validateUvwProfile({ ...document, spaces: [{ ...legacySpace, players: [] }] }),
    ).toThrow(/undeclared player/)
    const unassigned = validateUvwProfile({
      ...document,
      spaces: [
        {
          ...legacySpace,
          startPositions: [{ id: 'above-ground', position: [2, 37, 2] }],
        },
      ],
    })
    expect(unassigned.spaces[0]?.startPositions?.[0]?.position).toEqual([2, 37, 2])
    expect(() =>
      validateUvwProfile({
        ...document,
        spaces: [
          {
            ...legacySpace,
            startPositions: [{ id: 'bound', position: [2, 37, 2], player: 1 }],
          },
        ],
      }),
    ).toThrow(/undeclared player/)
  })

  it('rejects ambiguous identities, invalid string/color budgets and undeclared slots', async () => {
    const document = parseUvwProfile(await fixture('uvw-players.uvw.json'))
    const space = document.spaces[0]
    const player = space?.players?.[1]
    const start = space?.startPositions?.[0]
    if (space === undefined || player === undefined || start === undefined)
      throw new Error('fixture has no player or start')
    const check = (changes: Readonly<Record<string, unknown>>) =>
      validateUvwProfile({ ...document, spaces: [{ ...space, ...changes }] })
    for (const bad of [
      { ...player, slot: 2147483648 },
      { ...player, address: '' },
      { ...player, address: ' trailing ' },
      { ...player, address: 'nul\0address' },
      { ...player, address: '\ud800' },
      { ...player, address: 'ё'.repeat(513) },
      { ...player, color: [1, 0, -0.1] },
      { ...player, ramp: [] },
      { ...player, name: '' },
      { ...player, unknown: 1 },
    ])
      expect(() => check({ players: [bad] })).toThrow()
    expect(() => check({ players: [player, player] })).toThrow(/duplicate player slot/)
    expect(() => check({ players: [player, { ...player, slot: 2 }] })).toThrow(
      /duplicate player address/,
    )
    expect(() =>
      check({ startPositions: [{ id: 'home', position: [0, 0, 0], player: 2 }] }),
    ).toThrow(/undeclared player/)
    expect(() =>
      check({ startPositions: [start, start] }),
    ).toThrow(/unique/)
  })

  it('retains signed native slots and the full format string budget without inventing a roster', async () => {
    const document = parseUvwProfile(await fixture('uvw-players.uvw.json'))
    const space = document.spaces[0]
    if (space === undefined) throw new Error('fixture has no space')
    const terrain = space.layers.filter(layer => layer.kind !== 'objects')
    const boundary = validateUvwProfile({
      ...document,
      spaces: [
        {
          ...space,
          layers: terrain,
          startPositions: [],
          players: [
            { slot: -2147483648, address: 'ё'.repeat(512) },
            { slot: 2147483647, address: 'other/player' },
          ],
        },
      ],
    })
    expect(boundary.spaces[0]?.players?.[0]?.slot).toBe(-2147483648)
    expect(boundary.spaces[0]?.players?.[0]?.address).toBe('ё'.repeat(512))
  })

  it('preserves separate space rosters without merging equal native slots', async () => {
    const base = parseUvwProfile(await fixture('uvw-players.uvw.json'))
    const space = base.spaces[0]
    if (space === undefined) throw new Error('fixture has no space')
    const document = validateUvwProfile({
      ...base,
      spaces: [space, {
        ...space,
        id: 'second-world',
        players: space.players?.map(player => ({ ...player, address: `other/${player.address}` })),
      }],
    })
    const source = createUvwWorldSceneSource(document, { snapshotId: 'two-rosters' })
    expect((await source.info()).players).toBeUndefined()
    const result = await materializeWorldToUvw(source, {
      maxPageItems: 3,
      maxTerrainItems: 64,
      maxFacetItems: 128,
      maxOutputBytes: 64_000,
    })
    if (result.state !== 'materialized') throw new Error('space rosters were refused')
    expect(serializeUvwProfile(parseUvwProfile(result.bytes))).toEqual(serializeUvwProfile(document))
    expect(result.lostFields).toEqual([])
  })

  it('round-trips authored terrain, specular, colorization and AO lighting settings', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    ) as { spaces: Array<{ layers: Array<Record<string, unknown>> }> }
    const lighting = base.spaces[0]!.layers.find(layer => layer['kind'] === 'lighting')!
    const toneMapping = {
      operator: 'filmic', exposure: 1.2, whitePoint: 2, contrast: 1.1, correctGamma: true,
      colorization: { hue: 0.2, saturation: 0.8, lightness: 0.1, brightness: 1.2, contrast: 1.1, blend: 0.3, inputLow: 0.05, inputHigh: 0.95, inputGamma: 1.1, outputLow: 0.02, outputHigh: 0.98 },
      ambientOcclusion: { radius: 1.2, noOcclusion: 0.1, fullOcclusion: 0.9, power: 1.5 },
    }
    lighting['toneMapping'] = toneMapping
    lighting['terrain'] = { specularExponent: 11.21, diffuseMultiplier: 1, specularMultiplier: 3 }
    const document = parseUvwProfile(serializeUvwProfile(base as unknown as UvwProfileDocument))
    const reopened = parseUvwProfile(serializeUvwProfile(document))
    const layer = reopened.spaces[0]!.layers.find(layer => layer.kind === 'lighting')!
    expect(layer).toMatchObject({ toneMapping, terrain: lighting['terrain'] })
    expect(serializeUvwProfile(reopened)).toEqual(serializeUvwProfile(document))
  })
  it.each(['uvw-profile-single-space.uvw.json', 'uvw-profile-source-units.uvw.json'])(
    'parses, canonicalizes and reopens %s byte-stably',
    async name => {
      const document = parseUvwProfile(await fixture(name))
      const first = serializeUvwProfile(document)
      const reopened = parseUvwProfile(first)
      const second = serializeUvwProfile(reopened)

      expect(second).toEqual(first)
      expect(reopened).toEqual(canonicalizeUvwProfile(document))
      expect(new TextDecoder().decode(first).endsWith('\n')).toBe(true)
    },
  )

  it('keeps source units honest and preserves no-data holes', async () => {
    const sourceUnits = parseUvwProfile(await fixture('uvw-profile-source-units.uvw.json'))
    expect(sourceUnits.spaces[0]?.basis).toMatchObject({
      unit: 'source-unit',
      sourceUnit: 'sc2-game-unit',
      unitsPerCell: 1,
    })
    expect(sourceUnits.spaces[0]?.basis.metersPerUnit).toBeUndefined()

    const withHole = parseUvwProfile(await fixture('uvw-profile-single-space.uvw.json'))
    const terrain = withHole.spaces[0]?.layers[0]
    expect(terrain?.kind).toBe('heightfield')
    if (terrain?.kind !== 'heightfield') throw new Error('fixture heightfield layer is missing')
    expect(terrain?.noDataValue).toBe(-9999)
    expect(terrain?.samples[2]?.[3]).toBe(terrain?.noDataValue)
  })

  it('sorts spaces and layers by UTF-8 id without reordering sample rows', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-source-units.uvw.json')),
    ) as UvwProfileDocument
    const main = base.spaces[0]!
    const unordered = {
      ...base,
      spaces: [
        { ...main, id: 'z-space', layers: [...main.layers].reverse() },
        { ...main, id: 'a-space', layers: [...main.layers].reverse() },
      ],
    }
    const canonical = canonicalizeUvwProfile(unordered)

    expect(canonical.spaces.map(space => space.id)).toEqual(['a-space', 'z-space'])
    expect(canonical.spaces[0]?.layers.map(layer => layer.id)).toEqual(['cliffs', 'water'])
    const canonicalLayer = canonical.spaces[0]?.layers.find(layer => layer.kind === 'heightfield')
    const mainLayer = main.layers.find(layer => layer.kind === 'heightfield')
    expect(canonicalLayer?.kind).toBe('heightfield')
    expect(mainLayer?.kind).toBe('heightfield')
    if (canonicalLayer?.kind !== 'heightfield' || mainLayer?.kind !== 'heightfield') {
      throw new Error('fixture heightfield layer is missing')
    }
    expect(canonicalLayer.samples).toEqual(mainLayer.samples)
  })

  it('rejects malformed profiles, reserved features and semantic grid errors', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-single-space.uvw.json')),
    ) as Record<string, unknown>
    expect(errorCode(() => validateUvwProfile({ ...base, spaces: [] }))).toBe('x3.uv/uvw-invalid')
    expect(errorCode(() => validateUvwProfile({ ...base, connections: [{}] }))).toBe(
      'x3.uv/uvw-feature-unsupported',
    )
    const space = (base['spaces'] as Record<string, unknown>[])[0]!
    expect(
      errorCode(() =>
        validateUvwProfile({ ...base, spaces: [{ ...space, topology: 'tile-grid' }] }),
      ),
    ).toBe('x3.uv/uvw-feature-unsupported')
    const terrain = (space['layers'] as Record<string, unknown>[])[0]!
    expect(
      errorCode(() =>
        validateUvwProfile({
          ...base,
          spaces: [{ ...space, layers: [{ ...terrain, samples: [[0, 1]] }] }],
        }),
      ),
    ).toBe('x3.uv/uvw-invalid')
    expect(
      errorCode(() =>
        validateUvwProfile({
          ...base,
          spaces: [{ ...space, layers: [terrain, { ...terrain }] }],
        }),
      ),
    ).toBe('x3.uv/uvw-invalid')
  })

  it('enforces byte, sample, node and cancellation budgets', async () => {
    const bytes = await fixture('uvw-profile-single-space.uvw.json')
    expect(errorCode(() => parseUvwProfile(bytes, { maxBytes: 8 }))).toBe(
      'x3.uv/uvw-budget-exceeded',
    )
    expect(errorCode(() => parseUvwProfile(bytes, { maxSamples: 4 }))).toBe(
      'x3.uv/uvw-budget-exceeded',
    )
    expect(errorCode(() => parseUvwProfile(bytes, { maxNodes: 4 }))).toBe(
      'x3.uv/uvw-budget-exceeded',
    )
    const controller = new AbortController()
    controller.abort()
    expect(() => parseUvwProfile(bytes, { signal: controller.signal })).toThrow()
  })

  it('rejects invalid UTF-8 and JSON with distinct structured errors', () => {
    expect(errorCode(() => parseUvwProfile(Uint8Array.of(0xff)))).toBe('x3.uv/uvw-utf8-invalid')
    expect(errorCode(() => parseUvwProfile(new TextEncoder().encode('{')))).toBe(
      'x3.uv/uvw-json-invalid',
    )
  })

  it('publishes bounded canonical terrain pages and preserves holes as missing ground', async () => {
    const document = parseUvwProfile(await fixture('uvw-profile-single-space.uvw.json'))
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'fixture-revision-1',
      maxPageSize: 8,
    })
    const info = await source.info()
    expect(info.contract).toBe('common.view/world-scene-source')
    expect(info.coordinateSpaces[0]?.linearUnit).toBe('meter')
    expect(info.facets[0]).toMatchObject({ facet: 'terrain', itemCount: 19, lods: ['exact'] })

    const layerPage = await source.page({ facet: 'layers', limit: 8 })
    const layer = layerPage.items[0]
    expect(layer?.facet).toBe('layers')
    if (layer?.facet !== 'layers') throw new TypeError('fixture layer missing')
    const first = await source.page({
      facet: 'terrain',
      layerId: layer.layerId,
      lod: 'exact',
      limit: 8,
    })
    expect(first.items).toHaveLength(8)
    expect(first.nextCursor).toBeDefined()
    const firstCursor = first.nextCursor
    if (firstCursor === undefined) throw new Error('first terrain page has no cursor')
    const second = await source.page({
      facet: 'terrain',
      layerId: layer.layerId,
      lod: 'exact',
      cursor: firstCursor,
      limit: 8,
    })
    const secondCursor = second.nextCursor
    if (secondCursor === undefined) throw new Error('second terrain page has no cursor')
    const third = await source.page({
      facet: 'terrain',
      layerId: layer.layerId,
      lod: 'exact',
      cursor: secondCursor,
      limit: 8,
    })
    const items = [...first.items, ...second.items, ...third.items]
    expect(items).toHaveLength(19)
    expect(items.some(item => item.facet === 'terrain' && item.x === 3 && item.y === 2)).toBe(false)
    expect(items[0]).toMatchObject({
      facet: 'terrain',
      coordinateSpaceId: 'uvw-space:main',
      uvwPosition: { x: 0, y: 0, z: 0 },
    })
    expect(third.nextCursor).toBeUndefined()
  })

  it('rejects stale cursors and names unsupported world facets', async () => {
    const document = parseUvwProfile(await fixture('uvw-profile-source-units.uvw.json'))
    const source = createUvwWorldSceneSource(document, { snapshotId: 'source-unit-revision' })
    const page = await source.page({ facet: 'water', limit: 1 })
    expect(page).toMatchObject({ state: 'unsupported', facet: 'water' })
    await expect(
      source.page({ facet: 'layers', limit: 1, cursor: 'another|snapshot|1' }),
    ).rejects.toThrow()
  })

  it('reopens and publishes every admitted renderable layer family', async () => {
    const document = parseUvwProfile(await fixture('uvw-profile-renderable-world.uvw.json'))
    const canonical = serializeUvwProfile(document)
    expect(parseUvwProfile(canonical)).toEqual(canonicalizeUvwProfile(document))

    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'renderable-world-revision',
      maxPageSize: 32,
    })
    const info = await source.info()
    expect(info.facets.map(facet => facet.facet).sort()).toEqual([
      'cliffs',
      'gateways',
      'lighting',
      'navigation',
      'objects',
      'regions',
      'resources',
      'terrain',
      'terrain-materials',
      'water',
    ])
    const layerPage = await source.page({ facet: 'layers', limit: 32 })
    const layers = new Map(
      layerPage.items.flatMap(item => (item.facet === 'layers' ? [[item.kind, item]] : [])),
    )
    const page = async (facet: string) => {
      const layer = layers.get(facet as never)
      if (layer === undefined) throw new Error(`missing ${facet} layer`)
      return source.page({ facet, layerId: layer.layerId, lod: 'exact', limit: 32 })
    }
    expect((await page('terrain-materials')).items[0]).toMatchObject({
      facet: 'terrain-materials',
      textureName: 'Grass',
      weights: [{ materialId: 'grass', weight: 1 }],
    })
    expect(layers.get('terrain-materials')?.weightRasters).toEqual([
      {
        resourceId: 'uvw-resource:main/terrain-weights',
        width: 4,
        height: 4,
        materialIds: ['grass'],
        encoding: 'rgba8-unorm',
        normalization: 'sum',
      },
    ])
    expect((await page('water')).items[0]).toMatchObject({
      facet: 'water',
      uvwElevation: 1.5,
      materialId: 'pool-water',
    })
    expect(layers.get('water')?.waterMaterials?.[0]).toMatchObject({
      materialId: 'pool-water',
      shorelineMode: 'terrain-clipped',
      baseColorResourceId: 'uvw-resource:main/water-image',
      secondaryColorResourceId: 'uvw-resource:main/water-secondary-image',
    })
    expect((await page('objects')).items).toHaveLength(2)
    expect((await page('resources')).items).toHaveLength(6)
    expect((await page('cliffs')).items).toHaveLength(4)
    expect((await page('regions')).items[0]).toMatchObject({ facet: 'regions', name: 'Start' })
    expect((await page('navigation')).items).toHaveLength(4)
    expect((await page('lighting')).items[0]).toMatchObject({
      facet: 'lighting',
      ambientIntensity: 0.5,
    })
  })

  it('decodes package-supplied UVW media through the host raster port', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    ) as { spaces: Array<{ layers: Array<Record<string, unknown>> }> }
    const resources = base.spaces[0]!.layers.find(layer => layer['kind'] === 'resources')!
    const grass = (resources['resources'] as Array<Record<string, unknown>>).find(
      resource => resource['id'] === 'grass-image',
    )!
    const document = parseUvwProfile(serializeUvwProfile(base as unknown as UvwProfileDocument))
    let reads = 0
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'embedded-texture-revision',
      embeddedResources: new Map([
        [
          'uvw-resource:main/grass-image',
          { bytes: Uint8Array.of(1, 2, 3), mediaType: 'image/png' },
        ],
      ]),
      rasterResources: {
        async read(request) {
          reads += 1
          expect(request.kind).toBe('embedded')
          if (request.kind !== 'embedded') throw new TypeError('expected embedded raster request')
          expect(request.bytes).toEqual(Uint8Array.of(1, 2, 3))
          expect(request.mediaType).toBe('image/png')
          return {
            state: 'decoded',
            info: {
              width: 1,
              height: 2,
              depth: 1,
              layers: 1,
              faces: 1,
              mipLevels: 1,
              frames: 1,
              channels: 4,
              bitDepth: 8,
              colorSpace: 'srgb',
              alphaMode: 'straight',
              orientation: 'bottom-left',
              decodedAccess: true,
            },
            region: {
              width: 1,
              height: 2,
              rowStride: 8,
              pixelFormat: 'rgba8',
              pixels: Uint8Array.of(5, 6, 7, 255, 0, 0, 0, 0, 1, 2, 3, 255, 0, 0, 0, 0),
            },
            diagnostics: [],
          }
        },
      },
    })
    const result = await source.texture?.('uvw-resource:main/grass-image', { maxBytes: 64 })
    expect(result?.state).toBe('decoded')
    if (result?.state !== 'decoded') return
    expect(reads).toBe(1)
    expect(result.texture).toMatchObject({
      id: 'uvw-resource:main/grass-image',
      width: 1,
      height: 2,
    })
    expect(result.texture.rgba).toEqual(Uint8Array.of(1, 2, 3, 255, 5, 6, 7, 255))
  })

  it('validates and publishes canonical gateway segments without rasterizing their identity', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    ) as { spaces: Array<{ layers: Array<Record<string, unknown>> }> }
    const authoredGateways = base.spaces[0]!.layers.find(layer => layer['kind'] === 'gateways')!
    authoredGateways['segments'] = [
      { id: 'west-pass', start: [0, 1], end: [4, 1] },
      { id: 'east-pass', start: [4, 2], end: [4, 3] },
    ]
    const document = parseUvwProfile(serializeUvwProfile(base as unknown as UvwProfileDocument))
    const source = createUvwWorldSceneSource(document, { snapshotId: 'gateway-revision' })
    const layers = await source.page({ facet: 'layers', limit: 32 })
    const gatewayLayer = layers.items.find(
      item => item.facet === 'layers' && item.kind === 'gateways',
    )
    expect(gatewayLayer).toBeDefined()
    if (gatewayLayer?.facet !== 'layers') return
    const page = await source.page({
      facet: 'gateways',
      layerId: gatewayLayer.layerId,
      lod: 'exact',
      limit: 8,
    })
    expect(page.items).toMatchObject([
      { facet: 'gateways', uvwStart: { x: 0, z: 1 }, uvwEnd: { x: 4, z: 1 } },
      { facet: 'gateways', uvwStart: { x: 4, z: 2 }, uvwEnd: { x: 4, z: 3 } },
    ])
  })

  it('round-trips an acyclic compound model attachment graph through common world pages', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    ) as { spaces: Array<{ layers: Array<Record<string, unknown>> }> }
    const objects = base.spaces[0]!.layers.find(layer => layer['kind'] === 'objects')!
    const instance = (objects['instances'] as Array<Record<string, unknown>>)[0]!
    instance['resourceIds'] = ['model-b', 'model-a']
    instance['modelComponents'] = [
      {
        id: 'weapon',
        resourceId: 'model-b',
        parentId: 'body',
        parentSocketId: 'connector-1',
        rotation: [0, 0, 1, 0],
      },
      { id: 'body', resourceId: 'model-a' },
    ]
    const bytes = serializeUvwProfile(base as unknown as UvwProfileDocument)
    const document = parseUvwProfile(bytes)
    const layer = document.spaces[0]!.layers.find(candidate => candidate.kind === 'objects')
    expect(layer?.kind).toBe('objects')
    if (layer?.kind !== 'objects') return
    expect(layer.instances[0]?.resourceIds).toEqual(['model-a', 'model-b'])
    expect(layer.instances[0]?.modelComponents?.map(component => component.id)).toEqual([
      'body',
      'weapon',
    ])
    const source = createUvwWorldSceneSource(document, { snapshotId: 'compound-model-revision' })
    const layerPage = await source.page({ facet: 'layers', limit: 32 })
    const objectLayer = layerPage.items.find(
      item => item.facet === 'layers' && item.kind === 'objects',
    )
    if (objectLayer?.facet !== 'layers') throw new Error('compound object layer is missing')
    const page = await source.page({ facet: 'objects', layerId: objectLayer.layerId, limit: 8 })
    expect(page.items[0]).toMatchObject({
      modelComponents: [
        { id: 'body', resourceId: 'uvw-resource:main/model-a' },
        {
          id: 'weapon',
          resourceId: 'uvw-resource:main/model-b',
          parentId: 'body',
          parentSocketId: 'connector-1',
          rotation: [0, 0, 1, 0],
        },
      ],
    })
  })

  it('carries a terrain material base colour factor both ways and bounds it', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    ) as { spaces: Array<{ layers: Array<Record<string, unknown>> }> }
    const withFactor = (factor: readonly number[]) => {
      const document = structuredClone(base)
      const materials = document.spaces[0]!.layers.find(
        layer => layer['kind'] === 'terrain-materials',
      )!['materials'] as Array<Record<string, unknown>>
      materials[0]!['baseColorFactor'] = factor
      return document
    }
    const document = validateUvwProfile(withFactor([0.5, 0.25, 1, 1]))
    const source = createUvwWorldSceneSource(document, {
      snapshotId: 'factor-revision',
      maxPageSize: 32,
    })
    const layer = (await source.page({ facet: 'layers', limit: 32 })).items.find(
      item => item.facet === 'layers' && item.kind === 'terrain-materials',
    )
    expect(layer?.facet === 'layers' && layer.materials?.[0]?.baseColorFactor).toEqual([
      0.5, 0.25, 1, 1,
    ])
    expect(errorCode(() => validateUvwProfile(withFactor([1.5, 0, 0, 1])))).toBe(
      'x3.uv/uvw-invalid',
    )
  })

  it('rejects dangling refs, invalid blends, traversal URIs and non-unit rotations', async () => {
    const base = JSON.parse(
      new TextDecoder().decode(await fixture('uvw-profile-renderable-world.uvw.json')),
    ) as { spaces: Array<{ layers: Array<Record<string, unknown>> }> }
    const layers = base.spaces[0]!.layers
    const objects = layers.find(layer => layer['kind'] === 'objects')!
    const resources = layers.find(layer => layer['kind'] === 'resources')!
    const materials = layers.find(layer => layer['kind'] === 'terrain-materials')!

    const dangling = structuredClone(base)
    ;(
      dangling.spaces[0]!.layers.find(layer => layer['kind'] === 'objects')!['instances'] as Array<
        Record<string, unknown>
      >
    )[0]!['resourceIds'] = ['missing']
    expect(errorCode(() => validateUvwProfile(dangling))).toBe('x3.uv/uvw-invalid')

    const traversal = structuredClone(base)
    ;(
      traversal.spaces[0]!.layers.find(layer => layer['kind'] === 'resources')![
        'resources'
      ] as Array<Record<string, unknown>>
    )[0]!['uri'] = '../escape.uvm'
    expect(errorCode(() => validateUvwProfile(traversal))).toBe('x3.uv/uvw-invalid')

    const rotation = structuredClone(base)
    ;(
      rotation.spaces[0]!.layers.find(layer => layer['kind'] === 'objects')!['instances'] as Array<
        Record<string, unknown>
      >
    )[0]!['rotation'] = [0, 0, 0, 2]
    expect(errorCode(() => validateUvwProfile(rotation))).toBe('x3.uv/uvw-invalid')

    const cyclicComponents = structuredClone(base)
    const cyclicInstance = (
      cyclicComponents.spaces[0]!.layers.find(layer => layer['kind'] === 'objects')![
        'instances'
      ] as Array<Record<string, unknown>>
    )[0]!
    cyclicInstance['modelComponents'] = [
      { id: 'a', resourceId: 'model-a', parentId: 'b', parentSocketId: 'connector-1' },
      { id: 'b', resourceId: 'model-a', parentId: 'a', parentSocketId: 'connector-1' },
    ]
    expect(errorCode(() => validateUvwProfile(cyclicComponents))).toBe('x3.uv/uvw-invalid')

    const weights = structuredClone(base)
    const materialSamples = weights.spaces[0]!.layers.find(
      layer => layer['kind'] === 'terrain-materials',
    )!['samples'] as Array<Array<{ weights: Array<Record<string, unknown>> }>>
    materialSamples[0]![0]!.weights[0]!['weight'] = 0.5
    expect(errorCode(() => validateUvwProfile(weights))).toBe('x3.uv/uvw-invalid')

    expect(objects).toBeDefined()
    expect(resources).toBeDefined()
    expect(materials).toBeDefined()
  })
})
