// Hand-ported Emperor RFH/RFD reader. Retail RFH tables are safely inventoryable from one
// source; the deterministic embedded layout also permits stored and zlib extraction in workers.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/emperor-rfh-rfd'
const HEADER_BYTES = 16
const RECORD_BYTES = 24
const RETAIL_RECORD_BYTES = 24
const MAX_NAME_BYTES = 4096
const EMBEDDED_FLAG = 0x80000000
const RETAIL_COMPRESSED = 2
const METHOD_STORE = 0
const METHOD_DEFLATE = 1

function dataView(bytes) {
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
    throw new RangeError(`RFH/RFD ${label} is outside the source`)
  }
}

function u16le(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 2, '16-bit field')
  return dataView(bytes).getUint16(offset, true)
}

function u32le(bytes, offset) {
  checkedRange(bytes.byteLength, offset, 4, '32-bit field')
  return dataView(bytes).getUint32(offset, true)
}

function tag(bytes) {
  if (bytes.byteLength < 4) return ''
  return String.fromCharCode(...bytes.subarray(0, 4))
}

function safePath(raw, label) {
  const value = raw.replaceAll('\\', '/')
  const parts = value.split('/')
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || parts.some(part => part === '..')) {
    throw new TypeError(`RFH/RFD ${label} contains an unsafe path`)
  }
  const clean = parts.filter(part => part.length > 0 && part !== '.').join('/')
  if (clean.length === 0) throw new TypeError(`RFH/RFD ${label} contains an empty path`)
  return clean
}

function embeddedSignature(bytes) {
  return tag(bytes) === 'RFH\0'
}

function rfdSignature(bytes) {
  return tag(bytes) === 'RFD\0'
}

function parseEmbedded(bytes, budget) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('RFH embedded header is truncated')
  const version = u32le(bytes, 4)
  const flags = u32le(bytes, 8)
  const count = u32le(bytes, 12)
  if (version > 1) throw new TypeError(`unsupported RFH embedded version ${version}`)
  if (count > budget.maxNodes) throw new RangeError('RFH entries exceed maxNodes')
  checkedRange(bytes.byteLength, HEADER_BYTES, count * RECORD_BYTES, 'entry table')
  const embedded = (flags & EMBEDDED_FLAG) !== 0
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = HEADER_BYTES + index * RECORD_BYTES
    const nameOffset = u32le(bytes, cursor)
    const nameLength = u16le(bytes, cursor + 4)
    const entryFlags = u16le(bytes, cursor + 6)
    const offset = u32le(bytes, cursor + 8)
    const compressedSize = u32le(bytes, cursor + 12)
    const uncompressedSize = u32le(bytes, cursor + 16)
    const compressionMethod = u32le(bytes, cursor + 20)
    checkedRange(bytes.byteLength, nameOffset, nameLength, `entry ${index} name`)
    if (embedded) checkedRange(bytes.byteLength, offset, compressedSize, `entry ${index} payload`)
    if (uncompressedSize > budget.maxScalarBytes) {
      throw new RangeError(`RFH entry ${index} exceeds maxScalarBytes`)
    }
    const rawName = new TextDecoder()
      .decode(bytes.subarray(nameOffset, nameOffset + nameLength))
      .replace(/\0+$/gu, '')
    entries.push(
      Object.freeze({
        id: String(index),
        path: safePath(rawName, `entry ${index}`),
        offset,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        flags: entryFlags,
        timestamp: undefined,
        payloadPrefixSize: 0,
      }),
    )
  }
  return Object.freeze({
    layout: 'embedded',
    version,
    flags,
    embedded,
    entries: Object.freeze(entries),
  })
}

function parseRetail(bytes, budget) {
  if (bytes.byteLength < RETAIL_RECORD_BYTES + 1) throw new TypeError('retail RFH is too small')
  const entries = []
  let cursor = 0
  while (cursor < bytes.byteLength) {
    if (entries.length >= budget.maxNodes) throw new RangeError('RFH entries exceed maxNodes')
    checkedRange(bytes.byteLength, cursor, RETAIL_RECORD_BYTES, `entry ${entries.length} record`)
    const nameLength = u32le(bytes, cursor)
    if (nameLength < 1 || nameLength > MAX_NAME_BYTES) {
      throw new TypeError(`invalid RFH entry name length ${nameLength}`)
    }
    const nameStart = cursor + RETAIL_RECORD_BYTES
    checkedRange(bytes.byteLength, nameStart, nameLength, `entry ${entries.length} name`)
    const timestamp = u32le(bytes, cursor + 4)
    const flags = u32le(bytes, cursor + 8)
    const compressedSize = u32le(bytes, cursor + 12)
    const uncompressedSize = u32le(bytes, cursor + 16)
    const offset = u32le(bytes, cursor + 20)
    if (flags !== 0 && flags !== RETAIL_COMPRESSED) {
      throw new TypeError(`unsupported retail RFH flags 0x${flags.toString(16)}`)
    }
    if (flags === 0 && compressedSize !== uncompressedSize) {
      throw new TypeError('retail RFH stored entry sizes do not match')
    }
    if (flags === RETAIL_COMPRESSED && compressedSize <= 4) {
      throw new TypeError('retail RFH compressed entry is too small')
    }
    if (uncompressedSize > budget.maxScalarBytes) {
      throw new RangeError(`RFH entry ${entries.length} exceeds maxScalarBytes`)
    }
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength)
    if (nameBytes.at(-1) !== 0) throw new TypeError('retail RFH entry name is not terminated')
    const path = safePath(
      new TextDecoder('windows-1252').decode(nameBytes).replace(/\0+$/gu, ''),
      `entry ${entries.length}`,
    )
    entries.push(
      Object.freeze({
        id: String(entries.length),
        path,
        offset,
        compressedSize,
        uncompressedSize,
        compressionMethod: flags === RETAIL_COMPRESSED ? METHOD_DEFLATE : METHOD_STORE,
        flags,
        timestamp,
        payloadPrefixSize: flags === RETAIL_COMPRESSED ? 4 : 0,
      }),
    )
    cursor = nameStart + nameLength
  }
  return Object.freeze({
    layout: 'retail',
    version: undefined,
    flags: 0,
    embedded: false,
    entries: Object.freeze(entries),
  })
}

