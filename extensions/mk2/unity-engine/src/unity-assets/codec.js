import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unity-assets'

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
          uri: `unity-object:${encodeURIComponent(source.ref.uri)}!/${encodeURI(entry.path)}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const CLASS_NAMES = new Map([
  [1, 'GameObject'],
  [4, 'Transform'],
  [21, 'Material'],
  [28, 'Texture2D'],
  [43, 'Mesh'],
  [49, 'TextAsset'],
  [83, 'AudioClip'],
  [114, 'MonoBehaviour'],
  [198, 'VideoClip'],
])

class Cursor {
  constructor(bytes, littleEndian, offset = 0, end = bytes.byteLength) {
    this.bytes = bytes
    this.littleEndian = littleEndian
    this.offset = offset
    this.end = end
  }

  ensure(length) {
    if (length < 0 || this.offset + length > this.end) {
      throw new RangeError('Unity serialized metadata is truncated')
    }
  }

  u8() {
    this.ensure(1)
    return this.bytes[this.offset++] ?? 0
  }

  u16() {
    this.ensure(2)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 2).getUint16(
      0,
      this.littleEndian,
    )
    this.offset += 2
    return value
  }

  u32() {
    this.ensure(4)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getUint32(
      0,
      this.littleEndian,
    )
    this.offset += 4
    return value
  }

  i32() {
    this.ensure(4)
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getInt32(
      0,
      this.littleEndian,
    )
    this.offset += 4
    return value
  }

  i64() {
    this.ensure(8)
    const value = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    ).getBigInt64(0, this.littleEndian)
    this.offset += 8
    return value
  }

  skip(length) {
    this.ensure(length)
    this.offset += length
  }

  align4() {
    this.offset = align(this.offset, 4)
    this.ensure(0)
  }

  cString() {
    const start = this.offset
    while (this.offset < this.end && this.bytes[this.offset] !== 0) this.offset += 1
    if (this.offset >= this.end) throw new RangeError('Unity serialized string is unterminated')
    const value = new TextDecoder().decode(this.bytes.subarray(start, this.offset))
    this.offset += 1
    return value
  }
}

function serializedHeader(bytes) {
  if (bytes.byteLength < 20) return undefined
  const reader = new Cursor(bytes, false)
  const metadataSize = reader.u32()
  const fileSize = reader.u32()
  const formatVersion = reader.u32()
  const dataOffset = reader.u32()
  const endian = reader.u8()
  reader.skip(3)
  if (
    formatVersion < 17 ||
    formatVersion > 19 ||
    metadataSize < 20 ||
    fileSize < dataOffset ||
    dataOffset < 20 ||
    endian > 1
  ) {
    return undefined
  }
  return { metadataSize, fileSize, formatVersion, dataOffset, littleEndian: endian === 0 }
}

function objectName(bytes, object, littleEndian) {
  if (object.size < 4) return ''
  const view = new DataView(bytes.buffer, bytes.byteOffset + object.offset, 4)
  const length = view.getUint32(0, littleEndian)
  if (length === 0 || length > 4096 || 4 + length > object.size) return ''
  const value = new TextDecoder().decode(
    bytes.subarray(object.offset + 4, object.offset + 4 + length),
  )
  return /^[^\u0000-\u001f]+$/u.test(value) ? value : ''
}

function parseSerialized(bytes, context) {
  const header = serializedHeader(bytes)
  if (header === undefined) {
    throw new TypeError('unsupported or invalid Unity serialized header (expected format 17-19)')
  }
  if (header.fileSize !== bytes.byteLength || header.metadataSize > header.dataOffset) {
    throw new TypeError('Unity serialized header sizes are inconsistent')
  }
  const reader = new Cursor(bytes, header.littleEndian, 20, header.dataOffset)
  const unityVersion = reader.cString()
  const targetPlatform = reader.i32()
  const typeTreeEnabled = reader.u8() !== 0
  if (typeTreeEnabled) {
    throw new TypeError('this Unity serialized profile requires a stripped type tree')
  }
  const typeCount = reader.i32()
  if (typeCount < 1) throw new TypeError('Unity serialized file declares no object types')
  assertBudget(bytes, context, typeCount)
  const types = []
  for (let index = 0; index < typeCount; index += 1) {
    const classId = reader.i32()
    reader.skip(1)
    const scriptTypeIndex = reader.u16()
    if (classId === 114 && scriptTypeIndex !== 0xffff) reader.skip(16)
    reader.skip(16)
    types.push({ classId, className: CLASS_NAMES.get(classId) ?? `Class${classId}` })
  }
  const objectCount = reader.i32()
  if (objectCount < 1) throw new TypeError('Unity serialized file declares no objects')
  assertBudget(bytes, context, typeCount + objectCount)
  const objects = []
  let scalarBytes = unityVersion.length
  for (let index = 0; index < objectCount; index += 1) {
    reader.align4()
    const pathId = reader.i64()
    const relativeOffset = reader.u32()
    const size = reader.u32()
    const typeIndex = reader.i32()
    const type = types[typeIndex]
    if (type === undefined) throw new TypeError(`Unity object ${index} has an invalid type index`)
    const offset = header.dataOffset + relativeOffset
    if (offset < header.dataOffset || offset + size > bytes.byteLength) {
      throw new RangeError(`Unity object ${index} is out of bounds`)
    }
    const parsedName = objectName(bytes, { offset, size }, header.littleEndian)
    const name = safeSegment(parsedName || `${type.className}-${pathId}`)
    scalarBytes += name.length
    objects.push({
      id: `object-${pathId}`,
      path: `objects/${String(index).padStart(4, '0')}-${name}.bin`,
      name: `${name}.bin`,
      offset,
      size,
      pathId: String(pathId),
      classId: type.classId,
      className: type.className,
    })
  }
  assertBudget(bytes, context, typeCount + objectCount, scalarBytes)
  return { header, unityVersion, targetPlatform, types, objects }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'unity-assets', label: 'Unity Serialized Assets' }),
  async detect(prefix) {
    const header = serializedHeader(prefix)
    return header === undefined
      ? { confidence: 0, kind: 'structure', note: 'no-supported-unity-header' }
      : { confidence: 0.97, kind: 'structure', note: `unity-serialized-${header.formatVersion}` }
  },
  async inspect(bytes, context) {
    const file = parseSerialized(bytes, context)
    return {
      summary: {
        format: 'unity-assets',
        serializedVersion: file.header.formatVersion,
        unityVersion: file.unityVersion,
        targetPlatform: file.targetPlatform,
        types: file.types.length,
        objects: file.objects.length,
      },
      metadata: [
        {
          id: 'unity-serialized',
          label: 'Unity serialized file',
          entries: [
            { key: 'formatVersion', value: file.header.formatVersion },
            { key: 'unityVersion', value: file.unityVersion },
            { key: 'targetPlatform', value: file.targetPlatform },
            { key: 'metadataBytes', value: file.header.metadataSize },
            { key: 'dataOffset', value: file.header.dataOffset },
            { key: 'types', value: file.types.length },
            { key: 'objects', value: file.objects.length },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: file.objects.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Unity serialized assets',
          preview: `${file.objects.length} objects; Unity ${file.unityVersion}`,
          children: file.objects.map(object => ({
            kind: 'entry',
            label: object.path,
            preview: `${object.className} pathID=${object.pathId}; ${object.size} bytes`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(file.objects, context.source),
      },
      unsupportedFeatures: [
        'serialized-versions-outside-17-19',
        'embedded-type-trees',
        'class-aware-decoding',
        'external-resource-resolution',
        'asset-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
