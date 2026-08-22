import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { analyzeXml, extractZipEntry, parseZip } from '../docx/office-package.js'

const CFB_MAGIC = Object.freeze([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const FREESECT = 0xffffffff
const FATSECT = 0xfffffffd
const ENDOFCHAIN = 0xfffffffe
const utf16 = new TextDecoder('utf-16le', { fatal: true })

const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const u16 = (bytes, offset) => view(bytes).getUint16(offset, true)
const u32 = (bytes, offset) => view(bytes).getUint32(offset, true)
const matches = (bytes, signature) => signature.every((value, index) => bytes[index] === value)

function sectorOffset(sector, sectorSize, sectorCount, label) {
  if (!Number.isSafeInteger(sector) || sector < 0 || sector >= sectorCount) {
    throw new TypeError(`Visio CFB ${label} sector is outside the file`)
  }
  return 512 + sector * sectorSize
}

function parseDirectoryEntry(bytes, offset, majorVersion) {
  const nameBytes = u16(bytes, offset + 64)
  const type = bytes[offset + 66]
  if (type === 0) {
    if (nameBytes !== 0) throw new TypeError('Visio CFB empty directory entry has a name')
    return undefined
  }
  if (nameBytes < 2 || nameBytes > 64 || nameBytes % 2 !== 0) {
    throw new TypeError('Visio CFB directory name length is invalid')
  }
  let name
  try {
    name = utf16.decode(bytes.subarray(offset, offset + nameBytes - 2))
  } catch {
    throw new TypeError('Visio CFB directory name is invalid UTF-16LE')
  }
  if (u16(bytes, offset + nameBytes - 2) !== 0) {
    throw new TypeError('Visio CFB directory name is not NUL terminated')
  }
  if (![1, 2, 5].includes(type) || ![0, 1].includes(bytes[offset + 67])) {
    throw new TypeError('Visio CFB directory entry type or color is invalid')
  }
  const sizeLow = u32(bytes, offset + 120)
  const sizeHigh = u32(bytes, offset + 124)
  if (majorVersion === 3 && sizeHigh !== 0) {
    throw new TypeError('Visio CFB version 3 stream size exceeds 32 bits')
  }
  const size = BigInt(sizeLow) | (BigInt(sizeHigh) << 32n)
  return {
    name,
    type,
    left: u32(bytes, offset + 68),
    right: u32(bytes, offset + 72),
    child: u32(bytes, offset + 76),
    startSector: u32(bytes, offset + 116),
    size,
  }
}

function parseCompoundVisio(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('Visio CFB exceeds maxDepth budget')
  if (bytes.byteLength < 1536 || !matches(bytes, CFB_MAGIC)) {
    throw new TypeError('Visio CFB header is missing or the file is too small')
  }
  if (bytes.subarray(8, 24).some(value => value !== 0)) {
    throw new TypeError('Visio CFB header CLSID must be zero')
  }
  const minorVersion = u16(bytes, 24)
  const majorVersion = u16(bytes, 26)
  const byteOrder = u16(bytes, 28)
  const sectorShift = u16(bytes, 30)
  const miniSectorShift = u16(bytes, 32)
  if (
    minorVersion !== 0x003e ||
    majorVersion !== 3 ||
    byteOrder !== 0xfffe ||
    sectorShift !== 9 ||
    miniSectorShift !== 6
  ) {
    throw new TypeError('Visio CFB version, byte order, or sector shift is invalid')
  }
  if (bytes.subarray(34, 40).some(value => value !== 0) || u32(bytes, 56) !== 4096) {
    throw new TypeError('Visio CFB reserved bytes or mini-stream cutoff is invalid')
  }
  const sectorSize = 1 << sectorShift
  if ((bytes.byteLength - 512) % sectorSize !== 0) {
    throw new TypeError('Visio CFB file length is not sector aligned')
  }
  const sectorCount = (bytes.byteLength - 512) / sectorSize
  const fatSectors = u32(bytes, 44)
  const firstDirectorySector = u32(bytes, 48)
  const firstMiniFatSector = u32(bytes, 60)
  const miniFatSectors = u32(bytes, 64)
  const firstDifatSector = u32(bytes, 68)
  const difatSectors = u32(bytes, 72)
  if (majorVersion === 3 && u32(bytes, 40) !== 0) {
    throw new TypeError('Visio CFB version 3 cannot declare directory-sector count')
  }
  if (
    fatSectors === 0 ||
    fatSectors > 109 ||
    difatSectors !== 0 ||
    firstDifatSector !== ENDOFCHAIN
  ) {
    throw new TypeError('Visio CFB FAT or DIFAT layout is outside the supported subset')
  }
  if (miniFatSectors === 0 ? firstMiniFatSector !== ENDOFCHAIN : true) {
    throw new TypeError('Visio CFB mini FAT is outside the supported subset')
  }
  if (fatSectors + sectorCount > budget.maxNodes) {
    throw new RangeError('Visio CFB sectors exceed maxNodes budget')
  }

  const fatSectorIds = []
  for (let index = 0; index < 109; index += 1) {
    const id = u32(bytes, 76 + index * 4)
    if (index < fatSectors) fatSectorIds.push(id)
    else if (id !== FREESECT) throw new TypeError('Visio CFB unused DIFAT entry is not FREESECT')
  }
  if (new Set(fatSectorIds).size !== fatSectorIds.length) {
    throw new TypeError('Visio CFB repeats a FAT sector')
  }
  const fat = []
  for (const id of fatSectorIds) {
    const offset = sectorOffset(id, sectorSize, sectorCount, 'FAT')
    for (let cursor = offset; cursor < offset + sectorSize; cursor += 4)
      fat.push(u32(bytes, cursor))
  }
  for (const id of fatSectorIds) {
    if (fat[id] !== FATSECT) throw new TypeError('Visio CFB FAT sector is not marked FATSECT')
  }

  const directorySectors = []
  const visited = new Set()
  let directorySector = firstDirectorySector
  while (directorySector !== ENDOFCHAIN) {
    if (visited.has(directorySector)) throw new TypeError('Visio CFB directory chain has a cycle')
    if (directorySectors.length >= budget.maxNodes) {
      throw new RangeError('Visio CFB directory chain exceeds maxNodes budget')
    }
    visited.add(directorySector)
    directorySectors.push(directorySector)
    sectorOffset(directorySector, sectorSize, sectorCount, 'directory')
    directorySector = fat[directorySector]
    if (
      directorySector === undefined ||
      directorySector === FREESECT ||
      directorySector === FATSECT
    ) {
      throw new TypeError('Visio CFB directory chain uses an invalid FAT marker')
    }
  }
  const entries = []
  for (const id of directorySectors) {
    const start = sectorOffset(id, sectorSize, sectorCount, 'directory')
    for (let offset = start; offset < start + sectorSize; offset += 128) {
      const entry = parseDirectoryEntry(bytes, offset, majorVersion)
      if (entry !== undefined) entries.push(entry)
      if (entries.length > budget.maxNodes) {
        throw new RangeError('Visio CFB directory entries exceed maxNodes budget')
      }
    }
  }
  if (entries[0]?.type !== 5 || entries[0]?.name !== 'Root Entry') {
    throw new TypeError('Visio CFB Root Entry is missing')
  }
  if (!entries.some(entry => entry.type === 2 && entry.name === 'VisioDocument')) {
    throw new TypeError('Visio CFB has no VisioDocument stream')
  }
  const scalarBytes = entries.reduce((total, entry) => total + entry.name.length * 2 + 96, 0)
  if (scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('Visio CFB metadata exceeds maxScalarBytes budget')
  }
  const summary = {
    format: 'visio',
    variant: 'vsd-cfb',
    cfbVersion: `${majorVersion}.${minorVersion}`,
    sectorSize,
    sectors: sectorCount,
    directoryEntries: entries.length,
    streams: entries.filter(entry => entry.type === 2).length,
    storages: entries.filter(entry => entry.type === 1).length,
  }
  return {
    summary,
    decodedBytes: scalarBytes,
    root: {
      kind: 'compound-file',
      label: 'Legacy Visio VSD',
      preview: `${entries.length} CFB directory entries`,
      children: entries.map(entry => ({
        kind: entry.type === 2 ? 'stream' : entry.type === 1 ? 'storage' : 'root-storage',
        label: entry.name,
        preview: `${entry.size} bytes`,
      })),
    },
  }
}

const count = (document, tag) => document.tags.get(tag) ?? 0

async function parseVsdx(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('Visio VSDX exceeds maxDepth budget')
  const zip = parseZip(bytes, budget)
  const byName = new Map(zip.entries.map(entry => [entry.name, entry]))
  const required = [
    '[Content_Types].xml',
    '_rels/.rels',
    'visio/document.xml',
    'visio/pages/pages.xml',
  ]
  for (const name of required) {
    if (!byName.has(name)) throw new TypeError(`Visio VSDX is missing required part ${name}`)
  }
  const state = { nodes: zip.entries.length, scalarBytes: zip.scalarBytes }
  const documents = new Map()
  for (const name of required) {
    documents.set(
      name,
      analyzeXml(await extractZipEntry(bytes, byName.get(name)), name, budget, state),
    )
  }
  if (
    count(documents.get('[Content_Types].xml'), 'Types') !== 1 ||
    !documents
      .get('[Content_Types].xml')
      .xml.includes('application/vnd.ms-visio.drawing.main+xml') ||
    count(documents.get('_rels/.rels'), 'Relationships') !== 1 ||
    !documents.get('_rels/.rels').xml.includes('visio/document.xml') ||
    count(documents.get('visio/document.xml'), 'VisioDocument') !== 1 ||
    count(documents.get('visio/pages/pages.xml'), 'Pages') !== 1
  ) {
    throw new TypeError('Visio VSDX package metadata or root element is invalid')
  }
  const pageEntries = zip.entries
    .filter(entry => /^visio\/pages\/page[1-9][0-9]*\.xml$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
  if (pageEntries.length === 0) throw new TypeError('Visio VSDX contains no page parts')
  const pages = []
  let shapes = 0
  let textElements = 0
  let connects = 0
  for (const entry of pageEntries) {
    const document = analyzeXml(await extractZipEntry(bytes, entry), entry.name, budget, state)
    if (count(document, 'PageContents') !== 1) {
      throw new TypeError(`Visio VSDX page ${entry.name} has no PageContents root`)
    }
    const pageShapes = count(document, 'Shape')
    const pageText = count(document, 'Text')
    const pageConnects = count(document, 'Connect')
    shapes += pageShapes
    textElements += pageText
    connects += pageConnects
    pages.push({
      name: entry.name,
      shapes: pageShapes,
      textElements: pageText,
      connects: pageConnects,
    })
  }
  if (count(documents.get('visio/pages/pages.xml'), 'Page') !== pages.length) {
    throw new TypeError('Visio VSDX page inventory disagrees with page parts')
  }
  const summary = {
    format: 'visio',
    variant: 'vsdx-opc',
    entries: zip.entries.length,
    pages: pages.length,
    shapes,
    textElements,
    connects,
  }
  return {
    summary,
    decodedBytes: state.scalarBytes,
    root: {
      kind: 'package',
      label: 'Visio VSDX',
      preview: `${pages.length} page(s), ${shapes} shape(s)`,
      children: pages.map(page => ({
        kind: 'page',
        label: page.name,
        preview: `${page.shapes} shape(s), ${page.connects} connector(s)`,
      })),
    },
  }
}

function isZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export function createVisioCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: 'org.modkitx/visio',
      format: Object.freeze({
        id: 'visio',
        label: 'Microsoft Visio document',
        mediaType: 'application/vnd.visio',
      }),
      async detect(prefix) {
        const cfb = matches(prefix, CFB_MAGIC)
        const zip = isZip(prefix)
        return {
          confidence: cfb ? 0.995 : zip ? 0.75 : 0,
          kind: 'magic',
          note: cfb ? 'cfb-compound-file' : zip ? 'opc-zip-package' : 'visio-container-missing',
        }
      },
      async inspect(bytes, inspectionContext) {
        const parsed = matches(bytes, CFB_MAGIC)
          ? parseCompoundVisio(bytes, inspectionContext.budget)
          : await parseVsdx(bytes, inspectionContext.budget)
        return {
          summary: parsed.summary,
          metadata: [
            {
              id: 'visio-document',
              label: 'Microsoft Visio document',
              entries: Object.entries(parsed.summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
            { id: 'content.metadata', parameters: { variant: parsed.summary.variant } },
            {
              id: 'structure.nodes',
              parameters: {
                nodes: parsed.summary.shapes ?? parsed.summary.directoryEntries,
                pages: parsed.summary.pages ?? 0,
              },
            },
          ],
          dataSources: { 'common.view/tree-data-source': createTreeDataSource(parsed.root) },
          maxDecodedBytes: parsed.decodedBytes,
          unsupportedFeatures: [
            'legacy-vsd-stream-decoding',
            'layout-rendering',
            'masters-styles-and-geometry-resolution',
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
