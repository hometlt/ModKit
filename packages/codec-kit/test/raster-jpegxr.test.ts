import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  JPEGXR_INVALID,
  JPEGXR_OUTPUT_LIMIT,
  decodeJpegXr,
  decodeJpegXrComponents,
  jpegXrFileFromHeaderless,
} from '../src/raster/jpegxr.js'

// 20x12 images written by Windows Imaging Component from source-bgra.raw (B=12x, G=20y,
// R=255-10x, A=128+10y): planar-alpha.jxr lossless with an alpha plane, lossy-ov{0,1,2}.jxr
// lossy with interleaved alpha and overlap 0, 1 and 2.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'jpegxr', name)))
const source = fixture('source-bgra.raw')
const rgba = new Uint8Array(source.length)
for (let at = 0; at < source.length; at += 4)
  rgba.set([source[at + 2]!, source[at + 1]!, source[at]!, source[at + 3]!], at)
const bound = { maxOutputBytes: 20 * 12 * 4 }

/** The codestream a container holds (IMAGE_OFFSET / IMAGE_BYTE_COUNT). */
function codestreamOf(file: Uint8Array): Uint8Array {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const ifd = view.getUint32(4, true)
  const tags = new Map<number, number>()
  for (let index = 0; index < view.getUint16(ifd, true); index += 1)
    tags.set(
      view.getUint16(ifd + 2 + index * 12, true),
      view.getUint32(ifd + 10 + index * 12, true),
    )
  return file.subarray(tags.get(0xbcc0)!, tags.get(0xbcc0)! + tags.get(0xbcc1)!)
}

/** Expose the fixture's separate color plane as generic components, without changing its coding. */
function colorComponents(pixelFormat = 0x20): Uint8Array {
  const file = fixture('planar-alpha.jxr')
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const ifd = view.getUint32(4, true)
  for (let index = 0; index < view.getUint16(ifd, true); index++) {
    const at = ifd + 2 + index * 12
    if (view.getUint16(at, true) === 0xbc01) file[view.getUint32(at + 8, true) + 15] = pixelFormat
  }
  return file
}

