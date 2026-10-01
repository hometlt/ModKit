import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { createModelSceneSampler } from '../src/model/sampler.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const quad = (id, z, extra = {}) => ({
  id,
  materialId: id,
  topology: 'triangles',
  positions: Float32Array.of(-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
  ...extra,
})
const layer = (slot, value) => ({
  slot,
  texturePath: null,
  constantColor: { value },
  uvSource: 0,
  channels: 0,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
})
// an unlit opaque program drawing its constant red
const program = {
  id: 'modkit.render-material.v1',
  parameters: {
    renderModel: {
      version: 1,
      standard: {
        layers: { diffuse: layer('diffuse', [1, 0, 0, 1]) },
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
  },
}

/** The centre of a red opaque quad, faded to `fade`, in front of an opaque blue one. */
async function centre(red, fade) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [
        { id: 'red', baseColor: [1, 0, 0, 1], ...red },
        { id: 'blue', baseColor: [0, 0, 1, 1] },
      ],
      primitives: [quad('red', -0.5, { tint: [1, 1, 1, fade] }), quad('blue', 0.5)],
      materialContext: { ambient: [0, 0, 0, 0] },
    },
  })
  return [...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)]
}

it('fades an opaque primitive by its tint alpha over what is behind it', async () => {
  // without a fade the near red hides the blue
  assert.deepEqual(await centre({}, 1), [255, 0, 0, 255])
  // half faded: half red over the blue drawn first (it is ordered behind the fading one)
  assert.deepEqual(await centre({}, 0.5), [128, 0, 128, 255])
})

it('fades a solid material program the same way', async () => {
  assert.deepEqual(await centre({ shader: program }, 1), [255, 0, 0, 255])
  assert.deepEqual(await centre({ shader: program }, 0.5), [128, 0, 128, 255])
})

it('turns a visibility between 0 and 1 into the primitive fade', () => {
  const sampler = createModelSceneSampler(
    {
      info: {
        scenes: 1,
        nodes: 0,
        meshes: 1,
        primitives: 1,
        materials: 0,
        textures: 0,
        animations: 1,
        geometryAccess: 'decoded',
      },
      nodes: [],
      meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
      primitives: [
        {
          id: 'tri',
          topology: 'triangles',
          positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
          indices: Uint32Array.of(0, 1, 2),
        },
      ],
    },
    {
      clip: {
        id: 'decay',
        name: 'Decay',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        channels: [
          {
            target: 'tri',
            kind: 'visibility',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [1] },
              { frame: 1, timeSeconds: 1, value: [0] },
            ],
          },
        ],
      },
    },
  )
  assert.equal(sampler.sample(0).primitives[0].tint, undefined)
  assert.deepEqual(sampler.sample(0.25).primitives[0].tint, [1, 1, 1, 0.75])
  assert.equal(sampler.sample(1).primitives.length, 0)
})
