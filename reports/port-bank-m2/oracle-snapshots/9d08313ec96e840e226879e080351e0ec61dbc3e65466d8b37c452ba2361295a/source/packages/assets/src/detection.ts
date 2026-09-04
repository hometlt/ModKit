/**
 * Detection, evidence, ranking, and ambiguity — `ASSET_CAPABILITIES.md` section 7 plus the
 * canonical architecture section 5 pipeline.
 *
 * "A filename extension only selects candidates; it never proves a format, semantic artifact,
 * or game identity" (pipeline rule 1). "Evidence, confidence, rejected candidates, and
 * ambiguity are structured data. Valid alternate routes remain available through Open With"
 * (pipeline rule 3). "If candidates remain close after bounded detection, the resolver returns
 * an ambiguity result instead of guessing" (section 7).
 */

import type { AssetDiagnostic } from './diagnostics.js'
import type { SourceRange } from './source.js'

/**
 * Evidence kinds from `ASSET_CAPABILITIES.md` section 7: "validated magic, structure, companion
 * relationship, semantic context, extension, and user override", plus `path` for the
 * directory-layout and path-glob prefilters the pipeline collects candidates from.
 */
export const DETECTION_EVIDENCE_KINDS = [
  'user-override',
  'structure',
  'magic',
  'companion',
  'context',
  'path',
  'extension',
] as const

export type DetectionEvidenceKind = (typeof DETECTION_EVIDENCE_KINDS)[number]

/**
 * Relative strength of each evidence kind. "Extension-only matches have lower confidence than
 * validated structure. A negative structural check must outweigh extension" — encoded here as
 * a strict tier ordering plus the negative-evidence rule in {@link rankDetectionCandidates}.
 */
const EVIDENCE_WEIGHT: Readonly<Record<DetectionEvidenceKind, number>> = {
  'user-override': 100,
  structure: 80,
  magic: 60,
  companion: 40,
  context: 25,
  path: 15,
  extension: 10,
}

export function detectionEvidenceWeight(kind: DetectionEvidenceKind): number {
  return EVIDENCE_WEIGHT[kind]
}

export interface DetectionEvidence {
  readonly kind: DetectionEvidenceKind
  /**
   * `'negative'` records a check that *rejects* the candidate (a failed structural probe, a
   * companion proving another interpretation). Defaults to `'positive'`.
   */
  readonly polarity?: 'positive' | 'negative'
  /** Stable, short explanation, e.g. `magic DDS `, `root element Catalog`. */
  readonly detail?: string
  /** Bytes the evidence was taken from, for hex-view cross-linking and reproducibility. */
  readonly range?: SourceRange
}

/** `ASSET_CAPABILITIES.md` section 7, verbatim. */
export interface DetectionResult {
  /** Selected codec ID; the v1 field name is retained for wire compatibility. */
  readonly pluginId: string
  /** `0..1`. Extension-only matches must stay well below validated structure. */
  readonly confidence: number
  readonly evidence: readonly DetectionEvidence[]
  /** Ranges the detector actually needed; bounds the sniff budget and enables replay. */
  readonly requiredRanges: readonly SourceRange[]
  readonly diagnostics?: readonly AssetDiagnostic[]
}

/** A ranked interpretation of one source. Alternates stay reachable through **Open With**. */
export interface AssetCandidate {
  readonly detection: DetectionResult
  /** Display label for the Open With list, e.g. `Relic chunk tree`. */
  readonly label?: string
  /** Explicit codec priority; only breaks ties between equally supported candidates. */
  readonly priority?: number
}

export type CandidateRejectionCode =
  | 'negative-structure'
  | 'low-confidence'
  | 'unsupported-source-kind'
  | 'host-unsupported'
  | 'beyond-alternate-budget'

export interface RejectedCandidate {
  readonly pluginId: string
  readonly code: CandidateRejectionCode
  readonly detail?: string
  readonly evidence?: readonly DetectionEvidence[]
}

/**
 * The structured outcome of detection. `ambiguous` is a first-class result, not an error: the
 * host can ask the user or open a safe generic view.
 */
export type AssetRoute =
  | {
      readonly status: 'resolved'
      readonly primary: AssetCandidate
      /** Bounded, valid alternate interpretations, best first. */
      readonly alternates: readonly AssetCandidate[]
      readonly rejected: readonly RejectedCandidate[]
    }
  | {
      readonly status: 'ambiguous'
      /** Two or more candidates that stayed too close to choose between, best first. */
      readonly candidates: readonly AssetCandidate[]
      readonly rejected: readonly RejectedCandidate[]
    }
  | {
      readonly status: 'unrecognized'
      readonly rejected: readonly RejectedCandidate[]
    }

