import { spawnSync } from 'node:child_process'
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
  }, 30_000)

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
  }, 20_000)

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
  }, 15_000)

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
  })
})
