import { expect, it } from 'vitest'
import { parsePeImage } from '../src/pe/codec.js'

/** A minimal PE32+ image: headers in the first 0x200 bytes, one executable `.text` section. */
function image(): Uint8Array {
  const bytes = new Uint8Array(0x400)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0x5a4d, true) // MZ
  view.setUint32(0x3c, 0x80, true) // e_lfanew
  view.setUint32(0x80, 0x4550, true) // PE\0\0
  const coff = 0x84
  view.setUint16(coff, 0x8664, true) // x64
  view.setUint16(coff + 2, 1, true) // one section
  view.setUint16(coff + 16, 240, true) // optional header size
  const optional = coff + 20
  view.setUint16(optional, 0x20b, true) // PE32+
  view.setUint32(optional + 16, 0x1010, true) // entry point
  view.setBigUint64(optional + 24, 0x140000000n, true) // image base
  view.setUint32(optional + 32, 0x1000, true) // section alignment
  view.setUint32(optional + 36, 0x200, true) // file alignment
  view.setUint32(optional + 56, 0x2000, true) // image size
  view.setUint32(optional + 60, 0x200, true) // header size
  view.setUint16(optional + 68, 3, true) // console
  view.setUint32(optional + 108, 16, true) // data directories
  const section = optional + 240
  bytes.set(new TextEncoder().encode('.text'), section)
  view.setUint32(section + 8, 0x180, true) // virtual size
  view.setUint32(section + 12, 0x1000, true) // virtual address
  view.setUint32(section + 16, 0x200, true) // raw size
  view.setUint32(section + 20, 0x200, true) // raw offset
  view.setUint32(section + 36, 0x60000020, true) // code, execute, read
  return bytes
}

it('reads a PE32+ image base and its sections by virtual and file address', () => {
  const pe = parsePeImage(image())
  expect(pe).toMatchObject({
    pe32Plus: true,
    machine: 0x8664,
    imageBase: 0x140000000n,
    entryPoint: 0x1010,
  })
  expect(pe.sections).toEqual([
    expect.objectContaining({
      name: '.text',
      virtualAddress: 0x1000,
      virtualSize: 0x180,
      rawOffset: 0x200,
      rawSize: 0x200,
      characteristics: 0x60000020,
    }),
  ])
  expect(() => parsePeImage(image().slice(0, 0x100))).toThrow()
})
