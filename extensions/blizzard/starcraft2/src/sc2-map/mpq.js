import { simpleLease } from '@modkitx-x3/codec-kit'

const HASH_TYPE = Object.freeze({ TABLE_OFFSET: 0, HASH_A: 1, HASH_B: 2, TABLE: 3 })
const FILE_COMPRESS = 0x00000200
const FILE_ENCRYPTED = 0x00010000
const FILE_SINGLE_UNIT = 0x01000000
const FILE_EXISTS = 0x80000000

const cryptTable = (() => {
  let seed = 0x00100001
  const table = []
  for (let slot = 0; slot < 0x100; slot += 1) {
    let index = slot
    for (let round = 0; round < 5; round += 1) {
      seed = (seed * 125 + 3) % 0x2aaaab
      const high = (seed & 0xffff) << 16
      seed = (seed * 125 + 3) % 0x2aaaab
      table[index] = (high | (seed & 0xffff)) >>> 0
      index += 0x100
    }
  }
  return Object.freeze(table)
})()

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u16(bytes, offset) {
  return view(bytes).getUint16(offset, true)
}

function u32(bytes, offset) {
  return view(bytes).getUint32(offset, true)
}

export function mpqMagic(bytes, offset = 0) {
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
    throw new RangeError(`SC2 MPQ ${label} is outside the archive`)
  }
  return bytes.slice(offset, offset + length)
}

function mpqHash(input, type) {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee
  for (const original of new TextEncoder().encode(input)) {
    const value = original >= 0x61 && original <= 0x7a ? original - 0x20 : original
    seed1 = (cryptTable[((type << 8) + value) & 0x3ff] ^ (seed1 + seed2)) >>> 0
    seed2 = (value + seed1 + seed2 + (seed2 << 5) + 3) >>> 0
  }
  return seed1 >>> 0
}

