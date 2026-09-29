import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

// A 4×3 height grid painted from one weight raster: exact GPU splat terrain.
const splatTerrain = Array.from({ length: 12 }, (_, index) => ({
  facet: 'terrain',
  id: `terrain:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 4,
  y: Math.floor(index / 4),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 4, y: 0, z: -Math.floor(index / 4) },
}))
const texture = (id, width, height, rgba) => ({ id, width, height, rgba: Uint8Array.from(rgba) })
const splatInput = {
  terrainMaterials: [{ materialId: 'ground', baseColorResourceId: 'ground.dds' }],
  terrainWeightRasters: [
    {
      resourceId: 'weights.rgba',
      width: 1,
      height: 1,
      materialIds: ['ground'],
      encoding: 'rgba8-unorm',
      normalization: 'sum',
    },
  ],
  terrainTextures: new Map([
    ['ground.dds', texture('ground.dds', 1, 1, [120, 90, 60, 255])],
    ['weights.rgba', texture('weights.rgba', 1, 1, [255, 0, 0, 0])],
  ]),
}

const rockTexture = texture('rock.dds', 2, 1, [90, 90, 100, 255, 90, 90, 100, 0])
const rockLayer = (slot, extra = {}) => ({
  slot,
  texturePath: rockTexture.id,
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 0,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...extra,
})
/** An SC2 cliff material; `mask` adds its TerrainAlphaMask (`alpha1`, the texture's alpha). */
const rockMaterial = mask => ({
  id: 'rock',
  layers: [{ slot: 'diffuse', resourceId: rockTexture.id, uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: {
            diffuse: rockLayer('diffuse', { uvTiling: { value: [2, 2] } }),
            ...(mask
              ? {
                  alpha1: rockLayer('alpha1', {
                    channels: 2,
                    uvTiling: { value: [2, 2] },
                    uvOffset: { value: [0.5, 0] },
                  }),
                }
              : {}),
          },
          blendMode: 1,
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
        },
      },
    },
  },
})
// Three faces over the first two columns of cells: a floor wound up, a wall, a floor wound down.
const piece = mask => ({
  state: 'converted',
  sourceKey: 'cliff',
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [
    {
      id: 'faces',
      topology: 'triangles',
      materialId: 'rock',
      positions: Float32Array.of(
        ...[0, 0, 0, 2, 0, 0, 0, 0, -2],
        ...[0, 0, 0, 2, 0, 0, 0, 1, 0],
        ...[2, 0, 0, 0, 0, -2, 2, 0, -2],
      ),
      indices: Uint32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8),
      textureCoordinates: Float32Array.of(
        ...[0, 0, 0.5, 0, 0, 0.5],
        ...[0, 0.5, 0.5, 0.5, 0, 1],
        ...[0.5, 0, 0, 0.5, 0.5, 0.5],
      ),
    },
  ],
  materials: [rockMaterial(mask)],
  textures: [rockTexture],
})
const cliffItem = {
  facet: 'objects',
  id: 'cliff:0',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  typeId: 'TestCliff:CliffMade0:AAAA:0',
  derivedFrom: 'cliffs',
  resourceId: 'cliff',
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  uvwRotation: [0, 0, 0, 1],
}
const planWith = mask =>
  createWorldWebGlPlan({
    items: [...splatTerrain, cliffItem],
    models: new Map([['cliff', piece(mask)]]),
    ...splatInput,
  })
const triangles = batch => (batch === undefined ? 0 : batch.positions.length / 9)

it('draws every face of a masked cliff piece as terrain, masked per pixel, instead of plates', () => {
  const masked = planWith(true)
  const plain = planWith(false)
  const maskBatches = masked.splatTriangles.filter(batch => batch.maskTexture !== undefined)
  assert.equal(maskBatches.length, 1)
  const [mask] = maskBatches
  assert.equal(mask.maskTexture.id, rockTexture.id)
  // AAAA reads the mask from alpha.
  assert.equal(mask.maskChannel, 3)
  // All three faces, the wall included: the rock's alpha test decides per pixel, not the face angle.
  assert.equal(triangles(mask), 3)
  assert.equal(mask.maskTextureCoordinates.length, 3 * 3 * 2)
  // The plates the unmasked piece fills its footprint with are gone from the plain terrain batch.
  const plainTerrain = batches => batches.filter(batch => batch.maskTexture === undefined)
  const plateTriangles =
    plainTerrain(plain.splatTriangles).reduce((sum, batch) => sum + triangles(batch), 0) -
    plainTerrain(masked.splatTriangles).reduce((sum, batch) => sum + triangles(batch), 0)
  assert.equal(plateTriangles, 2)
  assert.equal(
    plain.splatTriangles.some(batch => batch.maskTexture !== undefined),
    false,
  )
  // The cells cut under the piece leave the drawn ground but still cast, at their own heights: the
  // height field throws a cliff's shadow in SC2.
  assert.equal(masked.terrainShadowCasters.length / 9, 8)
  assert.ok(masked.terrainShadowCasters.every((value, index) => index % 3 !== 1 || value === 0))
  assert.ok(masked.stats.shadowCasterTriangles >= 8)
})

it('reads the mask through the alpha1 layer transform and keeps it with its corner', () => {
  const [mask] = planWith(true).splatTriangles.filter(batch => batch.maskTexture !== undefined)
  // alpha1: tiling 2, offset (0.5, 0), no rotation; as the material shader, the offset moves the
  // image and the tiling scales about the centre: (u, v) -> ((u - 0.5 - 0.5) * 2 + 0.5, (v - 0.5) * 2 + 0.5).
  const layerUv = (u, v) => [(u - 1) * 2 + 0.5, (v - 0.5) * 2 + 0.5]
  const uvs = [
    [0, 0, 0.5, 0, 0, 0.5],
    [0, 0.5, 0.5, 0.5, 0, 1],
    [0.5, 0, 0, 0.5, 0.5, 0.5],
  ]
  const positions = [
    [0, 0, 0, 2, 0, 0, 0, 0, -2],
    [0, 0, 0, 2, 0, 0, 0, 1, 0],
    [2, 0, 0, 0, 0, -2, 2, 0, -2],
  ]
  for (let triangle = 0; triangle < 3; triangle++)
    for (let corner = 0; corner < 3; corner++) {
      // Faces are rewound to face up; each drawn corner must keep its own mask UV.
      const drawn = Array.from(mask.positions.slice((triangle * 3 + corner) * 3, (triangle * 3 + corner) * 3 + 3))
      const source = [0, 1, 2].find(
        index =>
          positions[triangle].slice(index * 3, index * 3 + 3).every((value, axis) => value === drawn[axis]),
      )
      assert.notEqual(source, undefined)
      assert.deepEqual(
        Array.from(mask.maskTextureCoordinates.slice((triangle * 3 + corner) * 2, (triangle * 3 + corner) * 2 + 2)),
        layerUv(uvs[triangle][source * 2], uvs[triangle][source * 2 + 1]),
      )
    }
})

it('gives a masked floor and the drawn ground one normal where they meet on a height-field vertex', () => {
  // The ground east of the piece falls away one unit: the edge vertices' own normals lean east.
  const sloped = splatTerrain.map(item =>
    item.x === 3 ? { ...item, uvwPosition: { ...item.uvwPosition, y: -1 } } : item,
  )
  const plan = createWorldWebGlPlan({
    items: [...sloped, cliffItem],
    models: new Map([['cliff', piece(true)]]),
    ...splatInput,
  })
  const [mask] = plan.splatTriangles.filter(batch => batch.maskTexture !== undefined)
  const [ground] = plan.splatTriangles.filter(batch => batch.maskTexture === undefined)
  /** Normals of the batch's up-facing vertices at (x, 0, z). */
  const normalsAt = (batch, x, z) => {
    const found = []
    for (let vertex = 0; vertex < batch.positions.length / 3; vertex++) {
      const [px, py, pz] = batch.positions.slice(vertex * 3, vertex * 3 + 3)
      const normal = Array.from(batch.normals.slice(vertex * 3, vertex * 3 + 3))
      if (Math.abs(px - x) < 1e-6 && Math.abs(py) < 1e-6 && Math.abs(pz - z) < 1e-6 && normal[1] >= 0.5)
        found.push(normal)
    }
    return found
  }
  // The mean of the slope's (1, 1, 0)/√2 and the floor's (0, 1, 0).
  const shared = [Math.SQRT1_2, 1 + Math.SQRT1_2, 0].map(value => value / Math.hypot(Math.SQRT1_2, 1 + Math.SQRT1_2))
  for (const z of [0, -2]) {
    const drawn = [...normalsAt(ground, 2, z), ...normalsAt(mask, 2, z)]
    assert.ok(normalsAt(ground, 2, z).length > 0 && normalsAt(mask, 2, z).length > 0)
    for (const normal of drawn)
      normal.forEach((value, axis) => assert.ok(Math.abs(value - shared[axis]) < 1e-5, `${normal} at z ${z}`))
  }
  // Off the ground's edge the floor keeps the mesh's own normal.
  assert.ok(normalsAt(mask, 0, 0).length > 0)
  for (const normal of normalsAt(mask, 0, 0)) assert.deepEqual(normal.map(value => value + 0), [0, 1, 0])
})

it('gives masked ground one normal where two cliff pieces meet on a shared edge', () => {
  // Piece a's floor covers columns 0-1 leaning east, piece b's column 2 leaning west; they share the
  // edge x = 2. Each mesh carries its own normals along it.
  const lean = x => {
    const length = Math.hypot(x, 1)
    return [x / length, 1 / length, 0]
  }
  const east = lean(0.1),
    west = lean(-0.1)
  const withNormals = (model, normals) => ({
    ...model,
    primitives: model.primitives.map(primitive => ({ ...primitive, normals: Float32Array.of(...normals) })),
  })
  const a = withNormals(piece(true), [...east, ...east, ...east, 0, 0, 1, 0, 0, 1, 0, 0, 1, ...east, ...east, ...east])
  const b = withNormals(
    {
      ...piece(true),
      sourceKey: 'cliff-b',
      primitives: [
        {
          ...piece(true).primitives[0],
          positions: Float32Array.of(...[2, 0, 0, 3, 0, 0, 2, 0, -2], ...[3, 0, 0, 3, 0, -2, 2, 0, -2]),
          indices: Uint32Array.of(0, 1, 2, 3, 4, 5),
          textureCoordinates: Float32Array.of(...[0, 0, 0.5, 0, 0, 0.5], ...[0.5, 0, 0.5, 0.5, 0, 0.5]),
        },
      ],
    },
    [...west, ...west, ...west, ...west, ...west, ...west],
  )
  const plan = createWorldWebGlPlan({
    items: [...splatTerrain, cliffItem, { ...cliffItem, id: 'cliff:1', resourceId: 'cliff-b' }],
    models: new Map([
      ['cliff', a],
      ['cliff-b', b],
    ]),
    ...splatInput,
  })
  const [mask] = plan.splatTriangles.filter(batch => batch.maskTexture !== undefined)
  for (const z of [0, -2]) {
    const found = []
    for (let vertex = 0; vertex < mask.positions.length / 3; vertex++) {
      const [x, y, pz] = mask.positions.slice(vertex * 3, vertex * 3 + 3)
      const normal = Array.from(mask.normals.slice(vertex * 3, vertex * 3 + 3))
      if (Math.abs(x - 2) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(pz - z) < 1e-6 && normal[1] >= 0.5)
        found.push(normal)
    }
    // Both pieces stand on the point, each with its own lean before.
    assert.ok(found.length >= 2)
    for (const normal of found)
      normal.forEach((value, axis) => assert.ok(Math.abs(value - found[0][axis]) < 1e-6, `${normal} at z ${z}`))
    assert.ok(Math.abs(found[0][0]) < east[0])
  }
})

it('joins cliff pieces that share a vertex but read different base offsets', () => {
  // Columns 0-1 are a plateau (level 1), 2-4 low ground (level 0); the brush lowered columns 2-4
  // by 10 base steps, one world unit.
  const terrain = Array.from({ length: 10 }, (_, index) => {
    const x = index % 5
    const plateau = x <= 1
    return {
      facet: 'terrain',
      id: `terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y: Math.floor(index / 5),
      heightBase: plateau ? 100 : 90,
      heightAdjustment: plateau ? 1 : 0,
      mask: 0,
      uvwPosition: { x, y: plateau ? 1 : -1, z: -Math.floor(index / 5) },
    }
  })
  // One extra untouched level-0 vertex row fixes the standard base at 100 and one base step at 0.1.
  const reference = Array.from({ length: 5 }, (_, x) => ({
    facet: 'terrain',
    id: `reference:${x}`,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x,
    y: 2,
    heightBase: 100,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x, y: 0, z: -2 },
  }))
  const face = (id, positions) => ({
    state: 'converted',
    sourceKey: id,
    complete: true,
    diagnostics: [],
    meshes: [],
    nodes: [],
    primitives: [{ id, topology: 'triangles', positions: Float32Array.from(positions) }],
  })
  const placed = (id, resourceId) => ({
    facet: 'objects',
    id,
    layerId: 'objects',
    coordinateSpaceId: 'uvw',
    kind: 'doodad',
    objectId: 1,
    derivedFrom: 'cliffs',
    resourceId,
    position: { x: 0, y: 0, z: 0 },
    uvwPosition: { x: 0, y: 0, z: 0 },
    uvwRotation: [0, 0, 0, 1],
  })
  // Both pieces meet at (2, 1, 0), authored at standard height. Piece a's footprint holds the
  // plateau (offset 0) at that height, piece b's only the lowered ground (offset -1), so each piece
  // alone lifts the shared vertex differently and the seam tears.
  const plan = createWorldWebGlPlan({
    items: [...terrain, ...reference, placed('cliff:a', 'a'), placed('cliff:b', 'b')],
    models: new Map([
      ['a', face('a', [1, 1, 0, 2, 1, 0, 2, 0, 0])],
      ['b', face('b', [2, 1, 0, 3, 1, 0, 3, 0, 0])],
    ]),
  })
  const positions = plan.opaqueTriangles.positions
  const shared = []
  for (let index = 0; index < positions.length; index += 3)
    if (Math.abs(positions[index] - 2) < 1e-6 && Math.abs(positions[index + 2]) < 1e-6)
      shared.push(Math.round(positions[index + 1] * 1000) / 1000)
  // Piece a's foot (2, 0, 0) stands on the lowered ground alone; the shared vertex takes the mean.
  assert.deepEqual(
    shared.filter(height => height !== -1).sort(),
    [0.5, 0.5],
  )
})
