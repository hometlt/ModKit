/** CRC-16/GENIBUS: unreflected 0x1021, initial FFFF, final XOR FFFF.
 * Shared checksum owner; format adapters choose covered bytes and stored result width.
 */
export function crc16Genibus(bytes: Uint8Array): number {
  let crc = 0xffff
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  return crc ^ 0xffff
}
