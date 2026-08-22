import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/age-drs'
const AOE_HEADER_BYTES = 64
const SWGB_HEADER_BYTES = 84
const TABLE_BYTES = 12
const RESOURCE_BYTES = 12
const SWGB_COPYRIGHT = 'Copyright (c) 2001 LucasArts Entertainment Company LLC'

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function u32le(bytes, offset) {
  return viewOf(bytes).getUint32(offset, true)
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
    throw new RangeError(`DRS ${label} is outside the archive`)
  }
  return bytes.slice(offset, offset + length)
}

function isSwgb(bytes) {
  return (
    bytes.byteLength >= SWGB_HEADER_BYTES &&
    ascii(bytes, 0, SWGB_COPYRIGHT.length) === SWGB_COPYRIGHT
  )
}

function headerShape(bytes) {
  if (bytes.byteLength < AOE_HEADER_BYTES) return undefined
  const headerBytes = isSwgb(bytes) ? SWGB_HEADER_BYTES : AOE_HEADER_BYTES
  if (bytes.byteLength < headerBytes) return undefined
  const copyrightBytes = headerBytes - 24
  const fileType = ascii(bytes, copyrightBytes + 4, 12)
    .replace(/\0+$/gu, '')
    .trim()
  if (fileType.toLowerCase() !== 'tribe') return undefined
  const tableCount = u32le(bytes, copyrightBytes + 16)
  return tableCount > 0 && tableCount <= 0x10000
    ? Object.freeze({ headerBytes, copyrightBytes })
    : undefined
}

function decodedTypeTag(bytes, offset, tableIndex) {
  const raw = ascii(bytes, offset, 4)
  const value = [...raw].reverse().join('').replaceAll('\0', '').trim().toLowerCase()
  const clean = value.replace(/[^a-z0-9]/gu, '')
  return clean.length > 0 ? clean : `type${tableIndex}`
}

function parseArchive(bytes, maximumNodes) {
  const shape = headerShape(bytes)
  if (shape === undefined) throw new TypeError('DRS tribe header is missing or invalid')
  const version = ascii(bytes, shape.copyrightBytes, 4).replace(/\0+$/gu, '').trim()
  const fileType = ascii(bytes, shape.copyrightBytes + 4, 12)
    .replace(/\0+$/gu, '')
    .trim()
  const tableCount = u32le(bytes, shape.copyrightBytes + 16)
  const firstFileOffset = u32le(bytes, shape.copyrightBytes + 20)
  if (tableCount > maximumNodes) throw new RangeError('DRS table directory exceeds maxNodes')
  checkedSlice(bytes, shape.headerBytes, tableCount * TABLE_BYTES, 'table directory')
  if (firstFileOffset !== 0) checkedSlice(bytes, firstFileOffset, 0, 'first file offset')

  const entries = []
  const paths = new Map()
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const tableOffset = shape.headerBytes + tableIndex * TABLE_BYTES
    const tableType = decodedTypeTag(bytes, tableOffset, tableIndex)
    const resourceTableOffset = u32le(bytes, tableOffset + 4)
    const resourceCount = u32le(bytes, tableOffset + 8)
    if (entries.length + resourceCount > maximumNodes) {
      throw new RangeError('DRS resource tables exceed maxNodes')
    }
    checkedSlice(
      bytes,
      resourceTableOffset,
      resourceCount * RESOURCE_BYTES,
      `${tableType} resource table`,
    )
    for (let index = 0; index < resourceCount; index += 1) {
      const cursor = resourceTableOffset + index * RESOURCE_BYTES
      const resourceId = u32le(bytes, cursor)
      const offset = u32le(bytes, cursor + 4)
      const size = u32le(bytes, cursor + 8)
      checkedSlice(bytes, offset, size, `resource ${resourceId}`)
      const basePath = `${tableType}/${resourceId}.${tableType}`
      const seen = paths.get(basePath) ?? 0
      paths.set(basePath, seen + 1)
      const path = seen === 0 ? basePath : `${tableType}/${resourceId}.${seen + 1}.${tableType}`
      entries.push(
        Object.freeze({
          id: String(entries.length),
          path,
          name: path.split('/').at(-1) ?? path,
          tableType,
          resourceId,
          offset,
          size,
        }),
      )
    }
  }
  return Object.freeze({
    version,
    fileType,
    headerVariant: shape.headerBytes === SWGB_HEADER_BYTES ? 'swgb' : 'aoe',
    tableCount,
    firstFileOffset,
    entries: Object.freeze(entries),
  })
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('DRS page limit is invalid')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('DRS page cursor is invalid')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          size: BigInt(entry.size),
          storedSize: BigInt(entry.size),
          compression: 'stored',
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
      if (entry === undefined) throw new TypeError(`unknown DRS entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `age-drs-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'age-drs', label: 'DRS (Age of Empires)' }),
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
    return headerShape(prefix) === undefined
      ? { confidence: 0, kind: 'magic', note: 'tribe-header-mismatch' }
      : { confidence: 0.99, kind: 'magic', note: 'Genie DRS tribe header' }
  },
  async inspect(bytes, context) {
    const archive = parseArchive(bytes, context.budget.maxNodes)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const tableTypes = [...new Set(archive.entries.map(entry => entry.tableType))].sort()
    return {
      summary: {
        format: 'age-drs',
        version: archive.version,
        headerVariant: archive.headerVariant,
        tables: archive.tableCount,
        resources: archive.entries.length,
      },
      metadata: [
        {
          id: 'age-drs-archive',
          label: 'Age DRS archive',
          entries: [
            { key: 'version', value: archive.version || '(blank)' },
            { key: 'fileType', value: archive.fileType },
            { key: 'headerVariant', value: archive.headerVariant },
            { key: 'tables', value: archive.tableCount },
            { key: 'resources', value: archive.entries.length },
            { key: 'tableTypes', value: tableTypes.join(', ') },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: `DRS ${archive.version || '(blank)'}`,
          preview: `${archive.entries.length} resources`,
          children: tableTypes.map(tableType => ({
            kind: 'directory',
            label: tableType,
            preview: `${archive.entries.filter(entry => entry.tableType === tableType).length} resources`,
            children: archive.entries
              .filter(entry => entry.tableType === tableType)
              .map(entry => ({
                kind: 'file',
                label: entry.name,
                preview: `resource ${entry.resourceId}, ${entry.size} bytes`,
              })),
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
          if (entry === undefined) throw new TypeError('DRS entry id was not found')
          if (entry.size > context.budget.maxScalarBytes) {
            throw new RangeError('DRS entry exceeds maxScalarBytes')
          }
          return { kind: 'bytes', value: checkedSlice(bytes, entry.offset, entry.size, entry.path) }
        },
      },
      maxDecodedBytes: archive.entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n),
      unsupportedFeatures: ['drs-writing', 'archive-mutation'],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
