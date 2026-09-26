/** A standard image stored behind a native header: its kind and where it starts. */
export interface EmbeddedImage {
  readonly kind: 'dds' | 'png' | 'tga'
  readonly offset: number
}

/**
 * The first DDS or PNG signature, or a plausible TGA header, starting within `scanBytes` of `head`
 * (MK2's `standardPayloadOffset`, which scanned the first kilobyte). A TGA header reaches 17 bytes
 * past its start, so pass `scanBytes + 17` bytes to see one at the end of the scan.
 */
export function findEmbeddedImage(head: Uint8Array, scanBytes = 1024): EmbeddedImage | undefined {
  const scan = Math.min(head.byteLength, scanBytes)
  const u16 = (at: number) => (head[at] ?? 0) | ((head[at + 1] ?? 0) << 8)
  for (let offset = 0; offset + 8 <= scan; offset += 1) {
    const magic = String.fromCharCode(...head.subarray(offset, offset + 4))
    if (magic === 'DDS ') return { kind: 'dds', offset }
    if (magic === '\x89PNG') return { kind: 'png', offset }
    const width = u16(offset + 12)
    const height = u16(offset + 14)
    if (
      [2, 3, 10, 11].includes(head[offset + 2] ?? 0) &&
      width > 0 &&
      height > 0 &&
      width <= 16384 &&
      height <= 16384 &&
      [8, 16, 24, 32].includes(head[offset + 16] ?? 0)
    )
      return { kind: 'tga', offset }
  }
  return undefined
}
