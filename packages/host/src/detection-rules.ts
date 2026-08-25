/**
 * The untie rules of codec detection, as data (block 12, item 4 — the collision suite).
 *
 * Every rule here was already enforced somewhere in this package; none of them was written down,
 * and that is what this file changes. The cost of an unwritten untie rule is not theoretical: two
 * codecs that both answered a valid file with *exactly* the same confidence made the host refuse to
 * choose, and an `.odt`, a `.wz` and an `.rtf` did not open at all in any composition that loaded
 * both of their claimants. Nobody had written down that a carrier must rank below its passengers,
 * so nobody noticed that it did not.
 *
 * This module is deliberately inert. It exports no logic and changes no behaviour — the rules are
 * enforced where they always were, and `enforcedBy` names that place. What it buys is a list a
 * codec author can read before choosing a number, and a list the collision suite can iterate: every
 * rule below has at least one case in `packages/testkit/test/detection-collisions.test.ts`, and a
 * rule with no case is a rule nobody is holding.
 *
 * The normative prose belongs to the plan (§3.6 item 9). This is its machine form, not a second
 * authority: where the two disagree, the plan is right and this file is stale.
 */

export interface DetectionUntieRule {
  /** Stable id; the collision suite cites it, so renaming one is a visible change. */
  readonly id: string
  readonly rule: string
  /** The module that actually enforces it. Prose without a site is a wish. */
  readonly enforcedBy: string
}

/**
 * How much a codec knows about the bytes it just read, weakest first.
 *
 * The ladder is ordinal on purpose: the numbers a codec returns are its own business, and pinning a
 * band per rung here would turn every codec's detection into an edit of this file. What the ladder
 * fixes is the *ordering* between two codecs looking at the same bytes — which is the only thing a
 * tie can be wrong about.
 */
export type DetectionEvidenceRung =
  /** The file name, and nothing else. Never enough to open a subject on its own. */
  | 'name-only'
  /** The bytes parse as a general syntax (UTF-8 text, XML, JSON) with no format-specific marker. */
  | 'generic-syntax'
  /** A magic number shared by a whole family of formats — ZIP, RIFF, glTF. */
  | 'carrier-magic'
  /** A general syntax plus a marker only this format uses. */
  | 'generic-syntax-and-format-marker'
  /** A carrier magic plus a structure only this format writes into it. */
  | 'carrier-magic-and-format-structure'
  /** A magic number belonging to this format alone. */
  | 'format-magic'
  /** This format's own magic plus a second independent signal, such as its declared extension. */
  | 'format-magic-and-second-signal'

/** The ladder in order, weakest to strongest. Position is the whole meaning of the value. */
export const DETECTION_EVIDENCE_LADDER: readonly DetectionEvidenceRung[] = Object.freeze([
  'name-only',
  'generic-syntax',
  'carrier-magic',
  'generic-syntax-and-format-marker',
  'carrier-magic-and-format-structure',
  'format-magic',
  'format-magic-and-second-signal',
])

/** Rung comparison; `-1`, `0` or `1`. Throws on an id the ladder does not carry. */
export function compareDetectionEvidence(
  left: DetectionEvidenceRung,
  right: DetectionEvidenceRung,
): number {
  const a = DETECTION_EVIDENCE_LADDER.indexOf(left)
  const b = DETECTION_EVIDENCE_LADDER.indexOf(right)
  if (a < 0 || b < 0) throw new TypeError(`unknown detection evidence rung: ${left} / ${right}`)
  return a === b ? 0 : a < b ? -1 : 1
}

export const DETECTION_UNTIE_RULES: readonly DetectionUntieRule[] = Object.freeze([
  Object.freeze({
    id: 'strictly-highest-confidence-wins',
    rule: 'Among candidates at or above the host confidence floor, the one with the strictly highest confidence is selected. There is no secondary ranking by extension id, contribution status, implementation tier or load order.',
    enforcedBy: 'packages/host/src/subject-open.ts',
  }),
  Object.freeze({
    id: 'an-exact-tie-is-ambiguous',
    rule: 'Two or more candidates sharing the top confidence resolve to `unresolved` with reason `ambiguous`. The host never breaks a tie by sort order: a stable sort would make the winner depend on which extension happened to load first, which is a coin toss wearing a rule.',
    enforcedBy: 'packages/host/src/subject-open.ts',
  }),
  Object.freeze({
    id: 'below-the-floor-is-no-match',
    rule: 'A candidate under the host confidence floor is not eligible at all, so a lone weak guess produces `no-match` rather than an open nobody can justify.',
    enforcedBy: 'packages/host/src/subject-open.ts',
  }),
  Object.freeze({
    id: 'a-carrier-ranks-below-its-passengers',
    rule: 'A codec that matched only a carrier magic (ZIP, RIFF) or only a general syntax (UTF-8 text, XML, JSON) must score below a codec that matched the same bytes *and* a structure specific to its own format. The generic route is the fallback for bytes nobody claimed, never the winner over a format that read more.',
    enforcedBy:
      'the detecting codecs; the ordering is proved in packages/testkit/test/detection-collisions.test.ts',
  }),
  Object.freeze({
    id: 'a-second-signal-breaks-a-would-be-tie',
    rule: 'Where two routes read the same evidence, the one that also reads an independent second signal — typically the declared extension — ranks above it. This is how a relocated port beats the staging route it replaces without either of them inventing evidence.',
    enforcedBy:
      'the detecting codecs; proved in packages/testkit/test/common-documents-rtf.test.ts',
  }),
  Object.freeze({
    id: 'an-extension-alone-never-decides',
    rule: 'The file name may add margin to a candidate that already read the bytes; it may never carry one over the confidence floor by itself. A renamed file is decided by its content, and a correctly named file whose content disagrees is refused.',
    enforcedBy:
      'the detecting codecs; proved in packages/testkit/test/detection-collisions.test.ts',
  }),
  Object.freeze({
    id: 'a-foreign-format-scores-zero-not-low',
    rule: 'Bytes that positively declare a *different* format are a refusal, not a weak match: an ODP renamed to `.odt` scores zero rather than a hedged number, so it can never win by being the only candidate left.',
    enforcedBy: 'extensions/common/documents/src/odf/package.js and its peers',
  }),
  Object.freeze({
    id: 'a-signature-shortlists-but-does-not-select',
    rule: 'A declared byte signature only puts a contribution in front of the probe — a renamed `.dat` PNG reaches the PNG probe. Selection is still decided by the probe result, so a signature can never open a subject on its own.',
    enforcedBy: 'packages/host/src/detection-index.ts',
  }),
])

/** True for a rule id this build carries; the suite uses it to refuse a citation that has drifted. */
export function isDetectionUntieRule(id: string): boolean {
  return DETECTION_UNTIE_RULES.some(rule => rule.id === id)
}
