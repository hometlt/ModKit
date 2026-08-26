/**
 * ETC1 / ETC2 block decoding, written from the format specification.
 *
 * Block 12 slice 12-5 (exit-gate line 2b). The canonical stack decodes these through a third-party
 * `texture2ddecoder` WASM package — a binary dependency, not an algorithm that can be read across —
 * so this is a clean implementation from the Khronos description rather than a port. That is the
 * rule the slice was given for non-vendorable canon decoders, and ETC is the format on that list
 * where it is honest: the block layout is fully documented and small.
 *
 * What is decoded here, and what is not:
 *
 *   decoded    ETC1_RGB, ETC2_RGB(+sRGB), ETC2_RGB_A1(+sRGB), ETC2_RGBA(+sRGB)
 *   not        EAC_R11 / EAC_RG11 (signed and unsigned)
 *
 * The remainder is named rather than approximated. EAC's 11-bit single- and dual-channel blocks are
 * a different codeword layout with their own multiplier and table rules; they are not RGB data, and
 * producing an RGBA image from them would mean choosing a channel mapping the format does not
 * specify. A caller asking for those gets `undefined` here and `decodedAccess: false` from the
 * codec, which is the truthful answer rather than a plausible picture.
 */

/** ETC1 intensity modifiers, indexed by table codeword then by the two-bit pixel index. */
const MODIFIERS = Object.freeze([
  Object.freeze([2, 8, -2, -8]),
  Object.freeze([5, 17, -5, -17]),
  Object.freeze([9, 29, -9, -29]),
  Object.freeze([13, 42, -13, -42]),
  Object.freeze([18, 60, -18, -60]),
  Object.freeze([24, 80, -24, -80]),
  Object.freeze([33, 106, -33, -106]),
  Object.freeze([47, 183, -47, -183]),
])

/** ETC2 T- and H-mode distances. */
const DISTANCES = Object.freeze([3, 6, 11, 16, 23, 32, 41, 64])

/** EAC alpha modifier table, indexed by table codeword then by the three-bit pixel index. */
const ALPHA_MODIFIERS = Object.freeze([
  Object.freeze([-3, -6, -9, -15, 2, 5, 8, 14]),
  Object.freeze([-3, -7, -10, -13, 2, 6, 9, 12]),
  Object.freeze([-2, -5, -8, -13, 1, 4, 7, 12]),
  Object.freeze([-2, -4, -6, -13, 1, 3, 5, 12]),
  Object.freeze([-3, -6, -8, -12, 2, 5, 7, 11]),
  Object.freeze([-3, -7, -9, -11, 2, 6, 8, 10]),
  Object.freeze([-4, -7, -8, -11, 3, 6, 7, 10]),
  Object.freeze([-3, -5, -8, -11, 2, 4, 7, 10]),
  Object.freeze([-2, -6, -8, -10, 1, 5, 7, 9]),
  Object.freeze([-2, -5, -8, -10, 1, 4, 7, 9]),
  Object.freeze([-2, -4, -8, -10, 1, 3, 7, 9]),
  Object.freeze([-2, -5, -7, -10, 1, 4, 6, 9]),
  Object.freeze([-3, -4, -7, -10, 2, 3, 6, 9]),
  Object.freeze([-1, -2, -3, -10, 0, 1, 2, 9]),
  Object.freeze([-4, -6, -8, -9, 3, 5, 7, 8]),
  Object.freeze([-3, -5, -7, -9, 2, 4, 6, 8]),
])

const clamp = value => (value < 0 ? 0 : value > 255 ? 255 : value)

/** 4-bit to 8-bit by replication, 5-bit to 8-bit by shift-and-fill: the spec's own extensions. */
const extend4 = value => (value << 4) | value
const extend5 = value => (value << 3) | (value >> 2)
const extend6 = value => (value << 2) | (value >> 4)
const extend7 = value => (value << 1) | (value >> 6)

/** Three-bit two's-complement, as the differential mode stores its deltas. */
const signed3 = value => ((value & 0x4) === 0 ? value : value - 8)

function writePixel(out, stride, x, y, r, g, b, a) {
  const offset = y * stride + x * 4
  out[offset] = r
  out[offset + 1] = g
  out[offset + 2] = b
  out[offset + 3] = a
}

/**
 * One 64-bit ETC colour block into the output at (originX, originY).
 *
 * `punchthrough` is ETC2's A1 mode: the differential bit is reused to mean "some pixels are fully
 * transparent", which is why alpha has to be decided here rather than by the caller.
 */
