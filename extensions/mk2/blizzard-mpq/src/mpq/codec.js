import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/mpq'
const HASH_TYPE = Object.freeze({ TABLE_OFFSET: 0, HASH_A: 1, HASH_B: 2, TABLE: 3 })
const FILE_IMPLODE = 0x00000100
const FILE_COMPRESS = 0x00000200
const FILE_ENCRYPTED = 0x00010000
const FILE_PATCH = 0x00100000
const FILE_SINGLE_UNIT = 0x01000000
const FILE_SECTOR_CRC = 0x04000000
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

function mpqHash(input, type) {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee
  for (const original of new TextEncoder().encode(input)) {
    const value = original >= 0x61 && original <= 0x7a ? original - 0x20 : original
    const encrypted = cryptTable[((type << 8) + value) & 0x3ff]
    seed1 = (encrypted ^ (seed1 + seed2)) >>> 0
    seed2 = (value + seed1 + seed2 + (seed2 << 5) + 3) >>> 0
  }
  return seed1 >>> 0
}

function decrypt(data, key) {
  let seed1 = key >>> 0
  let seed2 = 0xeeeeeeee
  const output = data.slice()
  const dwords = Math.floor(data.byteLength / 4)
  const inputView = viewOf(data)
  const outputView = viewOf(output)
  for (let index = 0; index < dwords; index += 1) {
    seed2 = (seed2 + cryptTable[0x400 + (seed1 & 0xff)]) >>> 0
    const cipher = inputView.getUint32(index * 4, true)
    const plain = (cipher ^ (seed1 + seed2)) >>> 0
    seed1 = (((~seed1 << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0
    seed2 = (plain + seed2 + (seed2 << 5) + 3) >>> 0
    outputView.setUint32(index * 4, plain, true)
  }
  return output
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

function parseHeader(bytes) {
  if (bytes.byteLength < 32) throw new TypeError('MPQ header is truncated')
  let offset = 0
  let userDataBytes = 0
  if (magic(bytes) === 'MPQ\u001b') {
    if (bytes.byteLength < 16) throw new TypeError('MPQ user-data header is truncated')
    userDataBytes = u32(bytes, 4)
    offset = u32(bytes, 8)
  }
  if (magic(bytes, offset) !== 'MPQ\u001a') throw new TypeError('MPQ magic is missing')
  checkedSlice(bytes, offset, 32, 'base header')
  const version = u16(bytes, offset + 12)
  if (version > 3) throw new TypeError(`MPQ version ${version} is not supported`)
  const headerSize = u32(bytes, offset + 4)
  if (headerSize < (version === 0 ? 32 : 44)) throw new TypeError('MPQ header size is invalid')
  if (version > 0) {
    const extended = checkedSlice(bytes, offset + 32, 12, 'extended header')
    const view = viewOf(extended)
    if (
      view.getBigUint64(0, true) !== 0n ||
      view.getUint16(8, true) !== 0 ||
      view.getUint16(10, true) !== 0
    ) {
      throw new TypeError('MPQ high-offset tables are not supported')
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
    throw new RangeError('MPQ tables exceed the node budget')
  }
  const hashBytes = header.hashEntries * 16
  const blockBytes = header.blockEntries * 16
  if (!Number.isSafeInteger(hashBytes) || !Number.isSafeInteger(blockBytes)) {
    throw new RangeError('MPQ table size overflows')
  }
  const hashData = decrypt(
    checkedSlice(bytes, header.offset + header.hashOffset, hashBytes, 'hash table'),
    mpqHash('(hash table)', HASH_TYPE.TABLE),
  )
  const blockData = decrypt(
    checkedSlice(bytes, header.offset + header.blockOffset, blockBytes, 'block table'),
    mpqHash('(block table)', HASH_TYPE.TABLE),
  )
  const hashTable = []
  for (let index = 0; index < header.hashEntries; index += 1) {
    const offset = index * 16
    hashTable.push({
      hashA: u32(hashData, offset),
      hashB: u32(hashData, offset + 4),
      locale: u16(hashData, offset + 8),
      platform: u16(hashData, offset + 10),
      blockIndex: u32(hashData, offset + 12),
    })
  }
  const blockTable = []
  for (let index = 0; index < header.blockEntries; index += 1) {
    const offset = index * 16
    blockTable.push({
      index,
      offset: u32(blockData, offset),
      archivedSize: u32(blockData, offset + 4),
      size: u32(blockData, offset + 8),
      flags: u32(blockData, offset + 12),
    })
  }
  return Object.freeze({
    hashTable: Object.freeze(hashTable),
    blockTable: Object.freeze(blockTable),
  })
}

function lookupCandidates(path) {
  const normalized = path.replaceAll('/', '\\')
  try {
    const decoded = decodeURIComponent(normalized)
    return decoded === normalized ? [normalized] : [normalized, decoded]
  } catch {
    return [normalized]
  }
}

function findBlock(path, tables) {
  if (tables.hashTable.length === 0) return undefined
  for (const candidate of lookupCandidates(path)) {
    const hashA = mpqHash(candidate, HASH_TYPE.HASH_A)
    const hashB = mpqHash(candidate, HASH_TYPE.HASH_B)
    const first = mpqHash(candidate, HASH_TYPE.TABLE_OFFSET) % tables.hashTable.length
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
  }
  return undefined
}

async function inflate(payload) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('MPQ zlib decompression requires DecompressionStream')
  }
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompressSector(data, label) {
  if (data.byteLength === 0) throw new TypeError(`MPQ compressed ${label} is empty`)
  const method = data[0]
  if (method === 0) return data.slice(1)
  if (method === 2) return inflate(data.slice(1))
  throw new TypeError(`MPQ compression 0x${method.toString(16)} is not supported for ${label}`)
}

function assertReadable(block, label) {
  if ((block.flags & FILE_ENCRYPTED) !== 0) throw new TypeError(`MPQ encrypted entry: ${label}`)
  if ((block.flags & FILE_IMPLODE) !== 0) throw new TypeError(`MPQ implode entry: ${label}`)
  if ((block.flags & FILE_PATCH) !== 0) throw new TypeError(`MPQ patch entry: ${label}`)
}

async function readEntry(bytes, header, block, label) {
  assertReadable(block, label)
  const offset = header.offset + block.offset
  if (block.archivedSize === 0) return new Uint8Array()
  if ((block.flags & FILE_SINGLE_UNIT) !== 0) {
    let data = checkedSlice(bytes, offset, block.archivedSize, label)
    if ((block.flags & FILE_COMPRESS) !== 0 && block.size > block.archivedSize) {
      data = await decompressSector(data, label)
    }
    if (data.byteLength !== block.size) throw new TypeError(`MPQ entry size mismatch: ${label}`)
    return data
  }
  if ((block.flags & FILE_COMPRESS) === 0) {
    const data = checkedSlice(bytes, offset, block.archivedSize, label)
    if (data.byteLength !== block.size) throw new TypeError(`MPQ entry size mismatch: ${label}`)
    return data
  }
  if (header.sectorShift > 20) throw new TypeError('MPQ sector size is not supported')
  const sectorSize = 512 * 2 ** header.sectorShift
  const sectorCount = Math.ceil(block.size / sectorSize)
  const positionCount = sectorCount + 1 + ((block.flags & FILE_SECTOR_CRC) !== 0 ? 1 : 0)
  const table = checkedSlice(bytes, offset, positionCount * 4, `${label} sector table`)
  const positions = Array.from({ length: positionCount }, (_, index) => u32(table, index * 4))
  if (positions[0] < positionCount * 4) throw new TypeError(`MPQ invalid sector table: ${label}`)
  const output = new Uint8Array(block.size)
  let target = 0
  for (let index = 0; index < sectorCount; index += 1) {
    const start = positions[index]
    const end = positions[index + 1]
    if (end < start || end > block.archivedSize) throw new TypeError(`MPQ invalid sector: ${label}`)
    const expected = Math.min(sectorSize, block.size - target)
    let sector = checkedSlice(bytes, offset + start, end - start, `${label} sector ${index}`)
    if (sector.byteLength < expected) sector = await decompressSector(sector, `${label}#${index}`)
    if (sector.byteLength !== expected) throw new TypeError(`MPQ sector size mismatch: ${label}`)
    output.set(sector, target)
    target += sector.byteLength
  }
  return output
}

async function parseArchive(bytes, maxNodes) {
  const header = parseHeader(bytes)
  const tables = parseTables(bytes, header, maxNodes)
  const named = []
  const listBlock = findBlock('(listfile)', tables)
  if (listBlock !== undefined) {
    try {
      const listBytes = await readEntry(bytes, header, listBlock, '(listfile)')
      named.push(
        ...new TextDecoder()
          .decode(listBytes)
          .split(/\r?\n/u)
          .map(path => path.trim().replaceAll('\\', '/'))
          .filter(path => path.length > 0),
      )
    } catch {
      // A stale or unsupported listfile must not hide the readable table entries.
    }
  }
  for (const internal of ['(listfile)', '(attributes)']) {
    if (findBlock(internal, tables) !== undefined) named.push(internal)
  }
  const entries = []
  const used = new Set()
  for (const path of [...new Set(named)]) {
    const block = findBlock(path, tables)
    if (block === undefined || used.has(block.index)) continue
    used.add(block.index)
    entries.push({ id: path, path, name: path.split('/').at(-1) ?? path, block })
  }
  for (const block of tables.blockTable) {
    if ((block.flags & FILE_EXISTS) === 0 || used.has(block.index)) continue
    const id = `block/${String(block.index).padStart(4, '0')}`
    entries.push({ id, path: id, name: id, block })
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : 1))
  return Object.freeze({ header, tables, entries: Object.freeze(entries) })
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('MPQ namespace page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid MPQ page cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          size: BigInt(entry.block.size),
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
      if (entry === undefined) throw new TypeError(`unknown MPQ entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `mpq-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'mpq', label: 'Blizzard MPQ archive' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async detect(prefix) {
    const matches = magic(prefix) === 'MPQ\u001a' || magic(prefix) === 'MPQ\u001b'
    return matches
      ? { confidence: 0.99, kind: 'magic', note: 'MPQ header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = await parseArchive(bytes, context.budget.maxNodes)
    const tree = createTreeDataSource({
      kind: 'archive',
      label: 'MPQ',
      preview: `${archive.entries.length} entries, version ${archive.header.version}`,
      children: archive.entries.map(entry => ({
        kind: 'file',
        label: entry.path,
        preview: `${entry.block.size} bytes, flags 0x${entry.block.flags.toString(16)}`,
      })),
    })
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    return {
      summary: {
        format: 'mpq',
        version: archive.header.version,
        entries: archive.entries.length,
        hashSlots: archive.tables.hashTable.length,
        blocks: archive.tables.blockTable.length,
      },
      metadata: [
        {
          id: 'mpq-archive',
          label: 'MPQ archive',
          entries: [
            { key: 'version', value: archive.header.version },
            { key: 'headerBytes', value: archive.header.headerSize },
            { key: 'userDataBytes', value: archive.header.userDataBytes },
            { key: 'entries', value: archive.entries.length },
            { key: 'blocks', value: archive.tables.blockTable.length },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored', 'zlib'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/namespace-entry-source': namespaceSource(archive.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('MPQ entry id was not found')
          return {
            kind: 'bytes',
            value: await readEntry(bytes, archive.header, entry.block, entry.path),
          }
        },
      },
      maxDecodedBytes: archive.entries.reduce((sum, entry) => sum + BigInt(entry.block.size), 0n),
      unsupportedFeatures: [
        'encrypted-entries',
        'implode-compression',
        'bzip2-compression',
        'patch-entries',
        'high-offset-tables',
        'mpq-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
