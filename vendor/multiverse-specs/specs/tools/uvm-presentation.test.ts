import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvmTeamColor, assertUvmScenePresentation, assertUvmTeamColorAnimations, assertUvwCamera } from './uvm-presentation.ts'
import { probePresentation } from './uvm-presentation-browser.ts'
import { runBrowserWorker } from '../../runtime/test/browser-runner.ts'

type Row = Record<string, unknown>
type Mutation = { op: 'set' | 'delete'; path: string; value?: unknown }
const read = async (path: string): Promise<Row> => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as Row
const cases = await read('../model/fixtures/uvm-presentation-cases.json'), seed = await read('../model/fixtures/uvm-core-presentation.uvm.gltf')
const tools: { assertUvmCore(document: unknown): unknown } = await import(new URL('./uvm-core.mjs', import.meta.url).href)
const mutations: { applyMutations(value: unknown, changes: readonly Mutation[]): unknown } = await import(new URL('./mutations.mjs', import.meta.url).href)
const changed = (value: Row, changes: readonly Mutation[]): Row => mutations.applyMutations(value, changes) as Row
const set = (path: string, value: unknown): Mutation => ({ op: 'set', path, value })
const teamPath = 'materials.0.extensions.UV_game_material_team_color.'
function model(): Row { return structuredClone(seed) }
const strengthChannel = { sampler: 0, target: { path: 'pointer', extensions: { KHR_animation_pointer: {
  pointer: '/materials/0/extensions/UV_game_material_team_color/strength' } } } }
