import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmRibbonGeometry } from '../src/uvm/ribbon-geometry.js'
import { bindUvmEffectLinks } from '../src/uvm/effect-links.js'
import { createUvmEffectFrame } from '../src/uvm/effects.js'
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const state = () => ({
  capacity: 2,
  activeCount: 2,
  activeSlots: Int32Array.of(0, 1),
  emitterCounts: Uint32Array.of(2),
  emitterIndices: Uint32Array.of(0, 0),
  firstSlots: Int32Array.of(0),
  lastSlots: Int32Array.of(1),
  previousSlots: Int32Array.of(-1, 0),
  nextSlots: Int32Array.of(1, -1),
  vertices: Float32Array.from([0, 1, 0, 0, -1, 0, 2, 1, 0, 2, -1, 0]),
  ages: Float32Array.of(0, 1),
  lifeSpans: Float32Array.of(2, 2),
  randomSeeds: Float32Array.of(0, 0),
  alphas: Float32Array.of(0.5, 0.25),
  textureSlots: Uint32Array.of(1, 2),
})
const emitter = {
  name: 'ribbon',
  boneIndex: 0,
  materialIndex: 0,
  ribbonType: 'planar',
  sides: 3,
  starRatio: 0.25,
  widths: [2, 2, 2],
  segmentColors: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  segmentAlphas: [0.8, 0.4, 0],
  colorTimeMiddle: 0.5,
  rows: 2,
  columns: 2,
}
const options = {
  cameraPosition: [0, 0, 5],
  time: 1,
  maxBytes: 1048576,
  maxNodes: 10000,
}
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < actual.length; i++)
    assert(
      Math.abs(actual[i] - expected[i]) < 1e-6,
      `component ${i}: ${actual[i]} != ${expected[i]}`,
    )
}

test('ribbon rings preserve per-point RGBA and texture slots with complete strip indices', () => {
  const source = state(),
    before = structuredClone(source),
    result = createUvmRibbonGeometry(source, [emitter], options).entries[0]
  assert.deepEqual([...result.positions], [0, 1, 0, 0, -1, 0, 2, 1, 0, 2, -1, 0])
  assert.deepEqual([...result.indices], [0, 1, 3, 0, 3, 2])
  close(result.colors, [1, 0, 0, 0.4, 1, 0, 0, 0.4, 0, 1, 0, 0.1, 0, 1, 0, 0.1])
  assert.deepEqual([...result.textureCoordinates], [0.5, 0, 1, 0, 0, 1, 0.5, 1])
  assert.deepEqual(source, before)
})

test('cylinder and star use the existing closed-ring helper with explicit seam vertices', () => {
  const cylinder = createUvmRibbonGeometry(
    state(),
    [{ ...emitter, ribbonType: 'cylinder' }],
    options,
  ).entries[0]
  const h = Math.sqrt(3) / 2,
    ring = [0, 0, 1, 0, h, -0.5, 0, -h, -0.5, 0, 0, 1]
  close(cylinder.positions, [
    ...ring,
    ...ring.map((value, index) => (index % 3 === 0 ? value + 2 : value)),
  ])
  assert.deepEqual([...cylinder.indices], [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6])
  const star = createUvmRibbonGeometry(state(), [{ ...emitter, ribbonType: 'star' }], options)
    .entries[0]
  const starRing = [
    0,
    0,
    1,
    0,
    h / 4,
    0.125,
    0,
    h,
    -0.5,
    0,
    0,
    -0.25,
    0,
    -h,
    -0.5,
    0,
    -h / 4,
    0.125,
    0,
    0,
    1,
  ]
  close(star.positions, [
    ...starRing,
    ...starRing.map((value, index) => (index % 3 === 0 ? value + 2 : value)),
  ])
  assert.deepEqual(
    [...star.indices],
    [
      0, 1, 8, 0, 8, 7, 1, 2, 9, 1, 9, 8, 2, 3, 10, 2, 10, 9, 3, 4, 11, 3, 11, 10, 4, 5, 12, 4, 12,
      11, 5, 6, 13, 5, 13, 12,
    ],
  )
})

test('ring buffers require a complete acyclic chain and budget before output allocation', () => {
  assert.throws(
    () => createUvmRibbonGeometry(state(), [emitter], { ...options, maxBytes: 1 }),
    /budget/,
  )
  const invalid = state()
  invalid.nextSlots[1] = 0
  assert.throws(() => createUvmRibbonGeometry(invalid, [emitter], options), /chain/)
})

