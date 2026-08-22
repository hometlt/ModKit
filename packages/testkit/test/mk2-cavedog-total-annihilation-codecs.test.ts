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
  type TreeDataSource,
} from '@modkitx-x3/sdk'

type CodecId = 'gaf' | 'ta-hpi'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'cavedog-total-annihilation')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
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
      throw new Error('Cavedog codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Cavedog codecs have no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://cavedog-total-annihilation/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:cavedog-${name}`),
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

async function codec(id: CodecId): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extension, 'src', id, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(id: CodecId, bytes: Uint8Array, resourceBudget = budget) {
  return (await codec(id)).open(input(source(bytes, id)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, name)))
}

async function extract(session: Awaited<ReturnType<typeof open>>, entryId: string) {
  const result = await session.operations().invoke('extract-entry', { entryId })
  if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error('extract failed')
  return new TextDecoder().decode(result.output.value)
}

describe('ported Cavedog Total Annihilation codecs', () => {
  it('reports the bounded GAF header without claiming frame or pixel decoding', async () => {
    const session = await open('gaf', await fixture('minimal.gaf'))
    expect(await inspect(session)).toMatchObject({
      format: 'gaf',
      version: '0x00010100',
      entries: 1,
      entryOffsets: [16],
      frameDecoding: 'not-implemented',
    })
    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const children = await tree.children(await tree.root(), { limit: 10 })
    expect(children.items).toHaveLength(1)
    const entry = children.items[0]
    if (entry === undefined) throw new TypeError('GAF fixture entry was not exposed')
    expect(await tree.facts(entry)).toMatchObject({
      label: 'Entry 0',
      preview: 'header at byte 16',
    })
    await treeLease.release()
    await session.dispose()
  })

  it('walks a classic HAPI directory and extracts stored, LZ77, and zlib entries', async () => {
    const session = await open('ta-hpi', await fixture('minimal.ta-hpi'))
    expect(await inspect(session)).toMatchObject({
      format: 'ta-hpi',
      layout: 'classic',
      version: 0x00010000,
      entries: 3,
      compressed: 2,
      compressionMethods: ['stored', 'lz77', 'zlib'],
    })
    const namespaceLease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = namespaceLease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 10 })
    expect(page.items.map(item => [item.id, item.path, item.compression])).toEqual([
      ['0', 'stored.txt', 'stored'],
      ['1', 'lz77.txt', 'lz77'],
      ['2', 'zlib.txt', 'zlib'],
    ])
    expect(await extract(session, '0')).toBe('stored')
    expect(await extract(session, '1')).toBe('LZ77!')
    expect(await extract(session, '2')).toBe('zlib payload')
    await namespaceLease.release()
    await session.dispose()
  })

  it('retains the MK2 compact stored-entry regression layout', async () => {
    const name = new TextEncoder().encode('compact.txt')
    const payload = new TextEncoder().encode('compact')
    const bytes = new Uint8Array(12 + 24 + name.byteLength + payload.byteLength)
    bytes.set(new TextEncoder().encode('HAPI'))
    const view = new DataView(bytes.buffer)
    view.setUint32(4, 1, true)
    view.setUint32(8, 1, true)
    view.setUint32(12, 36, true)
    view.setUint16(16, name.byteLength, true)
    view.setUint16(18, 0, true)
    view.setUint32(20, 36 + name.byteLength, true)
    view.setUint32(24, payload.byteLength, true)
    view.setUint32(28, payload.byteLength, true)
    bytes.set(name, 36)
    bytes.set(payload, 36 + name.byteLength)
    const session = await open('ta-hpi', bytes)
    expect(await inspect(session)).toMatchObject({ layout: 'compact', entries: 1 })
    expect(await extract(session, '0')).toBe('compact')
    await session.dispose()
  })

  it('rejects corrupt structure, traversal, checksums, and resource-budget overflow', async () => {
    const gaf = await fixture('minimal.gaf')
    await expect(open('gaf', gaf, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)

    const hpi = await fixture('minimal.ta-hpi')
    await expect(open('ta-hpi', hpi, { ...budget, maxNodes: 2 })).rejects.toThrow(/maxNodes/u)
    const traversal = hpi.slice()
    traversal.set(new TextEncoder().encode('../evil.tx'), 55)
    await expect(open('ta-hpi', traversal)).rejects.toThrow(/unsafe path/u)

    const corrupt = hpi.slice()
    const corruptOffset = corrupt.byteLength - 5
    corrupt[corruptOffset] = (corrupt[corruptOffset] ?? 0) ^ 0xff
    const corruptSession = await open('ta-hpi', corrupt)
    await expect(extract(corruptSession, '2')).rejects.toThrow(/checksum/u)
    await corruptSession.dispose()
  })
})