function decodeColourBlock(block, out, stride, originX, originY, punchthrough, alpha) {
  const b0 = block[0]
  const b1 = block[1]
  const b2 = block[2]
  const b3 = block[3]
  const flip = (b3 & 0x1) !== 0
  const diff = (b3 & 0x2) !== 0
  const pixels = (block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7]

  const indexOf = (x, y) => {
    const bit = x * 4 + y
    const lsb = (pixels >>> bit) & 1
    const msb = (pixels >>> (16 + bit)) & 1
    return (msb << 1) | lsb
  }

  if (diff || punchthrough) {
    const r5 = b0 >> 3
    const g5 = b1 >> 3
    const b5 = b2 >> 3
    const dr = signed3(b0 & 0x7)
    const dg = signed3(b1 & 0x7)
    const db = signed3(b2 & 0x7)
    const r = r5 + dr
    const g = g5 + dg
    const b = b5 + db
    // an out-of-range channel is ETC2's escape into a different mode; which channel says which mode
    if (r < 0 || r > 31)
      return decodeTMode(block, out, stride, originX, originY, indexOf, alpha, punchthrough)
    if (g < 0 || g > 31)
      return decodeHMode(block, out, stride, originX, originY, indexOf, alpha, punchthrough)
    if (b < 0 || b > 31) return decodePlanar(block, out, stride, originX, originY, alpha)
  }

  let base1
  let base2
  if (diff) {
    base1 = [extend5(b0 >> 3), extend5(b1 >> 3), extend5(b2 >> 3)]
    base2 = [
      extend5((b0 >> 3) + signed3(b0 & 0x7)),
      extend5((b1 >> 3) + signed3(b1 & 0x7)),
      extend5((b2 >> 3) + signed3(b2 & 0x7)),
    ]
  } else {
    base1 = [extend4(b0 >> 4), extend4(b1 >> 4), extend4(b2 >> 4)]
    base2 = [extend4(b0 & 0xf), extend4(b1 & 0xf), extend4(b2 & 0xf)]
  }
  const table1 = MODIFIERS[(b3 >> 5) & 0x7]
  const table2 = MODIFIERS[(b3 >> 2) & 0x7]

  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const first = flip ? y < 2 : x < 2
      const base = first ? base1 : base2
      const table = first ? table1 : table2
      const index = indexOf(x, y)
      /*
       * Punchthrough: index 2 is "fully transparent, and the colour is the unmodified base". The
       * modifier is not applied, so a transparent texel does not smuggle a colour shift into a
       * later blend.
       */
      const transparent = punchthrough && (block[3] & 0x2) === 0 && index === 2
      const modifier = transparent ? 0 : table[index]
      writePixel(
        out,
        stride,
        originX + x,
        originY + y,
        clamp(base[0] + modifier),
        clamp(base[1] + modifier),
        clamp(base[2] + modifier),
        transparent ? 0 : (alpha?.[y * 4 + x] ?? 255),
      )
    }
  }
  return undefined
}

function decodeTMode(block, out, stride, originX, originY, indexOf, alpha, punchthrough) {
  const r1 = extend4((((block[0] >> 3) & 0x3) << 2) | (block[0] & 0x3))
  const g1 = extend4(block[1] >> 4)
  const b1 = extend4(block[1] & 0xf)
  const r2 = extend4(block[2] >> 4)
  const g2 = extend4(block[2] & 0xf)
  const b2 = extend4(block[3] >> 4)
  const distance = DISTANCES[(((block[3] >> 2) & 0x3) << 1) | (block[3] & 0x1)]
  const palette = [
    [r1, g1, b1],
    [clamp(r2 + distance), clamp(g2 + distance), clamp(b2 + distance)],
    [r2, g2, b2],
    [clamp(r2 - distance), clamp(g2 - distance), clamp(b2 - distance)],
  ]
  paint(block, out, stride, originX, originY, indexOf, palette, alpha, punchthrough)
}

function decodeHMode(block, out, stride, originX, originY, indexOf, alpha, punchthrough) {
  const r1 = extend4((block[0] >> 3) & 0xf)
  const g1 = extend4((((block[0] & 0x7) << 1) | ((block[1] >> 4) & 0x1)) & 0xf)
  const b1 = extend4(((block[1] & 0x8) | ((block[1] & 0x3) << 1) | ((block[2] >> 7) & 0x1)) & 0xf)
  const r2 = extend4((block[2] >> 3) & 0xf)
  const g2 = extend4((((block[2] & 0x7) << 1) | (block[3] >> 7)) & 0xf)
  const b2 = extend4((block[3] >> 3) & 0xf)
  let index = (((block[3] >> 2) & 0x1) << 1) | (block[3] & 0x1)
  // the H-mode distance index is completed by comparing the two base colours, per the spec
  if (((r1 << 16) | (g1 << 8) | b1) >= ((r2 << 16) | (g2 << 8) | b2)) index |= 4
  const distance = DISTANCES[index & 0x7]
  const palette = [
    [clamp(r1 + distance), clamp(g1 + distance), clamp(b1 + distance)],
    [clamp(r1 - distance), clamp(g1 - distance), clamp(b1 - distance)],
    [clamp(r2 + distance), clamp(g2 + distance), clamp(b2 + distance)],
    [clamp(r2 - distance), clamp(g2 - distance), clamp(b2 - distance)],
  ]
  paint(block, out, stride, originX, originY, indexOf, palette, alpha, punchthrough)
}

