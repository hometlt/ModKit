import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan, pickWorldWebGl } from '../src/world/webgl.js'

it('picks shared indexed instances without world-space triangle copies, including reflected scale', () => {
  const texture = { id: 'leaf.dds', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
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
            alphaTestThreshold: 0.5,
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
  const model = {
    state: 'converted',
    sourceKey: 'shared',
    complete: true,
    diagnostics: [],
    meshes: [],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        materialId: 'surface',
        // The unreferenced vertex must not enlarge the camera bounds.
        positions: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 0, 2, 1000, 1000, 1000]),
        indices: Uint16Array.from([0, 1, 2]),
        textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]),
      },
    ],
    materials: [material],
    textures: [texture],
  }
  const items = [1, 2].map((objectId, index) => ({
    facet: 'objects',
    id: `object-${objectId}`,
    layerId: 'objects',
    coordinateSpaceId: 'uvw',
    kind: 'unit',
    objectId,
    position: { x: index * 5, y: 0, z: 0 },
    uvwPosition: { x: index * 5, y: 0, z: 0 },
    uvwScale: { x: index === 0 ? 2 : -2, y: 1, z: 0.5 },
    uvwRotation: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)],
    resourceId: 'model',
  }))
  const camera = { azimuth: 0, elevation: 1.5, zoom: 1, target: [0, 0, 0] }
  const input = { items, models: new Map([['model', model]]), camera }
  const fallback = {
    ...input,
    models: new Map([
      ['model', { ...model, materials: [{ id: material.id, layers: material.layers }] }],
    ]),
  }
  const plan = createWorldWebGlPlan(input)
  const expanded = createWorldWebGlPlan(fallback)
  assert.equal(plan.stats.modelTriangles, 2)
  for (const object of plan.picking.objects) {
    assert.equal(object.triangles.byteLength, 0)
    assert.equal(object.primitives.length, 1)
    assert.equal(object.primitives[0].primitive.positions, model.primitives[0].positions)
  }
  for (const bound of ['minimum', 'maximum']) {
    plan.bounds[bound].forEach((value, axis) =>
      assert.ok(Math.abs(value - expanded.bounds[bound][axis]) < 1e-5),
    )
  }
  let hits = 0
  for (let y = 20; y < 200; y += 20)
    for (let x = 20; x < 200; x += 20) {
      const screen = { x, y, width: 200, height: 200 }
      const actual = pickWorldWebGl(input, screen)
      const expected = pickWorldWebGl(fallback, screen)
      assert.equal(actual?.objectId, expected?.objectId)
      if (actual !== undefined) {
        hits += 1
        actual.position.forEach((value, axis) =>
          assert.ok(Math.abs(value - expected.position[axis]) < 1e-4),
        )
      }
    }
  assert.ok(hits > 0)
})
