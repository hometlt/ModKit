// UE4 Pak v8 legacy indexes. FPakInfo/FPakEntry ordering is cross-checked against the primary
// open UE Viewer implementation of Epic's serialized structures:
// https://github.com/gildor2/UEViewer/blob/master/Unreal/FileSystem/UnArchivePak.cpp

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unreal-pak'
const PAK_MAGIC = 0x5a6f12e1
const MAX_ENTRIES = 1_000_000
const MAX_STRING_BYTES = 1_048_576

function range(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError(`Unreal Pak ${label} is outside the file`)
}

function u32(bytes, offset) {
  range(bytes, offset, 4, 'u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function i32(bytes, offset) {
  range(bytes, offset, 4, 'i32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true)
}

function i64(bytes, offset, label) {
  range(bytes, offset, 8, label)
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  const value = view.getBigInt64(0, true)
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError(`Unreal Pak ${label} is not a safe non-negative offset`)
  return Number(value)
}

function ascii(bytes, offset, length, label) {
  range(bytes, offset, length, label)
  const raw = bytes.subarray(offset, offset + length)
  const zero = raw.indexOf(0)
  const value = String.fromCharCode(...raw.subarray(0, zero < 0 ? raw.length : zero)).trim()
  if (!/^[\x20-\x7e]*$/u.test(value)) throw new TypeError(`Unreal Pak ${label} is not ASCII`)
  return value
}

class Cursor {
  constructor(bytes) {
    this.bytes = bytes
    this.offset = 0
  }

  readI32(label) {
    void label
    const value = i32(this.bytes, this.offset)
    this.offset += 4
    return value
  }

  fString(label) {
    const length = this.readI32(`${label} length`)
    if (length === 0) return ''
    if (Math.abs(length) > MAX_STRING_BYTES)
      throw new RangeError(`Unreal Pak ${label} exceeds the string budget`)
    if (length > 0) {
      range(this.bytes, this.offset, length, label)
      const raw = this.bytes.subarray(this.offset, this.offset + length)
      this.offset += length
      if (raw.at(-1) !== 0) throw new TypeError(`Unreal Pak ${label} is not NUL terminated`)
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(0, -1))
      } catch (error) {
        throw new TypeError(`Unreal Pak ${label} is not UTF-8: ${String(error)}`)
      }
    }
    const units = -length
    const byteLength = units * 2
    range(this.bytes, this.offset, byteLength, label)
    const raw = this.bytes.subarray(this.offset, this.offset + byteLength)
    this.offset += byteLength
    if (raw.at(-1) !== 0 || raw.at(-2) !== 0)
      throw new TypeError(`Unreal Pak ${label} is not UTF-16LE NUL terminated`)
    return new TextDecoder('utf-16le', { fatal: true }).decode(raw.subarray(0, -2))
  }
}

function footerOf(bytes) {
  const start = Math.max(0, bytes.byteLength - 260)
  for (let magicOffset = bytes.byteLength - 4; magicOffset >= start; magicOffset -= 1) {
    if (u32(bytes, magicOffset) !== PAK_MAGIC) continue
    if (magicOffset + 44 > bytes.byteLength) continue
    const version = i32(bytes, magicOffset + 4)
    if (version < 1 || version > 11) continue
    const indexOffset = i64(bytes, magicOffset + 8, 'index offset')
    const indexSize = i64(bytes, magicOffset + 16, 'index size')
    if (indexOffset + indexSize > magicOffset) continue
    const methodsOffset = magicOffset + 44 + (version >= 9 ? 1 : 0)
    const expectedEnd = methodsOffset + (version >= 8 ? 160 : 0)
    if (expectedEnd !== bytes.byteLength) continue
    const encryptedIndex = version >= 4 ? bytes[magicOffset - 1] !== 0 : false
    const footerStart = magicOffset - (version >= 7 ? 17 : version >= 4 ? 1 : 0)
    if (footerStart < 0) continue
    const compressionMethods = []
    if (version >= 8)
      for (let index = 0; index < 5; index += 1) {
        const method = ascii(bytes, methodsOffset + index * 32, 32, `compression method ${index}`)
        if (method) compressionMethods.push(method)
      }
    return Object.freeze({
      version,
      indexOffset,
      indexSize,
      encryptedIndex,
      footerStart,
      magicOffset,
      indexHash: bytes.slice(magicOffset + 24, magicOffset + 44),
      compressionMethods: Object.freeze(compressionMethods),
    })
  }
  return undefined
}

