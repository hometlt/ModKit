import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/big'
const HEADER_BYTES = 16
const MAX_NAME_BYTES = 4096

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u32be(bytes, offset) {
  return viewOf(bytes).getUint32(offset, false)
}

function u32le(bytes, offset) {
  return viewOf(bytes).getUint32(offset, true)
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function magic(bytes) {
  return bytes.byteLength < 4 ? '' : ascii(bytes, 0, 4)
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
    throw new RangeError(`BIG ${label} is outside the archive`)
  }
  return bytes.slice(offset, offset + length)
}

function normalizedPath(raw, index) {
  const value = raw.replaceAll('\\', '/')
  const parts = value.split('/')
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || parts.some(part => part === '..')) {
    throw new TypeError(`BIG entry ${index} has an unsafe path`)
  }
  const clean = parts.filter(part => part.length > 0 && part !== '.').join('/')
  if (clean.length === 0) throw new TypeError(`BIG entry ${index} has an empty path`)
  return clean
}

function findZero(bytes, start, end) {
  for (let offset = start; offset < end; offset += 1) {
    if (bytes[offset] === 0) return offset
  }
  return -1
}

function isRefPack(bytes) {
  return bytes.byteLength >= 2 && ((bytes[0] ?? 0) & 0x3e) === 0x10 && bytes[1] === 0xfb
}

function readUnsignedBe(bytes, offset, length) {
  let value = 0
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + (bytes[offset + index] ?? 0)
  }
  return value
}

function refPackHeader(bytes) {
  if (!isRefPack(bytes)) throw new TypeError('BIG RefPack header is invalid')
  const flags = bytes[0] ?? 0
  const large = (flags & 0x80) !== 0
  const carriesCompressedSize = (flags & 0x01) !== 0
  const sizeBytes = large ? 4 : 3
  const required = 2 + sizeBytes * (carriesCompressedSize ? 2 : 1)
  if (bytes.byteLength < required) throw new TypeError('BIG RefPack header is truncated')
  let cursor = 2
  if (carriesCompressedSize) cursor += sizeBytes
  const size = readUnsignedBe(bytes, cursor, sizeBytes)
  return Object.freeze({ headerBytes: cursor + sizeBytes, size })
}

function decodeRefPack(bytes, maximum) {
  const header = refPackHeader(bytes)
  if (header.size > maximum) throw new RangeError('BIG RefPack entry exceeds the scalar budget')
  const output = new Uint8Array(header.size)
  let source = header.headerBytes
  let target = 0
  let stopped = false

  const literals = length => {
    if (source + length > bytes.byteLength) throw new TypeError('BIG RefPack literal is truncated')
    if (target + length > output.byteLength) throw new TypeError('BIG RefPack output overflows')
    output.set(bytes.subarray(source, source + length), target)
    source += length
    target += length
  }
  const match = (distance, length) => {
    if (distance <= 0 || distance > target || target + length > output.byteLength) {
      throw new TypeError('BIG RefPack match is invalid')
    }
    let read = target - distance
    for (let index = 0; index < length; index += 1) {
      const value = output[read]
      if (value === undefined) throw new TypeError('BIG RefPack match is outside the output')
      output[target] = value
      target += 1
      read += 1
    }
  }

  while (source < bytes.byteLength) {
    const control = bytes[source]
    if (control === undefined) break
    source += 1
    let literalBytes = 0
    let matchBytes = 0
    let distance = 0
    if (control >= 0xfc) {
      literals(control & 0x03)
      stopped = true
      break
    }
    if (control < 0x80) {
      const second = bytes[source]
      if (second === undefined) throw new TypeError('BIG RefPack command is truncated')
      source += 1
      literalBytes = control & 0x03
      matchBytes = ((control & 0x1c) >>> 2) + 3
      distance = ((control & 0x60) << 3) + second + 1
    } else if (control < 0xc0) {
      const second = bytes[source]
      const third = bytes[source + 1]
      if (second === undefined || third === undefined) {
        throw new TypeError('BIG RefPack command is truncated')
      }
      source += 2
      literalBytes = second >>> 6
      matchBytes = (control & 0x3f) + 4
      distance = ((second & 0x3f) << 8) + third + 1
    } else if (control < 0xe0) {
      const second = bytes[source]
      const third = bytes[source + 1]
      const fourth = bytes[source + 2]
      if (second === undefined || third === undefined || fourth === undefined) {
        throw new TypeError('BIG RefPack command is truncated')
      }
      source += 3
      literalBytes = control & 0x03
      matchBytes = ((control & 0x0c) << 6) + fourth + 5
      distance = ((control & 0x10) << 12) + (second << 8) + third + 1
    } else {
      literalBytes = ((control & 0x1f) + 1) << 2
    }
    literals(literalBytes)
    if (matchBytes > 0) match(distance, matchBytes)
  }
  if (!stopped || target !== output.byteLength)
    throw new TypeError('BIG RefPack stream is incomplete')
  return output
}

