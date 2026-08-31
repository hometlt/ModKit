/**
 * Dependency-free ASTC 2D LDR decoder subset, written from Khronos Data Format Specification 1.4
 * chapter 23. The accepted ordinary-block surface is deliberately explicit:
 *
 * - one partition;
 * - five block modes pinned against independent Arm astcenc 5.6.0 fixtures;
 * - the LDR endpoint modes exercised by those blocks (8, 10 and 12);
 * - binary, trit and quint integer-sequence encodings;
 * - low/high precision weight ranges, weight infill and single/dual plane.
 *
 * Multi-partition, HDR endpoints/void extents and 3D stay named. Returning `unsupported` for the
 * first such block prevents a partly decoded image from acquiring `decodedAccess: true`.
 */

const VERIFIED_BLOCK_MODES = new Set([0x42, 0x163, 0x243, 0x452, 0x7cd])
const VERIFIED_ENDPOINT_MODES = new Set([8, 10, 12])

const WEIGHT_RANGES = Object.freeze({
  low: Object.freeze({
    2: Object.freeze({ max: 1, bits: 1 }),
    3: Object.freeze({ max: 2, bits: 0, trit: true }),
    4: Object.freeze({ max: 3, bits: 2 }),
    5: Object.freeze({ max: 4, bits: 0, quint: true }),
    6: Object.freeze({ max: 5, bits: 1, trit: true }),
    7: Object.freeze({ max: 7, bits: 3 }),
  }),
  high: Object.freeze({
    2: Object.freeze({ max: 9, bits: 1, quint: true }),
    3: Object.freeze({ max: 11, bits: 2, trit: true }),
    4: Object.freeze({ max: 15, bits: 4 }),
    5: Object.freeze({ max: 19, bits: 2, quint: true }),
    6: Object.freeze({ max: 23, bits: 3, trit: true }),
    7: Object.freeze({ max: 31, bits: 5 }),
  }),
})

/** All legal endpoint ranges in descending order, so the first fitting range is authoritative. */
const ENDPOINT_RANGES = Object.freeze([
  { max: 255, bits: 8 },
  { max: 191, bits: 6, trit: true },
  { max: 159, bits: 5, quint: true },
  { max: 127, bits: 7 },
  { max: 95, bits: 5, trit: true },
  { max: 79, bits: 4, quint: true },
  { max: 63, bits: 6 },
  { max: 47, bits: 4, trit: true },
  { max: 39, bits: 3, quint: true },
  { max: 31, bits: 5 },
  { max: 23, bits: 3, trit: true },
  { max: 19, bits: 2, quint: true },
  { max: 15, bits: 4 },
  { max: 11, bits: 2, trit: true },
  { max: 9, bits: 1, quint: true },
  { max: 7, bits: 3 },
  { max: 5, bits: 1, trit: true },
])

const ENDPOINT_UNQUANT = Object.freeze({
  trit: Object.freeze({
    1: Object.freeze({ pattern: '000000000', constant: 204 }),
    2: Object.freeze({ pattern: 'b000b0bb0', constant: 93 }),
    3: Object.freeze({ pattern: 'cb000cbcb', constant: 44 }),
    4: Object.freeze({ pattern: 'dcb000dcb', constant: 22 }),
    5: Object.freeze({ pattern: 'edcb000ed', constant: 11 }),
    6: Object.freeze({ pattern: 'fedcb000f', constant: 5 }),
  }),
  quint: Object.freeze({
    1: Object.freeze({ pattern: '000000000', constant: 113 }),
    2: Object.freeze({ pattern: 'b0000bb00', constant: 54 }),
    3: Object.freeze({ pattern: 'cb0000cbc', constant: 26 }),
    4: Object.freeze({ pattern: 'dcb0000dc', constant: 13 }),
    5: Object.freeze({ pattern: 'edcb0000e', constant: 6 }),
  }),
})

const WEIGHT_UNQUANT = Object.freeze({
  trit: Object.freeze({
    1: Object.freeze({ pattern: '0000000', constant: 50 }),
    2: Object.freeze({ pattern: 'b000b0b', constant: 23 }),
    3: Object.freeze({ pattern: 'cb000cb', constant: 11 }),
  }),
  quint: Object.freeze({
    1: Object.freeze({ pattern: '0000000', constant: 28 }),
    2: Object.freeze({ pattern: 'b0000b0', constant: 13 }),
  }),
})