function entryRecord(bytes, offset, version, methods) {
  const start = offset
  const storedOffset = i64(bytes, offset, 'entry offset')
  offset += 8
  const storedSize = i64(bytes, offset, 'entry stored size')
  offset += 8
  const size = i64(bytes, offset, 'entry size')
  offset += 8
  const methodIndex = u32(bytes, offset)
  offset += 4
  if (methodIndex > methods.length)
    throw new TypeError(`Unreal Pak entry uses missing compression method ${methodIndex}`)
  range(bytes, offset, 20, 'entry hash')
  const hash = bytes.slice(offset, offset + 20)
  offset += 20
  const blocks = []
  if (version >= 3) {
    if (methodIndex !== 0) {
      const blockCount = u32(bytes, offset)
      offset += 4
      if (blockCount > MAX_ENTRIES)
        throw new RangeError('Unreal Pak compression block count is invalid')
      for (let index = 0; index < blockCount; index += 1) {
        const startOffset = i64(bytes, offset, 'compression block start')
        const endOffset = i64(bytes, offset + 8, 'compression block end')
        offset += 16
        if (endOffset < startOffset) throw new TypeError('Unreal Pak compression block is reversed')
        blocks.push(Object.freeze({ start: startOffset, end: endOffset }))
      }
    }
    range(bytes, offset, 5, 'entry flags')
    const encrypted = bytes[offset] !== 0
    const compressionBlockSize = u32(bytes, offset + 1)
    offset += 5
    return Object.freeze({
      offset: storedOffset,
      storedSize,
      size,
      methodIndex,
      method: methodIndex === 0 ? 'None' : methods[methodIndex - 1],
      hash,
      blocks: Object.freeze(blocks),
      encrypted,
      compressionBlockSize,
      recordBytes: offset - start,
    })
  }
  return Object.freeze({
    offset: storedOffset,
    storedSize,
    size,
    methodIndex,
    method: methodIndex === 0 ? 'None' : methods[methodIndex - 1],
    hash,
    blocks: Object.freeze(blocks),
    encrypted: false,
    compressionBlockSize: 0,
    recordBytes: offset - start,
  })
}

function cleanMountPoint(value) {
  const mount = value
    .replaceAll('\\', '/')
    .replace(/^(?:\.\.\/)+/u, '')
    .replace(/^\/+|\/+$/gu, '')
  if (
    mount === '..' ||
    mount.startsWith('../') ||
    mount.includes('/../') ||
    mount.endsWith('/..') ||
    mount.includes('\0')
  )
    throw new TypeError(`Unreal Pak mount point is unsafe: ${value}`)
  return mount
}

function cleanPath(mountPoint, name) {
  const mount = cleanMountPoint(mountPoint)
  const relative = name.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
  const path = [mount, relative]
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/gu, '/')
  if (
    !path ||
    path === '..' ||
    path.startsWith('../') ||
    path.includes('/../') ||
    path.endsWith('/..') ||
    path.includes('\0')
  )
    throw new TypeError(`Unreal Pak entry path is unsafe: ${name}`)
  return path
}

function sameRecord(left, right) {
  return (
    left.offset === right.offset &&
    left.storedSize === right.storedSize &&
    left.size === right.size &&
    left.methodIndex === right.methodIndex &&
    left.encrypted === right.encrypted
  )
}

