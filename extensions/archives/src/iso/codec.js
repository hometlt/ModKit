import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/iso'
const DESCRIPTOR_SIZE = 2048
const DESCRIPTOR_START = 16 * DESCRIPTOR_SIZE
const ascii = new TextDecoder('latin1')

function ensureRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new TypeError(`ISO ${label} range is invalid`)
  }
  if (offset + length > bytes.byteLength) throw new TypeError(`ISO ${label} is truncated`)
}

function view(bytes, offset, length, label) {
  ensureRange(bytes, offset, length, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

const u16le = (bytes, offset, label) => view(bytes, offset, 2, label).getUint16(0, true)
const u16be = (bytes, offset, label) => view(bytes, offset, 2, label).getUint16(0, false)
const u32le = (bytes, offset, label) => view(bytes, offset, 4, label).getUint32(0, true)
const u32be = (bytes, offset, label) => view(bytes, offset, 4, label).getUint32(0, false)

function bothEndian16(bytes, offset, label) {
  const little = u16le(bytes, offset, label)
  if (little !== u16be(bytes, offset + 2, label)) {
    throw new TypeError(`ISO ${label} endian copies disagree`)
  }
  return little
}

function bothEndian32(bytes, offset, label) {
  const little = u32le(bytes, offset, label)
  if (little !== u32be(bytes, offset + 4, label)) {
    throw new TypeError(`ISO ${label} endian copies disagree`)
  }
  return little
}

const descriptorSignature = (bytes, offset) =>
  bytes[offset + 1] === 0x43 &&
  bytes[offset + 2] === 0x44 &&
  bytes[offset + 3] === 0x30 &&
  bytes[offset + 4] === 0x30 &&
  bytes[offset + 5] === 0x31 &&
  bytes[offset + 6] === 1

const matches = bytes =>
  bytes.byteLength >= DESCRIPTOR_START + 7 && descriptorSignature(bytes, DESCRIPTOR_START)

function textField(bytes, offset, length) {
  return ascii.decode(bytes.subarray(offset, offset + length)).trim()
}

function parseDirectoryRecord(bytes, offset, available, label) {
  ensureRange(bytes, offset, 1, label)
  const recordLength = bytes[offset] ?? 0
  if (recordLength === 0) return undefined
  if (recordLength < 34 || recordLength > available) {
    throw new TypeError(`ISO ${label} directory record length is invalid`)
  }
  ensureRange(bytes, offset, recordLength, label)
  const identifierLength = bytes[offset + 32] ?? 0
  if (identifierLength === 0 || 33 + identifierLength > recordLength) {
    throw new TypeError(`ISO ${label} identifier is truncated`)
  }
  const extent = bothEndian32(bytes, offset + 2, `${label} extent`)
  const size = bothEndian32(bytes, offset + 10, `${label} size`)
  const flags = bytes[offset + 25] ?? 0
  if ((flags & 0x80) !== 0) throw new TypeError(`ISO ${label} uses unsupported multi-extent data`)
  return Object.freeze({
    recordLength,
    extent,
    size,
    flags,
    identifier: bytes.slice(offset + 33, offset + 33 + identifierLength),
  })
}

function isoName(identifier) {
  if (identifier.byteLength === 1 && (identifier[0] === 0 || identifier[0] === 1)) return undefined
  const raw = ascii.decode(identifier)
  const withoutVersion = raw.replace(/;[0-9]+$/u, '').replace(/\.$/u, '')
  if (
    withoutVersion === '' ||
    withoutVersion === '.' ||
    withoutVersion === '..' ||
    withoutVersion.includes('/') ||
    withoutVersion.includes('\\') ||
    withoutVersion.includes('\0')
  ) {
    throw new TypeError(`unsafe ISO identifier: ${raw}`)
  }
  return withoutVersion
}

function parseIso(bytes, budget) {
  if (!matches(bytes)) throw new TypeError('ISO volume descriptor signature is missing')
  let primary
  let terminated = false
  let descriptorCount = 0
  for (
    let offset = DESCRIPTOR_START;
    offset + DESCRIPTOR_SIZE <= bytes.byteLength;
    offset += DESCRIPTOR_SIZE
  ) {
    if (!descriptorSignature(bytes, offset)) throw new TypeError('ISO volume descriptor is invalid')
    descriptorCount += 1
    const type = bytes[offset] ?? 0
    if (type === 1 && primary === undefined) primary = offset
    if (type === 255) {
      terminated = true
      break
    }
    if (descriptorCount > 128) throw new RangeError('ISO descriptor count exceeds the parser limit')
  }
  if (primary === undefined || !terminated) {
    throw new TypeError('ISO primary descriptor or descriptor terminator is missing')
  }
  const logicalBlockSize = bothEndian16(bytes, primary + 128, 'logical block size')
  if (
    logicalBlockSize < 512 ||
    logicalBlockSize > 32768 ||
    (logicalBlockSize & (logicalBlockSize - 1)) !== 0
  ) {
    throw new TypeError('ISO logical block size is unsupported')
  }
  const volumeBlocks = bothEndian32(bytes, primary + 80, 'volume space size')
  if (volumeBlocks === 0 || volumeBlocks * logicalBlockSize > bytes.byteLength) {
    throw new TypeError('ISO declared volume space exceeds the source')
  }
  const root = parseDirectoryRecord(bytes, primary + 156, DESCRIPTOR_SIZE - 156, 'root')
  if (root === undefined || (root.flags & 0x02) === 0) {
    throw new TypeError('ISO root directory record is missing')
  }
  const entries = []
  const paths = new Set()
  const seenDirectories = new Set([`${root.extent}:${root.size}`])
  const pending = [{ path: '', extent: root.extent, size: root.size, depth: 0 }]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory.depth > budget.maxDepth)
      throw new RangeError('ISO directory depth exceeds maxDepth budget')
    const start = directory.extent * logicalBlockSize
    ensureRange(bytes, start, directory.size, `directory ${directory.path || '/'}`)
    let cursor = 0
    while (cursor < directory.size) {
      const recordLength = bytes[start + cursor] ?? 0
      if (recordLength === 0) {
        cursor = Math.ceil((cursor + 1) / logicalBlockSize) * logicalBlockSize
        continue
      }
      const remainingInBlock = logicalBlockSize - (cursor % logicalBlockSize)
      const record = parseDirectoryRecord(
        bytes,
        start + cursor,
        Math.min(remainingInBlock, directory.size - cursor),
        `entry at ${start + cursor}`,
      )
      cursor += record.recordLength
      const name = isoName(record.identifier)
      if (name === undefined) continue
      if (entries.length >= budget.maxNodes)
        throw new RangeError('ISO entry count exceeds maxNodes budget')
      const kind = (record.flags & 0x02) !== 0 ? 'directory' : 'file'
      const path = `${directory.path}${name}${kind === 'directory' ? '/' : ''}`
      if (paths.has(path)) throw new TypeError(`duplicate ISO entry path: ${path}`)
      paths.add(path)
      const dataOffset = record.extent * logicalBlockSize
      ensureRange(bytes, dataOffset, record.size, `entry ${path}`)
      const entry = Object.freeze({
        id: `entry-${entries.length}`,
        path,
        name,
        kind,
        size: record.size,
        extent: record.extent,
        dataOffset,
      })
      entries.push(entry)
      if (kind === 'directory') {
        const key = `${record.extent}:${record.size}`
        if (seenDirectories.has(key)) throw new TypeError(`ISO directory cycle at ${path}`)
        seenDirectories.add(key)
        pending.push({
          path,
          extent: record.extent,
          size: record.size,
          depth: directory.depth + 1,
        })
      }
    }
  }
  if (entries.length === 0) throw new TypeError('ISO volume exposes no entries')
  return Object.freeze({
    volumeIdentifier: textField(bytes, primary + 40, 32),
    logicalBlockSize,
    volumeBlocks,
    descriptorCount,
    entries: Object.freeze(entries),
  })
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('ISO namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid ISO page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          ...(entry.kind === 'file'
            ? { size: BigInt(entry.size), storedSize: BigInt(entry.size), compression: 'stored' }
            : {}),
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
      if (entry === undefined || entry.kind !== 'file')
        throw new TypeError('ISO entry is not a file')
      const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `iso-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'iso',
    label: 'ISO 9660 disk image',
    mediaType: 'application/x-iso9660-image',
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
    return matches(prefix)
      ? { confidence: 0.99, kind: 'structure', note: 'iso9660-primary-volume-descriptor' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const iso = parseIso(bytes, context.budget)
    const byId = new Map(iso.entries.map(entry => [entry.id, entry]))
    const files = iso.entries.filter(entry => entry.kind === 'file')
    const payloadBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    return {
      summary: {
        format: 'iso9660',
        volumeIdentifier: iso.volumeIdentifier,
        entries: iso.entries.length,
        files: files.length,
        logicalBlockSize: iso.logicalBlockSize,
      },
      metadata: [
        {
          id: 'iso-volume',
          label: 'ISO 9660 volume',
          entries: [
            { key: 'volumeIdentifier', value: iso.volumeIdentifier },
            { key: 'logicalBlockSize', value: iso.logicalBlockSize },
            { key: 'volumeBlocks', value: iso.volumeBlocks },
            { key: 'descriptorCount', value: iso.descriptorCount },
            { key: 'entries', value: iso.entries.length },
            { key: 'payloadBytes', value: payloadBytes.toString(10) },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: iso.entries.length } },
        { id: 'container.directories', parameters: { count: iso.entries.length - files.length } },
        { id: 'container.compression', parameters: { methods: ['stored'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: iso.volumeIdentifier || 'ISO 9660',
          preview: `${files.length} files, ${iso.entries.length - files.length} directories`,
          children: iso.entries.map(entry => ({
            kind: entry.kind,
            label: entry.path,
            preview:
              entry.kind === 'file' ? `${entry.size} bytes at extent ${entry.extent}` : 'directory',
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(iso.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined || entry.kind !== 'file')
            throw new TypeError('ISO file entry was not found')
          if (entry.size > context.budget.maxScalarBytes) {
            throw new RangeError('ISO entry exceeds maxScalarBytes budget')
          }
          return {
            kind: 'bytes',
            value: bytes.slice(entry.dataOffset, entry.dataOffset + entry.size),
          }
        },
      },
      maxDecodedBytes: payloadBytes,
      unsupportedFeatures: [
        'udf-and-high-sierra-filesystems',
        'joliet-and-rock-ridge-names',
        'multi-extent-files',
        'iso-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
