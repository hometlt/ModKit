import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type AssetSession,
  type Codec,
  type ContributionContext,
  type ModelResourceRefsSource,
  type ModelSceneSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'
import { createCodec as createS3oCodec } from '../src/spring-s3o/codec.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('S3O codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('S3O codec has no foreign service dependency')
    },
  },
}

function writeString(bytes: Uint8Array, offset: number, value: string): void {
  const encoded = new TextEncoder().encode(value)
  bytes.set(encoded, offset)
  bytes[offset + encoded.length] = 0
}

function syntheticS3o(options: { texture?: string } = {}): Uint8Array {
  const bytes = new Uint8Array(320)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('Spring unit\0'), 0)
  view.setInt32(12, 0, true)
  view.setFloat32(16, 4, true)
  view.setFloat32(20, 2, true)
  view.setInt32(36, 80, true)
  view.setInt32(40, 0, true)
  view.setInt32(44, 52, true)
  view.setInt32(48, 66, true)
  writeString(bytes, 52, options.texture ?? 'unittex.png')
  writeString(bytes, 66, 'teamtex.png')

  // Root piece: one child, no geometry, stable name and identity transform.
  view.setInt32(80, 132, true)
  view.setInt32(84, 1, true)
  view.setInt32(88, 140, true)
  view.setInt32(92, 0, true)
  view.setInt32(96, 0, true)
  view.setInt32(100, 0, true)
  view.setInt32(104, 0, true)
  view.setInt32(108, 0, true)
  view.setInt32(112, 0, true)
  view.setInt32(116, 0, true)
  writeString(bytes, 132, 'root')
  view.setInt32(140, 144, true)

  // Child piece: one reflected triangle at local +2 X in the native left-handed frame.
  view.setInt32(144, 196, true)
  view.setInt32(148, 0, true)
  view.setInt32(152, 0, true)
  view.setInt32(156, 3, true)
  view.setInt32(160, 204, true)
  view.setInt32(164, 0, true)
  view.setInt32(168, 0, true)
  view.setInt32(172, 3, true)
  view.setInt32(176, 300, true)
  view.setInt32(180, 0, true)
  view.setFloat32(184, 2, true)
  view.setFloat32(188, 0, true)
  view.setFloat32(192, 0, true)
  writeString(bytes, 196, 'wing')
  const vertices = [
    [0, 0, 0, 0, 1, 0, 0, 0],
    [1, 0, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 0, 1, 0, 0, 1],
  ]
  for (let vertex = 0; vertex < vertices.length; vertex += 1) {
    for (let field = 0; field < 8; field += 1) {
      const value = vertices[vertex]?.[field]
      if (value === undefined) throw new Error('synthetic S3O vertex fixture is incomplete')
      view.setFloat32(204 + vertex * 32 + field * 4, value, true)
    }
  }
  view.setInt32(300, 0, true)
  view.setInt32(304, 1, true)
  view.setInt32(308, 2, true)
  return bytes
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://s3o/${name}.s3o`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:s3o-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: 'content', revision: source.revision }],
      compositionFingerprint: `s3o-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

async function codec(): Promise<Codec> {
  return createS3oCodec(context)
}

async function open(
  bytes: Uint8Array,
  name = 'fixture',
  limits: ResourceBudget = budget,
  signal?: AbortSignal,
): Promise<AssetSession> {
  return (await codec()).open(inputFor(name, bytes), 'full', limits, signal)
}

async function drain<T>(
  read: (request: { limit: number; cursor?: string }) => Promise<{
    items: readonly T[]
    nextCursor?: string
  }>,
): Promise<readonly T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await read(cursor === undefined ? { limit: 1 } : { limit: 1, cursor })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return items
}

interface Receipt {
  readonly form: string
  readonly planes: readonly {
    readonly planeId: string
    readonly state: string
    readonly note?: string
  }[]
  readonly companions: readonly unknown[]
}

function receiptOf(descriptor: unknown): Receipt {
  const groups = (
    descriptor as {
      metadata: readonly { id: string; entries: readonly { value: unknown }[] }[]
    }
  ).metadata
  return groups.find(group => group.id === 'uv-projection-receipt')?.entries[0]?.value as Receipt
}

describe('Spring/Recoil S3O final MK3 codec', () => {
  it('publishes official-layout geometry, stable piece hierarchy and texture refs', async () => {
    const session = await open(syntheticS3o())
    try {
      const descriptor = await session.descriptor()
      expect(descriptor.dataSources.map(item => item.contract)).toEqual(
        expect.arrayContaining([
          'common.view/model-scene-source',
          'common.view/model-resource-refs-source',
        ]),
      )
      expect(descriptor.dataSources.map(item => item.contract)).not.toContain(
        'common.view/model-animation-source',
      )
      proves({
        contributionId: 'org.modkitx/spring-s3o',
        operation: 'inspect',
        note: 'official S3O v0 records publish model and resource contracts without invented animation',
      })

      const modelLease = await session.dataSource('common.view/model-scene-source', 1)
      const model = modelLease.value as ModelSceneSource
      expect(await model.info()).toMatchObject({
        nodes: 2,
        meshes: 1,
        primitives: 1,
        textures: 2,
        animations: 0,
      })
      const nodes = await drain(request => model.nodes(request))
      expect(nodes).toEqual((await model.nodes({ limit: 100 })).items)
      expect(nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 's3o-piece-144', name: 'wing' }),
          expect.objectContaining({
            id: 's3o-piece-80',
            name: 'root',
            childIds: ['s3o-piece-144'],
          }),
        ]),
      )
      const meshes = await drain(request => model.meshes(request))
      expect(meshes).toEqual((await model.meshes({ limit: 100 })).items)
      const primitiveId = meshes[0]?.primitiveIds[0]
      if (model.primitive === undefined || primitiveId === undefined) {
        throw new Error('the decoded S3O scene has no readable primitive')
      }
      const primitive = await model.primitive(primitiveId, { maxBytes: 1_000_000 })
      expect([...primitive.positions]).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0])
      if (primitive.indices === undefined)
        throw new Error('the decoded S3O primitive has no indices')
      expect([...primitive.indices]).toEqual([0, 2, 1])
      await expect(model.primitive(primitive.id, { maxBytes: 1 })).rejects.toThrow(/maxBytes/u)
      await modelLease.release()

      const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
      const refs = refsLease.value as ModelResourceRefsSource
      const oneByOne = await drain(request => refs.references(request))
      expect(oneByOne).toEqual((await refs.references({ limit: 100 })).items)
      expect(oneByOne).toEqual([
        { id: 'unittex.png', role: 'texture', provenance: 'reference-only' },
        { id: 'teamtex.png', role: 'texture', provenance: 'reference-only' },
      ])
      await refsLease.release()

      const receipt = receiptOf(descriptor)
      expect(receipt.form).toBe('portable')
      expect(receipt.companions).toEqual([])
      expect(receipt.planes.find(plane => plane.planeId === 'animation')).toMatchObject({
        state: 'lost',
        note: expect.stringMatching(/BOS\/COB|Lua/u),
      })
      expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
      proves({
        contributionId: 'org.modkitx/spring-s3o',
        operation: 'read',
        note: 'piece and resource pages agree with bulk reads; receipt names external script animation and leaks no path',
      })
    } finally {
      await session.dispose()
    }
  })

  it('materializes and independently accounts for every semantic difference', async () => {
    const session = await open(syntheticS3o(), 'materialize')
    try {
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      const projection = await drainModelProjection(lease.value, { maxBytes: 1_000_000 })
      await lease.release()
      const verdict = await materializeAndCompare(repoRoot, projection, {
        assetId: 'spring/synthetic.s3o',
        sourceFormat: 's3o',
        subjectRevision: session.revision,
        assetClass: 'unit',
      })
      expect(verdict.byteStable).toBe(true)
      expect(unexplainedDifferences(verdict)).toEqual([])
      proves({
        contributionId: 'org.modkitx/spring-s3o',
        operation: 'materialize',
        note: 'S3O live projection materializes byte-stably and every independently observed diff has a receipt entry',
      })
    } finally {
      await session.dispose()
    }
  })

  it('fails malformed, hostile, cyclic, over-budget and cancelled inputs closed', async () => {
    await expect(open(syntheticS3o().slice(0, 120), 'truncated')).rejects.toThrow(
      /outside the file/u,
    )
    await expect(open(syntheticS3o({ texture: '../bad.png' }), 'path')).rejects.toThrow(
      /confined logical path/u,
    )
    const cyclic = syntheticS3o()
    new DataView(cyclic.buffer).setInt32(140, 80, true)
    await expect(open(cyclic, 'cycle')).rejects.toThrow(/cycle/u)
    const badIndex = syntheticS3o()
    new DataView(badIndex.buffer).setInt32(300, 9, true)
    await expect(open(badIndex, 'index')).rejects.toThrow(/outside the piece vertex table/u)
    const badPrimitive = syntheticS3o()
    new DataView(badPrimitive.buffer).setInt32(168, 9, true)
    await expect(open(badPrimitive, 'primitive')).rejects.toThrow(/primitive type/u)
    await expect(open(syntheticS3o(), 'nodes', { ...budget, maxNodes: 4 })).rejects.toThrow(
      /maxNodes/u,
    )
    await expect(open(syntheticS3o(), 'scalar', { ...budget, maxScalarBytes: 3 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
    const controller = new AbortController()
    controller.abort()
    await expect(open(syntheticS3o(), 'cancelled', budget, controller.signal)).rejects.toThrow(
      /abort|cancel/iu,
    )
    proves({
      contributionId: 'org.modkitx/spring-s3o',
      operation: 'validate',
      note: 'truncation, traversal, cycles, bad indices/types, budgets and cancellation fail closed',
    })
  })
})