function parsePak(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('Unreal Pak structure exceeds maxDepth budget')
  const footer = footerOf(bytes)
  if (footer === undefined) throw new TypeError('Unreal Pak footer is missing or invalid')
  if (footer.version !== 8)
    throw new TypeError(
      `Unreal Pak version ${footer.version} is not supported by this portable reader`,
    )
  if (footer.encryptedIndex) throw new TypeError('Unreal Pak encrypted index is not supported')
  range(bytes, footer.indexOffset, footer.indexSize, 'index')
  const indexBytes = bytes.subarray(footer.indexOffset, footer.indexOffset + footer.indexSize)
  const cursor = new Cursor(indexBytes)
  const rawMountPoint = cursor.fString('mount point')
  const count = cursor.readI32('entry count')
  if (count < 0 || count > MAX_ENTRIES || count > budget.maxNodes)
    throw new RangeError('Unreal Pak entries exceed maxNodes budget')
  const entries = []
  const paths = new Set()
  for (let index = 0; index < count; index += 1) {
    const name = cursor.fString(`entry ${index} name`)
    const record = entryRecord(indexBytes, cursor.offset, footer.version, footer.compressionMethods)
    cursor.offset += record.recordBytes
    if (record.offset + record.recordBytes + record.storedSize > footer.indexOffset)
      throw new RangeError(`Unreal Pak entry ${name} points outside the payload area`)
    const local = entryRecord(bytes, record.offset, footer.version, footer.compressionMethods)
    if (!sameRecord(record, local))
      throw new TypeError(`Unreal Pak local record differs for ${name}`)
    const path = cleanPath(rawMountPoint, name)
    if (paths.has(path)) throw new TypeError(`Unreal Pak contains duplicate path ${path}`)
    paths.add(path)
    entries.push(
      Object.freeze({ id: String(index), name: path.split('/').at(-1), path, ...record }),
    )
  }
  if (cursor.offset !== indexBytes.byteLength)
    throw new TypeError(
      `Unreal Pak index has ${indexBytes.byteLength - cursor.offset} trailing byte(s)`,
    )
  return Object.freeze({
    ...footer,
    mountPoint: cleanMountPoint(rawMountPoint),
    entries: Object.freeze(entries),
  })
}

function entryBytes(bytes, entry, maximum) {
  if (entry.encrypted)
    throw new TypeError(`Unreal Pak encrypted entry is unsupported: ${entry.path}`)
  if (entry.methodIndex !== 0)
    throw new TypeError(`Unreal Pak compression is unsupported: ${entry.method}`)
  if (entry.size > maximum) throw new RangeError('Unreal Pak entry exceeds maxScalarBytes budget')
  const start = entry.offset + entry.recordBytes
  range(bytes, start, entry.storedSize, entry.path)
  if (entry.storedSize !== entry.size)
    throw new TypeError(`Unreal Pak stored entry size differs: ${entry.path}`)
  return bytes.slice(start, start + entry.size)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError('Unreal Pak namespace page limit must be a positive safe integer')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid Unreal Pak page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          size: BigInt(entry.size),
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
      if (entry === undefined) throw new TypeError(`unknown Unreal Pak entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `unreal-pak-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'unreal-pak', label: 'Unreal Pak' }),
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
    const footer = footerOf(prefix)
    return footer === undefined
      ? { confidence: 0, kind: 'structure', note: 'Pak footer not present in probe window' }
      : { confidence: 0.995, kind: 'magic', note: `FPakInfo v${footer.version} footer` }
  },
  async inspect(bytes, context) {
    const archive = parsePak(bytes, context.budget)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    const stored = archive.entries.filter(
      entry => entry.methodIndex === 0 && !entry.encrypted,
    ).length
    return {
      summary: {
        format: 'unreal-pak',
        version: archive.version,
        mountPoint: archive.mountPoint,
        entries: archive.entries.length,
        stored,
        compressionMethods: archive.compressionMethods,
      },
      metadata: [
        {
          id: 'unreal-pak',
          label: 'Unreal Pak',
          entries: [
            { key: 'version', value: archive.version },
            { key: 'mountPoint', value: archive.mountPoint },
            { key: 'entries', value: archive.entries.length },
            { key: 'indexOffset', value: archive.indexOffset },
            { key: 'indexSize', value: archive.indexSize },
            { key: 'storedEntries', value: stored },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        {
          id: 'container.compression',
          parameters: { methods: ['stored', ...archive.compressionMethods] },
        },
        {
          id: 'content.binary',
          parameters: { bytes: String(bytes.byteLength), footerMagic: '5A6F12E1' },
        },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Unreal Pak',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes, ${entry.method}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(archive.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input))
            throw new TypeError('container.extract requires {entryId}')
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('Unreal Pak entry id was not found')
          return { kind: 'bytes', value: entryBytes(bytes, entry, context.budget.maxScalarBytes) }
        },
      },
      maxDecodedBytes: archive.entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n),
      unsupportedFeatures: [
        'pak-versions-other-than-v8',
        'encrypted-index',
        'encrypted-entry',
        'compressed-entry-extraction',
        'index-sha1-verification',
        'path-hash-index',
        'frozen-index',
        'pak-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
