import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

/** One terrain cell (2 × 2 grid points). */
function cell() {
  return [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x, y], index) => ({
    facet: 'terrain',
    id: `overlay-terrain:${index}`,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x,
    y,
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x, y: 0, z: y },
  }))
}

const texture = (id, width = 1, height = 1, rgba = [128, 128, 128, 255]) => ({
  id,
  width,
  height,
  rgba: Uint8Array.from(rgba.length === width * height * 4 ? rgba : Array(width * height).fill(rgba).flat()),
})

describe('world terrain overlays', () => {
  it('draws weight rasters past eight layers as a group blended over the first', () => {
    const materials = Array.from({ length: 10 }, (_, index) => ({
      materialId: `ground-${index}`,
      baseColorResourceId: `ground-${index}.ktx2`,
    }))
    const rasters = [0, 1, 2].map(raster => ({
      resourceId: `weights-${raster}`,
      width: 2,
      height: 2,
      materialIds: materials.slice(raster * 4, raster * 4 + 4).map(material => material.materialId),
      encoding: 'rgba8-unorm',
      normalization: 'sum',
    }))
    const plan = createWorldWebGlPlan({
      items: cell(),
      terrainMaterials: materials,
      terrainWeightRasters: rasters,
      terrainTextures: new Map([
        ...materials.map(material => [material.baseColorResourceId, texture(material.baseColorResourceId)]),
        ...rasters.map(raster => [raster.resourceId, texture(raster.resourceId, 2, 2, [0, 0, 0, 0])]),
      ]),
    })
    assert.equal(plan.splatTriangles.length, 1)
    assert.deepEqual(
      plan.splatTriangles[0].textures.map(item => item.id),
      materials.slice(0, 8).map(material => material.baseColorResourceId),
    )
    assert.equal(plan.splatOverlayTriangles.length, 1)
    const overlay = plan.splatOverlayTriangles[0]
    assert.deepEqual(overlay.textures.map(item => item.id), ['ground-8.ktx2', 'ground-9.ktx2'])
    assert.deepEqual(overlay.weightTextures.map(item => item.id), ['weights-2'])
    // The same cell and the same weight-raster coordinates as the ground below.
    assert.deepEqual(Array.from(overlay.positions), Array.from(plan.splatTriangles[0].positions))
    assert.deepEqual(
      Array.from(overlay.weightTextureCoordinates),
      Array.from(plan.splatTriangles[0].weightTextureCoordinates),
    )
    // Past the ceiling nothing is drawn by rasters.
    const tooMany = createWorldWebGlPlan({
      items: cell(),
      terrainMaterials: materials,
      terrainWeightRasters: [...rasters, { ...rasters[0], resourceId: 'weights-3' }, { ...rasters[0], resourceId: 'weights-4' }],
      terrainTextures: new Map(),
    })
    assert.equal(tooMany.splatOverlayTriangles.length, 0)
  })

  it('blends a cell decal tile over its ground with the tile orientation', () => {
    const items = [
      ...cell(),
      {
        facet: 'terrain-materials',
        id: 'overlay-materials:0',
        layerId: 'terrain-materials',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: 0,
        y: 0,
        textureIndex: 7,
        weights: [{ materialId: 'ground', weight: 1 }],
        decal: {
          materialId: 'decal-7',
          uvTransform: { offset: [0, 0], scale: [1, 1], rotation: -Math.PI / 2 },
        },
      },
    ]
    const plan = createWorldWebGlPlan({
      items,
      terrainMaterials: [
        { materialId: 'ground', baseColorResourceId: 'ground.ktx2' },
        { materialId: 'decal-7', baseColorResourceId: 'tile-07.png' },
      ],
      terrainWeightRasters: [
        {
          resourceId: 'weights',
          width: 2,
          height: 2,
          materialIds: ['ground'],
          encoding: 'rgba8-unorm',
          normalization: 'sum',
        },
      ],
      terrainTextures: new Map([
        ['ground.ktx2', texture('ground.ktx2')],
        ['tile-07.png', texture('tile-07.png', 1, 1, [200, 0, 0, 64])],
        ['weights', texture('weights', 2, 2, [255, 0, 0, 0])],
      ]),
    })
    assert.equal(plan.terrainDecalTriangles.length, 1)
    const decal = plan.terrainDecalTriangles[0]
    assert.equal(decal.texture.id, 'tile-07.png')
    assert.equal(plan.stats.terrainDecalTriangles, 2)
    assert.deepEqual(Array.from(decal.positions), Array.from(plan.splatTriangles[0].positions))
    // Turned a quarter: in-cell (u, v) reads the tile at (v, -u).
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const x = decal.positions[vertex * 3]
      const z = decal.positions[vertex * 3 + 2]
      const u = decal.textureCoordinates[vertex * 2]
      const v = decal.textureCoordinates[vertex * 2 + 1]
      assert.ok(Math.abs(u - z) < 1e-9 && Math.abs(v + x) < 1e-9, `vertex ${vertex}: ${u}, ${v}`)
    }
    // Without its texture the decal is left out, not drawn opaque.
    const unresolved = createWorldWebGlPlan({
      items,
      terrainMaterials: [{ materialId: 'decal-7', baseColorResourceId: 'tile-07.png' }],
      terrainTextures: new Map(),
    })
    assert.equal(unresolved.terrainDecalTriangles.length, 0)
  })

  it('darkens water occluded like terrain by the ground AO at the corners it shares', () => {
    const items = [
      ...cell().map((item, index) => ({ ...item, ambientOcclusion: [1, 0.5, 0.25, 0.75][index] })),
      {
        facet: 'water',
        id: 'water:0',
        layerId: 'water',
        coordinateSpaceId: 'map-native',
        zoneId: 0,
        templateId: 'TER_WATER',
        minimum: { x: 0, y: 0 },
        maximum: { x: 1, y: 1 },
        uvwMinimum: { x: 0, z: 0 },
        uvwMaximum: { x: 1, z: 1 },
        uvwElevation: 0.5,
        materialId: 'water',
      },
    ]
    const material = {
      materialId: 'water',
      classification: 'water',
      shorelineMode: 'zone',
      compositing: 'over',
      color: [0.2, 0.4, 0.6, 0.8],
      colorFalloff: 0,
    }
    const colorsAt = plan => {
      const batch = plan.transparentTriangles
      const byCorner = new Map()
      for (let vertex = 0; vertex < batch.positions.length / 3; vertex += 1)
        byCorner.set(
          `${batch.positions[vertex * 3]}:${batch.positions[vertex * 3 + 2]}`,
          Array.from(batch.colors.slice(vertex * 4, vertex * 4 + 4)).map(value => Math.round(value * 1000) / 1000),
        )
      return byCorner
    }
    const plain = colorsAt(createWorldWebGlPlan({ items, waterMaterials: [material] }))
    assert.deepEqual(plain.get('1:0'), [0.2, 0.4, 0.6, 0.8])
    const occluded = colorsAt(
      createWorldWebGlPlan({ items, waterMaterials: [{ ...material, occludedLikeTerrain: true }] }),
    )
    assert.deepEqual(occluded.get('0:0'), [0.2, 0.4, 0.6, 0.8])
    assert.deepEqual(occluded.get('1:0'), [0.1, 0.2, 0.3, 0.8])
    assert.deepEqual(occluded.get('0:1'), [0.05, 0.1, 0.15, 0.8])
    assert.deepEqual(occluded.get('1:1'), [0.15, 0.3, 0.45, 0.8])
  })

  it('shades detail-wave water per pixel, the depth term and ground AO in its vertex colour', () => {
    const heights = [0, -96, -48, 48]
    const ao = [1, 0.5, 0.25, 0.75]
    const items = [
      ...cell().map((item, index) => ({
        ...item,
        ambientOcclusion: ao[index],
        uvwPosition: { ...item.uvwPosition, y: heights[index] },
      })),
      {
        facet: 'water',
        id: 'water:0',
        layerId: 'water',
        coordinateSpaceId: 'map-native',
        zoneId: 0,
        templateId: 'TER_WATER',
        minimum: { x: 0, y: 0 },
        maximum: { x: 1, y: 1 },
        uvwMinimum: { x: 0, z: 0 },
        uvwMaximum: { x: 1, z: 1 },
        uvwElevation: 0,
        materialId: 'water',
      },
    ]
    const waterMaterial = {
      materialId: 'water',
      classification: 'water',
      shorelineMode: 'zone',
      compositing: 'over',
      color: [0.18, 0.33, 0.42, 1],
      baseColorResourceId: 'glitter-1',
      secondaryColorResourceId: 'glitter-2',
      uvScale: [1, -1, 0.5, -0.5],
      scroll: [0, 1, 0, -1],
      occludedLikeTerrain: true,
      detailWaves: {
        normalResourceIds: ['normal-1', 'normal-2'],
        normalResources: [],
        foamResourceIds: ['foam-1', 'foam-2'],
        foamResources: [],
        sampleScroll: [0, 0.04, 0.02, 0, 0.05, 0, 0, 0.03],
        upScale: 5,
        depthRange: 96,
      },
    }
    const textures = new Map(
      ['glitter-1', 'glitter-2', 'normal-1', 'normal-2', 'foam-1', 'foam-2'].map(id => [id, texture(id)]),
    )
    const plan = createWorldWebGlPlan({ items, waterMaterials: [waterMaterial], terrainTextures: textures })
    const water = plan.transparentTexturedTriangles.find(item => item.waterDetail !== undefined)
    assert.ok(water, 'the detail water batch is drawn')
    assert.equal(water.texture.id, 'glitter-1')
    assert.equal(water.secondaryTexture.id, 'glitter-2')
    assert.deepEqual(water.waterDetail.normals.map(item => item.id), ['normal-1', 'normal-2'])
    assert.deepEqual(water.waterDetail.foam.map(item => item.id), ['foam-1', 'foam-2'])
    assert.deepEqual(water.waterDetail.color, [0.18, 0.33, 0.42])
    assert.equal(water.waterDetail.upScale, 5)
    // terrain_water_high.vert: 1 - (clamp(depth / 96, -1, 1) / 2 + 1/2); the ground's AO in RGB.
    const byCorner = new Map()
    for (let vertex = 0; vertex < water.positions.length / 3; vertex += 1)
      byCorner.set(
        `${water.positions[vertex * 3]}:${water.positions[vertex * 3 + 2]}`,
        Array.from(water.colors.slice(vertex * 4, vertex * 4 + 4)),
      )
    assert.deepEqual(byCorner.get('0:0'), [1, 1, 1, 0.5])
    assert.deepEqual(byCorner.get('1:0'), [0.5, 0.5, 0.5, 0])
    assert.deepEqual(byCorner.get('0:1'), [0.25, 0.25, 0.25, 0.25])
    assert.deepEqual(byCorner.get('1:1'), [0.75, 0.75, 0.75, 0.75])
    // Without its normal images the surface falls back to the plain textured water.
    const flat = createWorldWebGlPlan({
      items,
      waterMaterials: [waterMaterial],
      terrainTextures: new Map([...textures].filter(([id]) => !id.startsWith('normal'))),
    })
    assert.equal(flat.transparentTexturedTriangles.some(item => item.waterDetail !== undefined), false)
  })

  it('lights a decal tile as ground: its normal and gloss maps, the ground AO in colour alpha', () => {
    const items = [
      ...cell().map((item, index) => ({ ...item, ambientOcclusion: [1, 0.5, 0.25, 0.75][index] })),
      {
        facet: 'terrain-materials',
        id: 'overlay-materials:0',
        layerId: 'terrain-materials',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: 0,
        y: 0,
        textureIndex: 7,
        weights: [{ materialId: 'ground', weight: 1 }],
        decal: { materialId: 'decal-7' },
      },
    ]
    const plan = createWorldWebGlPlan({
      items,
      terrainMaterials: [
        {
          materialId: 'ground',
          baseColorResourceId: 'ground.ktx2',
          normalResourceId: 'ground_nm.ktx2',
          normalEncoding: 'rgb-inverted-y',
          specularResourceId: 'ground_sm.ktx2',
          specularEncoding: 'gloss',
        },
        {
          materialId: 'decal-7',
          baseColorResourceId: 'tile-07.ktx2',
          normalResourceId: 'tile-07_nm.ktx2',
          specularResourceId: 'tile-07_sm.ktx2',
          specularEncoding: 'gloss',
        },
      ],
      terrainWeightRasters: [
        {
          resourceId: 'weights',
          width: 2,
          height: 2,
          materialIds: ['ground'],
          encoding: 'rgba8-unorm',
          normalization: 'sum',
        },
      ],
      terrainTextures: new Map(
        ['ground.ktx2', 'ground_nm.ktx2', 'ground_sm.ktx2', 'tile-07.ktx2', 'tile-07_nm.ktx2', 'tile-07_sm.ktx2']
          .map(id => [id, texture(id)])
          .concat([['weights', texture('weights', 2, 2, [255, 0, 0, 0])]]),
      ),
    })
    const ground = plan.splatTriangles[0]
    assert.deepEqual(ground.normalSwizzles, [2])
    assert.equal(ground.specularGloss, true)
    const decal = plan.terrainDecalTriangles[0]
    assert.equal(decal.normalTexture.id, 'tile-07_nm.ktx2')
    assert.equal(decal.normalSwizzle, 0)
    assert.equal(decal.specularTexture.id, 'tile-07_sm.ktx2')
    assert.equal(decal.specularGloss, true)
    // Colour alpha is the ground's AO at each vertex, as the splat batch below carries it.
    const alphas = batch => Array.from({ length: 6 }, (_, vertex) => batch.colors[vertex * 4 + 3])
    assert.deepEqual(alphas(decal), alphas(ground))
    assert.ok(alphas(decal).some(alpha => alpha < 1))
  })

  it('keeps multiplying water apart from the blended passes, its colour whole and unshaded by depth', () => {
    const material = {
      materialId: 'warzone-water',
      classification: 'water',
      shorelineMode: 'zone',
      compositing: 'multiply',
      color: [1, 0.5, 1, 0.2],
      baseColorResourceId: 'water-1',
      secondaryColorResourceId: 'water-2',
    }
    const water = {
      facet: 'water',
      id: 'water:0',
      layerId: 'water',
      coordinateSpaceId: 'map-native',
      zoneId: 0,
      templateId: 'TER_WATER',
      minimum: { x: 0, y: 0 },
      maximum: { x: 1, y: 1 },
      uvwMinimum: { x: 0, z: 0 },
      uvwMaximum: { x: 1, z: 1 },
      uvwElevation: 0.5,
      materialId: 'warzone-water',
    }
    const plan = createWorldWebGlPlan({
      items: [...cell(), water],
      waterMaterials: [material],
      terrainTextures: new Map([
        ['water-1', texture('water-1')],
        ['water-2', texture('water-2')],
      ]),
    })
    assert.equal(plan.multipliedWaterTriangles.length, 1)
    assert.equal(plan.multipliedWaterTriangles[0].texture.id, 'water-1')
    assert.equal(plan.multipliedWaterTriangles[0].secondaryTexture?.id, 'water-2')
    const colors = Array.from(plan.multipliedWaterTriangles[0].colors)
    assert.ok(colors.length > 0)
    for (let offset = 0; offset < colors.length; offset += 4)
      assert.deepEqual(colors.slice(offset, offset + 4), [1, 0.5, 1, 1])
    assert.equal(
      plan.transparentTexturedTriangles.filter(item => item.texture.id === 'water-1').length,
      0,
    )
    const over = createWorldWebGlPlan({
      items: [...cell(), water],
      waterMaterials: [{ ...material, compositing: undefined }],
      terrainTextures: new Map([
        ['water-1', texture('water-1')],
        ['water-2', texture('water-2')],
      ]),
    })
    assert.equal(over.multipliedWaterTriangles.length, 0)
    assert.equal(over.transparentTexturedTriangles.filter(item => item.texture.id === 'water-1').length, 1)
  })

  it('marks no placeholder for an object that draws nothing of its own', () => {
    const object = composition => ({
      facet: 'objects',
      id: `objects:${composition === undefined ? 'unresolved' : 'module'}`,
      layerId: 'objects',
      coordinateSpaceId: 'map-native',
      kind: 'structure',
      objectId: composition === undefined ? 1 : 2,
      position: { x: 0.5, y: 0.5, z: 0 },
      uvwPosition: { x: 0.5, y: 0, z: 0.5 },
      resourceId: 'resource:module',
      ...(composition === undefined ? {} : { modelComponents: composition }),
    })
    const plan = items => createWorldWebGlPlan({ items: [...cell(), ...items], models: new Map() })
    assert.equal(plan([object(undefined)]).stats.diagnosticPlaceholders, 1)
    assert.equal(plan([object([])]).stats.diagnosticPlaceholders, 0)
  })
})
