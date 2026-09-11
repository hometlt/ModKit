import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { createModelSceneSampler } from '../../scene/src/model/index.js'
import { rebaseUvmScene } from '../../scene/src/uvm/frame.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import { readUvmContainer } from '../../uv/src/model/container.js'
import { materialProgramCases, materialBudget } from './fixtures/scene-material-program.js'
import { snapshotJson } from '../../codec-kit/src/json-snapshot.js'
import { invertMaterialFrame, multiplyMaterialFrames } from '../../scene/src/materials/frame.js'

const matrix = [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 3, 4, 5, 1]
const fixture = async () =>
  readUvmContainer(
    Buffer.from(
      await readFile(
        new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url),
        'utf8',
      ),
      'base64',
    ),
  )
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture value is absent')
  return value
}
const sample = (container: Awaited<ReturnType<typeof fixture>>) => {
  const { scene, rig } = readUvmModel(container.document, container.binary, {
    maxScalarBytes: 1_000_000,
  })
  return createModelSceneSampler(
    { ...scene, skeleton: rig.bindings },
    { clip: required(rig.clips[0]) },
  ).sample(0.5)
}
const convert = (point: readonly number[]) => [
  2 * required(point[0]) + 3,
  2 * required(point[2]) + 4,
  -2 * required(point[1]) + 5,
]

it('rebases known world-material projections in composition order and leaves local/unknown shaders inert', async () => {
  const original = await fixture(),
    world = required(materialProgramCases().find(item => item.name === 'uv-source-17')).material
  const local = required(materialProgramCases().find(item => item.name === 'uv-source-0')).material
  const shader = (standard: typeof world, id = 'modkit.render-material.v1') => ({
    extensions: {
      UV_game_material: {
        shader: id,
        params: snapshotJson({ renderModel: { version: 1, standard } }, materialBudget),
      },
    },
  })
  const materials = [shader(world), shader(local), shader(world, 'example/unknown')]
  const source = { ...original, document: { ...original.document, materials } }
  const first = rebaseUvmScene(source, matrix),
    secondFrame = [0, 2, 0, 0, -0.5, 0, 0, 0, 0, 0, 4, 0, -2, 1, 3, 1]
  const second = rebaseUvmScene(first, secondFrame)
  const projection = (container: typeof original) => {
    const material = (container.document['materials'] as JsonObject[])[0]
    const extension = (material?.['extensions'] as JsonObject)['UV_game_material'] as JsonObject
    const model = (extension['params'] as JsonObject)['renderModel'] as JsonObject
    return model['worldToMaterial']
  }
  expect(projection(first)).toEqual(invertMaterialFrame(matrix))
  expect(projection(second)).toEqual(
    multiplyMaterialFrames(invertMaterialFrame(matrix), invertMaterialFrame(secondFrame)),
  )
  expect((first.document['materials'] as JsonObject[]).slice(1)).toEqual(materials.slice(1))
  expect(source.document.materials).toEqual(materials)
  expect(first.binary).toEqual(source.binary)
})

it('rebases the animated M3-derived UVM skin and joints exactly once without rewriting BIN', async () => {
  const original = await fixture()
  const before = sample(original)
  const rebased = rebaseUvmScene(original, matrix)
  const after = sample(rebased)
  expect(after.diagnostics).toEqual([])
  expect(rebased.binary).toEqual(original.binary)
  expect(rebased.binary.buffer).not.toBe(original.binary.buffer)
  expect(after.primitives).toHaveLength(before.primitives.length)
  for (const [index, primitive] of after.primitives.entries()) {
    expect(primitive.positions).toEqual(required(before.primitives[index]).positions)
    expect(primitive.transform).toEqual(new Float32Array(matrix))
  }
  for (const [index, joint] of after.joints.entries())
    expect(joint.position).toEqual(convert(required(before.joints[index]).position))
  const roots = (original.document['scenes'] as JsonObject[])[0]?.['nodes']
  expect(roots).toEqual([0, 1])
  rebased.binary.fill(0)
  expect(original.binary.some(value => value !== 0)).toBe(true)
})