function parseArchive(bytes, budget) {
  if (rfdSignature(bytes)) throw new TypeError('RFH companion is required to inspect an RFD source')
  return embeddedSignature(bytes) ? parseEmbedded(bytes, budget) : parseRetail(bytes, budget)
}

function looksRetail(bytes) {
  try {
    parseRetail(bytes, {
      maxNodes: 100_000,
      maxScalarBytes: Number.MAX_SAFE_INTEGER,
    })
    return true
  } catch {
    return false
  }
}

async function inflate(bytes, expectedSize) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('RFH deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  const output = new Uint8Array(await new Response(stream).arrayBuffer())
  if (output.byteLength !== expectedSize) throw new TypeError('RFH deflate output size is invalid')
  return output
}

async function extractEntry(bytes, archive, entry) {
  if (!archive.embedded) {
    throw new TypeError('archive-companion-missing: retail RFH extraction requires sibling RFD')
  }
  checkedRange(bytes.byteLength, entry.offset, entry.compressedSize, `payload ${entry.path}`)
  const payload = bytes.slice(entry.offset, entry.offset + entry.compressedSize)
  if (entry.compressionMethod === METHOD_STORE) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new TypeError('RFH stored entry sizes do not match')
    }
    return payload
  }
  if (entry.compressionMethod === METHOD_DEFLATE) {
    return inflate(payload.subarray(entry.payloadPrefixSize), entry.uncompressedSize)
  }
  throw new TypeError(`unsupported RFH compression method ${entry.compressionMethod}`)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('RFH namespace page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid RFH page cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          storedSize: BigInt(entry.compressedSize),
          size: BigInt(entry.uncompressedSize),
          compression: entry.compressionMethod === METHOD_STORE ? 'stored' : 'deflate',
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
      if (!byId.has(entryId)) throw new TypeError(`unknown RFH entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `emperor-rfh-entry:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'emperor-rfh-rfd', label: 'Emperor RFH/RFD archive pair' }),
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
    if (embeddedSignature(prefix)) return { confidence: 0.99, kind: 'magic', note: 'RFH embedded' }
    if (rfdSignature(prefix)) return { confidence: 0.92, kind: 'magic', note: 'RFD companion' }
    return looksRetail(prefix)
      ? { confidence: 0.86, kind: 'structure', note: 'retail RFH table' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const compressed = archive.entries.filter(
      entry => entry.compressionMethod !== METHOD_STORE,
    ).length
    return {
      summary: {
        format: 'emperor-rfh-rfd',
        layout: archive.layout,
        version: archive.version ?? null,
        flags: archive.flags,
        entries: archive.entries.length,
        compressed,
        payloadSource: archive.embedded ? 'embedded' : 'sibling-rfd-required',
      },
      metadata: [
        {
          id: 'emperor-rfh-rfd',
          label: 'Emperor RFH/RFD archive',
          entries: [
            { key: 'layout', value: archive.layout },
            { key: 'version', value: archive.version ?? 'retail' },
            { key: 'entries', value: archive.entries.length },
            { key: 'compressedEntries', value: compressed },
            {
              key: 'payloadSource',
              value: archive.embedded ? 'embedded' : 'sibling .rfd required',
            },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored', 'deflate'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Emperor RFH/RFD',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.uncompressedSize} bytes, ${
              entry.compressionMethod === METHOD_STORE ? 'stored' : 'deflate'
            }`,
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
          if (entry === undefined) throw new TypeError('RFH entry id was not found')
          return { kind: 'bytes', value: await extractEntry(bytes, archive, entry) }
        },
      },
      maxDecodedBytes: archive.entries.reduce(
        (total, entry) => total + BigInt(entry.uncompressedSize),
        0n,
      ),
      unsupportedFeatures: ['archive-writing', 'archive-mutation', 'retail-rfd-sidecar-resolution'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
