import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'
import { prepareMaterialGeometry } from '../src/render/material-geometry.js'
import { sceneMaterialDraws } from '../src/render/material-draws.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const standard = texCoord => ({
  layers: {
    diffuse: {
      slot: 'diffuse',
      texturePath: null,
      constantColor: { value: [0.4, 0.4, 0.4, 1] },
      uvSource: 0,
      channels: 1,
      op: 2,
      teamColorMode: 0,
      invert: false,
      clampResult: true,
      wrapX: true,
      wrapY: true,
    },
  },
  blendMode: 0,
  priority: 0,
  specularity: 10,
  specMult: 1,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: false,
  unshaded: false,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
  ...(texCoord === undefined ? {} : { tangentGeneration: { texCoord } }),
})
const parameters = value => ({ renderModel: { version: 1, standard: value } })
const sampler = value => createStandardMaterialPrograms(value, { budget })
const primitive = (set = 1, coordinates = [1, 0, 1, 1, 0, 0]) => ({
  id: 'triangle',
  materialId: 'material',
  topology: 'triangles',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  textureCoordinateSets: [{ set, coordinates: Float32Array.from(coordinates) }],
})
const repeat = values => Float32Array.from([...values, ...values, ...values])
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7))
}

for (const set of [0, 1, 2, 3, 4])
  it(`generates missing tangents from explicitly selected TEXCOORD_${set}`, () => {
    const input = primitive(set),
      original = structuredClone(input)
    // u=1-y,v=x: the U derivative points -Y, V derivative points +X.
    const output = prepareMaterialGeometry(input, 4096, { texCoord: set })
    close(output.tangents, repeat([0, -1, 0, 1]))
    close(output.normals, repeat([0, 0, 1]))
    assert.deepEqual(output.textureCoordinateSets, input.textureCoordinateSets)
    assert.deepEqual(input, original)
  })

it('distinguishes the default UV0 basis and mirrored UV1 handedness', () => {
  const input = primitive(1, [1, 0, 0, 0, 1, 1])
  close(prepareMaterialGeometry(input, 4096).tangents, repeat([1, 0, 0, 1]))
  close(prepareMaterialGeometry(input, 4096, { texCoord: 1 }).tangents, repeat([-1, 0, 0, -1]))
})

it('refuses a missing explicit set while keeping the legacy geometric fallback', () => {
  const input = primitive()
  assert.throws(() => prepareMaterialGeometry(input, 4096, { texCoord: 4 }), /lacks TEXCOORD_4/)
  delete input.textureCoordinates
  assert.throws(() => prepareMaterialGeometry(input, 4096, { texCoord: 0 }), /lacks TEXCOORD_0/)
  close(prepareMaterialGeometry(input, 4096).tangents, repeat([1, 0, 0, 1]))
})

it('reports a degenerate selected set without silently using nondegenerate UV0', () => {
  const input = primitive(1, [0, 0, 0, 0, 0, 0]),
    diagnostics = []
  input.textureCoordinates = Float32Array.of(1, 0, 1, 1, 0, 0)
  const output = prepareMaterialGeometry(input, 4096, { texCoord: 1, diagnostics })
  close(output.tangents, repeat([1, 0, 0, 1]))
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].code, 'common.scene/tangent-generation-degenerate-uv')
  assert.equal(diagnostics[0].primitiveId, input.id)
  assert.match(diagnostics[0].message, /TEXCOORD_1.*1 triangle/)
  const old = []
  prepareMaterialGeometry(
    { ...input, textureCoordinates: Float32Array.of(0, 0, 0, 0, 0, 0) },
    4096,
    { diagnostics: old },
  )
  assert.deepEqual(old, [])
})

it('preserves authored tangents even when the requested generation set is absent', () => {
  const input = { ...primitive(), normals: repeat([0, 0, 1]), tangents: repeat([0, -1, 0, -1]) }
  const diagnostics = []
  assert.equal(prepareMaterialGeometry(input, 0, { texCoord: 4, diagnostics }), input)
  assert.deepEqual(diagnostics, [])
  const noNormals = { ...input }
  delete noNormals.normals
  const generatedNormals = prepareMaterialGeometry(noNormals, 4096, { texCoord: 4, diagnostics })
  assert.deepEqual(generatedNormals.tangents, input.tangents)
  close(generatedNormals.normals, repeat([0, 0, 1]))
})

it('owns generation policy snapshots without compiling different shader code', () => {
  const input = parameters(standard(1)),
    source = sampler(input),
    frame = source.sample({ time: 0 })[0]
  input.renderModel.standard.tangentGeneration.texCoord = 2
  assert.deepEqual(frame.tangentGeneration, { texCoord: 1 })
  assert.ok(Object.isFrozen(frame.tangentGeneration))
  const other = sampler(input).sample({ time: 0 })[0]
  assert.equal(frame.key, other.key)
  assert.equal(frame.fragmentSource, other.fragmentSource)
  assert.equal(frame.vertexSource, other.vertexSource)
  assert.deepEqual(other.tangentGeneration, { texCoord: 2 })
})

for (const value of [
  null,
  [],
  {},
  { texCoord: -1 },
  { texCoord: 0.5 },
  { texCoord: 5 },
  { texCoord: '1' },
  { texCoord: 1, unexpected: true },
])
  it(`rejects invalid tangent generation ${JSON.stringify(value)}`, () => {
    assert.throws(() => sampler(parameters({ ...standard(), tangentGeneration: value })), TypeError)
  })

function draws(choices, maxBytes, source = primitive(), depth = false) {
  const params = {
    renderModel: {
      version: 1,
      composite: {
        priority: 0,
        passes: choices.map(texCoord => ({
          material: { ...standard(texCoord), depthPrepass: depth },
          alphaFactor: { value: 1 },
        })),
      },
    },
  }
  const passes = sampler(params).sample({ time: 0 })
  return sceneMaterialDraws(
    [source],
    [{ id: 'material', baseColor: [1, 1, 1, 1] }],
    new Map([['material', { passes, textures: new Map() }]]),
    identity,
    [],
    1,
    maxBytes,
  )
}

it('reuses one bounded preparation across matching composite passes and depth prepasses', () => {
  // 168 retained bytes plus 12 temporary triangle-index bytes for this authored layout.
  const scheduled = draws([1, 1, 1], 180, primitive(), true)
  assert.equal(scheduled.length, 6)
  assert.equal(new Set(scheduled.map(draw => draw.primitive)).size, 1)
  assert.equal(scheduled.filter(draw => draw.depthOnly).length, 3)
  close(scheduled[0].primitive.tangents, repeat([0, -1, 0, 1]))
})

it('keeps distinct UV preparations and enforces their combined memory budget', () => {
  assert.throws(() => draws([0, 1], 180), /byte budget/)
  const scheduled = draws([0, 1], 348)
  assert.notEqual(scheduled[0].primitive, scheduled[1].primitive)
  close(scheduled[0].primitive.tangents, repeat([1, 0, 0, 1]))
  close(scheduled[1].primitive.tangents, repeat([0, -1, 0, 1]))
})

it('shares authored geometry across choices without allocating replacement attributes', () => {
  const source = { ...primitive(), normals: repeat([0, 0, 1]), tangents: repeat([1, 0, 0, 1]) }
  const scheduled = draws([0, 1, 4], 0, source)
  assert.equal(scheduled.length, 3)
  assert.ok(scheduled.every(draw => draw.primitive === source))
})
