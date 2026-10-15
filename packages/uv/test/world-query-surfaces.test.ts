import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createUvwWorldSceneSource, validateUvwProfile, materializeWorldToUvw, materializeWorldToUvpMap, openUvpMapBundle } from '../src/world/index.js'
import { materializeUvmCore } from '../src/model/materializer.js'
import { createEmbeddedUvmWorldModelDecoder } from '../../scene/src/world/embedded-uvm.js'
import { createWorldWebGlPlan } from '../../scene/src/world/webgl.js'
import type { WorldSceneItem } from '@modkit/sdk/maps'

async function fixture() {
  return JSON.parse(await readFile(new URL('../../../vendor/multiverse-specs/specs/world/fixtures/uvw-profile-query-surface.uvw.json', import.meta.url), 'utf8'))
}
const options = { maxPageItems: 4, maxTerrainItems: 64, maxFacetItems: 256, maxOutputBytes: 1 << 20,
  packageId: 'test/query-surface', packageVersion: '1.0.0', maxTextureBytes: 1024, maxMediaBytes: 1 << 20 }
const triangle = { nodes: [{ id: 'node', childIds: [], meshIds: ['mesh'], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }], materials: [], primitives: [{ id: 'triangle', topology: 'triangles' as const,
    positions: Float32Array.of(0, 5, 0, 3, 5, 0, 0, 5, 3), indices: Uint32Array.of(0, 1, 2) }] }
const modelBytes = materializeUvmCore({ ...triangle, info: { scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 0, textures: 0, animations: 0, geometryAccess: 'decoded' },
  resourceClosure: { mode: 'content-qualified', entries: [] } }, {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' }, profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:query-model' as never, options: { assetId: 'fixture/query-model', sourceFormat: 'fixture' },
}).bytes

async function modelSource() {
  const input = await fixture()
  input.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'objects').instances = [{ id: 'scene', objectKind: 'doodad',
    position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], resourceIds: ['scene-model'] }]
  input.spaces[0].layers.push({ schemaVersion: 1, id: 'models', kind: 'resources', resources: [{ id: 'scene-model', kind: 'uvm', uri: 'source/scene.uvm.glb' }] })
  const base = createUvwWorldSceneSource(validateUvwProfile(input), { snapshotId: 'query-model' })
  return { ...base, async model() { return { state: 'converted' as const, sourceKey: 'query-model', uvmBytes: modelBytes.slice(),
    ...triangle, resources: [], textures: [], diagnostics: [], complete: true } } }
}
async function allItems(source: ReturnType<typeof createUvwWorldSceneSource>) {
  const items: WorldSceneItem[] = [], info = await source.info()
  for (const facet of info.facets) {
    let cursor: string | undefined
    do {
      const page = await source.page({ facet: facet.facet, layerId: facet.layerId, lod: 'exact', limit: 64, ...(cursor === undefined ? {} : { cursor }) })
      items.push(...page.items); cursor = page.nextCursor
    } while (cursor !== undefined)
  }
  return items
}

it('retains model geometry and non-rendered navigation heights through detached UVP without generating ground', async () => {
  const source = await modelSource()
  const info = await source.info()
  expect(info.facets.some(facet => facet.facet === 'terrain')).toBe(false)
  expect(info.facets.find(facet => facet.facet === 'surfaces')).toMatchObject({ state: 'available', itemCount: 16 })
  const packed = await materializeWorldToUvpMap(source, options)
  if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
  expect(packed.packagedModelCount).toBe(1); expect(packed.observedTerrainItems).toBe(0)
  const modelPath = [...packed.entries.keys()].find(path => path.endsWith('.uvm.glb'))!
  const damagedModel = packed.entries.get(modelPath)!.slice()
  damagedModel[damagedModel.length - 1] = damagedModel[damagedModel.length - 1]! ^ 1
  const damaged = new Map(packed.entries); damaged.set(modelPath, damagedModel)
  await expect(openUvpMapBundle(damaged, { snapshotId: 'damaged-model' })).rejects.toThrow('hash mismatch')
  const reopened = await openUvpMapBundle(new Map([...packed.entries].map(([name, bytes]) => [name, bytes.slice()])),
    { snapshotId: 'query-detached', modelDecoder: createEmbeddedUvmWorldModelDecoder() })
  const again = await materializeWorldToUvw(reopened.source, options)
  if (again.state !== 'materialized') throw new Error(JSON.stringify(again.refusals))
  expect(again.document).toEqual(packed.document)
  expect(again.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).toMatchObject({ role: 'query', samples: [[0, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]] })
  const items = await allItems(reopened.source)
  const object = items.find(item => item.facet === 'objects')!
  if (object.facet !== 'objects') throw new Error('model object missing')
  const resourceId = object.resourceIds![0]!
  const model = await reopened.source.model!(resourceId, { maxBytes: 1 << 20, maxMeshes: 4, maxPrimitives: 4, maxPrimitiveBytes: 1 << 20 })
  const plan = createWorldWebGlPlan({ items, models: new Map([[resourceId, model]]) })
  expect(plan.stats.modelTriangles).toBe(1)
  expect(plan.stats.terrainTriangles).toBe(0)
})

