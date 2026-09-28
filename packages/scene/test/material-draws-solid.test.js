import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'
import { materialIsSolid, sceneMaterialDraws } from '../src/render/material-draws.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const standard = (blendMode, depthPrepass = false) => ({
  layers: {
    diffuse: {
      slot: 'diffuse',
      texturePath: null,
      constantColor: { value: [0.4, 0.4, 0.4, 1] },
      uvSource: 0,
      channels: 1,
      op: 2,
      teamColorMode: 0,
      invert: false,
      clampResult: true,
      wrapX: true,
      wrapY: true,
    },
  },
  blendMode,
  priority: 0,
  specularity: 10,
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
  depthPrepass,
})
const programs = (blendMode, depthPrepass) =>
  createStandardMaterialPrograms(
    { renderModel: { version: 1, standard: standard(blendMode, depthPrepass) } },
    { budget },
  ).sample({ time: 0 })
const triangle = (id, materialId, z) => ({
  id,
  materialId,
  topology: 'triangles',
  positions: Float32Array.of(0, 0, z, 1, 0, z, 0, 1, z),
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
})

it('schedules the solid passes of a scene as the full schedule does, without the blended ones', () => {
  const programMap = new Map([
    ['opaque', { passes: programs(0), textures: new Map() }],
    ['blended', { passes: programs(1, true), textures: new Map() }],
    ['prepassed', { passes: programs(0, true), textures: new Map() }],
  ])
  const primitives = [
    triangle('near-blend', 'blended', 1),
    triangle('first', 'opaque', 0),
    triangle('far-blend', 'blended', -1),
    triangle('unprogrammed', 'missing', 0),
    triangle('second', 'prepassed', 2),
  ]
  const materials = [...programMap.keys(), 'missing'].map(id => ({ id, baseColor: [1, 1, 1, 1] }))
  const full = sceneMaterialDraws(primitives, materials, programMap, identity, [], 1)
  const solid = sceneMaterialDraws(
    primitives,
    materials,
    programMap,
    identity,
    [],
    1,
    undefined,
    true,
  )
  assert.ok(full.some(draw => draw.program !== undefined && !materialIsSolid(draw.program)))
  assert.deepEqual(
    solid,
    full.filter(
      draw =>
        draw.program !== undefined && draw.depthOnly !== true && materialIsSolid(draw.program),
    ),
  )
  assert.deepEqual(
    solid.map(draw => draw.primitive.id),
    ['first', 'second'],
  )
})