function decodePlanar(block, out, stride, originX, originY, alpha) {
  const ro = extend6(((block[0] & 0x7e) >> 1) & 0x3f)
  const go = extend7(((block[0] & 0x1) << 6) | ((block[1] >> 1) & 0x3f))
  const bo = extend6(
    (((block[1] & 0x1) << 5) | (((block[2] >> 3) & 0x3) << 3) | (block[2] & 0x7)) & 0x3f,
  )
  const rh = extend6((((block[3] >> 3) & 0x1f) << 1) | ((block[3] >> 2) & 0x1))
  const gh = extend7(block[4] >> 1)
  const bh = extend6(((block[4] & 0x1) << 5) | ((block[5] >> 3) & 0x1f))
  const rv = extend6((((block[5] & 0x7) << 3) | (block[6] >> 5)) & 0x3f)
  const gv = extend7((((block[6] & 0x1f) << 2) | (block[7] >> 6)) & 0x7f)
  const bv = extend6(block[7] & 0x3f)
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      writePixel(
        out,
        stride,
        originX + x,
        originY + y,
        clamp((x * (rh - ro) + y * (rv - ro) + 4 * ro + 2) >> 2),
        clamp((x * (gh - go) + y * (gv - go) + 4 * go + 2) >> 2),
        clamp((x * (bh - bo) + y * (bv - bo) + 4 * bo + 2) >> 2),
        alpha?.[y * 4 + x] ?? 255,
      )
    }
  }
}

function paint(block, out, stride, originX, originY, indexOf, palette, alpha, punchthrough) {
  const opaque = (block[3] & 0x2) !== 0
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const index = indexOf(x, y)
      const transparent = punchthrough && !opaque && index === 2
      const colour = palette[index]
      writePixel(
        out,
        stride,
        originX + x,
        originY + y,
        colour[0],
        colour[1],
        colour[2],
        transparent ? 0 : (alpha?.[y * 4 + x] ?? 255),
      )
    }
  }
}

/** One 64-bit EAC alpha block into 16 alpha values, in row-major pixel order. */
function decodeAlphaBlock(block) {
  const base = block[0]
  const multiplier = block[1] >> 4
  const table = ALPHA_MODIFIERS[block[1] & 0xf]
  // the 48 index bits are big-endian; reading them as a BigInt keeps the shifts honest past 2^32
  let bits = 0n
  for (let index = 2; index < 8; index += 1) bits = (bits << 8n) | BigInt(block[index])
  const alpha = new Uint8Array(16)
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      const shift = BigInt(45 - 3 * (x * 4 + y))
      const index = Number((bits >> shift) & 0x7n)
      alpha[y * 4 + x] = clamp(base + table[index] * (multiplier === 0 ? 1 : multiplier))
    }
  }
  return alpha
}

/**
 * Decode an ETC payload into RGBA8 covering the *encoded* (block-aligned) extent.
 *
 * Returns `undefined` for a format this implementation does not decode, so the caller can report
 * `decodedAccess: false` rather than publish something invented.
 */
export function decodeEtcRgba(payload, blocksWide, blocksHigh, format) {
  const alphaFirst = format.includes('RGBA') || format.includes('SRGBA')
  const punchthrough = format.includes('A1')
  const rgb = format.includes('ETC1') || format.includes('ETC2_RGB') || format.includes('ETC2_SRGB')
  if (!rgb) return undefined

  const blockBytes = alphaFirst ? 16 : 8
  const needed = blocksWide * blocksHigh * blockBytes
  if (payload.byteLength < needed)
    throw new RangeError('PKM payload is shorter than its block grid')

  const width = blocksWide * 4
  const stride = width * 4
  const out = new Uint8Array(stride * blocksHigh * 4)
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const offset = (by * blocksWide + bx) * blockBytes
      const alpha = alphaFirst ? decodeAlphaBlock(payload.subarray(offset, offset + 8)) : undefined
      const colour = payload.subarray(alphaFirst ? offset + 8 : offset, offset + blockBytes)
      decodeColourBlock(colour, out, stride, bx * 4, by * 4, punchthrough, alpha)
    }
  }
  return out
}
