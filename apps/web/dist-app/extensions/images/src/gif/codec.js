import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'

const ID = 'modkit/gif'
const ascii = new TextDecoder('latin1')

function isGifPrefix(bytes) {
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
}

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('GIF field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function skipSubBlocks(bytes, start, state) {
  let offset = start
  let payloadBytes = 0
  while (true) {
    if (state.nodes >= state.maxNodes)
      throw new RangeError('GIF block count exceeds maxNodes budget')
    state.nodes += 1
    if (offset >= bytes.byteLength) throw new TypeError('GIF data sub-block is truncated')
    const length = bytes[offset] ?? 0
    offset += 1
    if (length === 0) return Object.freeze({ offset, payloadBytes })
    if (offset + length > bytes.byteLength)
      throw new TypeError('GIF data sub-block payload is truncated')
    payloadBytes += length
    offset += length
  }
}

function parseGif(bytes, maxNodes) {
  if (bytes.byteLength < 13 || !isGifPrefix(bytes)) throw new TypeError('GIF header is invalid')
  const version = ascii.decode(bytes.subarray(0, 6))
  if (version !== 'GIF87a' && version !== 'GIF89a') throw new TypeError('GIF version is invalid')
  const width = u16(bytes, 6)
  const height = u16(bytes, 8)
  if (width === 0 || height === 0) throw new TypeError('GIF logical dimensions must be non-zero')
  const screenPacked = bytes[10] ?? 0
  const globalColors = (screenPacked & 0x80) === 0 ? 0 : 1 << ((screenPacked & 0x07) + 1)
  let offset = 13 + globalColors * 3
  if (offset > bytes.byteLength) throw new TypeError('GIF global color table is truncated')
  const state = { nodes: 0, maxNodes }
  const frames = []
  const extensions = []
  let pendingControl
  let sawTrailer = false
  while (offset < bytes.byteLength) {
    if (state.nodes >= maxNodes) throw new RangeError('GIF block count exceeds maxNodes budget')
    state.nodes += 1
    const marker = bytes[offset] ?? 0
    offset += 1
    if (marker === 0x3b) {
      sawTrailer = true
      break
    }
    if (marker === 0x21) {
      if (offset >= bytes.byteLength) throw new TypeError('GIF extension label is truncated')
      const label = bytes[offset] ?? 0
      offset += 1
      if (label === 0xf9) {
        if (offset + 6 > bytes.byteLength || bytes[offset] !== 4 || bytes[offset + 5] !== 0) {
          throw new TypeError('GIF graphic control extension is malformed')
        }
        const packed = bytes[offset + 1] ?? 0
        pendingControl = Object.freeze({
          disposal: (packed >>> 2) & 0x07,
          transparent: (packed & 1) !== 0,
          delayCentiseconds: u16(bytes, offset + 2),
          transparentIndex: bytes[offset + 4] ?? 0,
        })
        offset += 6
        extensions.push(Object.freeze({ label: 'graphic-control', payloadBytes: 4 }))
      } else {
        const skipped = skipSubBlocks(bytes, offset, state)
        offset = skipped.offset
        const name =
          label === 0xfe
            ? 'comment'
            : label === 0xff
              ? 'application'
              : label === 0x01
                ? 'plain-text'
                : `extension-0x${label.toString(16).padStart(2, '0')}`
        extensions.push(Object.freeze({ label: name, payloadBytes: skipped.payloadBytes }))
      }
      continue
    }
    if (marker !== 0x2c || offset + 9 > bytes.byteLength) {
      throw new TypeError(`GIF block marker 0x${marker.toString(16).padStart(2, '0')} is invalid`)
    }
    const left = u16(bytes, offset)
    const top = u16(bytes, offset + 2)
    const frameWidth = u16(bytes, offset + 4)
    const frameHeight = u16(bytes, offset + 6)
    const packed = bytes[offset + 8] ?? 0
    offset += 9
    if (
      frameWidth === 0 ||
      frameHeight === 0 ||
      left + frameWidth > width ||
      top + frameHeight > height
    ) {
      throw new TypeError('GIF image descriptor dimensions are invalid')
    }
    const localColors = (packed & 0x80) === 0 ? 0 : 1 << ((packed & 0x07) + 1)
    offset += localColors * 3
    if (offset >= bytes.byteLength) throw new TypeError('GIF local color table is truncated')
    const minimumCodeSize = bytes[offset] ?? 0
    offset += 1
    if (minimumCodeSize < 2 || minimumCodeSize > 8) {
      throw new TypeError('GIF LZW minimum code size is invalid')
    }
    const imageData = skipSubBlocks(bytes, offset, state)
    offset = imageData.offset
    frames.push(
      Object.freeze({
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        interlaced: (packed & 0x40) !== 0,
        localColors,
        minimumCodeSize,
        compressedBytes: imageData.payloadBytes,
        control: pendingControl,
      }),
    )
    pendingControl = undefined
  }
  if (!sawTrailer || offset !== bytes.byteLength || frames.length === 0) {
    throw new TypeError('GIF must contain an image and end exactly at its trailer')
  }
  return Object.freeze({
    version,
    width,
    height,
    globalColors,
    frames: Object.freeze(frames),
    extensions: Object.freeze(extensions),
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'gif',
    label: 'Graphics Interchange Format',
    mediaType: 'image/gif',
  }),
  async detect(prefix) {
    return isGifPrefix(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'gif-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const gif = parseGif(bytes, context.budget.maxNodes)
    const raster = createRasterImageSource(bytes, 'image/gif', {
      width: gif.width,
      height: gif.height,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: gif.frames.length,
      channels: 4,
      bitDepth: 8,
      colorSpace: 'srgb',
      alphaMode: gif.frames.some(frame => frame.control?.transparent === true)
        ? 'straight'
        : 'none',
      orientation: 'top-left',
      decodedAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'GIF',
      preview: `${gif.width} × ${gif.height}, ${gif.frames.length} frame(s)`,
      children: [
        ...gif.frames.map((frame, index) => ({
          kind: 'frame',
          label: `Frame ${index}`,
          preview: `${frame.width} × ${frame.height}, ${frame.compressedBytes} LZW bytes`,
        })),
        ...gif.extensions.map((extension, index) => ({
          kind: 'chunk',
          label: `Extension ${index}: ${extension.label}`,
          preview: `${extension.payloadBytes} data bytes`,
        })),
      ],
    })
    return {
      summary: {
        format: 'gif',
        version: gif.version,
        width: gif.width,
        height: gif.height,
        frames: gif.frames.length,
        extensions: gif.extensions.length,
      },
      metadata: [
        {
          id: 'gif-image',
          label: 'GIF image',
          entries: [
            { key: 'version', value: gif.version },
            { key: 'width', value: gif.width },
            { key: 'height', value: gif.height },
            { key: 'globalColors', value: gif.globalColors },
            { key: 'frames', value: gif.frames.length },
            { key: 'extensions', value: gif.extensions.length },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: gif.width, height: gif.height, bitDepth: 8 } },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        ...(gif.frames.length > 1
          ? [{ id: 'image.frames', parameters: { count: gif.frames.length } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      unsupportedFeatures: [
        'decoded-region-provider',
        'animation-playback',
        'gif-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)

// Programmatic sequence export; native document editing remains a separate capability.
export { encodeGif } from '../../dist/gif/encode.js'
