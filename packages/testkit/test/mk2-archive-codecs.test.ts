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
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const archiveRoot = join(repoRoot, 'extensions', 'common', 'archives')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

const cases = Object.freeze([
  { format: 'brotli', fixture: 'minimal.br', entryId: 'payload', extracted: 'payload' },
  { format: 'bzip2', fixture: 'minimal.bz2', entryId: 'payload', extracted: 'payload' },
  { format: 'lzma', fixture: 'minimal.lzma', entryId: 'payload', extracted: 'payload' },
  { format: 'dmg', fixture: 'minimal.dmg', entryId: 'data-fork', extracted: 'disk' },
  { format: '7z', fixture: 'minimal.7z', entryId: 'file-0', extracted: 'payload' },
] as const)

type Case = (typeof cases)[number]

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('MK2 archive subset codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('MK2 archive subset codecs have no foreign service dependency')
    },
  },
}

function byteSource(format: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-archive-codecs/sample.${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-archive-${format}`),
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
      compositionFingerprint: `mk2-archive-${source.ref.id}`,
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

async function codecFor(testCase: Case): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(archiveRoot, 'src', testCase.format, 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function fixture(testCase: Case): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, testCase.fixture)))
}

async function open(testCase: Case, bytes: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor(testCase)
  const source = byteSource(testCase.format, bytes)
  return codec.open(inputFor(source), 'inspect', resourceBudget)
}

describe('ported MK2 archive subset codecs', () => {
  it.each(cases)('$format lists and extracts its validated source', async testCase => {
    const bytes = await fixture(testCase)
    const session = await open(testCase, bytes)
    const descriptor = await session.descriptor()
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'container.entries' })]),
    )
    const namespace = await session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (namespace.value as NamespaceEntrySource).list('', { limit: 10 })
    expect(page.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: testCase.entryId, kind: 'file' })]),
    )
    const result = await session.operations().invoke('extract-entry', {
      entryId: testCase.entryId,
    })
    if (result.state !== 'ok' || result.output.kind !== 'bytes') {
      throw new Error(`${testCase.format} extraction did not return bytes`)
    }
    let expected: Uint8Array
    if (testCase.extracted === 'disk') {
      expected = new Uint8Array(512)
      expected.set(new TextEncoder().encode('hello\n'))
    } else expected = new TextEncoder().encode('hello\n')
    expect(result.output.value).toEqual(expected)
    await namespace.release()
    await session.dispose()
  })

  it.each(cases)('$format rejects a structurally corrupted source', async testCase => {
    const bytes = await fixture(testCase)
    const corrupted = bytes.slice()
    if (testCase.format === 'brotli') corrupted[corrupted.byteLength - 1] = 0x02
    else if (testCase.format === 'bzip2') corrupted[10] = (corrupted[10] ?? 0) ^ 0xff
    else if (testCase.format === 'lzma') corrupted[0] = 0xff
    else if (testCase.format === 'dmg') corrupted[corrupted.byteLength - 512] = 0
    else if (testCase.format === '7z') corrupted[32] = (corrupted[32] ?? 0) ^ 0xff
    else corrupted[8] = (corrupted[8] ?? 0) ^ 0xff
    await expect(open(testCase, corrupted)).rejects.toThrow(/Brotli|BZip2|LZMA|DMG|7z|XA/u)
  })

  it.each(cases)('$format enforces node and scalar budgets', async testCase => {
    const bytes = await fixture(testCase)
    await expect(open(testCase, bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    await expect(open(testCase, bytes, { ...budget, maxScalarBytes: 5 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
