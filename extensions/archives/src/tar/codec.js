import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/tar'
const BLOCK = 512
const latin1 = new TextDecoder('latin1')

const matches = bytes =>
  bytes.byteLength >= 262 &&
  bytes[257] === 0x75 &&
  bytes[258] === 0x73 &&
  bytes[259] === 0x74 &&
  bytes[260] === 0x61 &&
  bytes[261] === 0x72

function field(bytes, offset, length) {
  const slice = bytes.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return latin1.decode(end < 0 ? slice : slice.subarray(0, end)).trimEnd()
}

function octal(bytes, offset, length, label) {
  const value = field(bytes, offset, length).trim()
  if (value === '') return 0
  if (!/^[0-7]+$/u.test(value)) throw new TypeError(`TAR ${label} is not an octal field`)
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`TAR ${label} exceeds safe integers`)
  return parsed
}

function isZeroBlock(bytes, offset) {
  if (offset + BLOCK > bytes.byteLength) return false
  for (let index = offset; index < offset + BLOCK; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

function safePath(name, prefix) {
  const combined = `${prefix === '' ? '' : `${prefix}/`}${name}`.replaceAll('\\', '/')
  const directory = combined.endsWith('/')
  const parts = combined.split('/').filter(Boolean)
  if (
    combined.includes('\0') ||
    combined.startsWith('/') ||
    /^[a-z]:/iu.test(combined) ||
    parts.length === 0 ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe TAR entry path: ${combined}`)
  }
  return `${parts.join('/')}${directory ? '/' : ''}`
}

function headerChecksum(bytes, offset) {
  let checksum = 0
  for (let index = 0; index < BLOCK; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : (bytes[offset + index] ?? 0)
  }
  return checksum
}

function parseTar(bytes, maxNodes) {
  if (bytes.byteLength < BLOCK * 3 || bytes.byteLength % BLOCK !== 0) {
    throw new TypeError('TAR source must contain aligned headers and two end blocks')
  }
  const entries = []
  let cursor = 0
  let ended = false
  while (cursor < bytes.byteLength) {
    if (isZeroBlock(bytes, cursor)) {
      if (!isZeroBlock(bytes, cursor + BLOCK)) {
        throw new TypeError('TAR end marker must contain two consecutive zero blocks')
      }
      for (let index = cursor + BLOCK * 2; index < bytes.byteLength; index += 1) {
        if (bytes[index] !== 0) throw new TypeError('TAR contains data after its end marker')
      }
      ended = true
      break
    }
    if (entries.length >= maxNodes) throw new RangeError('TAR entry count exceeds maxNodes budget')
    if (cursor + BLOCK > bytes.byteLength) throw new TypeError('TAR header is truncated')
    const expectedChecksum = octal(bytes, cursor + 148, 8, 'checksum')
    if (expectedChecksum !== headerChecksum(bytes, cursor)) {
      throw new TypeError(`TAR entry ${entries.length} checksum is invalid`)
    }
    if (!matches(bytes.subarray(cursor, cursor + BLOCK))) {
      throw new TypeError(`TAR entry ${entries.length} is not a POSIX ustar header`)
    }
    const typeByte = bytes[cursor + 156] ?? 0
    const kind =
      typeByte === 0 || typeByte === 0x30 ? 'file' : typeByte === 0x35 ? 'directory' : undefined
    if (kind === undefined) {
      throw new TypeError(
        `TAR entry ${entries.length} type ${typeByte} is outside the ustar subset`,
      )
    }
    const size = octal(bytes, cursor + 124, 12, 'size')
    if (kind === 'directory' && size !== 0)
      throw new TypeError('TAR directory entry has payload bytes')
    const path = safePath(field(bytes, cursor, 100), field(bytes, cursor + 345, 155))
    const dataOffset = cursor + BLOCK
    const dataEnd = dataOffset + size
    const next = dataOffset + Math.ceil(size / BLOCK) * BLOCK
    if (dataEnd > bytes.byteLength || next > bytes.byteLength) {
      throw new TypeError(`TAR entry ${path} payload is truncated`)
    }
    entries.push(
      Object.freeze({
        id: String(entries.length),
        path: kind === 'directory' && !path.endsWith('/') ? `${path}/` : path,
        kind,
        size,
        modifiedAt: octal(bytes, cursor + 136, 12, 'modification time') * 1000,
        mode: octal(bytes, cursor + 100, 8, 'mode'),
        dataOffset,
      }),
    )
    cursor = next
  }
  if (!ended) throw new TypeError('TAR two-block end marker is missing')
  if (entries.length === 0) throw new TypeError('TAR archive exposes no entries')
  return Object.freeze(entries)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('TAR namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid TAR page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.replace(/\/$/u, '').split('/').at(-1),
          kind: entry.kind,
          ...(entry.kind === 'file'
            ? { size: BigInt(entry.size), storedSize: BigInt(entry.size), compression: 'stored' }
            : {}),
          ...(entry.modifiedAt === 0 ? {} : { modifiedAt: entry.modifiedAt }),
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
        throw new TypeError('TAR entry is not a file')
      const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `tar-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'tar',
    label: 'POSIX ustar archive',
    mediaType: 'application/x-tar',
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
      ? { confidence: 0.99, kind: 'magic', note: 'ustar-header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const entries = parseTar(bytes, context.budget.maxNodes)
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const files = entries.filter(entry => entry.kind === 'file')
    const totalBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    return {
      summary: {
        format: 'tar',
        entries: entries.length,
        files: files.length,
        directories: entries.length - files.length,
        payloadBytes: totalBytes.toString(10),
      },
      metadata: [
        {
          id: 'tar-archive',
          label: 'POSIX ustar archive',
          entries: [
            { key: 'entries', value: entries.length },
            { key: 'files', value: files.length },
            { key: 'directories', value: entries.length - files.length },
            { key: 'payloadBytes', value: totalBytes.toString(10) },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: entries.length - files.length } },
        { id: 'container.compression', parameters: { methods: ['stored'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'TAR',
          preview: `${files.length} files, ${entries.length - files.length} directories`,
          children: entries.map(entry => ({
            kind: entry.kind,
            label: entry.path,
            preview: entry.kind === 'file' ? `${entry.size} bytes` : 'directory',
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined || entry.kind !== 'file')
            throw new TypeError('TAR file entry was not found')
          if (entry.size > context.budget.maxScalarBytes) {
            throw new RangeError('TAR entry exceeds maxScalarBytes budget')
          }
          return {
            kind: 'bytes',
            value: bytes.slice(entry.dataOffset, entry.dataOffset + entry.size),
          }
        },
      },
      maxDecodedBytes: totalBytes,
      unsupportedFeatures: [
        'pax-and-gnu-extensions',
        'links-devices-and-special-entries',
        'tar-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
