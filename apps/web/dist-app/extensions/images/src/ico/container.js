import { createRasterImageSource, createTreeDataSource } from '@modkitx-x3/codec-kit'

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function view(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new RangeError('ICO/CUR structure is truncated')
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

function u16(bytes, offset) {
  return view(bytes, offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  return view(bytes, offset, 4).getUint32(0, true)
}

function i32(bytes, offset) {
  return view(bytes, offset, 4).getInt32(0, true)
}

function matches(bytes, type) {
  return bytes[0] === 0 && bytes[1] === 0 && bytes[2] === type && bytes[3] === 0
}

function hasPlausibleDirectory(bytes, type) {
  if (!matches(bytes, type) || bytes.byteLength < 6) return false
  const count = u16(bytes, 4)
  if (count < 1 || count > 256) return false
  const directoryEnd = 6 + count * 16
  if (directoryEnd > bytes.byteLength) return false
  let recognizedPayload = false
  for (let index = 0; index < count; index += 1) {
    const position = 6 + index * 16
    const reserved = bytes[position + 3]
    const size = u32(bytes, position + 8)
    const offset = u32(bytes, position + 12)
    if (reserved !== 0 || size === 0 || offset < directoryEnd) return false
    if (offset + 4 <= bytes.byteLength) {
      const headerBytes = u32(bytes, offset)
      recognizedPayload ||=
        (offset + PNG_SIGNATURE.length <= bytes.byteLength && isPng(bytes, offset, size)) ||
        [12, 16, 40, 52, 56, 64, 108, 124].includes(headerBytes)
    }
  }
  return recognizedPayload
}

function isPng(bytes, offset, size) {
  return (
    size >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[offset + index] === value)
  )
}

function parseEntries(bytes, type, maxNodes) {
  if (!matches(bytes, type) || bytes.byteLength < 6)
    throw new TypeError('ICO/CUR header is invalid')
  const count = u16(bytes, 4)
  if (count < 1 || count > maxNodes)
    throw new RangeError('ICO/CUR image count is invalid or exceeds maxNodes budget')
  const directoryEnd = 6 + count * 16
  if (directoryEnd > bytes.byteLength) throw new TypeError('ICO/CUR directory is truncated')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const position = 6 + index * 16
    const width = bytes[position] === 0 ? 256 : (bytes[position] ?? 0)
    const height = bytes[position + 1] === 0 ? 256 : (bytes[position + 1] ?? 0)
    const colorCount = bytes[position + 2] ?? 0
    const firstWord = u16(bytes, position + 4)
    const secondWord = u16(bytes, position + 6)
    const size = u32(bytes, position + 8)
    const offset = u32(bytes, position + 12)
    if (
      size === 0 ||
      offset < directoryEnd ||
      BigInt(offset) + BigInt(size) > BigInt(bytes.byteLength)
    ) {
      throw new TypeError(`ICO/CUR directory entry ${index} points outside the source`)
    }
    const headerBytes = size >= 4 ? u32(bytes, offset) : 0
    const payloadKind = isPng(bytes, offset, size)
      ? 'png'
      : headerBytes >= 40 && headerBytes <= size
        ? 'dib'
        : 'unknown'
    if (payloadKind === 'png') {
      if (size < 24 || ascii4(bytes, offset + 12) !== 'IHDR') {
        throw new TypeError(`ICO/CUR PNG entry ${index} has no IHDR`)
      }
      const pngWidth = view(bytes, offset + 16, 4).getUint32(0, false)
      const pngHeight = view(bytes, offset + 20, 4).getUint32(0, false)
      if (pngWidth !== width || pngHeight !== height) {
        throw new TypeError(`ICO/CUR PNG entry ${index} dimensions disagree with its directory`)
      }
    }
    entries.push(
      Object.freeze({
        index,
        width,
        height,
        colorCount,
        firstWord,
        secondWord,
        size,
        offset,
        payloadKind,
      }),
    )
  }
  return Object.freeze(entries)
}

function ascii4(bytes, offset) {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  )
}

function selectEntry(entries, cursor) {
  return [...entries].sort((left, right) => {
    const area = right.width * right.height - left.width * left.height
    if (area !== 0) return area
    if (!cursor && right.secondWord !== left.secondWord) return right.secondWord - left.secondWord
    if (left.payloadKind !== right.payloadKind) return left.payloadKind === 'png' ? -1 : 1
    return left.index - right.index
  })[0]
}

