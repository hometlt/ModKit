import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
} from '@modkitx-x3/codec-kit'

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const latin1 = new TextDecoder('latin1')
const COM = 0xfe
const APP_FIRST = 0xe0
const APP_LAST = 0xef
/** A JPEG segment length field is a u16 that counts itself, so the payload stops here. */
const MAX_SEGMENT_PAYLOAD = 65_533

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
    // the marker code sits one byte past its 0xff introducer: a byte-range edit starts there
    const start = offset - 1
    offset += 1
    if (marker === 0xd9) break
    if (marker === 0xda) {
      segments.push(
        Object.freeze({
          marker,
          name: 'SOS',
          length: bytes.byteLength - offset,
          offset: start,
          end: bytes.byteLength,
        }),
      )
      break
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.byteLength) throw new TypeError('JPEG segment length is truncated')
    const length = u16(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength)
      throw new TypeError('JPEG segment is truncated')
    const payload = bytes.subarray(offset + 2, offset + length)
    const name = `0x${marker.toString(16).padStart(2, '0')}`
    segments.push(
      Object.freeze({
        marker,
        name,
        length: payload.byteLength,
        offset: start,
        end: offset + length,
      }),
    )
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

/**
 * ADR-HOST-002 Path A — the two mutating operations of this codec. JPEG carries no checksum and
 * no stored offsets, so a segment is a self-describing byte range: setting the COM comment and
 * dropping a metadata segment are each one byte-range replace, with every other byte of the file
 * untouched. The codec never writes; the host commits the plan under `write-source`.
 */
const EDIT_FIELD_OPERATION = Object.freeze({
  id: 'edit.field',
  handlerId: 'set-comment',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  outputKinds: Object.freeze(['edit-plan']),
})

const EDIT_STRUCTURE_OPERATION = Object.freeze({
  id: 'edit.structure',
  handlerId: 'remove-segment',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  outputKinds: Object.freeze(['edit-plan']),
})

const JPEG_EDIT_OPERATIONS = Object.freeze([EDIT_FIELD_OPERATION, EDIT_STRUCTURE_OPERATION])

const isApp = marker => marker >= APP_FIRST && marker <= APP_LAST

function markerLabel(marker) {
  if (marker === COM) return 'COM'
  if (isApp(marker)) return `APP${marker - APP_FIRST}`
  return `0x${marker.toString(16).padStart(2, '0')}`
}

/** COM has no declared charset; Latin-1 is the safe reading, so refuse what it cannot carry. */
function latin1Bytes(text) {
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0xff)
      throw new TypeError('a JPEG comment carries Latin-1 only')
  }
  return Uint8Array.from(text, char => char.codePointAt(0) ?? 0)
}

function commentSegmentBytes(text) {
  const payload = latin1Bytes(text)
  if (payload.byteLength > MAX_SEGMENT_PAYLOAD) {
    throw new RangeError(`a JPEG comment is at most ${MAX_SEGMENT_PAYLOAD} bytes`)
  }
  const segment = new Uint8Array(4 + payload.byteLength)
  segment[0] = 0xff
  segment[1] = COM
  segment[2] = ((payload.byteLength + 2) >> 8) & 0xff
  segment[3] = (payload.byteLength + 2) & 0xff
  segment.set(payload, 4)
  return segment
}

/** A new COM goes after SOI and the APP block: before the first segment that is not APPn. */
function commentInsertOffset(segments) {
  const anchor = segments.find(segment => !isApp(segment.marker))
  if (anchor === undefined) throw new TypeError('JPEG has no segment after its APP block')
  return anchor.offset
}

function editPlanOutput(input, planId, edit, diagnostics) {
  return {
    kind: 'edit-plan',
    plan: editPlanFromInput(input, {
      planId,
      edits: [edit],
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics,
    }),
  }
}

/** `set-comment`: set or replace the COM segment; nothing else in the file moves. */
function setCommentHandler(jpeg, input) {
  return async value => {
    if (typeof value !== 'object' || value === null || typeof value.text !== 'string') {
      throw new TypeError('edit.field expects { text } (with an optional keyword «comment»)')
    }
    if (value.keyword !== undefined && value.keyword !== 'comment') {
      throw new TypeError('this codec edits one JPEG field: «comment» (the COM segment)')
    }
    const replacement = commentSegmentBytes(value.text)
    const existing = jpeg.segments.filter(segment => segment.marker === COM)
    const [first] = existing
    const edit =
      first === undefined
        ? replaceBytes(commentInsertOffset(jpeg.segments), 0, replacement, 'insert COM')
        : replaceBytes(first.offset, first.end - first.offset, replacement, 'replace COM')
    return editPlanOutput(
      input,
      'jpeg-set-comment',
      edit,
      existing.length > 1
        ? [
            {
              severity: 'info',
              code: 'x3.images/jpeg-comment-not-unique',
              message: `${existing.length} COM segments are present; only the first one is rewritten`,
            },
          ]
        : [],
    )
  }
}

function resolveMarker(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
      throw new TypeError('a JPEG marker code is a byte')
    }
    return value
  }
  if (typeof value === 'string') {
    const text = value.trim().toUpperCase()
    if (text === 'COM') return COM
    const app = /^APP(\d{1,2})$/u.exec(text)
    if (app !== null && Number(app[1]) <= APP_LAST - APP_FIRST) return APP_FIRST + Number(app[1])
    const hex = /^(?:0X)?([0-9A-F]{2})$/u.exec(text)
    if (hex !== null) return Number.parseInt(hex[1] ?? '', 16)
  }
  throw new TypeError('edit.structure expects { marker } as «COM», «APPn» or a marker byte')
}

/** `remove-segment`: drop one metadata segment. Structural markers are refused, never guessed. */
function removeSegmentHandler(jpeg, input) {
  return async value => {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('edit.structure expects { marker }')
    }
    const marker = resolveMarker(value.marker)
    if (marker !== COM && !isApp(marker)) {
      throw new TypeError(
        `removing ${markerLabel(marker)} would change the image: only COM and APPn segments are removable`,
      )
    }
    const matches = jpeg.segments.filter(segment => segment.marker === marker)
    const [first] = matches
    if (first === undefined) throw new TypeError(`this JPEG has no ${markerLabel(marker)} segment`)
    return editPlanOutput(
      input,
      `jpeg-remove-segment:${markerLabel(marker)}`,
      replaceBytes(
        first.offset,
        first.end - first.offset,
        new Uint8Array(0),
        `remove ${markerLabel(marker)}`,
      ),
      matches.length > 1
        ? [
            {
              severity: 'info',
              code: 'x3.images/jpeg-segment-not-unique',
              message: `${matches.length} ${markerLabel(marker)} segments are present; only the first one is removed`,
            },
          ]
        : [],
    )
  }
}

const definition = Object.freeze({
  id: 'org.modkitx/image-jpeg',
  operations: JPEG_EDIT_OPERATIONS,
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
      handlers: {
        'set-comment': setCommentHandler(jpeg, context.input),
        'remove-segment': removeSegmentHandler(jpeg, context.input),
      },
      maxDecodedBytes: BigInt(jpeg.frame.width) * BigInt(jpeg.frame.height) * 4n,
      unsupportedFeatures: ['decoded-region-provider', 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
