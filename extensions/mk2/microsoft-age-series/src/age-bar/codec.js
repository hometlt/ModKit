import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/age-bar'
const COMPACT_HEADER_BYTES = 16
const COMPACT_RECORD_BYTES = 24
const ESPN_HEADER_BYTES = 292
const ESPN_TIMESTAMP_BYTES = 16
const MAX_NAME_BYTES = 4096
const METHOD_STORE = 'stored'
const METHOD_ZLIB = 'zlib'
const METHOD_ESPN_RAW = 'espn-raw'
const METHOD_L33T = 'l33t'
const METHOD_ALZ4 = 'alz4'

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function u16le(bytes, offset) {
  return viewOf(bytes).getUint16(offset, true)
}

function u32le(bytes, offset) {
  return viewOf(bytes).getUint32(offset, true)
}

function u64le(bytes, offset, label) {
  const value = viewOf(bytes).getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`BAR ${label} is too large`)
  return Number(value)
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
    throw new RangeError(`BAR ${label} is outside the archive`)
  }
  return bytes.slice(offset, offset + length)
}

function safePath(raw, index) {
  if (raw.length > MAX_NAME_BYTES) throw new RangeError(`BAR entry ${index} name is too long`)
  const value = raw.replaceAll('\\', '/')
  const parts = value.split('/')
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || parts.some(part => part === '..')) {
    throw new TypeError(`BAR entry ${index} has an unsafe path`)
  }
  const clean = parts.filter(part => part.length > 0 && part !== '.').join('/')
  if (clean.length === 0) throw new TypeError(`BAR entry ${index} has an empty path`)
  return clean
}

function utf16le(bytes, offset, characters, label) {
  const length = characters * 2
  if (!Number.isSafeInteger(length) || length > MAX_NAME_BYTES * 2) {
    throw new RangeError(`BAR ${label} is too long`)
  }
  return new TextDecoder('utf-16le')
    .decode(checkedSlice(bytes, offset, length, label))
    .replace(/\0+$/gu, '')
}

function compressionOf(payload, compressed) {
  if (!compressed) return METHOD_STORE
  const signature = payload.byteLength >= 4 ? ascii(payload, 0, 4).toLowerCase() : ''
  if (signature === 'l33t' || signature === 'l66t') return METHOD_L33T
  if (signature === 'alz4') return METHOD_ALZ4
  return METHOD_ESPN_RAW
}

function wrappedSize(payload, method) {
  if (method === METHOD_L33T) {
    const signature = ascii(payload, 0, 4).toLowerCase()
    return signature === 'l66t' ? u64le(payload, 4, 'l66t decoded size') : u32le(payload, 4)
  }
  if (method === METHOD_ALZ4) return u32le(payload, 4)
  return payload.byteLength
}

function parseCompact(bytes, maximumNodes) {
  if (bytes.byteLength < COMPACT_HEADER_BYTES)
    throw new TypeError('BAR compact header is truncated')
  const version = u32le(bytes, 4)
  const flags = u32le(bytes, 8)
  const count = u32le(bytes, 12)
  if (version > 2) throw new TypeError(`BAR compact version ${version} is unsupported`)
  if ((flags & 1) !== 0) throw new TypeError('BAR compact archive is encrypted')
  if (count > maximumNodes) throw new RangeError('BAR entry table exceeds maxNodes')
  checkedSlice(bytes, COMPACT_HEADER_BYTES, count * COMPACT_RECORD_BYTES, 'entry table')
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const cursor = COMPACT_HEADER_BYTES + index * COMPACT_RECORD_BYTES
    const nameOffset = u32le(bytes, cursor)
    const nameLength = u16le(bytes, cursor + 4)
    const entryFlags = u16le(bytes, cursor + 6)
    const offset = u32le(bytes, cursor + 8)
    const storedSize = u32le(bytes, cursor + 12)
    const decodedSize = u32le(bytes, cursor + 16)
    const methodCode = u32le(bytes, cursor + 20)
    const rawName = new TextDecoder().decode(
      checkedSlice(bytes, nameOffset, nameLength, `entry ${index} name`),
    )
    const method =
      methodCode === 0 ? METHOD_STORE : methodCode === 1 ? METHOD_ZLIB : `method-${methodCode}`
    checkedSlice(bytes, offset, storedSize, `entry ${index} payload`)
    entries.push(
      Object.freeze({
        id: String(index),
        path: safePath(rawName.replace(/\0+$/gu, ''), index),
        offset,
        storedSize,
        decodedSize,
        method,
        encrypted: (entryFlags & 1) !== 0,
        layout: 'compact',
      }),
    )
  }
  return Object.freeze({
    layout: 'compact',
    version,
    rootPath: '',
    flags,
    entries: Object.freeze(entries),
  })
}

