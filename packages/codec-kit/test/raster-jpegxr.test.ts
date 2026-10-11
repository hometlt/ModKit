import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  JPEGXR_INVALID,
  JPEGXR_OUTPUT_LIMIT,
  decodeJpegXr,
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

describe('JPEG XR', () => {
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
