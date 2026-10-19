/**
 * `ContributionContext.videoFrames` of a desktop host: one frame decoded by an installed ffmpeg.
 * ffmpeg is not shipped (a build with the common decoders is GPL/LGPL, and the LGPL prebuilt WASM
 * builds leave H.264 out); the host finds it at `ffmpegPath` or on PATH, and offers no decoder
 * without it. The frame leaves ffmpeg as PAM — a text header over raw RGBA — so the host needs no
 * image codec. Codecs never start processes: this owns bounded decoding and RGBA sequence encoding.
 * GIF/WebP/OGV modules own encoding arguments; callers stream frames with backpressure.
 * Encoding deadlines bound each producer wait, pipe write and final flush separately: scene rendering
 * must not consume the next frame's encoder allowance. Caller cancellation still bounds the operation.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { isModkitError, ModkitError } from '@modkit/core'
import type { VideoFrame, VideoFrameDecodeRequest, VideoFrameDecoder } from '@modkit/sdk'

export interface NodeVideoFrameDecoderOptions {
  /** An explicit ffmpeg executable; otherwise PATH is searched. */
  readonly ffmpegPath?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  /** Decoder deadline (default 60 s); encoder progress/one frame producer wait (default 180 s). */
  readonly timeoutMs?: number
}

