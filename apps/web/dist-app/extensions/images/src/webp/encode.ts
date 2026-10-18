import type { NodeRgbaSequenceEncodeRequest } from '@modkit/host/node'

/** Format-owned RGBA sequence exporter, separate from lossless/native editing.
 * Uses an injected Host backend; no process, filesystem or ffmpeg download in the codec.
 * Output is lossy and silent. Infinite looping WebP, quality 80. */
export function encodeWebp(
  request: Omit<NodeRgbaSequenceEncodeRequest, 'outputArguments'>,
  backend: { encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> },
): Promise<Uint8Array> {
  return backend.encode({
    ...request,
    outputArguments: ['-c:v', 'libwebp_anim', '-quality', '80', '-loop', '0', '-f', 'webp'],
  })
}
