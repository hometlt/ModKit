import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan, worldModelAnimation } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmModel } from '../src/uvm/model.js'
import { readUvmFacets } from '../src/uvm/facets.js'

const texture = { id: 'surface.dds', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
const diffuse = animated => ({
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
  ...(animated
    ? {
        colorMultiply: {
          value: 0,
          sequenceTracks: [
            {
              sequenceIndex: 0,
              track: {
                globalSeqId: null,
                lineType: 1,
                keys: [
                  { frame: 0, vector: [0] },
                  { frame: 1, vector: [1] },
                ],
              },
            },
          ],
        },
      }
    : {}),
})
const model = animated => ({
  state: 'converted',
  sourceKey: 'surface',
  complete: true,
  diagnostics: [],
  meshes: [],
  animations: [
    {
      id: 'stand',
      name: 'Stand',
      kind: 'sequence',
      provenance: 'direct',
      frames: 2,
      durationSeconds: 1,
      looping: true,
      sequenceIndex: 0,
      channels: [],
    },
  ],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: Uint32Array.from([0, 1, 2]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
    },
  ],
  materials: [
    {
      id: 'surface',
      layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: { diffuse: diffuse(animated) },
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
    },
  ],
  textures: [texture],
})
const item = {
  facet: 'objects',
  id: 'object-1',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  resourceId: 'model',
  presentationAnimation: { name: 'Stand', groups: [], loop: true, speed: 1 },
}
const programsAt = (converted, timeSeconds) =>
  createWorldWebGlPlan({ items: [item], models: new Map([['model', converted]]), timeSeconds })
    .modelMaterialScenes[0].programs

it('keeps the programs of clock-independent materials across animated frames', () => {
  const still = model(false)
  const first = programsAt(still, 0)
  assert.equal(first.size, 1)
  // Same model result, later clock: the prepared programs are the same objects, so the renderer
  // keeps their GPU leases instead of preparing them again every frame.
  assert.equal(programsAt(still, 0.5), first)
  assert.equal(programsAt(still, 1.75), first)
})

it('prepares the programs of tracked materials at each clock', () => {
  const animated = model(true)
  const first = programsAt(animated, 0)
  const later = programsAt(animated, 0.5)
  assert.notEqual(later, first)
  const multiply = programs => [...programs.values()][0].passes[0].uniforms
  assert.notDeepEqual(multiply(later), multiply(first))
})

it('uses the same sampled material clock on CPU, including independent instance times and texture bindings', async () => {
  const converted = model(true)
  const one = { ...item, uvwPosition: { x: -0.7, y: 0, z: 0 } }
  const two = { ...item, id: 'object-2', objectId: 2, uvwPosition: { x: 0.7, y: 0, z: 0 } }
  const plan = createWorldWebGlPlan({ items: [one, two], models: new Map([['model', converted]]), animationTimes: new Map([[1, 0.25], [2, 0.75]]) })
  const { programs } = worldHeadlessScene(plan)
  assert.equal(programs.size, 2)
  const bound = [...programs.values()]
  assert.equal(bound[0].textures.get(texture.id), texture)
  assert.notDeepEqual(bound[0].passes[0].uniforms, bound[1].passes[0].uniforms)
  const frame = await renderWorldHeadless(plan, { width: 96, height: 64, camera: { azimuth: Math.PI / 2, elevation: 1.4, zoom: 1, target: [0,0,0] } })
  const nonzero = Array.from({ length: frame.rgba.length / 4 }, (_, i) => frame.rgba[i * 4]).filter(value => value > 0)
  assert.ok(nonzero.some(value => Math.abs(value - 64) <= 1))
  assert.ok(nonzero.some(value => Math.abs(value - 191) <= 1))
})

const layeredItem = (timeSeconds, loop = true) => ({
  ...item,
  presentationAnimation: {
    ...item.presentationAnimation,
    layers: [{ name: 'Stand', groups: [], loop, timeSeconds, priority: 3 }],
  },
})
const layeredPlan = (converted, object) => createWorldWebGlPlan({
  items: [object], models: new Map([['model', converted]]), timeSeconds: 315,
  animationTimes: new Map([[object.objectId, 0]]),
})
const uniformsOf = plan => [...plan.modelMaterialScenes[0].programs.values()][0].passes[0].uniforms
const layeredModel = () => {
  const converted = model(true)
  converted.animations[0].kind = 'animation'
  return converted
}

it('preserves a material-only sequence clock after single-layer pose composition', () => {
  const converted = layeredModel()
  converted.animations[0].durationSeconds = 66.667
  converted.materials[0].shader.parameters.renderModel.standard.layers.diffuse
    .colorMultiply.sequenceTracks[0].track.keys[1].frame = 66.667
  const object = layeredItem(315)
  const resolvedPose = worldModelAnimation(converted, object)
  assert.equal(resolvedPose.sequenceIndex, undefined)
  assert.deepEqual(resolvedPose.channels, [])
  const actual = uniformsOf(layeredPlan(converted, object))
  const expected = [...programsAt(converted, 315).values()][0].passes[0].uniforms
  const fallback = [...programsAt(converted, 0).values()][0].passes[0].uniforms
  assert.deepEqual(actual, expected)
  assert.notDeepEqual(actual, fallback)
})

it('honors the layer loop without wrapping or applying the outer object clock twice', () => {
  const converted = layeredModel()
  const object = layeredItem(1.25, false)
  const expected = createWorldWebGlPlan({
    items: [{ ...item, presentationAnimation: { ...item.presentationAnimation, loop: false } }],
    models: new Map([['model', converted]]), timeSeconds: 1.25,
  })
  assert.deepEqual(uniformsOf(layeredPlan(converted, object)), uniformsOf(expected))
})

