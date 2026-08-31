/**
 * The UVT export writer (block 12, slice 12-1; ADR-UV-001 path A for the durable-write half).
 *
 * There is exactly one way bytes reach a source in this platform — `common.edit/writer@1` plus the
 * host commit coordinator — and a texture materializer is not an exception to it. This module is
 * that one way for UVT: `mutationMode: 'export-only'`, because materialising never mutates the
 * image it read from, and `roundTrip: 'lossy'`, which is the honest claim for this path.
 *
 * `lossy` rather than the UVM writer's `semantic`, and the difference is not modesty. A UVM
 * artifact carries the model semantics of its scope and a reopened document reproduces them; a UVT
 * container written from one decoded region carries the base level of an image whose mip chain,
 * array layers and cube faces were not written, and whose pixels arrived already requantised to
 * eight bits. Declaring `semantic` here would promise a round trip the format cannot make.
 *
 * A texture export writes two artifacts — the container and its `.uvt.json` sidecar — so a change
 * set carrying two `create` edits is normal and expected. Anything that is not a `create` is
 * refused: overwriting an existing file is a mutation, and this offer does not claim one.
 *
 * Nothing here writes. The module requests no permission classes; the coordinator commits under
 * `write-source`.
 */
import { defineWriter } from '../support.js'

const PROVIDER_ID = 'modkit/uvt-writer'
const EVIDENCE_ID = 'uv-materializer-uvt-writer-v1'
/** A module cannot see its own artifact digest; the host inventory carries the attested one. */
const ARTIFACT_DIGEST = 'x3:modkit/uvt-writer@1.0.0'

const PAYLOAD_KINDS = Object.freeze(['inline', 'staged'])

const error = (code, message) => Object.freeze({ severity: 'error', code, message })

function validateExport(change) {
  const diagnostics = []
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error(
        'modkit/uvt-writer-change-empty',
        'a change set must carry at least one target and one edit',
      ),
    )
  }
  const targetIds = new Set(change.targets.map(target => target.targetId))
  for (const edit of change.edits) {
    if (edit.operation !== 'create') {
      diagnostics.push(
        error(
          'modkit/uvt-writer-operation-unsupported',
          `a UVT export creates new artifacts: «${edit.operation}» is not an export-only edit`,
        ),
      )
      continue
    }
    if (!targetIds.has(edit.targetId)) {
      diagnostics.push(
        error(
          'modkit/uvt-writer-target-foreign',
          `edit target «${edit.targetId}» is not a target of this change set`,
        ),
      )
      continue
    }
    if (typeof edit.newPath !== 'string' || edit.newPath.trim() === '') {
      diagnostics.push(
        error('modkit/uvt-writer-path-missing', 'a create edit must name the path it writes'),
      )
      continue
    }
    /*
     * The two extensions the profile names, checked rather than assumed. A container written as
     * `.uvt.json` or a sidecar written as `.ktx2` would still be valid bytes and a broken pair, and
     * the pairing is the whole reason the sidecar is worth having.
     */
    if (!edit.newPath.endsWith('.uvt.ktx2') && !edit.newPath.endsWith('.uvt.json')) {
      diagnostics.push(
        error(
          'modkit/uvt-writer-path-unexpected',
          `a UVT export writes «<name>.uvt.ktx2» and «<name>.uvt.json»; «${edit.newPath}» is neither`,
        ),
      )
    }
    if (!PAYLOAD_KINDS.includes(edit.payload?.kind)) {
      diagnostics.push(
        error(
          'modkit/uvt-writer-payload-unsupported',
          `UVT bytes arrive inline or staged, not as «${String(edit.payload?.kind)}»`,
        ),
      )
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) })
}

export const writerModule = defineWriter({
  providerId: PROVIDER_ID,
  artifactDigest: ARTIFACT_DIGEST,
  offerId: 'uvt-source',
  formatId: 'uvt',
  representationId: 'source',
  mutationMode: 'export-only',
  minimumRoundTrip: 'lossy',
  fidelityEvidenceId: EVIDENCE_ID,
  fidelity: Object.freeze({
    roundTrip: 'lossy',
    preservesUnknownData: false,
    notes: Object.freeze([
      'a UVT container carries the base level of the image it was written from, in the colour, alpha and orientation semantics the source declared; mip chains, array layers, cube faces and frame sequences are not written, and the MaterializationReceipt enumerates each one that existed',
      'the sidecar is a description of the container and never a second source of truth: every field of its ktx2 block is a copy of a value that exists in the file',
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
