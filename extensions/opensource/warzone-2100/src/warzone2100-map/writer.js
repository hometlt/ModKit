// SPDX-License-Identifier: GPL-2.0-or-later
import { parseWarzoneGameMap, WARZONE_GAME_MAP_LIMITS } from './format.js'

const PROVIDER_ID = 'org.modkitx.opensource/warzone2100-map-semantic'
const OFFER_ID = 'warzone2100-game-map-source'
const INTENT_KIND = 'warzone2100-game-map-preserving-write-v1'
const UNKNOWN_DATA_POLICY = 'preserve-untouched-bytes'
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u
const YIELD_MASK = 0x3ff

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

const abort = signal => {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

const checkpoint = async signals => {
  for (const signal of signals) abort(signal)
  await new Promise(resolve => globalThis.setTimeout(resolve, 0))
  for (const signal of signals) abort(signal)
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function exactKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field ${key}`)
  }
  for (const key of required) {
    if (!(key in value)) throw new TypeError(`${label} is missing ${key}`)
  }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function validateTileUpdate(update, map, label) {
  exactKeys(update, ['kind', 'index'], ['texture', 'height'], label)
  const index = integer(update.index, 0, map.tileCount - 1, `${label}.index`)
  if (update.texture === undefined && update.height === undefined) {
    throw new TypeError(`${label} must change texture, height, or both`)
  }
  const texture =
    update.texture === undefined
      ? undefined
      : integer(update.texture, 0, 0xffff, `${label}.texture`)
  const height =
    update.height === undefined
      ? undefined
      : integer(update.height, 0, WARZONE_GAME_MAP_LIMITS.maximumHeight, `${label}.height`)
  if (map.version < 40 && height !== undefined && height % 2 !== 0) {
    throw new RangeError(`${label}.height must be divisible by 2 in game.map v10-v39`)
  }
  return Object.freeze({ kind: update.kind, index, texture, height })
}

function validateGatewayUpdate(update, map, label) {
  exactKeys(update, ['kind', 'index', 'x1', 'y1', 'x2', 'y2'], [], label)
  const result = Object.freeze({
    kind: update.kind,
    index: integer(update.index, 0, map.gatewayCount - 1, `${label}.index`),
    x1: integer(update.x1, 0, Math.min(0xff, map.width - 1), `${label}.x1`),
    y1: integer(update.y1, 0, Math.min(0xff, map.height - 1), `${label}.y1`),
    x2: integer(update.x2, 0, Math.min(0xff, map.width - 1), `${label}.x2`),
    y2: integer(update.y2, 0, Math.min(0xff, map.height - 1), `${label}.y2`),
  })
  if (result.x1 !== result.x2 && result.y1 !== result.y2) {
    throw new TypeError(`${label} must remain horizontal or vertical`)
  }
  return result
}

function assertWriterBudget(budget) {
  if (
    budget === undefined ||
    typeof budget.maxInputBytes !== 'bigint' ||
    budget.maxInputBytes <= 0n ||
    !Number.isSafeInteger(budget.maxScalarBytes) ||
    budget.maxScalarBytes <= 0 ||
    !Number.isSafeInteger(budget.maxNodes) ||
    budget.maxNodes <= 0
  ) {
    throw new TypeError(
      'Warzone game.map writer requires positive maxInputBytes, maxScalarBytes and maxNodes budgets',
    )
  }
}

function assertInlineBytes(bytes, budget, label) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${label} must be Uint8Array`)
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError(`${label} exceeds maxScalarBytes budget`)
  }
  if (BigInt(bytes.byteLength) > budget.maxInputBytes) {
    throw new RangeError(`${label} exceeds maxInputBytes budget`)
  }
}

