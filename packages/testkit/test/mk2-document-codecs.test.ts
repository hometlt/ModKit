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
  type RasterImageSource,
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
  'docx',
  'pptx',
  'xlsx',
  'pdf',
  'ai',
  'drawio',
  'visio',
  'cdr',
  'figma',
  'psd',
  'blend',
] as const
type Format = (typeof formats)[number]
const officeFormats = ['docx', 'pptx', 'xlsx'] as const

const fileNames: Record<Format, string> = {
  csv: 'minimal.csv',
  markdown: 'minimal.md',
  rtf: 'minimal.rtf',
  docx: 'minimal.docx',
  pptx: 'minimal.pptx',
  xlsx: 'minimal.xlsx',
  pdf: 'minimal.pdf',
  ai: 'minimal.ai',
  drawio: 'minimal.drawio',
  visio: 'minimal.vsdx',
  cdr: 'minimal.cdr',
  figma: 'minimal.fig',
  psd: 'minimal.psd',
  blend: 'minimal.blend',
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

describe('ported MK2 document codecs', () => {
  it.each(formats)('%s publishes bounded document metadata and a tree', async format => {
    const session = await open(format, await fixture(format))
    const descriptor = await session.descriptor()
    expect(descriptor.constraints.maxDecodedBytes).not.toBe('0')
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id:
            format === 'xlsx'
              ? 'table.cells'
              : format === 'pdf' || format === 'ai'
                ? 'document.pages'
                : format === 'drawio'
                  ? 'structure.nodes'
                  : format === 'visio' || format === 'cdr'
                    ? 'structure.nodes'
                    : format === 'figma'
                      ? 'structure.hierarchy'
                      : format === 'psd'
                        ? 'image.raster'
                        : format === 'blend'
                          ? 'model.geometry'
                          : 'content.text',
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

  it('validates draw.io cells, references, geometry, and compressed diagrams', async () => {
    const fixtureSession = await open('drawio', await fixture('drawio'))
    await expect(fixtureSession.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'drawio',
          diagrams: 1,
          cells: 5,
          nodes: 2,
          edges: 1,
          layers: 1,
          geometries: 3,
          compressedDiagrams: 0,
        },
      },
    })
    await fixtureSession.dispose()

    const { deflateRawSync } = await import('node:zlib')
    const model =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'
    const compressed = deflateRawSync(new TextEncoder().encode(encodeURIComponent(model))).toString(
      'base64',
    )
    const packed = new TextEncoder().encode(
      `<mxfile><diagram name="Packed">${compressed}</diagram></mxfile>`,
    )
    const packedSession = await open('drawio', packed)
    await expect(packedSession.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: { diagrams: 1, cells: 2, compressedDiagrams: 1 },
      },
    })
    await packedSession.dispose()
  })

  it('validates VSDX OPC pages and legacy VSD compound-file allocation', async () => {
    const vsdx = await open('visio', await fixture('visio'))
    await expect(vsdx.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'visio',
          variant: 'vsdx-opc',
          entries: 5,
          pages: 1,
          shapes: 2,
          textElements: 1,
          connects: 1,
        },
      },
    })
    await vsdx.dispose()

    const vsdBytes = new Uint8Array(await readFile(join(fixtureRoot, 'minimal.vsd')))
    const vsd = await open('visio', vsdBytes)
    await expect(vsd.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'visio',
          variant: 'vsd-cfb',
          sectorSize: 512,
          sectors: 2,
          directoryEntries: 2,
          streams: 1,
        },
      },
    })
    await vsd.dispose()
  })

  it('walks bounded CorelDRAW RIFF page and object lists', async () => {
    const session = await open('cdr', await fixture('cdr'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'cdr',
          container: 'riff',
          form: 'CDR6',
          version: 6,
          records: 4,
          pages: 1,
          objects: 1,
          groups: 0,
          compressedLists: 0,
        },
      },
    })
    await session.dispose()
  })

  it('validates ZIP and direct fig-kiwi chunk framing plus the embedded BinarySchema', async () => {
    const packaged = await open('figma', await fixture('figma'))
    await expect(packaged.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'figma',
          container: 'zip',
          entries: 2,
          version: 101,
          definitions: 1,
          fields: 1,
          zstdBlocks: 1,
          compressedBlocks: 0,
        },
      },
    })
    await packaged.dispose()

    const directBytes = new Uint8Array(await readFile(join(fixtureRoot, 'minimal-kiwi.fig')))
    const direct = await open('figma', directBytes)
    await expect(direct.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: { kind: 'json', value: { container: 'fig-kiwi', entries: 0 } },
    })
    await direct.dispose()
  })

  it('validates all PSD sections, resources, layers, channel blocks, and composite pixels', async () => {
    const session = await open('psd', await fixture('psd'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'psd',
          variant: 'PSD',
          version: 1,
          width: 1,
          height: 1,
          channels: 3,
          bitDepth: 8,
          colorMode: 'rgb',
          resources: 1,
          layers: 1,
          channelBlocks: 3,
          compression: 'raw',
        },
      },
    })
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    await expect(raster.info()).resolves.toMatchObject({
      width: 1,
      height: 1,
      channels: 3,
      bitDepth: 8,
      colorSpace: 'rgb',
    })
    await lease.release()
    await session.dispose()
  })

  it('validates Blender BHeads and SDNA, then decodes legacy indexed geometry', async () => {
    const session = await open('blend', await fixture('blend'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'blend',
          version: 400,
          pointerSize: 8,
          endianness: 'little',
          blocks: 4,
          dataBlocks: 2,
          names: 5,
          types: 4,
          structs: 2,
          vertices: 3,
          faces: 1,
          triangles: 1,
          geometryAccess: 'decoded',
          bounds: { min: [0, 0, 0], max: [1, 1, 0] },
        },
      },
    })
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    await expect(model.info()).resolves.toMatchObject({
      meshes: 1,
      primitives: 1,
      geometryAccess: 'decoded',
    })
    const primitive = await model.primitive?.('primitive-0', { maxBytes: 1024 })
    expect(primitive?.positions).toHaveLength(9)
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2]))
    await lease.release()
    await session.dispose()
  })

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
    await expect(open(format, corrupted)).rejects.toThrow(
      /CSV|UTF-8|RTF|office ZIP|PDF|draw\.io|Visio|CorelDRAW|Figma|PSD|Blender|bounds/u,
    )
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
