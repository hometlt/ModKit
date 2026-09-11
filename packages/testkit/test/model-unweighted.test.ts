import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import { revisionId } from '@modkit/sdk'
import { modelPrimitiveByteLength } from '@modkit/codec-kit/model/geometry'
import { preserveUnweightedVertices, createModelSceneSampler } from '../../scene/src/model/index.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import { rebaseUvmScene } from '../../scene/src/uvm/frame.js'
import { readUvmContainer } from '../../uv/src/model/container.js'
import { materializeUvmCore, type ModelProjection } from '../../uv/src/model/materializer.js'

const budget = { maxBytes: 1_000_000, maxNodes: 10_000 }
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const frame = [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 3, 4, 5, 1]
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture value is absent')
  return value
}
async function fixture(zero = true): Promise<ModelProjection> {
  const container = readUvmContainer(
    Buffer.from(
      await readFile(
        new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url),
        'utf8',
      ),
      'base64',
    ),
  )
  const { scene, rig } = readUvmModel(container.document, container.binary, {
    maxScalarBytes: budget.maxBytes,
  })
  const primitives = scene.primitives.map(primitive => {
    const boneWeights = new Float32Array(required(primitive.boneWeights))
    if (zero) boneWeights.fill(0, 0, 4)
    return { ...primitive, boneWeights, boneIndices: new Uint32Array(boneWeights.length).fill(7) }
  })
  return {
    nodes: scene.nodes,
    meshes: scene.meshes,
    primitives,
    skeleton: rig.bindings.map(bone => ({ ...bone, boneIndex: 7 })),
    animations: rig.clips,
    info: {
      scenes: 1,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: primitives.length,
      materials: scene.materials,
      textures: scene.textures,
      animations: scene.animations,
      geometryAccess: 'decoded',
    },
  }
}
const materialize = (projection: ModelProjection) =>
  materializeUvmCore(projection, {
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: revisionId('provider-token:unweighted-fixture'),
    options: { assetId: 'unweighted-fixture', sourceFormat: 'test' },
  })
function sampler(projection: ModelProjection) {
  return createModelSceneSampler(
    {
      ...projection,
      nodes: projection.nodes ?? [],
      meshes: projection.meshes ?? [],
      primitives: projection.primitives ?? [],
    },
    { clip: required(projection.animations?.[0]) },
  )
}

it('uses a constant standard joint for exactly unweighted vertices, retaining animated positions and frames', async () => {
  const original = await fixture()
  expect(() => materialize(original)).toThrow('skin weights must sum to one')
  const prepared = preserveUnweightedVertices(original, budget)
  const generated = required(prepared.generatedBindings[0])
  expect(prepared.generatedBindings).toHaveLength(1)
  expect(generated.boneIndex).toBe(0) // sparse source bone 7 is retained, not renumbered here
  expect(generated.primitives).toEqual([{ id: required(original.primitives?.[0]).id, vertices: 1 }])
  const output = materialize(prepared.projection)
  const container = rebaseUvmScene(readUvmContainer(output.bytes), frame)
  const { scene, rig } = readUvmModel(container.document, container.binary, {
    maxScalarBytes: budget.maxBytes,
  })
  const before = sampler(original)
  const after = createModelSceneSampler(
    { ...scene, skeleton: rig.bindings },
    { clip: required(rig.clips[0]) },
  )
  const targetBone = required(
    rig.bindings.find(bone => bone.nodeId === `node-${output.bindings.nodes[generated.nodeId]}`),
  )
  for (const time of [0, 0.12, 0.5, 0.9, 1]) {
    const expected = before.sample(time),
      actual = after.sample(time)
    expect(actual.diagnostics).toEqual([])
    expect(actual.joints).toHaveLength(expected.joints.length + 1)
    expect(actual.joints.find(joint => joint.boneIndex === targetBone.boneIndex)?.position).toEqual(
      [3, 4, 5],
    )
    for (const [index, primitive] of actual.primitives.entries()) {
      expect(primitive.positions).toEqual(required(expected.primitives[index]).positions)
      expect(primitive.transform).toEqual(new Float32Array(frame))
    }
  }
  expect(materialize(preserveUnweightedVertices(original, budget).projection).bytes).toEqual(
    output.bytes,
  )
})