function decrypt(data, key) {
  const output = data.slice()
  const input = view(data)
  const result = view(output)
  let seed1 = key >>> 0
  let seed2 = 0xeeeeeeee
  for (let offset = 0; offset + 4 <= data.byteLength; offset += 4) {
    seed2 = (seed2 + cryptTable[0x400 + (seed1 & 0xff)]) >>> 0
    const encrypted = input.getUint32(offset, true)
    const plain = (encrypted ^ (seed1 + seed2)) >>> 0
    seed1 = (((~seed1 << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0
    seed2 = (plain + seed2 + (seed2 << 5) + 3) >>> 0
    result.setUint32(offset, plain, true)
  }
  return output
}

function parseHeader(bytes) {
  let offset = 0
  let userDataBytes = 0
  if (mpqMagic(bytes) === 'MPQ\u001b') {
    checkedSlice(bytes, 0, 16, 'user-data header')
    userDataBytes = u32(bytes, 4)
    offset = u32(bytes, 8)
  }
  if (mpqMagic(bytes, offset) !== 'MPQ\u001a')
    throw new TypeError('SC2 MPQ archive header is missing')
  checkedSlice(bytes, offset, 32, 'base header')
  const version = u16(bytes, offset + 12)
  if (version > 3) throw new TypeError(`SC2 MPQ version ${version} is not supported`)
  const headerSize = u32(bytes, offset + 4)
  if (headerSize < (version === 0 ? 32 : 44)) throw new TypeError('SC2 MPQ header size is invalid')
  if (version > 0) {
    const extended = checkedSlice(bytes, offset + 32, 12, 'extended header')
    if (
      view(extended).getBigUint64(0, true) !== 0n ||
      view(extended).getUint16(8, true) !== 0 ||
      view(extended).getUint16(10, true) !== 0
    ) {
      throw new TypeError('SC2 MPQ high-offset tables are not supported')
    }
  }
  return Object.freeze({
    offset,
    userDataBytes,
    headerSize,
    archivedSize: u32(bytes, offset + 8),
    version,
    sectorShift: u16(bytes, offset + 14),
    hashOffset: u32(bytes, offset + 16),
    blockOffset: u32(bytes, offset + 20),
    hashEntries: u32(bytes, offset + 24),
    blockEntries: u32(bytes, offset + 28),
  })
}

function parseTables(bytes, header, maxNodes) {
  if (header.hashEntries > maxNodes || header.blockEntries > maxNodes) {
    throw new RangeError('SC2 MPQ tables exceed maxNodes budget')
  }
  const hashData = decrypt(
    checkedSlice(bytes, header.offset + header.hashOffset, header.hashEntries * 16, 'hash table'),
    mpqHash('(hash table)', HASH_TYPE.TABLE),
  )
  const blockData = decrypt(
    checkedSlice(
      bytes,
      header.offset + header.blockOffset,
      header.blockEntries * 16,
      'block table',
    ),
    mpqHash('(block table)', HASH_TYPE.TABLE),
  )
  const hashTable = []
  for (let index = 0; index < header.hashEntries; index += 1) {
    const offset = index * 16
    hashTable.push(
      Object.freeze({
        hashA: u32(hashData, offset),
        hashB: u32(hashData, offset + 4),
        blockIndex: u32(hashData, offset + 12),
      }),
    )
  }
  const blockTable = []
  for (let index = 0; index < header.blockEntries; index += 1) {
    const offset = index * 16
    blockTable.push(
      Object.freeze({
        index,
        offset: u32(blockData, offset),
        archivedSize: u32(blockData, offset + 4),
        size: u32(blockData, offset + 8),
        flags: u32(blockData, offset + 12),
      }),
    )
  }
  return Object.freeze({
    hashTable: Object.freeze(hashTable),
    blockTable: Object.freeze(blockTable),
  })
}

function findBlock(path, tables) {
  if (tables.hashTable.length === 0) return undefined
  const normalized = path.replaceAll('/', '\\')
  const hashA = mpqHash(normalized, HASH_TYPE.HASH_A)
  const hashB = mpqHash(normalized, HASH_TYPE.HASH_B)
  const first = mpqHash(normalized, HASH_TYPE.TABLE_OFFSET) % tables.hashTable.length
  for (let probe = 0; probe < tables.hashTable.length; probe += 1) {
    const entry = tables.hashTable[(first + probe) % tables.hashTable.length]
    if (entry.blockIndex === 0xffffffff) break
    if (entry.blockIndex === 0xfffffffe) continue
    const block = tables.blockTable[entry.blockIndex]
    if (
      entry.hashA === hashA &&
      entry.hashB === hashB &&
      block !== undefined &&
      (block.flags & FILE_EXISTS) !== 0
    ) {
      return block
    }
  }
  return undefined
}

function readStoredEntry(bytes, header, block, label) {
  if ((block.flags & FILE_ENCRYPTED) !== 0) throw new TypeError(`encrypted SC2 MPQ entry: ${label}`)
  if ((block.flags & FILE_SINGLE_UNIT) === 0 || (block.flags & FILE_COMPRESS) !== 0) {
    throw new TypeError(`compressed or sector-based SC2 MPQ entry: ${label}`)
  }
  const data = checkedSlice(bytes, header.offset + block.offset, block.archivedSize, label)
  if (data.byteLength !== block.size) throw new TypeError(`SC2 MPQ entry size mismatch: ${label}`)
  return data
}

export function parseSc2Mpq(bytes, maxNodes) {
  const header = parseHeader(bytes)
  const tables = parseTables(bytes, header, maxNodes)
  const names = []
  const listBlock = findBlock('(listfile)', tables)
  if (listBlock !== undefined) {
    try {
      names.push(
        ...new TextDecoder()
          .decode(readStoredEntry(bytes, header, listBlock, '(listfile)'))
          .split(/\r?\n/u)
          .map(value => value.trim().replaceAll('\\', '/'))
          .filter(Boolean),
      )
    } catch {
      // Unsupported listfile encoding leaves anonymous blocks visible below.
    }
  }
  if (listBlock !== undefined) names.push('(listfile)')
  const used = new Set()
  const entries = []
  for (const path of [...new Set(names)]) {
    const block = findBlock(path, tables)
    if (block === undefined || used.has(block.index)) continue
    used.add(block.index)
    entries.push(
      Object.freeze({
        id: path,
        path,
        name: path.split('/').at(-1) ?? path,
        size: block.size,
        archivedSize: block.archivedSize,
        flags: block.flags,
      }),
    )
  }
  for (const block of tables.blockTable) {
    if ((block.flags & FILE_EXISTS) === 0 || used.has(block.index)) continue
    const path = `block/${String(block.index).padStart(4, '0')}`
    entries.push(
      Object.freeze({
        id: path,
        path,
        name: path,
        size: block.size,
        archivedSize: block.archivedSize,
        flags: block.flags,
      }),
    )
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return Object.freeze({ header, tables, entries: Object.freeze(entries) })
}

export function sc2ArchiveEntryNames(archive) {
  return Object.freeze(archive.entries.map(entry => entry.path))
}

export function sc2ArchiveHasEntry(archive, path) {
  return findBlock(path, archive.tables) !== undefined
}

export function createSc2NamespaceSource(archive, source) {
  const entries = archive.entries
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('SC2 namespace page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid SC2 namespace cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          size: BigInt(entry.size),
          revision: source.revision,
        }),
      )
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const entry = byId.get(entryId)
      if (entry === undefined) throw new TypeError(`unknown SC2 archive entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `sc2-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

export function findReplaySignature(bytes) {
  if (mpqMagic(bytes) !== 'MPQ\u001b' || bytes.byteLength < 16) return -1
  const end = Math.min(bytes.byteLength, 16 + u32(bytes, 4))
  const expected = new TextEncoder().encode('StarCraft II replay')
  for (let offset = 16; offset + expected.byteLength <= end; offset += 1) {
    if (expected.every((value, index) => bytes[offset + index] === value)) return offset
  }
  return -1
}
