const HEADER_BYTES_V0 = 32
const HEADER_BYTES_V1 = 44
const HASH_ENTRY_BYTES = 16
const BLOCK_ENTRY_BYTES = 16
const HASH_TABLE_OFFSET = 0
const HASH_NAME_A = 1
const HASH_NAME_B = 2
const HASH_TABLE = 3
const EMPTY_BLOCK = 0xffffffff
const DELETED_BLOCK = 0xfffffffe
const FILE_IMPLODE = 0x00000100
const FILE_COMPRESS = 0x00000200
const FILE_ENCRYPTED = 0x00010000
const FILE_PATCH = 0x00100000
const FILE_SINGLE_UNIT = 0x01000000
const FILE_SECTOR_CRC = 0x04000000
const FILE_EXISTS = 0x80000000

export const MPQ_NATIVE_PRESERVING_UNSUPPORTED =
  'org.modkitx.blizzard/mpq-native-preserving-feature-unsupported'

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

const abort = signal => {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function codedTypeError(code, message) {
  const result = new TypeError(message)
  Object.defineProperty(result, 'code', { value: code, enumerable: true })
  return result
}

function unsupported(message) {
  return codedTypeError(MPQ_NATIVE_PRESERVING_UNSUPPORTED, message)
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u16(bytes, offset) {
  return viewOf(bytes).getUint16(offset, true)
}

function u32(bytes, offset) {
  return viewOf(bytes).getUint32(offset, true)
}

function magic(bytes, offset = 0) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return ''
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function checkedSlice(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    throw new RangeError(`MPQ ${label} is outside the archive`)
  }
  return bytes.slice(offset, offset + length)
}

function portablePath(path, label = 'MPQ entry') {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path) ||
    path.length > 1_024
  ) {
    throw new TypeError(`${label} path «${String(path)}» is not a portable relative path`)
  }
  const normalized = path.replaceAll('\\', '/')
  if (normalized.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`${label} path «${path}» contains an empty or traversal segment`)
  }
  return normalized
}

