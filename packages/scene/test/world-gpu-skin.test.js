import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { createModelSceneSampler } from '../src/model/sampler.js'
import { createWorldWebGlPlan, worldMaterialBatchesOf } from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = { id: 'surface.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
// An opaque render-model material: its primitives take the shared (instanced) path.
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
const inverse = (x, y) => {
  const result = [...identity]
  result[12] = -x
  result[13] = -y
  return result
}
const bone = (index, parent, translation, ibm) => ({
  partId: `part-${index}`,
  nodeId: `node-${index}`,
  hierarchyId: 'rig',
  boneIndex: index,
  parentBoneIndex: parent,
  boneName: `joint-${index}`,
  provenance: 'direct',
  localPose: { translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  inverseBindMatrix: ibm,
})
const bindings = [bone(3, 9, [0, 2, 0], inverse(10, 2)), bone(9, null, [10, 0, 0], inverse(10, 0))]
// The Stand clip lifts the root and turns it a quarter about z.
const clip = {
  id: 'stand',
  name: 'Stand',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  channels: [
    ['translation', [10, 0, 0], [10, 3, 0]],
    ['rotation', [0, 0, 0, 1], [0, 0, Math.SQRT1_2, Math.SQRT1_2]],
  ].map(([kind, a, b]) => ({
    target: 'node-9',
    kind,
    firstFrame: 0,
    lastFrame: 1,
    interpolation: kind === 'rotation' ? 'spherical-linear' : 'linear',
    samples: [
      { frame: 0, timeSeconds: 0, value: a },
      { frame: 1, timeSeconds: 1, value: b },
    ],
  })),
}
const nodes = createModelSkeletonNodes(bindings, 'rig').map(node => ({
  ...node,
  childIds: [...node.childIds],
  meshIds: node.id === 'node-9' ? ['mesh'] : [],
}))
const skin = {
  id: 'triangle',
  hierarchyId: 'rig',
  topology: 'triangles',
  materialId: 'surface',
  positions: Float32Array.of(10, 0, 0, 10, 2, 0, 11, 1, 0),
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
  boneIndices: Uint32Array.of(9, 9, 9, 9, 3, 9, 9, 9, 9, 3, 9, 9),
  boneWeights: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0),
}
const model = {
  state: 'converted',
  sourceKey: 'skinned',
  complete: true,
  diagnostics: [],
  nodes,
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  primitives: [skin],
  skeleton: bindings,
  animations: [clip],
  materials: [material],
  textures: [texture],
}
const world = timeSeconds => ({
  items: [
    {
      facet: 'objects',
      id: 'object-1',
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'unit',
      objectId: 1,
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0, y: 0, z: 0 },
      resourceId: 'skinned',
    },
  ],
  models: new Map([['skinned', model]]),
  timeSeconds,
})
const cpuPose = time =>
  createModelSceneSampler(
    { nodes, meshes: model.meshes, primitives: [skin], skeleton: bindings },
    { clip },
  ).sample(time).primitives[0]

it('draws a skin from its bind-pose arrays with each clock its palette, and picks it posed', () => {
  let plan
  const drawn = []
  for (const time of [0.25, 0.5]) {
    plan = createWorldWebGlPlan(world(time), plan)
    const primitive = plan.modelMaterialScenes.flatMap(scene => scene.primitives)[0]
    // The drawn vertices are the model's own arrays: uploaded once, posed by the vertex stage.
    assert.equal(primitive.positions, skin.positions)
    assert.equal(primitive.normals, skin.normals)
    drawn.push(primitive.skin.palette)
    // Its shadow and colour groups carry the pose.
    for (const shadow of [false, true]) {
      const group = worldMaterialBatchesOf(plan, shadow).groups[0]
      assert.equal(group.draw.primitive.skin.palette, primitive.skin.palette)
    }
    // Picking reads the pose on the CPU.
    const [entry] = plan.picking.objects[0].primitives
    assert.deepEqual([...entry.primitive.positions], [...cpuPose(time).positions])
    assert.ok(entry.maximum[1] > 2)
  }
  assert.notEqual(drawn[0], drawn[1])
  assert.notDeepEqual([...drawn[0]], [...drawn[1]])
})
