/**
 * The UVM export writer (block 11, slice 11C1, ADR-UV-001 path A for the durable-write half).
 *
 * There is exactly one way bytes reach a source in this platform — `common.edit/writer@1` plus the
 * host commit coordinator — and a materializer is not an exception to it. This module is that one
 * way for UVM: `mutationMode: 'export-only'`, because materialising never mutates the model it read
 * from, and `roundTrip: 'semantic'`, because a UVM artifact carries the model's semantics and not
 * the source file's bytes.
 *
 * Like every other writer here it is a pass-through with validation: the bytes are authored by
 * `materializer.js`, which is the only module that knows how to write UVM, and this writer states
 * what it can carry — a `create` of a new artifact on this change set's own target — and refuses
 * anything else with a diagnostic rather than silently dropping it. A `replace` is refused on
 * purpose: overwriting an existing file is a mutation, and this offer does not claim one.
 *
 * Nothing here writes. The module requests no permission classes; the coordinator commits under
 * `write-source`.
 */
import { defineWriter } from '../support.js'

const PROVIDER_ID = 'org.modkitx/uvm-writer'
const EVIDENCE_ID = 'uv-materializer-uvm-writer-v1'
/** A module cannot see its own artifact digest; the host inventory carries the attested one. */
const ARTIFACT_DIGEST = 'x3:org.modkitx/uvm-writer@1.0.0'

const PAYLOAD_KINDS = Object.freeze(['inline', 'staged'])

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

function validateExport(change) {
  const diagnostics = []
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error(
        'org.modkitx/uvm-writer-change-empty',
        'a change set must carry at least one target and one edit',
      ),
    )
  }
  const targetIds = new Set(change.targets.map(target => target.targetId))
  for (const edit of change.edits) {
    if (edit.operation !== 'create') {
      diagnostics.push(
        error(
          'org.modkitx/uvm-writer-operation-unsupported',
          `a UVM export creates a new artifact: «${edit.operation}» is not an export-only edit`,
        ),
      )
      continue
    }
    if (!targetIds.has(edit.targetId)) {
      diagnostics.push(
        error(
          'org.modkitx/uvm-writer-target-foreign',
          `edit target «${edit.targetId}» is not a target of this change set`,
        ),
      )
      continue
    }
    if (typeof edit.newPath !== 'string' || edit.newPath.trim() === '') {
      diagnostics.push(
        error('org.modkitx/uvm-writer-path-missing', 'a create edit must name the path it writes'),
      )
    }
    if (!PAYLOAD_KINDS.includes(edit.payload?.kind)) {
      diagnostics.push(
        error(
          'org.modkitx/uvm-writer-payload-unsupported',
          `UVM bytes arrive inline or staged, not as «${String(edit.payload?.kind)}»`,
        ),
      )
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) })
}

export const writerModule = defineWriter({
  providerId: PROVIDER_ID,
  artifactDigest: ARTIFACT_DIGEST,
  offerId: 'uvm-source',
  formatId: 'uvm',
  representationId: 'source',
  mutationMode: 'export-only',
  minimumRoundTrip: 'semantic',
  fidelityEvidenceId: EVIDENCE_ID,
  fidelity: Object.freeze({
    roundTrip: 'semantic',
    preservesUnknownData: false,
    notes: Object.freeze([
      'a UVM artifact carries the model semantics of the scope it was materialized under; it does not preserve the source file bytes, and the MaterializationReceipt enumerates what was left behind',
    ]),
  }),
  validate: change => Promise.resolve(validateExport(change)),
  planEdits: change => {
    const result = validateExport(change)
    if (!result.valid) {
      throw new TypeError(result.diagnostics.map(item => item.message).join('; '))
    }
    return Promise.resolve(Object.freeze([...change.edits]))
  },
})

export const { abiVersion, provides, createProvider } = writerModule