function archiveNameOf(value) {
  const path = portablePath(value, 'MPQ Save As')
  if (path.includes('/') || /[<>:"|?*]/u.test(path) || !/^[\x20-\x7e]+$/u.test(path)) {
    throw new TypeError('MPQ Save As name must be one portable ASCII file inside the target')
  }
  return path
}

const cryptTable = (() => {
  const result = new Uint32Array(0x500)
  let seed = 0x00100001
  for (let first = 0; first < 0x100; first += 1) {
    let index = first
    for (let round = 0; round < 5; round += 1) {
      seed = (seed * 125 + 3) % 0x2aaaab
      const high = (seed & 0xffff) << 16
      seed = (seed * 125 + 3) % 0x2aaaab
      result[index] = (high | (seed & 0xffff)) >>> 0
      index += 0x100
    }
  }
  return result
})()

function mpqHash(input, type) {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee
  for (const original of new TextEncoder().encode(input.replaceAll('/', '\\'))) {
    const value = original >= 0x61 && original <= 0x7a ? original - 0x20 : original
    seed1 = ((cryptTable[(type << 8) + value] ?? 0) ^ (seed1 + seed2)) >>> 0
    seed2 = (value + seed1 + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0
  }
  return seed1 >>> 0
}

function crypt(data, key, decrypting) {
  if (data.byteLength % 4 !== 0) throw new TypeError('MPQ table is not word aligned')
  const output = data.slice()
  const inputView = viewOf(data)
  const outputView = viewOf(output)
  let seed1 = key >>> 0
  let seed2 = 0xeeeeeeee
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    seed2 = (seed2 + (cryptTable[0x400 + (seed1 & 0xff)] ?? 0)) >>> 0
    const input = inputView.getUint32(offset, true)
    const plain = decrypting ? (input ^ ((seed1 + seed2) >>> 0)) >>> 0 : input
    const cipher = decrypting ? input : (plain ^ ((seed1 + seed2) >>> 0)) >>> 0
    outputView.setUint32(offset, decrypting ? plain : cipher, true)
    seed1 = ((((~seed1 << 21) >>> 0) + 0x11111111) | (seed1 >>> 11)) >>> 0
    seed2 = (plain + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0
  }
  return output
}

const decryptTable = (data, key) => crypt(data, key, true)
const encryptTable = (data, key) => crypt(data, key, false)

function parseArchive(bytes, maxBlocks) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES_V0) {
    throw new TypeError('native MPQ source is truncated')
  }
  let headerOffset = 0
  let userDataBytes = 0
  if (magic(bytes) === 'MPQ\u001b') {
    if (bytes.byteLength < 16) throw new TypeError('MPQ user-data header is truncated')
    userDataBytes = u32(bytes, 4)
    headerOffset = u32(bytes, 8)
    if (headerOffset < 16 || headerOffset > bytes.byteLength - HEADER_BYTES_V0) {
      throw new RangeError('MPQ user-data header points outside the source')
    }
  }
  if (magic(bytes, headerOffset) !== 'MPQ\u001a') throw new TypeError('MPQ magic is missing')
  checkedSlice(bytes, headerOffset, HEADER_BYTES_V0, 'base header')
  const version = u16(bytes, headerOffset + 12)
  if (version > 1) {
    throw unsupported(`MPQ version ${version} preserving replacement is not implemented`)
  }
  const headerSize = u32(bytes, headerOffset + 4)
  const minimumHeader = version === 0 ? HEADER_BYTES_V0 : HEADER_BYTES_V1
  if (headerSize < minimumHeader) throw new TypeError('MPQ header size is invalid')
  checkedSlice(bytes, headerOffset, headerSize, 'complete header')
  const archiveSize = u32(bytes, headerOffset + 8)
  if (archiveSize < headerSize || archiveSize > bytes.byteLength - headerOffset) {
    throw new RangeError('MPQ declared archive size is outside the source')
  }
  let hashHigh = 0
  let blockHigh = 0
  let extendedBlockOffset = 0n
  if (version > 0) {
    extendedBlockOffset = viewOf(bytes).getBigUint64(headerOffset + 32, true)
    hashHigh = u16(bytes, headerOffset + 40)
    blockHigh = u16(bytes, headerOffset + 42)
    if (extendedBlockOffset !== 0n || hashHigh !== 0 || blockHigh !== 0) {
      throw unsupported('MPQ high-offset and extended block tables remain a named remainder')
    }
  }
  const sectorShift = u16(bytes, headerOffset + 14)
  if (sectorShift > 20) throw unsupported('MPQ sector shifts above 20 are not supported')
  const hashOffset = u32(bytes, headerOffset + 16)
  const blockOffset = u32(bytes, headerOffset + 20)
  const hashEntries = u32(bytes, headerOffset + 24)
  const blockEntries = u32(bytes, headerOffset + 28)
  if (
    !Number.isSafeInteger(maxBlocks) ||
    maxBlocks <= 0 ||
    hashEntries > maxBlocks * 4 ||
    blockEntries > maxBlocks
  ) {
    throw new RangeError('MPQ tables exceed the preserving-writer block budget')
  }
  const hashBytes = hashEntries * HASH_ENTRY_BYTES
  const blockBytes = blockEntries * BLOCK_ENTRY_BYTES
  if (!Number.isSafeInteger(hashBytes) || !Number.isSafeInteger(blockBytes)) {
    throw new RangeError('MPQ table size overflows')
  }
  if (
    hashOffset < headerSize ||
    blockOffset < headerSize ||
    hashOffset + hashBytes > archiveSize ||
    blockOffset + blockBytes > archiveSize
  ) {
    throw new RangeError('MPQ table lies outside the declared archive')
  }
  const hashCipher = checkedSlice(bytes, headerOffset + hashOffset, hashBytes, 'hash table')
  const blockCipher = checkedSlice(bytes, headerOffset + blockOffset, blockBytes, 'block table')
  const hashPlain = decryptTable(hashCipher, mpqHash('(hash table)', HASH_TABLE))
  const blockPlain = decryptTable(blockCipher, mpqHash('(block table)', HASH_TABLE))
  const hashTable = []
  for (let index = 0; index < hashEntries; index += 1) {
    const offset = index * HASH_ENTRY_BYTES
    hashTable.push(
      Object.freeze({
        index,
        hashA: u32(hashPlain, offset),
        hashB: u32(hashPlain, offset + 4),
        locale: u16(hashPlain, offset + 8),
        platform: u16(hashPlain, offset + 10),
        blockIndex: u32(hashPlain, offset + 12),
      }),
    )
  }
  const blockTable = []
  const ranges = []
  for (let index = 0; index < blockEntries; index += 1) {
    const offset = index * BLOCK_ENTRY_BYTES
    const block = Object.freeze({
      index,
      offset: u32(blockPlain, offset),
      archivedSize: u32(blockPlain, offset + 4),
      size: u32(blockPlain, offset + 8),
      flags: u32(blockPlain, offset + 12),
    })
    if ((block.flags & FILE_EXISTS) !== 0) {
      if (block.offset < headerSize || block.offset + block.archivedSize > archiveSize) {
        throw new RangeError(`MPQ block ${index} lies outside the declared archive`)
      }
      ranges.push({
        start: block.offset,
        end: block.offset + block.archivedSize,
        label: `block ${index}`,
      })
    }
    blockTable.push(block)
  }
  ranges.push({ start: hashOffset, end: hashOffset + hashBytes, label: 'hash table' })
  ranges.push({ start: blockOffset, end: blockOffset + blockBytes, label: 'block table' })
  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1]
    const current = ranges[index]
    if (
      previous.end > current.start &&
      previous.end !== previous.start &&
      current.end !== current.start
    ) {
      throw unsupported(
        `overlapping ${previous.label} and ${current.label} cannot be preserved safely`,
      )
    }
  }
  return Object.freeze({
    bytes,
    header: Object.freeze({
      offset: headerOffset,
      userDataBytes,
      headerSize,
      archiveSize,
      version,
      sectorShift,
      hashOffset,
      blockOffset,
      hashEntries,
      blockEntries,
      extendedBlockOffset,
      hashHigh,
      blockHigh,
    }),
    hashCipher,
    blockCipher,
    hashPlain,
    blockPlain,
    hashTable: Object.freeze(hashTable),
    blockTable: Object.freeze(blockTable),
  })
}

