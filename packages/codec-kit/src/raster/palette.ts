/**
 * 256-colour palettes and indexed pixels. One reader for the palette files formats carry — a raw
 * 768-byte RGB table (Westwood's 6-bit VGA values scale to 8 bits), JASC-PAL text and Microsoft
 * RIFF PAL — used by the `pal` codec and by every indexed-image codec that resolves a palette
 * sidecar (Westwood SHP/TMP, ...). Narrow on purpose: no image codec rides along.
 */

export type PaletteFormat = 'westwood-6bit' | 'rgb-8bit' | 'jasc-pal' | 'riff-pal'

export interface Palette {
  readonly format: PaletteFormat
  /** Colours the file declares; entries past it stay opaque black. */
  readonly count: number
  readonly version: string
  /** 256 RGBA8 entries. */
  readonly colors: Uint8Array
}

const latin1 = new TextDecoder('latin1')

function tag(bytes: Uint8Array, offset: number): string {
  return latin1.decode(bytes.subarray(offset, offset + 4))
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('PAL field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('PAL field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

export function isJascPalette(bytes: Uint8Array): boolean {
  return latin1.decode(bytes.subarray(0, Math.min(bytes.byteLength, 16))).startsWith('JASC-PAL')
}

export function isRiffPalette(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'PAL '
}

function emptyColors(): Uint8Array {
  const colors = new Uint8Array(256 * 4)
  for (let index = 3; index < colors.length; index += 4) colors[index] = 255
  return colors
}

function parseJasc(bytes: Uint8Array, maxNodes: number): Palette {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n')
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines[0] !== 'JASC-PAL' || lines.length < 3 || lines.length > maxNodes) {
    throw new TypeError('JASC-PAL header or line count is invalid')
  }
  const version = lines[1] ?? ''
  const count = Number(lines[2])
  if (!/^\d{4}$/u.test(version) || !Number.isSafeInteger(count) || count < 1 || count > 256) {
    throw new TypeError('JASC-PAL version or color count is invalid')
  }
  if (lines.length !== count + 3) {
    throw new TypeError('JASC-PAL color count does not match its rows')
  }
  const colors = emptyColors()
  for (let index = 0; index < count; index += 1) {
    const values = (lines[index + 3] ?? '').split(/\s+/u).map(Number)
    if (
      values.length !== 3 ||
      !values.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 255)
    ) {
      throw new TypeError(`JASC-PAL color ${index} is invalid`)
    }
    colors.set(values, index * 4)
  }
  return Object.freeze({ format: 'jasc-pal', count, version, colors })
}

function parseRiff(bytes: Uint8Array, maxNodes: number): Palette {
  const end = 8 + u32(bytes, 4)
  if (end !== bytes.byteLength) {
    throw new TypeError('RIFF PAL declared size does not match the source')
  }
  let offset = 12
  let nodes = 0
  while (offset < end) {
    if (nodes >= maxNodes) throw new RangeError('RIFF PAL chunk count exceeds maxNodes budget')
    nodes += 1
    if (offset + 8 > end) throw new TypeError('RIFF PAL chunk header is truncated')
    const id = tag(bytes, offset)
    const size = u32(bytes, offset + 4)
    const payload = offset + 8
    if (payload + size > end) throw new TypeError(`RIFF PAL ${id} chunk is truncated`)
    if (id === 'data') {
      if (size < 4) throw new TypeError('RIFF PAL data chunk is too short')
      const version = u16(bytes, payload)
      const count = u16(bytes, payload + 2)
      if (count < 1 || count > 256 || 4 + count * 4 > size) {
        throw new TypeError('RIFF PAL entry count is invalid')
      }
      const colors = emptyColors()
      for (let index = 0; index < count; index += 1) {
        const source = payload + 4 + index * 4
        colors[index * 4] = bytes[source] ?? 0
        colors[index * 4 + 1] = bytes[source + 1] ?? 0
        colors[index * 4 + 2] = bytes[source + 2] ?? 0
      }
      return Object.freeze({
        format: 'riff-pal',
        count,
        version: `0x${version.toString(16)}`,
        colors,
      })
    }
    offset = payload + size + (size & 1)
  }
  throw new TypeError('RIFF PAL data chunk is missing')
}

