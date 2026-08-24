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

type CodecId = 'sage-w3x' | 'westwood-w3d'
const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'ea', 'models')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
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
      throw new Error('EA model codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('EA model codecs have no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://ea-models/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:ea-models-${name}`),
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

async function open(id: CodecId, bytes: Uint8Array, resourceBudget = budget) {
  const module = (await import(pathToFileURL(join(extension, 'src', id, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context).open(input(source(bytes, id)), 'inspect', resourceBudget)
}

async function fixture(name: string) {
  return new Uint8Array(await readFile(join(fixtures, name)))
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported EA model codecs', () => {
  it('inventories W3X authored reference planes without claiming decoded geometry', async () => {
    const session = await open('sage-w3x', await fixture('minimal.sage.w3x'))
    expect(await inspect(session)).toMatchObject({
      format: 'sage-w3x',
      elements: 7,
      containers: 1,
      declaredMeshes: 1,
      declaredHierarchies: 1,
      declaredAnimations: 1,
      textures: ['fixture.dds'],
      includes: ['shared.w3x'],
      geometryAccess: 'metadata-only',
    })
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      meshes: 0,
      textures: 1,
      geometryAccess: 'metadata-only',
    })
    await lease.release()
    await session.dispose()
  })

  it('walks bounded recursive W3D chunks and exposes their hierarchy', async () => {
    const session = await open('westwood-w3d', await fixture('minimal.westwood.w3d'))
    expect(await inspect(session)).toMatchObject({
      format: 'westwood-w3d',
      rootChunks: 1,
      chunks: 2,
      chunkTypes: [
        { name: 'HIERARCHY', count: 1 },
        { name: 'HIERARCHY_HEADER', count: 1 },
      ],
      geometryAccess: 'metadata-only',
    })
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const roots = await tree.children(await tree.root(), { limit: 10 })
    const hierarchy = roots.items[0]
    if (hierarchy === undefined) throw new TypeError('W3D hierarchy root was not exposed')
    const children = await tree.children(hierarchy, { limit: 10 })
    expect(children.items).toHaveLength(1)
    await lease.release()
    await session.dispose()
  })

  it('rejects malformed XML, chunk overflows, and resource-budget overflow', async () => {
    const w3x = await fixture('minimal.sage.w3x')
    await expect(open('sage-w3x', w3x, { ...budget, maxNodes: 2 })).rejects.toThrow(/maxNodes/u)
    const malformed = new TextEncoder().encode('<AssetDeclaration><W3DMesh/></broken>')
    await expect(open('sage-w3x', malformed)).rejects.toThrow(/not closed/u)

    const w3d = await fixture('minimal.westwood.w3d')
    await expect(open('westwood-w3d', w3d, { ...budget, maxDepth: 0 })).rejects.toThrow(/maxDepth/u)
    const corrupt = w3d.slice()
    new DataView(corrupt.buffer).setUint32(12, 0x7fffffff, true)
    await expect(open('westwood-w3d', corrupt)).rejects.toThrow(/outside/u)
  })
})
