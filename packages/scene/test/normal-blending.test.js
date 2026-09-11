import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const layer = (slot, color) => ({
  slot,
  texturePath: null,
  constantColor: { value: color },
  uvSource: 0,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
})
function parameters(factor = 0.5, overrides = {}) {
  return {
    renderModel: {
      version: 1,
      standard: {
        layers: {
          diffuse: layer('diffuse', [0.4, 0.4, 0.4, 1]),
          normal: layer('normal', [0.5, 0.5, 1, 1]),
          normalBlend1: layer('normalBlend1', [1, 0.5, 0.5, 1]),
          normalBlend2: layer('normalBlend2', [0.5, 1, 0.5, 1]),
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
        normalMapFormat: 'rgb8',
        normalBlendPolicy: { mode: 'signed-two-detail', secondMask: false },
        normalBlendFactors: Array.from({ length: 8 }, (_, i) => ({ value: i === 0 ? factor : 0 })),
        ...overrides,
      },
    },
  }
}
const sampler = params => createStandardMaterialPrograms(params, { budget })
const program = params => sampler(params).sample({ time: 0 }, { ambient: [0, 0, 0, 0] })[0]
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1e-7, `${index}: ${value} != ${expected[index]}`),
  )
}

for (const [factor, expected] of [
  [-0.5, [1 / Math.sqrt(10), 0, 3 / Math.sqrt(10)]],
  [0.5, [0, 1 / Math.sqrt(10), 3 / Math.sqrt(10)]],
  [0, [0, 0, 1]],
  [-3, [1, 0, 0]],
  [3, [0, 1, 0]],
])
  it(`selects and squares signed factor ${factor}`, () =>
    close(program(parameters(factor)).sampleNormal(), expected))

it('uses the second mask only when enabled, independently of choosing the second normal', () => {
  const params = parameters(-0.5),
    standard = params.renderModel.standard
  standard.layers.normalBlend2Mask = layer('normalBlend2Mask', [0.5, 0.75, 0.25, 1])
  standard.normalBlendFactors[4].value = 1
  close(program(params).sampleNormal(), [1 / Math.sqrt(10), 0, 3 / Math.sqrt(10)])
  standard.normalBlendPolicy.secondMask = true
  close(program(params).sampleNormal(), [0, 0, 1])
  standard.normalBlendFactors[0].value = 0.5
  close(program(params).sampleNormal(), [0, 1, 0])
})

it('normalizes each complete basis-transformed normal before signed blending', () => {
  const params = parameters(0.5)
  params.renderModel.standard.layers.normalBlend2.constantColor.value = [1, 1, 0.5, 1]
  const basis = { tangent: [0.5, 0, 0], bitangent: [0, 1, 0], normal: [0, 0, 0.5] }
  close(program(params).sampleNormal({}, basis), [Math.sqrt(0.02), Math.sqrt(0.08), Math.sqrt(0.9)])
})

it('does not acquire or sample a disabled second mask, while preserving authored input', () => {
  const params = parameters(-1)
  params.renderModel.standard.layers.normalBlend2Mask = {
    ...layer('normalBlend2Mask', [1, 1, 1, 1]),
    texturePath: 'missing-mask.dds',
  }
  const original = structuredClone(params),
    source = sampler(params),
    p = source.sample({ time: 0 })[0]
  assert.deepEqual(source.resources, [])
  assert.deepEqual(p.textures, [])
  assert.equal(
    p.defines.layers.some(layer => layer.slot === 'normalBlend2Mask'),
    false,
  )
  close(p.sampleNormal(), [1, 0, 0])
  assert.deepEqual(params, original)
})

