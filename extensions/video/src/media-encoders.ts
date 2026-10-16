/**
 * The video extension's formats as `MediaEncoder`s (`@modkit/sdk` media export): Ogg Theora, over
 * this extension's own `ogv/encode` (which owns the ffmpeg arguments) and the host RGBA sequence
 * backend the application injects. Silent: no owner mixes a sound track yet.
 */
import type { NodeRgbaSequenceEncodeRequest } from '@modkit/host/node'
import type { MediaEncodeRequest, MediaEncoder } from '@modkit/sdk'
import { encodeOgv } from './ogv/encode.js'

type Backend = { encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> }

async function* stream(frames: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const frame of frames) yield frame
}

/** Encoders of this extension over `backend`; none when the application has no backend. */
export function videoMediaEncoders(backend: Backend | undefined): readonly MediaEncoder[] {
  if (backend === undefined) return Object.freeze([])
  const ogv: MediaEncoder = Object.freeze({
    offer: Object.freeze({
      id: 'ogv',
      label: 'Ogg Theora video',
      kind: 'animation',
      extension: '.ogv',
      mediaType: 'video/ogg',
      alpha: false,
      lossy: true,
      evenDimensions: true,
      timing: 'frame-rate',
      maxFrames: 300,
    }),
    encode: (request: MediaEncodeRequest) =>
      encodeOgv(
        {
          width: request.width,
          height: request.height,
          fps: request.fps,
          frameCount: request.frames.length,
          frames: stream(request.frames),
          maxBytes: request.maxBytes,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
        backend,
      ),
  })
  return Object.freeze([ogv])
}
