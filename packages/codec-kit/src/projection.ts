import type { ProjectionReceipt } from '@modkit/sdk'

/** Metadata group id every codec publishes its projection receipt under. */
export const PROJECTION_RECEIPT_METADATA_ID = 'uv-projection-receipt'

const PLANE_STATES = new Set(['normalized', 'preserved', 'inferred', 'lost'])
const CONFIDENCES = new Set(['exact', 'high', 'partial', 'heuristic'])

/**
 * Build the local `ProjectionReceipt` a codec emits when it opens a subject.
 *
 * Checked rather than trusted: a plane state outside the four §2.6 distinguishes, or a receipt with
 * no plane and no evidence at all, is refused here instead of reaching a consumer as a receipt that
 * says nothing. `inferred` stays separate from `normalized` because a value the adapter computed is
 * not the same fact as one it converted.
 */
export function createProjectionReceipt(
  receipt: Omit<ProjectionReceipt, 'form' | 'sourceIdentity'>,
): ProjectionReceipt {
  const planes = [...(receipt.planes ?? [])]
  if (planes.length === 0)
    throw new TypeError('a projection receipt must record at least one plane')
  for (const plane of planes) {
    if (!PLANE_STATES.has(plane.state)) {
      throw new TypeError(`projection plane «${plane.planeId}» has an unknown state ${plane.state}`)
    }
  }
  if (!CONFIDENCES.has(receipt.confidence)) {
    throw new TypeError(`projection receipt has an unknown confidence ${receipt.confidence}`)
  }
  if ((receipt.evidence ?? []).length === 0) {
    throw new TypeError(
      'a projection receipt made of no evidence is a claim with nothing behind it; state at least one declared or observed fact',
    )
  }
  return Object.freeze<ProjectionReceipt>({
    form: 'local',
    adapter: Object.freeze({ ...receipt.adapter }),
    subjectRevision: receipt.subjectRevision,
    companions: Object.freeze((receipt.companions ?? []).map(item => Object.freeze({ ...item }))),
    basis: Object.freeze({ ...receipt.basis }),
    planes: Object.freeze(planes.map(plane => Object.freeze({ ...plane }))),
    evidence: Object.freeze(receipt.evidence.map(item => Object.freeze({ ...item }))),
    confidence: receipt.confidence,
    ...(receipt.semanticHash === undefined ? {} : { semanticHash: receipt.semanticHash }),
    ...(receipt.sourceUri === undefined ? {} : { sourceUri: receipt.sourceUri }),
  })
}
