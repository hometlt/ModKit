import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatMk2AcceptanceTable,
  loadMk2Corpus,
  mk2ExtensionsRoot,
  resolveMk2Root,
  runMk2Acceptance,
  syntheticCorpusRoot,
  tallyMk2Conversion,
  type Mk2CorpusEntry,
} from '../src/index.js'

const packageRoot = join(import.meta.dirname, '..')
const repoRoot = join(packageRoot, '..', '..')
const corpus = loadMk2Corpus(join(import.meta.dirname, 'fixtures', 'mk2-corpus.json'))
const mk2Root = resolveMk2Root(repoRoot)
const generator = join(packageRoot, 'scripts', 'gen-synthetic-corpus.mjs')

const find = (contributionId: string): Mk2CorpusEntry => {
  const entry = corpus.find(item => item.contributionId === contributionId)
  if (entry === undefined) throw new TypeError(`the MK2 corpus has no case for ${contributionId}`)
  return entry
}
const firstReal = find('org.modkitx/webp')
const firstSynthetic = find('org.modkitx/wav')
const cueBinBundle = find('org.modkitx/ps1-cue-bin')
const portableModel = find('org.modkitx/ply')
const completedPortableModels = [
  find('org.modkitx/dae'),
  find('org.modkitx/gltf'),
  find('org.modkitx/uvm'),
]
const completedPortableVideos = [find('org.modkitx/avi'), find('org.modkitx/wmv')]
const completedPortableDocuments = [
  find('org.modkitx/csv'),
  find('org.modkitx/markdown'),
  find('org.modkitx/rtf'),
  find('org.modkitx/txt'),
  find('org.modkitx/docx'),
  find('org.modkitx/pptx'),
  find('org.modkitx/xlsx'),
  find('org.modkitx/odt'),
  find('org.modkitx/odp'),
  find('org.modkitx/ods'),
  find('org.modkitx/pdf'),
  find('org.modkitx/ai'),
  find('org.modkitx/drawio'),
  find('org.modkitx/visio'),
  find('org.modkitx/cdr'),
  find('org.modkitx/figma'),
  find('org.modkitx/psd'),
  find('org.modkitx/blend'),
]
const completedPortableAgeSeries = [
  find('org.modkitx/age-bar'),
  find('org.modkitx/age-drs'),
  find('org.modkitx/bti'),
  find('org.modkitx/cub'),
  find('org.modkitx/ddt'),
  find('org.modkitx/mtrl'),
  find('org.modkitx/prt'),
  find('org.modkitx/sld'),
  find('org.modkitx/slp'),
  find('org.modkitx/smp'),
  find('org.modkitx/smx'),
]
const completedPortableUnreal = [
  find('org.modkitx/unreal-actorx'),
  find('org.modkitx/unreal-pak'),
  find('org.modkitx/unreal-iostore'),
]

