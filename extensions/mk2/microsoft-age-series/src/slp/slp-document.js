// Genie SLP 2.x/3.x framing follows the openage reverse-engineered specification:
// https://github.com/SFTtech/openage/blob/master/doc/media/slp-files.md

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/slp'
const HEADER_BYTES = 32
const FRAME_BYTES = 32

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
    throw new RangeError(`SLP ${label} is outside the file`)
  }
}

function supportedVersion(bytes) {
  if (bytes.byteLength < 4) return undefined
  const version = ascii(bytes, 0, 4)
  return version.startsWith('2.') || version.startsWith('3.') ? version : undefined
}

function parseSlp(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('SLP structure exceeds maxDepth budget')
  checkedRange(bytes, 0, HEADER_BYTES, 'header')
  const version = supportedVersion(bytes)
  if (version === undefined) throw new TypeError('SLP 2.x/3.x header is missing')
  const view = viewOf(bytes)
  const frameCount = view.getUint32(4, true)
  if (frameCount === 0) throw new TypeError('SLP frame count is zero')
  if (frameCount > budget.maxNodes) throw new RangeError('SLP frames exceed maxNodes budget')
  checkedRange(bytes, HEADER_BYTES, frameCount * FRAME_BYTES, 'frame table')
  const frames = []
  let nodes = frameCount
  for (let index = 0; index < frameCount; index += 1) {
    const offset = HEADER_BYTES + index * FRAME_BYTES
    const commandTableOffset = view.getUint32(offset, true)
    const outlineTableOffset = view.getUint32(offset + 4, true)
    const paletteOffset = view.getUint32(offset + 8, true)
    const properties = view.getUint32(offset + 12, true)
    const width = view.getInt32(offset + 16, true)
    const height = view.getInt32(offset + 20, true)
    const hotspotX = view.getInt32(offset + 24, true)
    const hotspotY = view.getInt32(offset + 28, true)
    if (width <= 0 || height <= 0) throw new TypeError(`SLP frame ${index} dimensions are invalid`)
    if (!Number.isSafeInteger(height * 2)) throw new RangeError('SLP outline table overflows')
    checkedRange(bytes, outlineTableOffset, height * 4, `frame ${index} outline table`)
    checkedRange(bytes, commandTableOffset, height * 4, `frame ${index} command table`)
    nodes += height * 2
    if (nodes > budget.maxNodes) throw new RangeError('SLP row tables exceed maxNodes budget')
    let transparentRows = 0
    for (let row = 0; row < height; row += 1) {
      const outline = outlineTableOffset + row * 4
      const left = view.getUint16(outline, true)
      const right = view.getUint16(outline + 2, true)
      if (left === 0x8000 && right === 0x8000) transparentRows += 1
      else if (left + right > width)
        throw new TypeError(`SLP frame ${index} row ${row} outline is invalid`)
      const commandOffset = view.getUint32(commandTableOffset + row * 4, true)
      checkedRange(bytes, commandOffset, 1, `frame ${index} row ${row} command stream`)
    }
    frames.push(
      Object.freeze({
        index,
        width,
        height,
        hotspotX,
        hotspotY,
        properties,
        paletteOffset,
        outlineTableOffset,
        commandTableOffset,
        transparentRows,
      }),
    )
  }
  const scalarBytes = HEADER_BYTES + frames.length * 160
  if (scalarBytes > budget.maxScalarBytes)
    throw new RangeError('SLP metadata exceeds maxScalarBytes budget')
  return Object.freeze({ version, frames: Object.freeze(frames), scalarBytes })
}

export function createSlpCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'slp', label: 'Genie SLP sprite' }),
      async detect(prefix) {
        const version = supportedVersion(prefix)
        return version === undefined
          ? { confidence: 0, kind: 'magic', note: 'slp-version-prefix-missing' }
          : { confidence: 0.97, kind: 'structure', note: `Genie SLP ${version.trim()}` }
      },
      async inspect(bytes, inspectionContext) {
        const slp = parseSlp(bytes, inspectionContext.budget)
        const maxWidth = Math.max(...slp.frames.map(frame => frame.width))
        const maxHeight = Math.max(...slp.frames.map(frame => frame.height))
        const summary = {
          format: 'slp',
          version: slp.version.trim(),
          frames: slp.frames.length,
          maxWidth,
          maxHeight,
        }
        return {
          summary,
          metadata: [
            {
              id: 'slp-sprite',
              label: 'Genie SLP sprite',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'image.frames', parameters: { count: slp.frames.length } },
            { id: 'image.palette', parameters: { indexed: true } },
            {
              id: 'structure.hierarchy',
              parameters: {
                rows: slp.frames.reduce((sum, frame) => sum + frame.height, 0),
              },
            },
            {
              id: 'content.binary',
              parameters: { bytes: String(bytes.byteLength), version: summary.version },
            },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'image',
              label: `SLP ${summary.version}`,
              preview: `${summary.frames} frame(s), up to ${maxWidth} × ${maxHeight}`,
              children: slp.frames.map(frame => ({
                kind: 'frame',
                label: `Frame ${frame.index}`,
                preview: `${frame.width} × ${frame.height}, hotspot ${frame.hotspotX},${frame.hotspotY}`,
                children: [
                  {
                    kind: 'table',
                    label: 'Outline table',
                    preview: `${frame.height} row(s) at ${frame.outlineTableOffset}`,
                  },
                  {
                    kind: 'table',
                    label: 'Command table',
                    preview: `${frame.height} row(s) at ${frame.commandTableOffset}`,
                  },
                ],
              })),
            }),
          },
          maxDecodedBytes: BigInt(slp.scalarBytes),
          unsupportedFeatures: [
            'palette-resolution',
            'command-stream-pixel-decoding',
            'slp-4.x-lz4',
            'slp-writing',
          ],
        }
      },
    }),
    context,
  )
}
