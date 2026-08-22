// AoE II DE SMP framing follows the openage reverse-engineered specification:
// https://github.com/SFTtech/openage/blob/master/doc/media/smp-files.md

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/smp'
const HEADER_BYTES = 64
const FRAME_HEADER_BYTES = 32
const LAYER_HEADER_BYTES = 32

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
    throw new RangeError(`SMP ${label} is outside the file`)
  }
}

function parseSmp(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('SMP structure exceeds maxDepth budget')
  checkedRange(bytes, 0, HEADER_BYTES, 'header')
  if (ascii(bytes, 0, 4) !== 'SMP$') throw new TypeError('SMP$ header is missing')
  const view = viewOf(bytes)
  const version = view.getUint32(4, true)
  const frameCount = view.getUint32(8, true)
  const facets = view.getUint32(12, true)
  const framesPerFacet = view.getUint32(16, true)
  const checksum = view.getUint32(20, true)
  const declaredSize = view.getUint32(24, true)
  const sourceFormat = view.getUint32(28, true)
  if (frameCount === 0) throw new TypeError('SMP frame count is zero')
  if (frameCount > budget.maxNodes) throw new RangeError('SMP frames exceed maxNodes budget')
  if (declaredSize !== 0 && declaredSize !== bytes.byteLength) {
    throw new TypeError('SMP declared file size does not match the source')
  }
  checkedRange(bytes, HEADER_BYTES, frameCount * 4, 'frame offset table')
  let nodes = frameCount
  const frames = []
  for (let index = 0; index < frameCount; index += 1) {
    const frameOffset = view.getUint32(HEADER_BYTES + index * 4, true)
    checkedRange(bytes, frameOffset, FRAME_HEADER_BYTES, `frame ${index} header`)
    const layerCount = view.getUint32(frameOffset + 28, true)
    nodes += layerCount
    if (nodes > budget.maxNodes) throw new RangeError('SMP layers exceed maxNodes budget')
    checkedRange(
      bytes,
      frameOffset + FRAME_HEADER_BYTES,
      layerCount * LAYER_HEADER_BYTES,
      `frame ${index} layer table`,
    )
    const layers = []
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
      const layerOffset = frameOffset + FRAME_HEADER_BYTES + layerIndex * LAYER_HEADER_BYTES
      const width = view.getUint32(layerOffset, true)
      const height = view.getUint32(layerOffset + 4, true)
      const hotspotX = view.getInt32(layerOffset + 8, true)
      const hotspotY = view.getInt32(layerOffset + 12, true)
      const type = view.getUint32(layerOffset + 16, true)
      const outlineOffset = frameOffset + view.getUint32(layerOffset + 20, true)
      const commandTableOffset = frameOffset + view.getUint32(layerOffset + 24, true)
      const flags = view.getUint32(layerOffset + 28, true)
      if (width === 0 || height === 0) {
        throw new TypeError(`SMP frame ${index} layer ${layerIndex} dimensions are invalid`)
      }
      checkedRange(
        bytes,
        outlineOffset,
        height * 4,
        `frame ${index} layer ${layerIndex} outline table`,
      )
      checkedRange(
        bytes,
        commandTableOffset,
        height * 4,
        `frame ${index} layer ${layerIndex} command table`,
      )
      nodes += height * 2
      if (nodes > budget.maxNodes) throw new RangeError('SMP row tables exceed maxNodes budget')
      for (let row = 0; row < height; row += 1) {
        const outline = outlineOffset + row * 4
        const left = view.getUint16(outline, true)
        const right = view.getUint16(outline + 2, true)
        if (!(left === 0xffff && right === 0xffff) && left + right > width) {
          throw new TypeError(
            `SMP frame ${index} layer ${layerIndex} row ${row} outline is invalid`,
          )
        }
        const commandOffset = frameOffset + view.getUint32(commandTableOffset + row * 4, true)
        checkedRange(
          bytes,
          commandOffset,
          1,
          `frame ${index} layer ${layerIndex} row ${row} command stream`,
        )
      }
      layers.push(
        Object.freeze({
          index: layerIndex,
          width,
          height,
          hotspotX,
          hotspotY,
          type,
          flags,
          outlineOffset,
          commandTableOffset,
        }),
      )
    }
    frames.push(Object.freeze({ index, offset: frameOffset, layers: Object.freeze(layers) }))
  }
  const scalarBytes = HEADER_BYTES + nodes * 96
  if (scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('SMP metadata exceeds maxScalarBytes budget')
  }
  return Object.freeze({
    version,
    facets,
    framesPerFacet,
    checksum,
    sourceFormat,
    frames: Object.freeze(frames),
    scalarBytes,
  })
}

export function createSmpCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'smp', label: 'AoE2 DE SMP sprite package' }),
      async detect(prefix) {
        return prefix.byteLength >= 4 && ascii(prefix, 0, 4) === 'SMP$'
          ? { confidence: 0.99, kind: 'magic', note: 'SMP$ sprite header' }
          : { confidence: 0, kind: 'magic', note: 'smp-signature-mismatch' }
      },
      async inspect(bytes, inspectionContext) {
        const smp = parseSmp(bytes, inspectionContext.budget)
        const layerCount = smp.frames.reduce((sum, frame) => sum + frame.layers.length, 0)
        const summary = {
          format: 'smp',
          version: smp.version,
          frames: smp.frames.length,
          facets: smp.facets,
          framesPerFacet: smp.framesPerFacet,
          layers: layerCount,
          sourceFormat: smp.sourceFormat,
        }
        return {
          summary,
          metadata: [
            {
              id: 'smp-package',
              label: 'AoE2 DE SMP package',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'image.frames', parameters: { count: smp.frames.length } },
            { id: 'image.palette', parameters: { indexed: true } },
            { id: 'structure.layers', parameters: { count: layerCount } },
            {
              id: 'content.binary',
              parameters: { bytes: String(bytes.byteLength), checksum: smp.checksum },
            },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'image',
              label: `SMP v${smp.version}`,
              preview: `${smp.frames.length} frame(s), ${layerCount} layer(s)`,
              children: smp.frames.map(frame => ({
                kind: 'frame',
                label: `Frame ${frame.index}`,
                preview: `${frame.layers.length} layer(s) at ${frame.offset}`,
                children: frame.layers.map(layer => ({
                  kind: 'layer',
                  label: `Layer ${layer.index}`,
                  preview: `type 0x${layer.type.toString(16)}, ${layer.width} × ${layer.height}, flags 0x${layer.flags.toString(16)}`,
                })),
              })),
            }),
          },
          maxDecodedBytes: BigInt(smp.scalarBytes),
          unsupportedFeatures: [
            'palette-resolution',
            'command-stream-pixel-decoding',
            'smp-writing',
          ],
        }
      },
    }),
    context,
  )
}
