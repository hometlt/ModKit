import { describe, expect, it } from 'vitest'
import {
  applyPalette,
  nearestPaletteIndex,
  parsePalette,
  quantizeToPalette,
} from '../src/raster/palette.js'

const encoder = new TextEncoder()

function rgba(colors: Uint8Array, index: number) {
  return [...colors.subarray(index * 4, index * 4 + 4)]
}

function raw(entries: readonly (readonly [number, number, number])[]): Uint8Array {
  const bytes = new Uint8Array(768)
  entries.forEach((entry, index) => bytes.set(entry, index * 3))
  return bytes
}

function riff(entries: readonly (readonly [number, number, number])[]): Uint8Array {
  const data = 4 + entries.length * 4
  const bytes = new Uint8Array(12 + 8 + data)
  const view = new DataView(bytes.buffer)
  bytes.set(encoder.encode('RIFF'), 0)
  view.setUint32(4, bytes.byteLength - 8, true)
  bytes.set(encoder.encode('PAL data'), 8)
  view.setUint32(16, data, true)
  view.setUint16(20, 0x300, true)
  view.setUint16(22, entries.length, true)
  entries.forEach((entry, index) => bytes.set([...entry, 0], 24 + index * 4))
  return bytes
}

describe('raster palette', () => {
  it('scales a Westwood 6-bit table to 8 bits and keeps an 8-bit table as is', () => {
    const six = parsePalette(
      raw([
        [0, 0, 0],
        [63, 32, 1],
      ]),
      100,
    )
    expect(six.format).toBe('westwood-6bit')
    expect(rgba(six.colors, 1)).toEqual([255, 130, 4, 255])
    const eight = parsePalette(
      raw([
        [0, 0, 0],
        [200, 64, 1],
      ]),
      100,
    )
    expect(eight.format).toBe('rgb-8bit')
    expect(rgba(eight.colors, 1)).toEqual([200, 64, 1, 255])
  })

  it('reads JASC-PAL text and RIFF PAL, leaving undeclared entries opaque black', () => {
    const jasc = parsePalette(
      encoder.encode('JASC-PAL\r\n0100\r\n2\r\n1 2 3\r\n250 128 0\r\n'),
      100,
    )
    expect([jasc.format, jasc.count, jasc.version]).toEqual(['jasc-pal', 2, '0100'])
    expect(rgba(jasc.colors, 1)).toEqual([250, 128, 0, 255])
    expect(rgba(jasc.colors, 2)).toEqual([0, 0, 0, 255])
    const microsoft = parsePalette(
      riff([
        [9, 8, 7],
        [1, 2, 3],
      ]),
      100,
    )
    expect([microsoft.format, microsoft.count, microsoft.version]).toEqual(['riff-pal', 2, '0x300'])
    expect(rgba(microsoft.colors, 0)).toEqual([9, 8, 7, 255])
  })

  it('refuses malformed palettes', () => {
    expect(() => parsePalette(new Uint8Array(767), 100)).toThrow(/256 RGB entries/u)
    expect(() => parsePalette(encoder.encode('JASC-PAL\n0100\n2\n1 2 3\n'), 100)).toThrow(
      /does not match/u,
    )
    expect(() => parsePalette(encoder.encode('JASC-PAL\n0100\n1\n1 2 300\n'), 100)).toThrow(
      /color 0/u,
    )
    const truncated = riff([[1, 2, 3]])
    new DataView(truncated.buffer).setUint32(4, truncated.byteLength, true)
    expect(() => parsePalette(truncated, 100)).toThrow(/declared size/u)
  })

  it('finds the nearest colour, lowest index on a tie, never the skipped one', () => {
    const colors = new Uint8Array(1024)
    colors.set([200, 0, 0, 255], 4)
    colors.set([200, 0, 0, 255], 8)
    colors.set([0, 0, 200, 255], 12)
    expect(nearestPaletteIndex(colors, 190, 10, 0)).toBe(1)
    expect(nearestPaletteIndex(colors, 0, 0, 0)).toBe(0)
    expect(nearestPaletteIndex(colors, 0, 0, 0, 0)).toBe(4)
    expect(nearestPaletteIndex(colors, 10, 0, 180, 0)).toBe(3)
  })

  it('quantizes RGBA to indices, the inverse of applyPalette for palette colours', () => {
    const { colors } = parsePalette(
      raw([
        [0, 0, 0],
        [63, 0, 0],
        [0, 63, 0],
      ]),
      100,
    )
    const indices = Uint8Array.from([1, 2, 0, 2])
    const pixels = applyPalette(indices, colors, 0)
    expect([...quantizeToPalette(pixels, colors, { transparent: 0 })]).toEqual([1, 2, 0, 2])
    // a colour off the palette rounds to its nearest entry; half-transparent is transparent
    const off = Uint8Array.from([250, 10, 5, 255, 20, 240, 30, 100])
    expect([...quantizeToPalette(off, colors, { transparent: 0 })]).toEqual([1, 0])
    expect(() => quantizeToPalette(new Uint8Array(3), colors)).toThrow(/groups of four/u)
  })

  it('turns indices into RGBA, the reserved index fully transparent', () => {
    const { colors } = parsePalette(
      raw([
        [1, 1, 1],
        [63, 0, 0],
      ]),
      100,
    )
    expect([...applyPalette(Uint8Array.from([1, 0]), colors, 0)]).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0,
    ])
    expect([...applyPalette(Uint8Array.from([0]), colors)]).toEqual([4, 4, 4, 255])
    expect(() => applyPalette(new Uint8Array(1), new Uint8Array(768))).toThrow(/256 RGBA/u)
  })

  it('reads a raw RGBx palette of 1024 bytes, the fourth byte ignored', () => {
    const bytes = new Uint8Array(1024)
    bytes.set([10, 20, 30, 99], 4)
    const palette = parsePalette(bytes, 100)
    expect(palette.format).toBe('rgbx-8bit')
    expect([...palette.colors.subarray(4, 8)]).toEqual([10, 20, 30, 255])
  })
})
