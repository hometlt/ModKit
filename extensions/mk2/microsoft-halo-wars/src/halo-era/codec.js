// Hand-ported Halo Wars ERA reader. The index, names table, Phoenix TEA encryption,
// stored entries, and both raw-deflate container modes are bounded and worker-portable.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/halo-era'
const ECF_MAGIC = 0xdaba7737
const ERA_ID = 0x17fdba9c
const HEADER_SIZE = 0x1e00
const ENTRY_SIZE = 0x38
const EXTRA_DATA_SIZE = ENTRY_SIZE - 0x18
const SIGNATURE_MAGIC = 0x05abdbd8
const STREAM_MAGIC = 0xcc34eead
const STREAM_END_MAGIC = 0xa5d91776
const PHX_BLOCK_SIZE = 64
const MAX_ENTRY_COUNT = 32768

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function checkedRange(total, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > total ||
    length > total - offset
  ) {
    throw new RangeError(`Halo ERA ${label} is outside the source`)
  }
}

function u16be(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 2, '16-bit field')
  return viewOf(bytes).getUint16(offset, false)
}

function u24be(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 3, '24-bit field')
  return ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0)
}

function u32be(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 4, '32-bit field')
  return viewOf(bytes).getUint32(offset, false)
}

function u64be(bytes, offset) {
  return (BigInt(u32be(bytes, offset)) << 32n) | BigInt(u32be(bytes, offset + 4))
}

function safeNumber(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new RangeError(`Halo ERA ${label} is too large`)
  return number
}

function safePath(value, seen) {
  const normalized = value.replaceAll('\\', '/').replace(/\/+/gu, '/')
  const parts = normalized.split('/')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    parts.some(part => part === '..')
  ) {
    throw new TypeError(`unsafe Halo ERA entry path: ${value}`)
  }
  const clean = parts.filter(part => part.length > 0 && part !== '.').join('/')
  const count = seen.get(clean) ?? 0
  seen.set(clean, count + 1)
  if (count === 0) return clean
  const slash = clean.lastIndexOf('/')
  const directory = slash < 0 ? '' : clean.slice(0, slash + 1)
  const name = slash < 0 ? clean : clean.slice(slash + 1)
  return `${directory}${count + 1}-${name}`
}

function compressionMethod(flags, resourceFlags) {
  if ((resourceFlags & 4) !== 0) return 'deflate-stream'
  const method = flags & 7
  if (method === 0) return 'stored'
  if (method === 1) return 'deflate-raw'
  if (method === 2) return 'deflate-stream'
  throw new TypeError(`unsupported Halo ERA compression method ${method}`)
}

function parseChunks(bytes, count, budget) {
  checkedRange(bytes.byteLength, 0, count * ENTRY_SIZE, 'entry table')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = index * ENTRY_SIZE
    const flags = bytes[cursor + 20] ?? 0
    const resourceFlags = u16be(bytes, cursor + 22)
    const uncompressedSize = u32be(bytes, cursor + 32)
    if (uncompressedSize > budget.maxScalarBytes) {
      throw new RangeError(`Halo ERA entry ${index} exceeds maxScalarBytes`)
    }
    entries.push(
      Object.freeze({
        id: u64be(bytes, cursor).toString(16).padStart(16, '0'),
        offset: u32be(bytes, cursor + 8),
        compressedSize: u32be(bytes, cursor + 12),
        uncompressedSize,
        compression: compressionMethod(flags, resourceFlags),
        flags,
        resourceFlags,
        nameOffset: u24be(bytes, cursor + 52),
      }),
    )
  }
  return entries
}

async function inflateRaw(bytes, expectedSize) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('Halo ERA raw-deflate extraction is unavailable in this runtime')
  }
  let stream
  try {
    stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  } catch (error) {
    throw new TypeError(`Halo ERA raw-deflate stream could not be opened: ${String(error)}`)
  }
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  if (output.byteLength !== expectedSize) {
    throw new TypeError(`Halo ERA deflate output size ${output.byteLength} != ${expectedSize}`)
  }
  return output
}

