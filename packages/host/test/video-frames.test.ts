import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createNodeVideoFrameDecoder, findFfmpeg, parsePam } from '../src/node/video-frames.js'

const work = await mkdtemp(join(tmpdir(), 'modkit-video-frames-'))
afterAll(() => rm(work, { recursive: true, force: true }))
const ffmpeg = findFfmpeg()

describe('video frames of a desktop host', () => {
  it('reads an RGBA PAM image into a buffer of its own', () => {
    const header = new TextEncoder().encode(
      'P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n',
    )
    const bytes = new Uint8Array(header.length + 8)
    bytes.set(header)
    bytes.set([1, 2, 3, 4, 5, 6, 7, 8], header.length)
    const image = parsePam(bytes)
    expect([image.width, image.height, [...image.pixels]]).toEqual([2, 1, [1, 2, 3, 4, 5, 6, 7, 8]])
    expect(image.pixels.byteOffset === 0 && image.pixels.buffer.byteLength === 8).toBe(true)
    expect(() => parsePam(bytes.subarray(0, header.length + 4))).toThrow(/truncated/u)
  })

  it('offers no decoder without ffmpeg', () => {
    expect(findFfmpeg({ environment: { PATH: work } })).toBeUndefined()
    expect(createNodeVideoFrameDecoder({ ffmpegPath: join(work, 'missing.exe') })).toBeUndefined()
  })

  it.skipIf(ffmpeg === undefined)(
    'decodes a frame of a real MP4 and refuses one over maxBytes',
    async () => {
      const file = join(work, 'bars.mp4')
      // 64x48 colour bars, 2 s, MPEG-4 Part 2 — an encoder every ffmpeg build carries
      execFileSync(ffmpeg!, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=64x48:rate=10',
        '-t',
        '2',
        '-c:v',
        'mpeg4',
        '-y',
        file,
      ])
      const bytes = new Uint8Array(await readFile(file))
      const decoder = createNodeVideoFrameDecoder()!
      const frame = await decoder.decodeFrame({
        bytes,
        mediaType: 'video/mp4',
        timestampMs: 500,
        maxBytes: 64 * 48 * 4,
      })
      expect([frame.width, frame.height, frame.rowStride, frame.pixelFormat]).toEqual([
        64,
        48,
        256,
        'rgba8',
      ])
      expect(frame.pixels.some(value => value !== 0)).toBe(true)
      await expect(
        decoder.decodeFrame({ bytes, mediaType: 'video/mp4', timestampMs: 500, maxBytes: 100 }),
      ).rejects.toThrow(/exceeds/u)
      await expect(
        decoder.decodeFrame({
          bytes,
          mediaType: 'video/mp4',
          timestampMs: 60_000,
          maxBytes: 64 * 48 * 4,
        }),
      ).rejects.toThrow(/no video\/mp4 frame|ffmpeg/u)
    },
  )
})
