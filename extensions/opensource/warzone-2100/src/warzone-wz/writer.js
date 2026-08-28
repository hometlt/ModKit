// SPDX-License-Identifier: GPL-2.0-or-later
import {
  createCodec as createZipCodec,
  extractZipArchiveEntry,
  parseZipArchive,
} from 'modkit-extension-x3-archives/formats/zip/codec'

import { applyWarzoneLastWins } from './codec.js'
import { writeWarzoneGameMap, WARZONE_GAME_MAP_WRITE_INTENT } from '../warzone2100-map/writer.js'

const PROVIDER_ID = 'org.modkitx.opensource/warzone2100-wz-writer'
const OFFER_ID = 'warzone2100-wz-game-map-source'
const EVIDENCE_ID = 'warzone2100-wz-game-map-preserving-writer-v1'
const INTENT_KIND = 'warzone2100-wz-game-map-preserving-write-v1'
const UNKNOWN_DATA_POLICY = 'preserve-canonical-zip-and-game-map-opaque-bytes'
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u
const GAME_MAP_PATH = /(?:^|\/)game\.map$/u
// Whole-container comparisons are commonly tens of MiB. A 64 KiB cadence keeps cancellation
// observable without scheduling thousands of timers for one ordinary Save As.
const YIELD_MASK = 0xffff

const diagnostic = (code, message) => Object.freeze({ severity: 'error', code, message })

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

function assertBudget(budget) {
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
      'Warzone WZ writer requires positive maxInputBytes, maxScalarBytes and maxNodes budgets',
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

function safeEntryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError('semanticIntent.entryPath must be a non-empty ZIP path')
  }
  if (value.includes('\\') || value.startsWith('/') || /^[a-z]:/iu.test(value)) {
    throw new TypeError('semanticIntent.entryPath must be a normalized relative ZIP path')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new TypeError('semanticIntent.entryPath must not contain empty, dot or parent segments')
  }
  if (!GAME_MAP_PATH.test(value.toLowerCase())) {
    throw new TypeError('semanticIntent.entryPath must identify an existing game.map file')
  }
  return value
}

function safeArchiveName(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..' ||
    !value.toLowerCase().endsWith('.wz')
  ) {
    throw new TypeError('Warzone WZ Save As archiveName must be one portable .wz file name')
  }
  return value
}

