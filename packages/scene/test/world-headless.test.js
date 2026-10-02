import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'

const texture = { id: 'red.png', width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }
const material = {
  id: 'surface',
  layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: {
            diffuse: {
              slot: 'diffuse',
              texturePath: texture.id,
              constantColor: { value: [1, 1, 1, 1] },
              uvSource: 0,
              channels: 0,
              op: 6,
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
          twoSided: true,
          unshaded: true,
          doubleLambert: false,
          clampOutput: false,
          usesVertexColor: false,
          usesVertexAlpha: false,
        },
      },
    },
  },
}
// a red quad standing a unit tall over the centre of a 4 x 4 ground
const model = {
  state: 'converted',
  sourceKey: 'post',
  complete: true,
  diagnostics: [],
  meshes: [],
  primitives: [
    {
      id: 'quad',
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from([-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 2, 0]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    },
  ],
  materials: [material],
  textures: [texture],
}
const terrain = Array.from({ length: 25 }, (_, index) => {
  const x = index % 5
  const y = Math.floor(index / 5)
  return {
    facet: 'terrain',
    id: `terrain:${index}`,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x,
    y,
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x, y: 0, z: y },
  }
})
const object = {
  facet: 'objects',
  id: 'object-1',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  position: { x: 2, y: 2, z: 0 },
  uvwPosition: { x: 2, y: 0, z: 2 },
  resourceId: 'post',
}

it('renders a world plan without a GPU: its ground and its models as the plan places them', async () => {
  const plan = createWorldWebGlPlan({
    items: [...terrain, object],
    models: new Map([['post', model]]),
  })
  const { scene } = worldHeadlessScene(plan)
  assert.ok(scene.primitives.some(primitive => primitive.id === 'world/ground'))
  assert.ok(scene.primitives.some(primitive => primitive.id.startsWith('model-0/')))
  // every material a primitive names is in the scene, every texture a material names too
  const materials = new Map(scene.materials.map(item => [item.id, item]))
  const textures = new Set(scene.textures.map(item => item.id))
  for (const primitive of scene.primitives)
    assert.ok(materials.has(primitive.materialId), primitive.id)
  for (const item of scene.materials)
    for (const binding of item.textureBindings ?? []) assert.ok(textures.has(binding.textureId))
  // the world viewer's default camera: the whole world in view, its centre in the middle
  const frame = await renderWorldHeadless(plan, { width: 64, height: 48, clearColor: [0, 0, 0, 1] })
  assert.equal(frame.width, 64)
  let ground = 0
  let red = 0
  let redX = 0
  for (let index = 0; index < frame.rgba.length; index += 4) {
    const [r, g, b] = frame.rgba.subarray(index, index + 3)
    if (r > 150 && g < 60 && b < 60) {
      red += 1
      redX += (index / 4) % 64
    } else if (r + g + b > 0) ground += 1
  }
  assert.ok(ground > 64 * 48 * 0.05, `ground drawn on ${ground} pixels`)
  assert.ok(red > 0, 'the red model is drawn')
  // the model stands where the plan placed it, over the centre of the ground
  assert.ok(Math.abs(redX / red - 32) < 6, `the model drawn around x ${redX / red}`)
})
