import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkit/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const modulePath = join(repoRoot, 'extensions', 'documents', 'src', 'rtf', 'codec.js')
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('rtf has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('rtf has no foreign service dependency')
    },
  },
}
const sample = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times;}}\\f0\\fs24 Hello.\\par}'
const encode = (text: string): Uint8Array =>
  Uint8Array.from(text, character => character.charCodeAt(0) & 0xff)

function byteSource(bytes: Uint8Array, uri: string): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:common-documents-rtf'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
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
      compositionFingerprint: 'common-documents-rtf',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

async function codec(): Promise<Codec> {
  const module = (await import(pathToFileURL(modulePath).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

describe('common RTF codec', () => {
  it('detects both named and renamed RTF from content', async () => {
    const instance = await codec()
    const probe = async (uri: string) =>
      instance.probe({
        source: byteSource(encode(sample), uri),
        plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
      })
    expect((await probe('memory://doc/note.rtf')).confidence).toBe(0.998)
    expect((await probe('memory://doc/note.dat')).confidence).toBe(0.995)
  })

  it('does not accept an extension without the RTF header', async () => {
    const result = await (
      await codec()
    ).probe({
      source: byteSource(encode('ordinary text'), 'memory://doc/note.rtf'),
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
    })
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('opens bounded structured text through the common tree contract', async () => {
    const source = byteSource(encode(sample), 'memory://doc/note.rtf')
    const session = await (await codec()).open(inputFor(source), 'inspect', budget)
    try {
      const lease = await session.dataSource('common.view/tree-data-source', 1)
      const tree = lease.value as TreeDataSource
      const root = await tree.root()
      const page = await tree.children(root, { limit: 100 })
      expect(page.items.length).toBeGreaterThan(0)
      await lease.release()
    } finally {
      await session.dispose()
    }
  })
})
