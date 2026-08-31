import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkit/codec-kit'

const ID = 'modkit/dmg'
const TRAILER_BYTES = 512

function readU32be(view, offset) {
  return view.getUint32(offset, false)
}

function readU64be(view, offset, label) {
  const value = view.getBigUint64(offset, false)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`DMG ${label} exceeds the portable integer range`)
  }
  return Number(value)
}

function hasKoly(bytes, offset) {
  return (
    bytes[offset] === 0x6b &&
    bytes[offset + 1] === 0x6f &&
    bytes[offset + 2] === 0x6c &&
    bytes[offset + 3] === 0x79
  )
}

function parseRange(view, offsetField, lengthField, label, limit) {
  const offset = readU64be(view, offsetField, `${label} offset`)
  const size = readU64be(view, lengthField, `${label} size`)
  if (offset > limit || size > limit - offset) throw new TypeError(`DMG ${label} range is invalid`)
  return Object.freeze({ label, offset, size })
}

function parseDmg(bytes, budget) {
  if (bytes.byteLength < TRAILER_BYTES) throw new TypeError('DMG UDIF trailer is truncated')
  const trailerOffset = bytes.byteLength - TRAILER_BYTES
  if (!hasKoly(bytes, trailerOffset)) throw new TypeError('DMG UDIF koly signature is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset + trailerOffset, TRAILER_BYTES)
  const version = readU32be(view, 4)
  const headerSize = readU32be(view, 8)
  if (version !== 4 || headerSize !== TRAILER_BYTES) {
    throw new TypeError('DMG UDIF trailer version or size is invalid')
  }
  const segmentNumber = readU32be(view, 56)
  const segmentCount = readU32be(view, 60)
  if (segmentCount > 1 || segmentNumber > 1 || (segmentCount === 1 && segmentNumber !== 1)) {
    throw new TypeError('DMG segmented images are unsupported')
  }

  const dataFork = parseRange(view, 24, 32, 'data fork', trailerOffset)
  const resourceFork = parseRange(view, 40, 48, 'resource fork', trailerOffset)
  const xml = parseRange(view, 216, 224, 'XML plist', trailerOffset)
  const ranges = [dataFork, resourceFork, xml].filter(range => range.size > 0)
  if (ranges.length === 0) throw new TypeError('DMG declares no extractable fork')
  if (ranges.length > budget.maxNodes)
    throw new RangeError('DMG fork count exceeds maxNodes budget')
  for (const range of ranges) {
    if (range.size > budget.maxScalarBytes) {
      throw new RangeError(`DMG ${range.label} exceeds maxScalarBytes budget`)
    }
  }
  const sorted = [...ranges].sort((left, right) => left.offset - right.offset)
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].offset + sorted[index - 1].size > sorted[index].offset) {
      throw new TypeError('DMG declared forks overlap')
    }
  }

  const entryFor = (range, id, path, compression) =>
    range.size === 0 ? undefined : Object.freeze({ ...range, compression, id, name: path, path })
  const entries = Object.freeze(
    [
      entryFor(dataFork, 'data-fork', 'data-fork.bin', 'udif-data-fork'),
      entryFor(resourceFork, 'resource-fork', 'resource-fork.bin', 'none'),
      entryFor(xml, 'xml-plist', 'resources.plist', 'none'),
    ].filter(entry => entry !== undefined),
  )
  return Object.freeze({
    dataChecksumBits: readU32be(view, 84),
    dataChecksumType: readU32be(view, 80),
    entries,
    flags: readU32be(view, 12),
    imageVariant: readU32be(view, 488),
    masterChecksumBits: readU32be(view, 356),
    masterChecksumType: readU32be(view, 352),
    sectorCount: readU64be(view, 492, 'sector count'),
    segmentCount,
    segmentNumber,
    trailerOffset,
    version,
  })
}

function prefixLooksSupported(prefix) {
  if (prefix.byteLength < TRAILER_BYTES) return false
  const offset = prefix.byteLength - TRAILER_BYTES
  if (!hasKoly(prefix, offset)) return false
  const view = new DataView(prefix.buffer, prefix.byteOffset + offset, TRAILER_BYTES)
  return readU32be(view, 4) === 4 && readU32be(view, 8) === TRAILER_BYTES
}

function namespaceSource(image, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('DMG namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid DMG page cursor')
      const matching = image.entries.filter(entry => entry.path.startsWith(prefix))
      const selected = matching.slice(start, start + page.limit)
      const items = Object.freeze(
        selected.map(entry =>
          Object.freeze({
            id: entry.id,
            path: entry.path,
            name: entry.name,
            kind: 'file',
            size: BigInt(entry.size),
            compression: entry.compression,
            revision: source.revision,
          }),
        ),
      )
      const next = start + selected.length
      return Object.freeze({ items, ...(next < matching.length ? { cursor: String(next) } : {}) })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const entry = image.entries.find(candidate => candidate.id === entryId)
      if (entry === undefined) throw new TypeError('unknown DMG fork entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `dmg-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'dmg',
    label: 'Apple DMG disk image',
    mediaType: 'application/x-apple-diskimage',
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
    return prefixLooksSupported(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'udif-koly-trailer-in-probe-window' }
      : { confidence: 0, kind: 'structure', note: 'udif-trailer-not-in-probe-window' }
  },
  async inspect(bytes, context) {
    const image = parseDmg(bytes, context.budget)
    return {
      summary: {
        format: 'dmg',
        version: image.version,
        sectors: image.sectorCount,
        entries: image.entries.length,
        imageVariant: image.imageVariant,
      },
      metadata: [
        {
          id: 'udif-trailer',
          label: 'UDIF trailer',
          entries: [
            { key: 'version', value: image.version },
            { key: 'flags', value: image.flags },
            { key: 'imageVariant', value: image.imageVariant },
            { key: 'sectorCount', value: image.sectorCount },
            { key: 'dataChecksumType', value: image.dataChecksumType },
            { key: 'dataChecksumBits', value: image.dataChecksumBits },
            { key: 'masterChecksumType', value: image.masterChecksumType },
            { key: 'masterChecksumBits', value: image.masterChecksumBits },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: image.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Apple DMG',
          preview: `UDIF v${image.version}, ${image.sectorCount} sectors`,
          children: image.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(image, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = image.entries.find(candidate => candidate.id === input.entryId)
          if (entry === undefined) throw new TypeError('DMG fork entry was not found')
          return { kind: 'bytes', value: bytes.slice(entry.offset, entry.offset + entry.size) }
        },
      },
      maxDecodedBytes: BigInt(Math.max(...image.entries.map(entry => entry.size))),
      unsupportedFeatures: [
        'udif-blkx-disk-reconstruction-and-decompression',
        'partition-and-filesystem-walking',
        'segmented-and-encrypted-dmg-images',
        'dmg-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
