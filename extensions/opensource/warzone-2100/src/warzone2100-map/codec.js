// SPDX-License-Identifier: GPL-2.0-or-later
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/warzone2100-map'
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const isMap = bytes =>
  bytes.byteLength >= 16 && bytes[0] === 0x6d && bytes[1] === 0x61 && bytes[2] === 0x70
const isGam = bytes =>
  bytes.byteLength >= 52 &&
  bytes[0] === 0x67 &&
  bytes[1] === 0x61 &&
  bytes[2] === 0x6d &&
  bytes[3] === 0x65

function parse(bytes, budget) {
  const view = viewOf(bytes)
  if (isMap(bytes)) {
    const version = view.getUint32(4, true)
    const width = view.getUint32(8, true)
    const height = view.getUint32(12, true)
    if (version <= 9 || version > 40 || width <= 1 || height <= 1 || width * height > 65_536)
      throw new TypeError('invalid Warzone game.map dimensions or version')
    const tileBytes = version < 40 ? 3 : 4
    const count = width * height
    if (count > budget.maxNodes || 16 + count * tileBytes + 8 > bytes.byteLength)
      throw new RangeError('Warzone game.map tiles exceed input or budget')
    let minimumHeight = Number.POSITIVE_INFINITY
    let maximumHeight = 0
    let offset = 16
    for (let index = 0; index < count; index += 1) {
      offset += 2
      const heightValue = version < 40 ? view.getUint8(offset++) * 2 : view.getUint16(offset, true)
      if (version >= 40) offset += 2
      minimumHeight = Math.min(minimumHeight, heightValue)
      maximumHeight = Math.max(maximumHeight, heightValue)
    }
    const gatewayVersion = view.getUint32(offset, true)
    const gateways = view.getUint32(offset + 4, true)
    if (gatewayVersion !== 1 || offset + 8 + gateways * 4 > bytes.byteLength)
      throw new TypeError('invalid Warzone gateway table')
    return {
      kind: 'terrain',
      version,
      width,
      height,
      tiles: count,
      gateways,
      minimumHeight,
      maximumHeight,
    }
  }
  if (isGam(bytes)) {
    const little = view.getUint32(4, true)
    const version = little <= 34 ? little : view.getUint32(4, false)
    const gameType = view.getUint32(12, true)
    const minX = view.getInt32(16, true)
    const minY = view.getInt32(20, true)
    const maxX = view.getUint32(24, true)
    const maxY = view.getUint32(28, true)
    const rawName = bytes.subarray(32, 52)
    const nul = rawName.indexOf(0)
    const levelName = new TextDecoder().decode(nul < 0 ? rawName : rawName.subarray(0, nul))
    return { kind: 'game', version, gameType, width: maxX - minX, height: maxY - minY, levelName }
  }
  throw new TypeError('Warzone map signature is not recognized')
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'warzone2100-map', label: 'Warzone 2100 map and level' }),
  async detect(prefix) {
    return isMap(prefix) || isGam(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'Warzone map header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const value = parse(bytes, context.budget)
    const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }))
    return {
      summary: { format: 'warzone2100-map', ...value },
      metadata: [{ id: 'warzone2100-map', label: 'Warzone 2100 map', entries }],
      traits: [{ id: 'structure.hierarchy', parameters: { kind: value.kind } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'map',
          label: value.levelName || 'Warzone terrain',
          preview: `${value.width} × ${value.height}`,
          children: entries.map(entry => ({
            kind: 'field',
            label: entry.key,
            preview: String(entry.value),
          })),
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: ['object-tables', 'map-writing', 'terrain-preview'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
