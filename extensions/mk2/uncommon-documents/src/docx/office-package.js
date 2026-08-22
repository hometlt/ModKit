// Shared by the six hand-ported OOXML and OpenDocument entrypoints.
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const utf8 = new TextDecoder('utf-8', { fatal: true })

const FORMATS = Object.freeze({
  docx: Object.freeze({
    id: 'org.modkitx/docx',
    label: 'Word document',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    family: 'ooxml',
    root: 'word/document.xml',
  }),
  pptx: Object.freeze({
    id: 'org.modkitx/pptx',
    label: 'PowerPoint presentation',
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    family: 'ooxml',
    root: 'ppt/presentation.xml',
  }),
  xlsx: Object.freeze({
    id: 'org.modkitx/xlsx',
    label: 'Excel workbook',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    family: 'ooxml',
    root: 'xl/workbook.xml',
  }),
  odt: Object.freeze({
    id: 'org.modkitx/odt',
    label: 'OpenDocument text',
    mediaType: 'application/vnd.oasis.opendocument.text',
    family: 'odf',
    root: 'content.xml',
  }),
  odp: Object.freeze({
    id: 'org.modkitx/odp',
    label: 'OpenDocument presentation',
    mediaType: 'application/vnd.oasis.opendocument.presentation',
    family: 'odf',
    root: 'content.xml',
  }),
  ods: Object.freeze({
    id: 'org.modkitx/ods',
    label: 'OpenDocument spreadsheet',
    mediaType: 'application/vnd.oasis.opendocument.spreadsheet',
    family: 'odf',
    root: 'content.xml',
  }),
})

const u16 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
const u32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)

function findEocd(bytes) {
  const start = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) return offset
  }
  return -1
}

function safePath(path) {
  if (path === '' || path.includes('\0') || path.startsWith('/') || path.includes('\\'))
    return false
  return !path.split('/').some(part => part === '.' || part === '..')
}

function parseZip(bytes, budget) {
  if (budget.maxDepth < 1) throw new RangeError('office package exceeds maxDepth budget')
  const eocd = findEocd(bytes)
  if (eocd < 0) throw new TypeError('office ZIP end-of-central-directory record is missing')
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new TypeError('multi-disk office ZIP packages are unsupported')
  }
  const diskEntries = u16(bytes, eocd + 8)
  const entriesCount = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  const commentLength = u16(bytes, eocd + 20)
  if (diskEntries !== entriesCount || eocd + 22 + commentLength !== bytes.byteLength) {
    throw new TypeError('office ZIP EOCD counts or comment length are invalid')
  }
  if (entriesCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new TypeError('ZIP64 office packages are unsupported')
  }
  if (entriesCount > budget.maxNodes)
    throw new RangeError('office ZIP entries exceed maxNodes budget')
  if (centralOffset + centralSize !== eocd) {
    throw new TypeError('office ZIP central-directory bounds are invalid')
  }

  const entries = []
  const names = new Set()
  let scalarBytes = 0
  let decodedBytes = 0
  let offset = centralOffset
  for (let index = 0; index < entriesCount; index += 1) {
    if (offset + 46 > eocd || u32(bytes, offset) !== 0x02014b50) {
      throw new TypeError(`office ZIP central entry ${index} is invalid`)
    }
    const flags = u16(bytes, offset + 8)
    const method = u16(bytes, offset + 10)
    const checksum = u32(bytes, offset + 16)
    const compressedSize = u32(bytes, offset + 20)
    const uncompressedSize = u32(bytes, offset + 24)
    const nameLength = u16(bytes, offset + 28)
    const extraLength = u16(bytes, offset + 30)
    const entryCommentLength = u16(bytes, offset + 32)
    const localOffset = u32(bytes, offset + 42)
    const next = offset + 46 + nameLength + extraLength + entryCommentLength
    if (next > eocd) throw new TypeError('office ZIP central entry is truncated')
    let name
    try {
      name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    } catch {
      throw new TypeError('office ZIP entry name is not well-formed UTF-8')
    }
    if (!safePath(name)) throw new TypeError(`office ZIP entry path is unsafe: ${name}`)
    if (names.has(name)) throw new TypeError(`office ZIP entry path is duplicated: ${name}`)
    if ((flags & 1) !== 0) throw new TypeError(`office ZIP entry is encrypted: ${name}`)
    if (method !== 0 && method !== 8) {
      throw new TypeError(`office ZIP entry uses unsupported method ${method}: ${name}`)
    }
    if (compressedSize === 0 && uncompressedSize > 0) {
      throw new TypeError(`office ZIP entry has an invalid compression ratio: ${name}`)
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > 100) {
      throw new RangeError(`office ZIP entry exceeds the compression-ratio budget: ${name}`)
    }
    scalarBytes += name.length * 2 + 96
    decodedBytes += uncompressedSize
    if (scalarBytes + decodedBytes > budget.maxScalarBytes) {
      throw new RangeError('office ZIP decoded content exceeds maxScalarBytes budget')
    }
    names.add(name)
    entries.push({ name, flags, method, checksum, compressedSize, uncompressedSize, localOffset })
    offset = next
  }
  if (offset !== eocd) throw new TypeError('office ZIP central-directory size is inconsistent')
  return { entries, scalarBytes, decodedBytes }
}

