import assert from 'node:assert/strict'
import { it } from 'node:test'
import { prepareMaterialGeometry, materialGeometry } from '../src/render/material-geometry.js'
import { prepareSceneMaterialPrograms } from '../src/render/materials.js'
import { acquireUvmMaterialTextures } from '../src/uvm/materials.js'
import { blendMaterialPixel } from '../src/render/material-draws.js'

const primitive = {
  id: 'triangle',
  topology: 'triangles',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
}
it('keeps premultiplied RGB from being multiplied by alpha a second time', () => {
  const frame = Uint8Array.of(128, 128, 128, 255)
  blendMaterialPixel(frame, 0, [0.5, 0.25, 0.75, 0.5], { blend: 'premultiplied' })
  assert.deepEqual([...frame], [192, 128, 255, 255])
})
it('writes a solid fragment whole: an alpha-tested leaf keeps its colour and covers the pixel', () => {
  for (const blend of ['opaque', 'alpha-test']) {
    const frame = Uint8Array.of(10, 20, 30, 0)
    blendMaterialPixel(frame, 0, [0.5, 0.25, 0.75, 0.4], { blend })
    assert.deepEqual([...frame], [128, 64, 191, 255])
  }
})
it('transports normals with inverse transpose and retains orthogonal tangent lighting under nonuniform scale', () => {
  const n = Math.SQRT1_2
  const geometry = materialGeometry(
    {
      ...primitive,
      normals: Float32Array.of(n, 0, n, n, 0, n, n, 0, n),
      tangents: Float32Array.of(n, 0, -n, 1, n, 0, -n, 1, n, 0, -n, 1),
      transform: Float32Array.of(2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1),
    },
    {
      viewProjection: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      viewMatrix: Float32Array.of(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
    },
  )
  const vertex = geometry.vertex(1)
  const near = (actual, expected) =>
    actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6))
  near(vertex.worldPosition, [2, 0, 0])
  near(vertex.worldNormal, [1 / Math.sqrt(17), 0, 4 / Math.sqrt(17)])
  near(vertex.viewNormal, [0, 1 / Math.sqrt(17), 4 / Math.sqrt(17)])
  near(vertex.lightDirection, [-1 / Math.sqrt(17), 0, 4 / Math.sqrt(17)])
})
it('bounds generated geometry before allocation and validates authored geometry too', () => {
  assert.throws(() => prepareMaterialGeometry(primitive, 0), /byte budget/)
  const prepared = prepareMaterialGeometry(primitive, 4096)
  assert.deepEqual([...prepared.normals], [0, 0, 1, 0, 0, 1, 0, 0, 1])
  assert.deepEqual([...prepared.tangents], [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])
  assert.throws(
    () => prepareMaterialGeometry({ ...prepared, indices: Uint32Array.of(0, 1, 99) }, 4096),
    /out of range/,
  )
  assert.throws(
    () => prepareMaterialGeometry({ ...primitive, positions: Float32Array.of(NaN, 0, 0) }, 4096),
    /positions/,
  )
  assert.throws(
    () =>
      prepareMaterialGeometry(
        {
          ...prepared,
          textureCoordinateSets: [0, 0].map(set => ({
            set,
            coordinates: primitive.textureCoordinates,
          })),
        },
        4096,
      ),
    /duplicate/,
  )
})
it('validates playback and texture filters even without a renderable material', () => {
  for (const context of [
    { time: -1 },
    { sequenceTime: Infinity },
    { sequenceIndex: -1 },
    { teamColor: [1, 2, 0] },
    { ambient: [0, 0, 0] },
  ])
    assert.throws(() => prepareSceneMaterialPrograms([], new Map(), context, []))
  assert.throws(
    () =>
      prepareSceneMaterialPrograms(
        [],
        new Map([['bad', { filter: 'unsupported' }]]),
        undefined,
        [],
      ),
    /filter/,
  )
})
it('uses distinct resource identities after a missing texture and preserves host refusals', async () => {
  const requests = [],
    diagnostics = []
  const port = {
    async read(request) {
      requests.push(request)
      return {
        state: 'unresolved',
        diagnostics: [
          { severity: 'warning', code: 'test/missing', message: request.requirement.logicalId },
        ],
      }
    },
  }
  const result = await acquireUvmMaterialTextures(
    new Map([
      ['a', ['missing.dds', 'next.dds']],
      ['b', ['next.dds']],
    ]),
    port,
    128,
    diagnostics,
  )
  assert.equal(requests.length, 2)
  assert.equal(new Set(requests.map(request => request.requirement.id)).size, 2)
  assert.deepEqual(
    requests.map(request => request.requirement.logicalId),
    ['missing.dds', 'next.dds'],
  )
  assert.deepEqual(result.textures, [])
  assert.equal(diagnostics.length, 2)
})

it('bounds each material parameters by itself, so a whole map of materials fits', () => {
  // two materials of 600 000 nodes each: one budget of 1 000 000 for all of them refused the map
  const heavy = id => ({ id, shader: { id: 'fixture.unknown', parameters: { values: new Array(600_000).fill(0) } } })
  assert.doesNotThrow(() => prepareSceneMaterialPrograms([heavy('a'), heavy('b')], new Map(), undefined, []))
  const tooHeavy = { id: 'c', shader: { id: 'fixture.unknown', parameters: { values: new Array(1_100_000).fill(0) } } }
  assert.throws(() => prepareSceneMaterialPrograms([tooHeavy], new Map(), undefined, []))
})
