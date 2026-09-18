import { encodePng } from '@modkit/codec-kit/raster'

/**
 * Deterministically encode a tightly packed RGBA8 frame as PNG.
 *
 * The encoder is the one every image codec uses (`@modkit/codec-kit/raster`); this checks that a
 * rendered frame is what it claims to be before handing it over.
 */
export async function encodeRgbaPng(
  frame: { width: number; height: number; rgba: Uint8Array },
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(frame.width) ||
    frame.width <= 0 ||
    !Number.isSafeInteger(frame.height) ||
    frame.height <= 0 ||
    !(frame.rgba instanceof Uint8Array) ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  ) {
    throw new TypeError('PNG input must be a tightly packed positive RGBA8 frame')
  }
  return encodePng(frame.width, frame.height, frame.rgba, signal)
}
