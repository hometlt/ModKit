// Hand-ported from the MK2 Basis Universal codec. The dependency-free MK3 slice validates the
// container header and slice table; BasisU transcoding is intentionally not claimed.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/basis'
const HEADER_BYTES = 77
const SLICE_BYTES = 23

function hasMagic(bytes) {
  return bytes.byteLength >= 2 && bytes[0] === 0x73 && bytes[1] === 0x42
}

function u24le(bytes, offset) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function textureFormat(value) {
  return value === 0 ? 'ETC1S' : value === 1 ? 'UASTC 4x4' : `unknown-${value}`
}

function textureType(value) {
  return ['2D', '2D array', 'cubemap array', 'video frames', 'volume'][value] ?? `unknown-${value}`
}

function flagNames(flags) {
  const names = []
  if ((flags & 1) !== 0) names.push('ETC1S')
  if ((flags & 2) !== 0) names.push('Y-flipped')
  if ((flags & 4) !== 0) names.push('alpha-slices')
  return names
}

function parseHeader(bytes) {
  if (!hasMagic(bytes) || bytes.byteLength < HEADER_BYTES) {
    throw new TypeError('Basis Universal header is missing or truncated')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const info = {
    version: view.getUint16(2, true),
    headerSize: view.getUint16(4, true),
    dataSize: view.getUint32(8, true),
    totalSlices: u24le(bytes, 14),
    totalImages: u24le(bytes, 17),
    texFormat: bytes[20] ?? 0,
    flags: view.getUint16(21, true),
    texType: bytes[23] ?? 0,
    microsecondsPerFrame: u24le(bytes, 24),
    sliceDescOffset: view.getUint32(65, true),
    extendedOffset: view.getUint32(69, true),
    extendedSize: view.getUint32(73, true),
  }
  if (info.headerSize < HEADER_BYTES || info.headerSize > bytes.byteLength) {
    throw new TypeError('Basis Universal headerSize is invalid')
  }
  if (info.totalImages === 0 || info.totalSlices === 0) {
    throw new TypeError('Basis Universal container declares no images or slices')
  }
  return Object.freeze(info)
}

function parseSlices(bytes, header, maxNodes) {
  if (header.totalSlices > maxNodes) throw new RangeError('Basis slices exceed maxNodes')
  const tableBytes = header.totalSlices * SLICE_BYTES
  if (!Number.isSafeInteger(tableBytes) || header.sliceDescOffset + tableBytes > bytes.byteLength) {
    throw new TypeError('Basis slice descriptor table is truncated')
  }
  const slices = []
  for (let index = 0; index < header.totalSlices; index += 1) {
    const offset = header.sliceDescOffset + index * SLICE_BYTES
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, SLICE_BYTES)
    const slice = Object.freeze({
      imageIndex: u24le(bytes, offset),
      levelIndex: bytes[offset + 3] ?? 0,
      flags: bytes[offset + 4] ?? 0,
      width: view.getUint16(5, true),
      height: view.getUint16(7, true),
      blocksX: view.getUint16(9, true),
      blocksY: view.getUint16(11, true),
      fileOffset: view.getUint32(13, true),
      fileSize: view.getUint32(17, true),
    })
    if (slice.width === 0 || slice.height === 0 || slice.blocksX === 0 || slice.blocksY === 0) {
      throw new TypeError(`Basis slice ${index} has invalid dimensions`)
    }
    if (
      !Number.isSafeInteger(slice.fileOffset + slice.fileSize) ||
      slice.fileOffset + slice.fileSize > bytes.byteLength
    ) {
      throw new TypeError(`Basis slice ${index} payload is outside the file`)
    }
    slices.push(slice)
  }
  return Object.freeze(slices)
}

function parseBasis(bytes, maxNodes) {
  const header = parseHeader(bytes)
  const slices = parseSlices(bytes, header, maxNodes)
  const top = slices.find(slice => slice.levelIndex === 0) ?? slices[0]
  if (top === undefined) throw new TypeError('Basis Universal container has no top-level slice')
  return Object.freeze({ header, slices, top })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'basis', label: 'Basis Universal Texture' }),
  async detect(prefix) {
    if (!hasMagic(prefix)) return { confidence: 0, kind: 'magic', note: 'basis-magic-mismatch' }
    try {
      parseHeader(prefix)
      return { confidence: 0.97, kind: 'structure', note: 'basis-universal-header' }
    } catch {
      return { confidence: 0.4, kind: 'magic', note: 'basis-header-invalid' }
    }
  },
  async inspect(bytes, context) {
    const info = parseBasis(bytes, context.budget.maxNodes)
    const flags = flagNames(info.header.flags)
    const mipLevels = new Set(
      info.slices
        .filter(slice => slice.imageIndex === info.top.imageIndex)
        .map(slice => slice.levelIndex),
    ).size
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'Basis Universal',
      preview: `${info.top.width} × ${info.top.height}, ${textureFormat(info.header.texFormat)}`,
      children: [
        {
          kind: 'header',
          label: 'Header',
          preview: `${info.header.headerSize} bytes, version 0x${info.header.version.toString(16)}`,
        },
        ...info.slices.map((slice, index) => ({
          kind: 'slice',
          label: `Slice ${index}`,
          preview: `image ${slice.imageIndex}, mip ${slice.levelIndex}, ${slice.width} × ${slice.height}, ${slice.fileSize} bytes`,
        })),
      ],
    })
    return {
      summary: {
        format: 'basis',
        encoding: textureFormat(info.header.texFormat),
        textureType: textureType(info.header.texType),
        width: info.top.width,
        height: info.top.height,
        images: info.header.totalImages,
        slices: info.header.totalSlices,
        mipLevels,
        flags,
      },
      metadata: [
        {
          id: 'basis-texture',
          label: 'Basis Universal texture',
          entries: [
            { key: 'version', value: `0x${info.header.version.toString(16)}` },
            { key: 'headerSize', value: info.header.headerSize },
            { key: 'dataSize', value: info.header.dataSize },
            { key: 'encoding', value: textureFormat(info.header.texFormat) },
            { key: 'textureType', value: textureType(info.header.texType) },
            { key: 'width', value: info.top.width },
            { key: 'height', value: info.top.height },
            { key: 'images', value: info.header.totalImages },
            { key: 'slices', value: info.header.totalSlices },
            { key: 'mipLevels', value: mipLevels },
            { key: 'flags', value: flags.join(', ') || 'none' },
            { key: 'microsecondsPerFrame', value: info.header.microsecondsPerFrame },
            { key: 'extendedBytes', value: info.header.extendedSize },
          ],
        },
      ],
      traits: [
        {
          id: 'image.compressed-blocks',
          parameters: { format: textureFormat(info.header.texFormat), blocks: 'basis-universal' },
        },
        {
          id: 'image.raster',
          parameters: { width: info.top.width, height: info.top.height, decoded: false },
        },
        ...(mipLevels > 1 ? [{ id: 'image.mipmaps', parameters: { levels: mipLevels } }] : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: { 'common.view/tree-data-source': tree },
      unsupportedFeatures: [
        'basisu-transcoding',
        'gpu-block-selection',
        'hdr-transcoding',
        'pixel-editing',
        'basis-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
