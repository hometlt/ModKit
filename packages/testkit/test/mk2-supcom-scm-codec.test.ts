import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ModelSceneSource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'annihilation-gas-powered')
const fixturePath = join(import.meta.dirname, 'fixtures', 'mk2-synthetic', 'minimal.scm')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('SupCom SCM codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('SupCom SCM codec has no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array): ArtifactByteSource {
  const uri = 'memory://annihilation-gas-powered/model.scm'
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:supcom-scm-model'),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function input(value: ArtifactByteSource): AssetInput {
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
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: value.revision,
      bindings: [{ bindingId: 'content', revision: value.revision }],
      compositionFingerprint: value.ref.id,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function supcomCodec(): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(extension, 'src', 'supcom-scm', 'codec.js')).href
  )) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(bytes: Uint8Array, resourceBudget = budget) {
  return (await supcomCodec()).open(input(source(bytes)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported Supreme Commander SCM codec', () => {
  it('decodes SCM v5 geometry, names, INFO metadata, and the bone hierarchy', async () => {
    const session = await open(new Uint8Array(await readFile(fixturePath)))
    expect(await inspect(session)).toMatchObject({
      format: 'supcom-scm',
      version: 5,
      vertices: 3,
      indices: 3,
      triangles: 1,
      bones: 1,
      names: ['FixtureRoot'],
      info: ['Machine:Fixture', 'File:Fixture.scm'],
      geometryAccess: 'decoded',
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    })

    const modelLease = await session.dataSource('common.view/model-scene-source', 1)
    const model = modelLease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 2,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 3,
      geometryAccess: 'decoded',
    })
    expect(await model.primitive?.('primitive-0', { maxBytes: 1024 })).toMatchObject({
      topology: 'triangles',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    })
    const nodes = await model.nodes({ limit: 10 })
    expect(nodes.items).toEqual([
      expect.objectContaining({ id: 'model', childIds: ['bone-0'], meshIds: ['mesh-0'] }),
      expect.objectContaining({ id: 'bone-0', name: 'FixtureRoot', childIds: [] }),
    ])

    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const children = await tree.children(await tree.root(), { limit: 10 })
    expect(await Promise.all(children.items.map(item => tree.facts(item)))).toMatchObject([
      { label: 'NAME' },
      { label: 'SKEL' },
      { label: 'VTXL' },
      { label: 'TRIS' },
      { label: 'INFO' },
    ])
    await treeLease.release()
    await modelLease.release()
    await session.dispose()
  })

  it('rejects unsupported versions, invalid indices, and record budgets', async () => {
    const fixture = new Uint8Array(await readFile(fixturePath))
    const version = fixture.slice()
    new DataView(version.buffer).setUint32(4, 4, true)
    await expect(open(version)).rejects.toThrow(/version 4/u)

    const invalidIndex = fixture.slice()
    const indexOffset = new DataView(invalidIndex.buffer).getUint32(0x1c, true)
    new DataView(invalidIndex.buffer).setUint16(indexOffset + 4, 3, true)
    await expect(open(invalidIndex)).rejects.toThrow(/out of range/u)
    await expect(open(fixture, { ...budget, maxNodes: 6 })).rejects.toThrow(/maxNodes/u)
  })
})
