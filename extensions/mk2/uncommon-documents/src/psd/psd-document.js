// Adobe Photoshop File Formats Specification: all five top-level sections, Image Resource
// Blocks, layer records/channel payloads, and the flattened composite framing are validated.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/psd'
const ascii = new TextDecoder('latin1')
const COLOR_MODES = Object.freeze({
  0: 'bitmap',
  1: 'grayscale',
  2: 'indexed',
  3: 'rgb',
  4: 'cmyk',
  7: 'multichannel',
  8: 'duotone',
  9: 'lab',
})
const COMPRESSIONS = Object.freeze({ 0: 'raw', 1: 'rle', 2: 'zip', 3: 'zip-prediction' })

function text(bytes, offset, length) {
  return ascii.decode(bytes.subarray(offset, offset + length))
}

function safeLength(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} is not a safe length`)
  return Number(value)
}

class Reader {
  constructor(bytes, start = 0, end = bytes.byteLength) {
    this.bytes = bytes
    this.offset = start
    this.end = end
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  need(length, label) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.end) {
      throw new TypeError(`PSD ${label} exceeds its section bounds`)
    }
  }

  u8(label) {
    this.need(1, label)
    return this.bytes[this.offset++]
  }

  u16(label) {
    this.need(2, label)
    const value = this.view.getUint16(this.offset, false)
    this.offset += 2
    return value
  }

  i16(label) {
    this.need(2, label)
    const value = this.view.getInt16(this.offset, false)
    this.offset += 2
    return value
  }

  i32(label) {
    this.need(4, label)
    const value = this.view.getInt32(this.offset, false)
    this.offset += 4
    return value
  }

  u32(label) {
    this.need(4, label)
    const value = this.view.getUint32(this.offset, false)
    this.offset += 4
    return value
  }

  u64(label) {
    this.need(8, label)
    const value = this.view.getBigUint64(this.offset, false)
    this.offset += 8
    return safeLength(value, `PSD ${label}`)
  }

  fourCc(label) {
    this.need(4, label)
    const value = text(this.bytes, this.offset, 4)
    this.offset += 4
    return value
  }

  skip(length, label) {
    this.need(length, label)
    this.offset += length
  }

  sub(length, label) {
    this.need(length, label)
    const result = new Reader(this.bytes, this.offset, this.offset + length)
    this.offset += length
    return result
  }

  finish(label) {
    if (this.offset !== this.end) throw new TypeError(`PSD ${label} has trailing bytes`)
  }
}

function charge(state, budget, nodes, scalarBytes) {
  state.nodes += nodes
  state.scalarBytes += scalarBytes
  if (state.nodes > budget.maxNodes) throw new RangeError('PSD structure exceeds maxNodes budget')
  if (state.scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('PSD metadata exceeds maxScalarBytes budget')
  }
}

function parseResources(reader, state, budget) {
  const resources = []
  while (reader.offset < reader.end) {
    const signature = reader.fourCc('image-resource signature')
    if (signature !== '8BIM' && signature !== 'MeSa') {
      throw new TypeError(`PSD image-resource signature ${signature} is invalid`)
    }
    const id = reader.u16('image-resource id')
    const nameLength = reader.u8('image-resource name length')
    reader.need(nameLength, 'image-resource name')
    const name = text(reader.bytes, reader.offset, nameLength)
    reader.skip(nameLength, 'image-resource name')
    if ((1 + nameLength) & 1) reader.skip(1, 'image-resource name padding')
    const length = reader.u32('image-resource data length')
    reader.skip(length, 'image-resource data')
    if (length & 1) reader.skip(1, 'image-resource data padding')
    charge(state, budget, 1, name.length * 2 + 48)
    resources.push(Object.freeze({ id, name, length }))
  }
  reader.finish('image-resources section')
  return Object.freeze(resources)
}

function parseTaggedBlocks(reader, version, state, budget, label) {
  const blocks = []
  while (reader.offset < reader.end) {
    if (reader.end - reader.offset < 12)
      throw new TypeError(`PSD ${label} tagged block is truncated`)
    const signature = reader.fourCc(`${label} tagged-block signature`)
    if (signature !== '8BIM' && signature !== '8B64') {
      throw new TypeError(`PSD ${label} tagged-block signature ${signature} is invalid`)
    }
    const key = reader.fourCc(`${label} tagged-block key`)
    const length =
      version === 2 && signature === '8B64'
        ? reader.u64(`${label} tagged-block length`)
        : reader.u32(`${label} tagged-block length`)
    reader.skip(length, `${label} tagged-block data`)
    if (length & 1) reader.skip(1, `${label} tagged-block padding`)
    charge(state, budget, 1, 48)
    blocks.push(Object.freeze({ signature, key, length }))
  }
  return Object.freeze(blocks)
}

function parseLayerInfo(reader, version, state, budget) {
  if (reader.offset === reader.end) return Object.freeze({ layers: [], channelBlocks: 0 })
  const length = version === 2 ? reader.u64('layer-info length') : reader.u32('layer-info length')
  if (length === 0) return Object.freeze({ layers: [], channelBlocks: 0 })
  const info = reader.sub(length, 'layer-info')
  const signedCount = info.i16('layer count')
  const count = Math.abs(signedCount)
  charge(state, budget, count, count * 64)
  const layers = []
  for (let index = 0; index < count; index += 1) {
    const top = info.i32('layer top')
    const left = info.i32('layer left')
    const bottom = info.i32('layer bottom')
    const right = info.i32('layer right')
    if (bottom < top || right < left) throw new TypeError('PSD layer rectangle is inverted')
    const channelCount = info.u16('layer channel count')
    charge(state, budget, channelCount, channelCount * 24)
    const channels = []
    for (let channel = 0; channel < channelCount; channel += 1) {
      const id = info.i16('layer channel id')
      const channelLength =
        version === 2 ? info.u64('layer channel length') : info.u32('layer channel length')
      if (channelLength < 2) throw new TypeError('PSD layer channel has no compression field')
      channels.push({ id, length: channelLength })
    }
    if (info.fourCc('layer blend signature') !== '8BIM') {
      throw new TypeError('PSD layer blend signature is invalid')
    }
    const blendMode = info.fourCc('layer blend mode')
    const opacity = info.u8('layer opacity')
    info.skip(3, 'layer flags')
    const extra = info.sub(info.u32('layer extra-data length'), 'layer extra data')
    extra.skip(extra.u32('layer-mask length'), 'layer-mask data')
    extra.skip(extra.u32('layer blending-ranges length'), 'layer blending-ranges data')
    const nameLength = extra.u8('layer name length')
    extra.need(nameLength, 'layer name')
    const name = text(extra.bytes, extra.offset, nameLength)
    extra.skip(nameLength, 'layer name')
    const usedNameBytes = 1 + nameLength
    if (usedNameBytes % 4 !== 0) extra.skip(4 - (usedNameBytes % 4), 'layer name padding')
    const taggedBlocks = parseTaggedBlocks(extra, version, state, budget, 'layer')
    extra.finish('layer extra data')
    layers.push(
      Object.freeze({
        name,
        top,
        left,
        bottom,
        right,
        blendMode,
        opacity,
        channels: Object.freeze(channels),
        taggedBlocks,
      }),
    )
  }
  let channelBlocks = 0
  for (const layer of layers) {
    for (const channel of layer.channels) {
      const payload = info.sub(channel.length, 'layer channel payload')
      const compression = payload.u16('layer channel compression')
      if (COMPRESSIONS[compression] === undefined) {
        throw new TypeError(`PSD layer channel compression ${compression} is invalid`)
      }
      payload.skip(payload.end - payload.offset, 'layer channel encoded data')
      payload.finish('layer channel payload')
      channelBlocks += 1
    }
  }
  if (info.end - info.offset === 1 && info.bytes[info.offset] === 0) {
    info.skip(1, 'layer-info padding')
  }
  info.finish('layer-info')
  return Object.freeze({ layers: Object.freeze(layers), channelBlocks })
}

function parseLayerMask(reader, version, state, budget) {
  if (reader.offset === reader.end) {
    return Object.freeze({ layers: [], channelBlocks: 0, globalMaskBytes: 0, taggedBlocks: [] })
  }
  const layerInfo = parseLayerInfo(reader, version, state, budget)
  if (reader.offset === reader.end)
    return Object.freeze({ ...layerInfo, globalMaskBytes: 0, taggedBlocks: [] })
  const globalMaskBytes = reader.u32('global layer-mask length')
  reader.skip(globalMaskBytes, 'global layer-mask data')
  const taggedBlocks = parseTaggedBlocks(reader, version, state, budget, 'global layer-mask')
  reader.finish('layer-and-mask section')
  return Object.freeze({ ...layerInfo, globalMaskBytes, taggedBlocks })
}

function validatePackBitsRow(bytes, expected) {
  let input = 0
  let output = 0
  while (input < bytes.byteLength) {
    const header = bytes[input++]
    if (header <= 127) {
      const count = header + 1
      if (input + count > bytes.byteLength)
        throw new TypeError('PSD RLE literal packet is truncated')
      input += count
      output += count
    } else if (header >= 129) {
      if (input >= bytes.byteLength) throw new TypeError('PSD RLE repeat packet is truncated')
      input += 1
      output += 257 - header
    }
    if (output > expected) throw new TypeError('PSD RLE row expands past its declared width')
  }
  if (output !== expected) throw new TypeError('PSD RLE row does not fill its declared width')
}

function parseComposite(reader, header, version, state, budget) {
  const compression = reader.u16('composite compression')
  if (COMPRESSIONS[compression] === undefined) {
    throw new TypeError(`PSD composite compression ${compression} is invalid`)
  }
  const rowBytes = Math.ceil((header.width * header.depth) / 8)
  const rows = header.height * header.channels
  const expected = rowBytes * rows
  if (!Number.isSafeInteger(expected) || expected > budget.maxScalarBytes) {
    throw new RangeError('PSD composite pixels exceed maxScalarBytes budget')
  }
  if (compression === 0) {
    if (reader.end - reader.offset !== expected) {
      throw new TypeError('PSD raw composite byte count does not match its dimensions')
    }
    reader.skip(expected, 'raw composite pixels')
  } else if (compression === 1) {
    const lengths = []
    for (let row = 0; row < rows; row += 1) {
      lengths.push(version === 2 ? reader.u32('RLE row length') : reader.u16('RLE row length'))
    }
    for (const length of lengths) {
      reader.need(length, 'RLE row data')
      validatePackBitsRow(reader.bytes.subarray(reader.offset, reader.offset + length), rowBytes)
      reader.skip(length, 'RLE row data')
    }
  } else if (reader.offset === reader.end) {
    throw new TypeError('PSD ZIP composite data is empty')
  } else {
    reader.skip(reader.end - reader.offset, 'ZIP composite data')
  }
  reader.finish('composite image data')
  charge(state, budget, 1, expected)
  return Object.freeze({
    compression,
    compressionName: COMPRESSIONS[compression],
    rowBytes,
    expected,
  })
}

function parsePsd(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('PSD structure exceeds maxDepth budget')
  const reader = new Reader(bytes)
  if (bytes.byteLength < 26 || reader.fourCc('signature') !== '8BPS') {
    throw new TypeError('PSD/PSB file header is missing')
  }
  const version = reader.u16('version')
  if (version !== 1 && version !== 2) throw new TypeError(`PSD version ${version} is invalid`)
  for (let index = 0; index < 6; index += 1) {
    if (reader.u8('reserved header bytes') !== 0)
      throw new TypeError('PSD reserved header bytes are non-zero')
  }
  const channels = reader.u16('channel count')
  const height = reader.u32('height')
  const width = reader.u32('width')
  const depth = reader.u16('bit depth')
  const colorMode = reader.u16('color mode')
  const maximum = version === 1 ? 30_000 : 300_000
  if (channels < 1 || channels > 56) throw new TypeError('PSD channel count is outside 1..56')
  if (width < 1 || height < 1 || width > maximum || height > maximum) {
    throw new TypeError('PSD dimensions are invalid for its version')
  }
  if (![1, 8, 16, 32].includes(depth)) throw new TypeError(`PSD bit depth ${depth} is invalid`)
  if (COLOR_MODES[colorMode] === undefined)
    throw new TypeError(`PSD color mode ${colorMode} is invalid`)
  const state = { nodes: 5, scalarBytes: 160 }
  charge(state, budget, 0, 0)
  const colorDataLength = reader.u32('color-mode data length')
  reader.skip(colorDataLength, 'color-mode data')
  const resourcesLength = reader.u32('image-resources length')
  const resources = parseResources(reader.sub(resourcesLength, 'image-resources'), state, budget)
  const layerMaskLength =
    version === 2 ? reader.u64('layer-and-mask length') : reader.u32('layer-and-mask length')
  const layerMask = parseLayerMask(
    reader.sub(layerMaskLength, 'layer-and-mask section'),
    version,
    state,
    budget,
  )
  const header = { channels, height, width, depth, colorMode }
  const composite = parseComposite(
    reader.sub(reader.end - reader.offset, 'composite image data'),
    header,
    version,
    state,
    budget,
  )
  reader.finish('file')
  return Object.freeze({
    version,
    header: Object.freeze(header),
    colorDataLength,
    resourcesLength,
    resources,
    layerMaskLength,
    layerMask,
    composite,
    decodedBytes: state.scalarBytes,
  })
}

function detect(prefix) {
  if (prefix.byteLength < 6 || text(prefix, 0, 4) !== '8BPS') {
    return { confidence: 0, kind: 'magic', note: 'psd-signature-missing' }
  }
  const version = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint16(
    4,
    false,
  )
  if (version !== 1 && version !== 2)
    return { confidence: 0, kind: 'structure', note: 'psd-version-invalid' }
  if (prefix.byteLength < 26)
    return { confidence: 0.92, kind: 'magic', note: `psd-v${version}-header-prefix` }
  const reserved = prefix.subarray(6, 12).every(value => value === 0)
  return reserved
    ? { confidence: 0.995, kind: 'structure', note: version === 1 ? 'psd-header' : 'psb-header' }
    : { confidence: 0, kind: 'structure', note: 'psd-reserved-bytes-invalid' }
}

export function createPsdCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: ID,
      format: Object.freeze({
        id: 'psd',
        label: 'Adobe Photoshop Document',
        mediaType: 'image/vnd.adobe.photoshop',
      }),
      async detect(prefix) {
        return detect(prefix)
      },
      async inspect(bytes, inspectionContext) {
        const psd = parsePsd(bytes, inspectionContext.budget)
        const summary = {
          format: 'psd',
          variant: psd.version === 1 ? 'PSD' : 'PSB',
          version: psd.version,
          width: psd.header.width,
          height: psd.header.height,
          channels: psd.header.channels,
          bitDepth: psd.header.depth,
          colorMode: COLOR_MODES[psd.header.colorMode],
          resources: psd.resources.length,
          layers: psd.layerMask.layers.length,
          channelBlocks: psd.layerMask.channelBlocks,
          compression: psd.composite.compressionName,
        }
        const raster = createRasterImageSource(bytes, 'image/vnd.adobe.photoshop', {
          width: summary.width,
          height: summary.height,
          depth: 1,
          layers: Math.max(1, summary.layers),
          faces: 1,
          mipLevels: 1,
          frames: 1,
          channels: summary.channels,
          bitDepth: summary.bitDepth,
          colorSpace: summary.colorMode,
          alphaMode: summary.channels === 2 || summary.channels === 4 ? 'straight' : 'none',
          orientation: 'top-left',
          decodedAccess: false,
        })
        const tree = createTreeDataSource({
          kind: 'image',
          label: summary.variant,
          preview: `${summary.width} × ${summary.height}, ${summary.layers} layer(s)`,
          children: [
            { kind: 'section', label: 'Color mode data', preview: `${psd.colorDataLength} bytes` },
            {
              kind: 'section',
              label: 'Image resources',
              preview: `${psd.resources.length} block(s)`,
              children: psd.resources.map(resource => ({
                kind: 'resource',
                label: resource.name || `Resource ${resource.id}`,
                preview: `ID ${resource.id}, ${resource.length} bytes`,
              })),
            },
            {
              kind: 'section',
              label: 'Layers and masks',
              preview: `${summary.layers} layer(s), ${psd.layerMaskLength} bytes`,
              children: psd.layerMask.layers.map((layer, index) => ({
                kind: 'layer',
                label: layer.name || `Layer ${index + 1}`,
                preview: `${layer.right - layer.left} × ${layer.bottom - layer.top}, ${layer.channels.length} channel(s)`,
              })),
            },
            {
              kind: 'section',
              label: 'Composite image data',
              preview: `${summary.compression}, ${psd.composite.expected} decoded byte(s)`,
            },
          ],
        })
        return {
          summary,
          metadata: [
            {
              id: 'psd-document',
              label: 'Photoshop document',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            {
              id: 'image.raster',
              parameters: {
                width: summary.width,
                height: summary.height,
                bitDepth: summary.bitDepth,
              },
            },
            {
              id: 'image.channels',
              parameters: {
                count: summary.channels,
                alpha: summary.channels === 2 || summary.channels === 4,
              },
            },
            {
              id: 'structure.hierarchy',
              parameters: { layers: summary.layers, resources: summary.resources },
            },
            {
              id: 'content.binary',
              parameters: { variant: summary.variant, compression: summary.compression },
            },
          ],
          dataSources: {
            'common.view/raster-image-source': raster,
            'common.view/tree-data-source': tree,
          },
          maxDecodedBytes: psd.decodedBytes,
          unsupportedFeatures: [
            'zip-composite-inflation',
            'layer-pixel-compositing',
            'colour-profile-conversion',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