async function decodeCompressedStream(payload, expectedSize) {
  if (payload.byteLength < 40 || u32be(payload, 0) !== STREAM_MAGIC) {
    throw new TypeError('Halo ERA compressed stream header is missing')
  }
  const mode = u32be(payload, 8)
  const decodedSize = safeNumber(u64be(payload, 12), 'compressed stream decoded size')
  const compressedSize = safeNumber(u64be(payload, 20), 'compressed stream stored size')
  let compressed
  let end
  if (mode === 0) {
    checkedRange(payload.byteLength, 36, compressedSize + 4, 'compressed stream payload')
    compressed = payload.subarray(36, 36 + compressedSize)
    end = 36 + compressedSize
  } else if (mode === 1) {
    const chunks = []
    let cursor = 36
    let total = 0
    while (true) {
      checkedRange(payload.byteLength, cursor, 4, 'compressed stream chunk header')
      const size = u16be(payload, cursor)
      const inverse = u16be(payload, cursor + 2)
      cursor += 4
      if ((~size & 0xffff) !== inverse) {
        throw new TypeError('Halo ERA compressed stream chunk size check failed')
      }
      if (size === 0) break
      checkedRange(payload.byteLength, cursor, size, 'compressed stream chunk')
      chunks.push(payload.subarray(cursor, cursor + size))
      total += size
      cursor += size
    }
    if (total !== compressedSize) throw new TypeError('Halo ERA compressed stream size is invalid')
    compressed = new Uint8Array(total)
    let output = 0
    for (const chunk of chunks) {
      compressed.set(chunk, output)
      output += chunk.byteLength
    }
    end = cursor
  } else {
    throw new TypeError(`unsupported Halo ERA compressed stream mode ${mode}`)
  }
  if (u32be(payload, end) !== STREAM_END_MAGIC) {
    throw new TypeError('Halo ERA compressed stream end marker is missing')
  }
  if (decodedSize !== expectedSize) {
    throw new TypeError('Halo ERA compressed stream decoded size is inconsistent')
  }
  return inflateRaw(compressed, expectedSize)
}

async function decodeEntry(bytes, encrypted, entry) {
  checkedRange(bytes.byteLength, entry.offset, entry.compressedSize, `entry ${entry.id}`)
  const payload = encrypted
    ? decryptRange(bytes, entry.offset, entry.compressedSize)
    : bytes.subarray(entry.offset, entry.offset + entry.compressedSize)
  if (entry.compression === 'stored') {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new TypeError('Halo ERA stored entry sizes do not match')
    }
    return payload.slice()
  }
  if (entry.compression === 'deflate-raw') return inflateRaw(payload, entry.uncompressedSize)
  return decodeCompressedStream(payload, entry.uncompressedSize)
}

async function parseArchive(bytes, budget) {
  if (bytes.byteLength < 0x20) throw new TypeError('Halo ERA header is truncated')
  const encrypted = u32be(bytes, 0) !== ECF_MAGIC
  const header = encrypted
    ? decryptRange(bytes, 0, Math.min(bytes.byteLength, HEADER_SIZE))
    : bytes.subarray(0, Math.min(bytes.byteLength, HEADER_SIZE))
  if (header.byteLength < HEADER_SIZE) throw new TypeError('Halo ERA full header is truncated')
  if (u32be(header, 0) !== ECF_MAGIC) throw new TypeError('Halo ERA ECF signature is missing')
  const headerSize = u32be(header, 4)
  const totalSize = u32be(header, 12)
  const count = u16be(header, 16)
  const flags = u16be(header, 18)
  const id = u32be(header, 20)
  const extraDataSize = u16be(header, 24)
  if (headerSize !== HEADER_SIZE || id !== ERA_ID)
    throw new TypeError('unsupported Halo ERA revision')
  if (flags !== 0 || extraDataSize !== EXTRA_DATA_SIZE) {
    throw new TypeError('unsupported Halo ERA index flags')
  }
  if (totalSize !== bytes.byteLength) throw new TypeError('Halo ERA total size is inconsistent')
  if (count < 1 || count > MAX_ENTRY_COUNT || count > budget.maxNodes) {
    throw new RangeError('Halo ERA entries exceed maxNodes')
  }
  if (u32be(header, 0x20) !== SIGNATURE_MAGIC) {
    throw new TypeError('Halo ERA signature block is missing')
  }
  const tableBytes = count * ENTRY_SIZE
  checkedRange(bytes.byteLength, headerSize, tableBytes, 'entry table')
  const table = encrypted
    ? decryptRange(bytes, headerSize, tableBytes)
    : bytes.subarray(headerSize, headerSize + tableBytes)
  const chunks = parseChunks(table, count, budget)
  for (const chunk of chunks) {
    checkedRange(bytes.byteLength, chunk.offset, chunk.compressedSize, `entry ${chunk.id}`)
  }
  const namesChunk = chunks[0]
  if (namesChunk === undefined) throw new TypeError('Halo ERA names entry is missing')
  const namesBytes = await decodeEntry(bytes, encrypted, namesChunk)
  const seen = new Map()
  const entries = []
  let nameCursor = 0
  for (const chunk of chunks.slice(1)) {
    if (chunk.nameOffset !== nameCursor) throw new TypeError('Halo ERA names table is inconsistent')
    const end = namesBytes.indexOf(0, nameCursor)
    if (end < 0) throw new TypeError('Halo ERA entry name is not terminated')
    const raw = new TextDecoder('ascii').decode(namesBytes.subarray(nameCursor, end))
    entries.push(Object.freeze({ ...chunk, path: safePath(raw, seen), index: entries.length }))
    nameCursor = end + 1
  }
  return Object.freeze({
    encrypted,
    headerSize,
    totalSize,
    entries: Object.freeze(entries),
    methods: Object.freeze([...new Set(chunks.map(chunk => chunk.compression))].sort()),
  })
}

