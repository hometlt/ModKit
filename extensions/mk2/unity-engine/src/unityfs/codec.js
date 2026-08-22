import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unityfs'
const MAGIC = 'UnityFS\0'

function align(value, multiple) {
  return value + ((multiple - (value % multiple)) % multiple)
}

function assertBudget(bytes, context, nodes, scalarBytes = 0) {
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('Unity input exceeds maxInputBytes')
  }
  if (nodes > context.budget.maxNodes) throw new RangeError('Unity input exceeds maxNodes')
  if (scalarBytes > context.budget.maxScalarBytes) {
    throw new RangeError('Unity input exceeds maxScalarBytes')
  }
}

function safeSegment(value) {
  const clean = value
    .replace(/\\/gu, '/')
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.\.+/gu, '_')
    .replace(/[<>:"|?*\u0000-\u001f]/gu, '_')
    .replace(/\/+/gu, '_')
  return clean || 'unnamed'
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('Unity namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) {
        throw new TypeError('invalid Unity namespace cursor')
      }
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          size: BigInt(entry.size),
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
      if (entry === undefined) throw new TypeError(`unknown Unity entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `unityfs-entry:${encodeURIComponent(source.ref.uri)}!/${encodeURI(entry.path)}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

class Cursor {
  constructor(bytes, offset = 0, end = bytes.byteLength) {
    this.bytes = bytes
    this.offset = offset
    this.end = end
  }

  ensure(length) {
    if (length < 0 || this.offset + length > this.end) {
      throw new RangeError('UnityFS structure is truncated')
    }
  }

  u16() {
    this.ensure(2)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 2).getUint16(
      0,
      false,
    )
    this.offset += 2
    return value
  }

  u32() {
    this.ensure(4)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getUint32(
      0,
      false,
    )
    this.offset += 4
    return value
  }

  u64() {
    this.ensure(8)
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8)
    const value = view.getBigUint64(0, false)
    this.offset += 8
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('UnityFS 64-bit value exceeds the safe integer range')
    }
    return Number(value)
  }

  skip(length) {
    this.ensure(length)
    this.offset += length
  }

  cString() {
    const start = this.offset
    while (this.offset < this.end && this.bytes[this.offset] !== 0) this.offset += 1
    if (this.offset >= this.end) throw new RangeError('UnityFS string is unterminated')
    const value = new TextDecoder().decode(this.bytes.subarray(start, this.offset))
    this.offset += 1
    return value
  }
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function parseUnityFs(bytes, context) {
  const header = new Cursor(bytes)
  if (header.cString() !== 'UnityFS') throw new TypeError('not a UnityFS AssetBundle')
  const formatVersion = header.u32()
  if (formatVersion < 6 || formatVersion > 9) {
    throw new TypeError(`unsupported UnityFS format version ${formatVersion}`)
  }
  const targetVersion = header.cString()
  const unityVersion = header.cString()
  const bundleSize = header.u64()
  const compressedInfoSize = header.u32()
  const uncompressedInfoSize = header.u32()
  const flags = header.u32()
  if (formatVersion >= 7) header.offset = align(header.offset, 16)
  if (bundleSize !== bytes.byteLength) {
    throw new TypeError(`UnityFS bundle size ${bundleSize} does not match ${bytes.byteLength}`)
  }
  const blockInfoAtEnd = (flags & 0x80) !== 0
  const infoCompression = flags & 0x3f
  if (infoCompression !== 0) {
    throw new TypeError(`unsupported UnityFS block-info compression ${infoCompression}`)
  }
  if (compressedInfoSize !== uncompressedInfoSize) {
    throw new TypeError('stored UnityFS block-info sizes disagree')
  }
  const infoOffset = blockInfoAtEnd ? bytes.byteLength - compressedInfoSize : header.offset
  if (infoOffset < header.offset || infoOffset + compressedInfoSize > bytes.byteLength) {
    throw new RangeError('UnityFS block-info range is out of bounds')
  }
  const info = new Cursor(bytes, infoOffset, infoOffset + compressedInfoSize)
  info.skip(16)
  const blockCount = info.u32()
  if (blockCount < 1) throw new TypeError('UnityFS bundle declares no data blocks')
  assertBudget(bytes, context, blockCount)
  const blocks = []
  for (let index = 0; index < blockCount; index += 1) {
    const uncompressedSize = info.u32()
    const compressedSize = info.u32()
    const blockFlags = info.u16()
    if ((blockFlags & 0x3f) !== 0 || uncompressedSize !== compressedSize) {
      throw new TypeError('this UnityFS profile supports stored data blocks only')
    }
    blocks.push({ uncompressedSize, compressedSize })
  }
  const directoryCount = info.u32()
  assertBudget(bytes, context, blockCount + directoryCount)
  const entries = []
  let scalarBytes = targetVersion.length + unityVersion.length
  for (let index = 0; index < directoryCount; index += 1) {
    const offset = info.u64()
    const size = info.u64()
    const entryFlags = info.u32()
    const rawName = info.cString()
    const name = safeSegment(rawName)
    scalarBytes += rawName.length
    entries.push({
      id: `entry-${index}`,
      path: name,
      name,
      offset,
      size,
      flags: entryFlags,
    })
  }
  if (info.offset !== info.end) throw new TypeError('UnityFS block-info has trailing bytes')
  assertBudget(bytes, context, blockCount + directoryCount, scalarBytes)

  let dataOffset = blockInfoAtEnd ? header.offset : infoOffset + compressedInfoSize
  if ((flags & 0x200) !== 0) dataOffset = align(dataOffset, 16)
  const chunks = []
  for (const block of blocks) {
    if (dataOffset + block.compressedSize > (blockInfoAtEnd ? infoOffset : bytes.byteLength)) {
      throw new RangeError('UnityFS data block is out of bounds')
    }
    chunks.push(bytes.slice(dataOffset, dataOffset + block.compressedSize))
    dataOffset += block.compressedSize
  }
  const payload = concat(chunks)
  for (const entry of entries) {
    if (entry.offset + entry.size > payload.byteLength) {
      throw new RangeError(`UnityFS entry ${entry.path} is out of bounds`)
    }
  }
  return {
    formatVersion,
    targetVersion,
    unityVersion,
    bundleSize,
    flags,
    blocks,
    entries,
    payload,
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'unityfs', label: 'UnityFS AssetBundle' }),
  async detect(prefix) {
    const magic =
      prefix.byteLength >= MAGIC.length
        ? String.fromCharCode(...prefix.subarray(0, MAGIC.length))
        : ''
    return magic === MAGIC
      ? { confidence: 0.99, kind: 'magic', note: 'unityfs-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const archive = parseUnityFs(bytes, context)
    const entryBytes = archive.entries.reduce((sum, entry) => sum + entry.size, 0)
    return {
      summary: {
        format: 'unityfs',
        version: archive.formatVersion,
        unityVersion: archive.unityVersion,
        blocks: archive.blocks.length,
        entries: archive.entries.length,
        entryBytes,
      },
      metadata: [
        {
          id: 'unityfs',
          label: 'UnityFS AssetBundle',
          entries: [
            { key: 'formatVersion', value: archive.formatVersion },
            { key: 'targetVersion', value: archive.targetVersion },
            { key: 'unityVersion', value: archive.unityVersion },
            { key: 'blocks', value: archive.blocks.length },
            { key: 'entries', value: archive.entries.length },
            { key: 'bundleBytes', value: archive.bundleSize },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: archive.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'UnityFS',
          preview: `${archive.entries.length} entries in ${archive.blocks.length} stored blocks`,
          children: archive.entries.map(entry => ({
            kind: 'entry',
            label: entry.path,
            preview: `${entry.size} bytes at ${entry.offset}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(archive.entries, context.source),
      },
      unsupportedFeatures: ['lzma-blocks', 'lz4-blocks', 'lz4hc-blocks', 'bundle-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