function blockBits(block) {
  let value = 0n
  for (let index = 15; index >= 0; index -= 1) value = (value << 8n) | BigInt(block[index])
  return value
}

function bits(value, offset, length) {
  if (length === 0) return 0
  return Number((value >> BigInt(offset)) & ((1n << BigInt(length)) - 1n))
}

function iseBitCount(count, range) {
  return (
    count * range.bits +
    (range.trit ? Math.ceil((count * 8) / 5) : 0) +
    (range.quint ? Math.ceil((count * 7) / 3) : 0)
  )
}

function packedBits(getBit, start, length) {
  let value = 0
  for (let index = 0; index < length; index += 1) value |= getBit(start + index) << index
  return value
}

function decodeTritGroup(getBit, start, n) {
  const m = [
    packedBits(getBit, start, n),
    packedBits(getBit, start + n + 2, n),
    packedBits(getBit, start + 2 * n + 4, n),
    packedBits(getBit, start + 3 * n + 5, n),
    packedBits(getBit, start + 4 * n + 7, n),
  ]
  const tPacked =
    (getBit(start + n) << 0) |
    (getBit(start + n + 1) << 1) |
    (getBit(start + 2 * n + 2) << 2) |
    (getBit(start + 2 * n + 3) << 3) |
    (getBit(start + 3 * n + 4) << 4) |
    (getBit(start + 4 * n + 5) << 5) |
    (getBit(start + 4 * n + 6) << 6) |
    (getBit(start + 5 * n + 7) << 7)

  let c
  const t = [0, 0, 0, 0, 0]
  if (((tPacked >> 2) & 0x7) === 0x7) {
    c = (((tPacked >> 5) & 0x7) << 2) | (tPacked & 0x3)
    t[4] = 2
    t[3] = 2
  } else {
    c = tPacked & 0x1f
    if (((tPacked >> 5) & 0x3) === 0x3) {
      t[4] = 2
      t[3] = (tPacked >> 7) & 1
    } else {
      t[4] = (tPacked >> 7) & 1
      t[3] = (tPacked >> 5) & 0x3
    }
  }
  if ((c & 0x3) === 0x3) {
    t[2] = 2
    t[1] = (c >> 4) & 1
    t[0] = (((c >> 3) & 1) << 1) | ((c >> 2) & 1 & ~((c >> 3) & 1))
  } else if (((c >> 2) & 0x3) === 0x3) {
    t[2] = 2
    t[1] = 2
    t[0] = c & 0x3
  } else {
    t[2] = (c >> 4) & 1
    t[1] = (c >> 2) & 0x3
    t[0] = (((c >> 1) & 1) << 1) | (c & 1 & ~((c >> 1) & 1))
  }
  return t.map((digit, index) => (digit << n) | m[index])
}

function decodeQuintGroup(getBit, start, n) {
  const m = [
    packedBits(getBit, start, n),
    packedBits(getBit, start + n + 3, n),
    packedBits(getBit, start + 2 * n + 5, n),
  ]
  const qPacked =
    (getBit(start + n) << 0) |
    (getBit(start + n + 1) << 1) |
    (getBit(start + n + 2) << 2) |
    (getBit(start + 2 * n + 3) << 3) |
    (getBit(start + 2 * n + 4) << 4) |
    (getBit(start + 3 * n + 5) << 5) |
    (getBit(start + 3 * n + 6) << 6)

  let c = 0
  const q = [0, 0, 0]
  if (((qPacked >> 1) & 0x3) === 0x3 && ((qPacked >> 5) & 0x3) === 0) {
    const q0 = qPacked & 1
    q[2] = (q0 << 2) | (((qPacked >> 4) & 1 & ~q0) << 1) | ((qPacked >> 3) & 1 & ~q0)
    q[1] = 4
    q[0] = 4
  } else {
    if (((qPacked >> 1) & 0x3) === 0x3) {
      q[2] = 4
      c = (((qPacked >> 3) & 0x3) << 3) | ((~(qPacked >> 5) & 0x3) << 1) | (qPacked & 1)
    } else {
      q[2] = (qPacked >> 5) & 0x3
      c = qPacked & 0x1f
    }
    if ((c & 0x7) === 0x5) {
      q[1] = 4
      q[0] = (c >> 3) & 0x3
    } else {
      q[1] = (c >> 3) & 0x3
      q[0] = c & 0x7
    }
  }
  return q.map((digit, index) => (digit << n) | m[index])
}

