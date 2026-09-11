import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type AssetSession,
  type Codec,
  type ContributionContext,
  type ModelMaterialSource,
  type ModelResourceRefsSource,
  type ResourceBudget,
} from '@modkit/sdk'
import { MODEL_FACET_CONTRACTS, readModelFacets } from '@modkit/ui/model'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 200_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('facet fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('facet fixtures have no foreign service dependency')
    },
  },
}
const CODECS = {
  obj: join(repoRoot, 'extensions', 'models', 'src', 'obj', 'codec.js'),
  uvm: join(repoRoot, 'extensions', 'models', 'src', 'uvm', 'codec.js'),
} as const

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://model-facets/${name}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:model-facets-${name}`),
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
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: `model-facets-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

interface DescriptorShape {
  readonly dataSources: readonly { readonly contract: string }[]
  readonly metadata: readonly {
    readonly id: string
    readonly entries: readonly { readonly value: unknown }[]
  }[]
}

async function openCodec(
  format: keyof typeof CODECS,
  bytes: Uint8Array,
): Promise<{ session: AssetSession; contracts: readonly string[]; descriptor: DescriptorShape }> {
  const module = (await import(pathToFileURL(CODECS[format]).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  const session = await module.createCodec(context).open(inputFor(format, bytes), 'inspect', budget)
  const descriptor = (await session.descriptor()) as unknown as DescriptorShape
  return { session, contracts: descriptor.dataSources.map(item => item.contract), descriptor }
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

const richObj = new TextEncoder().encode(
  'mtllib tank.mtl\no hull\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl hull\nf 1 2 3\n',
)

beforeAll(async () => {
  // Lazy SDK descriptor validation is cold host setup, outside the unchanged semantic-test limit.
  const { session } = await openCodec('obj', richObj)
  await session.dispose()
}, 60_000)

describe('common model facet contracts', () => {
  it('publishes OBJ materials and sidecar references through generic contracts', async () => {
    const { session, contracts } = await openCodec('obj', richObj)
    try {
      expect(contracts).toEqual(
        expect.arrayContaining([
          'common.view/model-material-source',
          'common.view/model-resource-refs-source',
        ]),
      )
      const materialLease = await session.dataSource('common.view/model-material-source', 1)
      const materials = materialLease.value as ModelMaterialSource
      expect(await materials.info()).toEqual({ materials: 1, libraries: 1 })
      expect(await drain(request => materials.materials(request))).toEqual([
        { id: 'hull', name: 'hull' },
      ])
      await materialLease.release()

      const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
      const refs = refsLease.value as ModelResourceRefsSource
      expect(await drain(request => refs.references(request))).toEqual([
        { id: 'tank.mtl', role: 'sidecar', provenance: 'reference-only' },
      ])
      await refsLease.release()
    } finally {
      await session.dispose()
    }
  })

  it.each(['obj', 'uvm'] as const)('$format emits a portable projection receipt', async format => {
    const bytes =
      format === 'obj'
        ? richObj
        : new Uint8Array(await readFile(join(fixtureRoot, 'minimal.uvm.glb')))
    const { session, descriptor } = await openCodec(format, bytes)
    try {
      const receipt = descriptor.metadata.find(item => item.id === 'uv-projection-receipt')
        ?.entries[0]?.value as Record<string, unknown>
      expect(receipt).toMatchObject({ form: 'portable' })
      expect(receipt['sourceUri']).toBeUndefined()
      expect(receipt['subjectRevision']).toBe(`content-hash.sha256:model-facets-${format}`)
      expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
    } finally {
      await session.dispose()
    }
  })

  it('feeds the generic facet reader without a format branch', async () => {
    const { session, contracts } = await openCodec('obj', richObj)
    const releases: { release(): Promise<void> }[] = []
    try {
      const bound = MODEL_FACET_CONTRACTS.filter(contract => contracts.includes(contract))
      const readout = await readModelFacets(
        {
          get(binding: { contract: string; major?: number }) {
            return session.dataSource(binding.contract as never, binding.major ?? 1)
          },
        } as never,
        {
          slotId: 'test:model',
          kind: 'primary',
          contributionId: 'org.example/model',
          extensionId: 'org.example',
          priority: 100,
          bindings: bound.map(contract => ({ bindingId: contract, contract, major: 1 })),
        } as never,
        {
          lease<T>(value: T): T {
            releases.push(value as unknown as { release(): Promise<void> })
            return value
          },
        },
      )
      expect(readout).toEqual(['1 resources', '1 materials'])
    } finally {
      await Promise.all(releases.map(lease => lease.release()))
      await session.dispose()
    }
  })
})
