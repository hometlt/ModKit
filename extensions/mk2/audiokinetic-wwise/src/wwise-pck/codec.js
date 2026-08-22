import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/wwise-pck'
const ascii = (bytes, offset, length) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

function parsePck(bytes, context) {
  if (bytes.byteLength < 24 || ascii(bytes, 0, 4) !== 'AKPK') {
    throw new TypeError('not a Wwise AKPK package')
  }
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('Wwise PCK exceeds maxInputBytes')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const leSize = view.getUint32(4, true)
  const beSize = view.getUint32(4, false)
  const littleEndian = leSize >= 16 && leSize <= bytes.byteLength
  if (!littleEndian && !(beSize >= 16 && beSize <= bytes.byteLength)) {
    throw new TypeError('Wwise PCK header size is invalid')
  }
  const u32 = offset => view.getUint32(offset, littleEndian)
  const headerSize = u32(4)
  const flag = u32(8)
  const sectionSizes = [u32(12), u32(16), u32(20)]
  let cursor = 24
  const kinds = ['language', 'bank', 'sound']
  const entries = []
  let scalarBytes = 0
  for (let section = 0; section < sectionSizes.length; section += 1) {
    const sectionSize = sectionSizes[section]
    const end = cursor + sectionSize
    if (end > bytes.byteLength)
      throw new RangeError(`Wwise PCK ${kinds[section]} table is truncated`)
    if (section === 0) {
      if (sectionSize !== 0) {
        throw new TypeError('this Wwise PCK profile requires an empty language table')
      }
    } else if (sectionSize > 0) {
      if (sectionSize < 4) throw new TypeError(`Wwise PCK ${kinds[section]} table is truncated`)
      const count = u32(cursor)
      if (count > context.budget.maxNodes) throw new RangeError('Wwise PCK exceeds maxNodes')
      if (sectionSize !== 4 + count * 20) {
        throw new TypeError(`Wwise PCK ${kinds[section]} table has an unsupported record size`)
      }
      for (let index = 0; index < count; index += 1) {
        const record = cursor + 4 + index * 20
        const numericId = u32(record)
        const blockSize = u32(record + 4)
        const size = u32(record + 8)
        const startBlock = u32(record + 12)
        const languageId = u32(record + 16)
        const offset = blockSize === 0 ? startBlock : startBlock * blockSize
        if (languageId !== 0) throw new TypeError('this Wwise PCK profile has no language mapping')
        if (!Number.isSafeInteger(offset) || offset + size > bytes.byteLength) {
          throw new RangeError(`Wwise PCK entry ${numericId} is out of bounds`)
        }
        const kind = section === 1 ? 'bank' : 'sound'
        const extension = kind === 'bank' ? 'bnk' : 'wem'
        const name = `${numericId}.${extension}`
        scalarBytes += name.length
        entries.push({
          id: `entry-${section}-${index}`,
          path: name,
          name,
          numericId,
          kind,
          offset,
          size,
        })
      }
    }
    cursor = end
  }
  if (entries.length < 1) throw new TypeError('Wwise PCK package has no bank or sound entries')
  if (scalarBytes > context.budget.maxScalarBytes) {
    throw new RangeError('Wwise PCK names exceed maxScalarBytes')
  }
  return { littleEndian, headerSize, flag, entries }
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('Wwise PCK page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid PCK cursor')
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
      if (entry === undefined) throw new TypeError(`unknown Wwise PCK entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `wwise-pck:${encodeURIComponent(source.ref.uri)}!/${entry.path}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'wwise-pck', label: 'Audiokinetic Wwise PCK package' }),
  async detect(prefix) {
    return prefix.byteLength >= 4 && ascii(prefix, 0, 4) === 'AKPK'
      ? { confidence: 0.99, kind: 'magic', note: 'wwise-akpk' }
      : { confidence: 0, kind: 'magic', note: 'akpk-mismatch' }
  },
  async inspect(bytes, context) {
    const packageModel = parsePck(bytes, context)
    const banks = packageModel.entries.filter(entry => entry.kind === 'bank').length
    const sounds = packageModel.entries.length - banks
    return {
      summary: {
        format: 'wwise-pck',
        endian: packageModel.littleEndian ? 'little' : 'big',
        headerSize: packageModel.headerSize,
        flag: packageModel.flag,
        banks,
        sounds,
        entries: packageModel.entries.length,
      },
      metadata: [
        {
          id: 'wwise-pck',
          label: 'Wwise PCK package',
          entries: [
            { key: 'endian', value: packageModel.littleEndian ? 'little' : 'big' },
            { key: 'headerSize', value: packageModel.headerSize },
            { key: 'flag', value: packageModel.flag },
            { key: 'banks', value: banks },
            { key: 'sounds', value: sounds },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: packageModel.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Wwise PCK',
          preview: `${banks} bank(s), ${sounds} sound(s)`,
          children: packageModel.entries.map(entry => ({
            kind: 'entry',
            label: entry.path,
            preview: `${entry.kind}; ${entry.size} bytes at ${entry.offset}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(packageModel.entries, context.source),
      },
      unsupportedFeatures: [
        'language-tables',
        '24-byte-and-external-entry-records',
        'semantic-name-resolution',
        'package-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
