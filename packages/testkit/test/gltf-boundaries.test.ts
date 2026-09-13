import { expect, it } from 'vitest'
import type {
  ArtifactByteSource,
  AssetInput,
  ContributionContext,
  LogicalResourcePort,
  ModelSceneSource,
  ResourceBudget,
} from '@modkit/sdk'
import { revisionId } from '@modkit/sdk'
// The extension runtime is authored JavaScript and intentionally has no package-level declarations.
// @ts-expect-error -- exercised through its public runtime shape below.
import { createCodec } from '../../../extensions/models/src/gltf/codec.js'

const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

function source(bytes: Uint8Array, name = 'fixture.gltf'): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: name, uri: `memory:${name}` },
    revision: revisionId(`content-hash.sha256:${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(value: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: value.ref,
    revision: value.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: value.revision,
      bindings: [{ bindingId: binding.bindingId, revision: value.revision }],
      compositionFingerprint: `gltf-${value.ref.id}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value, async release() {} }
    },
  }
}

function context(logicalResources?: LogicalResourcePort): ContributionContext {
  return {
    budgets: budget,
    diagnostics: { report() {} },
    contracts: {
      async resolve() {
        throw new Error('fixture has no service dependencies')
      },
      async resolveUnknown() {
        throw new Error('fixture has no foreign service dependencies')
      },
    },
    ...(logicalResources === undefined ? {} : { logicalResources }),
  }
}

function externalGeometry() {
  const bytes = new Uint8Array(51)
  const view = new DataView(bytes.buffer)
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  for (let vertex = 0; vertex < 3; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      view.setFloat32(vertex * 16 + axis * 4, positions[vertex * 3 + axis] as number, true)
    }
  }
  bytes.set([0, 1, 2], 48)
  const document = {
    asset: { version: '2.0' },
    buffers: [{ uri: 'triangle.bin', byteLength: bytes.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, byteStride: 16 },
      { buffer: 0, byteOffset: 48, byteLength: 3 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
  return { bytes, json: new TextEncoder().encode(JSON.stringify(document)), document }
}

function logicalPort(bytes: Uint8Array): LogicalResourcePort {
  return {
    async readBatch(request) {
      expect(request.items).toMatchObject([
        {
          requirement: { logicalId: 'triangle.bin', role: 'buffer' },
          size: BigInt(bytes.byteLength),
        },
      ])
      return {
        state: 'complete',
        bytes: BigInt(bytes.byteLength),
        items: [
          {
            state: 'read',
            bytes,
            revision: revisionId('content-hash.sha256:triangle-bin'),
            provenance: {
              requirementId: 'gltf-buffer-0',
              logicalId: 'triangle.bin',
              role: 'buffer',
              state: 'resolved',
              revision: revisionId('content-hash.sha256:triangle-bin'),
              bytes: BigInt(bytes.byteLength),
              cached: false,
              scopes: ['sibling-directory'],
            },
          },
        ],
      }
    },
    async discover() {
      throw new Error('not used')
    },
    async resolve() {
      throw new Error('not used')
    },
    async provenance() {
      return []
    },
  }
}

function chunk(type: number, payload: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(payload.byteLength / 4) * 4)
  padded.fill(type === 0x4e4f534a ? 0x20 : 0)
  padded.set(payload)
  const result = new Uint8Array(8 + padded.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, padded.byteLength, true)
  view.setUint32(4, type, true)
  result.set(padded, 8)
  return result
}

function glb(document: object, extra: Uint8Array[] = []): Uint8Array {
  const chunks = [chunk(0x4e4f534a, new TextEncoder().encode(JSON.stringify(document))), ...extra]
  const result = new Uint8Array(12 + chunks.reduce((sum, value) => sum + value.byteLength, 0))
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, result.byteLength, true)
  let offset = 12
  for (const value of chunks) {
    result.set(value, offset)
    offset += value.byteLength
  }
  return result
}

it('resolves an external strided glTF buffer through the logical-resource port', async () => {
  const fixture = externalGeometry()
  const codec = createCodec(context(logicalPort(fixture.bytes)))
  const session = await codec.open(inputFor(source(fixture.json)), 'full', budget)
  const lease = await session.dataSource('common.view/model-scene-source', 1)
  const model = lease.value as ModelSceneSource
  expect(await model.info()).toMatchObject({ geometryAccess: 'decoded', primitives: 1 })
  expect((await model.primitive?.('mesh-0-primitive-0', { maxBytes: 1024 }))?.positions).toEqual(
    Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  )
  await lease.release()
  await session.dispose()
})

it('refuses sparse accessors and unsupported required extensions precisely', async () => {
  const fixture = externalGeometry()
  const sparse = structuredClone(fixture.document)
  ;(sparse.accessors[0] as Record<string, unknown>).sparse = {
    count: 1,
    indices: { bufferView: 1, componentType: 5121 },
    values: { bufferView: 0 },
  }
  const codec = createCodec(context(logicalPort(fixture.bytes)))
  await expect(
    codec.open(inputFor(source(new TextEncoder().encode(JSON.stringify(sparse)))), 'full', budget),
  ).rejects.toThrow(/sparse accessor is unsupported/u)
  const required = { ...fixture.document, extensionsRequired: ['EXT_meshopt_compression'] }
  await expect(
    codec.open(inputFor(source(new TextEncoder().encode(JSON.stringify(required)))), 'full', budget),
  ).rejects.toThrow(/required extension EXT_meshopt_compression is unsupported/u)
})

it('preserves an unknown aligned GLB chunk across a JSON edit and rejects invalid chunk order', async () => {
  const opaque = chunk(0x12345678, Uint8Array.of(9, 8, 7, 6))
  const bytes = glb({ asset: { version: '2.0', generator: 'before' } }, [opaque])
  const codec = createCodec(context())
  const session = await codec.open(inputFor(source(bytes, 'fixture.glb')), 'full', budget)
  expect((await session.descriptor()).metadata).toContainEqual(
    expect.objectContaining({
      id: 'gltf-document',
      entries: expect.arrayContaining([{ key: 'unknownGlbChunks', value: 1 }]),
    }),
  )
  const result = await session.operations().invoke('edit-gltf-document', {
    json: [{ op: 'replace', path: '/asset/generator', value: 'after' }],
  })
  expect(result.state).toBe('ok')
  if (result.state !== 'ok' || result.output.kind !== 'edit-plan') throw new Error('no edit plan')
  const edit = result.output.plan.edits[0]
  if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline') throw new Error('no bytes')
  expect(edit.payload.bytes.slice(-opaque.byteLength)).toEqual(opaque)
  await session.dispose()

  const invalid = new Uint8Array(bytes)
  new DataView(invalid.buffer).setUint32(16, 0x004e4942, true)
  await expect(
    codec.open(inputFor(source(invalid, 'invalid.glb')), 'full', budget),
  ).rejects.toThrow(/JSON chunk must be first/u)
})
