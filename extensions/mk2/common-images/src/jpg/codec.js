// Hand-ported from the MK2 codec org.modkitx/jpg (OPUS-MK2-02 task G, wave 1).
//
// Fidelity is exactly the v1 limitation: "detects and inspects JPEG headers but does not decode
// pixels". The port walks the marker segments, takes the frame dimensions from the SOF it finds,
// and publishes a raster source without `readRegion` — there is no decoder here and the
// descriptor does not pretend otherwise.
//
// The v1 manifest routed on the extension and on the `ff d8 ff` magic; both survive conversion,
// so this module only has to earn the confidence the magic already suggests.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/jpg'
const latin1 = new TextDecoder('latin1')

/** ITU-T T.81 §B.2.2: every start-of-frame marker. The progressive ones are called out below. */
const FRAME_MARKERS = Object.freeze(
  new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]),
)
const PROGRESSIVE_MARKERS = Object.freeze(new Set([0xc2, 0xc6, 0xca, 0xce]))
const MARKER_NAMES = Object.freeze({
  0xc4: 'DHT',
  0xda: 'SOS',
  0xdb: 'DQT',
  0xdd: 'DRI',
  0xe0: 'APP0',
  0xe1: 'APP1',
  0xee: 'APP14',
  0xfe: 'COM',
})

const isJpeg = bytes =>
  bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

function u16(bytes, offset) {
  if (offset + 2 > bytes.byteLength) throw new RangeError('truncated JPEG u16')
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

const markerName = marker =>
  MARKER_NAMES[marker] ??
  (FRAME_MARKERS.has(marker) ? `SOF${marker - 0xc0}` : `0x${marker.toString(16).padStart(2, '0')}`)

/**
 * Walks the segment chain from SOI to SOS. Entropy-coded data is never scanned: the port stops
 * at the scan header, which is where header inspection ends.
 */
function readSegments(bytes, maxSegments) {
  if (!isJpeg(bytes)) throw new TypeError('JPEG SOI signature is invalid')
  const segments = []
  let offset = 2
  let frame
  let jfifVersion
  let hasExif = false
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) throw new TypeError('JPEG segment does not start with a marker')
    while (bytes[offset] === 0xff) offset += 1 // fill bytes are legal padding (T.81 §B.1.1.2)
    const marker = bytes[offset] ?? 0
    offset += 1
    if (marker === 0xd9) break // EOI
    if (marker >= 0xd0 && marker <= 0xd8) continue // RSTn / SOI carry no payload
    const length = u16(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength) {
      throw new TypeError('JPEG segment length runs past the end of the file')
    }
    const payload = bytes.subarray(offset + 2, offset + length)
    segments.push(Object.freeze({ marker, name: markerName(marker), bytes: payload.byteLength }))
    if (segments.length > maxSegments) throw new RangeError('JPEG segment count exceeds maxNodes')
    if (marker === 0xe0 && latin1.decode(payload.subarray(0, 5)) === 'JFIF\0') {
      jfifVersion = `${payload[5] ?? 0}.${String(payload[6] ?? 0).padStart(2, '0')}`
    }
    if (marker === 0xe1 && latin1.decode(payload.subarray(0, 4)) === 'Exif') hasExif = true
    if (frame === undefined && FRAME_MARKERS.has(marker) && payload.byteLength >= 6) {
      frame = Object.freeze({
        marker,
        progressive: PROGRESSIVE_MARKERS.has(marker),
        bitDepth: payload[0] ?? 0,
        height: u16(payload, 1),
        width: u16(payload, 3),
        components: payload[5] ?? 0,
      })
    }
    if (marker === 0xda) break // SOS: entropy-coded data follows and is not header data
    offset += length
  }
  if (frame === undefined || frame.width === 0 || frame.height === 0) {
    throw new TypeError('JPEG carries no frame header with usable dimensions')
  }
  return Object.freeze({ segments: Object.freeze(segments), frame, jfifVersion, hasExif })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'jpg', label: 'JPEG / JFIF', mediaType: 'image/jpeg' }),
  async detect(prefix) {
    if (!isJpeg(prefix)) return { confidence: 0, kind: 'magic', note: 'soi-mismatch' }
    // SOI plus a real frame header is decisive; SOI alone is only the first three bytes, which
    // a truncated or mislabelled file can carry by accident.
    try {
      const jpeg = readSegments(prefix, 4096)
      return {
        confidence: 0.99,
        kind: 'magic',
        note: `jpeg-${jpeg.frame.width}x${jpeg.frame.height}`,
      }
    } catch {
      return { confidence: 0.6, kind: 'magic', note: 'jpeg-soi-only' }
    }
  },
  async inspect(bytes, context) {
    const jpeg = readSegments(bytes, context.budget.maxNodes)
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
      preview: `${jpeg.frame.width} × ${jpeg.frame.height}, ${jpeg.frame.components} component(s)`,
      children: jpeg.segments.map((segment, index) => ({
        kind: 'segment',
        label: `${index}: ${segment.name}`,
        preview: `${segment.bytes} payload bytes`,
      })),
    })
    return {
      summary: {
        format: 'jpg',
        width: jpeg.frame.width,
        height: jpeg.frame.height,
        bitDepth: jpeg.frame.bitDepth,
        components: jpeg.frame.components,
        progressive: jpeg.frame.progressive,
        jfifVersion: jpeg.jfifVersion ?? null,
        exif: jpeg.hasExif,
        segments: jpeg.segments.length,
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
            { key: 'jfif', value: jpeg.jfifVersion ?? 'absent' },
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
      unsupportedFeatures: ['pixel-decoding', 'exif-tag-parsing', 'thumbnail-extraction'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