function animated(): Row {
  const document = model(), accessors = document['accessors'] as unknown[], start = accessors.length
  return { ...document, extensionsUsed: [...document['extensionsUsed'] as unknown[], 'KHR_animation_pointer'],
    accessors: [...accessors, { type: 'SCALAR', componentType: 5126, count: 2 }, { type: 'SCALAR', componentType: 5126, count: 2 }],
    animations: [{ samplers: [{ input: start, output: start + 1 }], channels: [structuredClone(strengthChannel)] }] }
}
test('channelKey, exact 8/16 shade ramps and mask-rgb retain their authored shape', () => {
  const original = structuredClone(cases)
  for (const key of ['channelKey', 'ramp8', 'ramp16', 'maskRgb']) assertUvmTeamColor(cases[key], { index: 0 })
  assert.deepEqual(cases, original)
  assert.doesNotThrow(() => tools.assertUvmCore(model()))
  for (const billboard of cases['billboards'] as unknown[]) assertUvmScenePresentation(changed(model(), [
    set('nodes.0.extensions.UV_node_billboard', billboard)]))
})
test('invalid key/ramp data, mask references and UV declarations refuse in common UVM admission', () => {
  const edits: Mutation[][] = [
    [set(teamPath + 'blend', 'multiply')], [set(teamPath + 'keyThreshold', 0.5)],
    [set(teamPath + 'keyChannels', ['r', 'r'])], [set(teamPath + 'intensityChannel', 'rgb')],
    [set(teamPath + 'secondaryMaskTexture.index', 999)], [set(teamPath + 'secondaryMaskTexture.channel', 'rgb')],
    [set(teamPath + 'secondaryMaskTexture.extensions.KHR_texture_transform.pivot', [0.5, 0.5])],
    [set('extensionsUsed', (seed['extensionsUsed'] as unknown[]).filter(v => v !== 'KHR_texture_transform'))],
    [set(teamPath.slice(0, -1), { ...cases['ramp8'] as Row, ramp: (cases['ramp16'] as Row)['ramp'] })],
    [set(teamPath.slice(0, -1), { ...cases['ramp8'] as Row, range: [16, 8] })],
    [set('textures.0.extensions.UV_texture_alpha.ignoreStoredAlpha', 1)],
  ]
  for (const edit of edits) assert.throws(() => tools.assertUvmCore(changed(model(), edit)), /material-|model-presentation/)
})
test('strength and independent secondary UV use KHR pointers with checked target/accessor joins', () => {
  const source = animated(); assertUvmTeamColorAnimations(source)
  const offsetPointer = '/materials/0/extensions/UV_game_material_team_color/secondaryMaskTexture/extensions/KHR_texture_transform/offset'
  const d = changed(source, [set('animations.0.channels.0.target.extensions.KHR_animation_pointer.pointer', offsetPointer), set('accessors.5.type', 'VEC2')])
  assertUvmTeamColorAnimations(d)
  const offsetChannel = { ...strengthChannel, target: { ...strengthChannel.target,
    extensions: { KHR_animation_pointer: { pointer: offsetPointer } } } }
  const edits: Mutation[][] = [
    [set('accessors.5.type', 'SCALAR')], [set('animations.0.channels', [offsetChannel, offsetChannel])],
    [{ op: 'delete', path: teamPath + 'secondaryMaskTexture.extensions.KHR_texture_transform.offset' }],
    [set('animations.0.channels.0.target.path', 'translation')],
    [set('animations.0.channels.0.target.extensions.KHR_animation_pointer.pointer', '/materials/999/extensions/UV_game_material_team_color/strength')],
    [set('accessors.5.count', 3)],
  ]
  for (const edit of edits) assert.throws(() => assertUvmTeamColorAnimations(changed(d, edit)), /model-presentation/)
})
test('scene constraints refuse zero quaternions, lost frames and malformed intensity tracks', () => {
  const lightPath = 'extensions.UV_scene_lights.lights.0.'
  const edits: Mutation[][] = [
    [set('nodes.0.extensions.UV_node_billboard.basisRotations', [[0, 0, 0, 0]])],
    [set('extensions.UV_scene_lights.spaceNode', 999)], [set(lightPath + 'direction', [0, 0, 0])],
    [{ op: 'delete', path: lightPath + 'position' }],
    [set(lightPath + 'sequenceAnimation.intensity.0.track.keys.0.vector', [1, 2])],
    [set(lightPath + 'sequenceAnimation.intensity.0.track.keys.1.frame', -1)],
  ]
  for (const edit of edits) assert.throws(() => assertUvmScenePresentation(changed(model(), edit)), /model-presentation/)
})
test('initial UVW tint/clip round-trip exactly and admissions match in Node and Chrome', async () => {
  const { restoreUvwProfileDocument } = await import('./uvw-profile.mjs')
  const gltf = await read('../world/fixtures/uvw-gltf-spatial.uvw.gltf'), world = restoreUvwProfileDocument(gltf)
  const layers = (world['spaces'] as { layers: unknown[] }[])[0]!.layers
  const index = layers.length
  layers.push({ schemaVersion: 1, id: 'z-presentation-objects', kind: 'objects', instances: [cases['object']] })
  const invalid = changed(world, [set(`spaces.0.layers.${index}.instances.0.presentationTint.0`, 2)])
  const badModel = changed(model(), [set(teamPath + 'blend', 'multiply')])
  const input = { models: [model(), badModel], worlds: [world, invalid] }, result = probePresentation(input) as {
    models: { accepted?: boolean; refusal?: string }[]; worlds: { accepted?: boolean; exact?: boolean; refusal?: string }[] }
  assert.equal(result.models[0]!.accepted, true); assert.match(result.models[1]!.refusal!, /model-presentation/)
  assert.deepEqual(result.worlds[0], { accepted: true, exact: true }); assert.match(result.worlds[1]!.refusal!, /model-presentation/)
  const browser = await runBrowserWorker(new URL('./uvm-presentation-browser.ts', import.meta.url), input)
  assert.deepEqual(browser.result, result)
})