export interface DetectionRankingOptions {
  /** Candidates below this confidence are rejected outright. */
  readonly minimumConfidence?: number
  /**
   * Confidence window within which the two best candidates count as "close". A tie is only
   * reported as ambiguous when the candidates also share the same strongest evidence tier —
   * validated structure always beats a merely equal-confidence extension match.
   */
  readonly ambiguityMargin?: number
  /** Bound on retained alternates (pipeline: "one primary plus bounded valid alternates"). */
  readonly maxAlternates?: number
}

const DEFAULT_MINIMUM_CONFIDENCE = 0.05
const DEFAULT_AMBIGUITY_MARGIN = 0.05
const DEFAULT_MAX_ALTERNATES = 4

/** Strongest positive evidence tier a candidate carries; `0` when it has none. */
export function candidateEvidenceTier(candidate: AssetCandidate): number {
  let best = 0
  for (const evidence of candidate.detection.evidence) {
    if (evidence.polarity === 'negative') continue
    best = Math.max(best, EVIDENCE_WEIGHT[evidence.kind])
  }
  return best
}

function hasNegativeStructuralEvidence(candidate: AssetCandidate): boolean {
  return candidate.detection.evidence.some(
    evidence =>
      evidence.polarity === 'negative' &&
      (evidence.kind === 'structure' || evidence.kind === 'magic'),
  )
}

function hasUserOverride(candidate: AssetCandidate): boolean {
  return candidate.detection.evidence.some(
    evidence => evidence.kind === 'user-override' && evidence.polarity !== 'negative',
  )
}

/**
 * Deterministic ordering: user override, then evidence tier, then confidence, then explicit
 * priority, then codec ID. Confidence alone must not let an extension guess outrank a
 * validated structural match.
 */
function compareCandidates(a: AssetCandidate, b: AssetCandidate): number {
  const override = Number(hasUserOverride(b)) - Number(hasUserOverride(a))
  if (override !== 0) return override
  const tier = candidateEvidenceTier(b) - candidateEvidenceTier(a)
  if (tier !== 0) return tier
  const confidence = b.detection.confidence - a.detection.confidence
  if (confidence !== 0) return confidence
  const priority = (b.priority ?? 0) - (a.priority ?? 0)
  if (priority !== 0) return priority
  return a.detection.pluginId.localeCompare(b.detection.pluginId)
}

/**
 * Ranks detection candidates into a primary interpretation plus bounded alternates, or reports
 * ambiguity instead of guessing.
 *
 * Rules applied, in order:
 *
 * 1. a candidate with negative structural/magic evidence is rejected even if its extension
 *    matched — "a negative structural check must outweigh extension";
 * 2. candidates below `minimumConfidence` are rejected;
 * 3. remaining candidates are ordered by user override, evidence tier, confidence, explicit
 *    priority, then codec ID;
 * 4. when the two best share an evidence tier and sit within `ambiguityMargin`, and neither is
 *    a user override, the result is `ambiguous`;
 * 5. otherwise the best candidate wins and up to `maxAlternates` valid alternates are kept for
 *    **Open With**; anything beyond the budget is reported as rejected, not dropped silently.
 */
export function rankDetectionCandidates(
  candidates: readonly AssetCandidate[],
  options: DetectionRankingOptions = {},
): AssetRoute {
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN
  const maxAlternates = options.maxAlternates ?? DEFAULT_MAX_ALTERNATES

  const rejected: RejectedCandidate[] = []
  const viable: AssetCandidate[] = []
  for (const candidate of candidates) {
    if (hasNegativeStructuralEvidence(candidate)) {
      rejected.push({
        pluginId: candidate.detection.pluginId,
        code: 'negative-structure',
        evidence: candidate.detection.evidence,
      })
      continue
    }
    if (candidate.detection.confidence < minimumConfidence) {
      rejected.push({
        pluginId: candidate.detection.pluginId,
        code: 'low-confidence',
        detail: `confidence ${candidate.detection.confidence} < ${minimumConfidence}`,
      })
      continue
    }
    viable.push(candidate)
  }

  if (viable.length === 0) return { status: 'unrecognized', rejected }

  const ordered = [...viable].sort(compareCandidates)
  const [best, runnerUp] = ordered as [AssetCandidate, AssetCandidate | undefined]

  if (
    runnerUp &&
    !hasUserOverride(best) &&
    candidateEvidenceTier(best) === candidateEvidenceTier(runnerUp) &&
    Math.abs(best.detection.confidence - runnerUp.detection.confidence) <= ambiguityMargin
  ) {
    return { status: 'ambiguous', candidates: ordered, rejected }
  }

  const alternates = ordered.slice(1, 1 + maxAlternates)
  for (const overflow of ordered.slice(1 + maxAlternates)) {
    rejected.push({
      pluginId: overflow.detection.pluginId,
      code: 'beyond-alternate-budget',
      detail: `only ${maxAlternates} alternates are retained`,
    })
  }
  return { status: 'resolved', primary: best, alternates, rejected }
}
