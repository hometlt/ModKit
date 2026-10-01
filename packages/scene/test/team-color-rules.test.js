import assert from 'node:assert/strict'
import { it } from 'node:test'
import { modelMaterialTeamColor } from '../src/model/team-color.js'
import { applyDrawTeamColor, drawTeamColor, teamMaskRule } from '../src/render/team-color.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const texture = (id, rgba) => ({ id, width: 1, height: 1, rgba: Uint8Array.from(rgba) })
const textures = new Map([
  ['hull.tga', texture('hull.tga', [0, 0, 200, 255])],
  ['houses.png', texture('houses.png', [3, 0, 0, 255])],
])

it('reads a key over the base colour and a house ramp from the team-colour layer', () => {
  const keyed = modelMaterialTeamColor(
    {
      id: 'hull',
      layers: [
        { slot: 'diffuse', resourceId: 'hull.tga' },
        { slot: 'teamColor', blend: 'replace', teamColor: { maskSource: 'channelKey' } },
      ],
    },
    textures,
    0,
  )
  assert.deepEqual(keyed, {
    mask: { texture: 'hull.tga', channel: 'rgb' },
    blend: 'replace',
    key: { channels: ['r', 'g'], threshold: 0, intensity: 'b' },
  })
  const ramped = modelMaterialTeamColor(
    {
      id: 'hull',
      layers: [
        {
          slot: 'teamColor',
          resourceId: 'houses.png',
          blend: 'replace',
          teamColor: {
            maskSource: 'paletteRange',
            range: [2, 3],
            ramp: [
              [0, 0, 1],
              [0, 1, 0],
            ],
          },
        },
      ],
    },
    textures,
    0,
  )
  assert.deepEqual(ramped.ramp, {
    shades: [
      [0, 0, 1],
      [0, 1, 0],
    ],
    first: 2,
    scale: 255,
  })
  // a player's ramp of the same length takes the material's place; another length does not
  const own = [
    [1, 0, 0],
    [1, 1, 0],
  ]
  assert.deepEqual(teamMaskRule(ramped, { teamRamp: own }).shades, own)
  assert.deepEqual(teamMaskRule(ramped, { teamRamp: [[1, 0, 0]] }).shades, ramped.ramp.shades)
})

it('draws the key on the CPU as on the GPU: the colour times B where R and G are zero', () => {
  const material = {
    id: 'hull',
    baseColor: [1, 1, 1, 1],
    teamColor: {
      mask: { texture: 'hull.tga', channel: 'rgb' },
      blend: 'replace',
      key: { channels: ['r', 'g'], threshold: 0, intensity: 'b' },
    },
  }
  const team = drawTeamColor(material, { teamColor: [1, 0, 0] })
  const blue = [0, 0, 200 / 255]
  const drawn = applyDrawTeamColor(team, blue, [...blue, 1])
  assert.deepEqual(
    drawn.map(value => Math.round(value * 255)),
    [200, 0, 0],
  )
})

it('takes an object-tint colour from the object, whose tint then leaves the material', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const model = {
    state: 'converted',
    sourceKey: 'unit',
    complete: true,
    diagnostics: [],
    nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        materialId: 'body',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1),
        textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
      },
    ],
    materials: [
      {
        id: 'body',
        layers: [
          { slot: 'diffuse', resourceId: 'hull.tga' },
          {
            slot: 'teamColor',
            resourceId: 'houses.png',
            colorChannels: 8,
            blend: 'multiply',
            teamColor: { colorSource: 'object-tint' },
          },
        ],
      },
    ],
    textures: [...textures.values()],
  }
  const plan = createWorldWebGlPlan({
    items: [
      {
        facet: 'objects',
        id: 'unit',
        layerId: 'objects',
        coordinateSpaceId: 'uvw',
        kind: 'unit',
        objectId: 1,
        resourceId: 'unit',
        position: { x: 0, y: 0, z: 0 },
        uvwPosition: { x: 0, y: 0, z: 0 },
        presentationTint: [0, 1, 0],
      },
    ],
    models: new Map([['unit', model]]),
    timeSeconds: 0,
  })
  const batch = plan.texturedTriangles.find(candidate => candidate.team !== undefined)
  assert.deepEqual(batch.team.color, [0, 1, 0])
  assert.equal(batch.team.objectTint, true)
  // the tint is the team colour; the vertices carry none of it
  assert.deepEqual([...batch.colors.slice(0, 4)], [1, 1, 1, 1])
})
