import { expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createNodeRgbaSequenceEncoder, createNodeVideoFrameDecoder, findFfmpeg } from '../src/node/video-frames.js'
import { encodeGif } from 'modkit-extension-images/formats/gif/encode'
import { encodeWebp } from 'modkit-extension-images/formats/webp/encode'
import { encodeOgv } from 'modkit-extension-video/formats/ogv/encode'

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

/** Hold a real Writable callback so producer/process races do not depend on OS pipe timing. */
function heldEncoder() {
  const writes: { bytes: Buffer; consume: () => void }[] = []
  const child = Object.assign(new EventEmitter(), {
    stdin: new Writable({ write(bytes: Buffer, _encoding, consumed) { writes.push({ bytes, consume: consumed }) } }),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true }),
  })
  vi.mocked(spawn).mockImplementationOnce(() => child as unknown as ReturnType<typeof spawn>)
  return { child, writes }
}

const request = () => ({
  width: 32,
  height: 24,
  fps: 5,
  frameCount: 3,
  maxBytes: 1024 * 1024,
  frames: (async function* () {
    for (let i = 0; i < 3; i++) {
      const pixels = new Uint8Array(32 * 24 * 4)
      for (let p = 0; p < pixels.length; p += 4) {
        pixels[p + i] = 255
        pixels[p + 3] = 255
      }
      yield pixels
    }
  })(),
})

it('does not offer a backend without an installed ffmpeg', () => {
  expect(
    createNodeRgbaSequenceEncoder({ ffmpegPath: 'C:/MKTEMP/not-installed-ffmpeg.exe' }),
  ).toBeUndefined()
})
it.skipIf(!findFfmpeg())(
  'encodes three frames through each format owner and bounds/cancels the stream',
  async () => {
    const backend = createNodeRgbaSequenceEncoder()!
    const gif = await encodeGif(request(), backend)
    const webp = await encodeWebp(request(), backend)
    const ogv = await encodeOgv(request(), backend)
    expect(Buffer.from(gif.subarray(0, 6)).toString()).toBe('GIF89a')
    expect(Buffer.from(webp).includes(Buffer.from('ANMF'))).toBe(true)
    expect(Buffer.from(ogv.subarray(0, 4)).toString()).toBe('OggS')
    await expect(encodeGif({ ...request(), maxBytes: 8 }, backend)).rejects.toThrow(/exceeds/)
    await expect(encodeWebp({ ...request(), frameCount: 2 }, backend)).rejects.toThrow(
      /frame count/,
    )
    await expect(encodeWebp({ ...request(), frameCount: 4 }, backend)).rejects.toThrow(/fewer/)
    expect(() => encodeOgv({ ...request(), width: 31 }, backend)).toThrow(/even/)
    const abort = AbortSignal.abort()
    await expect(encodeGif({ ...request(), signal: abort }, backend)).rejects.toThrow()
    const hanging = {
      ...request(),
      frames: {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
        }),
      },
    }
    await expect(
      encodeGif(hanging, createNodeRgbaSequenceEncoder({ timeoutMs: 100 })!),
    ).rejects.toThrow(/longer/)
  },
  30000,
)

it.skipIf(!findFfmpeg())('streams frames larger than the pipe buffer without waiting for the whole sequence', async () => {
  const width = 640, height = 360
  const frames = (async function* () {
    for (let frame = 0; frame < 3; frame++) {
      const rgba = new Uint8Array(width * height * 4)
      for (let offset = 0; offset < rgba.length; offset += 4) {
        rgba[offset] = (offset / 4 + frame * 31) % 256
        rgba[offset + 1] = frame * 80
        rgba[offset + 2] = 90
        rgba[offset + 3] = 255
      }
      yield rgba
    }
  })()
  const bytes = await encodeWebp({ width, height, fps: 3, frameCount: 3, maxBytes: 4 * 1024 * 1024, frames }, createNodeRgbaSequenceEncoder({ timeoutMs: 20000 })!)
  expect(Buffer.from(bytes).includes(Buffer.from('ANMF'))).toBe(true)
}, 30000)

