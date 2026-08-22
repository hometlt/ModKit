// AoE II DE SLD framing and layer command records follow the openage specification:
// https://github.com/SFTtech/openage/blob/master/doc/media/sld-files.md

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/sld'
const HEADER_BYTES = 16
const FRAME_HEADER_BYTES = 12
const LAYER_FLAGS = Object.freeze([
  Object.freeze({ mask: 0x01, name: 'main' }),
  Object.freeze({ mask: 0x02, name: 'shadow' }),
  Object.freeze({ mask: 0x04, name: 'unknown' }),
  Object.freeze({ mask: 0x08, name: 'damage' }),
  Object.freeze({ mask: 0x10, name: 'player-color' }),
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
    throw new RangeError(`SLD ${label} is outside the file`)
  }
}

function parseMainLayer(bytes, offset, end, frame, frameIndex) {
  const view = viewOf(bytes)
  checkedRange(bytes, offset, 12, `frame ${frameIndex} main layer graphics header`)
  if (offset + 12 > end)
    throw new TypeError(`SLD frame ${frameIndex} main layer header is truncated`)
  const x1 = view.getUint16(offset, true)
  const y1 = view.getUint16(offset + 2, true)
  const x2 = view.getUint16(offset + 4, true)
  const y2 = view.getUint16(offset + 6, true)
  const flags = bytes[offset + 8]
  const unknown = bytes[offset + 9]
  const commandCount = view.getUint16(offset + 10, true)
  if (x2 <= x1 || y2 <= y1 || x2 > frame.width || y2 > frame.height) {
    throw new TypeError(`SLD frame ${frameIndex} main layer rectangle is invalid`)
  }
  const blockWidth = Math.ceil((x2 - x1) / 4)
  const blockHeight = Math.ceil((y2 - y1) / 4)
  const blockCount = blockWidth * blockHeight
  const commandsOffset = offset + 12
  if (commandsOffset + commandCount * 2 > end) {
    throw new TypeError(`SLD frame ${frameIndex} main layer command table is truncated`)
  }
  let blockCursor = 0
  let drawCount = 0
  const commands = []
  for (let index = 0; index < commandCount; index += 1) {
    const skip = bytes[commandsOffset + index * 2]
    const draw = bytes[commandsOffset + index * 2 + 1]
    const firstSkip = blockCursor
    blockCursor += skip
    if (blockCursor + draw > blockCount) {
      throw new TypeError(`SLD frame ${frameIndex} main layer commands exceed its rectangle`)
    }
    commands.push(
      Object.freeze({ firstSkip, skip, draw, firstBlock: blockCursor, firstDraw: drawCount }),
    )
    blockCursor += draw
    drawCount += draw
  }
  if (blockCursor !== blockCount) {
    throw new TypeError(`SLD frame ${frameIndex} main layer commands do not cover its rectangle`)
  }
  const pixelsOffset = commandsOffset + commandCount * 2
  const pixelBytes = drawCount * 8
  if (pixelsOffset + pixelBytes > end) {
    throw new TypeError(`SLD frame ${frameIndex} main DXT1 blocks are truncated`)
  }
  return Object.freeze({
    x1,
    y1,
    x2,
    y2,
    flags,
    unknown,
    commandCount,
    blockWidth,
    blockHeight,
    blockCount,
    drawCount,
    pixelsOffset,
    pixelBytes,
    commands: Object.freeze(commands),
  })
}

