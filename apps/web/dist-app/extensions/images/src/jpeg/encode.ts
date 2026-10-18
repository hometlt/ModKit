import type { NodeRgbaSequenceEncodeRequest } from '@modkit/host/node'

/** Format-owned still exporter: one RGBA frame to baseline JPEG through the injected Host backend.
 * Uses no process, filesystem or ffmpeg download in the codec. Lossy; alpha is dropped (JPEG has
 * none). `quality` 1..100 maps to ffmpeg's mjpeg qscale 31..2 (default 90). */
export function encodeJpeg(
  request: Omit<NodeRgbaSequenceEncodeRequest, 'outputArguments' | 'frameCount'> & {
    readonly quality?: number
  },
  backend: { encode(request: NodeRgbaSequenceEncodeRequest): Promise<Uint8Array> },
): Promise<Uint8Array> {
  const quality = Math.min(100, Math.max(1, Math.round(request.quality ?? 90)))
  const qscale = Math.round(31 - ((quality - 1) * 29) / 99)
  const { quality: _quality, ...rest } = request
  return backend.encode({
    ...rest,
    frameCount: 1,
    outputArguments: [
      '-frames:v',
      '1',
      '-c:v',
      'mjpeg',
      '-q:v',
      String(qscale),
      '-pix_fmt',
      'yuvj444p',
      '-f',
      'image2pipe',
    ],
  })
}
