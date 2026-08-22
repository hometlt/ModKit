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
const documentRoot = join(repoRoot, 'extensions', 'mk2', 'uncommon-documents')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const formats = [
  'csv',
  'markdown',
  'rtf',
  'txt',
  'docx',
  'pptx',
  'xlsx',
  'odt',
  'odp',
  'ods',
] as const
type Format = (typeof formats)[number]
const officeFormats = ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'] as const

const fileNames: Record<Format, string> = {
  csv: 'minimal.csv',
  markdown: 'minimal.md',
  rtf: 'minimal.rtf',
  txt: 'minimal.txt',
  docx: 'minimal.docx',
  pptx: 'minimal.pptx',
  xlsx: 'minimal.xlsx',
  odt: 'minimal.odt',
  odp: 'minimal.odp',
  ods: 'minimal.ods',
}

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
      throw new Error('MK2 document codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('MK2 document codecs have no foreign service dependency')
    },
  },
}

function byteSource(format: Format, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-document-codecs/${fileNames[format]}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-document-${format}`),
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
      compositionFingerprint: `mk2-document-${source.ref.id}`,
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

async function codecFor(format: Format): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(documentRoot, 'src', format, 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function fixture(format: Format): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, fileNames[format])))
}

async function open(format: Format, bytes: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor(format)
  const source = byteSource(format, bytes)
  return codec.open(inputFor(source), 'inspect', resourceBudget)
}

describe('ported MK2 text document codecs', () => {
  it.each(formats)('%s publishes bounded document metadata and a tree', async format => {
    const session = await open(format, await fixture(format))
    const descriptor = await session.descriptor()
    expect(descriptor.constraints.maxDecodedBytes).not.toBe('0')
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: format === 'xlsx' || format === 'ods' ? 'table.cells' : 'content.text',
        }),
      ]),
    )
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const root = await tree.root()
    expect((await tree.children(root, { limit: 100 })).items.length).toBeGreaterThan(0)
    await lease.release()
    await session.dispose()
  })

  it('parses RFC-style CSV rows, columns, quotes, and embedded newlines', async () => {
    const session = await open('csv', await fixture('csv'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: { format: 'csv', rows: 3, columns: 3, cells: 9, raggedRows: 0 },
      },
    })
    await session.dispose()
  })

  it('builds a Markdown outline and inventories links, lists, and code blocks', async () => {
    const session = await open('markdown', await fixture('markdown'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: { format: 'markdown', headings: 2, links: 1, listItems: 2, codeBlocks: 1 },
      },
    })
    await session.dispose()
  })

  it('validates RTF groups and inventories structural control words', async () => {
    const session = await open('rtf', await fixture('rtf'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: { format: 'rtf', groups: 3, paragraphs: 2, sections: 1, outlineLevels: 1 },
      },
    })
    await session.dispose()
  })

  it('counts plain-text characters, lines, words, and paragraphs', async () => {
    const session = await open('txt', await fixture('txt'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: { format: 'txt', characters: 53, lines: 5, words: 6, paragraphs: 2 },
      },
    })
    await session.dispose()
  })

  it.each([
    ['docx', { package: 'ooxml', entries: 3, paragraphs: 1, tables: 1, textRuns: 1 }],
    ['pptx', { package: 'ooxml', entries: 4, slides: 1, shapes: 1, textRuns: 1 }],
    [
      'xlsx',
      { package: 'ooxml', entries: 4, sheets: 1, worksheets: 1, rows: 1, cells: 2, formulas: 1 },
    ],
    ['odt', { package: 'odf', entries: 3, paragraphs: 1, headings: 1 }],
    ['odp', { package: 'odf', entries: 3, slides: 1, frames: 1, paragraphs: 1 }],
    ['ods', { package: 'odf', entries: 3, sheets: 1, rows: 1, cells: 2, formulas: 1 }],
  ] as const)(
    '%s validates its package and derives document structure',
    async (format, summary) => {
      const session = await open(format, await fixture(format))
      await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
        state: 'ok',
        output: { kind: 'json', value: { format, ...summary } },
      })
      await session.dispose()
    },
  )

  it.each(formats)('%s rejects structural corruption', async format => {
    const corrupted = officeFormats.includes(format as (typeof officeFormats)[number])
      ? (await fixture(format)).slice(0, -1)
      : format === 'csv'
        ? new TextEncoder().encode('one,"unterminated')
        : format === 'markdown'
          ? new Uint8Array([0x23, 0x20, 0xff])
          : format === 'rtf'
            ? (await fixture(format)).slice(0, -1)
            : new Uint8Array([0xff, 0xfe])
    await expect(open(format, corrupted)).rejects.toThrow(/CSV|UTF-8|RTF|office ZIP/u)
  })

  it.each(formats)('%s enforces node, depth, and scalar budgets', async format => {
    const bytes = await fixture(format)
    await expect(open(format, bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    await expect(open(format, bytes, { ...budget, maxDepth: 0 })).rejects.toThrow(/maxDepth/u)
    await expect(open(format, bytes, { ...budget, maxScalarBytes: 5 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
