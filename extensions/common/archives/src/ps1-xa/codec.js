import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ps1-xa'
const SECTOR_BYTES = 2336
const SUBHEADER_BYTES = 8

const EDC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xd8018001 : 0)
    }
    table[index] = value >>> 0
  }
  return table
})()

function edc32(bytes) {
  let edc = 0
  for (const byte of bytes) edc = ((edc >>> 8) ^ (EDC_TABLE[(edc ^ byte) & 0xff] ?? 0)) >>> 0
  return edc
}

function u32(bytes, offset, label) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new TypeError(`PlayStation XA ${label} is truncated`)
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function subheaderMatches(bytes, offset = 0) {
  if (offset < 0 || offset + SUBHEADER_BYTES > bytes.byteLength) return false
  for (let index = 0; index < 4; index += 1) {
    if (bytes[offset + index] !== bytes[offset + 4 + index]) return false
  }
  const media = (bytes[offset + 2] ?? 0) & 0x0e
  return media === 0x02 || media === 0x04 || media === 0x08
}

function sectorKind(submode) {
  const media = submode & 0x0e
  if (media === 0x02) return 'video'
  if (media === 0x04) return 'audio'
  if (media === 0x08) return 'data'
  throw new TypeError('CD-XA sector submode must select exactly one media kind')
}

function parseXa(bytes, budget) {
  if (bytes.byteLength === 0 || bytes.byteLength % SECTOR_BYTES !== 0) {
    throw new TypeError('PlayStation XA stream is not an exact sequence of 2336-byte sectors')
  }
  const count = bytes.byteLength / SECTOR_BYTES
  if (count > budget.maxNodes)
    throw new RangeError('PlayStation XA sector count exceeds maxNodes budget')
  if (SECTOR_BYTES > budget.maxScalarBytes) {
    throw new RangeError('PlayStation XA sector exceeds maxScalarBytes budget')
  }
  const sectors = []
  for (let index = 0; index < count; index += 1) {
    const offset = index * SECTOR_BYTES
    if (!subheaderMatches(bytes, offset)) {
      throw new TypeError(`PlayStation XA sector ${index} has an invalid duplicated subheader`)
    }
    const fileNumber = bytes[offset] ?? 0
    const channelNumber = bytes[offset + 1] ?? 0
    const submode = bytes[offset + 2] ?? 0
    const codingInfo = bytes[offset + 3] ?? 0
    const form = (submode & 0x20) === 0 ? 1 : 2
    const edcOffset = offset + (form === 1 ? 2056 : 2332)
    const expectedEdc = u32(bytes, edcOffset, `sector ${index} EDC`)
    const actualEdc = edc32(bytes.subarray(offset, edcOffset))
    if (actualEdc !== expectedEdc) {
      throw new TypeError(`PlayStation XA sector ${index} EDC is invalid`)
    }
    sectors.push(
      Object.freeze({
        id: `sector-${index}`,
        path: `sector-${String(index).padStart(6, '0')}.xa`,
        offset,
        fileNumber,
        channelNumber,
        submode,
        codingInfo,
        kind: sectorKind(submode),
        form,
        edc: expectedEdc,
      }),
    )
  }
  return Object.freeze(sectors)
}

function namespaceSource(sectors, source) {
  const byId = new Map(sectors.map(sector => [sector.id, sector]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('PlayStation XA namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) {
        throw new TypeError('invalid PlayStation XA page cursor')
      }
      const matching = sectors.filter(sector => sector.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(sector =>
        Object.freeze({
          id: sector.id,
          path: sector.path,
          name: sector.path,
          kind: 'file',
          size: BigInt(SECTOR_BYTES),
          storedSize: BigInt(SECTOR_BYTES),
          compression: 'stored-sector',
          checksum: {
            algorithm: 'cd-rom-edc',
            value: sector.edc.toString(16).padStart(8, '0'),
          },
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
      const sector = byId.get(entryId)
      if (sector === undefined) throw new TypeError('unknown PlayStation XA sector entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${sector.path}`,
          uri: `ps1-xa-entry:${encodeURIComponent(source.ref.uri)}!/${sector.path}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'ps1-xa',
    label: 'PlayStation XA indexed stream',
    mediaType: 'application/x-cd-xa',
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
    return subheaderMatches(prefix)
      ? { confidence: 0.92, kind: 'structure', note: 'cd-xa-duplicated-subheader' }
      : { confidence: 0, kind: 'structure', note: 'invalid-cd-xa-subheader' }
  },
  async inspect(bytes, context) {
    const sectors = parseXa(bytes, context.budget)
    const byId = new Map(sectors.map(sector => [sector.id, sector]))
    const kinds = Object.freeze({
      audio: sectors.filter(sector => sector.kind === 'audio').length,
      video: sectors.filter(sector => sector.kind === 'video').length,
      data: sectors.filter(sector => sector.kind === 'data').length,
    })
    const form1 = sectors.filter(sector => sector.form === 1).length
    const form2 = sectors.length - form1
    const files = new Set(sectors.map(sector => sector.fileNumber)).size
    const channels = new Set(sectors.map(sector => sector.channelNumber)).size
    return {
      summary: {
        format: 'ps1-xa',
        sectors: sectors.length,
        sectorBytes: SECTOR_BYTES,
        audioSectors: kinds.audio,
        videoSectors: kinds.video,
        dataSectors: kinds.data,
      },
      metadata: [
        {
          id: 'cd-xa-stream',
          label: 'CD-XA sector stream',
          entries: [
            { key: 'sectors', value: sectors.length },
            { key: 'sectorBytes', value: SECTOR_BYTES },
            { key: 'fileNumbers', value: files },
            { key: 'channelNumbers', value: channels },
            { key: 'audioSectors', value: kinds.audio },
            { key: 'videoSectors', value: kinds.video },
            { key: 'dataSectors', value: kinds.data },
            { key: 'form1Sectors', value: form1 },
            { key: 'form2Sectors', value: form2 },
            { key: 'validatedEdcSectors', value: sectors.length },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: sectors.length } },
        { id: 'container.compression', parameters: { methods: ['stored-sector'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'PlayStation XA',
          preview: `${sectors.length} CD-XA sectors (${kinds.audio} audio, ${kinds.video} video, ${kinds.data} data)`,
          children: sectors.map(sector => ({
            kind: 'file',
            label: sector.path,
            preview: `${sector.kind} Form ${sector.form}, file ${sector.fileNumber}, channel ${sector.channelNumber}, EDC ${sector.edc.toString(16).padStart(8, '0')}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(sectors, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const sector = byId.get(String(input.entryId ?? ''))
          if (sector === undefined) throw new TypeError('PlayStation XA sector entry was not found')
          return {
            kind: 'bytes',
            value: bytes.slice(sector.offset, sector.offset + SECTOR_BYTES),
          }
        },
      },
      maxDecodedBytes: BigInt(bytes.byteLength),
      unsupportedFeatures: [
        'westwood-fat-entry-names-and-file-boundaries',
        'cd-xa-audio-video-and-data-decoding',
        'full-2352-byte-raw-sectors',
        'ps1-xa-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
