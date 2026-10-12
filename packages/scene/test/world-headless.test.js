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

it("carries a batch's team colour and additive blending into the headless scene", async () => {
  const plan = createWorldWebGlPlan({ items: terrain })
  // a texture and a mask that share an id and not their texels
  const white = { id: 'surface', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
  const mask = { id: 'surface', width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }
  // a quad over the middle of the ground, facing up
  const quad = height => ({
    positions: Float32Array.from([
      1,
      height,
      1,
      3,
      height,
      3,
      3,
      height,
      1,
      1,
      height,
      1,
      1,
      height,
      3,
      3,
      height,
      3,
    ]),
    normals: Float32Array.from(Array.from({ length: 6 }, () => [0, 1, 0]).flat()),
    colors: new Float32Array(24).fill(1),
    textureCoordinates: new Float32Array(12),
  })
  const team = {
    mask,
    channel: 0,
    blend: 2,
    strength: 1,
    color: [0, 0, 1],
    rule: { mode: 'data', channel: 0 },
  }
  const teamed = { ...plan, texturedTriangles: [{ ...quad(0.5), texture: white, team }] }
  const { scene } = worldHeadlessScene({
    ...teamed,
    transparentTexturedTriangles: [
      { ...quad(0.6), texture: white, blendMode: 'additive', receiveShadows: false },
    ],
  })
  const material = scene.materials.find(item => item.id === 'world/textured-0')
  assert.notEqual(material.baseColorTexture, material.teamColor.mask.texture)
  assert.deepEqual(material.teamColor, {
    mask: { texture: material.teamColor.mask.texture, channel: 'r' },
    blend: 'replace',
    strength: 1,
    defaultColor: [0, 0, 1],
  })
  const glow = scene.materials.find(item => item.id === 'world/transparent-textured-0')
  assert.equal(glow.simpleEffect.blend, 'additive')
  // the masked white quad takes the batch's blue, seen from above
  const frame = await renderWorldHeadless(teamed, {
    width: 32,
    height: 32,
    camera: { azimuth: Math.PI / 2, elevation: 1.5, zoom: 1, target: [0, 0, 0] },
  })
  const [r, g, b] = frame.rgba.subarray((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 3)
  assert.ok(b > 100 && r < 60 && g < 60, `the middle is ${[r, g, b]}`)
})

it('CPU object lighting affects program and fallback models while terrain stays on its own rig', async () => {
  const white = { ...texture, rgba: Uint8Array.of(255, 255, 255, 255) }
  const lit = structuredClone(material)
  lit.shader.parameters.renderModel.standard.unshaded = false
  const lighting = {
    facet: 'lighting',
    id: 'light',
    layerId: 'lighting',
    coordinateSpaceId: 'uvw',
    ambientColor: [1, 0, 0],
    ambientIntensity: 1,
    directional: [{ id: 'terrain-key', direction: [0, -1, 0], color: [0, 0, 0], intensity: 0 }],
    objects: {
      ambientColor: [0, 0, 1],
      ambientIntensity: 1,
      directional: [{ id: 'object-key', direction: [0, -1, 0], color: [0, 0, 0], intensity: 0 }],
    },
  }
  for (const program of [true, false]) {
    const m = program
      ? lit
      : {
          id: 'surface',
          layers: [{ slot: 'diffuse', resourceId: white.id }],
          baseColorFactor: [1, 1, 1, 1],
        }
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        ...terrain.map(t => ({
          facet: 'terrain-materials',
          id: 'm:' + t.id,
          layerId: 'materials',
          coordinateSpaceId: 'height-grid',
          x: t.x,
          y: t.y,
          weights: [{ materialId: 'white', weight: 1 }],
        })),
        object,
        lighting,
      ],
      terrainMaterials: [{ materialId: 'white', baseColorFactor: [1, 1, 1, 1] }],
      models: new Map([['post', { ...model, materials: [m], textures: [white] }]]),
    })
    const scene = worldHeadlessScene(plan)
    assert.deepEqual(scene.scene.ambientLight, [1, 0, 0])
    assert.ok(scene.materialLighting.size > 0)
    assert.ok([...scene.materialLighting.keys()].some(id => id.startsWith('model-')))
    assert.equal(scene.materialLighting.has('world/ground'), false)
    const { renderHeadless } = await import('../src/render/headless.ts')
    const { createWorldWebGlCameraFrame } = await import('../src/world/webgl.ts')
    // Explicitly lit base surfaces exercise both rigs; world CPU ground remains unlit by default.
    const litScene = {
      ...scene.scene,
      materials: scene.scene.materials.map(m =>
        m.id === 'world/ground' || (!program && m.id.startsWith('model-'))
          ? { ...m, shading: 'lambert' }
          : m,
      ),
    }
    const image = await renderHeadless(
      {
        scene: litScene,
        camera: createWorldWebGlCameraFrame(plan, 64, 64),
        viewport: { width: 64, height: 64 },
        outputKind: 'rgba8',
      },
      scene.splats,
      scene.water,
      scene.terrain,
      scene.materialLighting,
    )
    let blue = 0,
      red = 0
    for (let i = 0; i < image.rgba.length; i += 4) {
      if (image.rgba[i + 2] > 50 && image.rgba[i] < 20) blue++
      if (image.rgba[i] > 50 && image.rgba[i + 2] < 20) red++
    }
    assert.ok(blue > 3, 'object is blue, including fallback material')
    assert.ok(red > 3, 'terrain remains red')
  }
})

it('assigns the object rig to raw CPU fallback batches as well as prefixed model materials', () => {
  const raw = {
    ...model,
    materials: [],
    primitives: model.primitives.map(p => ({ ...p, materialId: undefined })),
  }
  const plan = createWorldWebGlPlan({
    items: [
      ...terrain,
      object,
      {
        facet: 'lighting',
        id: 'l',
        layerId: 'light',
        coordinateSpaceId: 'uvw',
        ambientColor: [1, 0, 0],
        ambientIntensity: 1,
        directional: [],
        objects: { ambientColor: [0, 0, 1], ambientIntensity: 1, directional: [] },
      },
    ],
    models: new Map([['post', raw]]),
  })
  const scene = worldHeadlessScene(plan)
  assert.deepEqual(scene.materialLighting.get('world/opaque-models').ambientLight, [0, 0, 1])
  assert.equal(scene.materialLighting.has('world/ground'), false)
})
