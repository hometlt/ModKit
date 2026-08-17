import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const utf8 = new TextDecoder('utf-8', { fatal: true })
const legacy = new TextDecoder('latin1')

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('truncated ZIP u16')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('truncated ZIP u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function findEocd(bytes) {
  const first = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (u32(bytes, offset) === ZIP_EOCD) return offset
  }
  return -1
}

function safePath(value) {
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (
    value.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe ZIP entry path: ${value}`)
  }
  return `${parts.join('/')}${normalized.endsWith('/') && parts.length > 0 ? '/' : ''}`
}

function parseZip(bytes, maxEntries) {
  const eocd = findEocd(bytes)
  if (eocd < 0) throw new TypeError('ZIP end-of-central-directory record is missing')
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new TypeError('multi-disk ZIP archives are unsupported')
  }
  const count = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new TypeError('ZIP64 requires a dedicated codec profile')
  }
  if (count > maxEntries) throw new RangeError('ZIP entry count exceeds maxNodes budget')
  if (centralOffset + centralSize > eocd) throw new TypeError('ZIP central directory is truncated')
  const entries = []
  let offset = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || u32(bytes, offset) !== ZIP_CENTRAL) {
      throw new TypeError(`invalid ZIP central-directory entry ${index}`)
    }
    const flags = u16(bytes, offset + 8)
    const method = u16(bytes, offset + 10)
    const compressedSize = u32(bytes, offset + 20)
    const size = u32(bytes, offset + 24)
    const nameLength = u16(bytes, offset + 28)
    const extraLength = u16(bytes, offset + 30)
    const commentLength = u16(bytes, offset + 32)
    const localOffset = u32(bytes, offset + 42)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > bytes.byteLength) throw new TypeError('ZIP central-directory name is truncated')
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const name = safePath(
      (flags & 0x0800) !== 0 ? utf8.decode(nameBytes) : legacy.decode(nameBytes),
    )
    if (name === '') throw new TypeError('ZIP entries must have non-empty paths')
    entries.push(
      Object.freeze({
        id: `entry-${index}`,
        name,
        kind: name.endsWith('/') ? 'directory' : 'file',
        flags,
        method,
        compressedSize,
        size,
        localOffset,
      }),
    )
    offset = next
  }
  if (offset !== centralOffset + centralSize) {
    throw new TypeError('ZIP central-directory size does not match its entries')
  }
  return Object.freeze(entries)
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function extract(bytes, entry) {
  if (entry.kind !== 'file') throw new TypeError('directories have no byte payload')
  if ((entry.flags & 1) !== 0) throw new TypeError('encrypted ZIP entries are unsupported')
  const offset = entry.localOffset
  if (offset + 30 > bytes.byteLength || u32(bytes, offset) !== ZIP_LOCAL) {
    throw new TypeError('ZIP local entry header is invalid')
  }
  const dataOffset = offset + 30 + u16(bytes, offset + 26) + u16(bytes, offset + 28)
  const end = dataOffset + entry.compressedSize
  if (end > bytes.byteLength) throw new TypeError('ZIP entry data is truncated')
  const compressed = bytes.slice(dataOffset, end)
  const result =
    entry.method === 0
      ? compressed
      : entry.method === 8
        ? await inflateRaw(compressed)
        : (() => {
            throw new TypeError(`unsupported ZIP compression method ${entry.method}`)
          })()
  if (result.byteLength !== entry.size)
    throw new TypeError('ZIP entry size does not match metadata')
  return result
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const matching = entries.filter(entry => entry.name.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(page.limit) ||
        page.limit <= 0
      ) {
        throw new TypeError('invalid ZIP namespace page')
      }
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.name,
          name: entry.name.replace(/\/$/u, '').split('/').at(-1),
          kind: entry.kind,
          ...(entry.kind === 'file' ? { size: BigInt(entry.size) } : {}),
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
        throw new TypeError('ZIP entry is not a file')
      const encoded = entry.name.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.name}`,
          uri: `zip-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: 'org.modkitx/archive-zip',
  format: Object.freeze({ id: 'zip', label: 'ZIP archive', mediaType: 'application/zip' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'org.modkitx/archive-zip.extract-entry',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async detect(bytes) {
    const signature = bytes.byteLength >= 4 ? u32(bytes, 0) : 0
    const match = signature === ZIP_LOCAL || signature === ZIP_EOCD
    return { confidence: match ? 0.99 : 0.01, note: match ? 'zip-signature' : 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const entries = parseZip(bytes, context.budget.maxNodes)
    const files = entries.filter(entry => entry.kind === 'file')
    const directories = entries.length - files.length
    const uncompressedBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    const tree = createTreeDataSource({
      kind: 'archive',
      label: 'ZIP',
      preview: `${files.length} files`,
      children: entries.map(entry => ({
        kind: entry.kind,
        label: entry.name,
        preview:
          entry.kind === 'file' ? `${entry.size} bytes, method ${entry.method}` : 'directory',
      })),
    })
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    return {
      summary: {
        format: 'zip',
        entries: entries.length,
        files: files.length,
        directories,
        uncompressedBytes: uncompressedBytes.toString(10),
      },
      metadata: [
        {
          id: 'zip-directory',
          label: 'ZIP directory',
          entries: [
            { key: 'entries', value: entries.length },
            { key: 'files', value: files.length },
            { key: 'directories', value: directories },
            { key: 'uncompressedBytes', value: uncompressedBytes.toString(10) },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: directories } },
        {
          id: 'container.compression',
          parameters: { methods: [...new Set(files.map(item => item.method))] },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('extract-entry requires {path}')
          }
          const entry = byName.get(String(input.path ?? ''))
          if (entry === undefined) throw new TypeError('ZIP entry path was not found')
          return { kind: 'bytes', value: await extract(bytes, entry) }
        },
      },
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
