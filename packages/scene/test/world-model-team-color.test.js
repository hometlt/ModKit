import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { modelMaterialTeamColor } from '../src/model/index.js'

const texture = id => ({ id, width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) })
const model = (key, material, textures) => ({
  state: 'converted',
  sourceKey: key,
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [
    {
      id: 'quad',
      topology: 'triangles',
      materialId: 'm',
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1),
      normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
      textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
      indices: Uint32Array.of(0, 1, 2),
    },
  ],
  materials: [{ id: 'm', ...material }],
  textures,
})
const unit = (objectId, resourceId) => ({
  facet: 'objects',
  id: `unit:${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'unit',
  objectId,
  typeId: 'Unit',
  player: 1,
  resourceId,
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  uvwRotation: [0, 0, 0, 1],
})

it("draws a fallback model's team colour layer in its player's colour (П9 step 3)", () => {
  const plan = createWorldWebGlPlan({
    items: [unit(1, 'tank')],
    teamColors: new Map([[1, [1, 0, 0]]]),
    models: new Map([
      [
        'tank',
        model(
          'tank',
          {
            layers: [
              { slot: 'diffuse', resourceId: 'albedo.dds' },
              { slot: 'teamColor', resourceId: 'team.dds', colorChannels: 8, blend: 'lerp' },
            ],
          },
          [texture('albedo.dds'), texture('team.dds')],
        ),
      ],
    ]),
  })
  const [batch] = plan.texturedTriangles
  assert.equal(batch.team.mask.id, 'team.dds')
  assert.deepEqual([batch.team.channel, batch.team.blend, batch.team.color], [3, 4, [1, 0, 0]])
})

it('takes a whole team colour into an untextured model as its colour', () => {
  const plan = createWorldWebGlPlan({
    items: [unit(2, 'hull')],
    teamColors: new Map([[1, [1, 0, 0]]]),
    models: new Map([
      [
        'hull',
        model('hull', { baseColorFactor: [0.5, 0.5, 0.5, 1], layers: [{ slot: 'teamColor' }] }, []),
      ],
    ]),
  })
  assert.deepEqual([...plan.opaqueTriangles.colors.subarray(0, 4)], [0.5, 0, 0, 1])
})

it('reads a material team colour once for every renderer (modelMaterialTeamColor)', () => {
  const textures = new Map([['team.dds', { ...texture('team.dds'), id: 'scene-texture-7' }]])
  assert.deepEqual(
    modelMaterialTeamColor(
      { id: 'm', layers: [{ slot: 'team-color', resourceId: 'team.dds', colorChannels: 8 }] },
      textures,
      0,
    ),
    { mask: { texture: 'scene-texture-7', channel: 'a' }, blend: 'multiply' },
  )
  assert.deepEqual(
    modelMaterialTeamColor(
      { id: 'm', layers: [{ slot: 'teamColor', blend: 'lerp' }] },
      textures,
      0,
    ),
    { mask: 'whole', blend: 'lerp' },
  )
  // a mask on other UVs, or one that did not arrive, is not drawn
  for (const layer of [
    { slot: 'teamColor', resourceId: 'team.dds', uvSource: 1 },
    { slot: 'teamColor', resourceId: 'absent.dds' },
  ])
    assert.equal(modelMaterialTeamColor({ id: 'm', layers: [layer] }, textures, 0), undefined)
})
