// Hand-ported structural Emperor XBF reader. It validates the v1 container, preserves the FX
// and texture-name planes, and exposes a model surface without claiming node/geometry decoding.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/emperor-xbf'
const VERSION = 1
const HEADER_BYTES = 8
const END_MARKER = -1
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function checkedRange(total, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > total ||
    length > total - offset
  ) {
    throw new RangeError(`XBF ${label} is outside the source`)
  }
}

function parseTextures(bytes) {
  const textures = []
  let start = 0
  for (let offset = 0; offset <= bytes.byteLength; offset += 1) {
    if (offset < bytes.byteLength && bytes[offset] !== 0) continue
    if (offset > start) {
      const value = new TextDecoder('windows-1252').decode(bytes.subarray(start, offset)).trim()
      if (value.length > 0) textures.push(value)
    }
    start = offset + 1
  }
  return Object.freeze(textures)
}

function parseXbf(bytes, budget) {
  if (bytes.byteLength < HEADER_BYTES + 4) throw new TypeError('XBF header is truncated')
  const view = dataView(bytes)
  const version = view.getInt32(0, true)
  if (version !== VERSION) throw new TypeError(`unsupported XBF version ${version}`)
  const fxDataSize = view.getInt32(4, true)
  if (fxDataSize < 0 || fxDataSize > budget.maxScalarBytes) {
    throw new RangeError('XBF FX data exceeds maxScalarBytes')
  }
  checkedRange(bytes.byteLength, HEADER_BYTES, fxDataSize, 'FX data')
  const fxOffset = HEADER_BYTES
  const textureSizeOffset = fxOffset + fxDataSize
  checkedRange(bytes.byteLength, textureSizeOffset, 4, 'texture table size')
  const textureDataSize = view.getUint32(textureSizeOffset, true)
  if (textureDataSize > budget.maxScalarBytes) {
    throw new RangeError('XBF texture table exceeds maxScalarBytes')
  }
  const textureOffset = textureSizeOffset + 4
  checkedRange(bytes.byteLength, textureOffset, textureDataSize, 'texture table')
  const textures = parseTextures(bytes.subarray(textureOffset, textureOffset + textureDataSize))
  if (textures.length > budget.maxNodes) throw new RangeError('XBF textures exceed maxNodes')
  const contentOffset = textureOffset + textureDataSize
  const hasEndMarker =
    contentOffset + 4 <= bytes.byteLength && view.getInt32(contentOffset, true) === END_MARKER
  const nodeBytes = bytes.byteLength - contentOffset - (hasEndMarker ? 4 : 0)
  if (nodeBytes < 0) throw new RangeError('XBF content range is invalid')
  return Object.freeze({
    version,
    fxDataSize,
    textureDataSize,
    textures,
    contentOffset,
    hasEndMarker,
    nodeBytes,
  })
}

function structurallyValid(prefix) {
  if (prefix.byteLength < HEADER_BYTES + 4) return false
  const view = dataView(prefix)
  if (view.getInt32(0, true) !== VERSION) return false
  const fxDataSize = view.getInt32(4, true)
  if (fxDataSize < 0 || fxDataSize > prefix.byteLength - HEADER_BYTES) return false
  const textureSizeOffset = HEADER_BYTES + fxDataSize
  if (textureSizeOffset + 4 > prefix.byteLength) return false
  const textureDataSize = view.getUint32(textureSizeOffset, true)
  return textureDataSize <= prefix.byteLength - textureSizeOffset - 4
}

function modelSource(parsed) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 0,
      primitives: 0,
      materials: 0,
      textures: parsed.textures.length,
      animations: 0,
      geometryAccess: 'metadata-only',
    },
    nodes: [
      {
        id: 'xbf-root',
        name: 'Emperor XBF structural root',
        childIds: [],
        meshIds: [],
        transform: IDENTITY,
      },
    ],
    meshes: [],
    primitives: [],
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'emperor-xbf', label: 'Emperor: Battle for Dune XBF model' }),
  async detect(prefix) {
    return structurallyValid(prefix)
      ? { confidence: 0.995, kind: 'structure', note: 'XBF v1 bounded header' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parseXbf(bytes, context.budget)
    return {
      summary: {
        format: 'emperor-xbf',
        version: parsed.version,
        fxDataBytes: parsed.fxDataSize,
        textureTableBytes: parsed.textureDataSize,
        textures: parsed.textures,
        hasEndMarker: parsed.hasEndMarker,
        undecodedNodeBytes: parsed.nodeBytes,
        geometryAccess: 'metadata-only',
      },
      metadata: [
        {
          id: 'emperor-xbf-model',
          label: 'Emperor XBF model',
          entries: [
            { key: 'version', value: parsed.version },
            { key: 'fxDataBytes', value: parsed.fxDataSize },
            { key: 'textureTableBytes', value: parsed.textureDataSize },
            { key: 'textures', value: parsed.textures.length },
            { key: 'hasEndMarker', value: parsed.hasEndMarker },
            { key: 'undecodedNodeBytes', value: parsed.nodeBytes },
            { key: 'geometryAccess', value: 'metadata-only' },
          ],
        },
      ],
      traits: [
        { id: 'model.geometry', parameters: { meshes: 0, primitives: 0 } },
        { id: 'model.textures', parameters: { count: parsed.textures.length } },
        { id: 'structure.hierarchy', parameters: { nodes: 1 } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(parsed),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Emperor XBF',
          preview: `${parsed.textures.length} texture references, ${parsed.nodeBytes} undecoded node bytes`,
          children: [
            {
              kind: 'section',
              label: 'FX data',
              preview: `${parsed.fxDataSize} bytes`,
            },
            {
              kind: 'section',
              label: 'Textures',
              preview: `${parsed.textures.length} references`,
              children: parsed.textures.map(texture => ({
                kind: 'texture',
                label: texture,
                preview: 'external texture reference',
              })),
            },
            {
              kind: 'section',
              label: 'Scene nodes',
              preview:
                parsed.nodeBytes === 0
                  ? 'empty scene'
                  : `${parsed.nodeBytes} bytes; geometry decoding not implemented`,
            },
          ],
        }),
      },
      maxDecodedBytes: BigInt(parsed.fxDataSize + parsed.textureDataSize),
      unsupportedFeatures: [
        'xbf-node-decoding',
        'geometry-decoding',
        'skeletal-animation-decoding',
        'fx-runtime-execution',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
