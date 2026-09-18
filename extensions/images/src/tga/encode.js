/**
 * RGBA8 → uncompressed 32-bit TGA with a top-left origin — MK2 `encodeTgaRgba`, unchanged.
 *
 * The one TGA layout every reader accepts: no colour map, no RLE, eight alpha bits.
 */
export function encodeTga(image) {
  if (image.width > 0xffff || image.height > 0xffff) {
    throw new TypeError('TGA dimensions exceed 65535')
  }
  const out = new Uint8Array(18 + image.width * image.height * 4)
  const header = new DataView(out.buffer)
  out[2] = 2
  header.setUint16(12, image.width, true)
  header.setUint16(14, image.height, true)
  out[16] = 32
  out[17] = 0x28
  for (let source = 0, target = 18; source < image.pixels.length; source += 4, target += 4) {
    out[target] = image.pixels[source + 2]
    out[target + 1] = image.pixels[source + 1]
    out[target + 2] = image.pixels[source]
    out[target + 3] = image.pixels[source + 3]
  }
  return out
}
