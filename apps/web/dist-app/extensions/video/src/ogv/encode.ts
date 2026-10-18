import type { NodeRgbaSequenceEncodeRequest } from '@modkit/host/node'

/** Format-owned RGBA sequence exporter, separate from lossless/native editing.
 * Uses an injected Host backend; no process, filesystem or ffmpeg download in the codec.
 * Output is lossy and silent. Ogg/Theora quality 7, even dimensions required; audio is not yet supplied. */
export function encodeOgv(
  request: Omit<NodeRgbaSequenceEncodeRequest, 'outputArguments'>,
  backend: { encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> },
): Promise<Uint8Array> {
  if (request.width % 2 || request.height % 2)
    throw new RangeError('OGV requires even width and height')
  return backend.encode({
    ...request,
    outputArguments: ['-c:v', 'libtheora', '-q:v', '7', '-pix_fmt', 'yuv420p', '-f', 'ogg'],
  })
}
