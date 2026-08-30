/**
 * A6 — the JSON/JSONC text writer (ADR-HOST-002 Path B, `common.edit/writer@1`).
 *
 * Text edits are authored by the universal text editor, not by this extension: the editor already
 * holds the source and hands the host a `ChangeSet` describing what to put where. The writer's
 * honest job is therefore pass-through with validation — it states what it can carry (a `replace`
 * on this change set's own target, either whole-source or over a UTF-16/byte range, with a
 * payload the host can read without a staging store) and refuses anything else with a diagnostic
 * instead of silently dropping it. A range edit touches only the range it names, so the claim is
 * `byte-identical` with `preservesUnknownData`.
 *
 * Nothing here writes: the module requests no permission classes and the host coordinator commits
 * under `write-source`. Both formats of this extension share this module; `createProvider`
 * dispatches on the resolved `offerId`.
 */
import { defineWriter } from '@modkitx-x3/codec-kit'

const PROVIDER_ID = 'org.modkitx/text-json-writer'
const EVIDENCE_ID = 'text-json-text-writer-v1'
/** A module cannot see its own artifact digest; the host inventory carries the attested one. */
const ARTIFACT_DIGEST = 'x3:org.modkitx/text-json-writer@1.0.0'

/** Range kinds a text source can splice. `utf16` is what a text editor authors. */
const RANGE_KINDS = Object.freeze(['utf16', 'bytes'])
/** Payload kinds the coordinator reads inline; `staged` needs a store a text edit never needs. */
const PAYLOAD_KINDS = Object.freeze(['text', 'inline'])

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

/** The text change-set contract of every offer in this module, stated as diagnostics. */
function validateTextChange(change) {
  const diagnostics = []
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error(
        'org.modkitx/text-writer-change-empty',
        'a change set must carry at least one target and one edit',
      ),
    )
  }
  const targetIds = new Set(change.targets.map(target => target.targetId))
  const sourceIds = new Set(change.targets.map(target => target.ownerSource.id))
  for (const edit of change.edits) {
    if (edit.operation !== 'replace') {
      diagnostics.push(
        error(
          'org.modkitx/text-writer-operation-unsupported',
          `a text writer rewrites its own source: «${edit.operation}» is not a text edit`,
        ),
      )
      continue
    }
    if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
      diagnostics.push(
        error(
          'org.modkitx/text-writer-target-foreign',
          `edit target «${edit.targetId}» is not a target of this change set`,
        ),
      )
      continue
    }
    if (edit.range !== undefined && !RANGE_KINDS.includes(edit.range.kind)) {
      diagnostics.push(
        error(
          'org.modkitx/text-writer-range-unsupported',
          `«${edit.range.kind}» is not a text range (utf16 or bytes)`,
        ),
      )
      continue
    }
    if (!PAYLOAD_KINDS.includes(edit.payload.kind)) {
      diagnostics.push(
        error(
          'org.modkitx/text-writer-payload-unsupported',
          `«${edit.payload.kind}» payloads are not readable inline (text or inline)`,
        ),
      )
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) })
}

/** Pass-through: the editor authored the edits; the writer only refuses what it cannot carry. */
async function planTextEdits(change) {
  const result = validateTextChange(change)
  if (!result.valid) {
    throw new TypeError(result.diagnostics.map(item => item.message).join('; '))
  }
  return change.edits
}

/**
 * Whole-source syntax check, where one is possible with what every runtime has.
 *
 * A writer's `validate` sees only the ChangeSet — never the source bytes — so a *range* edit can
 * never be syntax-checked here: splicing three characters into a document you cannot read proves
 * nothing about the result. A *whole-source* text payload is different: the payload IS the entire
 * future file, and refusing a payload that is not valid JSON is the one moment the user can still
 * do something about it — the raw byte splicer would put the corruption on disk.
 *
 * Only the strict `json` offer checks today, because `JSON.parse` is the one parser every runtime
 * ships. `jsonc` deliberately does not: its comment-tolerant parser (`jsonc-parser`) is not
 * vendored for browser workers, and importing it here — even behind a literal dynamic import —
 * would make the verified loader refuse this whole module in the browser, taking the PWA's text
 * saves with it. When that parser is vendored, this hook is where it plugs in.
 */
function jsonSyntaxDiagnostics(change) {
  for (const edit of change.edits) {
    if (edit.operation !== 'replace' || edit.range !== undefined) continue
    if (edit.payload.kind !== 'text') continue
    try {
      JSON.parse(edit.payload.text)
    } catch (cause) {
      return [
        error(
          'org.modkitx/text-writer-syntax-invalid',
          `the replacement is not valid JSON, and saving it would corrupt the file: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
      ]
    }
  }
  return []
}

const textWriter = (formatId, syntaxDiagnostics) =>
  defineWriter({
    providerId: PROVIDER_ID,
    providerVersion: '1.0.0',
    artifactDigest: ARTIFACT_DIGEST,
    offerId: `${formatId}-source`,
    formatId,
    representationId: 'source',
    mutationMode: 'mutate',
    minimumRoundTrip: 'byte-identical',
    fidelityEvidenceId: EVIDENCE_ID,
    fidelity: Object.freeze({ roundTrip: 'byte-identical', preservesUnknownData: true }),
    validate: async change => {
      const carried = validateTextChange(change)
      if (!carried.valid || syntaxDiagnostics === undefined) return carried
      const syntax = syntaxDiagnostics(change)
      return syntax.length === 0
        ? carried
        : Object.freeze({ valid: false, diagnostics: Object.freeze(syntax) })
    },
    planEdits: async change => {
      // plan re-validates, so a caller that skips propose still cannot commit a refused change
      const syntax = syntaxDiagnostics === undefined ? [] : syntaxDiagnostics(change)
      if (syntax.length > 0) {
        throw new TypeError(syntax.map(item => item.message).join('; '))
      }
      return planTextEdits(change)
    },
  })

/** offerId → the single-format writer module that serves it. */
const OFFERS = Object.freeze({
  'json-source': textWriter('json', jsonSyntaxDiagnostics),
  'jsonc-source': textWriter('jsonc'),
})

export const abiVersion = 1
export const provides = Object.freeze(['common.edit/writer'])
export async function createProvider(selection) {
  const offered = OFFERS[selection.offerId]
  if (offered === undefined) throw new TypeError(`unknown writer offer ${selection.offerId}`)
  return offered.createProvider(selection)
}