test('scene camera registers the existing sparse lens ABI and rejects incompatible tracks', async () => {
  const cameraCases = await read('../model/fixtures/uvm-camera-cases.json')
  const document = model()
  document['extensionsUsed'] = [...document['extensionsUsed'] as unknown[], 'UV_scene_camera']
  document['cameras'] = [cameraCases['camera']]
  const valid = structuredClone(document)
  assert.doesNotThrow(() => tools.assertUvmCore(document))
  assert.deepEqual(document, valid)
  const cameraPath = 'cameras.0.extensions.UV_scene_camera.'
  const edits: Mutation[][] = [
    [set(cameraPath + 'version', 2)], [set('cameras.0.type', 'orthographic')],
    [set('extensionsUsed', (document['extensionsUsed'] as unknown[]).filter(v => v !== 'UV_scene_camera'))],
    [set('cameras.0.perspective.znear', 0)], [set('cameras.0.perspective.zfar', 0.1)],
    [{ op: 'delete', path: 'cameras.0.perspective.zfar' }],
    [set(cameraPath + 'sequenceAnimation.yfov.0.track.keys.0.vector', [0])],
    [set(cameraPath + 'sequenceAnimation.yfov.0.track.keys.0.vector', [Math.PI])],
    [set(cameraPath + 'sequenceAnimation.znear.0.track.keys.0.vector', [0.1, 0.2])],
    [set(cameraPath + 'sequenceAnimation.yfov.0.track.keys.1.frame', -1)],
    [set(cameraPath + 'sequenceAnimation.aspectRatio', [])],
    [set(cameraPath + 'sequenceAnimation.yfov.0.wrapSeconds', 0)],
    [{ op: 'delete', path: cameraPath + 'sequenceAnimation.yfov.0.track.globalSeqId' }],
  ]
  const models = [document, ...edits.map(edit => changed(document, edit))]
  const input = { models, worlds: [] }, result = probePresentation(input) as { models: { accepted?: boolean; refusal?: string }[] }
  assert.equal(result.models[0]!.accepted, true)
  for (const refused of result.models.slice(1)) assert.match(refused.refusal!, /model-presentation/)
  const browser = await runBrowserWorker(new URL('./uvm-presentation-browser.ts', import.meta.url), input)
  assert.deepEqual(browser.result, result)
})

test('world camera survives both envelopes and changes identity without supplying a physical scale', async () => {
  const { restoreUvwProfileDocument, createUvwGltfDocument } = await import('./uvw-profile.mjs')
  const { jcsStringify, uvpJsonArtifactDigest } = await import('./uv-canonical-form.mjs')
  const cameraCases = await read('../model/fixtures/uvm-camera-cases.json')
  const world = restoreUvwProfileDocument(await read('../world/fixtures/uvw-gltf-spatial.uvw.gltf'))
  const space = (world['spaces'] as Row[])[0]!, originalDigest = await uvpJsonArtifactDigest('uvw', world)
  space['camera'] = cameraCases['orthographicPreset']
  const before = jcsStringify(world), migrated = createUvwGltfDocument(world)
  assert.equal(jcsStringify(restoreUvwProfileDocument(migrated)), before)
  assert.equal(jcsStringify(world), before)
  assert.notEqual(await uvpJsonArtifactDigest('uvw', world), originalDigest)
  const worlds = [world]
  for (const camera of [
    { projection: 'orthographic', fieldOfViewDegrees: 70 },
    { projection: 'perspective', fieldOfViewDegrees: 180 },
    { projection: 'perspective', fieldOfViewDegrees: 0 },
    { projection: 'orthographic', elevationDegrees: 91 },
    { projection: 'perspective', drawDistance: 0 },
    { projection: 'orthographic', azimuthDegrees: 45, metersPerUnit: 1 },
  ]) worlds.push(changed(world, [set('spaces.0.camera', camera)]))
  const result = probePresentation({ models: [], worlds }) as { worlds: { accepted?: boolean; refusal?: string }[] }
  assert.equal(result.worlds[0]!.accepted, true)
  for (const refused of result.worlds.slice(1)) assert.match(refused.refusal!, /model-presentation/)
  const browser = await runBrowserWorker(new URL('./uvm-presentation-browser.ts', import.meta.url), { models: [], worlds })
  assert.deepEqual(browser.result, result)
  assertUvwCamera(cameraCases['perspectivePreset'])
  assertUvwCamera({ projection: 'orthographic', azimuthDegrees: -405, elevationDegrees: 90 })
  for (const value of [NaN, Infinity, -Infinity, 1e100])
    assert.throws(() => assertUvwCamera({ projection: 'perspective', drawDistance: value }), /model-presentation/)
})
