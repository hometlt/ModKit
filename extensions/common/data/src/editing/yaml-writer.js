/**
 * A6 — the YAML text writer (ADR-HOST-002 Path B, `common.edit/writer@1`).
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
 * under `write-source`.
 */
import { defineWriter } from '@modkitx-x3/codec-kit'

const PROVIDER_ID = 'org.modkitx/text-yaml-writer'

/** Range kinds a text source can splice. `utf16` is what a text editor authors. */
const RANGE_KINDS = Object.freeze(['utf16', 'bytes'])
/** Payload kinds the coordinator reads inline; `staged` needs a store a text edit never needs. */
const PAYLOAD_KINDS = Object.freeze(['text', 'inline'])

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

/** The text change-set contract of this writer, stated as diagnostics. */
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

export const { abiVersion, provides, createProvider } = defineWriter({
  providerId: PROVIDER_ID,
  providerVersion: '1.0.0',
  /** A module cannot see its own artifact digest; the host inventory carries the attested one. */
  artifactDigest: 'x3:org.modkitx/text-yaml-writer@1.0.0',
  offerId: 'yaml-source',
  formatId: 'yaml',
  representationId: 'source',
  mutationMode: 'mutate',
  minimumRoundTrip: 'byte-identical',
  fidelityEvidenceId: 'text-yaml-text-writer-v1',
  fidelity: Object.freeze({ roundTrip: 'byte-identical', preservesUnknownData: true }),
  validate: async change => validateTextChange(change),
  /** Pass-through: the editor authored the edits; the writer only refuses what it cannot carry. */
  planEdits: async change => {
    const result = validateTextChange(change)
    if (!result.valid) throw new TypeError(result.diagnostics.map(item => item.message).join('; '))
    return change.edits
  },
})