function parseSld(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('SLD structure exceeds maxDepth budget')
  checkedRange(bytes, 0, HEADER_BYTES, 'header')
  if (ascii(bytes, 0, 4) !== 'SLDX') throw new TypeError('SLD SLDX header is missing')
  const view = viewOf(bytes)
  const version = view.getUint16(4, true)
  const frameCount = view.getUint16(6, true)
  const unknown1 = view.getUint16(8, true)
  const unknown2 = view.getUint16(10, true)
  const unknown3 = view.getUint32(12, true)
  if (frameCount === 0) throw new TypeError('SLD frame count is zero')
  let nodes = frameCount
  if (nodes > budget.maxNodes) throw new RangeError('SLD frames exceed maxNodes budget')
  let cursor = HEADER_BYTES
  const frames = []
  let maxWidth = 0
  let maxHeight = 0
  let maximumFrameBytes = 0
  let totalDecodedBytes = 0n
  for (let index = 0; index < frameCount; index += 1) {
    checkedRange(bytes, cursor, FRAME_HEADER_BYTES, `frame ${index} header`)
    const width = view.getUint16(cursor, true)
    const height = view.getUint16(cursor + 2, true)
    const hotspotX = view.getInt16(cursor + 4, true)
    const hotspotY = view.getInt16(cursor + 6, true)
    const frameType = bytes[cursor + 8]
    const unknown = bytes[cursor + 9]
    const frameNumber = view.getUint16(cursor + 10, true)
    if (width === 0 || height === 0)
      throw new TypeError(`SLD frame ${index} dimensions are invalid`)
    const decodedBytes = width * height * 4
    if (!Number.isSafeInteger(decodedBytes))
      throw new RangeError('SLD decoded frame size overflows')
    maximumFrameBytes = Math.max(maximumFrameBytes, decodedBytes)
    totalDecodedBytes += BigInt(decodedBytes)
    maxWidth = Math.max(maxWidth, width)
    maxHeight = Math.max(maxHeight, height)
    cursor += FRAME_HEADER_BYTES
    const layers = []
    const frame = { width, height }
    for (const layerFlag of LAYER_FLAGS) {
      if ((frameType & layerFlag.mask) === 0) continue
      checkedRange(bytes, cursor, 4, `frame ${index} ${layerFlag.name} layer length`)
      const contentLength = view.getUint32(cursor, true)
      if (contentLength < 4) {
        throw new TypeError(`SLD frame ${index} ${layerFlag.name} layer length is invalid`)
      }
      const paddedLength = (contentLength + 3) & ~3
      checkedRange(bytes, cursor, paddedLength, `frame ${index} ${layerFlag.name} layer`)
      const contentEnd = cursor + contentLength
      const main =
        layerFlag.name === 'main'
          ? parseMainLayer(bytes, cursor + 4, contentEnd, frame, index)
          : undefined
      layers.push(
        Object.freeze({
          kind: layerFlag.name,
          offset: cursor,
          contentLength,
          paddedLength,
          ...(main === undefined ? {} : { main }),
        }),
      )
      cursor += paddedLength
    }
    if (!layers.some(layer => layer.kind === 'main')) {
      throw new TypeError(`SLD frame ${index} has no decodable main layer`)
    }
    nodes += layers.length
    if (nodes > budget.maxNodes) throw new RangeError('SLD layers exceed maxNodes budget')
    frames.push(
      Object.freeze({
        index,
        width,
        height,
        hotspotX,
        hotspotY,
        frameType,
        unknown,
        frameNumber,
        layers: Object.freeze(layers),
      }),
    )
  }
  if (cursor !== bytes.byteLength) throw new TypeError('SLD has trailing bytes after its frames')
  if (maximumFrameBytes > budget.maxScalarBytes) {
    throw new RangeError('SLD decoded frame exceeds maxScalarBytes budget')
  }
  return Object.freeze({
    version,
    unknown1,
    unknown2,
    unknown3,
    frames: Object.freeze(frames),
    maxWidth,
    maxHeight,
    totalDecodedBytes,
  })
}

function expand565(value) {
  return [
    Math.round((((value >>> 11) & 0x1f) * 255) / 31),
    Math.round((((value >>> 5) & 0x3f) * 255) / 63),
    Math.round(((value & 0x1f) * 255) / 31),
    255,
  ]
}

function dxt1Palette(first, second) {
  const a = expand565(first)
  const b = expand565(second)
  if (first > second) {
    return [
      a,
      b,
      [
        Math.round((2 * a[0] + b[0]) / 3),
        Math.round((2 * a[1] + b[1]) / 3),
        Math.round((2 * a[2] + b[2]) / 3),
        255,
      ],
      [
        Math.round((a[0] + 2 * b[0]) / 3),
        Math.round((a[1] + 2 * b[1]) / 3),
        Math.round((a[2] + 2 * b[2]) / 3),
        255,
      ],
    ]
  }
  return [
    a,
    b,
    [
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
      255,
    ],
    [0, 0, 0, 0],
  ]
}

function decodeDxt1Block(bytes, offset, output, canvasWidth, canvasHeight, x, y) {
  const view = viewOf(bytes)
  const palette = dxt1Palette(view.getUint16(offset, true), view.getUint16(offset + 2, true))
  const indices = view.getUint32(offset + 4, true)
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const targetX = x + (pixel & 3)
    const targetY = y + (pixel >>> 2)
    if (targetX >= canvasWidth || targetY >= canvasHeight) continue
    output.set(palette[(indices >>> (pixel * 2)) & 3], (targetY * canvasWidth + targetX) * 4)
  }
}

function copyBlock(previous, previousWidth, output, width, height, x, y) {
  for (let row = 0; row < 4; row += 1) {
    const targetY = y + row
    if (targetY >= height || targetY >= previous.length / previousWidth / 4) continue
    for (let column = 0; column < 4; column += 1) {
      const targetX = x + column
      if (targetX >= width || targetX >= previousWidth) continue
      const source = (targetY * previousWidth + targetX) * 4
      output.set(previous.subarray(source, source + 4), (targetY * width + targetX) * 4)
    }
  }
}

