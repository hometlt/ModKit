import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/m4a'
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta'])

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function walkBoxes(bytes, start, end, depth, state, budget) {
  if (depth > budget.maxDepth) throw new RangeError('M4A box tree exceeds maxDepth budget')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const boxes = []
  let offset = start
  while (offset < end) {
    if (offset + 8 > end) throw new RangeError('M4A box header is truncated')
    let size = view.getUint32(offset, false)
    const type = ascii(bytes, offset + 4, 4)
    let headerBytes = 8
    if (!/^[\x20-\x7e]{4}$/u.test(type)) throw new TypeError('M4A box type is not printable ASCII')
    if (size === 1) {
      if (offset + 16 > end) throw new RangeError('M4A extended box header is truncated')
      const extended = view.getBigUint64(offset + 8, false)
      if (extended > BigInt(Number.MAX_SAFE_INTEGER))
        throw new RangeError('M4A box size exceeds the safe integer range')
      size = Number(extended)
      headerBytes = 16
    } else if (size === 0) size = end - offset
    if (size < headerBytes || offset + size > end)
      throw new RangeError(`M4A ${type} box is outside its parent`)
    state.nodes += 1
    if (state.nodes > budget.maxNodes) throw new RangeError('M4A boxes exceed maxNodes budget')
    const dataOffset = offset + headerBytes
    const dataEnd = offset + size
    const children = CONTAINERS.has(type)
      ? walkBoxes(bytes, dataOffset, dataEnd, depth + 1, state, budget)
      : Object.freeze([])
    boxes.push(Object.freeze({ type, offset, size, headerBytes, dataOffset, dataEnd, children }))
    offset = dataEnd
  }
  return Object.freeze(boxes)
}

function flatten(boxes) {
  return boxes.flatMap(box => [box, ...flatten(box.children)])
}

function parseM4a(bytes, budget) {
  if (bytes.byteLength < 24) throw new RangeError('M4A file is truncated')
  const state = { nodes: 0 }
  const boxes = walkBoxes(bytes, 0, bytes.byteLength, 1, state, budget)
  const all = flatten(boxes)
  const ftyp = boxes[0]
  if (ftyp?.type !== 'ftyp' || ftyp.size < 16)
    throw new TypeError('M4A requires an initial ftyp box')
  const brands = []
  brands.push(ascii(bytes, ftyp.dataOffset, 4))
  for (let offset = ftyp.dataOffset + 8; offset + 4 <= ftyp.dataEnd; offset += 4)
    brands.push(ascii(bytes, offset, 4))
  const moov = boxes.find(box => box.type === 'moov')
  const mdat = boxes.find(box => box.type === 'mdat')
  const mdhd = all.find(box => box.type === 'mdhd')
  const hdlr = all.find(box => box.type === 'hdlr')
  const stsd = all.find(box => box.type === 'stsd')
  if (moov === undefined || mdat === undefined || mdhd === undefined || hdlr === undefined || stsd === undefined)
    throw new TypeError('M4A lacks moov/mdat or required audio sample tables')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mdhd.size < 32 || bytes[mdhd.dataOffset] !== 0)
    throw new TypeError('M4A supports only version-0 mdhd boxes')
  const timescale = view.getUint32(mdhd.dataOffset + 12, false)
  const duration = view.getUint32(mdhd.dataOffset + 16, false)
  const handlerType = ascii(bytes, hdlr.dataOffset + 8, 4)
  if (timescale < 1 || handlerType !== 'soun')
    throw new TypeError('M4A audio timescale/handler is invalid')
  if (stsd.size < 16 || view.getUint32(stsd.dataOffset + 4, false) !== 1)
    throw new TypeError('M4A requires exactly one audio sample description')
  const entry = stsd.dataOffset + 8
  if (entry + 36 > stsd.dataEnd) throw new RangeError('M4A audio sample entry is truncated')
  const entrySize = view.getUint32(entry, false)
  const codec = ascii(bytes, entry + 4, 4)
  if (codec !== 'mp4a' || entrySize < 36 || entry + entrySize > stsd.dataEnd)
    throw new TypeError('M4A sample entry is not a bounded mp4a entry')
  const channels = view.getUint16(entry + 24, false)
  const bitsPerSample = view.getUint16(entry + 26, false)
  const sampleRateFixed = view.getUint32(entry + 32, false)
  const sampleRate = sampleRateFixed / 65_536
  if (channels < 1 || bitsPerSample < 1 || !Number.isInteger(sampleRate) || sampleRate < 1)
    throw new TypeError('M4A mp4a channel/sample metadata is invalid')
  if (all.length * 48 > budget.maxScalarBytes)
    throw new RangeError('M4A box metadata exceeds maxScalarBytes budget')
  return Object.freeze({
    boxes,
    all: Object.freeze(all),
    brands: Object.freeze(brands),
    mdat,
    codec,
    channels,
    bitsPerSample,
    sampleRate,
    timescale,
    duration,
    durationMs: Math.round((duration / timescale) * 1000),
  })
}

