import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmEffectFrame } from '../src/uvm/effects.js'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
// A view turned a quarter about Y and moved back, and one tilted down from above.
const turned = Float32Array.from([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -5, 1])
const s = Math.SQRT1_2
const tilted = Float32Array.from([1, 0, 0, 0, 0, s, -s, 0, 0, s, s, 0, 0, 0, -5, 1])
const standard = {
  layers: {},
  blendMode: 1,
  priority: 0,
  specularity: 0,
  specMult: 1,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: true,
  unshaded: false,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
}
// A material whose program samples the emitter's texture draws sprites with a program (their
// colour as a tint); one that does not keeps the single-texture pass (their colour per vertex).
const diffuse = {
  slot: 'diffuse',
  texturePath: 'particle.dds',
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 0,
  op: 6,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
}
const material = (id, programmed) => ({
  id,
  baseColor: [0.2, 0.3, 0.4, 0.2],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: programmed ? { ...standard, layers: { diffuse } } : standard,
        layers: [],
      },
    },
  },
})
// Two emitters spraying apart, their colours fading, so sprites differ in place, depth and tint.
const emitter = (node, materialIndex, colour) => ({
  node,
  material: materialIndex,
  emissionRate: 12,
  lifeSpan: 2,
  lifeSpanRandom: 0.5,
  speed: 2,
  speedRandom: 0.5,
  emitSpreadX: 0.8,
  emitSpreadY: 0.6,
  alpha: 1,
  segmentColors: [colour, [0.25, 0.5, 0.75], [1, 1, 1]],
  segmentAlphas: [0.25, 0.75, 0.5],
  texturePath: 'particle.dds',
  orientationMode: 'billboard',
  emitShape: 'point',
  maxParticles: 32,
})
const document = {
  asset: { version: '2.0' },
  nodes: [{}, {}],
  materials: [{}, {}],
  extensions: {
    UV_game_effects: {
      particles: [emitter(0, 0, [1, 0.25, 0]), emitter(1, 1, [0, 0.5, 1])],
      ribbons: [],
      projectors: [],
      trackTimeUnit: 'seconds',
    },
  },
}
const shifted = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 1, 0, 1])
const transforms = new Map([
  ['node-0', identity],
  ['node-1', shifted],
])
const options = {
  materials: [material('material-0', true), material('material-1', false)],
  activeNodes: new Set(['node-0', 'node-1']),
  nodeTransformsAt: () => transforms,
  maxBytes: 8 * 1024 * 1024,
  maxNodes: 10000,
}
const sprite = (primitive, at) => [...primitive.positions.subarray(at * 12, at * 12 + 12)]
const depthOf = (view, corners) => {
  const centre = [0, 1, 2].map(axis => {
    const values = [0, 1, 2, 3].map(corner => corners[corner * 3 + axis])
    return (Math.min(...values) + Math.max(...values)) / 2
  })
  return view[2] * centre[0] + view[6] * centre[1] + view[10] * centre[2] + view[14]
}

test("an emitter's sprites draw as one primitive, back to front, each with its own tint", () => {
  const programmed = new Set()
  for (const viewMatrix of [identity, turned, tilted]) {
    const frame = { ...options, time: 1.5, viewMatrix }
    const single = createUvmEffectFrame(document, frame)
    const batched = createUvmEffectFrame(document, { ...frame, batchParticles: true })
    assert.deepEqual(batched.materials, single.materials)
    const glued = batched.primitives
    assert.equal(glued.length, 2)
    for (const primitive of glued) {
      const sprites = single.primitives.filter(each => each.materialId === primitive.materialId)
      assert.ok(sprites.length > 4, `${sprites.length} sprites`)
      // Every sprite once, with its UVs and colours, farthest first (slot order among equals).
      const order = sprites
        .map((each, ordinal) => ({ each, ordinal, depth: depthOf(viewMatrix, sprite(each, 0)) }))
        .sort((left, right) => left.depth - right.depth || left.ordinal - right.ordinal)
      assert.equal(primitive.positions.length, sprites.length * 12)
      order.forEach(({ each }, at) => {
        assert.deepEqual(sprite(primitive, at), sprite(each, 0))
        assert.deepEqual(
          [...primitive.textureCoordinates.subarray(at * 8, at * 8 + 8)],
          [...each.textureCoordinates],
        )
        assert.deepEqual(
          [...primitive.indices.subarray(at * 6, at * 6 + 6)],
          [...each.indices].map(index => index + at * 4),
        )
        if (each.tint === undefined)
          assert.deepEqual([...primitive.colors.subarray(at * 16, at * 16 + 16)], [...each.colors])
        // A programmed sprite's tint on each of its corners, where a sprite draw takes it as its tint.
        else
          for (let corner = 0; corner < 4; corner++)
            assert.deepEqual(
              [...primitive.vertexTints.subarray((at * 4 + corner) * 4, (at * 4 + corner) * 4 + 4)],
              each.tint,
            )
      })
      assert.equal(primitive.tint, undefined)
      assert.deepEqual([...primitive.transform], [...sprites[0].transform])
      programmed.add(sprites[0].tint !== undefined)
      // A programmed sprite's colour is its tint alone: as vertex colours too, a material using
      // them took the sprite's alpha twice.
      assert.equal(primitive.colors === undefined, sprites[0].tint !== undefined)
      assert.equal(sprites.every(each => each.colors === undefined), sprites[0].tint !== undefined)
      if (sprites[0].tint === undefined) assert.equal(primitive.vertexTints, undefined)
    }
  }
  // Both kinds of sprite were drawn.
  assert.deepEqual([...programmed].sort(), [false, true])
})
