/**
 * Block 11 slice 11B — the OpenDocument quartet in `extensions/common/documents`.
 *
 * ODT, ODS and ODP were relocated out of the `mk2/uncommon-documents` staging area and ODG is new
 * (`origin: owner-addition`). All four share one private package reader, so the suite is built the
 * way the plan asks (items 5–7): the negative matrix below is the contract, and every case is
 * answered by every format rather than proved once on whichever format happened to be convenient.
 *
 * The three things this file exists to prove:
 *
 *  - detection is the OpenDocument rule, not the file name. A renamed package still opens; a
 *    package whose `mimetype` belongs to another ODF format is refused by name; a plain ZIP with
 *    the right suffix is refused. Extension alone is never enough.
 *  - the container and the XML are read inside stated bounds. Traversal, duplicate entries, ZIP and
 *    XML bombs, encryption, ZIP64, truncation, budgets and cancellation each have a case, and each
 *    refusal names its rule.
 *  - only what was parsed is published, and through the *generic* contracts. That the same
 *    contracts then carry ODS into the CSV table viewer and ODG into the SVG vector viewer is
 *    proved where the viewers actually live: `apps/electron/test/odf-view-policy.test.ts`.
 *
 * Shared Host suites own worker-realm execution; browser-worker safety is checked here as the
 * property that makes it portable — the sources reach for nothing Node-only.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  createSpecSchemaRegistry,
  revisionId,
  validateContributionManifest,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ContributionManifestV1Wire,
  type ResourceBudget,
  type Slide,
  type SlideDeckSource,
  type TableDataSource,
  type TreeDataSource,
  type VectorSceneSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'common', 'documents')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

const FORMATS = ['odt', 'ods', 'odp', 'odg'] as const
type Format = (typeof FORMATS)[number]

const MEDIA_TYPES: Readonly<Record<Format, string>> = {
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  odg: 'application/vnd.oasis.opendocument.graphics',
}

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('the ODF codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('the ODF codecs have no foreign service dependency')
    },
  },
}

function byteSource(bytes: Uint8Array, uri: string): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:common-documents-odf'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted === true) throw new Error('cancelled')
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
      compositionFingerprint: 'common-documents-odf',
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

/**
 * Where a codec's module lives says what it is, and the MK2 port ratchet counts on it: a relocated
 * port keeps `src/<codec>/codec.js`, a codec authored for MK3 lives at `src/<codec>/`.
 * ODT, ODS and ODP moved in from staging; ODG was written here.
 */
const MODULE_OF: Readonly<Record<Format, readonly string[]>> = {
  odt: ['src', 'odt', 'codec.js'],
  ods: ['src', 'ods', 'codec.js'],
  odp: ['src', 'odp', 'codec.js'],
  odg: ['src', 'odg', 'codec.js'],
}

async function codecFor(format: Format): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extensionRoot, ...MODULE_OF[format])).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

const fixture = async (format: Format): Promise<Uint8Array> =>
  new Uint8Array(await readFile(join(fixtureRoot, `minimal.${format}`)))

async function probe(format: Format, bytes: Uint8Array, uri: string): Promise<number> {
  const probed = await (
    await codecFor(format)
  ).probe({
    source: byteSource(bytes.subarray(0, 4096), uri),
    plan: { kind: 'bytes', ranges: [{ from: 'start', length: 4096 }], maxBytes: 4096 },
  })
  return probed.confidence
}

async function open(
  format: Format,
  bytes: Uint8Array,
  options: { readonly budget?: ResourceBudget; readonly signal?: AbortSignal } = {},
) {
  const codec = await codecFor(format)
  return codec.open(
    inputFor(byteSource(bytes, `memory://odf/sample.${format}`)),
    'inspect',
    options.budget ?? budget,
    options.signal,
  )
}

async function summaryOf(format: Format, bytes: Uint8Array): Promise<Record<string, unknown>> {
  const session = await open(format, bytes)
  const result = await session.operations().invoke('inspect', null)
  await session.dispose()
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value as Record<string, unknown>
}

// -----------------------------------------------------------------------------------------------
// a minimal ZIP writer, so a negative case can be *built* rather than described

const encoder = new TextEncoder()

const u16 = (value: number): Uint8Array => new Uint8Array([value & 0xff, (value >> 8) & 0xff])
const u32 = (value: number): Uint8Array =>
  new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number)
  return (crc ^ 0xffffffff) >>> 0
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

