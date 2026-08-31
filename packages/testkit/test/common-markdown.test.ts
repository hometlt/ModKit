/**
 * Block 11 slice 11A.2 — Markdown is not ported again; it already lives in
 * `extensions/documents`. What the slice owes it is three closures:
 *
 *  - every alias the legacy route answered for (`.md`, `.markdown`, `.mdown`, `.mkd`) is detected
 *    by bounded structure plus the alias, not by extension alone;
 *  - preview is safe: nothing in the published surface executes or renders HTML or script — hostile
 *    markup survives as literal text and the codec declares no render operation at all;
 *  - the native route remains confident for every supported alias.
 *
 * The edit transaction on the existing `common.edit` seam is proven separately in
 * `packages/host/test/editing-evidence.test.ts`.
 */
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
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const nativeModule = join(repoRoot, 'extensions', 'documents', 'src', 'markdown', 'codec.js')
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 16,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('markdown has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('markdown has no foreign service dependency')
    },
  },
}

function byteSource(bytes: Uint8Array, uri: string): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:common-markdown'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
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
      compositionFingerprint: 'common-markdown',
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function codecFrom(modulePath: string): Promise<Codec> {
  const module = (await import(pathToFileURL(modulePath).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

async function confidence(modulePath: string, text: string, uri: string): Promise<number> {
  const probed = await (
    await codecFrom(modulePath)
  ).probe({
    source: byteSource(encode(text), uri),
    plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
  })
  return probed.confidence
}

const SAMPLE = '# Title\n\nSee [spec](https://example.invalid/spec).\n\n- one\n- two\n'
const ALIASES = ['md', 'markdown', 'mdown', 'mkd'] as const

describe('11A common/documents markdown', () => {
  it('answers for every legacy alias through structure plus the alias, never the extension alone', async () => {
    const manifest = JSON.parse(
      await readFile(
        join(repoRoot, 'extensions', 'documents', 'contributions', 'codec-markdown.json'),
        'utf8',
      ),
    ) as {
      spec: { match: { extensions: readonly string[] }; operations: readonly { id: string }[] }
    }
    expect(manifest.spec.match.extensions.toSorted()).toEqual([...ALIASES].toSorted())

    for (const alias of ALIASES) {
      expect(await confidence(nativeModule, SAMPLE, `memory://doc/notes.${alias}`), alias).toBe(
        0.96,
      )
    }
    // structure without an alias is plausible, an alias without structure is weak, and neither
    // is confident: the extension alone never decides
    expect(await confidence(nativeModule, SAMPLE, 'memory://doc/notes.rst')).toBe(0.72)
    expect(await confidence(nativeModule, 'plain sentence\n', 'memory://doc/notes.md')).toBe(0.4)
    expect(await confidence(nativeModule, 'plain sentence\n', 'memory://doc/notes.rst')).toBe(0.05)
  })

  it('keeps preview safe: hostile HTML and script survive as text and nothing renders them', async () => {
    const hostile = [
      '# Heading',
      '',
      '<script>globalThis.__pwned = true</script>',
      '<img src=x onerror="globalThis.__pwned = true">',
      '',
      '[click me](javascript:globalThis.__pwned=true)',
      '',
      '<iframe src="https://example.invalid/"></iframe>',
      '',
    ].join('\n')

    const manifest = JSON.parse(
      await readFile(
        join(repoRoot, 'extensions', 'documents', 'contributions', 'codec-markdown.json'),
        'utf8',
      ),
    ) as { spec: { operations: readonly { id: string; mutatesSource: boolean }[] } }
    // No render, no thumbnail, no execute: there is no operation that could run the markup.
    const operations = manifest.spec.operations.map(operation => operation.id).toSorted()
    expect(operations).toEqual(['asset.validate', 'export.raw', 'view.inspect'])
    expect(manifest.spec.operations.some(operation => operation.mutatesSource)).toBe(false)

    const session = await (
      await codecFrom(nativeModule)
    ).open(inputFor(byteSource(encode(hostile), 'memory://doc/hostile.md')), 'inspect', budget)

    const inspected = await session.operations().invoke('inspect', null)
    expect(inspected.state).toBe('ok')
    if (inspected.state === 'ok' && inspected.output.kind === 'json') {
      // the hostile lines are counted as ordinary markdown, not as markup to run
      expect(inspected.output.value).toMatchObject({ format: 'markdown', headings: 1, links: 1 })
    }

    // the outline carries one heading; no node claims to be html, script or an embedded frame
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const root = await tree.root()
    const children = await tree.children(root, { limit: 32 })
    const facts = await Promise.all(children.items.map(node => tree.facts(node)))
    expect(facts.map(fact => fact.kind)).toEqual(['heading'])
    for (const fact of facts) {
      expect(fact.kind).not.toMatch(/html|script|iframe|raw/u)
    }
    await lease.release()

    // raw export is byte-identical: the codec never sanitises, rewrites or resolves the markup —
    // it hands back exactly what was on disk and leaves rendering to a viewer that must sanitise
    const exported = await session.operations().invoke('export-raw', null)
    expect(exported.state).toBe('ok')
    if (exported.state === 'ok' && exported.output.kind === 'bytes') {
      expect(new TextDecoder().decode(exported.output.value)).toBe(hostile)
    }
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
    await session.dispose()
  })
})