function matchingBlockIndices(path, archive) {
  if (archive.hashTable.length === 0) return []
  const hashA = mpqHash(path, HASH_NAME_A)
  const hashB = mpqHash(path, HASH_NAME_B)
  const first = mpqHash(path, HASH_TABLE_OFFSET) % archive.hashTable.length
  const found = new Set()
  for (let probe = 0; probe < archive.hashTable.length; probe += 1) {
    const entry = archive.hashTable[(first + probe) % archive.hashTable.length]
    if (entry.blockIndex === EMPTY_BLOCK) break
    if (entry.blockIndex === DELETED_BLOCK) continue
    const block = archive.blockTable[entry.blockIndex]
    if (
      entry.hashA === hashA &&
      entry.hashB === hashB &&
      block !== undefined &&
      (block.flags & FILE_EXISTS) !== 0
    ) {
      found.add(block.index)
    }
  }
  return [...found]
}

async function inflate(payload) {
  if (typeof DecompressionStream !== 'function') {
    throw unsupported('zlib decompression is unavailable in this runtime')
  }
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deflate(payload) {
  if (typeof CompressionStream !== 'function') {
    throw unsupported('zlib compression is unavailable in this runtime')
  }
  const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decodeCompressed(payload, expected, label) {
  if (payload.byteLength === 0) throw new TypeError(`MPQ compressed ${label} is empty`)
  const method = payload[0]
  let decoded
  if (method === 0) decoded = payload.slice(1)
  else if (method === 2) decoded = await inflate(payload.slice(1))
  else throw unsupported(`MPQ compression mask 0x${method.toString(16)} for ${label}`)
  if (decoded.byteLength !== expected) throw new TypeError(`MPQ ${label} size mismatch`)
  return Object.freeze({ bytes: decoded, method })
}

function rawBlockBytes(archive, block) {
  return checkedSlice(
    archive.bytes,
    archive.header.offset + block.offset,
    block.archivedSize,
    `block ${block.index}`,
  )
}

function sectorLayout(archive, block, label) {
  if ((block.flags & FILE_SECTOR_CRC) !== 0) {
    throw unsupported(`changed sector-CRC entry «${label}» is not supported`)
  }
  const sectorSize = 512 * 2 ** archive.header.sectorShift
  const sectorCount = Math.ceil(block.size / sectorSize)
  const positionCount = sectorCount + 1
  const tableBytes = positionCount * 4
  const raw = rawBlockBytes(archive, block)
  if (raw.byteLength < tableBytes) throw new TypeError(`MPQ ${label} sector table is truncated`)
  const positions = Array.from({ length: positionCount }, (_, index) => u32(raw, index * 4))
  if (positions[0] < tableBytes || positions.at(-1) > raw.byteLength) {
    throw new TypeError(`MPQ ${label} sector table is invalid`)
  }
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] < positions[index - 1]) {
      throw new TypeError(`MPQ ${label} sector offsets are not monotonic`)
    }
  }
  return Object.freeze({ raw, sectorSize, sectorCount, positions })
}

async function readBlock(archive, block, label) {
  if ((block.flags & FILE_ENCRYPTED) !== 0) throw unsupported(`encrypted entry «${label}»`)
  if ((block.flags & FILE_IMPLODE) !== 0) throw unsupported(`implode entry «${label}»`)
  if ((block.flags & FILE_PATCH) !== 0) throw unsupported(`patch entry «${label}»`)
  const raw = rawBlockBytes(archive, block)
  if ((block.flags & FILE_SINGLE_UNIT) !== 0) {
    if ((block.flags & FILE_COMPRESS) !== 0 && block.size > block.archivedSize) {
      return (await decodeCompressed(raw, block.size, label)).bytes
    }
    if (raw.byteLength < block.size) throw new TypeError(`MPQ ${label} is truncated`)
    return raw.slice(0, block.size)
  }
  if ((block.flags & FILE_COMPRESS) === 0) {
    if (raw.byteLength !== block.size) throw new TypeError(`MPQ ${label} size mismatch`)
    return raw
  }
  const layout = sectorLayout(archive, block, label)
  const output = new Uint8Array(block.size)
  let target = 0
  for (let index = 0; index < layout.sectorCount; index += 1) {
    const expected = Math.min(layout.sectorSize, block.size - target)
    const sector = layout.raw.slice(layout.positions[index], layout.positions[index + 1])
    const decoded =
      sector.byteLength < expected
        ? (await decodeCompressed(sector, expected, `${label}#${index}`)).bytes
        : sector
    if (decoded.byteLength !== expected) throw new TypeError(`MPQ ${label} sector size mismatch`)
    output.set(decoded, target)
    target += decoded.byteLength
  }
  return output
}