describe('MK2 → MK3 conversion acceptance (OPUS-MK2-01 task B, OPUS-MK2-02 tasks E/F/G)', () => {
  it('opens every corpus sample through the product path and prints the state table', async () => {
    const tally = tallyMk2Conversion(mk2ExtensionsRoot(repoRoot))
    const outcomes = await runMk2Acceptance(corpus, { repoRoot, mk2Root })
    console.log(`\n${formatMk2AcceptanceTable(tally, outcomes)}\n`)

    expect(tally.converted).toBeGreaterThanOrEqual(100)
    expect(tally.converted).toBe(tally.ported + tally.pending)
    // OPUS-MK2-02 definition of done: six OPUS-MK2-01 pilots plus port campaign wave 1.
    expect(tally.ported).toBeGreaterThanOrEqual(12)

    // A failure names the codec and the reason; a missing MK2 checkout is a skip, not a failure.
    const failures = outcomes.filter(outcome => outcome.state === 'failed')
    expect(failures.map(outcome => `${outcome.entry.contributionId}: ${outcome.detail}`)).toEqual(
      [],
    )

    // Synthetic cases are committed fixtures: they never depend on a neighbouring checkout, so
    // "no MK2 beside the lab" may not quietly turn the whole suite into skips.
    for (const outcome of outcomes) {
      const expected = outcome.corpus === 'real' && mk2Root === undefined ? 'skipped' : 'opened'
      expect({ id: outcome.entry.contributionId, state: outcome.state }).toEqual({
        id: outcome.entry.contributionId,
        state: expected,
      })
      if (outcome.state !== 'opened') continue
      expect(outcome.dataSourceContracts).toContain('common.view/tree-data-source')
      expect(outcome.dataSourceContracts).toContain('common.view/byte-range-source')
      expect(outcome.traits?.length ?? 0).toBeGreaterThan(0)
    }
    expect(
      outcomes.filter(outcome => outcome.corpus === 'synthetic').length,
    ).toBeGreaterThanOrEqual(9)
  }, 120_000)

  it('routes the signature cases on bytes alone, with the file name saying nothing', async () => {
    // Task E: these codecs declared one v1 rule — a path glob matching every file — and MK3 does
    // not accept it. They are opened by their bare name, so `match.signatures` is the only way
    // the host can shortlist them, and the winning candidate has to say so.
    const byteRouted = corpus.filter(entry => entry.expectSignatureMatch === true)
    expect(byteRouted.length).toBeGreaterThanOrEqual(8)
    const outcomes = await runMk2Acceptance(byteRouted, { repoRoot, mk2Root })
    for (const outcome of outcomes) {
      if (outcome.state === 'skipped') continue
      expect({
        id: outcome.entry.contributionId,
        state: outcome.state,
        signature: outcome.signatureMatch,
        detail: outcome.detail,
      }).toEqual({
        id: outcome.entry.contributionId,
        state: 'opened',
        signature: true,
        detail: undefined,
      })
    }
  }, 60_000)

  it('activates the portable variant in a Node worker, not just trusted in-process', async () => {
    // The worker backend verifies every artifact file against the loader's digests before it
    // evaluates anything, so this only passes while the converted extension is self-contained
    // (imports resolve inside its own artifact, not by a path escaping it). REPORT §7.6 asks each
    // port to confirm the `portable` variant instead of inheriting it, and this is that check.
    const cases = [
      firstSynthetic,
      cueBinBundle,
      portableModel,
      ...completedPortableModels,
      ...completedPortableVideos,
      ...completedPortableDocuments,
      ...completedPortableAgeSeries,
      ...completedPortableUnreal,
      ...(mk2Root === undefined ? [] : [firstReal]),
    ]
    const outcomes = await runMk2Acceptance(cases, { repoRoot, mk2Root, workerBrokered: true })
    for (const outcome of outcomes) {
      expect({
        id: outcome.entry.contributionId,
        state: outcome.state,
        variant: outcome.variantId,
        detail: outcome.detail,
      }).toEqual({
        id: outcome.entry.contributionId,
        state: 'opened',
        variant: 'portable',
        detail: undefined,
      })
    }
  }, 240_000)

  it('reports a missing corpus sample as a skip rather than a pass', async () => {
    const [outcome] = await runMk2Acceptance(
      [{ ...firstSynthetic, sample: 'does/not/exist.bin' }],
      { repoRoot, mk2Root },
    )
    expect(outcome?.state).toBe('skipped')
    expect(outcome?.detail).toContain('does/not/exist.bin')
  })

  it('fails loudly when a sample is claimed by the wrong converted codec', async () => {
    const [outcome] = await runMk2Acceptance(
      [{ ...firstSynthetic, contributionId: 'org.modkitx/not-the-winner' }],
      { repoRoot, mk2Root },
    )
    expect(outcome?.state).toBe('failed')
    expect(outcome?.detail).toContain('expected org.modkitx/not-the-winner')
  }, 15_000)

  it('the synthetic corpus is exactly what its generator produces (task F)', () => {
    const result = spawnSync(process.execPath, [generator, '--check', '--quiet'], {
      encoding: 'utf8',
    })
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  })

  it('the synthetic fixtures are valid to a decoder that is not the codec under test', async () => {
    // A fixture that only satisfies its own reader proves nothing. These two carry standard
    // compressed streams, so Node's zlib is an independent judge of whether the generator really
    // read the specification: gzip must decompress, and the PNG IDAT must inflate to the
    // filter byte plus one RGB pixel.
    const zlib = await import('node:zlib')
    const root = syntheticCorpusRoot()
    expect(zlib.gunzipSync(readFileSync(join(root, 'minimal.gz'))).toString('utf8')).toBe('hello')

    const png = readFileSync(join(root, 'minimal.png'))
    const idatStart = png.indexOf('IDAT') + 4
    const idatBytes = png.readUInt32BE(idatStart - 8)
    const inflated = zlib.inflateSync(png.subarray(idatStart, idatStart + idatBytes))
    expect([...inflated]).toEqual([0x00, 0x80, 0x40, 0x20])

    // These checks intentionally do not import the codecs. They independently walk each model
    // fixture's standard wire representation so a generator/reader bug cannot agree with itself.
    const stl = readFileSync(join(root, 'minimal.stl'))
    const stlTriangles = stl.readUInt32LE(80)
    expect(stlTriangles).toBe(1)
    expect(stl.byteLength).toBe(84 + stlTriangles * 50)
    expect([stl.readFloatLE(96), stl.readFloatLE(100), stl.readFloatLE(104)]).toEqual([0, 0, 0])

    const ply = readFileSync(join(root, 'minimal.ply'))
    const plyBody = ply.indexOf('end_header\n') + 'end_header\n'.length
    expect(ply.subarray(0, plyBody).toString('ascii')).toContain('format binary_little_endian 1.0')
    expect([
      ply.readFloatLE(plyBody),
      ply.readFloatLE(plyBody + 4),
      ply.readFloatLE(plyBody + 8),
    ]).toEqual([0, 0, 0])
    expect(ply[plyBody + 96]).toBe(3)
    expect([
      ply.readInt32LE(plyBody + 97),
      ply.readInt32LE(plyBody + 101),
      ply.readInt32LE(plyBody + 105),
    ]).toEqual([0, 1, 2])

    const obj = readFileSync(join(root, 'minimal.obj'), 'utf8')
    expect(obj.match(/^v\s/gmu)).toHaveLength(3)
    expect(obj.match(/^vt\s/gmu)).toHaveLength(3)
    expect(obj.match(/^vn\s/gmu)).toHaveLength(1)
    expect(obj.match(/^f\s+1\/1\/1\s+2\/2\/1\s+3\/3\/1$/gmu)).toHaveLength(1)

    const dae = readFileSync(join(root, 'minimal.dae'), 'utf8')
    expect(dae).toMatch(/<COLLADA[^>]+version="1\.4\.1"/u)
    expect(dae).toMatch(/<float_array[^>]+count="9">0 0 0 1 0 0 0 1 0<\/float_array>/u)
    expect(dae).toMatch(/<triangles count="1">[\s\S]*<p>0 1 2<\/p><\/triangles>/u)

    const gltf = JSON.parse(readFileSync(join(root, 'minimal.gltf'), 'utf8')) as {
      asset: { version: string }
      buffers: { byteLength: number; uri: string }[]
    }
    expect(gltf.asset.version).toBe('2.0')
    const dataUri = gltf.buffers[0]?.uri ?? ''
    expect(dataUri).toMatch(/^data:application\/octet-stream;base64,/u)
    const gltfBinary = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64')
    expect(gltfBinary.byteLength).toBe(gltf.buffers[0]?.byteLength)
    expect([
      gltfBinary.readFloatLE(0),
      gltfBinary.readFloatLE(12),
      gltfBinary.readFloatLE(28),
    ]).toEqual([0, 1, 1])
    expect([
      gltfBinary.readUInt16LE(36),
      gltfBinary.readUInt16LE(38),
      gltfBinary.readUInt16LE(40),
    ]).toEqual([0, 1, 2])

    const uvm = readFileSync(join(root, 'minimal.uvm.glb'))
    expect(uvm.subarray(0, 4).toString('ascii')).toBe('glTF')
    expect(uvm.readUInt32LE(4)).toBe(2)
    expect(uvm.readUInt32LE(8)).toBe(uvm.byteLength)
    const uvmJsonLength = uvm.readUInt32LE(12)
    expect(uvm.readUInt32LE(16)).toBe(0x4e4f534a)
    const uvmDocument = JSON.parse(uvm.subarray(20, 20 + uvmJsonLength).toString('utf8')) as {
      asset: { extras: { uv: { format: string; version: string; profile: string } } }
      extensionsUsed: string[]
    }
    expect(uvmDocument.asset.extras.uv).toEqual({ format: 'UVM', version: '1.0', profile: 'core' })
    expect(uvmDocument.extensionsUsed).toEqual(
      expect.arrayContaining(['UV_asset', 'UV_provenance']),
    )
    const uvmBinHeader = 20 + uvmJsonLength
    expect(uvm.readUInt32LE(uvmBinHeader + 4)).toBe(0x004e4942)
    expect([
      uvm.readUInt16LE(uvmBinHeader + 8 + 36),
      uvm.readUInt16LE(uvmBinHeader + 8 + 38),
      uvm.readUInt16LE(uvmBinHeader + 8 + 40),
    ]).toEqual([0, 1, 2])

    const avi = readFileSync(join(root, 'minimal.avi'))
    expect(avi.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(avi.readUInt32LE(4) + 8).toBe(avi.byteLength)
    expect(avi.subarray(8, 12).toString('ascii')).toBe('AVI ')
    const avih = avi.indexOf('avih')
    const streamHeader = avi.indexOf('strh')
    expect(avih).toBeGreaterThan(0)
    expect(streamHeader).toBeGreaterThan(avih)
    expect(avi.readUInt32LE(avih + 8 + 32)).toBe(1)
    expect(avi.readUInt32LE(avih + 8 + 36)).toBe(1)
    expect(avi.subarray(streamHeader + 8, streamHeader + 12).toString('ascii')).toBe('vids')
    expect(avi.subarray(streamHeader + 12, streamHeader + 16).toString('ascii')).toBe('DIB ')
    expect(avi.indexOf('movi')).toBeGreaterThan(streamHeader)
    expect(avi.indexOf('00db')).toBeGreaterThan(avi.indexOf('movi'))

    const wmv = readFileSync(join(root, 'minimal.wmv'))
    const asfHeaderGuid = '3026b2758e66cf11a6d900aa0062ce6c'
    const asfDataGuid = '3626b2758e66cf11a6d900aa0062ce6c'
    expect(wmv.subarray(0, 16).toString('hex')).toBe(asfHeaderGuid)
    const asfHeaderSize = Number(wmv.readBigUInt64LE(16))
    expect(wmv.readUInt32LE(24)).toBe(3)
    expect([...wmv.subarray(28, 30)]).toEqual([1, 2])
    let asfOffset = 30
    const headerObjectGuids = []
    for (let index = 0; index < 3; index += 1) {
      headerObjectGuids.push(wmv.subarray(asfOffset, asfOffset + 16).toString('hex'))
      asfOffset += Number(wmv.readBigUInt64LE(asfOffset + 16))
    }
    expect(asfOffset).toBe(asfHeaderSize)
    expect(headerObjectGuids).toEqual([
      'a1dcab8c47a9cf118ee400c00c205365',
      '9107dcb7b7a9cf118ee600c00c205365',
      'b503bf5f2ea9cf118ee300c00c205365',
    ])
    expect(wmv.subarray(asfHeaderSize, asfHeaderSize + 16).toString('hex')).toBe(asfDataGuid)
    expect(Number(wmv.readBigUInt64LE(asfHeaderSize + 16))).toBe(50)

    const csv = readFileSync(join(root, 'minimal.csv'), 'ascii')
    expect(csv).toMatch(/^name,quote,note\r\n/u)
    expect(csv).toContain('"Hello, ""world"""')
    expect(csv).toContain('"line one\r\nline two"')
    expect(csv.endsWith('\r\n')).toBe(true)

    const markdown = readFileSync(join(root, 'minimal.md'), 'utf8')
    expect(markdown.match(/^#{1,6}\s+/gmu)).toHaveLength(2)
    expect(markdown.match(/^```/gmu)).toHaveLength(2)
    expect(markdown).toContain('[spec](https://example.invalid/spec)')

    const rtf = readFileSync(join(root, 'minimal.rtf'), 'ascii')
    expect(rtf).toMatch(/^\{\\rtf1\\ansi/u)
    expect(rtf.endsWith('}')).toBe(true)
    expect([...rtf].filter(character => character === '{')).toHaveLength(
      [...rtf].filter(character => character === '}').length,
    )
    expect(rtf.match(/\\par\b/gu)).toHaveLength(2)

    const txt = readFileSync(join(root, 'minimal.txt'))
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(txt)).not.toThrow()
    expect(txt.toString('ascii').match(/\r\n/gu)).toHaveLength(4)

    const officeFixtures = {
      docx: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
      pptx: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml'],
      xlsx: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
      odt: ['mimetype', 'META-INF/manifest.xml', 'content.xml'],
      odp: ['mimetype', 'META-INF/manifest.xml', 'content.xml'],
      ods: ['mimetype', 'META-INF/manifest.xml', 'content.xml'],
    } as const
    const odfMediaTypes = {
      odt: 'application/vnd.oasis.opendocument.text',
      odp: 'application/vnd.oasis.opendocument.presentation',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
    } as const
    for (const [format, expectedNames] of Object.entries(officeFixtures)) {
      const data = readFileSync(join(root, `minimal.${format}`))
      const eocd = data.byteLength - 22
      expect(data.readUInt32LE(eocd)).toBe(0x06054b50)
      const entries = data.readUInt16LE(eocd + 10)
      expect(entries).toBe(expectedNames.length)
      let central = data.readUInt32LE(eocd + 16)
      const names = []
      for (let index = 0; index < entries; index += 1) {
        expect(data.readUInt32LE(central)).toBe(0x02014b50)
        const nameLength = data.readUInt16LE(central + 28)
        const extraLength = data.readUInt16LE(central + 30)
        const commentLength = data.readUInt16LE(central + 32)
        names.push(data.subarray(central + 46, central + 46 + nameLength).toString('utf8'))
        central += 46 + nameLength + extraLength + commentLength
      }
      expect(names).toEqual([...expectedNames])
      expect(central).toBe(eocd)
      if (format === 'odt' || format === 'odp' || format === 'ods') {
        expect(data.readUInt32LE(0)).toBe(0x04034b50)
        expect(data.readUInt16LE(8)).toBe(0)
        const nameLength = data.readUInt16LE(26)
        const extraLength = data.readUInt16LE(28)
        expect(data.subarray(30, 30 + nameLength).toString('utf8')).toBe('mimetype')
        const payload = 30 + nameLength + extraLength
        const size = data.readUInt32LE(22)
        expect(data.subarray(payload, payload + size).toString('utf8')).toBe(odfMediaTypes[format])
      }
    }

    for (const format of ['pdf', 'ai'] as const) {
      const data = readFileSync(join(root, `minimal.${format}`))
      const source = data.toString('latin1')
      expect(source).toMatch(/^%PDF-1\.7\n/u)
      const ending = /startxref\n(\d+)\n%%EOF\n$/u.exec(source)
      expect(ending).not.toBeNull()
      const xrefOffset = Number(ending?.[1])
      expect(source.slice(xrefOffset, xrefOffset + 9)).toBe('xref\n0 6\n')
      const rows = source
        .slice(xrefOffset + 9, source.indexOf('trailer\n', xrefOffset))
        .trimEnd()
        .split('\n')
      expect(rows).toHaveLength(6)
      for (let object = 1; object < rows.length; object += 1) {
        const offset = Number(rows[object]?.slice(0, 10))
        expect(source.slice(offset)).toMatch(new RegExp(`^${object} 0 obj\\n`, 'u'))
      }
      expect(source.slice(xrefOffset)).toContain('<< /Size 6 /Root 1 0 R /Info 5 0 R >>')
      expect(source.includes('Adobe Illustrator')).toBe(format === 'ai')
    }

    const drawio = readFileSync(join(root, 'minimal.drawio'), 'utf8')
    expect(drawio).toMatch(/^<\?xml[^>]*><mxfile\b/u)
    expect(drawio.match(/<diagram\b/gu)).toHaveLength(1)
    const cellIds = [...drawio.matchAll(/<mxCell\b[^>]*\bid="([^"]+)"/gu)].map(match => match[1])
    expect(cellIds).toEqual(['0', '1', 'node-a', 'node-b', 'edge-a-b'])
    expect(drawio).toContain('source="node-a" target="node-b"')
    expect(drawio.match(/<mxGeometry\b/gu)).toHaveLength(3)

    const vsd = readFileSync(join(root, 'minimal.vsd'))
    expect(vsd.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1')
    expect(vsd.readUInt16LE(26)).toBe(3)
    expect(vsd.readUInt16LE(28)).toBe(0xfffe)
    expect(vsd.readUInt16LE(30)).toBe(9)
    expect(vsd.readUInt32LE(44)).toBe(1)
    expect(vsd.readUInt32LE(76)).toBe(1)
    expect(vsd.readUInt32LE(1024)).toBe(0xfffffffe)
    expect(vsd.readUInt32LE(1028)).toBe(0xfffffffd)
    const cfbName = (offset: number) => {
      const bytes = vsd.readUInt16LE(offset + 64)
      return vsd.subarray(offset, offset + bytes - 2).toString('utf16le')
    }
    expect(cfbName(512)).toBe('Root Entry')
    expect(cfbName(640)).toBe('VisioDocument')

    const vsdx = readFileSync(join(root, 'minimal.vsdx'))
    const vsdxEocd = vsdx.byteLength - 22
    expect(vsdx.readUInt32LE(vsdxEocd)).toBe(0x06054b50)
    expect(vsdx.readUInt16LE(vsdxEocd + 10)).toBe(5)

    const cdr = readFileSync(join(root, 'minimal.cdr'))
    expect(cdr.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(cdr.readUInt32LE(4) + 8).toBe(cdr.byteLength)
    expect(cdr.subarray(8, 12).toString('ascii')).toBe('CDR6')
    expect(cdr.subarray(12, 16).toString('ascii')).toBe('LIST')
    expect(cdr.subarray(20, 24).toString('ascii')).toBe('page')
    expect(cdr.subarray(24, 28).toString('ascii')).toBe('LIST')
    expect(cdr.subarray(32, 36).toString('ascii')).toBe('obj ')
    expect(cdr.subarray(36, 40).toString('ascii')).toBe('loda')

    const fig = readFileSync(join(root, 'minimal.fig'))
    const figEocd = fig.byteLength - 22
    let figCentral = fig.readUInt32LE(figEocd + 16)
    const figParts = new Map<string, Buffer>()
    for (let index = 0; index < fig.readUInt16LE(figEocd + 10); index += 1) {
      const method = fig.readUInt16LE(figCentral + 10)
      const compressedBytes = fig.readUInt32LE(figCentral + 20)
      const nameBytes = fig.readUInt16LE(figCentral + 28)
      const extraBytes = fig.readUInt16LE(figCentral + 30)
      const commentBytes = fig.readUInt16LE(figCentral + 32)
      const local = fig.readUInt32LE(figCentral + 42)
      const name = fig.subarray(figCentral + 46, figCentral + 46 + nameBytes).toString('utf8')
      const localNameBytes = fig.readUInt16LE(local + 26)
      const localExtraBytes = fig.readUInt16LE(local + 28)
      const payload = local + 30 + localNameBytes + localExtraBytes
      const compressed = fig.subarray(payload, payload + compressedBytes)
      figParts.set(name, method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed))
      figCentral += 46 + nameBytes + extraBytes + commentBytes
    }
    expect([...figParts.keys()]).toEqual(['canvas.fig', 'meta.json'])
    const canvas = figParts.get('canvas.fig')
    expect(canvas?.subarray(0, 8).toString('ascii')).toBe('fig-kiwi')
    expect(canvas?.readUInt32LE(8)).toBe(101)
    const schemaBytes = canvas?.readUInt32LE(12) ?? 0
    const schema = zlib.inflateRawSync(canvas?.subarray(16, 16 + schemaBytes) ?? Buffer.alloc(0))
    expect(schema.subarray(0, 13).toString('latin1')).toBe('\u0001NodeChanges\u0000')
    const dataStart = 16 + schemaBytes + 4
    expect(canvas?.subarray(dataStart, dataStart + 4).toString('hex')).toBe('28b52ffd')
    expect(JSON.parse(figParts.get('meta.json')?.toString('utf8') ?? '')).toMatchObject({
      name: 'Modkit X3 Figma fixture',
    })

    const psd = readFileSync(join(root, 'minimal.psd'))
    expect(psd.subarray(0, 4).toString('ascii')).toBe('8BPS')
    expect(psd.readUInt16BE(4)).toBe(1)
    expect([...psd.subarray(6, 12)]).toEqual([0, 0, 0, 0, 0, 0])
    expect(psd.readUInt16BE(12)).toBe(3)
    expect([psd.readUInt32BE(18), psd.readUInt32BE(14)]).toEqual([1, 1])
    expect([psd.readUInt16BE(22), psd.readUInt16BE(24)]).toEqual([8, 3])
    let psdOffset = 26
    expect(psd.readUInt32BE(psdOffset)).toBe(0)
    psdOffset += 4
    const resourceBytes = psd.readUInt32BE(psdOffset)
    psdOffset += 4
    expect(psd.subarray(psdOffset, psdOffset + 4).toString('ascii')).toBe('8BIM')
    expect(psd.readUInt16BE(psdOffset + 4)).toBe(1005)
    expect(resourceBytes).toBe(28)
    psdOffset += resourceBytes
    const layerMaskBytes = psd.readUInt32BE(psdOffset)
    psdOffset += 4
    expect(layerMaskBytes).toBe(88)
    expect(psd.readUInt32BE(psdOffset)).toBe(80)
    expect(psd.readInt16BE(psdOffset + 4)).toBe(1)
    psdOffset += layerMaskBytes
    expect(psd.readUInt16BE(psdOffset)).toBe(0)
    expect([...psd.subarray(psdOffset + 2)]).toEqual([255, 128, 64])

    const blend = readFileSync(join(root, 'minimal.blend'))
    expect(blend.subarray(0, 12).toString('ascii')).toBe('BLENDER-v400')
    let blendOffset = 12
    const blendBlocks: { code: string; size: number; payload: number }[] = []
    while (blendOffset < blend.byteLength) {
      const code = blend.subarray(blendOffset, blendOffset + 4).toString('ascii')
      const size = blend.readUInt32LE(blendOffset + 4)
      if (code === 'ENDB') {
        expect(size).toBe(0)
        blendOffset += 8
        blendBlocks.push({ code, size, payload: blendOffset })
        break
      }
      const payload = blendOffset + 24
      blendBlocks.push({ code, size, payload })
      blendOffset = payload + size
    }
    expect(blendOffset).toBe(blend.byteLength)
    expect(blendBlocks.map(block => block.code)).toEqual(['MV  ', 'MF  ', 'DNA1', 'ENDB'])
    const vertexBlock = blendBlocks[0]
    const faceBlock = blendBlocks[1]
    const dnaBlock = blendBlocks[2]
    expect(vertexBlock?.size).toBe(36)
    expect([
      blend.readFloatLE(vertexBlock?.payload ?? 0),
      blend.readFloatLE((vertexBlock?.payload ?? 0) + 12),
      blend.readFloatLE((vertexBlock?.payload ?? 0) + 28),
    ]).toEqual([0, 1, 1])
    expect([
      blend.readUInt32LE(faceBlock?.payload ?? 0),
      blend.readUInt32LE((faceBlock?.payload ?? 0) + 4),
      blend.readUInt32LE((faceBlock?.payload ?? 0) + 8),
      blend.readUInt32LE((faceBlock?.payload ?? 0) + 12),
    ]).toEqual([0, 1, 2, 0])
    const dnaPayload = dnaBlock?.payload ?? 0
    expect(blend.subarray(dnaPayload, dnaPayload + 8).toString('ascii')).toBe('SDNANAME')
    expect(blend.readUInt32LE(dnaPayload + 8)).toBe(5)
    expect(blend.indexOf('TYPE', dnaPayload)).toBeGreaterThan(dnaPayload)
    expect(blend.indexOf('TLEN', dnaPayload)).toBeGreaterThan(dnaPayload)
    expect(blend.indexOf('STRC', dnaPayload)).toBeGreaterThan(dnaPayload)

    const actorX = readFileSync(join(root, 'minimal.actorx.psk'))
    const actorXChunks: [string, number, number][] = []
    let actorXOffset = 0
    while (actorXOffset < actorX.byteLength) {
      const rawName = actorX.subarray(actorXOffset, actorXOffset + 20)
      const zero = rawName.indexOf(0)
      const name = rawName.subarray(0, zero < 0 ? rawName.length : zero).toString('ascii')
      const recordSize = actorX.readInt32LE(actorXOffset + 24)
      const count = actorX.readInt32LE(actorXOffset + 28)
      actorXChunks.push([name, recordSize, count])
      actorXOffset += 32 + recordSize * count
    }
    expect(actorXOffset).toBe(actorX.byteLength)
    expect(actorXChunks).toEqual([
      ['ACTRHEAD', 0, 0],
      ['PNTS0000', 12, 3],
      ['VTXW0000', 16, 3],
      ['FACE0000', 12, 1],
      ['MATT0000', 88, 1],
      ['REFSKELT', 120, 1],
      ['RAWWEIGHTS', 12, 3],
    ])

    const pak = readFileSync(join(root, 'minimal.unreal.pak'))
    const pakFooter = pak.byteLength - 221
    const pakMagic = pakFooter + 17
    expect(pak.readUInt32LE(pakMagic)).toBe(0x5a6f12e1)
    expect(pak.readUInt32LE(pakMagic + 4)).toBe(8)
    const pakIndexOffset = Number(pak.readBigInt64LE(pakMagic + 8))
    const pakIndexSize = Number(pak.readBigInt64LE(pakMagic + 16))
    expect(pakIndexOffset + pakIndexSize).toBe(pakFooter)
    expect(
      createHash('sha1')
        .update(pak.subarray(pakIndexOffset, pakIndexOffset + pakIndexSize))
        .digest(),
    ).toEqual(pak.subarray(pakMagic + 24, pakMagic + 44))

    const utoc = readFileSync(join(root, 'minimal.unreal.utoc'))
    const ucas = readFileSync(join(root, 'minimal.unreal.ucas'))
    expect(utoc.subarray(0, 16).toString('ascii')).toBe('-==--==--==--==-')
    expect([utoc[0x10], utoc.readUInt32LE(0x14), utoc.readUInt32LE(0x18)]).toEqual([6, 0x90, 2])
    const ioBlocks = 0x90 + 2 * 12 + 2 * 10
    const firstPhysical = utoc.readUInt32LE(ioBlocks)
    const firstStored = utoc.readUIntLE(ioBlocks + 5, 3)
    const secondPhysical = utoc.readUInt32LE(ioBlocks + 12)
    const secondStored = utoc.readUIntLE(ioBlocks + 17, 3)
    expect(ucas.subarray(firstPhysical, firstPhysical + firstStored).toString()).toBe(
      'iostore unit asset',
    )
    expect(ucas.subarray(secondPhysical, secondPhysical + secondStored).toString()).toBe(
      '[IoStore]\nMounted=true\n',
    )

    const bar = readFileSync(join(root, 'minimal.age-bar'))
    expect(bar.subarray(0, 4).toString('ascii')).toBe('ESPN')
    expect(bar.readUInt32LE(4)).toBe(5)
    expect(bar.readUInt32LE(280)).toBe(3)
    const barTable = Number(bar.readBigUInt64LE(288))
    expect(barTable).toBeGreaterThan(304)
    const rootCharacters = bar.readUInt32LE(barTable)
    expect(bar.subarray(barTable + 4, barTable + 4 + rootCharacters * 2).toString('utf16le')).toBe(
      'art',
    )
    let barCursor = barTable + 8 + rootCharacters * 2
    const barEntries: { name: string; compressed: number; payload: Buffer }[] = []
    for (let index = 0; index < 3; index += 1) {
      const payloadOffset = Number(bar.readBigUInt64LE(barCursor))
      const decodedSize = bar.readUInt32LE(barCursor + 8)
      const storedSize = bar.readUInt32LE(barCursor + 12)
      expect(bar.readUInt32LE(barCursor + 16)).toBe(decodedSize)
      barCursor += 36
      const nameCharacters = bar.readUInt32LE(barCursor)
      barCursor += 4
      const name = bar.subarray(barCursor, barCursor + nameCharacters * 2).toString('utf16le')
      barCursor += nameCharacters * 2
      const compressed = bar.readUInt32LE(barCursor)
      barCursor += 4
      barEntries.push({
        name,
        compressed,
        payload: bar.subarray(payloadOffset, payloadOffset + storedSize),
      })
    }
    expect(barEntries.map(entry => [entry.name, entry.compressed])).toEqual([
      ['data/proto.xmb', 0],
      ['strings/help.txt', 1],
      ['textures/icon.ddt', 1],
    ])
    expect(barEntries[0]?.payload.toString('utf8')).toBe('<xmb/>')
    expect(barEntries[1]?.payload.subarray(0, 4).toString('ascii')).toBe('l33t')
    expect(
      zlib.inflateRawSync(barEntries[1]?.payload.subarray(10) ?? Buffer.alloc(0)).toString(),
    ).toBe('hello l33t\n')
    const alz4 = barEntries[2]?.payload
    expect(alz4?.subarray(0, 4).toString('ascii')).toBe('alz4')
    const alz4Size = alz4?.readUInt32LE(4) ?? 0
    expect((alz4?.[16] ?? 0) >>> 4).toBe(alz4Size)
    expect(alz4?.subarray(17, 17 + alz4Size).toString()).toBe('hello alz4\n')

    const drs = readFileSync(join(root, 'minimal.age-drs'))
    expect(drs.subarray(40, 44).toString('ascii')).toBe('1.00')
    expect(drs.subarray(44, 49).toString('ascii')).toBe('tribe')
    expect(drs.readUInt32LE(56)).toBe(2)
    const drsTypes = []
    const drsResources = []
    for (let tableIndex = 0; tableIndex < 2; tableIndex += 1) {
      const table = 64 + tableIndex * 12
      const rawType = drs.subarray(table, table + 4).toString('ascii')
      const type = [...rawType].reverse().join('').trim()
      drsTypes.push(type)
      const resources = drs.readUInt32LE(table + 4)
      expect(drs.readUInt32LE(table + 8)).toBe(1)
      const id = drs.readUInt32LE(resources)
      const payload = drs.readUInt32LE(resources + 4)
      const size = drs.readUInt32LE(resources + 8)
      drsResources.push([type, id, drs.subarray(payload, payload + size).toString('utf8')])
    }
    expect(drsTypes).toEqual(['slp', 'wav'])
    expect(drsResources).toEqual([
      ['slp', 42, 'sprite'],
      ['wav', 7, 'sound'],
    ])

    const bti = readFileSync(join(root, 'minimal.bti'))
    expect(bti.toString('utf8')).toBe(
      'alpha=4 nomip noalphatest noLowDetail displacement fmt=BC2\n',
    )

    const cub = readFileSync(join(root, 'minimal.cub'))
    expect(
      cub
        .toString('utf8')
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('//')),
    ).toEqual([
      'sky_up.ddt',
      'sky_down.ddt',
      'sky_front.ddt',
      'sky_back.ddt',
      'sky_left.ddt',
      'sky_right.ddt',
    ])

    const mtrl = readFileSync(join(root, 'minimal.mtrl'))
    expect(mtrl.subarray(0, 4).toString('ascii')).toBe('MTRL')
    expect([mtrl.readUInt32LE(4), mtrl.readUInt32LE(8), mtrl.readUInt32LE(12)]).toEqual([17, 7, 19])
    expect([mtrl.readInt32LE(84), mtrl.readInt32LE(96)]).toEqual([7, 10])
    expect(mtrl.subarray(212).toString('utf8').split('\0')).toEqual([
      'terrain\\grass.ddt',
      'sky.cub',
      'terrain\\grass_n.ddt',
      '',
    ])

    const prt = readFileSync(join(root, 'minimal.prt'))
    expect([prt.readInt32LE(0), prt.readInt32LE(16), prt.readInt32LE(20)]).toEqual([12, 64, 0])
    expect([
      prt.readInt32LE(212),
      prt.readInt32LE(216),
      prt.readInt32LE(220),
      prt.readInt32LE(224),
    ]).toEqual([1, 4, 64, 64])
    expect([
      prt.readInt32LE(260),
      prt.readInt32LE(284),
      prt.readInt32LE(332),
      prt.readInt32LE(336),
      prt.readInt32LE(440),
    ]).toEqual([1, 1, 1, 1, 1])
    const brgCharacters = prt.readInt32LE(456)
    expect(brgCharacters).toBe(9)
    expect(prt.subarray(460, 460 + brgCharacters * 2).toString('utf16le')).toBe('spark.brg')

    const ddt = readFileSync(join(root, 'minimal.ddt'))
    expect(ddt.subarray(0, 4).toString('ascii')).toBe('RTS3')
    expect([...ddt.subarray(4, 8)]).toEqual([0, 0, 4, 1])
    expect([ddt.readUInt32LE(8), ddt.readUInt32LE(12)]).toEqual([4, 4])
    const ddtPayload = ddt.readUInt32LE(16)
    expect(ddt.readUInt32LE(20)).toBe(8)
    const red565 = ddt.readUInt16LE(ddtPayload)
    expect([
      Math.round((((red565 >>> 11) & 0x1f) * 255) / 31),
      Math.round((((red565 >>> 5) & 0x3f) * 255) / 63),
      Math.round(((red565 & 0x1f) * 255) / 31),
    ]).toEqual([255, 0, 0])
    expect(ddt.readUInt32LE(ddtPayload + 4)).toBe(0)

    const slp = readFileSync(join(root, 'minimal.slp'))
    expect(slp.subarray(0, 4).toString('ascii')).toBe('2.0N')
    expect(slp.readUInt32LE(4)).toBe(1)
    expect([slp.readUInt32LE(32), slp.readUInt32LE(36)]).toEqual([68, 64])
    expect([slp.readInt32LE(48), slp.readInt32LE(52)]).toEqual([1, 1])
    expect([slp.readUInt16LE(64), slp.readUInt16LE(66)]).toEqual([0, 0])
    expect(slp.readUInt32LE(68)).toBe(72)
    expect([...slp.subarray(72)]).toEqual([0x04, 0x07, 0x0f])

    const smp = readFileSync(join(root, 'minimal.smp'))
    expect(smp.subarray(0, 4).toString('ascii')).toBe('SMP$')
    expect([smp.readUInt32LE(8), smp.readUInt32LE(12), smp.readUInt32LE(16)]).toEqual([1, 1, 1])
    expect(smp.readUInt32LE(24)).toBe(smp.byteLength)
    const smpFrame = smp.readUInt32LE(64)
    expect(smpFrame).toBe(68)
    expect(smp.readUInt32LE(smpFrame + 28)).toBe(1)
    const smpLayer = smpFrame + 32
    expect([smp.readUInt32LE(smpLayer), smp.readUInt32LE(smpLayer + 4)]).toEqual([1, 1])
    expect(smp.readUInt32LE(smpLayer + 16)).toBe(0x02)
    expect([smp.readUInt32LE(smpLayer + 20), smp.readUInt32LE(smpLayer + 24)]).toEqual([64, 68])
    expect(smp.readUInt32LE(smpFrame + 68)).toBe(72)

    const smx = readFileSync(join(root, 'minimal.smx'))
    expect(smx.subarray(0, 4).toString('ascii')).toBe('SMPX')
    expect([smx.readUInt16LE(4), smx.readUInt16LE(6)]).toEqual([2, 1])
    expect(smx.readUInt32LE(8)).toBe(smx.byteLength - 32)
    expect([...smx.subarray(32, 34)]).toEqual([0x01, 0])
    const smxLayer = 38
    expect([smx.readUInt16LE(smxLayer), smx.readUInt16LE(smxLayer + 2)]).toEqual([1, 1])
    expect(smx.readUInt32LE(smxLayer + 8)).toBe(35)
    expect([smx.readUInt32LE(smxLayer + 20), smx.readUInt32LE(smxLayer + 24)]).toEqual([2, 5])
    expect([...smx.subarray(smxLayer + 28)]).toEqual([0x01, 0x03, 0x07, 0, 0, 0, 0])

    const sld = readFileSync(join(root, 'minimal.sld'))
    expect(sld.subarray(0, 4).toString('ascii')).toBe('SLDX')
    expect([sld.readUInt16LE(4), sld.readUInt16LE(6)]).toEqual([4, 1])
    expect([sld.readUInt16LE(16), sld.readUInt16LE(18)]).toEqual([4, 4])
    expect(sld[24]).toBe(0x01)
    expect(sld.readUInt32LE(28)).toBe(26)
    expect([sld.readUInt16LE(36), sld.readUInt16LE(38)]).toEqual([4, 4])
    expect(sld.readUInt16LE(42)).toBe(1)
    expect([...sld.subarray(44, 46)]).toEqual([0, 1])
    expect(sld.readUInt16LE(46)).toBe(0xf800)
  })
})