function decodeFrame(bytes, frame, previousFrame, previousPixels) {
  const output = new Uint8Array(frame.width * frame.height * 4)
  const layer = frame.layers.find(item => item.kind === 'main')?.main
  if (layer === undefined) throw new TypeError(`SLD frame ${frame.index} has no main layer`)
  const reusesPrevious = (layer.flags & 0x80) !== 0
  if (reusesPrevious && (previousFrame === undefined || previousPixels === undefined)) {
    throw new TypeError(`SLD frame ${frame.index} cannot reuse a missing previous frame`)
  }
  let encodedBlock = 0
  for (const command of layer.commands) {
    if (reusesPrevious && previousFrame !== undefined && previousPixels !== undefined) {
      for (let skip = 0; skip < command.skip; skip += 1) {
        const block = command.firstSkip + skip
        const blockX = block % layer.blockWidth
        const blockY = Math.floor(block / layer.blockWidth)
        copyBlock(
          previousPixels,
          previousFrame.width,
          output,
          frame.width,
          frame.height,
          layer.x1 + blockX * 4,
          layer.y1 + blockY * 4,
        )
      }
    }
    for (let draw = 0; draw < command.draw; draw += 1) {
      const block = command.firstBlock + draw
      const blockX = block % layer.blockWidth
      const blockY = Math.floor(block / layer.blockWidth)
      decodeDxt1Block(
        bytes,
        layer.pixelsOffset + encodedBlock * 8,
        output,
        frame.width,
        frame.height,
        layer.x1 + blockX * 4,
        layer.y1 + blockY * 4,
      )
      encodedBlock += 1
    }
  }
  return output
}

function regionReader(bytes, sld) {
  const decoded = new Map()
  const decodedFrame = frameIndex => {
    for (let index = 0; index <= frameIndex; index += 1) {
      if (decoded.has(index)) continue
      const frame = sld.frames[index]
      decoded.set(index, decodeFrame(bytes, frame, sld.frames[index - 1], decoded.get(index - 1)))
    }
    return decoded.get(frameIndex)
  }
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('SLD region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0
    ) {
      throw new RangeError('SLD decoder exposes only rgba8 main-layer frames')
    }
    const frameIndex = request.frame ?? 0
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= sld.frames.length) {
      throw new RangeError('SLD frame is outside the sprite')
    }
    const frame = sld.frames[frameIndex]
    if (request.x + request.width > frame.width || request.y + request.height > frame.height) {
      throw new RangeError('SLD region is outside the selected frame')
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('SLD region exceeds maxBytes budget')
    }
    let pixels = decoded.get(frameIndex)
    if (pixels === undefined) {
      pixels = decodedFrame(frameIndex)
    }
    const region = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * frame.width + request.x) * 4
      region.set(pixels.subarray(start, start + request.width * 4), row * request.width * 4)
    }
    return Object.freeze({
      width: request.width,
      height: request.height,
      rowStride: request.width * 4,
      pixelFormat: 'rgba8',
      pixels: region,
    })
  }
}

export function createSldCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'sld', label: 'AoE2 DE SLD sprite layer data' }),
      async detect(prefix) {
        return prefix.byteLength >= 4 && ascii(prefix, 0, 4) === 'SLDX'
          ? { confidence: 0.99, kind: 'magic', note: 'SLDX sprite header' }
          : { confidence: 0, kind: 'magic', note: 'sld-signature-mismatch' }
      },
      async inspect(bytes, inspectionContext) {
        const sld = parseSld(bytes, inspectionContext.budget)
        const layerCount = sld.frames.reduce((sum, frame) => sum + frame.layers.length, 0)
        const summary = {
          format: 'sld',
          version: sld.version,
          frames: sld.frames.length,
          layers: layerCount,
          width: sld.maxWidth,
          height: sld.maxHeight,
          encoding: 'DXT1',
        }
        return {
          summary,
          metadata: [
            {
              id: 'sld-sprite',
              label: 'AoE2 DE SLD sprite',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            {
              id: 'image.raster',
              parameters: { width: sld.maxWidth, height: sld.maxHeight, bitDepth: 8 },
            },
            { id: 'image.channels', parameters: { count: 4, alpha: true } },
            { id: 'image.frames', parameters: { count: sld.frames.length } },
            { id: 'structure.layers', parameters: { count: layerCount } },
            {
              id: 'content.binary',
              parameters: { bytes: String(bytes.byteLength), encoding: 'DXT1' },
            },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'image',
              label: `SLD v${sld.version}`,
              preview: `${sld.frames.length} frame(s), up to ${sld.maxWidth} × ${sld.maxHeight}`,
              children: sld.frames.map(frame => ({
                kind: 'frame',
                label: `Frame ${frame.index}`,
                preview: `${frame.width} × ${frame.height}, hotspot ${frame.hotspotX},${frame.hotspotY}`,
                children: frame.layers.map(layer => ({
                  kind: 'layer',
                  label: layer.kind,
                  preview: `${layer.contentLength} bytes at ${layer.offset}`,
                })),
              })),
            }),
            'common.view/raster-image-source': createRasterImageSource(
              bytes,
              'image/x-sld',
              {
                width: sld.maxWidth,
                height: sld.maxHeight,
                depth: 1,
                layers: 1,
                faces: 1,
                mipLevels: 1,
                frames: sld.frames.length,
                channels: 4,
                bitDepth: 8,
                colorSpace: 'unknown',
                alphaMode: 'straight',
                orientation: 'top-left',
                decodedAccess: true,
              },
              regionReader(bytes, sld),
            ),
          },
          maxDecodedBytes: sld.totalDecodedBytes,
          unsupportedFeatures: [
            'shadow-layer-compositing',
            'damage-layer-compositing',
            'player-color-layer-compositing',
            'sld-writing',
          ],
        }
      },
    }),
    context,
  )
}
