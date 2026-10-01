import type { EncodedMediaSource } from '@modkit/sdk'

export interface CollectedEncodedMedia {
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** Materialize an encoded representation only after applying a viewer-owned hard budget. */
export async function collectEncodedMedia(
  source: EncodedMediaSource,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<CollectedEncodedMedia> {
  const descriptor = await source.descriptor()
  if (
    descriptor.bytes > BigInt(maximumBytes) ||
    descriptor.bytes > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError(`encoded media exceeds the stage budget: ${descriptor.bytes} bytes`)
  }
  const total = Number(descriptor.bytes)
  const bytes = new Uint8Array(total)
  let offset = 0
  while (offset < total) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const chunk = await source.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal)
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError('encoded media ended outside its declared size')
    }
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { mediaType: descriptor.mediaType, bytes }
}

/**
 * A canvas's pixels as PNG bytes, through the platform's own encoder. A viewer's export draws on a
 * canvas anyway; importing codec-kit's raster barrel for its encoder carried every raster codec
 * (and the sdk schemas they reach) into each viewer bundle.
 */
export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (blob === null) throw new TypeError('the canvas did not encode as PNG')
  return new Uint8Array(await blob.arrayBuffer())
}