/** The ffmpeg executable to run: `ffmpegPath` when it exists, else the first one on PATH. */
export function findFfmpeg(options: NodeVideoFrameDecoderOptions = {}): string | undefined {
  if (options.ffmpegPath !== undefined)
    return existsSync(options.ffmpegPath) ? options.ffmpegPath : undefined
  const environment = options.environment ?? process.env
  const name = (options.platform ?? process.platform) === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const path = environment['PATH'] ?? environment['Path'] ?? ''
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory.replace(/^"|"$/gu, ''), name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** RGBA pixels of a PAM image (`P7`, `DEPTH 4`, `MAXVAL 255`), copied into a buffer of their own. */
export function parsePam(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const end = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf('ENDHDR\n')
  if (end < 0) throw new TypeError('ffmpeg returned no PAM header')
  const header = new TextDecoder().decode(bytes.subarray(0, end))
  const field = (key: string) => Number(new RegExp(`^${key} (\\d+)$`, 'mu').exec(header)?.[1])
  const width = field('WIDTH')
  const height = field('HEIGHT')
  if (!header.startsWith('P7') || field('DEPTH') !== 4 || field('MAXVAL') !== 255)
    throw new TypeError('ffmpeg returned a PAM image that is not 8-bit RGBA')
  if (!(width > 0 && height > 0)) throw new TypeError('ffmpeg returned a PAM image without size')
  const start = end + 'ENDHDR\n'.length
  const length = width * height * 4
  if (bytes.byteLength - start < length) throw new TypeError('ffmpeg returned a truncated frame')
  const pixels = new Uint8Array(length)
  pixels.set(bytes.subarray(start, start + length))
  return { width, height, pixels }
}

const failed = (message: string) =>
  new ModkitError({ code: 'x3.host/video-frame-decode-failed', message })

/**
 * Who a video's bytes are, cheaply: their length and 32 windows spread over them. The bytes arrive
 * anew with every frame (a copy across the worker boundary), so identity cannot say it.
 */
function fingerprintOf(bytes: Uint8Array): string {
  // ponytail: sampled, not a full hash; two videos alike in length and every window would share it
  const hash = createHash('sha256').update(String(bytes.byteLength))
  const window = 4096
  for (let index = 0; index < 32; index += 1) {
    const start = Math.floor(((bytes.byteLength - window) * index) / 31)
    hash.update(bytes.subarray(Math.max(0, start), Math.max(0, start) + window))
  }
  return hash.digest('hex')
}

/** The last video written for ffmpeg: its next frames read the same file instead of a new copy. */
let written:
  | { readonly fingerprint: string; readonly directory: string; readonly input: Promise<string> }
  | undefined
let cleanupRegistered = false

async function inputFileOf(bytes: Uint8Array): Promise<string> {
  const fingerprint = fingerprintOf(bytes)
  if (written?.fingerprint === fingerprint) return written.input
  const previous = written
  const directory = await mkdtemp(join(tmpdir(), 'modkit-video-frame-'))
  const input = join(directory, 'input')
  written = { fingerprint, directory, input: writeFile(input, bytes).then(() => input) }
  if (!cleanupRegistered) {
    cleanupRegistered = true
    process.once('exit', () => {
      if (written !== undefined) rmSync(written.directory, { recursive: true, force: true })
    })
  }
  // ponytail: a frame of the previous video still decoding loses its file; it fails and is asked again
  if (previous !== undefined) void rm(previous.directory, { recursive: true, force: true })
  try {
    return await written.input
  } catch (error) {
    written = undefined
    throw error
  }
}

/** The desktop decoder, or undefined when no ffmpeg can be found. */
export function createNodeVideoFrameDecoder(
  options: NodeVideoFrameDecoderOptions = {},
): VideoFrameDecoder | undefined {
  const ffmpeg = findFfmpeg(options)
  if (ffmpeg === undefined) return undefined
  const timeoutMs = options.timeoutMs ?? 60_000
  return Object.freeze<VideoFrameDecoder>({
    async decodeFrame(request: VideoFrameDecodeRequest): Promise<VideoFrame> {
      request.signal?.throwIfAborted()
      if (!Number.isFinite(request.timestampMs) || request.timestampMs < 0)
        throw new RangeError('a frame timestamp is a non-negative number of milliseconds')
      {
        const input = await inputFileOf(request.bytes)
        const at = (request.timestampMs / 1000).toFixed(3)
        const decode = (seek: readonly string[]) =>
          run(
            ffmpeg,
            [
              ['-v', 'error', '-nostdin'],
              seek,
              ['-frames:v', '1', '-f', 'image2pipe', '-c:v', 'pam', '-pix_fmt', 'rgba', 'pipe:1'],
            ].flat(),
            request.maxBytes + 4096,
            timeoutMs,
            request.signal,
          )
        // Seeking the input is fast, but some demuxers cannot seek at all (Westwood VQA `wsvqa`
        // yields nothing, even at 0): then seek the output, decoding from the start.
        let output = await decode(['-ss', at, '-i', input]).catch((error: unknown) => {
          if (isModkitError(error) && error.code === 'x3.host/video-frame-decode-failed')
            return new Uint8Array()
          throw error
        })
        if (output.byteLength === 0) output = await decode(['-i', input, '-ss', at])
        if (output.byteLength === 0)
          throw failed(`no ${request.mediaType} frame at ${request.timestampMs} ms`)
        const { width, height, pixels } = parsePam(output)
        if (pixels.byteLength > request.maxBytes)
          throw new RangeError(`a ${width}x${height} frame exceeds maxBytes ${request.maxBytes}`)
        return Object.freeze({
          width,
          height,
          rowStride: width * 4,
          pixelFormat: 'rgba8',
          pixels,
          timestampMs: request.timestampMs,
        })
      }
    },
  })
}

function run(
  executable: string,
  args: readonly string[],
  maxOutput: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  input?: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    const stopped = new AbortController()
    let size = 0
    let stderr = ''
    let refusal: Error | undefined
    let inputComplete = input === undefined
    const stop = (error: Error) => {
      refusal ??= error
      stopped.abort(error)
      child.kill()
    }
    let timer: ReturnType<typeof setTimeout>
    const deadline = (phase: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => stop(failed(`${phase} took longer than ${timeoutMs} ms`)), timeoutMs)
    }
    deadline('ffmpeg')
    const abort = () => stop(new DOMException('operation cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxOutput) stop(new RangeError(`the decoded frame exceeds ${maxOutput} bytes`))
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length)
    })
    child.on('error', error => stop(failed(`ffmpeg could not start: ${error.message}`)))
    child.stdin.on('error', error => stop(error))
    // One frame at a time, respecting pipe backpressure; never retain a raw movie in memory.
    void (async () => {
      if (input !== undefined) {
        const iterator = input[Symbol.asyncIterator]()
        const cancelled = new Promise<never>((_, fail) => {
          const abortInput = () => fail(stopped.signal.reason)
          if (stopped.signal.aborted) abortInput()
          else stopped.signal.addEventListener('abort', abortInput, { once: true })
        })
        try {
          for (;;) {
            deadline('RGBA frame producer')
            const next = await Promise.race([iterator.next(), cancelled])
            if (!stopped.signal.aborted) deadline('ffmpeg')
            if (next.done) break
            stopped.signal.throwIfAborted()
            // Own the bytes until the pipe consumes them; producers may reuse their frame buffer.
            await Promise.race([
              new Promise<void>((written, fail) => {
                child.stdin.write(Buffer.from(next.value), error => error ? fail(error) : written())
              }),
              cancelled,
            ])
          }
        } finally {
          // A pending producer next() may defer return(); cancellation cannot force its completion.
          void iterator.return?.().catch(() => {})
        }
      }
      inputComplete = true
      child.stdin.end()
    })().catch(error => stop(error instanceof Error ? error : new Error(String(error))))
    child.on('close', code => {
      stopped.abort(new Error('ffmpeg closed'))
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (refusal !== undefined) reject(refusal)
      else if (code !== 0) reject(failed(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 1024)}`))
      else if (!inputComplete) reject(failed('ffmpeg closed before the input sequence completed'))
      else resolve(Buffer.concat(chunks))
    })
  })
}

/** Node media owner: bounded raw RGBA sequence encoding using installed ffmpeg.
 * No game semantics, file staging, downloader or browser dependency; callers supply sampled frames.
 * Trusted format exporters supply output arguments; never accept these from an MCP/tool request.
 */
export function createNodeRgbaSequenceEncoder(options: NodeVideoFrameDecoderOptions = {}) {
  const ffmpeg = findFfmpeg(options)
  if (ffmpeg === undefined) return undefined
  const timeoutMs = options.timeoutMs ?? 180_000
  return Object.freeze({
    async encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> {
      const { width, height, fps, frameCount, signal } = request
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 2048 ||
        height > 2048 ||
        !Number.isFinite(fps) ||
        fps < 1 ||
        fps > 50 ||
        !Number.isInteger(frameCount) ||
        frameCount < 1 ||
        frameCount > 300 ||
        width * height * frameCount > 64_000_000 ||
        !Number.isSafeInteger(request.maxBytes) ||
        request.maxBytes < 1 ||
        request.maxBytes > 64 * 1024 * 1024
      )
        throw new RangeError('animation exceeds format, dimensions, FPS, frame or byte budget')
      signal?.throwIfAborted()
      async function* frames() {
        let count = 0
        for await (const rgba of request.frames) {
          signal?.throwIfAborted()
          if (++count > frameCount || rgba.byteLength !== width * height * 4)
            throw new RangeError('animation frame count or RGBA dimensions differ from the request')
          yield rgba
        }
        if (count !== frameCount) throw new RangeError('animation has fewer frames than requested')
      }
      return run(
        ffmpeg,
        [
          '-v',
          'error',
          '-nostdin',
          '-f',
          'rawvideo',
          '-pixel_format',
          'rgba',
          '-video_size',
          `${width}x${height}`,
          '-framerate',
          String(fps),
          '-i',
          'pipe:0',
          '-an',
          ...request.outputArguments,
          'pipe:1',
        ],
        request.maxBytes,
        timeoutMs,
        signal,
        frames(),
      )
    },
  })
}

export interface NodeRgbaSequenceEncodeRequest {
  /** Only trusted format implementations supply ffmpeg output switches. */
  readonly outputArguments: readonly string[]
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frameCount: number
  readonly maxBytes: number
  readonly frames: AsyncIterable<Uint8Array>
  readonly signal?: AbortSignal
}