async function contentDigest(bytes, signals) {
  for (const signal of signals) abort(signal)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new TypeError('WebCrypto SHA-256 is unavailable')
  const value = await subtle.digest('SHA-256', bytes)
  for (const signal of signals) abort(signal)
  const hex = [...new Uint8Array(value)].map(item => item.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

async function updatesOf(intentValue, map, budget, signals) {
  const intent = record(intentValue)
  if (intent === undefined) throw new TypeError('game.map semanticIntent must be an object')
  exactKeys(
    intent,
    ['kind', 'sourceComplete', 'sourceContentDigest', 'unknownDataPolicy', 'updates'],
    [],
    'semanticIntent',
  )
  if (
    intent.kind !== INTENT_KIND ||
    intent.sourceComplete !== true ||
    typeof intent.sourceContentDigest !== 'string' ||
    !SHA256_DIGEST.test(intent.sourceContentDigest) ||
    intent.unknownDataPolicy !== UNKNOWN_DATA_POLICY ||
    !Array.isArray(intent.updates)
  ) {
    throw new TypeError(
      `game.map semanticIntent requires ${INTENT_KIND}, a complete SHA-256-bound source, and ${UNKNOWN_DATA_POLICY}`,
    )
  }
  if (intent.updates.length > budget.maxNodes) {
    throw new RangeError('game.map updates exceed maxNodes budget')
  }
  const seen = new Set()
  const updates = []
  for (const [index, value] of intent.updates.entries()) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    const update = record(value)
    if (update === undefined)
      throw new TypeError(`semanticIntent.updates[${index}] must be an object`)
    const label = `semanticIntent.updates[${index}]`
    let validated
    if (update.kind === 'set-tile-v1') validated = validateTileUpdate(update, map, label)
    else if (update.kind === 'set-gateway-v1') validated = validateGatewayUpdate(update, map, label)
    else throw new TypeError(`${label}.kind is unsupported`)
    const key = `${validated.kind}\u0000${validated.index}`
    if (seen.has(key))
      throw new TypeError(`${label} duplicates ${validated.kind} ${validated.index}`)
    seen.add(key)
    updates.push(validated)
  }
  return Object.freeze({ digest: intent.sourceContentDigest, updates: Object.freeze(updates) })
}

async function compareMapSemantics(expected, actual, signals) {
  for (const key of ['version', 'width', 'height', 'tileCount', 'gatewayVersion', 'gatewayCount']) {
    if (expected[key] !== actual[key]) throw new TypeError(`reopened game.map changed ${key}`)
  }
  for (let index = 0; index < expected.tiles.length; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    const left = expected.tiles[index]
    const right = actual.tiles[index]
    if (left.texture !== right?.texture || left.height !== right?.height) {
      throw new TypeError(`reopened game.map tile ${index} differs from the write intent`)
    }
  }
  for (let index = 0; index < expected.gateways.length; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    const left = expected.gateways[index]
    const right = actual.gateways[index]
    if (
      left.x1 !== right?.x1 ||
      left.y1 !== right.y1 ||
      left.x2 !== right.x2 ||
      left.y2 !== right.y2
    ) {
      throw new TypeError(`reopened game.map gateway ${index} differs from the write intent`)
    }
  }
}

async function expectedSemantics(map, updates, signals) {
  const tiles = []
  for (const [index, item] of map.tiles.entries()) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    tiles.push({ texture: item.texture, height: item.height })
  }
  const gateways = []
  for (const [index, item] of map.gateways.entries()) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    gateways.push({ x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 })
  }
  for (const [index, update] of updates.entries()) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    if (update.kind === 'set-tile-v1') {
      const tile = tiles[update.index]
      if (update.texture !== undefined) tile.texture = update.texture
      if (update.height !== undefined) tile.height = update.height
    } else {
      gateways[update.index] = { x1: update.x1, y1: update.y1, x2: update.x2, y2: update.y2 }
    }
  }
  return Object.freeze({ ...map, tiles: Object.freeze(tiles), gateways: Object.freeze(gateways) })
}

