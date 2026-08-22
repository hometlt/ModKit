// UE5 IoStore UTOC/UCAS bundle. Header/table ordering follows Epic's FIoStoreTocHeader and the
// open CUE4Parse reader that resolves the physical UCAS companion:
// https://github.com/FabianFG/CUE4Parse/blob/master/CUE4Parse/UE4/IO/IoStoreReader.cs

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unreal-iostore'
const MAGIC = '-==--==--==--==-'
const HEADER_BYTES = 0x90
const NONE = 0xffffffff
const MAX_ENTRIES = 1_000_000

function range(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError(`IoStore ${label} is outside the UTOC`)
}

function u24(bytes, offset) {
  range(bytes, offset, 3, 'u24')
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function u32(bytes, offset) {
  range(bytes, offset, 4, 'u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function i32(bytes, offset) {
  range(bytes, offset, 4, 'i32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true)
}

function u40le(bytes, offset) {
  range(bytes, offset, 5, 'u40le')
  return u32(bytes, offset) + bytes[offset + 4] * 0x1_0000_0000
}

function u40be(bytes, offset) {
  range(bytes, offset, 5, 'u40be')
  return (
    bytes[offset] * 0x1_0000_0000 +
    bytes[offset + 1] * 0x1000000 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x100 +
    bytes[offset + 4]
  )
}

function hasMagic(bytes) {
  return (
    bytes.byteLength >= MAGIC.length &&
    [...MAGIC].every((character, index) => bytes[index] === character.charCodeAt(0))
  )
}

function parseHeader(bytes) {
  range(bytes, 0, HEADER_BYTES, 'header')
  if (!hasMagic(bytes)) throw new TypeError('IoStore UTOC magic is missing')
  const version = bytes[0x10]
  const headerSize = u32(bytes, 0x14)
  const entryCount = u32(bytes, 0x18)
  const blockCount = u32(bytes, 0x1c)
  const blockEntrySize = u32(bytes, 0x20)
  const methodCount = u32(bytes, 0x24)
  const methodLength = u32(bytes, 0x28)
  const blockSize = u32(bytes, 0x2c)
  const directoryIndexSize = u32(bytes, 0x30)
  const partitionCount = u32(bytes, 0x34)
  const flags = bytes[0x50]
  const perfectHashSeeds = u32(bytes, 0x54)
  const overflowCount = u32(bytes, 0x60)
  if (version < 2 || version > 8) throw new TypeError(`IoStore version ${version} is unsupported`)
  if (headerSize !== HEADER_BYTES)
    throw new TypeError(`IoStore header size ${headerSize} is unsupported`)
  if (entryCount > MAX_ENTRIES || blockCount > MAX_ENTRIES)
    throw new RangeError('IoStore table count is invalid')
  if (blockEntrySize !== 12)
    throw new TypeError(`IoStore block entry size ${blockEntrySize} is unsupported`)
  if (methodCount > 256 || methodLength > 1024)
    throw new RangeError('IoStore compression method table is invalid')
  if (blockSize === 0) throw new TypeError('IoStore compression block size is zero')
  if (partitionCount !== 1)
    throw new TypeError(`IoStore partition count ${partitionCount} is unsupported`)
  if ((flags & 0x02) !== 0) throw new TypeError('IoStore encrypted containers are unsupported')
  if ((flags & 0x04) !== 0) throw new TypeError('IoStore signed containers are unsupported')
  if ((flags & 0x08) === 0) throw new TypeError('IoStore container has no directory index')
  return Object.freeze({
    version,
    headerSize,
    entryCount,
    blockCount,
    blockEntrySize,
    methodCount,
    methodLength,
    blockSize,
    directoryIndexSize,
    partitionCount,
    flags,
    perfectHashSeeds,
    overflowCount,
  })
}

function tableLayout(bytes, header) {
  let cursor = header.headerSize
  const chunkIds = cursor
  cursor += header.entryCount * 12
  const offsets = cursor
  cursor += header.entryCount * 10
  if (header.version >= 4) cursor += header.perfectHashSeeds * 4
  if (header.version >= 5) cursor += header.overflowCount * 4
  const blocks = cursor
  cursor += header.blockCount * header.blockEntrySize
  const methods = cursor
  cursor += header.methodCount * header.methodLength
  const directory = cursor
  cursor += header.directoryIndexSize
  const metadata = cursor
  cursor += header.entryCount * (header.version >= 8 ? 24 : 33)
  range(bytes, 0, cursor, 'tables')
  if (cursor !== bytes.byteLength)
    throw new TypeError(`IoStore UTOC has ${bytes.byteLength - cursor} trailing byte(s)`)
  return Object.freeze({ chunkIds, offsets, blocks, methods, directory, metadata, end: cursor })
}

class DirectoryCursor {
  constructor(bytes) {
    this.bytes = bytes
    this.offset = 0
  }

  readU32(label) {
    void label
    const value = u32(this.bytes, this.offset)
    this.offset += 4
    return value
  }

  count(label) {
    const value = this.readU32(`${label} count`)
    if (value > MAX_ENTRIES) throw new RangeError(`IoStore ${label} count is invalid`)
    return value
  }

  fString(label) {
    const length = i32(this.bytes, this.offset)
    this.offset += 4
    if (length === 0) return ''
    if (length > 0) {
      if (length > 1_048_576) throw new RangeError(`IoStore ${label} is too long`)
      range(this.bytes, this.offset, length, label)
      const raw = this.bytes.subarray(this.offset, this.offset + length)
      this.offset += length
      if (raw.at(-1) !== 0) throw new TypeError(`IoStore ${label} is not NUL terminated`)
      return new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(0, -1))
    }
    const units = -length
    if (units > 524_288) throw new RangeError(`IoStore ${label} is too long`)
    range(this.bytes, this.offset, units * 2, label)
    const raw = this.bytes.subarray(this.offset, this.offset + units * 2)
    this.offset += units * 2
    if (raw.at(-1) !== 0 || raw.at(-2) !== 0)
      throw new TypeError(`IoStore ${label} is not UTF-16LE NUL terminated`)
    return new TextDecoder('utf-16le', { fatal: true }).decode(raw.subarray(0, -2))
  }
}

function safeSegment(value, label) {
  if (!value || value === '.' || value === '..' || /[\\/\0]/u.test(value))
    throw new TypeError(`IoStore ${label} path segment is unsafe: ${value}`)
  return value
}

function cleanMount(value) {
  const result = value
    .replaceAll('\\', '/')
    .replace(/^(?:\.\.\/)+/u, '')
    .replace(/^\/+|\/+$/gu, '')
  if (!result || result.includes('/../') || result.endsWith('/..') || result.includes('\0'))
    throw new TypeError(`IoStore mount point is unsafe: ${value}`)
  return result
}

function directoryFiles(bytes, entryCount) {
  const cursor = new DirectoryCursor(bytes)
  const mountPoint = cleanMount(cursor.fString('mount point'))
  const directories = Array.from({ length: cursor.count('directory') }, () =>
    Object.freeze({
      name: cursor.readU32('directory name'),
      firstChild: cursor.readU32('first child'),
      nextSibling: cursor.readU32('next sibling'),
      firstFile: cursor.readU32('first file'),
    }),
  )
  const files = Array.from({ length: cursor.count('file') }, () =>
    Object.freeze({
      name: cursor.readU32('file name'),
      nextFile: cursor.readU32('next file'),
      userData: cursor.readU32('file user data'),
    }),
  )
  const strings = Array.from({ length: cursor.count('string') }, (_, index) =>
    cursor.fString(`string ${index}`),
  )
  if (cursor.offset !== bytes.byteLength)
    throw new TypeError(
      `IoStore directory index has ${bytes.byteLength - cursor.offset} trailing byte(s)`,
    )
  if (directories.length === 0 || directories[0].name !== NONE)
    throw new TypeError('IoStore directory index has no root')
  const output = []
  const visited = new Set()
  const stack = [{ index: 0, segments: [] }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current.index >= directories.length || visited.has(current.index))
      throw new TypeError('IoStore directory index contains a cycle or invalid index')
    visited.add(current.index)
    const directory = directories[current.index]
    const segments = [...current.segments]
    if (directory.name !== NONE) {
      if (directory.name >= strings.length)
        throw new TypeError('IoStore directory name index is invalid')
      segments.push(safeSegment(strings[directory.name], 'directory'))
    }
    const seenFiles = new Set()
    let fileIndex = directory.firstFile
    while (fileIndex !== NONE) {
      if (fileIndex >= files.length || seenFiles.has(fileIndex))
        throw new TypeError('IoStore file list contains a cycle or invalid index')
      seenFiles.add(fileIndex)
      const file = files[fileIndex]
      if (file.name >= strings.length || file.userData >= entryCount)
        throw new TypeError('IoStore file references an invalid name or TOC entry')
      const name = safeSegment(strings[file.name], 'file')
      output.push(
        Object.freeze({ path: [mountPoint, ...segments, name].join('/'), tocIndex: file.userData }),
      )
      fileIndex = file.nextFile
    }
    const children = []
    const seenChildren = new Set()
    let child = directory.firstChild
    while (child !== NONE) {
      if (child >= directories.length || seenChildren.has(child))
        throw new TypeError('IoStore child list contains a cycle or invalid index')
      seenChildren.add(child)
      children.push(child)
      child = directories[child].nextSibling
    }
    for (let index = children.length - 1; index >= 0; index -= 1)
      stack.push({ index: children[index], segments })
  }
  return Object.freeze({ mountPoint, files: Object.freeze(output) })
}

function parseUtoc(bytes, budget) {
  if (budget.maxDepth < 4) throw new RangeError('IoStore structure exceeds maxDepth budget')
  const header = parseHeader(bytes)
  if (header.entryCount > budget.maxNodes)
    throw new RangeError('IoStore entries exceed maxNodes budget')
  const layout = tableLayout(bytes, header)
  const offsets = Array.from({ length: header.entryCount }, (_, index) => {
    const offset = layout.offsets + index * 10
    return Object.freeze({ offset: u40be(bytes, offset), length: u40be(bytes, offset + 5) })
  })
  const methods = Array.from({ length: header.methodCount }, (_, index) =>
    String.fromCharCode(
      ...bytes.subarray(
        layout.methods + index * header.methodLength,
        layout.methods + (index + 1) * header.methodLength,
      ),
    )
      .split('\0')[0]
      .trim(),
  )
  if (methods.some(method => !/^[\x20-\x7e]+$/u.test(method)))
    throw new TypeError('IoStore compression method table is invalid')
  const blocks = Array.from({ length: header.blockCount }, (_, index) => {
    const offset = layout.blocks + index * header.blockEntrySize
    const methodIndex = bytes[offset + 11]
    if (methodIndex > methods.length)
      throw new TypeError('IoStore block uses a missing compression method')
    return Object.freeze({
      physicalOffset: u40le(bytes, offset),
      storedSize: u24(bytes, offset + 5),
      size: u24(bytes, offset + 8),
      methodIndex,
      method: methodIndex === 0 ? 'None' : methods[methodIndex - 1],
    })
  })
  const directory = directoryFiles(
    bytes.subarray(layout.directory, layout.directory + header.directoryIndexSize),
    header.entryCount,
  )
  const entries = directory.files.map((file, index) => {
    const value = offsets[file.tocIndex]
    if (value.length === 0)
      return Object.freeze({
        id: String(index),
        ...file,
        offset: value.offset,
        size: 0,
        firstBlock: 0,
        lastBlock: -1,
        methods: Object.freeze([]),
      })
    const firstBlock = Math.floor(value.offset / header.blockSize)
    const lastBlock = Math.floor((value.offset + value.length - 1) / header.blockSize)
    if (lastBlock >= blocks.length)
      throw new TypeError(`IoStore entry ${file.path} references a missing block`)
    return Object.freeze({
      id: String(index),
      ...file,
      offset: value.offset,
      size: value.length,
      firstBlock,
      lastBlock,
      methods: Object.freeze([
        ...new Set(blocks.slice(firstBlock, lastBlock + 1).map(block => block.method)),
      ]),
    })
  })
  return Object.freeze({
    header,
    methods: Object.freeze(methods),
    blocks: Object.freeze(blocks),
    mountPoint: directory.mountPoint,
    entries: Object.freeze(entries),
  })
}

async function readSource(source, maximum, signal) {
  if (source.kind !== 'bytes') throw new TypeError('IoStore UCAS companion must be bytes')
  if (source.size === undefined || source.size > BigInt(maximum))
    throw new RangeError('IoStore UCAS companion exceeds maxInputBytes/maxScalarBytes budget')
  return source.read(0n, Number(source.size), signal)
}

async function companionBytes(input, budget, signal) {
  const [binding] = input.bindingsFor('ucas')
  if (binding === undefined) throw new TypeError('IoStore UCAS companion is missing')
  const lease = await input.openBinding(binding.bindingId, signal)
  try {
    const maximum = Math.min(Number(budget.maxInputBytes), budget.maxScalarBytes)
    return await readSource(lease.value, maximum, signal)
  } finally {
    await lease.release()
  }
}

function extractEntry(archive, ucas, entry, maximum) {
  if (entry.size > maximum) throw new RangeError('IoStore entry exceeds maxScalarBytes budget')
  if (entry.size === 0) return new Uint8Array()
  const decoded = []
  let decodedBytes = 0
  for (let index = entry.firstBlock; index <= entry.lastBlock; index += 1) {
    const block = archive.blocks[index]
    if (block.methodIndex !== 0)
      throw new TypeError(`IoStore compression is unsupported: ${block.method}`)
    if (block.storedSize !== block.size) throw new TypeError('IoStore stored block size differs')
    if (block.physicalOffset + block.storedSize > ucas.byteLength)
      throw new RangeError('IoStore block points outside the UCAS companion')
    decoded.push(ucas.subarray(block.physicalOffset, block.physicalOffset + block.storedSize))
    decodedBytes += block.size
  }
  const logicalStart = entry.firstBlock * archive.header.blockSize
  const leading = entry.offset - logicalStart
  if (leading < 0 || leading + entry.size > decodedBytes)
    throw new TypeError('IoStore entry range is outside its decoded blocks')
  const output = new Uint8Array(entry.size)
  let sourceOffset = 0
  let outputOffset = 0
  for (const block of decoded) {
    const copyStart = Math.max(sourceOffset, leading)
    const copyEnd = Math.min(sourceOffset + block.byteLength, leading + entry.size)
    if (copyEnd > copyStart) {
      const local = copyStart - sourceOffset
      output.set(block.subarray(local, local + copyEnd - copyStart), outputOffset)
      outputOffset += copyEnd - copyStart
    }
    sourceOffset += block.byteLength
  }
  return output
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError('IoStore namespace page limit must be positive')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid IoStore page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.path.split('/').at(-1),
          kind: 'file',
          size: BigInt(entry.size),
          compression: entry.methods.join('+'),
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
      if (entry === undefined) throw new TypeError(`unknown IoStore entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `iostore-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

function ucasPattern(uri) {
  const plain = decodeURIComponent(uri.split(/[?#]/u)[0])
  const name = plain.split(/[\\/]/u).at(-1) ?? ''
  if (!/\.utoc$/iu.test(name)) throw new TypeError('IoStore candidate name must end in .utoc')
  return name.replace(/\.utoc$/iu, '.ucas')
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'unreal-iostore', label: 'Unreal IoStore' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async planInput(source) {
    if (source.kind !== 'bytes') throw new TypeError('IoStore requires a byte candidate')
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({
        bindingId: 'utoc',
        role: 'table-of-contents',
        ownership: 'owned',
      }),
      requirements: Object.freeze([
        Object.freeze({
          id: 'ucas',
          role: 'container-payload',
          ownership: 'companion',
          cardinality: 'one',
          required: true,
          patterns: Object.freeze([ucasPattern(source.ref.uri)]),
          scopes: Object.freeze(['sibling-directory', 'enclosing-container']),
        }),
      ]),
    })
  },
  async detect(prefix) {
    return hasMagic(prefix)
      ? { confidence: 0.995, kind: 'magic', note: 'FIoStoreTocHeader magic' }
      : { confidence: 0, kind: 'magic', note: 'UTOC magic missing' }
  },
  async inspect(bytes, context) {
    const archive = parseUtoc(bytes, context.budget)
    const ucas = await companionBytes(context.input, context.budget, context.signal)
    const byId = new Map(archive.entries.map(entry => [entry.id, entry]))
    for (const block of archive.blocks)
      if (block.physicalOffset + block.storedSize > ucas.byteLength)
        throw new RangeError('IoStore block points outside the UCAS companion')
    const [ucasBinding] = context.input.bindingsFor('ucas')
    if (ucasBinding === undefined) throw new TypeError('IoStore UCAS companion binding is missing')
    return {
      summary: {
        format: 'unreal-iostore',
        version: archive.header.version,
        mountPoint: archive.mountPoint,
        entries: archive.entries.length,
        blocks: archive.blocks.length,
        blockSize: archive.header.blockSize,
        compressionMethods: archive.methods,
        companionBytes: ucas.byteLength,
      },
      metadata: [
        {
          id: 'unreal-iostore',
          label: 'Unreal IoStore',
          entries: [
            { key: 'version', value: archive.header.version },
            { key: 'mountPoint', value: archive.mountPoint },
            { key: 'entries', value: archive.entries.length },
            { key: 'blocks', value: archive.blocks.length },
            { key: 'blockSize', value: archive.header.blockSize },
            { key: 'ucasBytes', value: ucas.byteLength },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'container.compression', parameters: { methods: ['stored', ...archive.methods] } },
        {
          id: 'content.binary',
          parameters: { utocBytes: String(bytes.byteLength), ucasBytes: String(ucas.byteLength) },
        },
      ],
      companions: [
        {
          id: 'ucas',
          role: 'container-payload',
          required: true,
          cardinality: 'one',
          state: 'resolved',
          bindingIds: [ucasBinding.bindingId],
        },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Unreal IoStore',
          preview: `${archive.entries.length} entries`,
          children: archive.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes, ${entry.methods.join('+')}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(archive.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input))
            throw new TypeError('container.extract requires {entryId}')
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('IoStore entry id was not found')
          return {
            kind: 'bytes',
            value: extractEntry(archive, ucas, entry, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: archive.entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n),
      unsupportedFeatures: [
        'encrypted-containers',
        'signed-containers',
        'compressed-block-extraction',
        'multiple-partitions',
        'perfect-hash-validation',
        'iostore-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