function looksPlain(prefix) {
  return (
    prefix.byteLength >= 0x24 &&
    u32be(prefix, 0) === ECF_MAGIC &&
    u32be(prefix, 4) === HEADER_SIZE &&
    u32be(prefix, 20) === ERA_ID &&
    u32be(prefix, 0x20) === SIGNATURE_MAGIC
  )
}

function looksEncrypted(prefix) {
  if (prefix.byteLength < PHX_BLOCK_SIZE) return false
  try {
    const header = decryptRange(prefix, 0, PHX_BLOCK_SIZE)
    return looksPlain(header)
  } catch {
    return false
  }
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [String(entry.index), entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('Halo ERA page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid Halo ERA cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: String(entry.index),
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          storedSize: BigInt(entry.compressedSize),
          size: BigInt(entry.uncompressedSize),
          compression: entry.compression,
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
      if (!byId.has(entryId)) throw new TypeError(`unknown Halo ERA entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `halo-era-entry:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const MASK32 = 0xffffffffn
const MASK64 = 0xffffffffffffffffn
const PHX_KEY = [0xbc3eb6b4d0471ddbn, 0x8299e6431912be73n, 0x4601515d43d26df5n]
const PHX_DELTA = 0x9e3779b9n
const PHX_ITERATION_MOD = 0xbccd0923n

function wrap64(value) {
  return value & MASK64
}

function low32(value) {
  return value & MASK32
}

function decryptRounds(value, key0, key1) {
  let left = value >> 32n
  let right = value & MASK32
  let sum = low32(PHX_DELTA << 4n)
  for (let index = 0; index < 16; index += 1) {
    left = wrap64(
      left -
        low32((low32(right) >> 5n) ^ sum) -
        wrap64(right ^ key1) -
        low32(low32(right) << 4n) -
        (key1 >> 32n),
    )
    right = wrap64(
      right -
        low32((low32(left) >> 5n) ^ sum) -
        wrap64(left ^ key0) -
        low32(low32(left) << 4n) -
        (key0 >> 32n),
    )
    sum = low32(sum - PHX_DELTA)
  }
  return wrap64((left << 32n) | (right & MASK32))
}

function decryptBlock(a, b, c, d, key0, key1) {
  return [
    decryptRounds(a, key0, key1),
    decryptRounds(b, key0, key1),
    decryptRounds(c, key0, key1),
    decryptRounds(d, key0, key1),
  ]
}

function sequence0(value) {
  let next = wrap64((low32(value) << 17n) ^ value)
  next = wrap64((low32(next) >> 13n) ^ next)
  next = wrap64((low32(next) << 5n) ^ next)
  return [next, wrap64(low32(next) + 0x15ef0af334248fe2n)]
}

function sequence1(value) {
  let next = wrap64((low32(value) << 17n) ^ value)
  next = wrap64((low32(next) >> 13n) ^ next)
  next = wrap64((low32(next) << 5n) ^ next)
  return [next, wrap64(low32(next) + 0xea10f50ccbdb701en)]
}

function decryptIteration(input, iteration) {
  const [block0, block1, block2, block3, block4, block5, block6, block7] = input
  const [t1, t2, t3, t4] = decryptBlock(block0, block1, block2, block3, PHX_KEY[0], PHX_KEY[1])
  const [t5, t6, t7, t8] = decryptBlock(
    block6 ^ block7,
    block4 ^ block5 ^ block7,
    block4 ^ block6,
    block7 ^ block5,
    PHX_KEY[1],
    PHX_KEY[2],
  )
  const [t9, t10, t11, t12] = decryptBlock(
    t4 ^ block7,
    wrap64(wrap64(t1 - (block6 ^ block7)) ^ t2 ^ block6 ^ block5),
    wrap64(t2 ^ block6 ^ block5 ^ wrap64(t3 + (block5 ^ block4))),
    wrap64(t4 ^ block7 ^ wrap64(t3 + (block5 ^ block4))),
    PHX_KEY[1],
    PHX_KEY[0],
  )
  let sequence = wrap64(BigInt(iteration) + PHX_ITERATION_MOD)
  if (sequence === 0n) sequence = 1n
  const values = []
  ;[sequence, values[0]] = sequence0(sequence)
  ;[sequence, values[1]] = sequence1(sequence)
  ;[sequence, values[2]] = sequence0(sequence)
  ;[sequence, values[3]] = sequence1(sequence)
  ;[sequence, values[4]] = sequence0(sequence)
  ;[sequence, values[5]] = sequence1(sequence)
  ;[sequence, values[6]] = sequence0(sequence)
  ;[sequence, values[7]] = sequence1(sequence)
  return [
    wrap64(values[0] ^ t9),
    wrap64(values[1] ^ t10),
    wrap64(values[2] ^ t11),
    wrap64(values[3] ^ t12),
    wrap64(values[4] ^ t5 ^ t4 ^ block7),
    wrap64(values[5] ^ wrap64(t3 + (block5 ^ block4) + t6)),
    wrap64(values[6] ^ t7 ^ t2 ^ block6 ^ block5),
    wrap64(values[7] ^ wrap64(t8 - wrap64(t1 - (block6 ^ block7)))),
  ]
}

function writeU64be(bytes, offset, value) {
  const view = viewOf(bytes)
  view.setBigUint64(offset, wrap64(value), false)
}

function decryptRange(bytes, offset, length) {
  checkedRange(bytes.byteLength, offset, length, 'encrypted range')
  const start = Math.floor(offset / PHX_BLOCK_SIZE) * PHX_BLOCK_SIZE
  const end = Math.min(
    bytes.byteLength,
    Math.ceil((offset + length) / PHX_BLOCK_SIZE) * PHX_BLOCK_SIZE,
  )
  const output = new Uint8Array(end - start)
  for (let cursor = start; cursor < end; cursor += PHX_BLOCK_SIZE) {
    if (cursor + PHX_BLOCK_SIZE > bytes.byteLength) {
      output.set(bytes.subarray(cursor, end), cursor - start)
      break
    }
    const input = Array.from({ length: 8 }, (_, index) => u64be(bytes, cursor + index * 8))
    const decrypted = decryptIteration(input, cursor / PHX_BLOCK_SIZE)
    for (let index = 0; index < 8; index += 1) {
      writeU64be(output, cursor - start + index * 8, decrypted[index])
    }
  }
  return output.subarray(offset - start, offset - start + length)
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'halo-era', label: 'Halo Wars Ensemble Resource Archive' }),
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
    if (looksPlain(prefix)) return { confidence: 0.99, kind: 'magic', note: 'Halo ERA ECF' }
    return looksEncrypted(prefix)
      ? { confidence: 0.96, kind: 'structure', note: 'Phoenix TEA encrypted Halo ERA' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = await parseArchive(bytes, context.budget)
    const byId = new Map(archive.entries.map(entry => [String(entry.index), entry]))
    const compressed = archive.entries.filter(entry => entry.compression !== 'stored').length
    return {
      summary: {
        format: 'halo-era',
        encrypted: archive.encrypted,
        entries: archive.entries.length,
        compressed,
        compressionMethods: archive.methods,
      },
      metadata: [
        {
          id: 'halo-era',
          label: 'Halo Wars ERA',
          entries: [
            { key: 'encrypted', value: archive.encrypted },
            { key: 'entries', value: archive.entries.length },
            { key: 'compressedEntries', value: compressed },
            { key: 'headerSize', value: archive.headerSize },
            { key: 'compressionMethods', value: archive.methods.join(', ') },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: archive.methods } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Halo Wars ERA',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.uncompressedSize} bytes, ${entry.compression}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(archive.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('Halo ERA entry id was not found')
          return { kind: 'bytes', value: await decodeEntry(bytes, archive.encrypted, entry) }
        },
      },
      maxDecodedBytes: archive.entries.reduce(
        (total, entry) => total + BigInt(entry.uncompressedSize),
        0n,
      ),
      unsupportedFeatures: ['archive-writing', 'archive-mutation'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