async function namesOf(archive) {
  const names = new Map()
  const listIndices = matchingBlockIndices('(listfile)', archive)
  if (listIndices.length === 1) {
    try {
      const listfile = await readBlock(archive, archive.blockTable[listIndices[0]], '(listfile)')
      for (const raw of new TextDecoder('utf-8', { fatal: true })
        .decode(listfile)
        .split(/\r?\n/u)) {
        const trimmed = raw.trim()
        if (trimmed === '') continue
        const path = portablePath(trimmed)
        const matches = matchingBlockIndices(path, archive)
        if (matches.length === 1) names.set(path.toLowerCase(), { path, blockIndex: matches[0] })
      }
    } catch (cause) {
      if (cause?.code === MPQ_NATIVE_PRESERVING_UNSUPPORTED) throw cause
      throw unsupported(
        `the MPQ listfile cannot be decoded safely: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
  for (const path of ['(listfile)', '(attributes)', '(signature)']) {
    const matches = matchingBlockIndices(path, archive)
    if (matches.length === 1) names.set(path, { path, blockIndex: matches[0] })
  }
  return names
}

async function encodeByOriginalMethod(archive, block, path, replacement) {
  if ((block.flags & FILE_ENCRYPTED) !== 0) {
    throw unsupported(`changed encrypted entry «${path}» requires native key handling`)
  }
  if ((block.flags & FILE_IMPLODE) !== 0) {
    throw unsupported(`changed implode entry «${path}» is not supported`)
  }
  if ((block.flags & FILE_PATCH) !== 0) {
    throw unsupported(`changed patch entry «${path}» requires patch-chain reconstruction`)
  }
  if ((block.flags & FILE_SECTOR_CRC) !== 0) {
    throw unsupported(`changed sector-CRC entry «${path}» requires CRC reconstruction`)
  }
  const raw = rawBlockBytes(archive, block)
  if ((block.flags & FILE_SINGLE_UNIT) !== 0) {
    if ((block.flags & FILE_COMPRESS) === 0 || block.size <= block.archivedSize) {
      return Object.freeze({ bytes: replacement.slice(), method: 'stored' })
    }
    const method = raw[0]
    if (method === 0) {
      const bytes = new Uint8Array(replacement.byteLength + 1)
      bytes[0] = 0
      bytes.set(replacement, 1)
      return Object.freeze({ bytes, method: 'compression-mask-0x00' })
    }
    if (method === 2) {
      const compressed = await deflate(replacement)
      const bytes = new Uint8Array(compressed.byteLength + 1)
      bytes[0] = 2
      bytes.set(compressed, 1)
      if (bytes.byteLength >= replacement.byteLength) {
        throw unsupported(
          `changed zlib entry «${path}» no longer compresses with its original method`,
        )
      }
      return Object.freeze({ bytes, method: 'zlib' })
    }
    throw unsupported(`changed entry «${path}» uses compression mask 0x${method.toString(16)}`)
  }
  if ((block.flags & FILE_COMPRESS) === 0) {
    return Object.freeze({ bytes: replacement.slice(), method: 'stored' })
  }
  if (replacement.byteLength !== block.size) {
    throw unsupported(`changed sector-compressed entry «${path}» must keep its uncompressed size`)
  }
  const layout = sectorLayout(archive, block, path)
  const encodedSectors = []
  let sourceOffset = 0
  for (let index = 0; index < layout.sectorCount; index += 1) {
    const expected = Math.min(layout.sectorSize, replacement.byteLength - sourceOffset)
    const original = layout.raw.slice(layout.positions[index], layout.positions[index + 1])
    const plain = replacement.slice(sourceOffset, sourceOffset + expected)
    sourceOffset += expected
    if (original.byteLength >= expected) {
      encodedSectors.push(plain)
      continue
    }
    const method = original[0]
    if (method === 0) {
      const encoded = new Uint8Array(plain.byteLength + 1)
      encoded[0] = 0
      encoded.set(plain, 1)
      encodedSectors.push(encoded)
      continue
    }
    if (method !== 2) {
      throw unsupported(
        `changed entry «${path}» sector ${index} uses mask 0x${method.toString(16)}`,
      )
    }
    const compressed = await deflate(plain)
    const encoded = new Uint8Array(compressed.byteLength + 1)
    encoded[0] = 2
    encoded.set(compressed, 1)
    if (encoded.byteLength >= expected) {
      throw unsupported(
        `changed zlib entry «${path}» sector ${index} no longer compresses with its original method`,
      )
    }
    encodedSectors.push(encoded)
  }
  const tableBytes = (layout.sectorCount + 1) * 4
  const total = tableBytes + encodedSectors.reduce((sum, item) => sum + item.byteLength, 0)
  const encoded = new Uint8Array(total)
  const encodedView = viewOf(encoded)
  let cursor = tableBytes
  encodedView.setUint32(0, cursor, true)
  encodedSectors.forEach((sector, index) => {
    encoded.set(sector, cursor)
    cursor += sector.byteLength
    encodedView.setUint32((index + 1) * 4, cursor, true)
  })
  return Object.freeze({ bytes: encoded, method: 'sector-methods-preserved' })
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function digest(bytes) {
  if (globalThis.crypto?.subtle === undefined) {
    throw unsupported('SHA-256 is unavailable in this runtime')
  }
  const value = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return `sha256:${[...value].map(item => item.toString(16).padStart(2, '0')).join('')}`
}

function methodLabel(archive, block) {
  if ((block.flags & FILE_ENCRYPTED) !== 0) return 'encrypted-opaque'
  if ((block.flags & FILE_PATCH) !== 0) return 'patch-opaque'
  if ((block.flags & FILE_IMPLODE) !== 0) return 'implode-opaque'
  if ((block.flags & FILE_COMPRESS) === 0) return 'stored'
  if ((block.flags & FILE_SINGLE_UNIT) === 0) return 'sector-compressed-opaque'
  if (block.size <= block.archivedSize) return 'stored-with-compress-flag'
  const raw = rawBlockBytes(archive, block)
  return raw[0] === 2 ? 'zlib' : `compression-mask-0x${(raw[0] ?? 0).toString(16)}`
}

/**
 * Build a fixed-slot native-preserving replacement. The complete source archive remains immutable;
 * callers commit the returned bytes as a separate file through the durable writer coordinator.
 */
export async function encodeNativePreservingMpq(options) {
  const {
    sourceBytes,
    replacements,
    signal,
    maxArchiveBytes = 67_108_864,
    maxBlocks = 16_384,
    maxReplacementBytes = 16_777_216,
  } = options
  abort(signal)
  if (!(sourceBytes instanceof Uint8Array)) throw new TypeError('native MPQ source has no bytes')
  for (const [name, value] of Object.entries({
    maxArchiveBytes,
    maxBlocks,
    maxReplacementBytes,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`)
    }
  }
  if (maxArchiveBytes > 1_073_741_824 || maxBlocks > 1_000_000) {
    throw new RangeError('native MPQ preserving-writer limits exceed the hard safety ceiling')
  }
  if (sourceBytes.byteLength > maxArchiveBytes) {
    throw new RangeError('native MPQ source exceeds maxArchiveBytes')
  }
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new TypeError('native MPQ preserving replacement requires at least one changed entry')
  }
  const source = parseArchive(sourceBytes, maxBlocks)
  const names = await namesOf(source)
  const normalized = []
  const folded = new Set()
  let replacementBytes = 0
  for (const candidate of replacements) {
    abort(signal)
    const item = record(candidate)
    const path = portablePath(item?.path)
    const key = path.toLowerCase()
    if (folded.has(key)) throw new TypeError(`duplicate changed MPQ path «${path}»`)
    if (key === '(listfile)' || key === '(attributes)' || key === '(signature)') {
      throw unsupported(`${path} is an opaque native record and cannot be changed by this writer`)
    }
    if (!(item?.bytes instanceof Uint8Array)) {
      throw new TypeError(`changed MPQ entry «${path}» has no bytes`)
    }
    replacementBytes += item.bytes.byteLength
    if (item.bytes.byteLength > maxReplacementBytes || replacementBytes > maxArchiveBytes) {
      throw new RangeError('native MPQ replacements exceed the byte budget')
    }
    const named = names.get(key)
    if (named === undefined) {
      if (matchingBlockIndices(path, source).length > 0) {
        throw unsupported(`MPQ entry «${path}» is ambiguous and cannot be changed safely`)
      }
      throw new TypeError(`MPQ listfile does not name changed entry «${path}»`)
    }
    folded.add(key)
    normalized.push(
      Object.freeze({ path: named.path, bytes: item.bytes.slice(), blockIndex: named.blockIndex }),
    )
  }

  const output = sourceBytes.slice()
  const nextBlockPlain = source.blockPlain.slice()
  const changed = []
  const changedBlocks = new Set()
  for (const replacement of normalized) {
    abort(signal)
    if (changedBlocks.has(replacement.blockIndex)) {
      throw unsupported(
        `multiple listfile aliases resolve to changed MPQ block ${replacement.blockIndex}`,
      )
    }
    const block = source.blockTable[replacement.blockIndex]
    const originalDecoded = await readBlock(source, block, replacement.path)
    if (bytesEqual(originalDecoded, replacement.bytes)) {
      throw new TypeError(`changed MPQ entry «${replacement.path}» is byte-identical to its source`)
    }
    const encoded = await encodeByOriginalMethod(source, block, replacement.path, replacement.bytes)
    abort(signal)
    if (encoded.bytes.byteLength > block.archivedSize) {
      throw unsupported(
        `changed entry «${replacement.path}» needs ${encoded.bytes.byteLength} bytes but its native slot has ${block.archivedSize}`,
      )
    }
    const payloadStart = source.header.offset + block.offset
    output.set(encoded.bytes, payloadStart)
    output.fill(0, payloadStart + encoded.bytes.byteLength, payloadStart + block.archivedSize)
    const entryOffset = block.index * BLOCK_ENTRY_BYTES
    const blockView = viewOf(nextBlockPlain)
    blockView.setUint32(entryOffset + 4, encoded.bytes.byteLength, true)
    blockView.setUint32(entryOffset + 8, replacement.bytes.byteLength, true)
    changedBlocks.add(block.index)
    changed.push(
      Object.freeze({
        path: replacement.path,
        blockIndex: block.index,
        flags: `0x${block.flags.toString(16).padStart(8, '0')}`,
        method: encoded.method,
        sourceBytes: block.size,
        outputBytes: replacement.bytes.byteLength,
        sourceArchivedBytes: block.archivedSize,
        outputArchivedBytes: encoded.bytes.byteLength,
        zeroFilledSlackBytes: block.archivedSize - encoded.bytes.byteLength,
      }),
    )
  }
  const nextBlockCipher = encryptTable(nextBlockPlain, mpqHash('(block table)', HASH_TABLE))
  output.set(nextBlockCipher, source.header.offset + source.header.blockOffset)

  const reopened = parseArchive(output, maxBlocks)
  if (!bytesEqual(source.hashCipher, reopened.hashCipher)) {
    throw new TypeError('native MPQ verification found hash-table drift')
  }
  if (
    source.blockTable.length !== reopened.blockTable.length ||
    source.header.version !== reopened.header.version ||
    source.header.headerSize !== reopened.header.headerSize ||
    source.header.archiveSize !== reopened.header.archiveSize
  ) {
    throw new TypeError('native MPQ verification found archive metadata drift')
  }
  for (const sourceBlock of source.blockTable) {
    abort(signal)
    const outputBlock = reopened.blockTable[sourceBlock.index]
    if (
      outputBlock.offset !== sourceBlock.offset ||
      outputBlock.flags !== sourceBlock.flags ||
      (!changedBlocks.has(sourceBlock.index) &&
        (outputBlock.archivedSize !== sourceBlock.archivedSize ||
          outputBlock.size !== sourceBlock.size))
    ) {
      throw new TypeError(`native MPQ verification found block-table drift at ${sourceBlock.index}`)
    }
    if (
      !changedBlocks.has(sourceBlock.index) &&
      (sourceBlock.flags & FILE_EXISTS) !== 0 &&
      !bytesEqual(rawBlockBytes(source, sourceBlock), rawBlockBytes(reopened, outputBlock))
    ) {
      throw new TypeError(
        `native MPQ verification found untouched payload drift at ${sourceBlock.index}`,
      )
    }
  }
  for (const replacement of normalized) {
    const block = reopened.blockTable[replacement.blockIndex]
    const decoded = await readBlock(reopened, block, replacement.path)
    if (!bytesEqual(decoded, replacement.bytes)) {
      throw new TypeError(
        `native MPQ verification could not reopen changed entry «${replacement.path}»`,
      )
    }
  }
  if (
    !bytesEqual(
      sourceBytes.slice(0, source.header.offset),
      output.slice(0, reopened.header.offset),
    ) ||
    !bytesEqual(
      sourceBytes.slice(source.header.offset + source.header.archiveSize),
      output.slice(reopened.header.offset + reopened.header.archiveSize),
    )
  ) {
    throw new TypeError('native MPQ verification found opaque prefix/suffix drift')
  }
  const rewrittenRegions = normalized
    .map(replacement => {
      const sourceBlock = source.blockTable[replacement.blockIndex]
      return {
        start: source.header.offset + sourceBlock.offset,
        end: source.header.offset + sourceBlock.offset + sourceBlock.archivedSize,
      }
    })
    .concat([
      {
        start: source.header.offset + source.header.blockOffset,
        end:
          source.header.offset +
          source.header.blockOffset +
          source.header.blockEntries * BLOCK_ENTRY_BYTES,
      },
    ])
    .sort((left, right) => left.start - right.start)
  let verifiedUntil = 0
  for (const region of rewrittenRegions) {
    if (
      region.start > verifiedUntil &&
      !bytesEqual(
        sourceBytes.subarray(verifiedUntil, region.start),
        output.subarray(verifiedUntil, region.start),
      )
    ) {
      throw new TypeError('native MPQ verification found drift outside declared rewritten regions')
    }
    verifiedUntil = Math.max(verifiedUntil, region.end)
  }
  if (
    verifiedUntil < sourceBytes.byteLength &&
    !bytesEqual(sourceBytes.subarray(verifiedUntil), output.subarray(verifiedUntil))
  ) {
    throw new TypeError('native MPQ verification found trailing drift outside rewritten regions')
  }

  const namedBlocks = new Set([...names.values()].map(item => item.blockIndex))
  const activeBlocks = source.blockTable.filter(block => (block.flags & FILE_EXISTS) !== 0)
  const attributes = names.get('(attributes)')
  const signature = names.get('(signature)')
  const sourceArchiveDigest = await digest(sourceBytes)
  const outputArchiveDigest = await digest(output)
  const receipt = Object.freeze({
    schemaVersion: 1,
    kind: 'mpq-native-export-receipt-v1',
    strategy: 'whole-archive-save-as-fixed-slots',
    sourceArchiveDigest,
    outputArchiveDigest,
    archiveByteIdentity: sourceArchiveDigest === outputArchiveDigest ? 'identical' : 'changed',
    source: Object.freeze({
      version: source.header.version,
      headerBytes: source.header.headerSize,
      archiveBytes: source.header.archiveSize,
      userDataBytes: source.header.userDataBytes,
      prefixBytes: source.header.offset,
      suffixBytes: sourceBytes.byteLength - source.header.offset - source.header.archiveSize,
      hashSlots: source.hashTable.length,
      blockSlots: source.blockTable.length,
    }),
    unchanged: Object.freeze({
      entries: activeBlocks.length - changedBlocks.size,
      guarantee: 'raw-payload-flags-and-method-byte-identical',
      methods: Object.freeze(
        [
          ...new Set(
            activeBlocks
              .filter(block => !changedBlocks.has(block.index))
              .map(block => methodLabel(source, block)),
          ),
        ].sort(),
      ),
    }),
    changed: Object.freeze(changed),
    tables: Object.freeze({
      hash: 'byte-identical',
      block: 'deterministic-semantic-rebuild-in-original-slot',
      blockOrder: 'preserved',
      blockOffsets: 'preserved',
      sectorTables: changed.some(item => item.method === 'sector-methods-preserved')
        ? 'changed-entry-methods-preserved'
        : 'untouched-byte-identical',
    }),
    opaque: Object.freeze({
      prefix: 'byte-identical',
      suffix: 'byte-identical',
      extendedHeader: 'byte-identical',
      interstitialBytes: 'byte-identical',
      changedEntrySlack: 'zero-filled-no-source-payload-retained',
      sourceArchive: 'not-mutated',
      unnamedBlocks: activeBlocks.filter(block => !namedBlocks.has(block.index)).length,
      unnamedBlocksPolicy: 'byte-identical',
      patchBlocks: activeBlocks.filter(block => (block.flags & FILE_PATCH) !== 0).length,
      patchBlocksPolicy: 'byte-identical-when-untouched',
      attributes: Object.freeze({
        present: attributes !== undefined,
        bytes: attributes === undefined ? 'absent' : 'preserved-opaque',
        status: attributes === undefined ? 'not-present' : 'invalidated-by-modification',
      }),
    }),
    signature: Object.freeze({
      present: signature !== undefined,
      bytes: signature === undefined ? 'absent' : 'preserved-opaque',
      status: signature === undefined ? 'not-present' : 'invalidated-by-modification',
    }),
    launchData: 'outside-writer-scope',
  })
  return Object.freeze({ bytes: output, receipt })
}