async function inflateRaw(bytes, expectedBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([Uint8Array.from(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > expectedBytes) {
      await reader.cancel('office ZIP entry expanded past its declared size')
      throw new TypeError('office ZIP entry expanded past its declared size')
    }
    chunks.push(result.value)
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function extract(bytes, entry) {
  const offset = entry.localOffset
  if (offset + 30 > bytes.byteLength || u32(bytes, offset) !== 0x04034b50) {
    throw new TypeError(`office ZIP local header is invalid: ${entry.name}`)
  }
  const flags = u16(bytes, offset + 6)
  const method = u16(bytes, offset + 8)
  const nameLength = u16(bytes, offset + 26)
  const extraLength = u16(bytes, offset + 28)
  const dataOffset = offset + 30 + nameLength + extraLength
  const dataEnd = dataOffset + entry.compressedSize
  if (flags !== entry.flags || method !== entry.method || dataEnd > bytes.byteLength) {
    throw new TypeError(
      `office ZIP local entry disagrees with the central directory: ${entry.name}`,
    )
  }
  const localName = utf8.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
  if (localName !== entry.name)
    throw new TypeError(`office ZIP local entry name differs: ${entry.name}`)
  const compressed = bytes.subarray(dataOffset, dataEnd)
  const output =
    entry.method === 0 ? compressed.slice() : await inflateRaw(compressed, entry.uncompressedSize)
  if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.checksum) {
    throw new TypeError(`office ZIP entry size or CRC is invalid: ${entry.name}`)
  }
  return output
}

function analyzeXml(bytes, label, budget, state) {
  let xml
  try {
    xml = utf8.decode(bytes)
  } catch {
    throw new TypeError(`${label} is not well-formed UTF-8`)
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new TypeError(`${label} contains a forbidden DTD`)
  state.scalarBytes += xml.length * 2
  if (state.scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('office XML exceeds maxScalarBytes budget')
  }
  const stack = []
  const tags = new Map()
  for (const match of xml.matchAll(/<[^>]+>/gu)) {
    const token = match[0]
    if (/^<\?|^<!--|^<!\[CDATA\[/u.test(token)) continue
    const closing = /^<\/\s*([^\s>]+)/u.exec(token)
    if (closing !== null) {
      if (stack.pop() !== closing[1]) throw new TypeError(`${label} has mismatched XML elements`)
      continue
    }
    const opening = /^<\s*([^\s/>]+)/u.exec(token)
    if (opening === null) throw new TypeError(`${label} has malformed XML markup`)
    const name = opening[1]
    state.nodes += 1
    if (state.nodes > budget.maxNodes) throw new RangeError('office XML exceeds maxNodes budget')
    tags.set(name, (tags.get(name) ?? 0) + 1)
    if (!/\/\s*>$/u.test(token)) {
      stack.push(name)
      if (stack.length > budget.maxDepth) throw new RangeError('office XML exceeds maxDepth budget')
    }
  }
  if (stack.length !== 0) throw new TypeError(`${label} has unclosed XML elements`)
  return { xml, tags }
}

const count = (document, tag) => document.tags.get(tag) ?? 0

async function inspectPackage(format, bytes, budget) {
  const details = FORMATS[format]
  const zip = parseZip(bytes, budget)
  const byName = new Map(zip.entries.map(entry => [entry.name, entry]))
  const required =
    details.family === 'ooxml'
      ? ['[Content_Types].xml', '_rels/.rels', details.root]
      : ['mimetype', 'META-INF/manifest.xml', details.root]
  for (const name of required) {
    if (!byName.has(name)) throw new TypeError(`${format} package is missing required part ${name}`)
  }
  if (details.family === 'odf') {
    const mimetypeEntry = byName.get('mimetype')
    if (mimetypeEntry.localOffset !== 0 || mimetypeEntry.method !== 0) {
      throw new TypeError(`${format} mimetype must be the first uncompressed ZIP entry`)
    }
    const mimetype = utf8.decode(await extract(bytes, mimetypeEntry))
    if (mimetype !== details.mediaType) throw new TypeError(`${format} mimetype is invalid`)
  }

  const state = { nodes: zip.entries.length, scalarBytes: zip.scalarBytes }
  const xmlParts = new Map()
  for (const name of required.filter(name => name !== 'mimetype')) {
    xmlParts.set(name, analyzeXml(await extract(bytes, byName.get(name)), name, budget, state))
  }
  const main = xmlParts.get(details.root)
  if (details.family === 'ooxml') {
    if (
      count(xmlParts.get('[Content_Types].xml'), 'Types') !== 1 ||
      count(xmlParts.get('_rels/.rels'), 'Relationships') !== 1
    ) {
      throw new TypeError(`${format} package metadata XML has an invalid root element`)
    }
  } else if (
    count(xmlParts.get('META-INF/manifest.xml'), 'manifest:manifest') !== 1 ||
    count(main, 'office:document-content') !== 1
  ) {
    throw new TypeError(`${format} OpenDocument XML has an invalid root element`)
  }
  const summary = { format, package: details.family, entries: zip.entries.length }
  const traits = [
    { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
    { id: 'content.metadata', parameters: { package: details.family } },
  ]

  if (format === 'docx') {
    if (count(main, 'w:document') !== 1)
      throw new TypeError('docx document part has no w:document root')
    Object.assign(summary, {
      paragraphs: count(main, 'w:p'),
      tables: count(main, 'w:tbl'),
      textRuns: count(main, 'w:t'),
    })
    traits.push(
      { id: 'content.text', parameters: { runs: summary.textRuns } },
      { id: 'document.flow', parameters: { paragraphs: summary.paragraphs } },
    )
  } else if (format === 'pptx') {
    if (count(main, 'p:presentation') !== 1) {
      throw new TypeError('pptx presentation part has no p:presentation root')
    }
    const slides = zip.entries.filter(entry =>
      /^ppt\/slides\/slide[1-9][0-9]*\.xml$/u.test(entry.name),
    )
    let shapes = 0
    let textRuns = 0
    for (const entry of slides) {
      const slide = analyzeXml(await extract(bytes, entry), entry.name, budget, state)
      if (count(slide, 'p:sld') !== 1) throw new TypeError(`${entry.name} has no p:sld root`)
      shapes += count(slide, 'p:sp')
      textRuns += count(slide, 'a:t')
    }
    Object.assign(summary, { slides: slides.length, shapes, textRuns })
    traits.push(
      { id: 'presentation.slides', parameters: { count: slides.length } },
      { id: 'content.text', parameters: { runs: textRuns } },
    )
  } else if (format === 'xlsx') {
    if (count(main, 'workbook') !== 1)
      throw new TypeError('xlsx workbook part has no workbook root')
    const sheets = count(main, 'sheet')
    const worksheets = zip.entries.filter(entry =>
      /^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/u.test(entry.name),
    )
    let rows = 0
    let cells = 0
    let formulas = 0
    for (const entry of worksheets) {
      const sheet = analyzeXml(await extract(bytes, entry), entry.name, budget, state)
      if (count(sheet, 'worksheet') !== 1) {
        throw new TypeError(`${entry.name} has no worksheet root`)
      }
      rows += count(sheet, 'row')
      cells += count(sheet, 'c')
      formulas += count(sheet, 'f')
    }
    Object.assign(summary, { sheets, worksheets: worksheets.length, rows, cells, formulas })
    traits.push(
      { id: 'table.sheets', parameters: { count: sheets } },
      { id: 'table.cells', parameters: { count: cells } },
      { id: 'table.formulas', parameters: { count: formulas } },
    )
  } else if (format === 'odt') {
    Object.assign(summary, { paragraphs: count(main, 'text:p'), headings: count(main, 'text:h') })
    traits.push(
      { id: 'content.text', parameters: { blocks: summary.paragraphs + summary.headings } },
      {
        id: 'document.flow',
        parameters: { paragraphs: summary.paragraphs, headings: summary.headings },
      },
    )
  } else if (format === 'odp') {
    Object.assign(summary, {
      slides: count(main, 'draw:page'),
      frames: count(main, 'draw:frame'),
      paragraphs: count(main, 'text:p'),
    })
    traits.push(
      { id: 'presentation.slides', parameters: { count: summary.slides } },
      { id: 'content.text', parameters: { paragraphs: summary.paragraphs } },
    )
  } else {
    Object.assign(summary, {
      sheets: count(main, 'table:table'),
      rows: count(main, 'table:table-row'),
      cells: count(main, 'table:table-cell'),
      formulas: (main.xml.match(/table:formula\s*=/gu) ?? []).length,
    })
    traits.push(
      { id: 'table.sheets', parameters: { count: summary.sheets } },
      { id: 'table.cells', parameters: { count: summary.cells } },
      { id: 'table.formulas', parameters: { count: summary.formulas } },
    )
  }

  return {
    summary,
    traits,
    decodedBytes: state.scalarBytes,
    root: {
      kind: 'package',
      label: details.label,
      preview: `${zip.entries.length} ZIP part(s)`,
      children: zip.entries.map(entry => ({
        kind: entry.name.endsWith('/') ? 'directory' : 'part',
        label: entry.name,
        preview: `${entry.uncompressedSize} bytes, method ${entry.method}`,
      })),
    },
  }
}

export function createOfficePackageCodec(format, context) {
  const details = FORMATS[format]
  if (details === undefined) throw new TypeError(`unknown office package format ${format}`)
  return createInspectionCodec(
    Object.freeze({
      id: details.id,
      format: Object.freeze({ id: format, label: details.label, mediaType: details.mediaType }),
      async detect(prefix) {
        const matched = prefix.byteLength >= 4 && u32(prefix, 0) === 0x04034b50
        return {
          confidence: matched ? 0.75 : 0,
          kind: 'magic',
          note: matched ? 'zip-package' : 'zip-signature-missing',
        }
      },
      async inspect(bytes, inspectionContext) {
        const result = await inspectPackage(format, bytes, inspectionContext.budget)
        return {
          summary: result.summary,
          metadata: [
            {
              id: `${format}-package`,
              label: details.label,
              entries: Object.entries(result.summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: result.traits,
          dataSources: { 'common.view/tree-data-source': createTreeDataSource(result.root) },
          maxDecodedBytes: result.decodedBytes,
          unsupportedFeatures: [
            'layout-rendering',
            'macro-and-script-execution',
            'external-resource-fetch',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
