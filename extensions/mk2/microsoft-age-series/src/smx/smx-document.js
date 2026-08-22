// AoE II DE SMX framing follows the openage reverse-engineered specification:
// https://github.com/SFTtech/openage/blob/master/doc/media/smx-files.md

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/smx'
const HEADER_BYTES = 32
const FRAME_HEADER_BYTES = 6
const LAYER_HEADER_BYTES = 16
const LAYERS = Object.freeze([
  Object.freeze({ mask: 0x01, name: 'main', splitStreams: true }),
  Object.freeze({ mask: 0x02, name: 'shadow', splitStreams: false }),
  Object.freeze({ mask: 0x04, name: 'outline', splitStreams: false }),
])

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function checkedRange(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength ||
    length > bytes.byteLength - offset
  ) {
    throw new RangeError(`SMX ${label} is outside the file`)
  }
}

function parseLayer(bytes, offset, kind, frameIndex, budgetState, budget) {
  checkedRange(bytes, offset, LAYER_HEADER_BYTES, `frame ${frameIndex} ${kind.name} layer header`)
  const view = viewOf(bytes)
  const width = view.getUint16(offset, true)
  const height = view.getUint16(offset + 2, true)
  const hotspotX = view.getInt16(offset + 4, true)
  const hotspotY = view.getInt16(offset + 6, true)
  const length = view.getUint32(offset + 8, true)
  const unknown = view.getUint32(offset + 12, true)
  if (width === 0 || height === 0) {
    throw new TypeError(`SMX frame ${frameIndex} ${kind.name} layer dimensions are invalid`)
  }
  if (length < LAYER_HEADER_BYTES + height * 4 + 4) {
    throw new TypeError(`SMX frame ${frameIndex} ${kind.name} layer length is invalid`)
  }
  checkedRange(bytes, offset, length, `frame ${frameIndex} ${kind.name} layer`)
  const end = offset + length
  const outlineOffset = offset + LAYER_HEADER_BYTES
  checkedRange(bytes, outlineOffset, height * 4, `frame ${frameIndex} ${kind.name} outline table`)
  let cursor = outlineOffset + height * 4
  let commandBytes = 0
  let pixelBytes = 0
  if (kind.splitStreams) {
    checkedRange(bytes, cursor, 8, `frame ${frameIndex} ${kind.name} stream lengths`)
    commandBytes = view.getUint32(cursor, true)
    pixelBytes = view.getUint32(cursor + 4, true)
    cursor += 8
    if (commandBytes > end - cursor || pixelBytes > end - cursor - commandBytes) {
      throw new RangeError(`SMX frame ${frameIndex} ${kind.name} streams exceed the layer`)
    }
    cursor += commandBytes + pixelBytes
  } else {
    checkedRange(bytes, cursor, 4, `frame ${frameIndex} ${kind.name} stream length`)
    commandBytes = view.getUint32(cursor, true)
    cursor += 4
    if (commandBytes > end - cursor) {
      throw new RangeError(`SMX frame ${frameIndex} ${kind.name} stream exceeds the layer`)
    }
    cursor += commandBytes
  }
  budgetState.nodes += height + 1
  if (budgetState.nodes > budget.maxNodes) throw new RangeError('SMX layers exceed maxNodes budget')
  return Object.freeze({
    kind: kind.name,
    offset,
    length,
    width,
    height,
    hotspotX,
    hotspotY,
    unknown,
    commandBytes,
    pixelBytes,
    trailingBytes: end - cursor,
    end,
  })
}