test('source ordinal mapping preserves zero-emission and invisible linked templates', () => {
  const particles = [
    {
      collisionEmitterIndex: 2,
      trailEmitterIndex: 2,
      bounceRibbonEmitterIndex: 3,
    },
    { emissionRate: 0, visibility: 0 },
  ]
  bindUvmEffectLinks(particles, [0, 2], [1, 3], 3, 4, 10000, 1000)
  assert.deepEqual(particles, [
    {
      collisionEmitterIndex: 1,
      trailEmitterIndex: 1,
      bounceRibbonEmitterIndex: 1,
    },
    { emissionRate: 0, visibility: 0 },
  ])
  const unsupported = [{ collisionEmitterIndex: 2, trailEmitterIndex: 1 }, { emissionRate: 0 }],
    before = structuredClone(unsupported)
  assert.throws(
    () => bindUvmEffectLinks(unsupported, [0, 2], [], 3, 0, 10000, 1000),
    /unsupported geometry/,
  )
  assert.deepEqual(unsupported, before)
})

test('linked trails spawn valid zero-rate children through the actual common simulator', () => {
  const source = {
    asset: { version: '2.0' },
    nodes: [{}, {}],
    materials: [{}],
    extensions: {
      UV_game_effects: {
        trackTimeUnit: 'seconds',
        projectors: [],
        ribbons: [],
        particles: [
          {
            node: 1,
            material: 0,
            orientationMode: 'not-implemented',
            emitShape: 'point',
            emissionRate: 0,
          },
          {
            node: 0,
            material: 0,
            orientationMode: 'billboard',
            emitShape: 'point',
            emissionRate: 10,
            lifeSpan: 2,
            speed: 1,
            maxParticles: 16,
            trailEmitterIndex: 2,
            trailEmitRate: 10,
            trailEmitChance: 1,
          },
          {
            node: 0,
            material: 0,
            orientationMode: 'billboard',
            emitShape: 'point',
            emissionRate: 0,
            lifeSpan: 2,
            speed: 0,
            maxParticles: 16,
            segmentColors: [
              [0, 1, 0],
              [0, 1, 0],
              [0, 1, 0],
            ],
          },
        ],
      },
    },
  }
  const request = {
    time: 0.5,
    viewMatrix: identity,
    materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
    activeNodes: new Set(['node-0', 'node-1']),
    nodeTransformsAt: () =>
      new Map([
        ['node-0', identity],
        ['node-1', identity],
      ]),
    maxBytes: 8 * 1048576,
    maxNodes: 100000,
  }
  const frame = createUvmEffectFrame(source, request)
  assert(
    frame.primitives.some(
      primitive =>
        primitive.colors[0] === 0 && primitive.colors[1] === 1 && primitive.colors[2] === 0,
    ),
  )
  source.extensions.UV_game_effects.particles[1].trailEmitRate = 1e100
  assert.throws(() => createUvmEffectFrame(source, request), /trail emission.*budget/)
})

test('common ribbon consumer uses simulator anchors once and renders tube rings', () => {
  const moved = identity.slice()
  moved[12] = 3
  const source = {
    asset: { version: '2.0' },
    nodes: [{}],
    materials: [{}],
    extensions: {
      UV_game_effects: {
        trackTimeUnit: 'seconds',
        particles: [],
        projectors: [],
        ribbons: [
          {
            node: 0,
            material: 0,
            ribbonType: 'cylinder',
            sides: 3,
            emissionRate: 10,
            lifeSpan: 2,
            speed: 1,
            modelSpace: true,
            heightAbove: 0.5,
            heightBelow: 0.5,
            widths: [1, 1, 1],
            segmentAlphas: [1, 1, 1],
            segmentColors: [
              [1, 1, 1],
              [1, 1, 1],
              [1, 1, 1],
            ],
          },
        ],
      },
    },
  }
  const frame = createUvmEffectFrame(source, {
    time: 0.5,
    viewMatrix: identity,
    materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
    activeNodes: new Set(['node-0']),
    nodeTransformsAt: () => new Map([['node-0', moved]]),
    maxBytes: 8 * 1048576,
    maxNodes: 100000,
  })
  assert.equal(frame.primitives.length, 1)
  const points = frame.primitives[0].positions
  assert(points.length >= 24)
  for (let i = 0; i < points.length; i += 3) assert(points[i] >= 2.49999 && points[i] <= 3.50001)
  assert(frame.primitives[0].colors.length === (points.length / 3) * 4)
})

