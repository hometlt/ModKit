// Hand-ported structural inspection for SC2 DocumentHeader, DocumentInfo and .version sidecars.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { decodeStructuredText, parseXmlElements } from '../galaxy/codec.js'

const ID = 'org.modkitx/sc2-document-metadata'
const ascii = new TextDecoder('ascii', { fatal: false })

function asciiAt(bytes, offset, length) {
  return ascii.decode(bytes.subarray(offset, offset + length))
}

function metadataFormat(bytes) {
  if (bytes.byteLength >= 48 && asciiAt(bytes, 0, 4) === 'H2CS') return 'document-header'
  if (bytes.byteLength >= 12 && asciiAt(bytes, 0, 4) === 'cdes') {
    const formatVersion = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      8,
      true,
    )
    if ([36, 40, 44][formatVersion] === bytes.byteLength) return 'version-file'
  }
  const prefix = ascii.decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)))
  if (/^\s*(?:<\?xml\b[^>]*>\s*)?<DocInfo(?:\s|>)/u.test(prefix)) return 'document-info'
  return undefined
}

function parseDependencies(bytes, count) {
  const values = []
  let start = 0x30
  const limit = Math.min(bytes.byteLength, 0x30 + 2048)
  while (start < limit && values.length < count) {
    let end = start
    while (end < limit && bytes[end] !== 0) end += 1
    const value = asciiAt(bytes, start, end - start)
    if (value.length > 5 && /[:/\\]/u.test(value)) values.push(value)
    start = end + 1
  }
  return Object.freeze(values)
}

function textValues(text, section) {
  const block =
    new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)<\\/${section}\\s*>`, 'u').exec(text)?.[1] ?? ''
  return Object.freeze(
    [...block.matchAll(/<Value\b[^>]*>([\s\S]*?)<\/Value\s*>/gu)].map(match => match[1].trim()),
  )
}

function inspectDocumentHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dependencyCount = view.getUint32(0x2c, true)
  const dependencies = parseDependencies(bytes, dependencyCount)
  return Object.freeze({
    format: 'document-header',
    markerVersion: view.getUint32(0x04, true),
    gameSignature: view.getUint32(0x08, true),
    flags: view.getUint16(0x0c, true),
    headerSize: view.getUint16(0x0e, true),
    buildNumber: view.getUint32(0x10, true),
    artifactType: view.getUint32(0x18, true),
    declaredDependencies: dependencyCount,
    dependencies,
  })
}

function inspectVersion(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const formatVersion = view.getUint32(0x08, true)
  const result = {
    format: 'version-file',
    typeTag: asciiAt(bytes, 4, 4),
    formatVersion,
    buildNumber: view.getUint32(0x0c, true),
    majorVersion: view.getUint32(0x10, true),
    minorVersion: view.getUint32(0x14, true),
  }
  if (formatVersion > 0) result.patchVersion = view.getUint32(0x18, true)
  if (formatVersion === 2) result.buildNumber2 = view.getUint32(0x1c, true)
  result.entryCount =
    formatVersion === 0 ? 0 : view.getUint32(formatVersion === 1 ? 0x1c : 0x20, true)
  result.timestamp = view.getUint32(
    formatVersion === 0 ? 0x18 : formatVersion === 1 ? 0x20 : 0x24,
    true,
  )
  return Object.freeze(result)
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'sc2-document-metadata', label: 'StarCraft II Document Metadata' }),
  async detect(prefix) {
    const format = metadataFormat(prefix)
    return format === undefined
      ? { confidence: 0, kind: 'structure', note: 'sc2-document-metadata-signature-missing' }
      : { confidence: 0.995, kind: 'structure', note: format }
  },
  async inspect(bytes, context) {
    const format = metadataFormat(bytes)
    if (format === undefined) throw new TypeError('source is not supported SC2 document metadata')
    if (format === 'document-header') {
      const value = inspectDocumentHeader(bytes)
      return {
        summary: value,
        metadata: [
          {
            id: 'document-header',
            label: 'DocumentHeader',
            entries: Object.entries(value).map(([key, entry]) => ({ key, value: entry })),
          },
        ],
        traits: [
          { id: 'content.binary', parameters: { bytes: bytes.byteLength } },
          { id: 'content.metadata', parameters: { format } },
          { id: 'source.dependencies', parameters: { count: value.dependencies.length } },
        ],
        dataSources: {
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'document-header',
            label: 'DocumentHeader',
            preview: `${value.dependencies.length} dependency/dependencies`,
            children: value.dependencies.map(dependency => ({
              kind: 'dependency',
              label: dependency,
            })),
          }),
        },
        unsupportedFeatures: [
          'entry-record-decoding',
          'checksum-recomputation',
          'semantic-editing',
          'serialization',
        ],
      }
    }
    if (format === 'version-file') {
      const value = inspectVersion(bytes)
      return {
        summary: value,
        metadata: [
          {
            id: 'version-file',
            label: '.version sidecar',
            entries: Object.entries(value).map(([key, entry]) => ({ key, value: entry })),
          },
        ],
        traits: [
          { id: 'content.binary', parameters: { bytes: bytes.byteLength } },
          { id: 'content.metadata', parameters: { format, formatVersion: value.formatVersion } },
        ],
        dataSources: {
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'version-file',
            label: `${value.typeTag} version ${value.majorVersion}.${value.minorVersion}.${value.patchVersion ?? 0}`,
            preview: `build ${value.buildNumber}`,
          }),
        },
        unsupportedFeatures: ['component-type-resolution', 'semantic-editing', 'serialization'],
      }
    }
    const text = decodeStructuredText(bytes, context.budget, 'SC2 DocumentInfo')
    const elements = parseXmlElements(text, context.budget, 'DocInfo', 'SC2 DocumentInfo')
    const dependencies = textValues(text, 'Dependencies')
    const preloads = textValues(text, 'Preload')
    const sections = elements.filter(element => element.depth === 1).map(element => element.name)
    return {
      summary: {
        format: 'document-info',
        sections,
        dependencies,
        preloads,
        elements: elements.length,
      },
      metadata: [
        {
          id: 'document-info',
          label: 'DocumentInfo',
          entries: [
            { key: 'sections', value: sections },
            { key: 'dependencies', value: dependencies },
            { key: 'preloads', value: preloads },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'xml' } },
        { id: 'content.metadata', parameters: { format } },
        { id: 'source.dependencies', parameters: { count: dependencies.length } },
        { id: 'structure.hierarchy', parameters: { elements: elements.length } },
      ],
      text: true,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'document-info',
          label: 'DocumentInfo',
          preview: `${sections.length} section(s)`,
          children: sections.map(section => ({ kind: 'section', label: section })),
        }),
      },
      unsupportedFeatures: [
        'format-preserving-serialization',
        'dependency-editing',
        'source-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
