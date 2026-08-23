// Hand-ported from the MK2 codec org.modkitx/webp (OPUS-MK2-01 task C pilot).
//
// Container walk only, exactly the fidelity the v1 manifest claimed: RIFF/WEBP chunk headers,
// the canvas size out of VP8/VP8L/VP8X and the animation frame count. No pixels are decoded,
// so the raster source is published without `readRegion` (decodedAccess: false).

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/webp'
const ascii = new TextDecoder('latin1')

const RIFF = 'RIFF'
const WEBP = 'WEBP'

function tag(bytes, offset) {
  return offset + 4 <= bytes.byteLength ? ascii.decode(bytes.subarray(offset, offset + 4)) : ''
}

function u32le(bytes, offset) {
  if (offset + 4 > bytes.byteLength) throw new RangeError('truncated WebP u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function u24le(bytes, offset) {
  if (offset + 3 > bytes.byteLength) throw new RangeError('truncated WebP u24')
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function looksLikeWebp(bytes) {
  return bytes.byteLength >= 12 && tag(bytes, 0) === RIFF && tag(bytes, 8) === WEBP
}

/** Walks the RIFF chunk list; every chunk is padded to an even length. */
function parseWebp(bytes, maxChunks) {
  if (!looksLikeWebp(bytes)) throw new TypeError('WebP RIFF/WEBP signature is invalid')
  const declared = u32le(bytes, 4)
  const end = Math.min(bytes.byteLength, declared + 8)
  const chunks = []
  let offset = 12
  while (offset + 8 <= end) {
    if (chunks.length >= maxChunks) throw new RangeError('WebP chunk count exceeds maxNodes budget')
    const type = tag(bytes, offset)
    const length = u32le(bytes, offset + 4)
    const dataOffset = offset + 8
    if (!/^[\x20-\x7e]{4}$/u.test(type) || dataOffset + length > bytes.byteLength) {
      throw new TypeError('WebP chunk is malformed or truncated')
    }
    chunks.push(Object.freeze({ type, length, dataOffset }))
    offset = dataOffset + length + (length % 2)
  }
  if (chunks.length === 0) throw new TypeError('WebP carries no chunks')

  let width = 0
  let height = 0
  let hasAlpha = false
  let lossless = false
  let frames = 1
  for (const chunk of chunks) {
    if (chunk.type === 'VP8X' && chunk.length >= 10) {
      width = u24le(bytes, chunk.dataOffset + 4) + 1
      height = u24le(bytes, chunk.dataOffset + 7) + 1
      hasAlpha = ((bytes[chunk.dataOffset] ?? 0) & 0x10) !== 0
    } else if (chunk.type === 'VP8 ' && chunk.length >= 10 && width === 0) {
      // key-frame header: 3 bytes tag, the 3-byte start code, then 14-bit dimensions
      const start = chunk.dataOffset + 3
      if (bytes[start] !== 0x9d || bytes[start + 1] !== 0x01 || bytes[start + 2] !== 0x2a) {
        throw new TypeError('WebP VP8 key frame start code is invalid')
      }
      width = ((bytes[start + 4] ?? 0) * 256 + (bytes[start + 3] ?? 0)) & 0x3fff
      height = ((bytes[start + 6] ?? 0) * 256 + (bytes[start + 5] ?? 0)) & 0x3fff
    } else if (chunk.type === 'VP8L' && chunk.length >= 5 && width === 0) {
      if (bytes[chunk.dataOffset] !== 0x2f) throw new TypeError('WebP VP8L signature is invalid')
      const bits = u32le(bytes, chunk.dataOffset + 1)
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
      hasAlpha = ((bits >>> 28) & 1) !== 0
      lossless = true
    } else if (chunk.type === 'ALPH') hasAlpha = true
    else if (chunk.type === 'ANMF') frames += 1
  }
  if (width === 0 || height === 0) throw new TypeError('WebP declares no canvas size')
  const animated = chunks.some(chunk => chunk.type === 'ANIM')
  return Object.freeze({
    chunks: Object.freeze(chunks),
    width,
    height,
    hasAlpha,
    lossless,
    frames: animated ? frames - 1 || 1 : 1,
    declared,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'webp', label: 'WebP', mediaType: 'image/webp' }),
  async detect(prefix) {
    if (!looksLikeWebp(prefix)) {
      return { confidence: 0, kind: 'magic', note: 'riff-webp-signature-mismatch' }
    }
    const first = tag(prefix, 12)
    const known = ['VP8 ', 'VP8L', 'VP8X'].includes(first)
    return {
      confidence: known ? 0.99 : 0.6,
      kind: 'magic',
      note: known ? `riff-webp/${first.trim()}` : 'riff-webp-unknown-first-chunk',
    }
  },
  async inspect(bytes, context) {
    const webp = parseWebp(bytes, context.budget.maxNodes)
    const raster = createRasterImageSource(bytes, 'image/webp', {
      width: webp.width,
      height: webp.height,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: webp.frames,
      channels: webp.hasAlpha ? 4 : 3,
      bitDepth: 8,
      colorSpace: 'srgb',
      alphaMode: webp.hasAlpha ? 'straight' : 'none',
      orientation: 'top-left',
      decodedAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'WebP',
      preview: `${webp.width} × ${webp.height}, ${webp.lossless ? 'lossless' : 'lossy'}`,
      children: webp.chunks.map((chunk, index) => ({
        kind: 'chunk',
        label: `${index}: ${chunk.type}`,
        preview: `${chunk.length} data bytes`,
      })),
    })
    return {
      summary: {
        format: 'webp',
        width: webp.width,
        height: webp.height,
        lossless: webp.lossless,
        hasAlpha: webp.hasAlpha,
        frames: webp.frames,
        chunks: webp.chunks.length,
      },
      metadata: [
        {
          id: 'webp-container',
          label: 'WebP container',
          entries: [
            { key: 'width', value: webp.width },
            { key: 'height', value: webp.height },
            { key: 'lossless', value: webp.lossless },
            { key: 'hasAlpha', value: webp.hasAlpha },
            { key: 'frames', value: webp.frames },
            { key: 'chunks', value: webp.chunks.length },
            { key: 'declaredRiffBytes', value: webp.declared },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: webp.width, height: webp.height, bitDepth: 8 } },
        {
          id: 'image.channels',
          parameters: { count: webp.hasAlpha ? 4 : 3, alpha: webp.hasAlpha },
        },
        ...(webp.frames > 1 ? [{ id: 'image.frames', parameters: { count: webp.frames } }] : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      unsupportedFeatures: ['decoded-region-provider', 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