async function sha256(bytes, signals) {
  for (const signal of signals) abort(signal)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new TypeError('WebCrypto SHA-256 is unavailable')
  const result = await subtle.digest('SHA-256', bytes)
  for (const signal of signals) abort(signal)
  const hex = [...new Uint8Array(result)].map(value => value.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

async function base64(bytes, signals) {
  if (typeof globalThis.btoa !== 'function')
    throw new TypeError('standard base64 encoder is unavailable')
  const parts = []
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    await checkpoint(signals)
    const end = Math.min(bytes.byteLength, offset + 0x8000)
    let part = ''
    for (let index = offset; index < end; index += 1) {
      part += String.fromCharCode(bytes[index])
    }
    parts.push(part)
  }
  return globalThis.btoa(parts.join(''))
}

function sourceBytesOf(change, budget) {
  if (change.targets.length !== 1 || change.edits.length !== 1) {
    throw new TypeError('Warzone WZ Save As requires one target and one complete source snapshot')
  }
  const target = change.targets[0]
  const edit = change.edits[0]
  if (
    edit.operation !== 'create' ||
    edit.targetId !== target.targetId ||
    edit.source.id !== target.ownerSource.id ||
    safeArchiveName(edit.newPath) !== edit.newPath ||
    edit.payload.kind !== 'inline'
  ) {
    throw new TypeError(
      'Warzone WZ Save As requires one inline source snapshot carried by one destination create edit',
    )
  }
  if (target.expectedRevision.namespaceRevision === undefined) {
    throw new TypeError('Warzone WZ Save As target must be a revision-pinned destination namespace')
  }
  assertInlineBytes(edit.payload.bytes, budget, 'Warzone WZ inline source')
  return Object.freeze({ target, edit, bytes: edit.payload.bytes, archiveName: edit.newPath })
}

function intentOf(value) {
  const intent = record(value)
  if (intent === undefined) throw new TypeError('Warzone WZ semanticIntent must be an object')
  exactKeys(
    intent,
    [
      'kind',
      'sourceComplete',
      'sourceContentDigest',
      'unknownDataPolicy',
      'entryPath',
      'sourceEntryContentDigest',
      'gameMapEdit',
    ],
    [],
    'semanticIntent',
  )
  if (
    intent.kind !== INTENT_KIND ||
    intent.sourceComplete !== true ||
    typeof intent.sourceContentDigest !== 'string' ||
    !SHA256_DIGEST.test(intent.sourceContentDigest) ||
    intent.unknownDataPolicy !== UNKNOWN_DATA_POLICY ||
    typeof intent.sourceEntryContentDigest !== 'string' ||
    !SHA256_DIGEST.test(intent.sourceEntryContentDigest)
  ) {
    throw new TypeError(
      `Warzone WZ semanticIntent requires ${INTENT_KIND}, complete SHA-256-bound sources and ${UNKNOWN_DATA_POLICY}`,
    )
  }
  const gameMapEdit = record(intent.gameMapEdit)
  if (
    gameMapEdit === undefined ||
    gameMapEdit.kind !== WARZONE_GAME_MAP_WRITE_INTENT.kind ||
    gameMapEdit.sourceComplete !== true ||
    gameMapEdit.sourceContentDigest !== intent.sourceEntryContentDigest ||
    gameMapEdit.unknownDataPolicy !== WARZONE_GAME_MAP_WRITE_INTENT.unknownDataPolicy ||
    !Array.isArray(gameMapEdit.updates)
  ) {
    throw new TypeError('semanticIntent.gameMapEdit must be a complete digest-bound game.map edit')
  }
  return Object.freeze({
    sourceDigest: intent.sourceContentDigest,
    entryPath: safeEntryPath(intent.entryPath),
    entryDigest: intent.sourceEntryContentDigest,
    gameMapEdit,
  })
}

async function inspectArchive(bytes, entryPath, budget, signals) {
  for (const signal of signals) abort(signal)
  const entries = parseZipArchive(bytes, budget.maxNodes)
  const overlay = applyWarzoneLastWins(entries)
  const folded = new Map()
  for (const [index, entry] of entries.entries()) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    const key = entry.name.toLowerCase()
    const previous = folded.get(key)
    if (previous !== undefined) {
      throw new TypeError(
        `Warzone WZ entry paths «${previous}» and «${entry.name}» are duplicate or case-fold ambiguous`,
      )
    }
    folded.set(key, entry.name)
  }
  if (overlay.shadowed.length !== 0) {
    throw new TypeError(
      'Warzone WZ last-wins overlay contains shadowed entries and is not writable',
    )
  }
  const exact = entries.filter(entry => entry.name === entryPath)
  if (exact.length !== 1 || exact[0].kind !== 'file') {
    throw new TypeError(`Warzone WZ requires exactly one existing file entry «${entryPath}»`)
  }
  const effective = overlay.effective.find(entry => entry.name === entryPath)
  if (effective?.id !== exact[0].id) {
    throw new TypeError(`Warzone WZ entry «${entryPath}» is not the last-wins effective entry`)
  }
  return Object.freeze({ entries, target: exact[0] })
}

