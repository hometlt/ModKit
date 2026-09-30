import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmProjectorFrame, TERRAIN_RECEIVER_ID } from '../src/uvm/projectors.js'

// Washout's sidewalks: a box projector 0.1 deep (near and far zero), its bone at height 0.
const projector = {
  node: 0,
  material: 0,
  active: 1,
  projectionType: 'orthographic',
  offset: [0, 0, 0],
  pitch: 0,
  yaw: 0,
  roll: 0,
  near: 0,
  far: 0,
  fieldOfView: 0,
  aspectRatio: 0,
  boxOffsetXLeft: -1,
  boxOffsetXRight: 1,
  boxOffsetYBack: -1,
  boxOffsetYFront: 1,
  boxOffsetZBottom: -0.05,
  boxOffsetZTop: 0.05,
  alphaInit: 1,
  falloff: 0,
  attenuationDistance: 0,
  flags: 0,
  layer: 0,
}
const document = {
  asset: { version: '2.0' },
  nodes: [{}],
  extensions: { UV_game_effects: { projectors: [projector] } },
}
const layer = slot => ({
  slot,
  texturePath: 'sidewalk.png',
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
})
const material = sourceMaterialTag => ({
  id: 'material-0',
  alphaMode: 'blend',
  layers: [{ slot: 'diffuse', resourceId: 'sidewalk.png', uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        metadata: { sourceMaterialTag },
        layers: [{ label: 'diffuse', path: 'sidewalk.png' }],
        standard: {
          layers: { diffuse: layer('diffuse') },
          blendMode: 1,
          priority: 0,
          specularity: 0,
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
        },
      },
    },
  },
})
// A floor 2 below the box, 4 wide: the ramp's strip as the ground, or a cliff piece's rim.
const floor = id => ({
  id,
  topology: 'triangles',
  positions: Float32Array.of(-2, -2, 2, 2, -2, 2, 2, 2, 2, -2, -2, 2, 2, 2, 2, -2, 2, 2),
})
const trianglesOn = (sourceMaterialTag, receiver) =>
  createUvmProjectorFrame(document, {
    receivers: [floor(receiver)],
    nodeTransforms: new Map([['node-0', Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)]]),
    activeNodes: new Set(['node-0']),
    materials: [material(sourceMaterialTag)],
    maxBytes: 1 << 20,
    maxNodes: 1000,
    warn: () => {},
  }).primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0)

test('a terrain bake lies on the ground at any depth, on other receivers only inside its box', () => {
  // SC2 bakes an STBM into the ground texture, which knows no height: a sidewalk runs down a ramp.
  assert.ok(trianglesOn('STBM', TERRAIN_RECEIVER_ID) > 0)
  // The rims of cliff pieces are not the ground texture: the authored box still bounds them.
  assert.equal(trianglesOn('STBM', 'world-cliff-floor-receiver'), 0)
  // Any other projector keeps its box on the ground too.
  assert.equal(trianglesOn('MAT_', TERRAIN_RECEIVER_ID), 0)
})