function decodeIse(count, range, sourceBit) {
  const streamBits = iseBitCount(count, range)
  const getBit = index => (index < 0 || index >= streamBits ? 0 : sourceBit(index))
  if (!range.trit && !range.quint) {
    return Array.from({ length: count }, (_value, index) =>
      packedBits(getBit, index * range.bits, range.bits),
    )
  }

  const groupSize = range.trit ? 5 : 3
  const packedSize = range.trit ? 8 + 5 * range.bits : 7 + 3 * range.bits
  const out = []
  for (let group = 0; out.length < count; group += 1) {
    const values = range.trit
      ? decodeTritGroup(getBit, group * packedSize, range.bits)
      : decodeQuintGroup(getBit, group * packedSize, range.bits)
    out.push(...values.slice(0, Math.min(groupSize, count - out.length)))
  }
  return out
}

function replicated(value, sourceBits, targetBits) {
  let result = 0
  for (let index = 0; index < targetBits; index += 1) {
    const source = sourceBits - 1 - (index % sourceBits)
    result = (result << 1) | ((value >> source) & 1)
  }
  return result
}

function patternValue(pattern, value) {
  let out = 0
  for (const symbol of pattern) {
    out <<= 1
    if (symbol !== '0') out |= (value >> (symbol.charCodeAt(0) - 97)) & 1
  }
  return out
}

function unquantizeEndpoint(value, range) {
  if (!range.trit && !range.quint) return replicated(value, range.bits, 8)
  const kind = range.trit ? 'trit' : 'quint'
  const digit = value >> range.bits
  const low = value & ((1 << range.bits) - 1)
  const parameters = ENDPOINT_UNQUANT[kind][range.bits]
  const a = (low & 1) === 0 ? 0 : 0x1ff
  const b = patternValue(parameters.pattern, low)
  let unquantized = digit * parameters.constant + b
  unquantized ^= a
  return (a & 0x80) | (unquantized >> 2)
}

function unquantizeWeight(value, range) {
  let unquantized
  if (range.max === 2) unquantized = [0, 32, 63][value]
  else if (range.max === 4) unquantized = [0, 16, 32, 47, 63][value]
  else if (!range.trit && !range.quint) unquantized = replicated(value, range.bits, 6)
  else {
    const kind = range.trit ? 'trit' : 'quint'
    const digit = value >> range.bits
    const low = value & ((1 << range.bits) - 1)
    const parameters = WEIGHT_UNQUANT[kind][range.bits]
    const a = (low & 1) === 0 ? 0 : 0x7f
    const b = patternValue(parameters.pattern, low)
    unquantized = digit * parameters.constant + b
    unquantized ^= a
    unquantized = (a & 0x20) | (unquantized >> 2)
  }
  return unquantized > 32 ? unquantized + 1 : unquantized
}

