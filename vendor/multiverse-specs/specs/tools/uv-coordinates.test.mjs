import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('canonical frame and measured Z-up inverses do not conflate model, camera and source frames', async () => {
  const contract = JSON.parse(await readFile(new URL('../foundation/uv-coordinates.v1.json', import.meta.url)))
  assert.equal(contract.canonical.handedness, 'right')
  assert.equal(contract.canonical.upAxis, 'y')
  assert.equal(contract.canonical.forwardAxis, '+z')
  const forward = ([x, y, z]) => [x, z, -y]
  const inverse = ([x, y, z]) => [x, -z, y]
  const sourcePoint = [1, 2, 3]
  assert.deepEqual(forward(sourcePoint), [1, 3, -2])
  assert.deepEqual(inverse(forward(sourcePoint)), sourcePoint)
  assert.notDeepEqual(forward(forward(sourcePoint)), sourcePoint)
  for (const id of ['m3', 'sc2-map-native', 'warzone-map-native']) {
    const row = contract.sources.find(row => row.id === id)
    assert.equal(row.map, '(x, y, z) -> (x, z, -y)', id)
    assert.equal(row.inverseMap, '(x, y, z) -> (x, -z, y)', id)
    assert.equal(row.selfInverse, false, id)
  }
})

test('new frame records require independent qualification and share the pixel-grid form', async () => {
  const contract = JSON.parse(await readFile(new URL('../foundation/uv-coordinates.v1.json', import.meta.url)))
  const byId = new Map(contract.sources.map(row => [row.id, row]))
  assert.equal(byId.size, contract.sources.length)
  for (const id of ['warcraft3-map-native', 'ea/dune-2000', 'starcraft1-map-native',
    'ea/red-alert-2', 'ea/tiberian-sun', 'sage-map-native', 'diablo3-scene-native',
    'warzone-map-native-game-view']) {
    const entry = byId.get(id)
    assert.equal(entry.qualification, 'required', id)
    assert.equal(entry.measuredIn, undefined, 'a definition is not a measured receipt')
    await readFile(new URL(entry.definedIn, new URL('../foundation/', import.meta.url)))
    const frame = entry.worldForm ? { ...contract.worldForms[entry.worldForm], ...entry } : entry
    assert.equal(frame.metersPerUnit, undefined, 'no guessed physical scale')
    assert.equal(frame.upAxis, undefined, 'source axes belong to from, not the canonical basis')
    assert.ok(['forward', 'reverse'].includes(frame.sourceRowOrder))
  }
  const pixel = contract.worldForms['planar-pixel-grid-v1']
  assert.equal(byId.get('ea/dune-2000').worldForm, byId.get('starcraft1-map-native').worldForm)
  assert.equal(pixel.map, '(x, y, z) -> (x, z, y)')
  assert.equal(pixel.from.handedness, 'left')
  assert.equal(pixel.sourceRowOrder, 'forward')
  assert.equal(byId.get('warcraft3-map-native').sourceRowOrder, 'reverse')
  assert.equal(byId.get('sage-map-native').unitsPerCell, 10)
  assert.equal(byId.get('warzone-map-native').supersededBy, 'warzone-map-native-game-view')
  assert.notEqual(byId.get('warzone-map-native').map, byId.get('warzone-map-native-game-view').map)
  for (const entry of contract.unmeasuredWorldSources) {
    assert.equal(byId.has(entry.id), false)
    assert.equal(entry.map, undefined)
    assert.ok(entry.missing.includes('vertical encoding and scale'))
  }
})

test('north-first pixel and south-first z-up frames preserve distinct row directions and invert bounds', () => {
  const northFirst = ([x, y, z]) => [x, z, y]
  const southFirst = ([x, y, z]) => [x, z, -y]
  assert.deepEqual(northFirst([32, 64, 0]), [32, 0, 64])
  assert.deepEqual(northFirst(northFirst([32, 64, 0])), [32, 64, 0])
  const corners = [[10, -40, 3], [138, -40, 4], [10, 88, 5], [138, 88, 6]].map(southFirst)
  assert.deepEqual(corners[0], [10, 3, 40])
  assert.deepEqual(corners[2], [10, 5, -88])
  assert.deepEqual(corners.map(point => point[2]).sort((a,b) => a-b), [-88, -88, 40, 40])
  assert.ok(corners[0][2] > corners[2][2], 'UVW serial rows reverse south-first source rows')
})
