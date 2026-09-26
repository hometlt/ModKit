import { describe, expect, it } from 'vitest'
import { createVideoMediaSource } from '../src/index.js'

const info = {
  durationMs: 1000,
  seekable: true,
  frameAccess: true,
  tracks: [{ id: 'v1', kind: 'video' as const, codec: 'avc1', selected: true }],
}
const frame = {
  width: 1,
  height: 1,
  rowStride: 4,
  pixelFormat: 'rgba8' as const,
  pixels: new Uint8Array(4),
  timestampMs: 500,
}

describe('video frames', () => {
  it('publishes frameAccess only with a decoder, and hands it the whole file', async () => {
    const bytes = Uint8Array.of(1, 2, 3)
    expect((await createVideoMediaSource(bytes, 'video/mp4', info).info()).frameAccess).toBe(false)
    const seen: unknown[] = []
    const source = createVideoMediaSource(bytes, 'video/mp4', info, {
      async decodeFrame(request) {
        seen.push([request.bytes, request.mediaType, request.timestampMs])
        return frame
      },
    })
    expect((await source.info()).frameAccess).toBe(true)
    const request = { trackId: 'v1', timestampMs: 500, pixelFormat: 'rgba8' as const, maxBytes: 64 }
    expect(await source.readFrame!(request)).toBe(frame)
    expect(seen).toEqual([[bytes, 'video/mp4', 500]])
    await expect(source.readFrame!({ ...request, trackId: 'a1' })).rejects.toThrow(RangeError)
  })
})