function treeBox(box) {
  return {
    kind: box.children.length === 0 ? 'box' : 'container',
    label: box.type,
    preview: `${box.size} bytes at ${box.offset}`,
    children: box.children.map(treeBox),
  }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'm4a', label: 'AAC (M4A/MP4)', mediaType: 'audio/mp4' }),
  async detect(prefix) {
    if (prefix.byteLength < 16 || ascii(prefix, 4, 4) !== 'ftyp')
      return { confidence: 0, kind: 'structure', note: 'ISO BMFF ftyp missing' }
    const type = ascii(prefix, 8, 4)
    const hasMp4a = ascii(prefix, 0, prefix.byteLength).includes('mp4a')
    return hasMp4a
      ? { confidence: 0.995, kind: 'structure', note: `ISO BMFF ${type} with mp4a` }
      : { confidence: 0.45, kind: 'structure', note: `ISO BMFF ${type} without mp4a probe` }
  },
  async inspect(bytes, context) {
    const parsed = parseM4a(bytes, context.budget)
    const audio = createAudioMediaSource(bytes, 'audio/mp4', {
      durationMs: parsed.durationMs,
      seekable: true,
      tracks: [
        {
          id: 'mp4a-0',
          codec: 'aac',
          channels: parsed.channels,
          sampleRate: parsed.sampleRate,
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'M4A',
      preview: `${parsed.sampleRate} Hz, ${parsed.channels} channel(s), ${parsed.durationMs} ms`,
      children: parsed.boxes.map(treeBox),
    })
    return {
      summary: {
        format: 'm4a',
        container: 'iso-bmff',
        majorBrand: parsed.brands[0],
        compatibleBrands: parsed.brands.slice(1),
        codec: parsed.codec,
        channels: parsed.channels,
        bitsPerSample: parsed.bitsPerSample,
        sampleRate: parsed.sampleRate,
        durationMs: parsed.durationMs,
        boxes: parsed.all.length,
        mediaBytes: parsed.mdat.size - parsed.mdat.headerBytes,
      },
      metadata: [
        {
          id: 'm4a-audio-track',
          label: 'M4A audio track',
          entries: [
            { key: 'brands', value: parsed.brands.join(', ') },
            { key: 'codec', value: parsed.codec },
            { key: 'channels', value: parsed.channels },
            { key: 'bitsPerSample', value: parsed.bitsPerSample },
            { key: 'sampleRate', value: parsed.sampleRate },
            { key: 'timescale', value: parsed.timescale },
            { key: 'duration', value: parsed.duration },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: 1, codec: 'aac' } },
        { id: 'media.duration', parameters: { milliseconds: parsed.durationMs } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: [
        'pcm-decoding',
        'multiple-audio-tracks-and-edit-lists',
        'encrypted-samples-and-fragmented-mp4',
        'sample-table-indexing-and-tag-metadata',
        'writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
