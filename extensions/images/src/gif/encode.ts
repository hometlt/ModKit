import type { NodeRgbaSequenceEncodeRequest } from '@modkit/host/node'

/** Format-owned RGBA sequence exporter, separate from lossless/native editing.
 * Uses an injected Host backend; no process, filesystem or ffmpeg download in the codec.
 * Output is lossy and silent. Infinite looping; GIF timing is quantized to 10 ms. */
export function encodeGif(
  request: Omit<NodeRgbaSequenceEncodeRequest, 'outputArguments'>,
  backend: { encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> },
): Promise<Uint8Array> {
  return backend.encode({
    ...request,
    outputArguments: [
      '-vf',
      'split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1',
      '-loop',
      '0',
      '-f',
      'gif',
    ],
  })
}
