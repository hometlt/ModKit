import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmEffectFrame } from '../src/uvm/effects.js'
import { createUvmProjectorFrame } from '../src/uvm/projectors.js'
import { readEffectCollisionShapes } from '../src/uvm/effect-collisions.js'
import { captureCollisionSplats, collisionSplatFrame } from '../src/uvm/collision-splats.js'
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const projector = {
  name: 'impact',
  node: 0,
  material: 0,
  active: 0,
  projectionType: 'orthographic',
  offset: [0, 0, 0],
  pitch: 0,
  yaw: 0,
  roll: 0,
  near: 0.1,
  far: 1,
  fieldOfView: 1,
  aspectRatio: 1,
  boxOffsetXLeft: -1,
  boxOffsetXRight: 1,
  boxOffsetYBack: -1,
  boxOffsetYFront: 1,
  boxOffsetZBottom: 0,
  boxOffsetZTop: 0,
  alphaInit: 1,
  alphaMid: 1,
  alphaEnd: 0,
  lifetimeAttack: 0,
  lifetimeHold: 2,
  lifetimeDecay: 1,
  falloff: 0,
  attenuationDistance: 0,
  flags: 0,
  layer: 0,
}
const document = role => ({
  asset: { version: '2.0' },
  nodes: [
    {},
    { extensions: { UV_game_collision: { role, shapes: [{ kind: 'box', size: [10, 10, 0.2] }] } } },
  ],
  materials: [{}],
  extensions: {
    UV_game_effects: {
      trackTimeUnit: 'seconds',
      particles: [
        {
          name: 'projectile',
          node: 0,
          material: 0,
          orientationMode: 'billboard',
          emitShape: 'point',
          emissionRate: 10,
          lifeSpan: 3,
          speed: 2,
          gravity: 0,
          maxParticles: 16,
          collideObjects: true,
          maxCollisionEvents: 1,
          collisionProjectorIndex: 0,
          collisionProjectorChance: 1,
        },
      ],
      ribbons: [],
      projectors: [projector],
    },
  },
})
const emitterFrame = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 1, 1])
const transforms = new Map([
    ['node-0', emitterFrame],
    ['node-1', identity],
  ]),
  activeNodes = new Set(transforms.keys()),
  materials = [{ id: 'material-0', baseColor: [1, 1, 1, 1] }]
const options = {
  time: 1.25,
  viewMatrix: identity,
  materials,
  activeNodes,
  nodeTransformsAt: () => transforms,
  maxNodes: 10000,
  maxBytes: 8 * 1024 * 1024,
  projectorsHandled: true,
}
test('common physics collisions produce owned live splats and projected receivers from an inactive template', () => {
  const source = document('physics'),
    before = structuredClone(source),
    effects = createUvmEffectFrame(source, options)
  assert(effects.collisionSplats.length > 0)
  assert(
    effects.collisionSplats.every(
      splat =>
        splat.projector === 0 && Math.abs(splat.position[2] - 0.1) < 1e-5 && splat.normal[2] === 1,
    ),
  )
  const positions = Float32Array.from([-0.5, -0.5, 0.099, 0.5, -0.5, 0.099, 0, 0.5, 0.099])
  const frame = createUvmProjectorFrame(source, {
    receivers: [{ id: 'receiver', topology: 'triangles', positions }],
    nodeTransforms: transforms,
    activeNodes,
    materials,
    collisionSplats: effects.collisionSplats,
    maxNodes: 10000,
    maxBytes: 8 * 1024 * 1024,
    warn: () => {},
  })
  assert.equal(frame.primitives.length, effects.collisionSplats.length)
  assert(frame.primitives.every(primitive => primitive.id.startsWith('uvm-projector-impact-')))
  for (const primitive of frame.primitives) assert.deepEqual(primitive.positions, positions)
  assert.deepEqual(source, before)
  assert.deepEqual(createUvmEffectFrame(source, options).collisionSplats, effects.collisionSplats)
})
test('effect-only attachment volumes are never treated as physics solids', () => {
  assert.equal(createUvmEffectFrame(document('effect'), options).collisionSplats.length, 0)
})
test('terrain remains an explicit trusted callback, not an invented implicit ground plane', () => {
  const source = document('effect'),
    emitter = source.extensions.UV_game_effects.particles[0]
  emitter.collideObjects = false
  emitter.collideTerrain = true
  const absent = createUvmEffectFrame(source, options)
  assert.equal(absent.collisionSplats.length, 0)
  assert(absent.diagnostics.some(item => item.message.includes('terrain collision requires')))
  let queries = 0
  const supplied = createUvmEffectFrame(source, {
    ...options,
    collisionProvider: (query, out) => {
      queries++
      assert.equal(query.collisionMask, 1)
      out.position.set([0, 0, 0.1])
      out.normal.set([0, 0, 1])
      return true
    },
  })
  assert(queries > 0)
  assert(supplied.collisionSplats.length > 0)
  assert(supplied.collisionSplats.every(splat => Math.abs(splat.position[2] - 0.1) < 1e-6))
})
test('physics axial conversion and early working budget checks use the existing Y-axis kernel', () => {
  const source = document('physics')
  source.nodes[1].extensions.UV_game_collision.shapes = [
    { kind: 'cylinder', radius: 1, height: 2, axis: 'z' },
  ]
  const projected = readEffectCollisionShapes(source, new Uint8Array(), {
    activeNodes,
    maxNodes: 10,
    maxBytes: 4096,
    warn: () => {},
  })
  assert.deepEqual(projected.shapes[0].matrix, [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1])
  assert.throws(
    () =>
      readEffectCollisionShapes(source, new Uint8Array(), {
        activeNodes,
        maxNodes: 10,
        maxBytes: 511,
        warn: () => {},
      }),
    /budget/,
  )
})
test('splat snapshot is bounded before allocation, owns coordinates, and impact frame uses alpha without fallback', () => {
  const state = {
    capacity: 1,
    activeCount: 1,
    activeSlots: Int32Array.of(0),
    projectorIndices: Uint32Array.of(0),
    positions: Float32Array.of(2, 3, 4),
    normals: Float32Array.of(0, 0, 1),
    alphas: Float32Array.of(0),
  }
  assert.throws(() => captureCollisionSplats(state, 1, 255), /budget/)
  const splat = captureCollisionSplats(state, 1, 256)[0]
  state.positions.fill(9)
  assert.deepEqual(splat.position, [2, 3, 4])
  assert.equal(splat.alpha, 0)
  const frame = collisionSplatFrame(splat, { ...projector, boneIndex: 0, materialIndex: 0 })
  assert.deepEqual(frame.origin, [2, 3, 4.1])
  assert.deepEqual(frame.forwardAxis, [-0, -0, -1])
  assert.deepEqual(frame.rightAxis, [-1, 0, 0])
  assert.deepEqual(frame.upAxis, [0, 1, -0])
})