function parseEspn(bytes, maximumNodes) {
  if (bytes.byteLength < ESPN_HEADER_BYTES) throw new TypeError('BAR ESPN header is truncated')
  const version = u32le(bytes, 4)
  if (![2, 4, 5, 6].includes(version))
    throw new TypeError(`BAR ESPN version ${version} is unsupported`)
  const count = u32le(bytes, 280)
  if (count > maximumNodes) throw new RangeError('BAR entry table exceeds maxNodes')
  const tableOffset = version > 3 ? u64le(bytes, 288, 'file table offset') : u32le(bytes, 284)
  checkedSlice(bytes, tableOffset, 8, 'file table')
  const rootCharacters = u32le(bytes, tableOffset)
  const rootPath = utf16le(bytes, tableOffset + 4, rootCharacters, 'root path')
  const rootBytes = rootCharacters * 2
  const rootCount = u32le(bytes, tableOffset + 4 + rootBytes)
  if (rootCount !== count) throw new TypeError('BAR root file count does not match the header')
  const entries = []
  let cursor = tableOffset + 8 + rootBytes
  for (let index = 0; index < rootCount; index += 1) {
    checkedSlice(bytes, cursor, version > 3 ? 16 : 12, `entry ${index} header`)
    const offset =
      version > 3 ? u64le(bytes, cursor, `entry ${index} offset`) : u32le(bytes, cursor)
    cursor += version > 3 ? 8 : 4
    const firstSize = u32le(bytes, cursor)
    const storedSize = u32le(bytes, cursor + 4)
    cursor += 8
    if (version >= 5) {
      checkedSlice(bytes, cursor, 4, `entry ${index} third size`)
      cursor += 4
    }
    if (version < 6) {
      checkedSlice(bytes, cursor, ESPN_TIMESTAMP_BYTES, `entry ${index} timestamp`)
      cursor += ESPN_TIMESTAMP_BYTES
    }
    checkedSlice(bytes, cursor, 4, `entry ${index} name length`)
    const nameCharacters = u32le(bytes, cursor)
    cursor += 4
    const name = utf16le(bytes, cursor, nameCharacters, `entry ${index} name`)
    cursor += nameCharacters * 2
    let compressed = false
    if (version > 3) {
      checkedSlice(bytes, cursor, 4, `entry ${index} compression flag`)
      compressed = u32le(bytes, cursor) !== 0
      cursor += 4
    }
    const stored = checkedSlice(bytes, offset, storedSize, `entry ${index} payload`)
    const method = compressionOf(stored, compressed)
    const decodedSize = wrappedSize(stored, method)
    if (firstSize !== storedSize && firstSize !== decodedSize) {
      throw new TypeError(`BAR entry ${index} size fields disagree`)
    }
    entries.push(
      Object.freeze({
        id: String(index),
        path: safePath(rootPath.length > 0 ? `${rootPath}/${name}` : name, index),
        offset,
        storedSize,
        decodedSize,
        method,
        encrypted: false,
        layout: 'espn',
      }),
    )
  }
  return Object.freeze({
    layout: 'espn',
    version,
    rootPath,
    flags: 0,
    entries: Object.freeze(entries),
  })
}

function parseArchive(bytes, maximumNodes) {
  const signature = bytes.byteLength >= 4 ? ascii(bytes, 0, 4) : ''
  if (signature === 'BAR\0') return parseCompact(bytes, maximumNodes)
  if (signature === 'ESPN') return parseEspn(bytes, maximumNodes)
  throw new TypeError('BAR magic is missing')
}