function parseDib(bytes, entry, maxScalarBytes, strictPayload = false) {
  if (entry.payloadKind !== 'dib') return undefined
  const headerBytes = u32(bytes, entry.offset)
  const width = i32(bytes, entry.offset + 4)
  const rawHeight = i32(bytes, entry.offset + 8)
  const planes = u16(bytes, entry.offset + 12)
  const bitDepth = u16(bytes, entry.offset + 14)
  const compression = u32(bytes, entry.offset + 16)
  const absoluteHeight = Math.abs(rawHeight)
  if (
    width !== entry.width ||
    (absoluteHeight !== entry.height && absoluteHeight !== entry.height * 2) ||
    planes !== 1 ||
    ![24, 32].includes(bitDepth) ||
    compression !== 0
  ) {
    return undefined
  }
  const xorRowBytesBig = ((BigInt(width) * BigInt(bitDepth) + 31n) / 32n) * 4n
  const maskRowBytesBig = ((BigInt(width) + 31n) / 32n) * 4n
  const xorBytesBig = xorRowBytesBig * BigInt(entry.height)
  const xorOffset = entry.offset + headerBytes
  const entryEnd = BigInt(entry.offset) + BigInt(entry.size)
  if (
    BigInt(xorOffset) + xorBytesBig > entryEnd ||
    xorRowBytesBig > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    if (strictPayload && BigInt(xorOffset) + xorBytesBig > entryEnd) {
      throw new TypeError('embedded ICO/CUR DIB pixel data is truncated')
    }
    return undefined
  }
  const maskOffsetBig = BigInt(xorOffset) + xorBytesBig
  const maskBytesBig = maskRowBytesBig * BigInt(entry.height)
  if (
    strictPayload &&
    absoluteHeight === entry.height * 2 &&
    maskOffsetBig + maskBytesBig > entryEnd
  ) {
    throw new TypeError('embedded ICO/CUR DIB AND mask is truncated')
  }
  const decodedBytes = BigInt(width) * BigInt(entry.height) * 4n
  return Object.freeze({
    width,
    height: entry.height,
    topDown: rawHeight < 0,
    bitDepth,
    xorOffset,
    xorRowBytes: Number(xorRowBytesBig),
    maskOffset: Number(maskOffsetBig),
    maskRowBytes: Number(maskRowBytesBig),
    hasMask: maskOffsetBig + maskBytesBig <= entryEnd,
    decodedBytes,
    decodedAccess: decodedBytes <= BigInt(maxScalarBytes),
  })
}

function regionReader(bytes, dib) {
  let storedAlpha
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError(
        'ICO/CUR region coordinates and budget must be non-negative safe integers',
      )
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('ICO/CUR exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > dib.width || request.y + request.height > dib.height) {
      throw new RangeError('ICO/CUR region is outside the selected image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('ICO/CUR region exceeds maxBytes budget')
    }
    if (storedAlpha === undefined && dib.bitDepth === 32) {
      storedAlpha = false
      for (let y = 0; y < dib.height && !storedAlpha; y += 1) {
        const row = dib.xorOffset + y * dib.xorRowBytes
        for (let x = 0; x < dib.width; x += 1) {
          if ((bytes[row + x * 4 + 3] ?? 0) !== 0) {
            storedAlpha = true
            break
          }
        }
      }
    }
    const pixels = new Uint8Array(outputBytes)
    const bytesPerPixel = dib.bitDepth / 8
    for (let row = 0; row < request.height; row += 1) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const logicalY = request.y + row
      const sourceY = dib.topDown ? logicalY : dib.height - 1 - logicalY
      const xorRow = dib.xorOffset + sourceY * dib.xorRowBytes
      const maskRow = dib.maskOffset + sourceY * dib.maskRowBytes
      for (let column = 0; column < request.width; column += 1) {
        const logicalX = request.x + column
        const source = xorRow + logicalX * bytesPerPixel
        const target = (row * request.width + column) * 4
        pixels[target] = bytes[source + 2] ?? 0
        pixels[target + 1] = bytes[source + 1] ?? 0
        pixels[target + 2] = bytes[source] ?? 0
        const masked =
          dib.hasMask &&
          ((bytes[maskRow + Math.floor(logicalX / 8)] ?? 0) & (0x80 >>> (logicalX % 8))) !== 0
        pixels[target + 3] = masked
          ? 0
          : dib.bitDepth === 32 && storedAlpha
            ? (bytes[source + 3] ?? 0)
            : 255
      }
    }
    return Object.freeze({
      width: request.width,
      height: request.height,
      rowStride: request.width * 4,
      pixelFormat: 'rgba8',
      pixels,
    })
  }
}

/**
 * Decode the first image carried by an embedded ICO/CUR container.
 *
 * Windows ANI stores each frame as a complete ICO or CUR payload in an `icon` RIFF chunk. Keeping
 * this parser here makes ANI use the same directory, DIB stride, alpha and AND-mask rules as the
 * standalone codecs. It deliberately returns no reader for PNG or unsupported DIB variants rather
 * than inventing pixels.
 */
