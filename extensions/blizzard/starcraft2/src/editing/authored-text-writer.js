import {
  decodeStructuredText,
  parseXmlElements,
  plausibleGalaxy,
  scanGalaxy,
} from '../galaxy/codec.js'

const PROVIDER_ID = 'org.modkitx.blizzard/sc2-authored-text-writers'
const encoder = new TextEncoder()

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

const abort = signal => {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function validateStrings(text, budget) {
  let entries = 0
  for (const raw of text.split(/\r\n|\r|\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('//') || line.startsWith('#')) continue
    const separator = raw.indexOf('=')
    if (separator < 1) {
      throw new TypeError('SC2 strings contains a non-empty line without a key/value separator')
    }
    if (raw.slice(0, separator).trim() === '') {
      throw new TypeError('SC2 strings contains an empty key')
    }
    entries += 1
    if (entries > budget.maxNodes) {
      throw new RangeError('SC2 string entries exceed maxNodes budget')
    }
  }
  if (entries === 0) throw new TypeError('SC2 strings contains no key/value entries')
}

const FORMATS = Object.freeze({
  galaxy: Object.freeze({
    offerId: 'galaxy-source',
    evidenceId: 'sc2-galaxy-writer-v1',
    label: 'Galaxy',
    validate(text, budget) {
      if (!plausibleGalaxy(text)) throw new TypeError('Galaxy source has no declaration')
      scanGalaxy(text, budget)
    },
  }),
  'sc2-strings': Object.freeze({
    offerId: 'sc2-strings-source',
    evidenceId: 'sc2-strings-writer-v1',
    label: 'SC2 strings',
    validate: validateStrings,
  }),
  'sc2-layout': Object.freeze({
    offerId: 'sc2-layout-source',
    evidenceId: 'sc2-layout-writer-v1',
    label: 'SC2Layout',
    validate(text, budget) {
      parseXmlElements(text, budget, 'Desc', 'SC2Layout')
    },
  }),
  'sc2-data': Object.freeze({
    offerId: 'sc2-data-source',
    evidenceId: 'sc2-data-writer-v1',
    label: 'SC2 GameData',
    validate(text, budget) {
      parseXmlElements(text, budget, 'Catalog', 'SC2 GameData')
    },
  }),
  'sc2-triggers': Object.freeze({
    offerId: 'sc2-triggers-source',
    evidenceId: 'sc2-triggers-writer-v1',
    label: 'SC2 TriggerData',
    validate(text, budget) {
      parseXmlElements(text, budget, 'TriggerData', 'SC2 TriggerData')
    },
  }),
  'sc2-bank': Object.freeze({
    offerId: 'sc2-bank-unsigned-source',
    evidenceId: 'sc2-bank-unsigned-writer-v1',
    label: 'unsigned SC2 bank',
    validate(text, budget) {
      parseXmlElements(text, budget, 'Bank', 'SC2 bank')
      if (/<Signature\b/iu.test(text)) {
        throw new TypeError('signed SC2 banks require signing support and are read-only')
      }
    },
  }),
})

const FORMATS_BY_OFFER = new Map(
  Object.entries(FORMATS).map(([formatId, specification]) => [
    specification.offerId,
    Object.freeze({ formatId, ...specification }),
  ]),
)

function payloadBytes(payload) {
  if (payload.kind === 'text') return encoder.encode(payload.text)
  if (payload.kind === 'inline') return payload.bytes
  throw new TypeError('SC2 authored text writers require an inline complete source snapshot')
}

function validationOf(specification, change, context, signal) {
  abort(context.signal)
  abort(signal)
  const diagnostics = []
  if (change.targets.length !== 1 || change.edits.length !== 1) {
    diagnostics.push(
      error(
        'org.modkitx.blizzard/sc2-writer-single-snapshot-required',
        'an SC2 authored-text save requires exactly one target and one complete-source replacement',
      ),
    )
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) })
  }
  const target = change.targets[0]
  const edit = change.edits[0]
  if (
    edit.operation !== 'replace' ||
    edit.range !== undefined ||
    edit.targetId !== target.targetId ||
    edit.source.id !== target.ownerSource.id
  ) {
    diagnostics.push(
      error(
        'org.modkitx.blizzard/sc2-writer-edit-shape-unsupported',
        'SC2 authored-text saves accept one whole-source replace on their own target',
      ),
    )
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) })
  }
  const intent = record(change.semanticIntent)
  if (
    intent?.kind !== 'sc2-authored-text-save-v1' ||
    intent.formatId !== specification.formatId ||
    intent.sourceComplete !== true ||
    intent.unknownDataPolicy !== 'preserve-from-complete-snapshot'
  ) {
    diagnostics.push(
      error(
        'org.modkitx.blizzard/sc2-writer-complete-snapshot-required',
        'the writer requires a complete source snapshot and the preserve-from-complete-snapshot policy',
      ),
    )
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) })
  }
  if (specification.formatId === 'sc2-bank' && intent.originalSignaturePresent !== false) {
    diagnostics.push(
      error(
        'org.modkitx.blizzard/sc2-bank-signature-unsupported',
        'a signed or signature-unknown SC2 bank is read-only until signing is implemented',
      ),
    )
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) })
  }
  try {
    const bytes = payloadBytes(edit.payload)
    const maxInputBytes = context.budgets.maxInputBytes
    if (BigInt(bytes.byteLength) > maxInputBytes) {
      throw new RangeError(`${specification.label} exceeds maxInputBytes budget`)
    }
    const text = decodeStructuredText(bytes, context.budgets, specification.label)
    abort(context.signal)
    abort(signal)
    specification.validate(text, context.budgets)
    abort(context.signal)
    abort(signal)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    diagnostics.push(
      error(
        'org.modkitx.blizzard/sc2-writer-source-invalid',
        cause instanceof Error ? cause.message : String(cause),
      ),
    )
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) })
}

function writerFor(specification, context) {
  const identity = Object.freeze({
    providerId: PROVIDER_ID,
    providerVersion: '1.0.0',
    artifactDigest: 'x3:org.modkitx.blizzard/sc2-authored-text-writers@1.0.0',
    formatId: specification.formatId,
    representationId: 'source',
  })
  const fidelity = Object.freeze({
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    notes: Object.freeze([
      'the complete edited UTF-8 snapshot is committed literally without normalization',
      'comments, whitespace, unknown XML nodes and unknown Galaxy/string text survive when retained by the editor snapshot',
    ]),
  })
  return Object.freeze({
    identity,
    offer: Object.freeze({
      providerId: PROVIDER_ID,
      fidelityEvidenceId: specification.evidenceId,
      formatId: specification.formatId,
      representationId: 'source',
      mutationMode: 'mutate',
      minimumRoundTrip: 'byte-identical',
    }),
    async validate(change, signal) {
      return validationOf(specification, change, context, signal)
    },
    async plan(change, signal) {
      const validation = validationOf(specification, change, context, signal)
      if (!validation.valid) {
        throw new TypeError(validation.diagnostics.map(item => item.message).join('; '))
      }
      return Object.freeze({
        planId: `${PROVIDER_ID}:${specification.formatId}:${change.targets[0].targetId}`,
        targets: change.targets,
        edits: change.edits,
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
  const specification = FORMATS_BY_OFFER.get(selection.offerId)
  if (selection.contract !== 'common.edit/writer' || selection.major !== 1 || !specification) {
    throw new TypeError(`unknown SC2 authored-text writer offer ${selection.offerId}`)
  }
  const writer = writerFor(specification, context)
  return Object.freeze({ value: writer, release: async () => undefined })
}
