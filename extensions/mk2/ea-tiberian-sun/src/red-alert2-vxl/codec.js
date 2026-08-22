// Hand-ported structural VXL reader. It validates the section directory and tailers while keeping
// voxel meshing and HVA/PAL/VPL sidecar composition as explicit follow-up work.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/red-alert2-vxl'
const MAGIC = 'Voxel Animation'
const HEADER_BYTES = 802
const SECTION_HEADER_BYTES = 28
const SECTION_TAILER_BYTES = 92
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError('VXL string is outside the file')
  let result = ''
  for (let index = 0; index < length; index += 1) {
    const value = bytes[offset + index] ?? 0
    if (value === 0) break
    result += String.fromCharCode(value)
  }
  return result
}

function signature(bytes) {
  return ascii(bytes, 0, Math.min(16, bytes.byteLength)).startsWith(MAGIC)
}

function parse(bytes, budget) {
  if (!signature(bytes)) throw new TypeError('VXL magic is missing')
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('VXL header is truncated')
  const view = viewOf(bytes)
  const header = Object.freeze({
    fileType: ascii(bytes, 0, 16),
    palettes: view.getInt32(16, true),
    sections: view.getInt32(20, true),
    repeatedSections: view.getInt32(24, true),
    bodyBytes: view.getInt32(28, true),
    startPaletteRemap: bytes[32] ?? 0,
    endPaletteRemap: bytes[33] ?? 0,
  })
  if (header.sections <= 0 || header.sections > budget.maxNodes)
    throw new RangeError('VXL sections exceed maxNodes or are invalid')
  if (header.repeatedSections !== header.sections)
    throw new TypeError('VXL repeated section count does not match')
  if (header.bodyBytes < 0) throw new TypeError('VXL body size is negative')
  const sectionHeaders = HEADER_BYTES
  const bodyOffset = sectionHeaders + header.sections * SECTION_HEADER_BYTES
  const tailersOffset = bodyOffset + header.bodyBytes
  const expected = tailersOffset + header.sections * SECTION_TAILER_BYTES
  if (!Number.isSafeInteger(expected) || expected > bytes.byteLength)
    throw new TypeError('VXL section directory, body, or tailers are truncated')
  if (expected !== bytes.byteLength) throw new TypeError('VXL trailing data is not described by the header')
  const sections = []
  for (let index = 0; index < header.sections; index += 1) {
    const sectionOffset = sectionHeaders + index * SECTION_HEADER_BYTES
    const tailerOffset = tailersOffset + index * SECTION_TAILER_BYTES
    const dimensions = Object.freeze({
      x: bytes[tailerOffset + 88] ?? 0,
      y: bytes[tailerOffset + 89] ?? 0,
      z: bytes[tailerOffset + 90] ?? 0,
    })
    const min = Object.freeze([
      view.getFloat32(tailerOffset + 64, true),
      view.getFloat32(tailerOffset + 68, true),
      view.getFloat32(tailerOffset + 72, true),
    ])
    const max = Object.freeze([
      view.getFloat32(tailerOffset + 76, true),
      view.getFloat32(tailerOffset + 80, true),
      view.getFloat32(tailerOffset + 84, true),
    ])
    if (![...min, ...max].every(Number.isFinite)) throw new TypeError('VXL bounds contain non-finite values')
    const spanStart = view.getInt32(tailerOffset, true)
    const spanEnd = view.getInt32(tailerOffset + 4, true)
    const spanData = view.getInt32(tailerOffset + 8, true)
    if ([spanStart, spanEnd, spanData].some(value => value < 0 || value > header.bodyBytes))
      throw new RangeError('VXL section span offset is outside the body')
    sections.push(
      Object.freeze({
        id: String(index),
        name: ascii(bytes, sectionOffset, 16) || `Section_${index}`,
        number: view.getInt32(sectionOffset + 16, true),
        dimensions,
        min,
        max,
        normalsType: bytes[tailerOffset + 91] ?? 0,
        spanOffsets: Object.freeze({ start: spanStart, end: spanEnd, data: spanData }),
      }),
    )
  }
  return Object.freeze({ header, sections: Object.freeze(sections), bodyOffset, tailersOffset })
}

function modelSource(model) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: model.sections.length,
      meshes: 0,
      primitives: 0,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'metadata-only',
    },
    nodes: model.sections.map(section => ({
      id: section.id,
      name: section.name,
      childIds: [],
      meshIds: [],
      transform: IDENTITY,
    })),
    meshes: [],
    primitives: [],
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'red-alert2-vxl', label: 'Red Alert 2 VXL voxel model' }),
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'Voxel Animation header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parse(bytes, context.budget)
    return {
      summary: {
        format: 'red-alert2-vxl',
        fileType: model.header.fileType,
        palettes: model.header.palettes,
        sections: model.sections,
        bodyBytes: model.header.bodyBytes,
        paletteRemap: [model.header.startPaletteRemap, model.header.endPaletteRemap],
        geometryAccess: 'metadata-only',
      },
      metadata: [
        {
          id: 'red-alert2-vxl',
          label: 'Westwood voxel model',
          entries: [
            { key: 'sections', value: model.sections.length },
            { key: 'bodyBytes', value: model.header.bodyBytes },
            { key: 'palettes', value: model.header.palettes },
            { key: 'geometryAccess', value: 'metadata-only' },
          ],
        },
      ],
      traits: [
        { id: 'model.geometry', parameters: { sections: model.sections.length, decoded: false } },
        { id: 'structure.hierarchy', parameters: { nodes: model.sections.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(model),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Red Alert 2 VXL',
          preview: `${model.sections.length} sections`,
          children: model.sections.map(section => ({
            kind: 'section',
            label: section.name,
            preview: `${section.dimensions.x}×${section.dimensions.y}×${section.dimensions.z}, normals ${section.normalsType}`,
          })),
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'voxel-span-decoding-and-meshing',
        'hva-animation-sidecar-resolution',
        'pal-and-vpl-lighting-sidecar-resolution',
        'voxel-model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