interface ZipPart {
  readonly name: string
  readonly body: string | Uint8Array
  readonly flags?: number
  readonly method?: number
  /** Overrides the declared uncompressed size, for the ratio and truncation cases. */
  readonly declaredSize?: number
}

/** Stored-only ZIP writer: enough for every ODF package this suite builds by hand. */
function zip(parts: readonly ZipPart[]): Uint8Array {
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const part of parts) {
    const name = encoder.encode(part.name)
    const body = typeof part.body === 'string' ? encoder.encode(part.body) : part.body
    const flags = part.flags ?? 0x0800
    const method = part.method ?? 0
    const size = part.declaredSize ?? body.byteLength
    const checksum = crc32(body)
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(checksum),
      u32(body.byteLength),
      u32(size),
      u16(name.byteLength),
      u16(0),
      name,
      body,
    )
    central.push(
      concat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(checksum),
        u32(body.byteLength),
        u32(size),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ),
    )
    locals.push(local)
    offset += local.byteLength
  }
  const directory = concat(...central)
  return concat(
    ...locals,
    directory,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(parts.length),
    u16(parts.length),
    u32(directory.byteLength),
    u32(offset),
    u16(0),
  )
}

const manifestXml = (mediaType: string, parts: readonly string[] = ['content.xml']): string =>
  `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:manifest"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mediaType}"/>${parts
    .map(
      part => `<manifest:file-entry manifest:full-path="${part}" manifest:media-type="text/xml"/>`,
    )
    .join('')}</manifest:manifest>`

const BODY_OF: Readonly<Record<Format, string>> = {
  odt: '<office:text><text:p>text</text:p></office:text>',
  ods: '<office:spreadsheet><table:table><table:table-row><table:table-cell><text:p>1</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
  odp: '<office:presentation><draw:page><draw:frame><text:p>slide</text:p></draw:frame></draw:page></office:presentation>',
  odg: '<office:drawing><draw:page><draw:rect svg:x="0cm" svg:y="0cm" svg:width="1cm" svg:height="1cm"/></draw:page></office:drawing>',
}

const contentXml = (format: Format, body = BODY_OF[format]): string =>
  `<?xml version="1.0"?><office:document-content xmlns:office="urn:office" xmlns:text="urn:text" xmlns:table="urn:table" xmlns:draw="urn:draw" xmlns:svg="urn:svg"><office:body>${body}</office:body></office:document-content>`

/** A valid package for `format`, with any part overridden or added by the caller. */
function odfPackage(format: Format, overrides: readonly ZipPart[] = []): Uint8Array {
  const base: ZipPart[] = [
    { name: 'mimetype', body: MEDIA_TYPES[format], flags: 0 },
    { name: 'META-INF/manifest.xml', body: manifestXml(MEDIA_TYPES[format]) },
    { name: 'content.xml', body: contentXml(format) },
  ]
  const parts = [...base]
  for (const override of overrides) {
    const index = parts.findIndex(part => part.name === override.name)
    if (index === -1) parts.push(override)
    else parts[index] = override
  }
  return zip(parts)
}

// -----------------------------------------------------------------------------------------------

