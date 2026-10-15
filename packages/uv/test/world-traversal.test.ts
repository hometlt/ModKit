import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { canonicalizeUvwProfile, createUvwWorldSceneSource, parseUvwProfile, serializeUvwProfile, materializeWorldToUvw, validateUvwProfile } from '../src/world/index.js'
import { materializeWorldToUvpMap, openUvpMapBundle } from '../src/world/package.js'

async function fixture() {
  return JSON.parse(await readFile(new URL('../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-traversal-surface.uvw.json', import.meta.url), 'utf8'))
}
const options = { maxPageItems: 3, maxTerrainItems: 64, maxFacetItems: 128, maxOutputBytes: 128_000 }

it('opens the existing normative traversal/surface fixture and preserves directed topology through source and detached UVP', async () => {
  const input = await fixture()
  // A directed edge need not have its reverse: preserve the graph rather than normalize it.
  input.spaces[0].layers[1].exits[0][1] = 1
  const document = parseUvwProfile(new TextEncoder().encode(JSON.stringify(input)))
  const source = createUvwWorldSceneSource(document, { snapshotId: 'traversal-fixture', maxPageSize: 3 })
  const info = await source.info()
  const facet = info.facets.find(entry => entry.facet === 'traversal')!
  expect(facet).toMatchObject({ state: 'available', itemCount: 9, lods: ['exact'] })
  const page = await source.page({ facet: 'traversal', layerId: facet.layerId, lod: 'exact', limit: 3 })
  expect(page.items[0]).toMatchObject({ facet: 'traversal', x: 0, y: 0, walkable: true, exits: 5, uvwPosition: { x: 0.5, y: 0, z: 0.5 } })
  const rebuilt = await materializeWorldToUvw(source, options)
  expect(rebuilt.state).toBe('materialized')
  if (rebuilt.state !== 'materialized') throw new Error(JSON.stringify(rebuilt.refusals))
  expect(rebuilt.document).toEqual(document)
  expect(parseUvwProfile(serializeUvwProfile(document))).toEqual(document)
  const packed = await materializeWorldToUvpMap(source, { ...options, packageId: 'test/traversal', packageVersion: '1.0.0', maxTextureBytes: 128, maxMediaBytes: 128 })
  if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
  const detached = await openUvpMapBundle(new Map([...packed.entries].map(([name, bytes]) => [name, bytes.slice()])), { snapshotId: 'detached-traversal' })
  const again = await materializeWorldToUvw(detached.source, options)
  expect(again.state).toBe('materialized')
  if (again.state === 'materialized') expect(again.document).toEqual(document)
})

it('refuses invalid directed topology, repeated classes, displaced grids, incomplete data and invalid surface bindings', async () => {
  const mutations: ((value: Awaited<ReturnType<typeof fixture>>) => void)[] = [
    value => { value.spaces[0].layers[1].exits[0][0] = -1 },
    value => { value.spaces[0].layers[1].exits[0][0] = 16 },
    value => { value.spaces[0].layers[1].exits[0][0] = 2 },
    value => { value.spaces[0].layers[1].exits[1][1] = 1 },
    value => { value.spaces[0].layers[1].exits[0][1] = 4 },
    value => { value.spaces[0].layers[1].walkable[0].pop() },
    value => { delete value.spaces[0].layers[1].walkable[1][1] },
    value => { delete value.spaces[0].layers[1].exits[1][1] },
    value => { delete value.spaces[0].layers[1].walkable[1] },
    value => { value.spaces[0].layers[1].exits.pop() },
    value => { value.spaces[0].layers[1].origin = [0, -1, 0] },
    value => { value.spaces[0].layers[1].cellSize = 2 },
    value => { value.spaces[0].layers[1].surfaceLayerId = 'missing' },
    value => { value.spaces[0].layers[1].surfaceLayerId = 'traversal-ground' },
    value => { value.spaces[0].layers[0].cellSize = 0.5 },
    value => { value.spaces[0].layers.push({ ...value.spaces[0].layers[1], id: 'duplicate-class' }) },
    value => { value.spaces[0].layers[1].classId = 'unscoped invalid id' },
  ]
  for (const mutate of mutations) {
    const input = await fixture(); mutate(input)
    expect(() => validateUvwProfile(input)).toThrow()
  }
  const mesh = await fixture()
  mesh.spaces[0].topology = 'mesh'
  mesh.spaces[0].layers = [mesh.spaces[0].layers[1], { schemaVersion: 1, id: 'objects', kind: 'objects', instances: [] }]
  delete mesh.spaces[0].layers[0].surfaceLayerId
  expect(validateUvwProfile(mesh).spaces[0]!.layers.find(layer => layer.kind === 'traversal')).not.toHaveProperty('surfaceLayerId')
  const overBudget = await fixture()
  expect(() => validateUvwProfile(overBudget, { maxSamples: 25 })).toThrow('maxSamples')
})

it('retains topology-only graphs without inventing a surface or runtime movement', async () => {
  const input = await fixture()
  delete input.spaces[0].layers[1].surfaceLayerId
  input.spaces[0].layers[1].walkable = input.spaces[0].layers[1].walkable.map((row: boolean[]) => row.map(() => true))
  input.spaces[0].layers[1].exits = input.spaces[0].layers[1].exits.map((row: number[]) => row.map(() => 0))
  const source = createUvwWorldSceneSource(parseUvwProfile(new TextEncoder().encode(JSON.stringify(input))), { snapshotId: 'no-surface' })
  const result = await materializeWorldToUvw(source, options)
  if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
  const traversal = result.document.spaces[0]!.layers.find(layer => layer.kind === 'traversal')!
  expect(traversal).not.toHaveProperty('surfaceLayerId')
  expect(traversal).toMatchObject({ exits: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] })
})

it('keeps independent movement classes and refuses incomplete or displaced source cells during reconstruction', async () => {
  const input = await fixture()
  input.spaces[0].layers.push({ ...input.spaces[0].layers[1], id: 'traversal-air', classId: 'air' })
  const document = validateUvwProfile(input)
  const source = createUvwWorldSceneSource(document, { snapshotId: 'two-classes', maxPageSize: 3 })
  const exact = await materializeWorldToUvw(source, options)
  if (exact.state !== 'materialized') throw new Error(JSON.stringify(exact.refusals))
  expect(exact.document).toEqual(canonicalizeUvwProfile(document))
  for (const corrupt of ['missing', 'duplicate', 'displaced'] as const) {
    const broken = { ...source, page: async (request: Parameters<typeof source.page>[0]) => {
      const page = await source.page(request)
      if (request.facet !== 'traversal') return page
      const cells = page.items
      return { ...page, items: corrupt === 'missing' ? cells.slice(1) : cells.map((cell, index) =>
        cell.facet === 'traversal' && index === 1
          ? corrupt === 'duplicate' ? cells[0]! : { ...cell, uvwPosition: { ...cell.uvwPosition, x: cell.uvwPosition.x + 0.25 } }
          : cell) }
    } }
    expect((await materializeWorldToUvw(broken, options)).state).toBe('refused')
  }
})