export function decodeEmbeddedIconFrame(bytes, budget) {
  if (bytes.byteLength < 4 || bytes[0] !== 0 || bytes[1] !== 0) {
    throw new TypeError('embedded ANI frame has no ICO/CUR header')
  }
  const type = bytes[2]
  if (type !== 1 && type !== 2) {
    throw new TypeError('embedded ANI frame has no ICO/CUR header')
  }
  const entries = parseEntries(bytes, type, budget.maxNodes)
  const selected = selectEntry(entries, type === 2)
  if (selected === undefined) throw new TypeError('embedded ANI frame has no selectable image')
  const dib = parseDib(bytes, selected, budget.maxScalarBytes, true)
  const decodedAccess = dib?.decodedAccess === true
  return Object.freeze({
    width: selected.width,
    height: selected.height,
    payloadKind: selected.payloadKind,
    decodedAccess,
    ...(dib === undefined
      ? {}
      : {
          decodedBytes: dib.decodedBytes,
          readRegion: decodedAccess ? regionReader(bytes, dib) : undefined,
        }),
  })
}

export function createIconDefinition({ id, formatId, label, type }) {
  const cursor = type === 2
  return Object.freeze({
    id,
    format: Object.freeze({ id: formatId, label, mediaType: 'image/x-icon' }),
    async detect(prefix) {
      return hasPlausibleDirectory(prefix, type)
        ? { confidence: 0.99, kind: 'magic', note: cursor ? 'cur-signature' : 'ico-signature' }
        : { confidence: 0, kind: 'structure', note: 'ico-cur-directory-mismatch' }
    },
    async inspect(bytes, context) {
      const entries = parseEntries(bytes, type, context.budget.maxNodes)
      const selected = selectEntry(entries, cursor)
      if (selected === undefined) throw new TypeError('ICO/CUR has no selectable image')
      const dib = parseDib(bytes, selected, context.budget.maxScalarBytes)
      const decodedAccess = dib?.decodedAccess === true
      const raster = createRasterImageSource(
        bytes,
        'image/x-icon',
        {
          width: selected.width,
          height: selected.height,
          depth: 1,
          layers: 1,
          faces: 1,
          mipLevels: entries.length,
          frames: 1,
          channels: 4,
          bitDepth: 8,
          colorSpace: 'srgb',
          alphaMode: 'straight',
          orientation: 'top-left',
          decodedAccess,
        },
        decodedAccess ? regionReader(bytes, dib) : undefined,
      )
      const tree = createTreeDataSource({
        kind: 'image',
        label,
        preview: `${entries.length} image(s), selected ${selected.width} × ${selected.height}`,
        children: entries.map(entry => ({
          kind: 'image',
          label: `Entry ${entry.index}`,
          preview: cursor
            ? `${entry.width} × ${entry.height}, hotspot ${entry.firstWord},${entry.secondWord}, ${entry.payloadKind}`
            : `${entry.width} × ${entry.height}, ${entry.secondWord || '?'}-bit, ${entry.payloadKind}`,
        })),
      })
      return {
        summary: {
          format: formatId,
          width: selected.width,
          height: selected.height,
          images: entries.length,
          selectedEntry: selected.index,
          payloadKind: selected.payloadKind,
          ...(cursor ? { hotspotX: selected.firstWord, hotspotY: selected.secondWord } : {}),
        },
        metadata: [
          {
            id: `${formatId}-container`,
            label,
            entries: [
              { key: 'images', value: entries.length },
              { key: 'selectedEntry', value: selected.index },
              { key: 'width', value: selected.width },
              { key: 'height', value: selected.height },
              { key: 'payloadKind', value: selected.payloadKind },
              ...(cursor
                ? [
                    { key: 'hotspotX', value: selected.firstWord },
                    { key: 'hotspotY', value: selected.secondWord },
                  ]
                : [{ key: 'bitDepth', value: selected.secondWord }]),
            ],
          },
        ],
        traits: [
          {
            id: 'image.raster',
            parameters: { width: selected.width, height: selected.height, bitDepth: 8 },
          },
          { id: 'image.channels', parameters: { count: 4, alpha: true } },
          ...(entries.length > 1
            ? [{ id: 'image.mipmaps', parameters: { levels: entries.length } }]
            : []),
          { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ],
        dataSources: {
          'common.view/tree-data-source': tree,
          'common.view/raster-image-source': raster,
        },
        ...(decodedAccess ? { maxDecodedBytes: dib.decodedBytes } : {}),
        unsupportedFeatures: [
          ...(decodedAccess ? [] : ['decoded-region-provider']),
          'png-backed-region-decoding',
          'indexed-dib-region-decoding',
          `${formatId}-writing`,
          'pixel-editing',
        ],
      }
    },
  })
}
