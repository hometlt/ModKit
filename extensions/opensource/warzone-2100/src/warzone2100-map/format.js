// SPDX-License-Identifier: GPL-2.0-or-later

const MAP_HEADER_BYTES = 16
const GATEWAY_HEADER_BYTES = 8
const GATEWAY_BYTES = 4
const MAP_MAX_AREA = 256 * 256
const ELEVATION_SCALE = 2
const TILE_MAX_HEIGHT = 255 * ELEVATION_SCALE

const abort = signal => {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

const checkpoint = (signal, index) => {
  if ((index & 0x3ff) === 0) abort(signal)
}

const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function assertBudget(budget) {
  if (
    budget === undefined ||
    typeof budget.maxInputBytes !== 'bigint' ||
    budget.maxInputBytes <= 0n ||
    !Number.isSafeInteger(budget.maxNodes) ||
    budget.maxNodes <= 0 ||
    !Number.isSafeInteger(budget.maxScalarBytes) ||
    budget.maxScalarBytes <= 0
  ) {
    throw new TypeError(
      'Warzone game.map requires positive maxInputBytes, maxScalarBytes and maxNodes budgets',
    )
  }
}

function checkedEnd(offset, count, stride, limit, label) {
  const length = count * stride
  const end = offset + length
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(end) || end > limit) {
    throw new RangeError(`${label} exceeds the game.map input`)
  }
  return end
}

/**
 * Parse the exact binary region owned by game.map while retaining offsets for preserving writes.
 * The engine intentionally accepts any fourth signature byte, so it is opaque and never normalised.
 */
export function parseWarzoneGameMap(bytes, budget, signal) {
  abort(signal)
  assertBudget(budget)
  if (!(bytes instanceof Uint8Array)) throw new TypeError('game.map source must be Uint8Array')
  if (BigInt(bytes.byteLength) > budget.maxInputBytes) {
    throw new RangeError('Warzone game.map exceeds maxInputBytes budget')
  }
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('Warzone game.map exceeds maxScalarBytes budget')
  }
  if (
    bytes.byteLength < MAP_HEADER_BYTES + GATEWAY_HEADER_BYTES ||
    bytes[0] !== 0x6d ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x70
  ) {
    throw new TypeError('Warzone game.map header is missing or truncated')
  }

  const view = viewOf(bytes)
  const version = view.getUint32(4, true)
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const tileCount = width * height
  if (
    version < 10 ||
    version > 40 ||
    width <= 1 ||
    height <= 1 ||
    !Number.isSafeInteger(tileCount) ||
    tileCount > MAP_MAX_AREA
  ) {
    throw new TypeError('Warzone game.map dimensions or version are invalid')
  }
  if (tileCount > budget.maxNodes) {
    throw new RangeError('Warzone game.map tiles exceed maxNodes budget')
  }

  const tileBytes = version >= 40 ? 4 : 3
  const tileEnd = checkedEnd(
    MAP_HEADER_BYTES,
    tileCount,
    tileBytes,
    bytes.byteLength - GATEWAY_HEADER_BYTES,
    'Warzone game.map tile table',
  )
  const gatewayVersion = view.getUint32(tileEnd, true)
  const gatewayCount = view.getUint32(tileEnd + 4, true)
  if (gatewayVersion !== 1) throw new TypeError('Warzone game.map gateway version is not 1')
  if (!Number.isSafeInteger(gatewayCount) || gatewayCount > budget.maxNodes - tileCount) {
    throw new RangeError('Warzone game.map gateways exceed maxNodes budget')
  }
  const gatewayOffset = tileEnd + GATEWAY_HEADER_BYTES
  const semanticEnd = checkedEnd(
    gatewayOffset,
    gatewayCount,
    GATEWAY_BYTES,
    bytes.byteLength,
    'Warzone game.map gateway table',
  )

  const tiles = []
  let minimumHeight = Number.POSITIVE_INFINITY
  let maximumHeight = Number.NEGATIVE_INFINITY
  for (let index = 0; index < tileCount; index += 1) {
    checkpoint(signal, index)
    const offset = MAP_HEADER_BYTES + index * tileBytes
    const texture = view.getUint16(offset, true)
    const heightValue =
      version >= 40 ? view.getUint16(offset + 2, true) : view.getUint8(offset + 2) * ELEVATION_SCALE
    if (heightValue > TILE_MAX_HEIGHT) {
      throw new TypeError(`Warzone game.map tile ${index} exceeds maximum height 510`)
    }
    minimumHeight = Math.min(minimumHeight, heightValue)
    maximumHeight = Math.max(maximumHeight, heightValue)
    tiles.push(Object.freeze({ texture, height: heightValue, offset }))
  }

  const gateways = []
  for (let index = 0; index < gatewayCount; index += 1) {
    checkpoint(signal, index)
    const offset = gatewayOffset + index * GATEWAY_BYTES
    gateways.push(
      Object.freeze({
        x1: view.getUint8(offset),
        y1: view.getUint8(offset + 1),
        x2: view.getUint8(offset + 2),
        y2: view.getUint8(offset + 3),
        offset,
      }),
    )
  }
  abort(signal)
  return Object.freeze({
    version,
    width,
    height,
    tileBytes,
    tileCount,
    gatewayVersion,
    gatewayCount,
    minimumHeight,
    maximumHeight,
    semanticEnd,
    trailingBytes: bytes.byteLength - semanticEnd,
    tiles: Object.freeze(tiles),
    gateways: Object.freeze(gateways),
  })
}

export const WARZONE_GAME_MAP_LIMITS = Object.freeze({
  minimumVersion: 10,
  maximumVersion: 40,
  maximumArea: MAP_MAX_AREA,
  maximumHeight: TILE_MAX_HEIGHT,
})
