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
})