export const nativePreservingFidelity = Object.freeze({
  roundTrip: 'semantic',
  preservesUnknownData: true,
  notes: Object.freeze([
    'untouched native MPQ blocks retain byte-identical raw payloads, flags and compression methods',
    'changed entries retain their flags and supported stored/zlib method inside the original block slot',
    'hash order, block order and block offsets stay fixed; the encrypted block table is rebuilt deterministically',
    'unknown blocks, patch blocks, user-data prefixes and archive suffixes are copied opaque',
    'opaque attributes and signatures are copied byte-identically but reported invalidated after modification',
    'unused bytes in each changed native block slot are zero-filled in the new archive; the source archive is never erased or mutated',
    'the result is a separate whole-archive Save As replacement, never an in-place native edit claim',
  ]),
})

export async function validateNativePreservingChange(change, context, signal) {
  abort(context.signal)
  abort(signal)
  const diagnostics = []
  const intent = record(change.semanticIntent)
  const receipt = record(intent?.nativeExportReceipt)
  const receiptSignature = record(receipt?.signature)
  const receiptAttributes = record(record(receipt?.opaque)?.attributes)
  const changedReceiptEntries = Array.isArray(receipt?.changed) ? receipt.changed : []
  const receiptChangesAreValid =
    changedReceiptEntries.length > 0 &&
    changedReceiptEntries.every(item => {
      const entry = record(item)
      return (
        typeof entry?.path === 'string' &&
        entry.path.length > 0 &&
        Number.isSafeInteger(entry.blockIndex) &&
        entry.blockIndex >= 0 &&
        /^0x[0-9a-f]{8}$/u.test(String(entry.flags ?? '')) &&
        typeof entry.method === 'string' &&
        entry.method.length > 0 &&
        Number.isSafeInteger(entry.sourceBytes) &&
        entry.sourceBytes >= 0 &&
        Number.isSafeInteger(entry.outputBytes) &&
        entry.outputBytes >= 0 &&
        Number.isSafeInteger(entry.zeroFilledSlackBytes) &&
        entry.zeroFilledSlackBytes >= 0
      )
    })
  if (
    intent?.kind !== 'mpq-native-preserving-export-v1' ||
    intent.sourceMode !== 'native-mpq' ||
    intent.completeSnapshot !== true ||
    intent.replacementMode !== 'whole-archive-save-as' ||
    intent.unknownDataPolicy !== 'preserve-opaque-source-bytes' ||
    receipt?.kind !== 'mpq-native-export-receipt-v1' ||
    receipt.strategy !== 'whole-archive-save-as-fixed-slots' ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(receipt.sourceArchiveDigest ?? '')) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(receipt.outputArchiveDigest ?? '')) ||
    receipt.archiveByteIdentity !== 'changed' ||
    record(receipt.unchanged)?.guarantee !== 'raw-payload-flags-and-method-byte-identical' ||
    record(receipt.tables)?.hash !== 'byte-identical' ||
    record(receipt.tables)?.block !== 'deterministic-semantic-rebuild-in-original-slot' ||
    record(receipt.tables)?.blockOrder !== 'preserved' ||
    record(receipt.tables)?.blockOffsets !== 'preserved' ||
    record(receipt.opaque)?.prefix !== 'byte-identical' ||
    record(receipt.opaque)?.suffix !== 'byte-identical' ||
    record(receipt.opaque)?.extendedHeader !== 'byte-identical' ||
    record(receipt.opaque)?.interstitialBytes !== 'byte-identical' ||
    record(receipt.opaque)?.changedEntrySlack !== 'zero-filled-no-source-payload-retained' ||
    record(receipt.opaque)?.sourceArchive !== 'not-mutated' ||
    !(
      (receiptAttributes?.present === true &&
        receiptAttributes.bytes === 'preserved-opaque' &&
        receiptAttributes.status === 'invalidated-by-modification') ||
      (receiptAttributes?.present === false &&
        receiptAttributes.bytes === 'absent' &&
        receiptAttributes.status === 'not-present')
    ) ||
    !(
      (receiptSignature?.present === true &&
        receiptSignature.bytes === 'preserved-opaque' &&
        receiptSignature.status === 'invalidated-by-modification') ||
      (receiptSignature?.present === false &&
        receiptSignature.bytes === 'absent' &&
        receiptSignature.status === 'not-present')
    ) ||
    !receiptChangesAreValid
  ) {
    diagnostics.push(
      error(
        'org.modkitx.blizzard/mpq-native-export-intent-invalid',
        'native MPQ export requires a complete source snapshot and fixed-slot preservation receipt',
      ),
    )
  }
  if (
    change.targets.length !== 1 ||
    change.targets[0].expectedRevision.namespaceRevision === undefined
  ) {
    diagnostics.push(
      error(
        'org.modkitx.blizzard/mpq-native-export-target-not-namespace',
        'native MPQ Save As requires one revision-pinned destination namespace',
      ),
    )
  }
  const target = change.targets[0]
  const edit = change.edits[0]
  try {
    const archiveName = archiveNameOf(intent?.archiveName)
    if (
      change.edits.length !== 1 ||
      edit?.operation !== 'create' ||
      target === undefined ||
      edit.targetId !== target.targetId ||
      edit.source.id !== target.ownerSource.id ||
      edit.newPath !== archiveName ||
      edit.payload.kind !== 'inline'
    ) {
      throw new TypeError('native MPQ Save As accepts one inline destination create')
    }
    if (
      edit.payload.bytes.byteLength > context.budgets.maxScalarBytes ||
      BigInt(edit.payload.bytes.byteLength) > context.budgets.maxInputBytes
    ) {
      throw new RangeError('native MPQ output exceeds the provider resource budget')
    }
    parseArchive(edit.payload.bytes, context.budgets.maxNodes)
    if ((await digest(edit.payload.bytes)) !== receipt?.outputArchiveDigest) {
      throw new TypeError('native MPQ output digest does not match its preservation receipt')
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    diagnostics.push(
      error(
        'org.modkitx.blizzard/mpq-native-export-edit-invalid',
        cause instanceof Error ? cause.message : String(cause),
      ),
    )
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) })
}

export async function snapshotNativePreservingMpq(options) {
  const { target, archiveName: requestedArchiveName, signal } = options
  abort(signal)
  if (target?.expectedRevision?.namespaceRevision === undefined) {
    throw new TypeError('native MPQ Save As target is not a revision-pinned namespace')
  }
  const archiveName = archiveNameOf(requestedArchiveName)
  const encoded = await encodeNativePreservingMpq(options)
  abort(signal)
  return Object.freeze({
    targets: Object.freeze([target]),
    edits: Object.freeze([
      Object.freeze({
        operation: 'create',
        targetId: target.targetId,
        source: target.ownerSource,
        newPath: archiveName,
        payload: Object.freeze({ kind: 'inline', bytes: encoded.bytes }),
      }),
    ]),
    semanticIntent: Object.freeze({
      kind: 'mpq-native-preserving-export-v1',
      sourceMode: 'native-mpq',
      completeSnapshot: true,
      replacementMode: 'whole-archive-save-as',
      unknownDataPolicy: 'preserve-opaque-source-bytes',
      archiveName,
      nativeExportReceipt: encoded.receipt,
    }),
    provenance: Object.freeze({ actor: 'user', note: 'bounded native-preserving MPQ Save As' }),
  })
}
