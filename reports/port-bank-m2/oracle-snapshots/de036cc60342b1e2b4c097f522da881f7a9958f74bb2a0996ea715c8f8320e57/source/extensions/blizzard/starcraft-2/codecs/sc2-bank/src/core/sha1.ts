const HEX = '0123456789abcdef'

export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const totalBytes = (((bytes.length + 9 + 63) >> 6) << 6)
  const data = new Uint8Array(totalBytes)
  data.set(bytes)
  data[bytes.length] = 0x80

  const view = new DataView(data.buffer)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  view.setUint32(totalBytes - 8, high, false)
  view.setUint32(totalBytes - 4, low, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const words = new Uint32Array(80)

  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 80; i++) {
      words[i] = rotl((words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!) >>> 0, 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + f + e + k + words[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return wordHex(h0) + wordHex(h1) + wordHex(h2) + wordHex(h3) + wordHex(h4)
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function wordHex(value: number): string {
  let out = ''
  for (let shift = 28; shift >= 0; shift -= 4) out += HEX[(value >>> shift) & 0xf]
  return out
}
