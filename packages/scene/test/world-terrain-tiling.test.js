import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createStandardMaterialPrograms } from '../src/materials/index.js'
import { prepareSceneMaterialPrograms } from '../src/render/materials.js'
import { worldTerrainTiling } from '../src/world/webgl.js'

// A 3×3 terrain grid; `place` puts cell (x, y) in the world (UVW: y up, z = -north).
const grid = (place = (x, y) => ({ x, y: 0, z: -y })) =>
  Array.from({ length: 9 }, (_, index) => {
    const x = index % 3,
      y = Math.floor(index / 3)
    return {
      facet: 'terrain',
      id: `t:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: place(x, y),
    }
  })
// Tokyo_Rooftops' ground: 24 repeats over 256 cells, v flipped (SC2 `<heightMap uvtiling>`):
// u = s·x and v = 1 − s·y, written by the centre rule (offset = (0, 1) − c + S·c).
const sc2Ground = { offset: [-0.453125, 0.453125], scale: [24 / 256, -24 / 256], rotation: 0 }
const materials = (...transforms) =>
  transforms.map((uvTransform, index) => ({
    materialId: `m${index}`,
    ...(uvTransform === undefined ? {} : { uvTransform }),
  }))

it('gives world-planar UVs the terrain materials’ tiling', () => {
  assert.deepEqual(
    worldTerrainTiling({ items: grid(), terrainMaterials: materials(sc2Ground, sc2Ground) }),
    [0.09375, 0.09375, 0, 0],
  )
  // Cells two units apart from (10, 4): a world point lands on the terrain's own texel.
  const tiling = worldTerrainTiling({
    items: grid((x, y) => ({ x: 10 + 2 * x, y: 0, z: -(4 + 2 * y) })),
    terrainMaterials: materials(sc2Ground),
  })
  const [t0, t1, t2, t3] = tiling
  const [x, y] = [1.5, 2.25]
  const world = [10 + 2 * x, 4 + 2 * y]
  assert.ok(Math.abs(world[0] * t0 + t2 - (0 + sc2Ground.scale[0] * x)) < 1e-12)
  assert.ok(Math.abs(1 - (world[1] * t1 + t3) - (1 + sc2Ground.scale[1] * y)) < 1e-12)
})

it('leaves the unit tiling when the ground has no single unturned transform', () => {
  const turned = { offset: [0, 0], scale: [1, 1], rotation: Math.PI / 2 }
  assert.equal(worldTerrainTiling({ items: grid(), terrainMaterials: undefined }), undefined)
  assert.equal(worldTerrainTiling({ items: grid(), terrainMaterials: materials(turned) }), undefined)
  assert.equal(
    worldTerrainTiling({ items: grid(), terrainMaterials: materials(sc2Ground, undefined) }),
    undefined,
  )
  assert.equal(worldTerrainTiling({ items: [], terrainMaterials: materials(sc2Ground) }), undefined)
})

const planarLava = {
  renderModel: {
    version: 1,
    standard: {
      layers: {
        emissive1: {
          slot: 'emissive1',
          texturePath: null,
          constantColor: { value: [1, 0.5, 0, 1] },
          uvSource: 5,
          channels: 0,
          op: 2,
          teamColorMode: 0,
          invert: false,
          clampResult: true,
          wrapX: true,
          wrapY: true,
        },
      },
      blendMode: 0,
      priority: 0,
      specularity: 0,
      specMult: 1,
      emisMult: 5,
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
}

it('hands the tiling to the programs, through a scene material context', () => {
  const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
  const sampler = createStandardMaterialPrograms(planarLava, { budget })
  assert.deepEqual(sampler.sample({ time: 0 })[0].uniforms.u_terrainTiling, [1, 1, 0, 0])
  const tiling = [0.09375, 0.09375, 0, 0]
  assert.deepEqual(
    sampler.sample({ time: 0 }, { terrainTiling: tiling })[0].uniforms.u_terrainTiling,
    tiling,
  )
  const lava = [{ id: 'lava', shader: { id: 'modkit.render-material.v1', parameters: planarLava } }]
  const [program] = prepareSceneMaterialPrograms(lava, new Map(), { terrainTiling: tiling }, [])
    .get('lava')
    .passes
  assert.deepEqual(program.uniforms.u_terrainTiling, tiling)
  assert.throws(
    () => prepareSceneMaterialPrograms(lava, new Map(), { terrainTiling: [1, 1, 0] }, []),
    /terrain tiling/,
  )
})
