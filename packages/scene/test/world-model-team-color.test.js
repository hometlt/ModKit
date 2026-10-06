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
            // unlit: the fallback path draws it (a glTF program lights its material, gltf-program.ts)
            unlit: true,
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
        // unlit: the fallback path draws it (a glTF program lights its material, gltf-program.ts)
        model(
          'hull',
          { baseColorFactor: [0.5, 0.5, 0.5, 1], unlit: true, layers: [{ slot: 'teamColor' }] },
          [],
        ),
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

it("draws a glTF material and its team colour by a program, in its player's colour (C4)", () => {
  const plan = createWorldWebGlPlan({
    items: [unit(3, 'tank'), unit(4, 'bumpy')],
    teamColors: new Map([[1, [1, 0, 0]]]),
    models: new Map([
      [
        'tank',
        model(
          'tank',
          {
            baseColorFactor: [0.5, 0.5, 0.5, 1],
            metallicFactor: 0.25,
            layers: [
              { slot: 'diffuse', resourceId: 'albedo.dds' },
              { slot: 'teamColor', resourceId: 'team.dds', colorChannels: 8, blend: 'lerp' },
            ],
          },
          [texture('albedo.dds'), texture('team.dds')],
        ),
      ],
      [
        // a normal texture is not carried by the glTF programs: the fallback draws the model
        'bumpy',
        model(
          'bumpy',
          {
            layers: [
              { slot: 'diffuse', resourceId: 'albedo.dds' },
              { slot: 'normal', resourceId: 'normal.dds' },
            ],
          },
          [texture('albedo.dds'), texture('normal.dds')],
        ),
      ],
    ]),
  })
  const passes = plan.modelMaterialScenes.flatMap(scene =>
    [...scene.programs.values()].flatMap(programs => programs.passes),
  )
  assert.equal(passes.length, 1)
  const [program] = passes
  assert.equal(program.key, 'gltf;t;team=2;opaque')
  assert.deepEqual(program.uniforms.u_teamColor, [1, 0, 0])
  assert.equal(program.uniforms.u_teamBlend, 4)
  assert.equal(program.uniforms.u_teamMaskChannel, 3)
  assert.equal(program.uniforms.u_metallicFactor, 0.25)
  assert.equal(program.uniforms.u_roughnessFactor, 1)
  assert.deepEqual(
    program.textures.map(binding => [binding.slot, binding.uniform]),
    [
      ['diffuse', 'u_baseColorMap'],
      ['teamColorMask', 'u_teamMaskMap'],
    ],
  )
  assert.equal(plan.texturedTriangles.length, 1)
  assert.equal(plan.texturedTriangles[0].texture.id, 'albedo.dds')
})

it("draws a glTF material's textures on its base colour's UV set, one set per material", () => {
  const second = Float32Array.of(0.5, 0.5, 1, 0.5, 0.5, 1)
  const textures = ['albedo.dds', 'team.dds', 'mr.dds', 'bump.dds'].map(texture)
  const uvModel = (key, layers, sets = [{ set: 2, coordinates: second }]) => {
    const built = model(key, { layers }, textures)
    return {
      ...built,
      primitives: [{ ...built.primitives[0], id: key, textureCoordinateSets: sets }],
    }
  }
  const plan = createWorldWebGlPlan({
    items: [unit(5, 'footman'), unit(6, 'bare'), unit(7, 'split'), unit(8, 'bumpy')],
    teamColors: new Map([[1, [1, 0, 0]]]),
    models: new Map([
      // the base colour on set 2, the team mask on set 0: its program reads set 2 and draws no
      // mask, as the fallback and the UVM route draw it
      [
        'footman',
        uvModel('footman', [
          { slot: 'baseColor', resourceId: 'albedo.dds', uvSource: 2 },
          { slot: 'teamColor', resourceId: 'team.dds', uvSource: 0 },
        ]),
      ],
      // a primitive without that set: no coordinates, as the fallback draws it
      ['bare', uvModel('bare', [{ slot: 'baseColor', resourceId: 'albedo.dds', uvSource: 2 }], [])],
      // metallic-roughness on another set than the base colour's: the fallback
      [
        'split',
        uvModel('split', [
          { slot: 'baseColor', resourceId: 'albedo.dds', uvSource: 2 },
          { slot: 'metallicRoughness', resourceId: 'mr.dds', uvSource: 0 },
        ]),
      ],
      // a normal map in another spelling the fallback draws: the fallback
      [
        'bumpy',
        uvModel('bumpy', [
          { slot: 'baseColor', resourceId: 'albedo.dds' },
          { slot: 'normalMap', resourceId: 'bump.dds' },
        ]),
      ],
    ]),
  })
  const drawn = new Map(
    plan.modelMaterialScenes.flatMap(scene =>
      scene.primitives.map(primitive => [
        primitive.id,
        { primitive, program: scene.programs.get(primitive.materialId).passes[0] },
      ]),
    ),
  )
  assert.deepEqual([...drawn.keys()].sort(), ['bare', 'footman'])
  const footman = drawn.get('footman')
  assert.equal(footman.program.key, 'gltf;t;team=0;opaque')
  // the set it draws is its only one: the GPU path reads a numbered set 0 first
  assert.equal(footman.primitive.textureCoordinates, second)
  assert.equal(footman.primitive.textureCoordinateSets, undefined)
  assert.equal('textureCoordinates' in drawn.get('bare').primitive, false)
  assert.ok(plan.texturedTriangles.length > 0)
})

it('counts the objects each path draws, alike in a plan kept from the last and in a fresh one', () => {
  const input = {
    items: [unit(9, 'gltf'), unit(10, 'unlit')],
    teamColors: new Map([[1, [1, 0, 0]]]),
    models: new Map([
      ['gltf', model('gltf', { baseColorFactor: [0.5, 0.5, 0.5, 1] }, [])],
      ['unlit', model('unlit', { baseColorFactor: [0.5, 0.5, 0.5, 1], unlit: true }, [])],
    ]),
  }
  const counts = plan => [plan.stats.programObjects, plan.stats.fallbackObjects]
  const first = createWorldWebGlPlan(input)
  assert.deepEqual(counts(first), [1, 1])
  // the same still objects, kept: counted as before
  assert.deepEqual(counts(createWorldWebGlPlan({ ...input, timeSeconds: 1 }, first)), [1, 1])
})