function parseBinary(bytes: Uint8Array): Palette {
  if (bytes.byteLength !== 768) throw new TypeError('raw PAL must contain exactly 256 RGB entries')
  const sixBit = bytes.every(value => value <= 63)
  const colors = emptyColors()
  for (let index = 0; index < 256; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = bytes[index * 3 + channel] ?? 0
      colors[index * 4 + channel] = sixBit ? (value << 2) | (value >>> 4) : value
    }
  }
  return Object.freeze({
    format: sixBit ? 'westwood-6bit' : 'rgb-8bit',
    count: 256,
    version: 'raw',
    colors,
  })
}

/** Reads a JASC-PAL, RIFF PAL or raw 768-byte palette; `maxNodes` bounds lines and chunks. */
export function parsePalette(bytes: Uint8Array, maxNodes: number): Palette {
  if (isJascPalette(bytes)) return parseJasc(bytes, maxNodes)
  if (isRiffPalette(bytes)) return parseRiff(bytes, maxNodes)
  return parseBinary(bytes)
}

/**
 * The palette index whose colour is nearest to (r, g, b) by squared RGB distance; the lowest index
 * wins a tie. `skip`, when given, is never chosen (a format's reserved transparent index).
 */
export function nearestPaletteIndex(
  colors: Uint8Array,
  r: number,
  g: number,
  b: number,
  skip?: number,
): number {
  if (colors.byteLength !== 256 * 4) throw new RangeError('palette must hold 256 RGBA entries')
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < 256; index += 1) {
    if (index === skip) continue
    const dr = (colors[index * 4] ?? 0) - r
    const dg = (colors[index * 4 + 1] ?? 0) - g
    const db = (colors[index * 4 + 2] ?? 0) - b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

/**
 * 8-bit indices of RGBA8 `pixels` in `colors`: a pixel whose alpha is below `alphaThreshold`
 * (default 128) becomes `transparent`, every other the nearest colour among the rest. The inverse
 * of `applyPalette` for pixels drawn from the palette; any other colour is rounded to it.
 */
export function quantizeToPalette(
  pixels: Uint8Array,
  colors: Uint8Array,
  options: { readonly transparent?: number; readonly alphaThreshold?: number } = {},
): Uint8Array {
  if (pixels.byteLength % 4 !== 0) throw new RangeError('RGBA8 pixels come in groups of four')
  const threshold = options.alphaThreshold ?? 128
  const out = new Uint8Array(pixels.byteLength / 4)
  const cache = new Map<number, number>()
  for (let pixel = 0; pixel < out.byteLength; pixel += 1) {
    const at = pixel * 4
    if ((pixels[at + 3] ?? 0) < threshold && options.transparent !== undefined) {
      out[pixel] = options.transparent
      continue
    }
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    const key = (r << 16) | (g << 8) | b
    let index = cache.get(key)
    if (index === undefined) {
      index = nearestPaletteIndex(colors, r, g, b, options.transparent)
      cache.set(key, index)
    }
    out[pixel] = index
  }
  return out
}

/**
 * RGBA8 pixels of 8-bit `indices` through `colors` (256 RGBA entries). The index `transparent`,
 * when given, becomes fully transparent black, as the sprite formats that reserve index 0 draw it.
 */
export function applyPalette(
  indices: Uint8Array,
  colors: Uint8Array,
  transparent?: number,
): Uint8Array {
  if (colors.byteLength !== 256 * 4) throw new RangeError('palette must hold 256 RGBA entries')
  const out = new Uint8Array(indices.byteLength * 4)
  for (let pixel = 0; pixel < indices.byteLength; pixel += 1) {
    const index = indices[pixel] ?? 0
    if (index === transparent) continue
    out.set(colors.subarray(index * 4, index * 4 + 4), pixel * 4)
  }
  return out
}