it.skipIf(!findFfmpeg())('decodes GIF and OGV frames at the requested timestamps in authored color order', async () => {
  const backend = createNodeRgbaSequenceEncoder()!
  const decoder = createNodeVideoFrameDecoder()!
  for (const [encode, mediaType] of [[encodeGif, 'image/gif'], [encodeOgv, 'video/ogg']] as const) {
    const bytes = await encode(request(), backend)
    for (let index = 0; index < 3; index++) {
      const frame = await decoder.decodeFrame({ bytes, mediaType, timestampMs: index * 200, maxBytes: 32 * 24 * 4 })
      expect([frame.width, frame.height, frame.rowStride]).toEqual([32, 24, 32 * 4])
      const mean = [0, 0, 0]
      for (let offset = 0; offset < frame.pixels.length; offset += 4)
        for (let channel = 0; channel < 3; channel++) mean[channel]! += frame.pixels[offset + channel]! / (32 * 24)
      expect(mean[index]).toBeGreaterThan(220)
      for (let channel = 0; channel < 3; channel++) if (channel !== index) expect(mean[channel]).toBeLessThan(40)
    }
  }
}, 30000)

it.skipIf(!findFfmpeg())('cancels an active encoder while its frame producer is stalled', async () => {
  const controller = new AbortController()
  const frames: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>(() => {}) }),
  }
  const pending = encodeWebp({ ...request(), frames, signal: controller.signal }, createNodeRgbaSequenceEncoder({ timeoutMs: 5000 })!)
  const timer = setTimeout(() => controller.abort(), 30)
  try { await expect(pending).rejects.toMatchObject({ name: 'AbortError' }) }
  finally { clearTimeout(timer) }
}, 10000)

it('owns a borrowed frame and waits for its write before requesting the next frame', async () => {
  const { child, writes } = heldEncoder()
  const shared = new Uint8Array(32 * 24 * 4).fill(17)
  let nextCalls = 0
  const frames: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => ++nextCalls <= 3
        ? { done: false as const, value: shared.fill(nextCalls * 17) }
        : { done: true as const, value: undefined },
    }),
  }
  child.stdin.on('finish', () => {
    child.stdout.write(Buffer.from('encoded'))
    child.emit('close', 0)
  })
  const pending = encodeGif({ ...request(), frames }, createNodeRgbaSequenceEncoder({ ffmpegPath: process.execPath })!)
  await vi.waitFor(() => expect(writes).toHaveLength(1))
  shared.fill(99)
  expect(writes[0]!.bytes[0]).toBe(17)
  expect(nextCalls).toBe(1)
  for (let index = 0; index < 3; index++) {
    await vi.waitFor(() => expect(writes).toHaveLength(index + 1))
    expect(writes[index]!.bytes[0]).toBe((index + 1) * 17)
    writes[index]!.consume()
  }
  expect(Buffer.from(await pending).toString()).toBe('encoded')
  expect(nextCalls).toBe(4)
})

it.each(['stalled', 'under-count'] as const)('rejects clean process exit before %s input is validated', async kind => {
  const { child, writes } = heldEncoder()
  const returned = vi.fn(async () => ({ done: true as const, value: undefined }))
  const frames: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: kind === 'stalled'
        ? () => new Promise<IteratorResult<Uint8Array>>(() => {})
        : async () => ({ done: false as const, value: new Uint8Array(32 * 24 * 4) }),
      return: returned,
    }),
  }
  const pending = encodeGif({ ...request(), frames }, createNodeRgbaSequenceEncoder({ ffmpegPath: process.execPath })!)
  const rejected = expect(pending).rejects.toThrow(/before the input sequence completed/)
  if (kind === 'under-count') await vi.waitFor(() => expect(writes).toHaveLength(1))
  child.emit('close', 0)
  await rejected
  if (kind === 'under-count') {
    writes[0]!.consume()
    await vi.waitFor(() => expect(returned).toHaveBeenCalledOnce())
  }
})

it.skipIf(!findFfmpeg())('decodes reusable producer buffers in RGB order', async () => {
  const shared = new Uint8Array(32 * 24 * 4)
  async function* frames() {
    for (let channel = 0; channel < 3; channel++) {
      shared.fill(0)
      for (let offset = 0; offset < shared.length; offset += 4) {
        shared[offset + channel] = 255
        shared[offset + 3] = 255
      }
      yield shared
    }
  }
  const bytes = await encodeGif({ ...request(), frames: frames() }, createNodeRgbaSequenceEncoder()!)
  for (let channel = 0; channel < 3; channel++) {
    const frame = await createNodeVideoFrameDecoder()!.decodeFrame({ bytes, mediaType: 'image/gif', timestampMs: channel * 200, maxBytes: shared.length })
    expect(frame.pixels[channel]).toBeGreaterThan(220)
    expect(frame.pixels[(channel + 1) % 3]).toBeLessThan(40)
  }
}, 30000)