it('preserves singleton query coordinates without padding and rejects singleton rendered ground', async () => {
  const input = await fixture(), space = input.spaces[0]
  space.bounds = { min: [0, 0, 0], max: [1, 7, 1] }
  Object.assign(space.layers.find((layer: { kind: string }) => layer.kind === 'heightfield'), { columns: 1, rows: 1, origin: [0.5, 0, 0.5], samples: [[7]] })
  Object.assign(space.layers.find((layer: { kind: string }) => layer.kind === 'traversal'), { columns: 1, rows: 1, origin: [0, 0, 0], walkable: [[true]], exits: [[0]] })
  const source = createUvwWorldSceneSource(validateUvwProfile(input), { snapshotId: 'point-surface' })
  const result = await materializeWorldToUvw(source, options)
  if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
  expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).toMatchObject({ columns: 1, rows: 1, samples: [[7]], role: 'query' })
  delete space.layers.find((layer: { kind: string }) => layer.kind === 'heightfield').role
  expect(() => validateUvwProfile(input)).toThrow()
})

it('keeps ground and query surfaces independent in a heightfield world', async () => {
  const input = await fixture(), space = input.spaces[0]
  space.topology = 'heightfield'
  space.layers.push({ id: 'ground', kind: 'heightfield', role: 'ground', columns: 2, rows: 2, cellSize: 3, origin: [0, 0, 0], samples: [[0, 0], [0, 0]] })
  const source = createUvwWorldSceneSource(validateUvwProfile(input), { snapshotId: 'ground-and-query' })
  const result = await materializeWorldToUvw(source, options)
  if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
  expect(result.document.spaces[0]!.layers.filter(layer => layer.kind === 'heightfield').map(layer => layer.role)).toEqual(['ground', 'query'])
  const plan = createWorldWebGlPlan({ items: await allItems(source), models: new Map() })
  expect(plan.stats.terrainTriangles).toBe(2)
})

it('refuses query presentation, bad references, invalid bounds and unknown roles instead of inventing height data', async () => {
  for (const mutate of [
    (space: Awaited<ReturnType<typeof fixture>>['spaces'][0]) => { space.layers.find((layer: { kind: string }) => layer.kind === 'heightfield').cliffFaces = [] },
    (space: Awaited<ReturnType<typeof fixture>>['spaces'][0]) => { space.layers.find((layer: { kind: string }) => layer.kind === 'heightfield').role = 'preview' },
    (space: Awaited<ReturnType<typeof fixture>>['spaces'][0]) => { space.layers.find((layer: { kind: string }) => layer.kind === 'heightfield').samples[0][0] = 100 },
    (space: Awaited<ReturnType<typeof fixture>>['spaces'][0]) => { space.layers.find((layer: { kind: string }) => layer.kind === 'traversal').surfaceLayerId = 'missing' },
  ]) { const input = await fixture(); mutate(input.spaces[0]); expect(() => validateUvwProfile(input)).toThrow() }
})

it('preserves NoData and refuses dropped samples or duplicate coordinates even when the value equals NoData', async () => {
  const input = await fixture()
  input.spaces[0].layers.find((layer: { kind: string }) => layer.kind === 'heightfield').noDataValue = 0
  const source = createUvwWorldSceneSource(validateUvwProfile(input), { snapshotId: 'query-nodata', maxPageSize: 4 })
  const result = await materializeWorldToUvw(source, options)
  if (result.state !== 'materialized') throw new Error(JSON.stringify(result.refusals))
  expect(result.document.spaces[0]!.layers.find(layer => layer.kind === 'heightfield')).toMatchObject({ role: 'query', noDataValue: 0, samples: [[0, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]] })
  for (const corrupt of ['missing', 'duplicate'] as const) {
    const broken = { ...source, page: async (request: Parameters<typeof source.page>[0]) => {
      const page = await source.page(request)
      if (request.facet !== 'surfaces') return page
      const first = page.items[0]
      return { ...page, items: corrupt === 'missing' ? page.items.slice(1) : page.items.map((item, index) =>
        index < 2 && first?.facet === 'surfaces' ? { ...first, uvwPosition: { ...first.uvwPosition!, y: 0 } } : item) }
    } }
    expect((await materializeWorldToUvw(broken, options)).state).toBe('refused')
  }
})