async function inflateBounded(compressed, expected, format, signal) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError(`BAR ${format} extraction is unavailable in this runtime`)
  }
  const result = new Uint8Array(expected)
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  let offset = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const chunk = await reader.read()
      if (chunk.done) break
      if (offset + chunk.value.byteLength > expected) {
        throw new RangeError('BAR inflated payload exceeds its declared size')
      }
      result.set(chunk.value, offset)
      offset += chunk.value.byteLength
    }
  } catch (error) {
    throw new TypeError(
      `BAR ${format} decompression failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    reader.releaseLock()
  }
  if (offset !== expected) throw new TypeError('BAR inflated payload is truncated')
  return result
}

function decodeLz4(bytes, expected) {
  checkedSlice(bytes, 0, 16, 'alz4 header')
  const compressedSize = u32le(bytes, 8)
  const input = checkedSlice(bytes, 16, compressedSize, 'alz4 block')
  const output = new Uint8Array(expected)
  let source = 0
  let target = 0
  while (source < input.byteLength) {
    const token = input[source]
    if (token === undefined) break
    source += 1
    let literals = token >>> 4
    if (literals === 15) {
      let extra = 255
      while (extra === 255) {
        extra = input[source] ?? 0
        source += 1
        literals += extra
      }
    }
    if (source + literals > input.byteLength || target + literals > output.byteLength) {
      throw new TypeError('BAR alz4 literal run is invalid')
    }
    output.set(input.subarray(source, source + literals), target)
    source += literals
    target += literals
    if (source === input.byteLength) break
    if (source + 2 > input.byteLength) throw new TypeError('BAR alz4 match is truncated')
    const distance = (input[source] ?? 0) | ((input[source + 1] ?? 0) << 8)
    source += 2
    let length = token & 0x0f
    if (length === 15) {
      let extra = 255
      while (extra === 255) {
        extra = input[source] ?? 0
        source += 1
        length += extra
      }
    }
    length += 4
    if (distance === 0 || distance > target || target + length > output.byteLength) {
      throw new TypeError('BAR alz4 match is invalid')
    }
    let read = target - distance
    for (let index = 0; index < length; index += 1) output[target++] = output[read++] ?? 0
  }
  if (target !== expected) throw new TypeError('BAR alz4 payload is truncated')
  return output
}

async function readEntry(bytes, entry, maximum, signal) {
  if (entry.encrypted) throw new TypeError(`BAR entry ${entry.path} is encrypted`)
  if (entry.decodedSize > maximum) throw new RangeError('BAR entry exceeds maxScalarBytes')
  const stored = checkedSlice(bytes, entry.offset, entry.storedSize, entry.path)
  if (entry.method === METHOD_STORE || entry.method === METHOD_ESPN_RAW) return stored
  if (entry.method === METHOD_ZLIB) {
    return inflateBounded(stored, entry.decodedSize, 'deflate', signal)
  }
  if (entry.method === METHOD_L33T) {
    const signature = ascii(stored, 0, 4).toLowerCase()
    const offset = signature === 'l66t' ? 14 : 10
    const compressed = checkedSlice(stored, offset, stored.byteLength - offset, 'l33t stream')
    return inflateBounded(compressed, entry.decodedSize, 'deflate-raw', signal)
  }
  if (entry.method === METHOD_ALZ4) return decodeLz4(stored, entry.decodedSize)
  throw new TypeError(`BAR compression ${entry.method} is unsupported`)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('BAR page limit is invalid')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('BAR page cursor is invalid')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1) ?? entry.path,
          kind: 'file',
          size: BigInt(entry.decodedSize),
          storedSize: BigInt(entry.storedSize),
          compression: entry.method,
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
      if (entry === undefined) throw new TypeError(`unknown BAR entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `age-bar-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({
    id: 'age-bar',
    label: 'BAR (Age of Empires III / Age of Mythology)',
  }),
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
    const signature = prefix.byteLength >= 4 ? ascii(prefix, 0, 4) : ''
    return signature === 'BAR\0' || signature === 'ESPN'
      ? { confidence: 0.99, kind: 'magic', note: `${signature.replace('\0', 'NUL')} header` }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget.maxNodes)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const methods = [...new Set(archive.entries.map(entry => entry.method))].sort()
    return {
      summary: {
        format: 'age-bar',
        layout: archive.layout,
        version: archive.version,
        entries: archive.entries.length,
        rootPath: archive.rootPath,
      },
      metadata: [
        {
          id: 'age-bar-archive',
          label: 'Age BAR archive',
          entries: [
            { key: 'layout', value: archive.layout },
            { key: 'version', value: archive.version },
            { key: 'rootPath', value: archive.rootPath || '(none)' },
            { key: 'entries', value: archive.entries.length },
            { key: 'compression', value: methods.join(', ') || '(none)' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: `BAR ${archive.layout} v${archive.version}`,
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.decodedSize} bytes, ${entry.method}`,
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
          if (entry === undefined) throw new TypeError('BAR entry id was not found')
          return {
            kind: 'bytes',
            value: await readEntry(bytes, entry, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: BigInt(archive.entries.reduce((sum, entry) => sum + entry.decodedSize, 0)),
      unsupportedFeatures: ['bar-writing', 'archive-mutation', 'encrypted-entries'],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
