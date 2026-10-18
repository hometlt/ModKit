/**
 * The images extension's formats as `MediaEncoder`s (`@modkit/sdk` media export): GIF and WebP
 * animations, still WebP and JPEG. Each wraps this extension's own encoder (`gif/encode`,
 * `webp/encode`, `jpeg/encode`), which owns its ffmpeg arguments; the RGBA sequence backend is the
 * host's (`createNodeRgbaSequenceEncoder` in `@modkit/host/node`) and is injected by the application.
 * PNG and TGA are codec-kit's and listed by `@modkit/ui/media-export` itself.
 */
import type { NodeRgbaSequenceEncodeRequest } from '@modkit/host/node'
import type { MediaEncodeRequest, MediaEncoder } from '@modkit/sdk'
import { encodeGif } from './gif/encode.js'
import { encodeJpeg } from './jpeg/encode.js'
import { encodeWebp } from './webp/encode.js'

type Backend = { encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> }

/** The host backend takes frames as a stream; the media orchestration hands them over drawn. */
async function* stream(frames: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const frame of frames) yield frame
}

const sequence = (request: MediaEncodeRequest) => ({
  width: request.width,
  height: request.height,
  fps: request.fps,
  frameCount: request.frames.length,
  frames: stream(request.frames),
  maxBytes: request.maxBytes,
  ...(request.signal === undefined ? {} : { signal: request.signal }),
})

/** Encoders of this extension over `backend`; none when the application has no backend. */
export function imageMediaEncoders(backend: Backend | undefined): readonly MediaEncoder[] {
  if (backend === undefined) return Object.freeze([])
  return Object.freeze([
    Object.freeze({
      offer: Object.freeze({
        id: 'gif',
        label: 'GIF',
        kind: 'animation',
        extension: '.gif',
        mediaType: 'image/gif',
        alpha: false,
        lossy: true,
        timing: 'centisecond',
        maxFrames: 300,
      }),
      encode: (request: MediaEncodeRequest) => encodeGif(sequence(request), backend),
    }),
    Object.freeze({
      offer: Object.freeze({
        id: 'webp',
        label: 'WebP animation',
        kind: 'animation',
        extension: '.webp',
        mediaType: 'image/webp',
        alpha: true,
        lossy: true,
        timing: 'millisecond',
        maxFrames: 300,
      }),
      encode: (request: MediaEncodeRequest) => encodeWebp(sequence(request), backend),
    }),
    Object.freeze({
      offer: Object.freeze({
        id: 'webp-still',
        label: 'WebP',
        kind: 'still',
        extension: '.webp',
        mediaType: 'image/webp',
        alpha: true,
        lossy: true,
      }),
      encode: (request: MediaEncodeRequest) =>
        encodeWebp(
          { ...sequence(request), frameCount: 1, frames: stream(request.frames.slice(0, 1)) },
          backend,
        ),
    }),
    Object.freeze({
      offer: Object.freeze({
        id: 'jpeg',
        label: 'JPEG',
        kind: 'still',
        extension: '.jpg',
        mediaType: 'image/jpeg',
        alpha: false,
        lossy: true,
      }),
      encode: (request: MediaEncodeRequest) => {
        const { frameCount: _frameCount, ...rest } = sequence({
          ...request,
          frames: request.frames.slice(0, 1),
        })
        return encodeJpeg(
          { ...rest, ...(request.quality === undefined ? {} : { quality: request.quality }) },
          backend,
        )
      },
    }),
  ] satisfies MediaEncoder[])
}