test('bounce links spawn a zero-rate ribbon after a filtered ordinal without retargeting it', () => {
  const source = {
    asset: { version: '2.0' },
    nodes: [{}],
    materials: [{}],
    extensions: {
      UV_game_effects: {
        trackTimeUnit: 'seconds',
        projectors: [],
        particles: [
          {
            node: 0,
            material: 0,
            orientationMode: 'billboard',
            emitShape: 'point',
            emissionRate: 10,
            lifeSpan: 2,
            speed: 2,
            gravity: 0,
            maxParticles: 16,
            collideTerrain: true,
            maxCollisionEvents: 1,
            bounceRibbonEmitterIndex: 1,
            bounceRibbonChance: 1,
          },
        ],
        ribbons: [
          {
            node: 0,
            material: 0,
            ribbonType: 'not-implemented',
            emissionRate: 0,
          },
          {
            node: 0,
            material: 0,
            ribbonType: 'planar',
            emissionRate: 0,
            lifeSpan: 3,
            speed: 0,
            heightAbove: 0.5,
            heightBelow: 0.5,
          },
        ],
      },
    },
  }
  const request = {
    time: 0.5,
    viewMatrix: identity,
    materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
    activeNodes: new Set(['node-0']),
    nodeTransformsAt: time => {
      const frame = identity.slice()
      frame[10] = -1
      frame[12] = time
      frame[14] = 1
      return new Map([['node-0', frame]])
    },
    collisionProvider: (query, out) => {
      out.position.set(query.endPosition)
      out.normal.set([0, 0, 1])
      return true
    },
    maxBytes: 8 * 1048576,
    maxNodes: 100000,
  }
  const frame = createUvmEffectFrame(source, request),
    ribbon = frame.primitives.find(primitive => primitive.id === 'uvm-effect-ribbon-1')
  assert(ribbon !== undefined)
  assert(ribbon.indices.length >= 6)
  assert(!frame.primitives.some(primitive => primitive.id === 'uvm-effect-ribbon-0'))
  source.extensions.UV_game_effects.particles[0].bounceRibbonChance = 0
  assert(
    !createUvmEffectFrame(source, request).primitives.some(primitive =>
      primitive.id.startsWith('uvm-effect-ribbon-'),
    ),
  )
})

test('particle consumer separates model storage from normalized preview anchors and forwards screen UV', () => {
  const moved = identity.slice()
  moved[0] = 2
  moved[5] = 3
  moved[10] = 4
  moved[12] = 3
  for (const [modelSpace, boneAnchored, center] of [
    [false, false, 3],
    [true, false, 0],
    [true, true, 3],
  ]) {
    const source = {
      asset: { version: '2.0' },
      nodes: [{}],
      materials: [{}],
      extensions: {
        UV_game_effects: {
          trackTimeUnit: 'seconds',
          projectors: [],
          ribbons: [],
          particles: [
            {
              node: 0,
              material: 0,
              orientationMode: 'emitter-oriented',
              emitShape: 'point',
              emissionRate: 10,
              lifeSpan: 2,
              speed: 0,
              gravity: 0,
              maxParticles: 16,
              modelSpace,
              boneAnchored,
              head: true,
              tail: false,
              width: 2,
              length: 4,
              screenSpaceUv: {
                offset: [0.25, 0.5],
                tiling: [2, 4],
                angle: [0, 0, Math.PI / 2],
                threshold: -2,
              },
            },
          ],
        },
      },
    }
    const before = structuredClone(source),
      frame = createUvmEffectFrame(source, {
        time: 0.5,
        viewMatrix: identity,
        materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1] }],
        activeNodes: new Set(['node-0']),
        nodeTransformsAt: () => new Map([['node-0', moved]]),
        maxBytes: 8 * 1048576,
        maxNodes: 100000,
      })
    assert(frame.primitives.length > 0)
    for (const primitive of frame.primitives) {
      close(primitive.positions, [
        center - 1,
        -2,
        0,
        center - 1,
        2,
        0,
        center + 1,
        2,
        0,
        center + 1,
        -2,
        0,
      ])
      assert.deepEqual([...primitive.indices], [0, 1, 2, 0, 2, 3])
      assert.deepEqual([...primitive.transform], [...identity])
      const material = frame.materials.find(item => item.id === primitive.materialId)
      assert.deepEqual(material.simpleEffect.screenUv, {
        offset: [0.25, 0.5],
        tiling: [2, 4],
        angle: Math.PI / 2,
        threshold: 0,
      })
    }
    assert.deepEqual(source, before)
  }
})