it('uses the resolved property layer when another authored layer is unavailable', () => {
  const converted = layeredModel()
  const object = layeredItem(0.75)
  object.presentationAnimation.layers.push({ name: 'Missing', groups: [], loop: true, timeSeconds: 0.25, priority: 4 })
  const expected = [...programsAt(converted, 0.75).values()][0].passes[0].uniforms
  assert.deepEqual(uniformsOf(layeredPlan(converted, object)), expected)
})

it('samples automatically active material sequences on their lifetime clock, with sparse authored overrides', () => {
  const converted = layeredModel()
  const global = { ...converted.animations[0], id: 'global', name: 'GL Stand', sequenceIndex: 1, alwaysActive: true, priority: 2 }
  converted.animations.push(global)
  const property = converted.materials[0].shader.parameters.renderModel.standard.layers.diffuse.colorMultiply
  property.sequenceTracks[0].sequenceIndex = 1
  const at = seconds => ({ ...layeredItem(0.1), presentationAnimation: {
    ...layeredItem(0.1).presentationAnimation, globalTimeSeconds: seconds,
  } })
  const first = uniformsOf(layeredPlan(converted, at(0.25)))
  const later = uniformsOf(layeredPlan(converted, at(0.75)))
  assert.notDeepEqual(first, later)
  assert.deepEqual(first, uniformsOf(layeredPlan(converted, at(1.25))))
  // An authored layer affects only properties it actually contains and wins equal-priority ties.
  property.sequenceTracks.push({ ...property.sequenceTracks[0], sequenceIndex: 0 })
  const overridden = at(0.75)
  overridden.presentationAnimation.layers[0].priority = 2
  assert.notDeepEqual(uniformsOf(layeredPlan(converted, overridden)), later)
  assert.deepEqual(uniformsOf(layeredPlan(converted, overridden)),
    uniformsOf(layeredPlan(converted, { ...overridden, presentationAnimation: {
      ...overridden.presentationAnimation, globalTimeSeconds: 0.25,
    } })))
})

it('uses the model lifetime for concurrent properties inside an ordinary authored sequence', () => {
  const converted = layeredModel()
  const property = converted.materials[0].shader.parameters.renderModel.standard.layers.diffuse.colorMultiply
  Object.assign(property.sequenceTracks[0], { concurrent: true, wrapSeconds: 1 })
  const at = (globalTimeSeconds, localTime) => uniformsOf(layeredPlan(converted, {
    ...layeredItem(localTime), presentationAnimation: {
      ...layeredItem(localTime).presentationAnimation, globalTimeSeconds,
    },
  }))
  assert.deepEqual(at(0.25, 0.1), at(0.25, 0.8))
  assert.notDeepEqual(at(0.25, 0.1), at(0.75, 0.1))
  assert.deepEqual(at(0.25, 0.1), at(1.25, 0.8))
})

it('keeps a material-only lifetime sequence active after serialized UVM reopen', () => {
  const source = model(true)
  const ambient = { ...source.animations[0], name: 'Ambient', kind: 'animation', alwaysActive: true }
  const main = { ...ambient, id: 'main', name: 'Stand', sequenceIndex: 1, alwaysActive: false }
  source.materials[0].layers = []
  source.materials[0].shader.parameters.renderModel.standard.layers.diffuse.texturePath = null
  const written = materializeUvmCore({
    info: { scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 1, textures: 0, animations: 2, geometryAccess: 'decoded' },
    nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }], primitives: source.primitives, materials: source.materials,
    animations: [ambient, main],
  }, { scope: { scopeId: 'model-interchange-v1', version: '1.0.0' }, profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:global-material', options: { assetId: 'fixture/global-material', sourceFormat: 'test' } })
  const container = readUvmContainer(written.bytes), budget = { maxScalarBytes: 1 << 20 }
  const decoded = readUvmModel(container.document, container.binary, budget)
  const converted = { ...source, nodes: decoded.scene.nodes, meshes: decoded.scene.meshes, primitives: decoded.scene.primitives,
    animations: decoded.rig.clips, materials: readUvmFacets(container.document, container.binary, budget).materialRefs }
  assert.equal(converted.animations.find(clip => clip.alwaysActive).channels.length, 0)
  const at = globalTimeSeconds => uniformsOf(layeredPlan(converted, { ...layeredItem(0.1), presentationAnimation: {
    ...layeredItem(0.1).presentationAnimation, globalTimeSeconds,
  } }))
  assert.notDeepEqual(at(0.25), at(0.75))
  assert.deepEqual(at(0.25), at(1.25))
})

it('uses independent single-layer material clocks on CPU while pose clocks remain zero', async () => {
  const converted = layeredModel()
  const one = { ...layeredItem(0.25), uvwPosition: { x: -0.7, y: 0, z: 0 } }
  const two = { ...layeredItem(0.75), id: 'object-2', objectId: 2, uvwPosition: { x: 0.7, y: 0, z: 0 } }
  const plan = createWorldWebGlPlan({ items: [one, two], models: new Map([['model', converted]]), animationTimes: new Map([[1, 0], [2, 0]]) })
  const frame = await renderWorldHeadless(plan, { width: 96, height: 64, camera: { azimuth: Math.PI / 2, elevation: 1.4, zoom: 1, target: [0, 0, 0] } })
  const values = Array.from({ length: frame.rgba.length / 4 }, (_, i) => frame.rgba[i * 4]).filter(value => value > 0)
  assert.ok(values.some(value => Math.abs(value - 64) <= 1))
  assert.ok(values.some(value => Math.abs(value - 191) <= 1))
})