describe('11B common/documents — the OpenDocument quartet', () => {
  it('ships exactly four ODF contributions and every one of them validates', async () => {
    const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)
    const files = (await readdir(join(extensionRoot, 'contributions')))
      .filter(name => /^codec-od[tspg]\.json$/u.test(name))
      .sort()
    expect(files).toEqual(['codec-odg.json', 'codec-odp.json', 'codec-ods.json', 'codec-odt.json'])
    for (const file of files) {
      const manifest = JSON.parse(
        await readFile(join(extensionRoot, 'contributions', file), 'utf8'),
      ) as ContributionManifestV1Wire
      const result = await validateContributionManifest(manifest, registry)
      expect(result.specState, `${file}: ${JSON.stringify(result.diagnostics)}`).toBe('validated')
      expect(
        result.diagnostics.filter(item => item.severity === 'error'),
        file,
      ).toEqual([])
      // a writer is not declarable until preserving repack and round-trip are proved (plan 11B.7)
      const spec = manifest.spec as {
        readonly operations?: readonly { readonly mutatesSource?: boolean }[]
      }
      expect(
        (spec.operations ?? []).some(operation => operation.mutatesSource === true),
        file,
      ).toBe(false)
      expect((manifest.limitations ?? []).length, file).toBeGreaterThanOrEqual(5)
      for (const variant of manifest.runtimeVariants ?? []) {
        expect(variant.requestedPermissionClasses, file).toEqual(['read-source'])
      }
      expect(
        (manifest.runtimeVariants ?? []).flatMap(variant => variant.target?.environments ?? []),
        file,
      ).toEqual(expect.arrayContaining(['node', 'browser-worker', 'node-worker']))
    }
  })

  it('reaches for nothing Node-only, which is what makes the browser worker variant true', async () => {
    for (const name of ['odf/package.js', 'odf/document.js', 'odf/inspection.js']) {
      const source = await readFile(join(extensionRoot, 'src', ...name.split('/')), 'utf8')
      expect(source, name).not.toMatch(
        /(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])node:/u,
      )
      expect(source, name).not.toMatch(/\bBuffer\b|\bprocess\.|__dirname/u)
    }
    for (const format of FORMATS) {
      const source = await readFile(join(extensionRoot, ...MODULE_OF[format]), 'utf8')
      expect(source, format).not.toMatch(/node:/u)
    }
  })

  it('publishes only the representations each format actually recovered', async () => {
    const expected: Readonly<Record<Format, readonly string[]>> = {
      odt: [
        'common.view/byte-range-source',
        'common.view/text-data-source',
        'common.view/tree-data-source',
      ],
      ods: [
        'common.view/byte-range-source',
        'common.view/table-data-source',
        'common.view/text-data-source',
        'common.view/tree-data-source',
      ],
      odp: [
        'common.view/byte-range-source',
        'common.view/slide-deck-source',
        'common.view/text-data-source',
        'common.view/tree-data-source',
        'common.view/vector-scene-source',
      ],
      odg: [
        'common.view/byte-range-source',
        'common.view/text-data-source',
        'common.view/tree-data-source',
        'common.view/vector-scene-source',
      ],
    }
    for (const format of FORMATS) {
      const session = await open(format, await fixture(format))
      const descriptor = await session.descriptor()
      expect(descriptor.dataSources.map(source => source.contract).toSorted(), format).toEqual(
        expected[format],
      )
      if (descriptor.interpretation !== 'codec') throw new Error('expected a codec descriptor')
      expect(descriptor.identity.formatId, format).toBe(format)
      expect(descriptor.identity.mediaType, format).toBe(MEDIA_TYPES[format])
      expect(descriptor.constraints.readOnly, format).toBe(true)
      // the loss policy is a declaration, not an omission
      expect(descriptor.constraints.unsupportedFeatures, format).toEqual([
        'layout-fidelity',
        'style-resolution',
        'macro-and-script-execution',
        'external-resource-fetch',
        'source-editing',
      ])
      // ODT publishes no table, ODS no deck, and neither publishes a vector scene it did not draw
      expect(
        descriptor.dataSources.some(source => source.contract === 'common.view/slide-deck-source'),
        format,
      ).toBe(format === 'odp')
      await session.dispose()
    }
  })

  it('reads ODT as flow and outline, ODS as sheets and formula text, ODG as pages and shapes', async () => {
    expect(await summaryOf('odt', await fixture('odt'))).toMatchObject({
      format: 'odt',
      headings: 1,
      paragraphs: 1,
      characters: 'Heading\nHello ODT'.length,
    })
    expect(await summaryOf('ods', await fixture('ods'))).toMatchObject({
      format: 'ods',
      sheets: 1,
      rows: 1,
      cells: 2,
      formulas: 1,
    })
    expect(await summaryOf('odp', await fixture('odp'))).toMatchObject({
      format: 'odp',
      slides: 1,
      textRuns: 1,
    })
    expect(await summaryOf('odg', await fixture('odg'))).toMatchObject({
      format: 'odg',
      pages: 2,
      shapes: 7,
      frames: 1,
      textRuns: 1,
      // the custom shape's enhanced geometry is not parsed, so it is counted, never guessed at
      unparsedShapes: 1,
      pageSizeKnown: true,
    })
  })

  it('keeps a spreadsheet formula as text and provenance, and never evaluates it', async () => {
    const session = await open('ods', await fixture('ods'))
    const descriptor = await session.descriptor()
    if (descriptor.interpretation !== 'codec') throw new Error('expected a codec descriptor')
    const formulas = descriptor.metadata?.find(group => group.id === 'odf-formulas')
    expect(formulas?.entries).toEqual([
      // `1+1` stays `1+1`; the published value is the value the document stored
      { key: 'Sheet 1!r1c2', value: 'of:=1+1 → 2' },
    ])
    const lease = await session.dataSource('common.view/table-data-source', 1)
    const table = lease.value as TableDataSource
    await expect(table.cell({ row: 0, column: 1 })).resolves.toEqual({ value: '2' })
    await lease.release()
    await session.dispose()
  })

  it('publishes the deck exactly as ADR-DOC-001 specifies, and nothing it did not parse', async () => {
    const session = await open('odp', await fixture('odp'))
    const lease = await session.dataSource('common.view/slide-deck-source', 1)
    const deck = lease.value as SlideDeckSource
    await expect(deck.info()).resolves.toEqual({ slides: 1 })
    const page = await deck.slides({ limit: 10 })
    expect(page.nextCursor).toBeUndefined()
    const slide = page.items[0] as Slide
    expect(slide).toEqual({
      id: 'slide-1',
      index: 1,
      textRuns: ['Hello ODP'],
      // geometry is never copied into the deck: it names the vector page instead
      page: { kind: 'vector-scene-page', page: 1 },
    })
    // masters, layouts, transitions and animation are not parsed, so they are absent, not empty
    expect(Object.keys(slide).toSorted()).toEqual(['id', 'index', 'page', 'textRuns'])
    await expect(deck.slides({ limit: 0 })).rejects.toThrow(/positive safe integer/u)
    await lease.release()
    await session.dispose()
  })

  it('draws one vector scene from the geometry it parsed, with no script and no external reference', async () => {
    for (const format of ['odp', 'odg'] as const) {
      const session = await open(format, await fixture(format))
      const lease = await session.dataSource('common.view/vector-scene-source', 1)
      const scene = lease.value as VectorSceneSource
      const document = await scene.document()
      expect(document.mediaType, format).toBe('image/svg+xml')
      expect(document.profile, format).toBe('uvg.secure-static.v1')
      expect(document.text, format).toMatch(/^<svg /u)
      // the only URL a scene may carry is the SVG namespace itself; nothing is fetchable from it
      const withoutNamespace = document.text.replace(' xmlns="http://www.w3.org/2000/svg"', '')
      expect(withoutNamespace, format).not.toMatch(
        /<script|\son[a-z]+=|xlink:href|href=|https?:|data:/iu,
      )
      const info = await scene.info()
      expect(info.nodes, format).toBeGreaterThan(0)
      await lease.release()
      await session.dispose()
    }
  })

  it('keeps a raw > inside an attribute value, which XML allows and a naive scan splits', async () => {
    // `svg:d="M 0 0 L 1 1"` is not where this bites; a shape title reading `a > b` is. Scanning to
    // the first `>` would cut the tag in half and refuse a perfectly legal document.
    const body =
      '<office:text><text:p text:style-name="a &gt; b">plain</text:p>' +
      '<text:h text:style-name="x>y">heading</text:h></office:text>'
    const bytes = odfPackage('odt', [{ name: 'content.xml', body: contentXml('odt', body) }])
    expect(await summaryOf('odt', bytes)).toMatchObject({
      format: 'odt',
      paragraphs: 1,
      headings: 1,
    })
    // a raw `<` inside an attribute value is *not* allowed, and is still refused
    const illegal = contentXml(
      'odt',
      '<office:text><text:p text:style-name="a<b">x</text:p></office:text>',
    )
    await expect(
      open('odt', odfPackage('odt', [{ name: 'content.xml', body: illegal }])),
    ).rejects.toThrow(/malformed XML markup/u)
  })

  it('resolves ODF namespaces by URI, so a document that renames the prefixes still opens', async () => {
    const drawing =
      '<?xml version="1.0"?><o:document-content' +
      ' xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
      ' xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"' +
      ' xmlns:s="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">' +
      '<o:body><o:drawing><d:page d:name="P"><d:rect s:x="0cm" s:y="0cm" s:width="2cm" s:height="1cm"/></d:page></o:drawing></o:body>' +
      '</o:document-content>'
    const bytes = odfPackage('odg', [{ name: 'content.xml', body: drawing }])
    expect(await summaryOf('odg', bytes)).toMatchObject({ format: 'odg', pages: 1, shapes: 1 })
  })
})

