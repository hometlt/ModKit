/**
 * Writing one picture of an ICO/CUR back without touching the others.
 *
 * An icon file is a set of sizes, and the viewer shows (and paints) one of them. Replacing the file
 * with a single image — MK2's export — would silently throw the other sizes away, so this rebuilds
 * the directory instead: every other entry's payload is copied byte for byte, and the edited entry
 * is re-encoded the way it was stored — PNG stays PNG, a DIB becomes a 32-bit DIB with its AND mask.
 */
import { encodePng } from '../writers/png-encoder.js'

/** A 32-bit bottom-up DIB, height doubled for the AND mask as the ICO format requires. */
export function encodeDib(image) {
  const { width, height, pixels } = image
  const maskRow = Math.ceil(width / 32) * 4
  const out = new Uint8Array(40 + width * height * 4 + maskRow * height)
  const header = new DataView(out.buffer)
  header.setUint32(0, 40, true)
  header.setInt32(4, width, true)
  header.setInt32(8, height * 2, true)
  header.setUint16(12, 1, true)
  header.setUint16(14, 32, true)
  const maskStart = 40 + width * height * 4
  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4
      const target = 40 + (row * width + x) * 4
      out[target] = pixels[source + 2]
      out[target + 1] = pixels[source + 1]
      out[target + 2] = pixels[source]
      out[target + 3] = pixels[source + 3]
      // Old renderers ignore alpha and read the mask: a transparent pixel is a masked one.
      if (pixels[source + 3] === 0) out[maskStart + row * maskRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return out
}

export async function replaceIconEntry(bytes, entries, selected, image, cursor, signal) {
  if (image.width < 1 || image.height < 1 || image.width > 256 || image.height > 256) {
    throw new TypeError(
      `an icon picture is 1 to 256 pixels on each side, got ${image.width} x ${image.height}`,
    )
  }
  const replacement =
    selected.payloadKind === 'png'
      ? await encodePng(image.width, image.height, image.pixels, signal)
      : encodeDib(image)
  const payloads = entries.map(entry =>
    entry === selected ? replacement : bytes.subarray(entry.offset, entry.offset + entry.size),
  )
  const directoryEnd = 6 + entries.length * 16
  const out = new Uint8Array(directoryEnd + payloads.reduce((sum, item) => sum + item.length, 0))
  const view = new DataView(out.buffer)
  out.set(bytes.subarray(0, 6))
  let offset = directoryEnd
  entries.forEach((entry, index) => {
    const position = 6 + index * 16
    out.set(bytes.subarray(position, position + 8), position)
    if (entry === selected) {
      out[position] = image.width === 256 ? 0 : image.width
      out[position + 1] = image.height === 256 ? 0 : image.height
      out[position + 2] = 0
      out[position + 3] = 0
      // An icon names its planes and depth here; a cursor its hotspot, kept inside the new size.
      view.setUint16(position + 4, cursor ? Math.min(entry.firstWord, image.width - 1) : 1, true)
      view.setUint16(position + 6, cursor ? Math.min(entry.secondWord, image.height - 1) : 32, true)
    }
    const payload = payloads[index]
    view.setUint32(position + 8, payload.length, true)
    view.setUint32(position + 12, offset, true)
    out.set(payload, offset)
    offset += payload.length
  })
  return out
}