describe('JPEG XR', () => {
  it('preserves non-alpha RGB output through the same standard decoder', async () => {
    const rgb = await decodeJpegXr(colorComponents(0x0d), bound)
    const expected = rgba.slice()
    for (let at = 3; at < expected.length; at += 4) expected[at] = 255
    expect(rgb.pixels).toEqual(expected)
  })
  it('returns actual raw components without ICC, BGR swapping or alpha padding', async () => {
    const image = await decodeJpegXrComponents(colorComponents(), { maxOutputBytes: 20 * 12 * 3 })
    expect(image).toMatchObject({ width: 20, height: 12, componentCount: 3 })
    const expected: number[] = []
    for (let at = 0; at < rgba.length; at += 4) {
      // Lossless JPEG XR forward RCT; raw chroma is biased by 128 and clipped to UNORM8.
      let r = rgba[at]!,
        g = rgba[at + 1]!,
        b = rgba[at + 2]!
      b -= r
      r += ((b + 1) >> 1) - g
      g += r >> 1
      expected.push(g, Math.max(0, Math.min(255, 128 - r)), Math.max(0, Math.min(255, 128 + b)))
    }
    expect(image.pixels).toEqual(Uint8Array.from(expected))
    await expect(
      decodeJpegXrComponents(colorComponents(), { maxOutputBytes: 719 }),
    ).rejects.toMatchObject({ code: JPEGXR_OUTPUT_LIMIT })
    expect((await decodeJpegXr(fixture('planar-alpha.jxr'), bound)).pixels).toEqual(rgba)
  })

  it('refuses raw alpha and non-admitted HDP profiles instead of silently dropping channels', async () => {
    await expect(decodeJpegXrComponents(fixture('planar-alpha.jxr'), bound)).rejects.toMatchObject({
      code: JPEGXR_INVALID,
    })
    await expect(
      decodeJpegXrComponents(colorComponents(), { ...bound, dialect: 'hdphoto-independent' }),
    ).rejects.toMatchObject({ code: JPEGXR_INVALID })
    for (const maxOutputBytes of [0, -1, NaN, Infinity, 1.5])
      await expect(
        decodeJpegXrComponents(colorComponents(), { maxOutputBytes }),
      ).rejects.toMatchObject({ code: JPEGXR_OUTPUT_LIMIT })
    const controller = new AbortController()
    controller.abort()
    await expect(
      decodeJpegXrComponents(colorComponents(), { ...bound, signal: controller.signal }),
    ).rejects.toThrow()
  })

  it('builds explicit gray/n-component output headers and rejects unsupported component counts', () => {
    for (const [planes, format] of [
      [new Uint8Array([0xd1, 0]), 1],
      [new Uint8Array([0xd1, 0x10]), 0x61],
      [new Uint8Array([0x71, 0]), 0x61],
    ] as const) {
      const file = jpegXrFileFromHeaderless({
        width: 16,
        height: 16,
        overlap: 1,
        alpha: false,
        output: 'components',
        planes,
      })
      expect(codestreamOf(file)[11]).toBe(format)
    }
    expect(() =>
      jpegXrFileFromHeaderless({
        width: 16,
        height: 16,
        overlap: 1,
        alpha: true,
        output: 'components',
        planes: new Uint8Array([0xd1, 0x10]),
      }),
    ).toThrow()
    expect(() =>
      jpegXrFileFromHeaderless({
        width: 16,
        height: 16,
        overlap: 1,
        alpha: false,
        output: 'components',
        planes: new Uint8Array([0xd1, 0x30]),
      }),
    ).toThrow()
  })
  it('decodes a lossless file with a planar alpha plane exactly', async () => {
    const image = await decodeJpegXr(fixture('planar-alpha.jxr'), bound)
    expect(image).toMatchObject({ width: 20, height: 12 })
    expect(image.pixels).toEqual(rgba)
  })

  for (const overlap of [0, 1, 2] as const) {
    it(`rebuilds the image header of a headerless codestream (overlap ${overlap})`, async () => {
      const file = fixture(`lossy-ov${overlap}.jxr`)
      const codestream = codestreamOf(file)
      // WIC writes sub-version 1; the rest of its header is what a headerless page implies
      const rebuilt = codestreamOf(
        jpegXrFileFromHeaderless({
          width: 20,
          height: 12,
          overlap,
          alpha: true,
          subVersion: 1,
          planes: codestream.subarray(16),
        }),
      )
      expect(rebuilt).toEqual(codestream)
      const expected = await decodeJpegXr(file, bound)
      const decoded = await decodeJpegXr(
        jpegXrFileFromHeaderless({
          width: 20,
          height: 12,
          overlap,
          alpha: true,
          subVersion: 1,
          planes: codestream.subarray(16),
        }),
        bound,
      )
      expect(decoded).toEqual(expected)
      // lossy, but close to the source
      const error = Math.max(...decoded.pixels.map((value, at) => Math.abs(value - rgba[at]!)))
      expect(error).toBeLessThan(16)
    })
  }

  it('refuses an image past its bound before decoding it', async () => {
    await expect(
      decodeJpegXr(fixture('planar-alpha.jxr'), { maxOutputBytes: bound.maxOutputBytes - 1 }),
    ).rejects.toMatchObject({ code: JPEGXR_OUTPUT_LIMIT })
  })

  it('refuses what is not JPEG XR, and keeps decoding afterwards', async () => {
    await expect(decodeJpegXr(new Uint8Array(64), bound)).rejects.toMatchObject({
      code: JPEGXR_INVALID,
    })
    const file = fixture('lossy-ov1.jxr')
    const truncated = file.slice(0, file.length - 200)
    await expect(decodeJpegXr(truncated, bound)).rejects.toMatchObject({ code: JPEGXR_INVALID })
    expect((await decodeJpegXr(fixture('planar-alpha.jxr'), bound)).pixels).toEqual(rgba)
  })

  it('stops on an aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      decodeJpegXr(fixture('planar-alpha.jxr'), { ...bound, signal: controller.signal }),
    ).rejects.toThrow()
  })
})
/** Standard WIC regressions, explicit component output and optional local HDP pixel-oracle checks. */

// Installed-game assets are not committed. Set this to the locally generated, Colossus-verified
// proof directory to exercise every component count and both 128/32-pixel shapes through WASM.
if (process.env.MODKIT_JXR_HDP_PROOFS) {
  it('matches all 20 real HDP raw pages against the native pixel oracle', async () => {
    const root = process.env.MODKIT_JXR_HDP_PROOFS!
    for (const [x, y] of [
      [170, 6],
      [166, 3],
      [180, 12],
      [184, 25],
      [178, 18],
    ]) {
      for (let layer = 0; layer < 4; layer++) {
        const side = layer === 3 ? 32 : 128
        const input = new Uint8Array(
          readFileSync(join(root, `proof-tile-${x}-${y}-layer${layer}.jxr`)),
        )
        const file = jpegXrFileFromHeaderless({
          width: side,
          height: side,
          overlap: 1,
          subVersion: 1,
          alpha: false,
          output: 'components',
          planes: codestreamOf(input).subarray(16),
        })
        const decoded = await decodeJpegXrComponents(file, {
          dialect: 'hdphoto-independent',
          maxOutputBytes: side * side * 3,
        })
        const expected = readFileSync(join(root, `proof-tile-${x}-${y}-layer${layer}.raw`))
        expect(decoded.componentCount).toBe(layer === 0 ? 3 : layer === 1 ? 2 : 1)
        const tight = new Uint8Array(side * side * decoded.componentCount)
        for (let p = 0; p < side * side; p++)
          tight.set(
            expected.subarray(p * 4, p * 4 + decoded.componentCount),
            p * decoded.componentCount,
          )
        expect(decoded.pixels).toEqual(tight)
        await expect(
          decodeJpegXrComponents(file, {
            dialect: 'hdphoto-independent',
            maxOutputBytes: tight.length - 1,
          }),
        ).rejects.toMatchObject({ code: JPEGXR_OUTPUT_LIMIT })
      }
    }
    expect((await decodeJpegXr(fixture('planar-alpha.jxr'), bound)).pixels).toEqual(rgba)
  })
}