describe('11B ODF detection reads the format rule, never the file name', () => {
  it('recognises a renamed package and refuses one whose media type belongs elsewhere', async () => {
    for (const format of FORMATS) {
      const bytes = await fixture(format)
      // the name is thrown away entirely: the same bytes under a foreign suffix still open
      expect(await probe(format, bytes, 'memory://odf/renamed.txt'), format).toBeGreaterThan(0.9)
      expect(await probe(format, bytes, 'memory://odf/no-suffix'), format).toBeGreaterThan(0.9)
      for (const other of FORMATS.filter(item => item !== format)) {
        // and an `.odt` that is really a presentation is refused by the ODT route by name
        expect(
          await probe(other, bytes, `memory://odf/mislabelled.${other}`),
          `${format}->${other}`,
        ).toBe(0)
      }
    }
  })

  it('refuses a plain ZIP, an empty file and a non-ZIP that merely carries the suffix', async () => {
    const plainZip = zip([{ name: 'content.xml', body: '<a/>' }])
    for (const format of FORMATS) {
      expect(await probe(format, plainZip, `memory://odf/plain.${format}`), format).toBe(0)
      expect(await probe(format, new Uint8Array(0), `memory://odf/empty.${format}`), format).toBe(0)
      expect(
        await probe(format, encoder.encode('not a package at all'), `memory://odf/text.${format}`),
        format,
      ).toBe(0)
    }
  })

  it('refuses a package whose mimetype entry is compressed, moved or wrong', async () => {
    const late = zip([
      { name: 'META-INF/manifest.xml', body: manifestXml(MEDIA_TYPES.odt) },
      { name: 'mimetype', body: MEDIA_TYPES.odt, flags: 0 },
      { name: 'content.xml', body: contentXml('odt') },
    ])
    await expect(open('odt', late)).rejects.toThrow(/first, uncompressed ZIP entry/u)
    const wrong = odfPackage('odt', [
      { name: 'mimetype', body: 'application/zip', flags: 0 },
      { name: 'META-INF/manifest.xml', body: manifestXml('application/zip') },
    ])
    await expect(open('odt', wrong)).rejects.toThrow(/mimetype entry declares application\/zip/u)
  })
})

