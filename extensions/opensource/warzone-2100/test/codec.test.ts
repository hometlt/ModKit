import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type AssetSession,
  type Codec,
  type ContributionContext,
  type ModelAnimationSource,
  type ModelResourceRefsSource,
  type ModelSceneSource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'
import { createCodec as createPieCodec } from '../src/warzone-pie/codec.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const encoder = new TextEncoder()
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
      throw new Error('PIE codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('PIE codec has no foreign service dependency')
    },
  },
}

const PIE = `PIE 3
TYPE 200
TEXTURE 0 page-7.png
LEVELS 1
LEVEL 1
POINTS 3
0 0 0
1 0 0
0 1 0
POLYGONS 1
200 3 0 1 2 0 0 1 0 0 1
ANIMOBJECT 100 1 2
0 0 0 0 0 0 0 1 1 1
1 1000 0 0 0 0 0 1 1 1
`

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://pie/${name}.pie`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:pie-${name}`),
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
      compositionFingerprint: `pie-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

async function codec(): Promise<Codec> {
  return createPieCodec(context)
}

async function open(
  text: string,
  name = 'fixture',
  limits: ResourceBudget = budget,
  signal?: AbortSignal,
): Promise<AssetSession> {
  return (await codec()).open(inputFor(name, encoder.encode(text)), 'full', limits, signal)
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

function receiptOf(descriptor: unknown): {
  readonly form: string
  readonly planes: readonly {
    readonly planeId: string
    readonly state: string
    readonly note?: string
  }[]
} {
  const groups = (
    descriptor as {
      metadata: readonly { id: string; entries: readonly { value: unknown }[] }[]
    }
  ).metadata
  return groups.find(group => group.id === 'uv-projection-receipt')?.entries[0]
    ?.value as ReturnType<typeof receiptOf>
}

describe('Warzone PIE final MK3 codec', () => {
  it('publishes decoded geometry, texture refs and only record-backed ANIMOBJECT clips', async () => {
    const session = await open(PIE)
    try {
      const descriptor = await session.descriptor()
      expect(descriptor.dataSources.map(item => item.contract)).toEqual(
        expect.arrayContaining([
          'common.view/model-scene-source',
          'common.view/model-resource-refs-source',
          'common.view/model-animation-source',
          'common.view/tree-data-source',
        ]),
      )
      proves({
        contributionId: 'org.modkitx/warzone-pie',
        operation: 'inspect',
        note: 'decoded PIE publishes model, resource and record-backed animation contracts',
      })

      const treeLease = await session.dataSource('common.view/tree-data-source', 1)
      const tree = treeLease.value as TreeDataSource
      const root = await tree.root()
      expect(await tree.facts(root)).toMatchObject({
        kind: 'model',
        label: 'Warzone 2100 PIE',
        preview: '1 node(s)',
      })
      expect((await tree.children(root, { limit: 10 })).items).toHaveLength(1)
      await treeLease.release()

      const modelLease = await session.dataSource('common.view/model-scene-source', 1)
      const model = modelLease.value as ModelSceneSource
      const info = await model.info()
      expect(info).toMatchObject({ nodes: 1, meshes: 1, primitives: 1, textures: 1, animations: 1 })
      const nodes = await drain(request => model.nodes(request))
      expect(nodes).toEqual((await model.nodes({ limit: 100 })).items)
      const meshes = await drain(request => model.meshes(request))
      expect(meshes).toEqual((await model.meshes({ limit: 100 })).items)
      const primitiveId = meshes[0]?.primitiveIds[0]
      if (model.primitive === undefined || primitiveId === undefined) {
        throw new Error('the decoded PIE scene has no readable primitive')
      }
      const primitive = await model.primitive(primitiveId, { maxBytes: 1_000_000 })
      expect([...primitive.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1])
      if (primitive.indices === undefined)
        throw new Error('the decoded PIE primitive has no indices')
      expect([...primitive.indices]).toEqual([0, 2, 1])
      await expect(model.primitive(primitive.id, { maxBytes: 1 })).rejects.toThrow(/maxBytes/u)
      await modelLease.release()

      const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
      const refs = refsLease.value as ModelResourceRefsSource
      const oneByOne = await drain(request => refs.references(request))
      expect(oneByOne).toEqual((await refs.references({ limit: 100 })).items)
      expect(oneByOne).toEqual([
        { id: 'page-7.png', role: 'texture', provenance: 'reference-only' },
      ])
      await refsLease.release()

      const animationLease = await session.dataSource('common.view/model-animation-source', 1)
      const animation = animationLease.value as ModelAnimationSource
      const clips = await drain(request => animation.clips(request))
      expect(clips).toEqual((await animation.clips({ limit: 100 })).items)
      expect(clips).toEqual([
        expect.objectContaining({
          id: 'pie-level-1-animobject-0',
          kind: 'animation',
          provenance: 'direct',
          frames: 2,
          channels: [
            { target: 'pie-level-1', kind: 'translation', firstFrame: 0, lastFrame: 1 },
            { target: 'pie-level-1', kind: 'rotation', firstFrame: 0, lastFrame: 1 },
            { target: 'pie-level-1', kind: 'scale', firstFrame: 0, lastFrame: 1 },
          ],
        }),
      ])
      await animationLease.release()

      const receipt = receiptOf(descriptor)
      expect(receipt.form).toBe('portable')
      expect(receipt.planes.find(plane => plane.planeId === 'animation')).toMatchObject({
        state: 'preserved',
        note: expect.stringContaining('ANIMOBJECT'),
      })
      expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
      proves({
        contributionId: 'org.modkitx/warzone-pie',
        operation: 'read',
        note: 'facet pages agree with bulk reads and the receipt is portable',
      })
    } finally {
      await session.dispose()
    }
  })

  it('does not turn polygon texture animation into a model animation facet', async () => {
    const source = PIE.replace(
      '200 3 0 1 2 0 0 1 0 0 1',
      '4200 3 0 1 2 4 100 1 1 0 0 1 0 0 1',
    ).replace(/ANIMOBJECT[\s\S]*$/u, '')
    const session = await open(source, 'texture-animation-only')
    try {
      const descriptor = await session.descriptor()
      expect(descriptor.dataSources.map(item => item.contract)).not.toContain(
        'common.view/model-animation-source',
      )
      const modelLease = await session.dataSource('common.view/model-scene-source', 1)
      expect((await (modelLease.value as ModelSceneSource).info()).animations).toBe(0)
      await modelLease.release()
      expect(
        receiptOf(descriptor).planes.find(plane => plane.planeId === 'polygon-texture-animation'),
      ).toMatchObject({ state: 'lost' })
    } finally {
      await session.dispose()
    }
  })

  it('materializes and independently accounts for every semantic difference', async () => {
    const session = await open(PIE, 'materialize')
    try {
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      const projection = await drainModelProjection(lease.value, { maxBytes: 1_000_000 })
      await lease.release()
      const verdict = await materializeAndCompare(repoRoot, projection, {
        assetId: 'warzone/synthetic.pie',
        sourceFormat: 'pie',
        subjectRevision: session.revision,
        assetClass: 'unit',
      })
      expect(verdict.byteStable).toBe(true)
      expect(unexplainedDifferences(verdict)).toEqual([])
      proves({
        contributionId: 'org.modkitx/warzone-pie',
        operation: 'materialize',
        note: 'PIE live projection materializes byte-stably and every independently observed diff has a receipt entry',
      })
    } finally {
      await session.dispose()
    }
  })

  it('fails malformed, hostile, over-budget and cancelled inputs closed', async () => {
    await expect(open('PIE 3\nLEVELS 1\nLEVEL 1\nPOINTS 2\n0 0 0\n')).rejects.toThrow(/truncated/u)
    await expect(open(PIE.replace('page-7.png', '../escape.png'), 'path')).rejects.toThrow(
      /confined logical path/u,
    )
    await expect(open(PIE.replace('\n1 1000', '\n0 1000'), 'duplicate-frame')).rejects.toThrow(
      /strictly increasing/u,
    )
    await expect(open(PIE, 'nodes', { ...budget, maxNodes: 3 })).rejects.toThrow(/maxNodes/u)
    await expect(open(PIE, 'scalar', { ...budget, maxScalarBytes: 8 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
    const controller = new AbortController()
    controller.abort()
    await expect(open(PIE, 'cancelled', budget, controller.signal)).rejects.toThrow(
      /abort|cancel/iu,
    )
    proves({
      contributionId: 'org.modkitx/warzone-pie',
      operation: 'validate',
      note: 'malformed blocks, traversal, false frame ranges, budgets and cancellation fail closed',
    })
  })
})