async function writeUpdates(sourceBytes, map, updates, signals) {
  // `Buffer.slice()` aliases its source, unlike `Uint8Array.slice()`. Constructing explicitly
  // guarantees the writer never mutates or returns an alias of any accepted Uint8Array subtype.
  const output = new Uint8Array(sourceBytes)
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
  const changedOffsets = new Set()
  for (const [ordinal, update] of updates.entries()) {
    if ((ordinal & YIELD_MASK) === 0) await checkpoint(signals)
    if (update.kind === 'set-tile-v1') {
      const tile = map.tiles[update.index]
      if (update.texture !== undefined) {
        view.setUint16(tile.offset, update.texture, true)
        changedOffsets.add(tile.offset)
        changedOffsets.add(tile.offset + 1)
      }
      if (update.height !== undefined) {
        if (map.version >= 40) {
          view.setUint16(tile.offset + 2, update.height, true)
          changedOffsets.add(tile.offset + 2)
          changedOffsets.add(tile.offset + 3)
        } else {
          view.setUint8(tile.offset + 2, update.height / 2)
          changedOffsets.add(tile.offset + 2)
        }
      }
    } else {
      const gateway = map.gateways[update.index]
      view.setUint8(gateway.offset, update.x1)
      view.setUint8(gateway.offset + 1, update.y1)
      view.setUint8(gateway.offset + 2, update.x2)
      view.setUint8(gateway.offset + 3, update.y2)
      for (let index = 0; index < 4; index += 1) changedOffsets.add(gateway.offset + index)
    }
  }
  for (let index = 0; index < sourceBytes.byteLength; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    if (!changedOffsets.has(index) && sourceBytes[index] !== output[index]) {
      throw new TypeError(`game.map preserving write changed opaque byte ${index}`)
    }
  }
  return output
}

/** Validate, write to fresh bytes, reopen, and compare the complete supported semantics. */
export async function writeWarzoneGameMap(sourceBytes, semanticIntent, budget, ...signals) {
  assertWriterBudget(budget)
  assertInlineBytes(sourceBytes, budget, 'game.map inline source')
  for (const signal of signals) abort(signal)
  for (let index = 0; index < sourceBytes.byteLength; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
  }
  const source = parseWarzoneGameMap(sourceBytes, budget, signals[0])
  const intent = await updatesOf(semanticIntent, source, budget, signals)
  const actualDigest = await contentDigest(sourceBytes, signals)
  if (actualDigest !== intent.digest) {
    throw new TypeError('game.map inline source does not match semanticIntent.sourceContentDigest')
  }
  const expected = await expectedSemantics(source, intent.updates, signals)
  const output = await writeUpdates(sourceBytes, source, intent.updates, signals)
  assertInlineBytes(output, budget, 'game.map inline output')
  const reopened = parseWarzoneGameMap(output, budget, signals[0])
  await compareMapSemantics(expected, reopened, signals)
  if (
    source.semanticEnd !== reopened.semanticEnd ||
    source.trailingBytes !== reopened.trailingBytes
  ) {
    throw new TypeError('reopened game.map changed its opaque trailing payload boundary')
  }
  for (let index = source.semanticEnd; index < sourceBytes.byteLength; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    if (sourceBytes[index] !== output[index]) {
      throw new TypeError('game.map preserving write changed opaque trailing payload')
    }
  }
  for (const signal of signals) abort(signal)
  return output
}

function sourceBytesOf(change, budget) {
  if (change.targets.length !== 1 || change.edits.length !== 1) {
    throw new TypeError('game.map save requires one target and one whole-source replacement')
  }
  const target = change.targets[0]
  const edit = change.edits[0]
  if (
    edit.operation !== 'replace' ||
    edit.range !== undefined ||
    edit.targetId !== target.targetId ||
    edit.source.id !== target.ownerSource.id ||
    edit.payload.kind !== 'inline'
  ) {
    throw new TypeError('game.map save requires an inline complete snapshot of its own source')
  }
  assertInlineBytes(edit.payload.bytes, budget, 'game.map inline source')
  return Object.freeze({ target, edit, bytes: edit.payload.bytes })
}