it('rebases rigid geometry through the same common scene frame', async () => {
  const original = await fixture()
  const rebased = rebaseUvmScene(original, matrix)
  const { scene } = readUvmModel(rebased.document, rebased.binary, { maxScalarBytes: 1_000_000 })
  const primitives = scene.primitives.map(primitive => ({
    id: primitive.id,
    topology: primitive.topology,
    positions: primitive.positions,
    ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
  }))
  const result = createModelSceneSampler({ ...scene, primitives }).sample(0)
  expect(result.diagnostics).toEqual([])
  expect(required(result.primitives[0]).transform).toEqual(new Float32Array(matrix))
})

it('refuses invalid frames, ambiguous scenes, exhausted budgets and cancellation', async () => {
  const original = await fixture()
  for (const invalid of [
    [],
    matrix.map(() => 0),
    matrix.map((value, i) => (i === 3 ? 1 : value)),
    matrix.map(() => Infinity),
  ])
    expect(() => rebaseUvmScene(original, invalid)).toThrow(/frame/u)
  expect(() =>
    rebaseUvmScene({ ...original, document: { ...original.document, scene: 1 } }, matrix),
  ).toThrow()
  expect(() =>
    rebaseUvmScene(original, matrix, {
      maxDepth: 128,
      maxNodes: 1,
      maxJsonBytes: 100,
      maxInputBytes: 1_000_000,
    }),
  ).toThrow()
  expect(() => rebaseUvmScene(original, matrix, undefined, AbortSignal.abort())).toThrow()
})

it('retains the external frame for zero-weight CPU vertices without inventing a bone', async () => {
  const rebased = rebaseUvmScene(await fixture(), matrix)
  const { scene, rig } = readUvmModel(rebased.document, rebased.binary, {
    maxScalarBytes: 1_000_000,
  })
  const primitives = scene.primitives.map(primitive => ({
    ...primitive,
    boneWeights: new Float32Array(required(primitive.boneWeights).length),
  }))
  const result = createModelSceneSampler({ ...scene, primitives, skeleton: rig.bindings }).sample(0)
  expect(result.joints).toHaveLength(rig.bindings.length)
  expect(result.diagnostics.map(item => item.code)).toEqual(['common.model/skin-zero-weights'])
  expect(required(result.primitives[0]).positions).toEqual(required(primitives[0]).positions)
  expect(required(result.primitives[0]).transform).toEqual(new Float32Array(matrix))
})

it('does not repair malformed node/root lists by silently replacing them with empty lists', async () => {
  const original = await fixture()
  for (const document of [
    { ...original.document, nodes: false },
    ...['invalid', [-1], [999_999], [0, 0]].map(nodes => ({
      ...original.document,
      scenes: [{ nodes }],
    })),
  ])
    expect(() => rebaseUvmScene({ ...original, document }, matrix)).toThrow(
      /nodes|roots|scene root/u,
    )
})

it('keeps differently framed roots and transformed groups between bones explicitly unsupported', async () => {
  const { document, binary } = await fixture()
  const { scene, rig } = readUvmModel(document, binary, { maxScalarBytes: 1_000_000 })
  const root = required(rig.bindings[0])
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const child = { ...root, nodeId: 'extra-bone', boneIndex: 1 }
  for (const betweenBones of [false, true]) {
    const nodes = scene.nodes.map(node =>
      node.id === root.nodeId && betweenBones ? { ...node, childIds: ['frame'] } : node,
    )
    nodes.push(
      { id: 'frame', childIds: ['extra-bone'], meshIds: [], transform: matrix },
      { id: 'extra-bone', childIds: [], meshIds: [], transform: identity },
    )
    const skeleton = [root, { ...child, parentBoneIndex: betweenBones ? 0 : null }]
    const result = createModelSceneSampler({ ...scene, nodes, skeleton }).sample(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'common.model/pose-unavailable',
          message: expect.stringContaining(betweenBones ? 'between bones' : 'same external frame'),
        }),
      ]),
    )
  }
})
