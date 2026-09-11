export interface NormalTextureFixture {
  readonly name: string
  readonly bytes: Uint8Array
  readonly format: 'bc5' | 'dxt5nm' | 'luminance-alpha'
  readonly texel: readonly [number, number, number, number]
}

/** Hand-authored constant blocks with index zero, independent of the image encoder. */
export function normalTextureFixtures(): readonly NormalTextureFixture[] {
  return ['BC5U', 'BC5S', 'DXT5', 'L8A8'].map(name => {
    const luminance = name === 'L8A8'
    const bytes = new Uint8Array(128 + (luminance ? 32 : 16))
    const header = new DataView(bytes.buffer)
    for (const [offset, value] of [
      [0, 0x20534444],
      [4, 124],
      [8, 0x21007],
      [12, 4],
      [16, 4],
      [28, 1],
      [76, 32],
      [80, luminance ? 0x20001 : 4],
      [108, 0x1000],
    ] as const)
      header.setUint32(offset, value, true)
    if (luminance) {
      header.setUint32(88, 16, true)
      header.setUint32(92, 255, true)
      header.setUint32(104, 0xff00, true)
      for (let i = 128; i < bytes.length; i += 2) bytes.set([170, 100], i)
      return { name, bytes, format: 'luminance-alpha', texel: [170, 170, 170, 100] }
    }
    bytes.set(new TextEncoder().encode(name), 84)
    if (name === 'DXT5') {
      bytes.set([170, 170], 128)
      header.setUint16(136, 0x400, true)
      header.setUint16(138, 0x400, true)
      return { name, bytes, format: 'dxt5nm', texel: [0, 130, 0, 170] }
    }
    const signed = name === 'BC5S'
    bytes.set(signed ? [65, 65] : [170, 170], 128)
    bytes.set(signed ? [224, 224] : [100, 100], 136)
    return { name, bytes, format: 'bc5', texel: signed ? [193, 95, 0, 255] : [170, 100, 0, 255] }
  })
}
