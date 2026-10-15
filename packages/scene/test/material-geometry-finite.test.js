import assert from 'node:assert/strict'
import { it } from 'node:test'

import { prepareMaterialGeometry, materialGeometry, sceneMaterialVertexSource } from '../src/render/material-geometry.js'

const triangle = (positions, normals = Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1)) => ({
  id: 'triangle',
  topology: 'triangles',
  positions,
  normals,
  tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
})
const withLast = value => Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, value)
const bits = pattern => new Float32Array(Uint32Array.of(pattern).buffer)[0]

it('accepts every finite float32 and refuses NaN and the infinities, at any offset of a buffer', () => {
  const finite = [
    0,
    -0,
    1e-45, // the smallest subnormal
    -1e-45,
    1.1754943508222875e-38, // the smallest normal
    3.4028234663852886e38, // the largest float32
    -3.4028234663852886e38,
    0.5,
    // A finite value whose low 16 bits look like an exponent of all ones.
    bits(0x3f807f80),
  ]
  for (const value of finite) {
    assert.doesNotThrow(() => prepareMaterialGeometry(triangle(withLast(value)), 1e6))
    assert.doesNotThrow(() => prepareMaterialGeometry(triangle(withLast(0), withLast(value)), 1e6))
  }
  const nonFinite = [Number.NaN, Infinity, -Infinity, bits(0x7fc00001), bits(0xffc00000)]
  for (const value of nonFinite) {
    assert.throws(
      () => prepareMaterialGeometry(triangle(withLast(value)), 1e6),
      /invalid material positions/,
    )
    // The same values as a view in the middle of a larger buffer.
    const buffer = new Float32Array(20)
    buffer.set(withLast(value), 7)
    assert.throws(
      () => prepareMaterialGeometry(triangle(buffer.subarray(7, 16)), 1e6),
      /invalid material positions/,
    )
    assert.throws(
      () => prepareMaterialGeometry(triangle(withLast(0), withLast(value)), 1e6),
      /invalid material vertex attributes/,
    )
  }
})

it('publishes true scene-world position and mirrored basis only when explicitly requested',()=>{
  const primitive={...triangle(withLast(0)),
    transform:Float32Array.of(-2,0,0,0,0,3,0,0,0,0,0.5,0,4,5,6,1)}
  const camera={viewProjection:Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)}
  const uvFrame=[1,0,0,0,0,1,0,0,0,0,1,0,100,0,0,1]
  const legacy=materialGeometry(primitive,camera,undefined,uvFrame)
  assert.equal(legacy.vertex(1).environment,undefined)
  const vertex=materialGeometry(primitive,camera,undefined,uvFrame,false,false,true).vertex(1)
  assert.deepEqual(vertex.worldPosition,[102,5,6])
  assert.deepEqual(vertex.environment.position,[2,5,6])
  assert.deepEqual(vertex.environment.tangent,[-1,0,0])
  assert.deepEqual(vertex.environment.bitangent.map(value=>value===0?0:value),[0,1,0])
  const defines={layers:[],uvSetCount:1}
  assert.doesNotMatch(sceneMaterialVertexSource(defines),/out vec3 v_sceneWorldNormal,/)
  for(const skinned of [false,true])
    assert.match(sceneMaterialVertexSource(defines,false,false,true,skinned,false,true),
      /out vec3 v_sceneWorldNormal, v_sceneWorldTangent, v_sceneWorldBitangent/)
})

it('publishes MODEL facing for both uniform and instance vertex stages', async () => {
  const { sceneMaterialVertexSource } = await import('../src/render/material-geometry.js')
  for (const instances of [false, true]) {
    const source = sceneMaterialVertexSource({ uvSetCount: 1 }, false, false, instances)
    assert.match(source, /flat out float v_sceneModelOrientation;/u)
    assert.match(source, new RegExp('v_sceneModelOrientation=sceneOrientationOf\\(mat3\\(' + (instances ? 'model' : 'u_model') + '\\)\\);', 'u'))
    assert.equal((source.match(/float sceneOrientationOf\(/gu) ?? []).length, 1)
  }
})