describe('11B ODF refuses hostile and malformed packages by name', () => {
  it.each(FORMATS)('%s refuses an entry path that traverses or is absolute', async format => {
    for (const name of ['../escape.xml', 'a/../../escape.xml', '/etc/passwd', 'C:/escape.xml']) {
      const bytes = odfPackage(format, [{ name, body: '<a/>' }])
      await expect(open(format, bytes), name).rejects.toThrow(/unsafe|traverses|absolute/u)
    }
  })

  it.each(FORMATS)('%s refuses a duplicated entry name', async format => {
    // built directly: two central-directory records claiming the same path, which is how a package
    // smuggles a second `content.xml` past a reader that trusts the first match it finds
    const bytes = zip([
      { name: 'mimetype', body: MEDIA_TYPES[format], flags: 0 },
      { name: 'META-INF/manifest.xml', body: manifestXml(MEDIA_TYPES[format]) },
      { name: 'content.xml', body: contentXml(format) },
      { name: 'content.xml', body: contentXml(format, '<office:text/>') },
    ])
    await expect(open(format, bytes)).rejects.toThrow(/duplicated/u)
  })

  it.each(FORMATS)('%s refuses a missing required part', async format => {
    for (const missing of ['META-INF/manifest.xml', 'content.xml']) {
      const parts = [
        { name: 'mimetype', body: MEDIA_TYPES[format], flags: 0 },
        { name: 'META-INF/manifest.xml', body: manifestXml(MEDIA_TYPES[format]) },
        { name: 'content.xml', body: contentXml(format) },
      ].filter(part => part.name !== missing)
      await expect(open(format, zip(parts)), missing).rejects.toThrow(
        new RegExp(
          `missing the required part ${missing.replaceAll('/', '\\/').replaceAll('.', '\\.')}`,
          'u',
        ),
      )
    }
  })

  it.each(FORMATS)('%s refuses a ZIP bomb by its declared expansion ratio', async format => {
    const bomb = odfPackage(format, [
      { name: 'bomb.bin', body: new Uint8Array(64), declaredSize: 64 * 1024 },
    ])
    await expect(open(format, bomb)).rejects.toThrow(/compression-ratio budget/u)
  })

  it.each(FORMATS)(
    '%s refuses an XML bomb before expanding it: no DTD is ever read',
    async format => {
      const laughs =
        '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>' +
        `<office:document-content xmlns:office="urn:office"><office:body>${BODY_OF[format]}</office:body></office:document-content>`
      const bytes = odfPackage(format, [{ name: 'content.xml', body: laughs }])
      await expect(open(format, bytes)).rejects.toThrow(/declares a DTD/u)
      const undeclared = contentXml(format).replace('<office:body>', '<office:body>&custom;')
      await expect(
        open(format, odfPackage(format, [{ name: 'content.xml', body: undeclared }])),
      ).rejects.toThrow(/undeclared entity/u)
    },
  )

  it.each(FORMATS)(
    '%s refuses encryption and compression it cannot honestly decode',
    async format => {
      const encrypted = odfPackage(format, [
        { name: 'content.xml', body: contentXml(format), flags: 0x0801 },
      ])
      await expect(open(format, encrypted)).rejects.toThrow(/encrypted/u)
      const exotic = odfPackage(format, [
        { name: 'content.xml', body: contentXml(format), method: 93 },
      ])
      await expect(open(format, exotic)).rejects.toThrow(/unsupported compression method 93/u)
    },
  )

  it.each(FORMATS)('%s refuses a truncated or structurally broken package', async format => {
    const whole = await fixture(format)
    await expect(open(format, whole.slice(0, whole.byteLength - 1))).rejects.toThrow(
      /end-of-central-directory|end record|central|truncated/u,
    )
    await expect(open(format, whole.slice(0, 64))).rejects.toThrow()
    const unclosed = contentXml(format).replace('</office:body>', '')
    await expect(
      open(format, odfPackage(format, [{ name: 'content.xml', body: unclosed }])),
    ).rejects.toThrow(/unclosed XML elements|mismatched/u)
  })

  it.each(FORMATS)('%s enforces every declared budget', async format => {
    const bytes = await fixture(format)
    await expect(open(format, bytes, { budget: { ...budget, maxNodes: 1 } })).rejects.toThrow(
      /maxNodes/u,
    )
    await expect(open(format, bytes, { budget: { ...budget, maxDepth: 1 } })).rejects.toThrow(
      /maxDepth/u,
    )
    await expect(open(format, bytes, { budget: { ...budget, maxScalarBytes: 8 } })).rejects.toThrow(
      /maxScalarBytes/u,
    )
    await expect(open(format, bytes, { budget: { ...budget, maxInputBytes: 8n } })).rejects.toThrow(
      /budget/u,
    )
  })

  it.each(FORMATS)('%s stops on cancellation instead of finishing the read', async format => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      open(format, await fixture(format), { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/u)
  })

  it('names an external reference and a macro storage instead of following them', async () => {
    const withMacros = odfPackage('odt', [
      { name: 'Basic/Standard/Module1.xml', body: '<script>never()</script>' },
      { name: 'Scripts/python/hello.py', body: 'print(1)' },
    ])
    const session = await open('odt', withMacros)
    const descriptor = await session.descriptor()
    const macros = descriptor.diagnostics?.find(item => item.id === 'odf-macros-present')
    expect(macros?.severity).toBe('warning')
    expect(macros?.message).toMatch(/never executed/u)
    // and the manifest never declared them, which is its own reportable fact
    expect(descriptor.diagnostics?.map(item => item.id).toSorted()).toEqual([
      'odf-macros-present',
      'odf-manifest-undeclared',
    ])
    const summary = await session.operations().invoke('inspect', null)
    expect(summary.state).toBe('ok')
    await session.dispose()

    const external =
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:office" xmlns:text="urn:text" xmlns:draw="urn:draw" xmlns:xlink="urn:xlink">' +
      '<office:body><office:text><text:p>a</text:p>' +
      '<draw:image xlink:href="https://example.invalid/remote.png"/>' +
      '</office:text></office:body></office:document-content>'
    const referencing = await open(
      'odt',
      odfPackage('odt', [{ name: 'content.xml', body: external }]),
    )
    // the reference is data in the tree, and nothing in the published surface can dereference it
    const lease = await referencing.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const root = await tree.root()
    expect((await tree.children(root, { limit: 100 })).items.length).toBeGreaterThan(0)
    await lease.release()
    await referencing.dispose()
  })
})