async function preparedWrite(change, context, signal) {
  abort(context.signal)
  abort(signal)
  assertWriterBudget(context.budgets)
  const source = sourceBytesOf(change, context.budgets)
  const intent = record(change.semanticIntent)
  const intentDigest = intent?.sourceContentDigest
  if (typeof intentDigest !== 'string' || !SHA256_DIGEST.test(intentDigest)) {
    throw new TypeError('semanticIntent.sourceContentDigest must be sha256:<64 lowercase hex>')
  }
  const expectedContentRevision = `content-hash.${intentDigest}`
  if (source.target.expectedRevision.bindings.content !== expectedContentRevision) {
    throw new TypeError(
      'target expectedRevision.bindings.content does not match semanticIntent.sourceContentDigest',
    )
  }
  const bytes = await writeWarzoneGameMap(
    source.bytes,
    change.semanticIntent,
    context.budgets,
    context.signal,
    signal,
  )
  return Object.freeze({ ...source, bytes })
}

async function validationOf(change, context, signal) {
  try {
    await preparedWrite(change, context, signal)
    return Object.freeze({ valid: true, diagnostics: Object.freeze([]) })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        error(
          'org.modkitx.opensource/warzone2100-game-map-write-invalid',
          cause instanceof Error ? cause.message : String(cause),
        ),
      ]),
    })
  }
}

function writer(context) {
  const providerIdentity = context.providerIdentity
  if (
    providerIdentity === undefined ||
    providerIdentity.providerId !== PROVIDER_ID ||
    typeof providerIdentity.providerVersion !== 'string' ||
    providerIdentity.providerVersion.length === 0 ||
    typeof providerIdentity.artifactDigest !== 'string' ||
    providerIdentity.artifactDigest.length === 0
  ) {
    throw new TypeError(
      'Warzone game.map writer requires its exact host-attested provider identity',
    )
  }
  const identity = Object.freeze({
    ...providerIdentity,
    formatId: 'warzone2100-map',
    representationId: 'source',
  })
  const fidelity = Object.freeze({
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    notes: Object.freeze([
      'an unchanged complete game.map snapshot produces byte-identical fresh bytes',
      'typed tile and existing-gateway updates preserve the signature byte, dimensions, version, counts, untouched records and opaque trailing payload',
      'the provider returns a replacement artifact only; write-source permission and atomic commit remain host responsibilities',
    ]),
  })
  return Object.freeze({
    identity,
    offer: Object.freeze({
      providerId: PROVIDER_ID,
      fidelityEvidenceId: 'warzone2100-game-map-preserving-writer-v1',
      formatId: 'warzone2100-map',
      representationId: 'source',
      mutationMode: 'mutate',
      minimumRoundTrip: 'byte-identical',
    }),
    async validate(change, signal) {
      return await validationOf(change, context, signal)
    },
    async plan(change, signal) {
      const prepared = await preparedWrite(change, context, signal)
      return Object.freeze({
        planId: `${PROVIDER_ID}:${prepared.target.targetId}`,
        targets: change.targets,
        edits: Object.freeze([
          Object.freeze({
            ...prepared.edit,
            payload: Object.freeze({ kind: 'inline', bytes: prepared.bytes }),
            label: 'validated preserving Warzone game.map replacement',
          }),
        ]),
        semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: 'atomic' }),
        fidelity,
        diagnostics: Object.freeze([]),
      })
    },
  })
}

export const abiVersion = 1
export const provides = Object.freeze(['common.edit/writer'])

export function createProvider(selection, context) {
  if (
    selection.contract !== 'common.edit/writer' ||
    selection.major !== 1 ||
    selection.offerId !== OFFER_ID
  ) {
    throw new TypeError(`unknown Warzone game.map writer offer ${selection.offerId}`)
  }
  return Object.freeze({ value: writer(context), release: async () => undefined })
}

export const WARZONE_GAME_MAP_WRITE_INTENT = Object.freeze({
  kind: INTENT_KIND,
  unknownDataPolicy: UNKNOWN_DATA_POLICY,
  supportedUpdates: Object.freeze(['set-tile-v1', 'set-gateway-v1']),
})
