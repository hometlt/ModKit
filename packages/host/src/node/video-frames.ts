/**
 * `ContributionContext.videoFrames` of a desktop host: one frame decoded by an installed ffmpeg.
 * ffmpeg is not shipped (a build with the common decoders is GPL/LGPL, and the LGPL prebuilt WASM
 * builds leave H.264 out); the host finds it at `ffmpegPath` or on PATH, and offers no decoder
 * without it. The frame leaves ffmpeg as PAM — a text header over raw RGBA — so the host needs no
 * image codec. Codecs never start processes: this is the one place a frame decoder runs.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { ModkitError } from '@modkit/core'
import type { VideoFrame, VideoFrameDecodeRequest, VideoFrameDecoder } from '@modkit/sdk'

export interface NodeVideoFrameDecoderOptions {
  /** An explicit ffmpeg executable; otherwise PATH is searched. */
  readonly ffmpegPath?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  /** A frame that takes longer is refused (default 60 s). */
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
      const directory = await mkdtemp(join(tmpdir(), 'modkit-video-frame-'))
      try {
        const input = join(directory, 'input')
        await writeFile(input, request.bytes)
        const output = await run(
          ffmpeg,
          [
            ['-v', 'error', '-nostdin'],
            ['-ss', (request.timestampMs / 1000).toFixed(3), '-i', input],
            ['-frames:v', '1', '-f', 'image2pipe', '-c:v', 'pam', '-pix_fmt', 'rgba', 'pipe:1'],
          ].flat(),
          request.maxBytes + 4096,
          timeoutMs,
          request.signal,
        )
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
      } finally {
        await rm(directory, { recursive: true, force: true })
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
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ''
    let refusal: Error | undefined
    const stop = (error: Error) => {
      refusal ??= error
      child.kill()
    }
    const timer = setTimeout(
      () => stop(failed(`ffmpeg took longer than ${timeoutMs} ms`)),
      timeoutMs,
    )
    const abort = () => stop(new DOMException('operation cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > maxOutput) stop(new RangeError(`the decoded frame exceeds ${maxOutput} bytes`))
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    child.on('error', error => stop(failed(`ffmpeg could not start: ${error.message}`)))
    child.on('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (refusal !== undefined) reject(refusal)
      else if (code !== 0) reject(failed(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 1024)}`))
      else resolve(Buffer.concat(chunks))
    })
  })
}