function parseBlockMode(value, footprintWidth, footprintHeight) {
  const mode = bits(value, 0, 11)
  let width
  let height
  let rho
  let highPrecision
  let dualPlane

  if ((mode & 0x3) !== 0) {
    rho = ((mode & 0x3) << 1) | ((mode >> 4) & 1)
    highPrecision = ((mode >> 9) & 1) !== 0
    dualPlane = ((mode >> 10) & 1) !== 0
    const selector = (mode >> 2) & 0x3
    if (selector === 0) {
      width = ((mode >> 7) & 0x3) + 4
      height = ((mode >> 5) & 0x3) + 2
    } else if (selector === 1) {
      width = ((mode >> 7) & 0x3) + 8
      height = ((mode >> 5) & 0x3) + 2
    } else if (selector === 2) {
      width = ((mode >> 5) & 0x3) + 2
      height = ((mode >> 7) & 0x3) + 8
    } else if (((mode >> 8) & 1) === 0) {
      width = ((mode >> 5) & 0x3) + 2
      height = ((mode >> 7) & 1) + 6
    } else {
      width = ((mode >> 7) & 1) + 2
      height = ((mode >> 5) & 0x3) + 2
    }
  } else {
    rho = (((mode >> 2) & 0x3) << 1) | ((mode >> 4) & 1)
    if (rho < 2) return { unsupported: `reserved-block-mode-0x${mode.toString(16)}` }
    if (((mode >> 8) & 1) === 0) {
      if (((mode >> 7) & 1) === 0) {
        width = 12
        height = ((mode >> 5) & 0x3) + 2
      } else {
        width = ((mode >> 5) & 0x3) + 2
        height = 12
      }
      highPrecision = ((mode >> 9) & 1) !== 0
      dualPlane = ((mode >> 10) & 1) !== 0
    } else if (((mode >> 7) & 1) === 0) {
      width = ((mode >> 5) & 0x3) + 6
      height = ((mode >> 9) & 0x3) + 6
      highPrecision = false
      dualPlane = false
    } else {
      if (((mode >> 6) & 1) !== 0)
        return { unsupported: `reserved-block-mode-0x${mode.toString(16)}` }
      width = ((mode >> 5) & 1) === 0 ? 6 : 10
      height = ((mode >> 5) & 1) === 0 ? 10 : 6
      highPrecision = ((mode >> 9) & 1) !== 0
      dualPlane = ((mode >> 10) & 1) !== 0
    }
  }

  const range = WEIGHT_RANGES[highPrecision ? 'high' : 'low'][rho]
  const planes = dualPlane ? 2 : 1
  const weightCount = width * height * planes
  if (
    range === undefined ||
    width > footprintWidth ||
    height > footprintHeight ||
    weightCount > 64
  ) {
    return { unsupported: `illegal-block-mode-0x${mode.toString(16)}` }
  }
  const weightBits = iseBitCount(weightCount, range)
  if (weightBits < 24 || weightBits > 96) {
    return { unsupported: `illegal-weight-bits-${weightBits}` }
  }
  return { mode, width, height, range, dualPlane, planes, weightCount, weightBits }
}

function transferred(signedValue, baseValue) {
  const base = (baseValue >> 1) | (signedValue & 0x80)
  let delta = (signedValue >> 1) & 0x3f
  if ((delta & 0x20) !== 0) delta -= 0x40
  return [delta, base]
}

const clamp8 = value => (value < 0 ? 0 : value > 255 ? 255 : value)

function blueContract(red, green, blue, alpha) {
  return [(red + blue) >> 1, (green + blue) >> 1, blue, alpha]
}