it('cancels large signed mask dots before saturating their sum', () => {
  const params = parameters(),
    standard = params.renderModel.standard
  standard.normalBlendPolicy.secondMask = true
  standard.layers.normal = layer('normal', [1, 0.5, 0.5, 1])
  standard.layers.normalBlend1Mask = layer('normalBlend1Mask', [1, 1, 1, 1])
  standard.layers.normalBlend2Mask = layer('normalBlend2Mask', [1, 1, 1, 1])
  standard.normalBlendFactors = Array.from({ length: 8 }, (_, i) => ({
    value: i < 4 ? 2e38 : -2e38,
  }))
  close(program(params).sampleNormal(), [1, 0, 0])
  standard.normalBlendPolicy.secondMask = false
  close(program(params).sampleNormal(), [0, 1, 0])
})

it('uses a stable positive-Z fallback for an almost antipodal float32 blend', () => {
  const params = parameters(Math.SQRT1_2),
    standard = params.renderModel.standard
  standard.layers.normal = layer('normal', [0.5, 0.5, 0, 1])
  standard.layers.normalBlend2 = layer('normalBlend2', [0.5, 0.5, 1, 1])
  close(program(params).sampleNormal(), [0, 0, 1])
  standard.normalBlendFactors[0].value = Math.fround(Math.SQRT1_2)
  close(program(params).sampleNormal(), [0, 0, 1])
})

it('normalizes large finite RGB vectors without squaring overflow', () => {
  const params = parameters(0)
  params.renderModel.standard.layers.normal = layer('normal', [1e20, 0.5, 0.5, 1])
  close(program(params).sampleNormal(), [1, 0, 0])
})

it('uses the evaluated normal once for color composition', () => {
  const p = program(parameters(0.5))
  close(p.shade({ lightDirection: [0, 1, 0] }).rgba, [
    0.4 / Math.sqrt(10),
    0.4 / Math.sqrt(10),
    0.4 / Math.sqrt(10),
    1,
  ])
  close(p.shade({ shadingNormal: [0, 1, 0], lightDirection: [0, 1, 0] }).rgba, [0.4, 0.4, 0.4, 1])
})

it('samples animated factors across zero without recompiling the policy', () => {
  const params = parameters()
  params.renderModel.standard.normalBlendFactors[0].track = {
    lineType: 1,
    globalSeqId: null,
    keys: [
      { frame: 0, vector: [-1] },
      { frame: 1, vector: [1] },
    ],
  }
  const source = sampler(params)
  const frames = [0.25, 0.5, 0.75].map(time => source.sample({ time })[0])
  close(frames[0].sampleNormal(), [1 / Math.sqrt(10), 0, 3 / Math.sqrt(10)])
  close(frames[1].sampleNormal(), [0, 0, 1])
  close(frames[2].sampleNormal(), [0, 1 / Math.sqrt(10), 3 / Math.sqrt(10)])
  assert.equal(new Set(frames.map(frame => frame.key)).size, 1)
  assert.equal(new Set(frames.map(frame => frame.fragmentSource)).size, 1)
})

it('owns the policy and distinguishes it in the cache from sequential and second-mask variants', () => {
  const params = parameters(),
    source = sampler(params),
    first = source.sample({ time: 0 })[0]
  params.renderModel.standard.normalBlendPolicy.secondMask = true
  assert.equal(source.sample({ time: 0 })[0].normalBlendPolicy.secondMask, false)
  const second = program(params)
  assert.notEqual(first.key, second.key)
  delete params.renderModel.standard.normalBlendPolicy
  const sequential = program(params)
  assert.notEqual(first.key, sequential.key)
  close(sequential.sampleNormal(), [Math.SQRT1_2, 0, Math.SQRT1_2])
})

for (const value of [
  null,
  [],
  {},
  { mode: 'unknown', secondMask: false },
  { mode: 'signed-two-detail' },
  { mode: 'signed-two-detail', secondMask: 1 },
  { mode: 'signed-two-detail', secondMask: false, extra: true },
])
  it(`rejects an invalid normal policy ${JSON.stringify(value)}`, () =>
    assert.throws(() => program(parameters(0.5, { normalBlendPolicy: value })), TypeError))

it('requires both detail layers even when the second mask is disabled', () => {
  const params = parameters()
  delete params.renderModel.standard.layers.normalBlend2
  assert.throws(() => program(params), /both detail layers/)
})