it('owns replacement skin buffers, borrows unchanged geometry and leaves every nonzero weight untouched', async () => {
  const original = await fixture()
  const primitive = required(original.primitives?.[0])
  const prepared = preserveUnweightedVertices(original, budget)
  const output = required(prepared.projection.primitives?.[0])
  expect(output.positions).toBe(primitive.positions)
  expect(output.boneIndices?.buffer).not.toBe(primitive.boneIndices?.buffer)
  expect(output.boneWeights?.buffer).not.toBe(primitive.boneWeights?.buffer)
  expect(output.boneIndices?.slice(4)).toEqual(primitive.boneIndices?.slice(4))
  expect(output.boneWeights?.slice(4)).toEqual(primitive.boneWeights?.slice(4))
  expect(primitive.boneWeights?.slice(0, 4)).toEqual(new Float32Array(4))
  expect(original.skeleton).toHaveLength(1)
  required(output.boneWeights).fill(0.25)
  expect(primitive.boneWeights?.slice(0, 4)).toEqual(new Float32Array(4))
  const valid = await fixture(false)
  expect(preserveUnweightedVertices(valid, budget)).toEqual({
    projection: valid,
    generatedBindings: [],
  })
  expect(preserveUnweightedVertices(valid, budget).projection).toBe(valid)
})

it('allocates one joint per affected hierarchy and avoids authored node-id collisions', async () => {
  const original = await fixture()
  const bone = required(original.skeleton?.[0]),
    primitive = required(original.primitives?.[0])
  const projection = {
    ...original,
    nodes: [
      ...(original.nodes ?? []),
      { id: 'uvm-unweighted-0', childIds: [], meshIds: [], transform: identity },
    ],
    skeleton: [bone, { ...bone, hierarchyId: 'other', nodeId: 'other-bone' }],
    primitives: [
      primitive,
      { ...primitive, id: 'second' },
      { ...primitive, id: 'third', hierarchyId: 'other' },
    ],
  }
  const result = preserveUnweightedVertices(projection, budget)
  expect(result.generatedBindings.map(binding => binding.nodeId)).toEqual([
    'uvm-unweighted-1',
    'uvm-unweighted-2',
  ])
  expect(result.generatedBindings.map(binding => binding.primitives.length)).toEqual([2, 1])
  expect(result.projection.skeleton?.slice(-2).map(binding => binding.boneIndex)).toEqual([0, 0])
})

it('refuses corrupt indices even at zero weight, invalid weights and ambiguous bindings', async () => {
  const original = await fixture()
  const primitive = required(original.primitives?.[0])
  const invalid = [
    { ...primitive, boneIndices: new Uint32Array(required(primitive.boneIndices)).fill(99) },
    { ...primitive, boneIndices: new Uint32Array(0) },
    ...[NaN, -1, 2, 0.5].map(weight => ({
      ...primitive,
      boneWeights: new Float32Array(required(primitive.boneWeights)).fill(weight),
    })),
  ]
  for (const entry of invalid)
    expect(() => preserveUnweightedVertices({ ...original, primitives: [entry] }, budget)).toThrow()
  expect(() =>
    preserveUnweightedVertices(
      { ...original, skeleton: [...(original.skeleton ?? []), required(original.skeleton?.[0])] },
      budget,
    ),
  ).toThrow('duplicate bone')
  expect(() =>
    preserveUnweightedVertices({ ...original, primitives: [primitive, primitive] }, budget),
  ).toThrow('duplicate primitive')
})

it('reserves both source and replacement scalar storage, bounds node growth and respects cancellation', async () => {
  const original = await fixture()
  const primitive = required(original.primitives?.[0])
  const requiredBytes =
    modelPrimitiveByteLength(primitive) +
    required(primitive.boneIndices).byteLength +
    required(primitive.boneWeights).byteLength
  expect(() =>
    preserveUnweightedVertices(original, { ...budget, maxBytes: requiredBytes - 1 }),
  ).toThrow('maxBytes')
  expect(
    preserveUnweightedVertices(original, { ...budget, maxBytes: requiredBytes }).generatedBindings,
  ).toHaveLength(1)
  const nodes =
    (original.nodes?.length ?? 0) +
    (original.skeleton?.length ?? 0) +
    (original.primitives?.length ?? 0)
  expect(() => preserveUnweightedVertices(original, { ...budget, maxNodes: nodes + 1 })).toThrow(
    'maxNodes',
  )
  expect(() => preserveUnweightedVertices(original, { ...budget, maxBytes: NaN })).toThrow('budget')
  expect(() =>
    preserveUnweightedVertices(original, { ...budget, signal: AbortSignal.abort() }),
  ).toThrow()
})

it('does not manufacture missing native inverse binds or repair incompatible source frames', async () => {
  const original = await fixture()
  const bone = required(original.skeleton?.[0])
  const { inverseBindMatrix: _matrix, ...unknownBind } = bone
  expect(_matrix).toHaveLength(16)
  const missing = preserveUnweightedVertices({ ...original, skeleton: [unknownBind] }, budget)
  expect(() => materialize(missing.projection)).toThrow(/inverse bind/u)
  const transformed = preserveUnweightedVertices(
    {
      ...original,
      nodes: [
        ...(original.nodes ?? []),
        { id: 'external-frame', childIds: [required(bone.nodeId)], meshIds: [], transform: frame },
      ],
    },
    budget,
  )
  expect(() => materialize(transformed.projection)).toThrow(/ancestor|transform/u)
})