function decodeEndpoints(mode, values) {
  const v = [...values]
  if (mode === 0)
    return [
      [v[0], v[0], v[0], 255],
      [v[1], v[1], v[1], 255],
    ]
  if (mode === 1) {
    const l0 = (v[0] >> 2) | (v[1] & 0xc0)
    const l1 = Math.min(255, l0 + (v[1] & 0x3f))
    return [
      [l0, l0, l0, 255],
      [l1, l1, l1, 255],
    ]
  }
  if (mode === 4)
    return [
      [v[0], v[0], v[0], v[2]],
      [v[1], v[1], v[1], v[3]],
    ]
  if (mode === 5) {
    ;[v[1], v[0]] = transferred(v[1], v[0])
    ;[v[3], v[2]] = transferred(v[3], v[2])
    return [
      [v[0], v[0], v[0], v[2]].map(clamp8),
      [v[0] + v[1], v[0] + v[1], v[0] + v[1], v[2] + v[3]].map(clamp8),
    ]
  }
  if (mode === 6)
    return [
      [(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, 255],
      [v[0], v[1], v[2], 255],
    ]
  if (mode === 8 || mode === 12) {
    const alpha0 = mode === 12 ? v[6] : 255
    const alpha1 = mode === 12 ? v[7] : 255
    if (v[1] + v[3] + v[5] >= v[0] + v[2] + v[4]) {
      return [
        [v[0], v[2], v[4], alpha0],
        [v[1], v[3], v[5], alpha1],
      ]
    }
    return [blueContract(v[1], v[3], v[5], alpha1), blueContract(v[0], v[2], v[4], alpha0)]
  }
  if (mode === 9 || mode === 13) {
    ;[v[1], v[0]] = transferred(v[1], v[0])
    ;[v[3], v[2]] = transferred(v[3], v[2])
    ;[v[5], v[4]] = transferred(v[5], v[4])
    if (mode === 13) [v[7], v[6]] = transferred(v[7], v[6])
    const alpha0 = mode === 13 ? v[6] : 255
    const alpha1 = mode === 13 ? v[6] + v[7] : 255
    let endpoints
    if (v[1] + v[3] + v[5] >= 0) {
      endpoints = [
        [v[0], v[2], v[4], alpha0],
        [v[0] + v[1], v[2] + v[3], v[4] + v[5], alpha1],
      ]
    } else {
      endpoints = [
        blueContract(v[0] + v[1], v[2] + v[3], v[4] + v[5], alpha1),
        blueContract(v[0], v[2], v[4], alpha0),
      ]
    }
    return endpoints.map(endpoint => endpoint.map(clamp8))
  }
  if (mode === 10)
    return [
      [(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, v[4]],
      [v[0], v[1], v[2], v[5]],
    ]
  throw new RangeError(`unsupported ASTC endpoint mode ${mode}`)
}

function effectiveWeight(weights, plane, x, y, mode, footprintWidth, footprintHeight) {
  const ds = Math.floor((1024 + Math.floor(footprintWidth / 2)) / (footprintWidth - 1))
  const dt = Math.floor((1024 + Math.floor(footprintHeight / 2)) / (footprintHeight - 1))
  const gs = (ds * x * (mode.width - 1) + 32) >> 6
  const gt = (dt * y * (mode.height - 1) + 32) >> 6
  const js = gs >> 4
  const jt = gt >> 4
  const fs = gs & 0xf
  const ft = gt & 0xf
  const x1 = Math.min(js + 1, mode.width - 1)
  const y1 = Math.min(jt + 1, mode.height - 1)
  const at = (gridX, gridY) => weights[(gridY * mode.width + gridX) * mode.planes + plane]
  const p00 = at(js, jt)
  const p01 = at(x1, jt)
  const p10 = at(js, y1)
  const p11 = at(x1, y1)
  const w11 = (fs * ft + 8) >> 4
  const w10 = ft - w11
  const w01 = fs - w11
  const w00 = 16 - fs - ft + w11
  return (p00 * w00 + p01 * w01 + p10 * w10 + p11 * w11 + 8) >> 4
}

function interpolate(e0, e1, weight) {
  const c0 = (e0 << 8) | e0
  const c1 = (e1 << 8) | e1
  return ((c0 * (64 - weight) + c1 * weight + 32) >> 6) >> 8
}

function decodeOrdinaryBlock(value, footprintWidth, footprintHeight, producePixels) {
  const mode = parseBlockMode(value, footprintWidth, footprintHeight)
  if (mode.unsupported !== undefined) return mode
  if (!VERIFIED_BLOCK_MODES.has(mode.mode)) {
    return { unsupported: `unverified-block-mode-0x${mode.mode.toString(16)}`, mode: mode.mode }
  }
  const partitions = bits(value, 11, 2) + 1
  if (partitions !== 1) return { unsupported: `multi-partition-${partitions}` }
  const endpointMode = bits(value, 13, 4)
  if (!VERIFIED_ENDPOINT_MODES.has(endpointMode)) {
    return { unsupported: `hdr-endpoint-mode-${endpointMode}` }
  }
  const endpointCount = 2 * (Math.floor(endpointMode / 4) + 1)
  const configBits = 17 + (mode.dualPlane ? 2 : 0)
  const remainingBits = 128 - configBits - mode.weightBits
  const endpointRange = ENDPOINT_RANGES.find(
    candidate => iseBitCount(endpointCount, candidate) <= remainingBits,
  )
  if (endpointRange === undefined) return { unsupported: 'endpoint-range-too-small' }

  const metadata = {
    subset: mode.dualPlane ? '2d-ldr-single-partition-dual-plane' : '2d-ldr-single-partition',
    mode: mode.mode,
    endpointMode,
    endpointRange: endpointRange.max,
  }
  if (!producePixels) return metadata

  const endpointsRaw = decodeIse(endpointCount, endpointRange, index => bits(value, 17 + index, 1))
  const endpoints = decodeEndpoints(
    endpointMode,
    endpointsRaw.map(item => unquantizeEndpoint(item, endpointRange)),
  )
  const weightRaw = decodeIse(mode.weightCount, mode.range, index => bits(value, 127 - index, 1))
  const weights = weightRaw.map(item => unquantizeWeight(item, mode.range))
  const componentSelector = mode.dualPlane ? bits(value, 128 - mode.weightBits - 2, 2) : undefined
  const pixels = new Uint8Array(footprintWidth * footprintHeight * 4)
  for (let y = 0; y < footprintHeight; y += 1) {
    for (let x = 0; x < footprintWidth; x += 1) {
      const plane0 = effectiveWeight(weights, 0, x, y, mode, footprintWidth, footprintHeight)
      const plane1 = mode.dualPlane
        ? effectiveWeight(weights, 1, x, y, mode, footprintWidth, footprintHeight)
        : plane0
      const target = (y * footprintWidth + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const weight = componentSelector === channel ? plane1 : plane0
        pixels[target + channel] = interpolate(endpoints[0][channel], endpoints[1][channel], weight)
      }
    }
  }
  return { pixels, ...metadata }
}

function decodeBlock(block, footprintWidth, footprintHeight, producePixels) {
  const value = blockBits(block)
  const low = bits(value, 0, 12)
  if ((low & 0x1ff) === 0x1fc) {
    if ((low & 0xc00) !== 0xc00) return { unsupported: 'illegal-void-extent' }
    if ((low & 0x200) !== 0) return { unsupported: 'hdr-void-extent' }
    if (!producePixels) return { subset: '2d-ldr-void-extent' }
    const pixels = new Uint8Array(footprintWidth * footprintHeight * 4)
    for (let index = 0; index < pixels.byteLength; index += 4) {
      pixels[index] = block[9]
      pixels[index + 1] = block[11]
      pixels[index + 2] = block[13]
      pixels[index + 3] = block[15]
    }
    return { pixels, subset: '2d-ldr-void-extent' }
  }
  return decodeOrdinaryBlock(value, footprintWidth, footprintHeight, producePixels)
}

function scanBlocks(bytes, info, signal, producePixels, accept) {
  for (let index = 0; index < info.blocks; index += 1) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const offset = 16 + index * 16
    const decoded = decodeBlock(
      bytes.subarray(offset, offset + 16),
      info.blockWidth,
      info.blockHeight,
      producePixels,
    )
    if (decoded.unsupported !== undefined) {
      return Object.freeze({
        decodedAccess: false,
        unsupported: decoded.unsupported,
        index,
        ...(decoded.mode === undefined ? {} : { mode: decoded.mode }),
      })
    }
    accept?.(decoded, index)
  }
  return undefined
}

export function decodeAstcLdr2d(bytes, info, signal, maxScalarBytes) {
  if (info.depth !== 1 || info.blockDepth !== 1) {
    return Object.freeze({ decodedAccess: false, unsupported: 'three-dimensional-blocks' })
  }

  const probe = scanBlocks(bytes, info, signal, false)
  if (probe !== undefined) return probe
  const decodedBytes = BigInt(info.width) * BigInt(info.height) * 4n
  if (decodedBytes > BigInt(maxScalarBytes)) {
    throw new RangeError('ASTC decoded pixels exceed the scalar budget')
  }

  const pixels = new Uint8Array(info.width * info.height * 4)
  const subsets = new Set()
  const modes = new Set()
  const endpointModes = new Set()
  const endpointRanges = new Set()
  const failure = scanBlocks(bytes, info, signal, true, (decoded, index) => {
    subsets.add(decoded.subset)
    if (decoded.mode !== undefined) modes.add(decoded.mode)
    if (decoded.endpointMode !== undefined) endpointModes.add(decoded.endpointMode)
    if (decoded.endpointRange !== undefined) endpointRanges.add(decoded.endpointRange)
    const blockX = index % info.blockColumns
    const blockY = Math.floor(index / info.blockColumns) % info.blockRows
    for (let y = 0; y < info.blockHeight; y += 1) {
      const targetY = blockY * info.blockHeight + y
      if (targetY >= info.height) continue
      for (let x = 0; x < info.blockWidth; x += 1) {
        const targetX = blockX * info.blockWidth + x
        if (targetX >= info.width) continue
        const source = (y * info.blockWidth + x) * 4
        const target = (targetY * info.width + targetX) * 4
        pixels.set(decoded.pixels.subarray(source, source + 4), target)
      }
    }
  })
  if (failure !== undefined) return failure
  return Object.freeze({
    decodedAccess: true,
    pixels,
    subset: [...subsets].sort().join('+'),
    modes: Object.freeze([...modes].sort((left, right) => left - right)),
    endpointModes: Object.freeze([...endpointModes].sort((left, right) => left - right)),
    endpointRanges: Object.freeze([...endpointRanges].sort((left, right) => left - right)),
  })
}
