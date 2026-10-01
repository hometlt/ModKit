import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { createRenderMaterialSampler } from '../src/materials/render-model.js'
import {
  DEFAULT_SCENE_ENVIRONMENT,
  SCENE_ENVIRONMENT_RESOURCE,
} from '../src/materials/environment.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const layer = (slot, value = {}) => ({
  slot,
  texturePath: null,
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 0,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...value,
})
// an envi layer with no map of its own, replacing the diffuse colour where its alpha is
const sky = (value = {}) => {
  const { constantColor: _, ...envi } = layer('envi', {
    sceneEnvironment: true,
    uvSource: 7,
    op: 3,
    ...value,
  })
  return envi
}
const parameters = layers => ({
  renderModel: {
    version: 1,
    standard: {
      layers,
      blendMode: 0,
      priority: 0,
      specularity: 10,
      specMult: 1,
      emisMult: 1,
      specMode: 0,
      alphaTestThreshold: 0,
      twoSided: false,
      unshaded: true,
      doubleLambert: false,
      clampOutput: false,
      usesVertexColor: false,
      usesVertexAlpha: false,
    },
  },
})

/** The centre pixel of a camera-facing quad whose normals point `normal`, and the diagnostics. */
async function reflected(normal) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [
        {
          id: 'm',
          baseColor: [1, 0, 1, 1],
          shader: {
            id: 'modkit.render-material.v1',
            parameters: parameters({ diffuse: layer('diffuse'), envi: sky() }),
          },
        },
      ],
      primitives: [
        {
          id: 'quad',
          materialId: 'm',
          topology: 'triangles',
          positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
          normals: Float32Array.of(...normal, ...normal, ...normal, ...normal),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        },
      ],
      // no ambient term over the reflection
      materialContext: { ambient: [0, 0, 0, 0] },
    },
  })
  return {
    pixel: [...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)],
    codes: frame.diagnostics.map(item => item.code),
  }
}

it('reflects the neutral default sky when an envi layer names no map of its own', async () => {
  const up = await reflected([0, 1, 0]),
    down = await reflected([0, -1, 0])
  // the sky's zenith and the ground below the horizon, not the magenta base-colour fallback
  assert.deepEqual(up.pixel, [168, 180, 196, 255])
  assert.deepEqual(down.pixel, [92, 88, 84, 255])
  assert.deepEqual(up.codes, [])
})

it('keeps the scene environment out of the resources a host resolves', () => {
  const sampler = createRenderMaterialSampler(
    parameters({ diffuse: layer('diffuse', { texturePath: 'unit.dds' }), envi: sky() }),
    budget,
  )
  assert.deepEqual(sampler.resources, ['unit.dds'])
  assert.equal(sampler.usesSceneEnvironment, true)
  assert.equal(
    sampler.sample({ time: 0 })[0].material.layers.envi.texturePath,
    SCENE_ENVIRONMENT_RESOURCE,
  )
  const own = createRenderMaterialSampler(
    parameters({ envi: layer('envi', { texturePath: 'sky.dds', uvSource: 7 }) }),
    budget,
  )
  assert.equal(own.usesSceneEnvironment, false)
  assert.equal(DEFAULT_SCENE_ENVIRONMENT.rgba.length, 16 * 16 * 4 * 6)
})

it('allows the scene environment only on an envi layer without a map or colour', () => {
  for (const layers of [
    { diffuse: { ...layer('diffuse'), sceneEnvironment: true } },
    { envi: { ...sky(), texturePath: 'sky.dds' } },
    { envi: { ...sky(), constantColor: { value: [1, 1, 1, 1] } } },
    { envi: { ...sky(), sceneEnvironment: false } },
  ])
    assert.throws(() => createRenderMaterialSampler(parameters(layers), budget), /sceneEnvironment/)
})
