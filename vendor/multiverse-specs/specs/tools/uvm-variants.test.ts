import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { assertUvmVariants, assertUvmVariantClosure, uvmVariantModelReferences } from './uvm-variants.ts'
import { probeModelContracts } from './uvm-variants-browser.ts'
import type { ContractProbe, ModelBytes } from './uvm-variants-browser.ts'
import { uvpMediaArtifactDigest } from './uv-canonical-form.mjs'
import { runBrowserWorker } from '../../runtime/test/browser-runner.ts'

const tools: {
  readGltfFixture(path: string): { document: Record<string, unknown>; binary: Uint8Array }
  packGlb(document: unknown, binary: Uint8Array): Uint8Array
} = await import(new URL('./uvm-core.mjs', import.meta.url).href)
const seed = tools.readGltfFixture(fileURLToPath(new URL('../model/fixtures/uvm-core-triangle.uvm.gltf', import.meta.url)))
function model() {
  return { ...structuredClone(seed.document), extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_socket'],
    nodes: [{ mesh: 0, extensions: { UV_game_socket: { id: 'weapon', role: 'hardpoint' } } }],
    extensions: structuredClone(seed.document['extensions']) as Record<string, unknown> }
}
const hash = 'a'.repeat(64)
function variants() {
  const document = model(); document.extensionsUsed.push('UV_game_variants', 'UV_game_model_states', 'KHR_materials_variants')
  const game = { visibility: [{ mesh: 0, primitive: 0, value: 0.4 }], variants: [
    { name: 'body', slot: 'body', default: true, showNodes: [0], materialVariant: 0 },
    { name: 'armed', slot: 'equipment', default: true, showPrimitives: [{ mesh: 0, primitive: 0 }],
      attachments: [{ socket: 'weapon', asset: 'gun.uvm.glb', assetSha256: hash }] },
    { name: 'damaged', slot: 'body', modelState: 'damage' },
    { name: 'wreck', slot: 'body', asset: 'wreck.uvm.glb', assetSha256: hash, alignSocket: 'weapon' },
  ], transitions: [{ from: 'body', to: 'damaged', trigger: 'damage' }] }
  document.extensions['UV_game_variants'] = game
  document.extensions['UV_game_model_states'] = { schemaVersion: 1, states: [{ state: 'damage', model: 'damage.uvm.glb', modelSha256: hash }] }
  document.extensions['KHR_materials_variants'] = { variants: [{ name: 'paint' }] }
  return { document, game }
}
test('independent slots, named states and primitive fades preserve authored values', () => {
  const { document, game } = variants(), original = structuredClone(document)
  assert.doesNotThrow(() => assertUvmVariants(document))
  for (const value of [-10, 0, 0.4, 1, 50]) { game.visibility[0]!.value = value; assertUvmVariants(document) }
  game.visibility[0]!.value = 0.4
  assert.deepEqual(document, original)
  const references = uvmVariantModelReferences(document, 'models/body.uvm.glb')
  assert.deepEqual(references.map(value => value.path), ['models/damage.uvm.glb', 'models/gun.uvm.glb', 'models/wreck.uvm.glb'])
  assert.equal(references[1]!.hostPath, 'models/body.uvm.glb')
  game.variants[1]!.attachments![0]!.asset = '../parts/gun.uvm.glb'
  assert.equal(uvmVariantModelReferences(document, 'models/body.uvm.glb')[1]!.path, 'parts/gun.uvm.glb')
  game.variants[1]!.attachments![0]!.asset = '../../escape.uvm.glb'
  assert.throws(() => uvmVariantModelReferences(document, 'models/body.uvm.glb'), /resource-uri/)
})
test('malformed variants refuse rather than guess indices, slots, defaults or sockets', () => {
  const mutations: ((input: ReturnType<typeof variants>) => void)[] = [
    ({ game }) => { game.variants[1]!.name = 'body' },
    ({ game }) => { game.variants[1]!.slot = 'body' },
    ({ game }) => { game.variants[0]!.showNodes = [99] },
    ({ game }) => { game.variants[1]!.showPrimitives![0]!.primitive = 99 },
    ({ game }) => { game.variants[1]!.showPrimitives!.push({ mesh: 0, primitive: 0 }) },
    ({ game }) => { Object.assign(game.variants[0]!, { hideNodes: [0] }) },
    ({ game }) => { game.variants[2]!.modelState = 'missing' },
    ({ game }) => { Object.assign(game.variants[2]!, { asset: 'other.uvm.glb' }) },
    ({ game }) => { game.variants[0]!.materialVariant = 99 },
    ({ game }) => { game.variants[1]!.attachments![0]!.socket = 'missing' },
    ({ game }) => { game.variants[1]!.attachments!.push({ socket: 'weapon', asset: 'x', assetSha256: hash }) },
    ({ game }) => { game.transitions[0]!.to = 'armed' },
    ({ game }) => { game.visibility[0]!.value = NaN },
    ({ game }) => { game.variants[3]!.assetSha256 = 'bad' },
    ({ game }) => { Object.assign(game, { unknown: 1 }) },
    ({ document }) => { document.extensionsUsed = [] },
  ]
  for (const mutate of mutations) { const input = variants(); mutate(input); assert.throws(() => assertUvmVariants(input.document), /model-variants-/) }
})
async function packed(path: string, document: unknown): Promise<ModelBytes> {
  const bytes = tools.packGlb(document, seed.binary)
  return { path, bytes, hash: await uvpMediaArtifactDigest(bytes) }
}
async function probe(): Promise<ContractProbe> {
  const child = await packed('models/gun.uvm.glb', model()), damaged = await packed('models/damage.uvm.glb', model())
  const body = model(); body.extensionsUsed.push('UV_game_variants', 'UV_game_model_states')
  body.nodes[0]!.extensions.UV_game_socket.id = 'base-only'
  const game = { variants: [{ name: 'gun', slot: 'weapon', attachments: [
    { socket: 'weapon', asset: 'gun.uvm.glb', assetSha256: child.hash.slice(7) }], modelState: 'damage' }] }
  body.extensions['UV_game_variants'] = game
  body.extensions['UV_game_model_states'] = { schemaVersion: 1, states: [{ state: 'damage', model: 'damage.uvm.glb', modelSha256: damaged.hash.slice(7) }] }
  const valid = await packed('models/body.uvm.glb', body)
  const noHash = structuredClone(body)
  delete ((noHash.extensions['UV_game_variants'] as typeof game).variants[0]!.attachments[0]! as Partial<{ assetSha256: string }>).assetSha256
  const invalid = await packed('models/body.uvm.glb', noHash)
  const stale = structuredClone(body); (stale.extensions['UV_game_variants'] as typeof game).variants[0]!.attachments[0]!.assetSha256 = hash
  const bad = await packed('models/body.uvm.glb', stale)
  const noSocket = model(); noSocket.nodes[0]!.extensions.UV_game_socket.id = 'other'
  const wrongHost = await packed('models/damage.uvm.glb', noSocket), socketBody = structuredClone(body)
  socketBody.extensions['UV_game_model_states'] = { schemaVersion: 1, states: [
    { state: 'damage', model: 'damage.uvm.glb', modelSha256: wrongHost.hash.slice(7) }] }
  const invalidSocket = await packed('models/body.uvm.glb', socketBody)
  const reference = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-renderable-world.uvw.json', import.meta.url), 'utf8')) as {
    spaces: { layers: { id: string; kind: string; model?: unknown; unlitColor?: unknown }[] }[] }
  const world = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-single-space.uvw.json', import.meta.url), 'utf8')) as typeof reference
  const light = reference.spaces[0]!.layers.find(layer => layer.kind === 'lighting')!
  world.spaces[0]!.layers.push(light)
  world.spaces[0]!.layers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  light.model = 'unlit'; light.unlitColor = [0.5, 1, 0.25]
  const worlds = [world, structuredClone(world), structuredClone(world), structuredClone(world)]
  worlds[1]!.spaces[0]!.layers.find(layer => layer.kind === 'lighting')!.model = ['lit']
  worlds[2]!.spaces[0]!.layers.find(layer => layer.kind === 'lighting')!.unlitColor = [1, 1, 1.1]
  delete worlds[3]!.spaces[0]!.layers.find(layer => layer.kind === 'lighting')!.unlitColor
  const source = variants(), badVariant = structuredClone(source.document)
  badVariant.extensions['UV_game_variants'] = { variants: [{ name: 'x', showPrimitives: [{ mesh: 0, primitive: 99 }] }] }
  return { variants: [source.document, badVariant], worlds,
    packages: [[valid, child, damaged], [valid, damaged], [invalid, child, damaged], [bad, child, damaged],
      [invalidSocket, child, wrongHost], [valid, { ...child, family: 'media' }, damaged]] }
}
test('actual composition closes unselected models and checks immutable bytes and host sockets', async () => {
  const input = await probe(), output = await probeModelContracts(input) as {
    worlds: { exact?: boolean; error?: string }[]; packages: { models?: unknown[]; rule?: string; message?: string }[] }
  assert.equal(output.packages[0]!.models!.length, 3)
  for (const result of output.packages.slice(1)) assert.equal(result.rule, 'model-variant-resource')
  assert.match(output.packages[1]!.message!, /unverified/)
  assert.match(output.packages[2]!.message!, /digest/)
  assert.match(output.packages[3]!.message!, /digest/)
  assert.match(output.packages[4]!.message!, /socket/)
  assert.match(output.packages[5]!.message!, /unverified/)
  assert.deepEqual(output.worlds.map(value => value.exact ?? value.error?.split(':')[0]), [true, 'lighting-value', 'lighting-value', true])
})
test('captured attachment graphs refuse recursion and cap depth without a second loader', () => {
  const make = (i: number, to?: number) => {
    const document = model(); document.extensionsUsed.push('UV_game_variants')
    document.extensions['UV_game_variants'] = { variants: [{ name: 'attached', attachments: to === undefined ? [] : [
      { socket: 'weapon', asset: `${to}.uvm.glb`, assetSha256: hash }] }] }
    return { packageId: 'sample/graph', path: `${i}.uvm.glb`, digest: `sha256:${hash}`, document }
  }
  assert.throws(() => assertUvmVariantClosure([make(0, 1), make(1, 0)]), /model-variant-cycle/)
  assert.doesNotThrow(() => assertUvmVariantClosure(Array.from({ length: 17 }, (_, i) => make(i, i < 16 ? i + 1 : undefined))))
  assert.throws(() => assertUvmVariantClosure(Array.from({ length: 18 }, (_, i) => make(i, i < 17 ? i + 1 : undefined))), /model-variant-depth/)
})
test('model variants and unlit worlds have identical admission in Node and real Chrome', {
  skip: process.env['MULTIVERSE_TEST_REAL_BROWSER'] !== '1',
}, async () => {
  const input = await probe(), expected = await probeModelContracts(input)
  const browser = await runBrowserWorker(new URL('./uvm-variants-browser.ts', import.meta.url), input)
  assert.deepEqual(browser.result, expected)
})
