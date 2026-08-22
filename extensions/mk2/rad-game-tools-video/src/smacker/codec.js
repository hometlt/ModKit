import { createRadVideoCodec } from '../bink/codec.js'

const ascii = (bytes, offset, length) =>
  new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length))
const u32le = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
const codec = createRadVideoCodec({
  id: 'org.modkitx/smacker',
  formatId: 'smacker',
  label: 'Smacker Video',
  mime: 'video/x-smacker',
  matches: bytes =>
    bytes.byteLength >= 24 && (ascii(bytes, 0, 4) === 'SMK2' || ascii(bytes, 0, 4) === 'SMK4'),
  read: bytes => ({
    magic: ascii(bytes, 0, 4),
    codec: ascii(bytes, 0, 4).toLowerCase(),
    width: u32le(bytes, 12),
    height: u32le(bytes, 16),
    frames: u32le(bytes, 20),
  }),
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