function parseSmx(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('SMX structure exceeds maxDepth budget')
  checkedRange(bytes, 0, HEADER_BYTES, 'header')
  if (ascii(bytes, 0, 4) !== 'SMPX') throw new TypeError('SMX SMPX header is missing')
  const view = viewOf(bytes)
  const version = view.getUint16(4, true)
  const frameCount = view.getUint16(6, true)
  const compressedSize = view.getUint32(8, true)
  const sourceSize = view.getUint32(12, true)
  if (frameCount === 0) throw new TypeError('SMX frame count is zero')
  if (compressedSize !== 0 && compressedSize !== bytes.byteLength - HEADER_BYTES) {
    throw new TypeError('SMX compressed file size does not match the source')
  }
  const state = { nodes: frameCount }
  if (state.nodes > budget.maxNodes) throw new RangeError('SMX frames exceed maxNodes budget')
  const frames = []
  let cursor = HEADER_BYTES
  for (let index = 0; index < frameCount; index += 1) {
    checkedRange(bytes, cursor, FRAME_HEADER_BYTES, `frame ${index} header`)
    const frameType = bytes[cursor]
    const palette = bytes[cursor + 1]
    const uncompressedSize = view.getUint32(cursor + 2, true)
    cursor += FRAME_HEADER_BYTES
    const layers = []
    for (const kind of LAYERS) {
      if ((frameType & kind.mask) === 0) continue
      const layer = parseLayer(bytes, cursor, kind, index, state, budget)
      layers.push(layer)
      cursor = layer.end
    }
    if (layers.length === 0) throw new TypeError(`SMX frame ${index} declares no sprite layers`)
    frames.push(
      Object.freeze({
        index,
        frameType,
        palette,
        compression: (frameType & 0x08) === 0 ? '4plus1' : '8to5',
        uncompressedSize,
        layers: Object.freeze(layers),
      }),
    )
  }
  if (cursor !== bytes.byteLength) throw new TypeError('SMX has trailing bytes after its frames')
  const scalarBytes = HEADER_BYTES + state.nodes * 112
  if (scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('SMX metadata exceeds maxScalarBytes budget')
  }
  return Object.freeze({
    version,
    compressedSize,
    sourceSize,
    frames: Object.freeze(frames),
    scalarBytes,
  })
}

export function createSmxCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'smx', label: 'AoE2 DE SMX sprite' }),
      async detect(prefix) {
        return prefix.byteLength >= 4 && ascii(prefix, 0, 4) === 'SMPX'
          ? { confidence: 0.99, kind: 'magic', note: 'SMPX sprite header' }
          : { confidence: 0, kind: 'magic', note: 'smx-signature-mismatch' }
      },
      async inspect(bytes, inspectionContext) {
        const smx = parseSmx(bytes, inspectionContext.budget)
        const layerCount = smx.frames.reduce((sum, frame) => sum + frame.layers.length, 0)
        const compressions = [...new Set(smx.frames.map(frame => frame.compression))]
        const summary = {
          format: 'smx',
          version: smx.version,
          frames: smx.frames.length,
          layers: layerCount,
          encodings: compressions.join(', '),
          sourceBytes: smx.sourceSize,
        }
        return {
          summary,
          metadata: [
            {
              id: 'smx-sprite',
              label: 'AoE2 DE SMX sprite',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'image.frames', parameters: { count: smx.frames.length } },
            { id: 'image.palette', parameters: { indexed: true } },
            { id: 'structure.layers', parameters: { count: layerCount } },
            { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'image',
              label: `SMX v${smx.version}`,
              preview: `${smx.frames.length} frame(s), ${layerCount} layer(s)`,
              children: smx.frames.map(frame => ({
                kind: 'frame',
                label: `Frame ${frame.index}`,
                preview: `palette ${frame.palette}, ${frame.compression}, ${frame.layers.length} layer(s)`,
                children: frame.layers.map(layer => ({
                  kind: 'layer',
                  label: layer.kind,
                  preview: `${layer.width} × ${layer.height}, ${layer.length} bytes`,
                })),
              })),
            }),
          },
          maxDecodedBytes: BigInt(smx.scalarBytes),
          unsupportedFeatures: [
            'palette-resolution',
            'command-stream-pixel-decoding',
            'smx-writing',
          ],
        }
      },
    }),
    context,
  )
}