function parseArchive(bytes, maximumNodes) {
  const version = magic(bytes)
  if (version !== 'BIG4' && version !== 'BIGF') throw new TypeError('BIG magic is missing')
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('BIG header is truncated')
  const archivedSize = u32le(bytes, 4)
  const entryCount = u32be(bytes, 8)
  const dataOffset = u32be(bytes, 12)
  if (archivedSize !== bytes.byteLength) throw new TypeError('BIG archive size does not match')
  if (entryCount > maximumNodes) throw new RangeError('BIG entry table exceeds the node budget')
  if (dataOffset < HEADER_BYTES || dataOffset > bytes.byteLength) {
    throw new RangeError('BIG data offset is outside the archive')
  }
  const entries = []
  let cursor = HEADER_BYTES
  for (let index = 0; index < entryCount; index += 1) {
    checkedSlice(bytes, cursor, 8, `entry ${index} header`)
    const offset = u32be(bytes, cursor)
    const storedSize = u32be(bytes, cursor + 4)
    cursor += 8
    const end = findZero(bytes, cursor, Math.min(dataOffset, cursor + MAX_NAME_BYTES + 1))
    if (end < 0) throw new TypeError(`BIG entry ${index} name is not terminated`)
    const path = normalizedPath(ascii(bytes, cursor, end - cursor), index)
    cursor = end + 1
    checkedSlice(bytes, offset, storedSize, `entry ${index} payload`)
    if (offset < dataOffset) throw new RangeError(`BIG entry ${index} overlaps the index`)
    const compressed = isRefPack(bytes.subarray(offset, Math.min(offset + storedSize, offset + 16)))
    entries.push(
      Object.freeze({
        id: String(index),
        path,
        name: path.split('/').at(-1) ?? path,
        offset,
        storedSize,
        compressed,
      }),
    )
  }
  if (cursor > dataOffset) throw new RangeError('BIG index overlaps the payload area')
  return Object.freeze({ version, archivedSize, dataOffset, entries: Object.freeze(entries) })
}

function readEntry(bytes, entry, maximum) {
  const stored = checkedSlice(bytes, entry.offset, entry.storedSize, entry.path)
  return entry.compressed ? decodeRefPack(stored, maximum) : stored
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('BIG namespace page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid BIG page cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          storedSize: BigInt(entry.storedSize),
          compression: entry.compressed ? 'refpack' : 'stored',
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
      if (entry === undefined) throw new TypeError(`unknown BIG entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `big-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'big', label: 'EA SAGE BIG archive' }),
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
    const matches = magic(prefix) === 'BIG4' || magic(prefix) === 'BIGF'
    return matches
      ? { confidence: 0.99, kind: 'magic', note: 'BIG4/BIGF header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget.maxNodes)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const compressed = archive.entries.filter(entry => entry.compressed).length
    return {
      summary: {
        format: 'big',
        version: archive.version,
        entries: archive.entries.length,
        compressed,
      },
      metadata: [
        {
          id: 'big-archive',
          label: 'BIG archive',
          entries: [
            { key: 'version', value: archive.version },
            { key: 'archiveBytes', value: archive.archivedSize },
            { key: 'dataOffset', value: archive.dataOffset },
            { key: 'entries', value: archive.entries.length },
            { key: 'refPackEntries', value: compressed },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored', 'refpack'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: archive.version,
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.storedSize} stored bytes${entry.compressed ? ', RefPack' : ''}`,
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
          if (entry === undefined) throw new TypeError('BIG entry id was not found')
          return {
            kind: 'bytes',
            value: readEntry(bytes, entry, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: BigInt(bytes.byteLength),
      unsupportedFeatures: ['big-writing', 'archive-mutation'],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
