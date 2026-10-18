import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument } from './uvw-profile.mjs'
import { assertUvwObjectPresentation } from './uvm-presentation.ts'
const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-single-space.uvw.json', import.meta.url), 'utf8'))
test('object visual team context stays independent from addressed players in JSON and glTF', () => {
  const doc = structuredClone(fixture)
  const object = { id:'unit', objectKind:'unit', position:[0,0,0], rotation:[0,0,0,1], scale:[1,1,1], resourceIds:[] }
  doc.spaces[0].layers.push({schemaVersion:1,id:'objects',kind:'objects',instances:[object]})
  doc.spaces[0].layers.sort((a,b) => a.id.localeCompare(b.id))
  Object.assign(object, { presentationTeamColor: [0.123456789012345, 0, 1],
    presentationTeamRamp: Array.from({length:16}, (_,i) => [i/16,0.25,1]), presentationTeamColorIntensity: 0 })
  assert.equal(assertUvwProfile(doc), doc)
  const graph = createUvwGltfDocument(doc).extensions.UV_world_graph
  assert.deepEqual(graph.spaces[0].layers.find(layer => layer.kind === 'objects').instances[0], object)
})
for (const bad of [{presentationTeamColor:[0,-1,1]}, {presentationTeamColor:[0,1,Infinity]},
 {presentationTeamRamp:[]}, {presentationTeamRamp:[[1,2,0]]}, {presentationTeamColorIntensity:0.5}]) {
  test('presentation rejects ' + JSON.stringify(bad), () => assert.throws(() => assertUvwObjectPresentation(bad)))
}
