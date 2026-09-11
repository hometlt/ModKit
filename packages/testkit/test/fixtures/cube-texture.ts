/** Independent DDS RGBA8 cube fixture. Each face and mip has distinct spatial pixels. */
export function cubeTextureFixture() {
  const surfaces = Array.from({ length: 6 }, (_, face) =>
    Array.from({ length: 2 }, (_, mip) => {
      const size = 4 / 2 ** mip
      const rgba = new Uint8Array(size * size * 4)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          rgba.set([face * 40 + mip * 10, x * 60, y * 60, 255], (y * size + x) * 4)
      return rgba
    }),
  )
  const bytes = new Uint8Array(128 + 6 * (4 * 4 + 2 * 2) * 4)
  const header = new DataView(bytes.buffer)
  const set = (offset: number, value: number) => header.setUint32(offset, value, true)
  set(0, 0x2053_4444)
  set(4, 124)
  set(8, 0x0002_1007)
  set(12, 4)
  set(16, 4)
  set(28, 2)
  set(76, 32)
  set(80, 0x41)
  set(88, 32)
  set(92, 0x0000_00ff)
  set(96, 0x0000_ff00)
  set(100, 0x00ff_0000)
  set(104, 0xff00_0000)
  set(108, 0x0040_1008)
  set(112, 0x0000_fe00)
  let offset = 128
  for (const face of surfaces)
    for (const surface of face) {
      bytes.set(surface, offset)
      offset += surface.length
    }
  return { bytes, surfaces }
}
