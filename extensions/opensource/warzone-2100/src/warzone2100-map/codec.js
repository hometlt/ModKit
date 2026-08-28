// SPDX-License-Identifier: GPL-2.0-or-later
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { parseWarzoneGameMap } from './format.js'

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
    const map = parseWarzoneGameMap(bytes, budget)
    return {
      kind: 'terrain',
      version: map.version,
      width: map.width,
      height: map.height,
      tiles: map.tileCount,
      gateways: map.gatewayCount,
      minimumHeight: map.minimumHeight,
      maximumHeight: map.maximumHeight,
      trailingBytes: map.trailingBytes,
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
      unsupportedFeatures: [
        'object-tables',
        'map-resize',
        'map-version-conversion',
        'gateway-insert-delete',
        'gam-writing',
        'terrain-type-writing',
        'object-table-writing',
        'warzone-package-writing',
        'terrain-preview',
      ],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