function inlineZipInput(bytes, revision, uri, signal) {
  const ref = Object.freeze({ id: 'content', uri })
  const source = Object.freeze({
    kind: 'bytes',
    ref,
    revision,
    size: BigInt(bytes.byteLength),
    async read(offset, length, readSignal) {
      abort(signal)
      abort(readSignal)
      const start = Number(offset)
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(length) ||
        length < 0
      ) {
        throw new RangeError('common ZIP source read is outside the inline snapshot')
      }
      return bytes.slice(start, Math.min(bytes.byteLength, start + length))
    },
  })
  const binding = Object.freeze({
    sourceKind: 'candidate',
    bindingId: 'content',
    role: 'content',
    ownership: 'owned',
    source: ref,
    revision,
  })
  return Object.freeze({
    originKind: 'single',
    bindings: Object.freeze([binding]),
    primaryBindingId: binding.bindingId,
    revisions: Object.freeze({
      topology: 'single',
      revision,
      bindings: Object.freeze([Object.freeze({ bindingId: binding.bindingId, revision })]),
      compositionFingerprint: `warzone-wz-writer:${revision}`,
    }),
    bindingsFor: () => Object.freeze([]),
    async openBinding(bindingId, openSignal) {
      abort(signal)
      abort(openSignal)
      if (bindingId !== binding.bindingId) throw new TypeError(`unknown ZIP binding ${bindingId}`)
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
}

async function commonZipReplacement(
  sourceBytes,
  replacement,
  entryPath,
  revision,
  budget,
  signals,
) {
  const codec = createZipCodec(Object.freeze({}))
  const input = inlineZipInput(
    sourceBytes,
    revision,
    `memory://warzone/${entryPath}.wz`,
    signals[0],
  )
  const session = await codec.open(input, 'full', budget, signals[0])
  try {
    const invoked = await session.operations().invoke('edit-content', {
      path: entryPath,
      bytes: await base64(replacement, signals),
    })
    if (invoked.state !== 'ok' || invoked.output.kind !== 'edit-plan') {
      throw new TypeError(
        `common ZIP edit.content refused the Warzone replacement (${invoked.state})`,
      )
    }
    const plan = invoked.output.plan
    if (
      plan.fidelity.roundTrip !== 'semantic' ||
      plan.fidelity.preservesUnknownData !== true ||
      plan.edits.length !== 1
    ) {
      throw new TypeError('common ZIP writer did not prove canonical unknown-data preservation')
    }
    const edit = plan.edits[0]
    if (
      edit.operation !== 'replace' ||
      edit.range !== undefined ||
      edit.payload.kind !== 'inline'
    ) {
      throw new TypeError('common ZIP writer returned no complete inline replacement')
    }
    return new Uint8Array(edit.payload.bytes)
  } finally {
    await session.dispose()
  }
}

async function compareReopened(sourceEntries, output, entryPath, replacement, budget, signals) {
  const reopened = await inspectArchive(output, entryPath, budget, signals)
  if (sourceEntries.length !== reopened.entries.length) {
    throw new TypeError('reopened Warzone WZ changed the entry count')
  }
  for (let index = 0; index < sourceEntries.length; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    const before = sourceEntries[index]
    const after = reopened.entries[index]
    if (before.name !== after?.name || before.kind !== after.kind) {
      throw new TypeError(`reopened Warzone WZ changed entry identity ${index}`)
    }
    if (before.name === entryPath) continue
    for (const field of [
      'flags',
      'method',
      'dosTime',
      'dosDate',
      'crc',
      'compressedSize',
      'size',
    ]) {
      if (before[field] !== after[field]) {
        throw new TypeError(`reopened Warzone WZ changed untouched ${before.name} ${field}`)
      }
    }
  }
  const extracted = await extractZipArchiveEntry(output, reopened.target)
  assertInlineBytes(extracted, budget, 'reopened game.map')
  if (extracted.byteLength !== replacement.byteLength) {
    throw new TypeError('reopened Warzone WZ game.map size differs from the replacement')
  }
  for (let index = 0; index < extracted.byteLength; index += 1) {
    if ((index & YIELD_MASK) === 0) await checkpoint(signals)
    if (extracted[index] !== replacement[index]) {
      throw new TypeError(`reopened Warzone WZ game.map differs at byte ${index}`)
    }
  }
}

async function prepare(change, context, signal) {
  abort(context.signal)
  abort(signal)
  assertBudget(context.budgets)
  const source = sourceBytesOf(change, context.budgets)
  const intent = intentOf(change.semanticIntent)
  const expectedRevision = `content-hash.${intent.sourceDigest}`
  const sourceDigest = await sha256(source.bytes, [context.signal, signal])
  if (sourceDigest !== intent.sourceDigest) {
    throw new TypeError(
      'Warzone WZ inline source does not match semanticIntent.sourceContentDigest',
    )
  }
  const archive = await inspectArchive(source.bytes, intent.entryPath, context.budgets, [
    context.signal,
    signal,
  ])
  if (archive.target.size > context.budgets.maxScalarBytes) {
    throw new RangeError('source game.map exceeds maxScalarBytes budget')
  }
  const gameMapSource = await extractZipArchiveEntry(source.bytes, archive.target)
  assertInlineBytes(gameMapSource, context.budgets, 'source game.map')
  const entryDigest = await sha256(gameMapSource, [context.signal, signal])
  if (entryDigest !== intent.entryDigest) {
    throw new TypeError('selected game.map does not match semanticIntent.sourceEntryContentDigest')
  }
  const replacement = await writeWarzoneGameMap(
    gameMapSource,
    intent.gameMapEdit,
    context.budgets,
    context.signal,
    signal,
  )
  const output = await commonZipReplacement(
    source.bytes,
    replacement,
    intent.entryPath,
    expectedRevision,
    context.budgets,
    [context.signal, signal],
  )
  assertInlineBytes(output, context.budgets, 'Warzone WZ inline output')
  await compareReopened(archive.entries, output, intent.entryPath, replacement, context.budgets, [
    context.signal,
    signal,
  ])
  const sourceDigestAfter = await sha256(source.bytes, [context.signal, signal])
  if (sourceDigestAfter !== sourceDigest)
    throw new TypeError('Warzone WZ writer mutated its source')
  if (intent.gameMapEdit.updates.length === 0) {
    if (output.byteLength !== source.bytes.byteLength) {
      throw new TypeError('unchanged canonical Warzone WZ write is not byte-identical')
    }
    for (let index = 0; index < output.byteLength; index += 1) {
      if ((index & YIELD_MASK) === 0) await checkpoint([context.signal, signal])
      if (output[index] !== source.bytes[index]) {
        throw new TypeError(`unchanged canonical Warzone WZ differs at byte ${index}`)
      }
    }
  }
  return Object.freeze({ ...source, output, entryPath: intent.entryPath })
}

async function validationOf(change, context, signal) {
  try {
    await prepare(change, context, signal)
    return Object.freeze({ valid: true, diagnostics: Object.freeze([]) })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          'org.modkitx.opensource/warzone2100-wz-game-map-write-invalid',
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
    throw new TypeError('Warzone WZ writer requires its exact host-attested provider identity')
  }
  const identity = Object.freeze({
    ...providerIdentity,
    formatId: 'warzone-wz',
    representationId: 'source',
  })
  const fidelity = Object.freeze({
    roundTrip: 'semantic',
    preservesUnknownData: true,
    notes: Object.freeze([
      'the common canonical ZIP writer copies every untouched entry block verbatim and replaces only the selected existing game.map payload',
      'the nested game.map writer changes typed tile/existing-gateway fields and preserves its opaque trailing bytes',
      'an unchanged complete canonical WZ snapshot must produce byte-identical fresh bytes',
      'the provider creates a separate destination .wz artifact; source authorization and atomic destination commit remain host responsibilities',
    ]),
  })
  return Object.freeze({
    identity,
    offer: Object.freeze({
      providerId: PROVIDER_ID,
      fidelityEvidenceId: EVIDENCE_ID,
      formatId: 'warzone-wz',
      representationId: 'source',
      mutationMode: 'export-only',
      minimumRoundTrip: 'semantic',
    }),
    async validate(change, signal) {
      return await validationOf(change, context, signal)
    },
    async plan(change, signal) {
      const prepared = await prepare(change, context, signal)
      return Object.freeze({
        planId: `${PROVIDER_ID}:${prepared.target.targetId}:${prepared.entryPath}`,
        targets: change.targets,
        edits: Object.freeze([
          Object.freeze({
            ...prepared.edit,
            payload: Object.freeze({ kind: 'inline', bytes: prepared.output }),
            label: `validated preserving Warzone WZ Save As for ${prepared.entryPath}`,
          }),
        ]),
        semantics: Object.freeze({ mutationMode: 'export-only', minimumGuarantee: 'atomic' }),
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
    throw new TypeError(`unknown Warzone WZ writer offer ${selection.offerId}`)
  }
  return Object.freeze({ value: writer(context), release: async () => undefined })
}

export const WARZONE_WZ_GAME_MAP_WRITE_INTENT = Object.freeze({
  kind: INTENT_KIND,
  unknownDataPolicy: UNKNOWN_DATA_POLICY,
  nestedGameMapKind: WARZONE_GAME_MAP_WRITE_INTENT.kind,
  nestedUnknownDataPolicy: WARZONE_GAME_MAP_WRITE_INTENT.unknownDataPolicy,
  supportedUpdates: WARZONE_GAME_MAP_WRITE_INTENT.supportedUpdates,
})

/**
 * Snapshot one complete native WZ source into a standard one-file Save As ChangeSet. The source
 * bytes are copied into the immutable change; the target is a separately revision-pinned
 * destination namespace and the writer turns that snapshot into a `create` edit.
 */
export async function snapshotWarzoneWzGameMap(options) {
  const {
    sourceBytes,
    entryPath: requestedEntryPath,
    updates,
    target,
    archiveName: requestedArchiveName,
    budget,
    signal,
  } = options
  abort(signal)
  assertBudget(budget)
  assertInlineBytes(sourceBytes, budget, 'Warzone WZ source snapshot')
  if (target?.expectedRevision?.namespaceRevision === undefined) {
    throw new TypeError('Warzone WZ Save As target must be a revision-pinned destination namespace')
  }
  if (!Array.isArray(updates)) throw new TypeError('Warzone WZ Save As updates must be an array')
  const entryPath = safeEntryPath(requestedEntryPath)
  const archiveName = safeArchiveName(requestedArchiveName)
  const snapshot = sourceBytes.slice()
  const inspected = await inspectArchive(snapshot, entryPath, budget, [signal])
  const entryBytes = await extractZipArchiveEntry(snapshot, inspected.target)
  assertInlineBytes(entryBytes, budget, 'Warzone WZ source game.map')
  const sourceContentDigest = await sha256(snapshot, [signal])
  const sourceEntryContentDigest = await sha256(entryBytes, [signal])
  abort(signal)
  return Object.freeze({
    targets: Object.freeze([target]),
    edits: Object.freeze([
      Object.freeze({
        operation: 'create',
        targetId: target.targetId,
        source: target.ownerSource,
        newPath: archiveName,
        payload: Object.freeze({ kind: 'inline', bytes: snapshot }),
      }),
    ]),
    semanticIntent: Object.freeze({
      kind: INTENT_KIND,
      sourceComplete: true,
      sourceContentDigest,
      unknownDataPolicy: UNKNOWN_DATA_POLICY,
      entryPath,
      sourceEntryContentDigest,
      gameMapEdit: Object.freeze({
        kind: WARZONE_GAME_MAP_WRITE_INTENT.kind,
        sourceComplete: true,
        sourceContentDigest: sourceEntryContentDigest,
        unknownDataPolicy: WARZONE_GAME_MAP_WRITE_INTENT.unknownDataPolicy,
        updates: Object.freeze(updates.map(update => Object.freeze({ ...update }))),
      }),
    }),
    provenance: Object.freeze({
      actor: 'user',
      note: 'bounded native Warzone WZ preserving Save As',
    }),
  })
}
