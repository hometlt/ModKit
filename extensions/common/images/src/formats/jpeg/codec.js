import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const latin1 = new TextDecoder('latin1')

function isJpeg(bytes) {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function u16(bytes, offset) {
  if (offset + 2 > bytes.byteLength) throw new RangeError('truncated JPEG u16')
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function parseJpeg(bytes, maxSegments) {
  if (!isJpeg(bytes)) throw new TypeError('JPEG SOI signature is invalid')
  const segments = []
  let offset = 2
  let frame
  let hasJfif = false
  let hasExif = false
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.byteLength) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9) break
    if (marker === 0xda) {
      segments.push(Object.freeze({ marker, name: 'SOS', length: bytes.byteLength - offset }))
      break
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.byteLength) throw new TypeError('JPEG segment length is truncated')
    const length = u16(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength)
      throw new TypeError('JPEG segment is truncated')
    const payload = bytes.subarray(offset + 2, offset + length)
    const name = `0x${marker.toString(16).padStart(2, '0')}`
    segments.push(Object.freeze({ marker, name, length: payload.byteLength }))
    if (segments.length > maxSegments)
      throw new RangeError('JPEG segment count exceeds maxNodes budget')
    if (marker === 0xe0 && latin1.decode(payload.subarray(0, 5)) === 'JFIF\0') hasJfif = true
    if (marker === 0xe1 && latin1.decode(payload.subarray(0, 6)) === 'Exif\0\0') hasExif = true
    if (SOF.has(marker) && payload.byteLength >= 6) {
      frame = Object.freeze({
        marker,
        progressive: [0xc2, 0xc6, 0xca, 0xce].includes(marker),
        bitDepth: payload[0],
        height: u16(payload, 1),
        width: u16(payload, 3),
        components: payload[5],
      })
    }
    offset += length
  }
  if (frame === undefined || frame.width === 0 || frame.height === 0) {
    throw new TypeError('JPEG SOF dimensions are missing')
  }
  return Object.freeze({ segments: Object.freeze(segments), frame, hasJfif, hasExif })
}

const definition = Object.freeze({
  id: 'org.modkitx/image-jpeg',
  format: Object.freeze({ id: 'jpeg', label: 'JPEG image', mediaType: 'image/jpeg' }),
  async detect(bytes) {
    const match = isJpeg(bytes)
    return { confidence: match ? 0.999 : 0.01, note: match ? 'jpeg-soi' : 'soi-mismatch' }
  },
  async inspect(bytes, context) {
    const jpeg = parseJpeg(bytes, context.budget.maxNodes)
    const raster = createRasterImageSource(bytes, 'image/jpeg', {
      width: jpeg.frame.width,
      height: jpeg.frame.height,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: 1,
      channels: jpeg.frame.components,
      bitDepth: jpeg.frame.bitDepth,
      colorSpace: 'unknown',
      alphaMode: 'none',
      orientation: 'top-left',
      decodedAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'JPEG',
      preview: `${jpeg.frame.width} × ${jpeg.frame.height}, ${jpeg.frame.bitDepth}-bit`,
      children: jpeg.segments.map((segment, index) => ({
        kind: 'segment',
        label: `${index}: ${segment.name}`,
        preview: `${segment.length} payload bytes`,
      })),
    })
    return {
      summary: {
        format: 'jpeg',
        width: jpeg.frame.width,
        height: jpeg.frame.height,
        bitDepth: jpeg.frame.bitDepth,
        components: jpeg.frame.components,
        progressive: jpeg.frame.progressive,
        jfif: jpeg.hasJfif,
        exif: jpeg.hasExif,
      },
      metadata: [
        {
          id: 'jpeg-frame',
          label: 'JPEG frame',
          entries: [
            { key: 'width', value: jpeg.frame.width },
            { key: 'height', value: jpeg.frame.height },
            { key: 'bitDepth', value: jpeg.frame.bitDepth },
            { key: 'components', value: jpeg.frame.components },
            { key: 'progressive', value: jpeg.frame.progressive },
            { key: 'jfif', value: jpeg.hasJfif },
            { key: 'exif', value: jpeg.hasExif },
            { key: 'segments', value: jpeg.segments.length },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: {
            width: jpeg.frame.width,
            height: jpeg.frame.height,
            bitDepth: jpeg.frame.bitDepth,
          },
        },
        { id: 'image.channels', parameters: { count: jpeg.frame.components, alpha: false } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: BigInt(jpeg.frame.width) * BigInt(jpeg.frame.height) * 4n,
      unsupportedFeatures: ['decoded-region-provider', 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
