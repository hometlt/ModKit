import { M3StructureDescription, M3StructureHistory } from './structures.js'
import { M3FieldBytes } from './fields.js'
import { loadM3StructuresXml } from './parser.js'
import { getConfig } from '../config.js'
import { getFs, getPath, getDirname } from '../platform.js'
export class M3Section {
  desc
  indexEntry
  references
  content
  rawBytes
  model
  constructor(desc, indexEntry, references, content, rawBytes = null) {
    this.desc = desc
    this.indexEntry = indexEntry
    this.references = references
    this.content = content
    this.rawBytes = rawBytes
    this.model = null
  }
  getSectionByReference(reference) {
    if (!reference) return null
    const index = reference.index
    const entries = reference.entries
    if (typeof index !== 'number' || !entries) return null
    return this[index] || null
  }
}
export class M3SectionList extends Array {
  fileBuffer = null
  /** Exact schema text used for this parse, retained for deterministic snapshots. */
  structuresXmlSource = null
  /** Parse-local schema registry; do not consult the mutable compatibility registry. */
  structureHistories = {}
  mdVersion = 34
  model = null
  static async load(arrayBuffer, xmlPathOrText) {
    const config = getConfig()
    let xmlText
    if (xmlPathOrText) {
      if (xmlPathOrText.trimStart().startsWith('<')) {
        xmlText = xmlPathOrText
      } else if (config.isNode) {
        xmlText = getFs().readFileSync(xmlPathOrText, 'utf8')
      } else {
        const response = await fetch(xmlPathOrText)
        if (!response.ok) throw new Error(`Failed to fetch structures.xml from ${xmlPathOrText}`)
        xmlText = await response.text()
      }
    } else if (config.isNode) {
      xmlText = getFs().readFileSync(getPath().join(getDirname(), './structures.xml'), 'utf8')
    } else if (config.embeddedStructuresXml) {
      xmlText = config.embeddedStructuresXml
    } else {
      throw new Error(
        'No structures.xml source provided. Set embeddedStructuresXml or pass xmlPathOrText.',
      )
    }
    // Keep this locally returned registry. Another parse can legitimately load a
    // different schema while this async call is yielding and replace the legacy
    // global registry used by getStructures().
    const structs = await loadM3StructuresXml(xmlText)
    if (arrayBuffer.byteLength < 4) {
      throw new Error(
        `Invalid M3 header: expected at least 4 bytes, got ${arrayBuffer.byteLength}.`,
      )
    }
    const list = new M3SectionList()
    list.fileBuffer = arrayBuffer
    list.structuresXmlSource = xmlText
    list.structureHistories = structs
    const tagValue = new DataView(arrayBuffer, 0, 4).getUint32(0, true)
    const mdTag = bytesToTag(tagValue)
    list.mdVersion = parseInt(mdTag.slice(2), 10)
    const headerHistory = structs[mdTag]
    if (!headerHistory || !Number.isInteger(list.mdVersion)) {
      throw new Error(`Invalid M3 header: unsupported tag "${mdTag}".`)
    }
    const headerDesc = headerHistory.getVersion(11, list.mdVersion, structs)
    if (arrayBuffer.byteLength < headerDesc.size) {
      throw new Error(
        `Invalid M3 header: expected at least ${headerDesc.size} bytes, got ${arrayBuffer.byteLength}.`,
      )
    }
    const header = headerDesc.instance(arrayBuffer, 0)
    const indexOffset = header.index_offset ?? 0
    const indexSize = header.index_size ?? 0
    const indexDesc = structs['MDIndexEntry'].getVersion(list.mdVersion, list.mdVersion, structs)
    const indexByteLength = indexSize * indexDesc.size
    if (
      !Number.isSafeInteger(indexOffset) ||
      !Number.isSafeInteger(indexSize) ||
      indexOffset < 0 ||
      indexSize < 0 ||
      indexOffset > arrayBuffer.byteLength ||
      indexByteLength > arrayBuffer.byteLength - indexOffset
    ) {
      throw new Error(
        `Invalid M3 section index: offset ${indexOffset}, entries ${indexSize}, file size ${arrayBuffer.byteLength}.`,
      )
    }
    const indexEntries = []
    for (let i = 0; i < indexSize; i += 1) {
      const entryOffset = indexOffset + i * indexDesc.size
      indexEntries.push(indexDesc.instance(arrayBuffer, entryOffset))
    }
    for (const entry of indexEntries) {
      const tagStr = bytesToTag(entry.tag ?? 0)
      const sectionOffset = entry.offset ?? 0
      const repetitions = entry.repetitions ?? 0
      const knownStructure = structs[tagStr]
      const sectionDesc =
        knownStructure?.getVersion(entry.version ?? 0, list.mdVersion, structs) ??
        createUnknownSectionDescription(
          tagStr,
          entry.version ?? 0,
          inferSectionByteLength(indexEntries, sectionOffset, arrayBuffer.byteLength, indexOffset),
        )
      const sectionSize = knownStructure ? sectionDesc.size * repetitions : sectionDesc.size
      const sectionBuffer = arrayBuffer.slice(sectionOffset, sectionOffset + sectionSize)
      const sectionContent = sectionDesc.instances(
        sectionBuffer,
        knownStructure ? repetitions : sectionSize > 0 ? 1 : 0,
      )
      list.push(new M3Section(sectionDesc, entry, [], sectionContent, sectionBuffer))
    }
    const headerSection = list[0]
    if (!headerSection?.content[0]) {
      throw new Error('Invalid M3 section index: missing header section.')
    }
    const modelRef = headerSection.content[0].model
    list.model = list.getSectionByReference(modelRef)?.content[0] ?? null
    return list
  }
  getSectionByReference(reference) {
    if (!reference) return null
    const index = reference.index
    const entries = reference.entries
    if (typeof index !== 'number' || !entries) return null
    return this[index] || null
  }
  getSectionsByTag(tag) {
    return this.filter(section => section.desc.history.name === tag)
  }
}
function createUnknownSectionDescription(tag, version, byteLength) {
  const history = new M3StructureHistory(tag || 'UNKN', new Map(), [])
  const fields = {
    raw: new M3FieldBytes('raw', byteLength, new Uint8Array(byteLength)),
  }
  return new M3StructureDescription(history, version, fields, byteLength)
}
function inferSectionByteLength(entries, offset, fileLength, indexOffset) {
  let end = indexOffset > offset ? indexOffset : fileLength
  for (const entry of entries) {
    const candidate = entry.offset ?? 0
    if (candidate > offset && candidate < end) end = candidate
  }
  return Math.max(0, end - offset)
}
function bytesToTag(tagValue) {
  const bytes = [
    tagValue & 0xff,
    (tagValue >> 8) & 0xff,
    (tagValue >> 16) & 0xff,
    (tagValue >> 24) & 0xff,
  ]
  return String.fromCharCode(...bytes)
    .replace(/\0/g, '')
    .split('')
    .reverse()
    .join('')
}
