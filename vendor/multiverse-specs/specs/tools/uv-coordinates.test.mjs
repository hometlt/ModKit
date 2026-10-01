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
