import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelSceneSource } from '../dist/index.js'

test('model sources own every vertex buffer and include every UV set in the byte budget', async () => {
  const primitive = {
    id: 'mesh', topology: 'triangles', positions: new Float32Array([1, 2, 3]),
    normals: new Float32Array([0, 0, 1]), tangents: new Float32Array([1, 0, 0, -1]),
    colors: new Float32Array([1, 0.5, 0, 1]), indices: new Uint32Array([0]),
    textureCoordinates: new Float32Array([0.25, 0.75]),
    textureCoordinateSets: [
      { set: 0, coordinates: new Float32Array([0.25, 0.75]) },
      { set: 4, coordinates: new Float32Array([0.125, 0.875]) },
    ],
    boneIndices: new Uint32Array([7, 2, 0, 0]),
    boneWeights: new Float32Array([0.75, 0.25, 0, 0]),
  }
  const source = createModelSceneSource({
    info: { scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 0, textures: 0, animations: 0, geometryAccess: 'decoded' },
    nodes: [], meshes: [], primitives: [primitive],
  })
  const expected = structuredClone(primitive)
  const byteLength = Object.values(primitive).filter(ArrayBuffer.isView).reduce((sum, value) => sum + value.byteLength, 0)
    + primitive.textureCoordinateSets.reduce((sum, channel) => sum + channel.coordinates.byteLength, 0)
  for (const value of Object.values(primitive).filter(ArrayBuffer.isView)) value.fill(99)
  for (const channel of primitive.textureCoordinateSets) channel.coordinates.fill(99)
  await assert.rejects(source.primitive('mesh', { maxBytes: byteLength - 1 }), /maxBytes budget/u)
  const first = await source.primitive('mesh', { maxBytes: byteLength })
  assert.deepEqual(first, expected)
  for (const value of Object.values(first).filter(ArrayBuffer.isView)) value.fill(88)
  for (const channel of first.textureCoordinateSets) channel.coordinates.fill(88)
  assert.deepEqual(await source.primitive('mesh', { maxBytes: byteLength }), expected)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(source.primitive('mesh', { maxBytes: byteLength }, controller.signal), { name: 'AbortError' })
})
