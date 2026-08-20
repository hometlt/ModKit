/**
 * Fidelity evidence policy and the host's raw writer (ADR-HOST-002 §6, F3).
 *
 * 13D separates the author's claim (`FidelityClaim` on a plan) from proof (`FidelityEvidence` the
 * coordinator demands before any side effect): a plan whose claim has no matching evidence is
 * `fidelity-unproven` and nothing is written. Every product therefore needs an evidence policy,
 * and before this module each one hand-built evidence objects — which is how a host accidentally
 * asserts a proof it does not have.
 *
 * Two things live here:
 *
 *  - `createEvidenceRegistry` — the policy as data. A record says which writer produced which
 *    claim and what proves it (corpus, digest, conformance profile). `evidenceFor(plan)` matches
 *    a plan's claim against the records and returns nothing when no record covers it. It never
 *    upgrades a claim: a `semantic` record does not prove a `byte-identical` plan.
 *  - `createRawWriter` — the writer a host uses for editors that carry no format knowledge (the
 *    hex editor, the plain-text editor). It plans exactly the edits the editor produced: byte or
 *    UTF-16 range replacements, or a whole-source replacement. It re-encodes nothing, so its
 *    claim is `byte-identical` with `preservesUnknownData: true` — the bytes written are the bytes
 *    the user chose — and its evidence is structural (`by-construction`), which the record states
 *    plainly rather than pretending a corpus was run.
 *
 * The truncation hazard is the one thing a raw whole-source replace can get wrong: an editor that
 * loaded only the first N bytes of a large source and then saves "the whole file" would drop the
 * rest. The writer cannot see that from a `ChangeSet`, so a host that wires a bounded editor must
 * pass `allowWholeSource: false` (range edits only) or guarantee the editor holds the whole
 * source. `createRawWriter` says so in one place instead of every product rediscovering it.
 */

import { diagnostic } from '@modkitx-x3/core'
import type {
  AssetEditPlan,
  ChangeSet,
  FidelityClaim,
  FidelityEvidence,
  SourceEdit,
  ValidationResult,
  Writer,
  WriterIdentity,
  WriterOffer,
} from '@modkitx-x3/sdk'

/** Identity of the host's own raw writer (plans an editor's byte/text edits with no format code). */
export const HOST_RAW_WRITER_IDENTITY: WriterIdentity = Object.freeze({
  providerId: 'org.modkitx.host/raw-writer',
  providerVersion: '1.0.0',
  artifactDigest: 'host:raw-writer',
  formatId: '*',
  representationId: 'source',
})

const RAW_CLAIM: FidelityClaim = Object.freeze({
  roundTrip: 'byte-identical',
  preservesUnknownData: true,
})

export interface RawWriterOptions {
  /**
   * Allow an edit that replaces the entire source (an editor that holds the whole content).
   * `false` restricts the writer to range edits — the safe setting for a bounded editor that may
   * have loaded only a prefix of a large source.
   */
  readonly allowWholeSource?: boolean
  /** Format/representation the offer names; `'*'` means "whatever this subject is". */
  readonly formatId?: string
  readonly representationId?: string
  /** Overrides the plan id (default: derived from the targets). */
  readonly planId?: (change: ChangeSet) => string
}

function isRangeReplace(edit: SourceEdit): boolean {
  return edit.operation === 'replace' && edit.range !== undefined
}

/**
 * The host's format-agnostic writer: it validates that an editor's change set is expressible as
 * literal replacements and plans them unchanged. It never invents bytes, so its fidelity claim is
 * exactly what a literal write is: byte-identical, nothing dropped.
 */
export function createRawWriter(options: RawWriterOptions = {}): Writer {
  const allowWholeSource = options.allowWholeSource ?? true
  const identity: WriterIdentity = Object.freeze({
    ...HOST_RAW_WRITER_IDENTITY,
    ...(options.formatId === undefined ? {} : { formatId: options.formatId }),
    ...(options.representationId === undefined
      ? {}
      : { representationId: options.representationId }),
  })
  const offer: WriterOffer = Object.freeze({
    providerId: identity.providerId,
    fidelityEvidenceId: HOST_RAW_WRITER_EVIDENCE_ID,
    formatId: identity.formatId,
    representationId: identity.representationId,
    mutationMode: 'mutate',
    minimumRoundTrip: 'byte-identical',
  })

  const check = (change: ChangeSet): ValidationResult => {
    const targets = new Set(change.targets.map(target => target.targetId))
    const problems = []
    if (change.targets.length === 0 || change.edits.length === 0) {
      problems.push(
        diagnostic('error', 'x3.host/raw-writer-empty', 'a change set needs a target and an edit'),
      )
    }
    for (const edit of change.edits) {
      if (edit.operation !== 'replace') {
        problems.push(
          diagnostic(
            'error',
            'x3.host/raw-writer-operation-unsupported',
            `the raw writer plans replacements only; «${edit.operation}» needs a format writer`,
          ),
        )
        continue
      }
      if (!targets.has(edit.targetId)) {
        problems.push(
          diagnostic(
            'error',
            'x3.host/raw-writer-unknown-target',
            `edit names target «${edit.targetId}», which this change set does not declare`,
          ),
        )
      }
      if (!allowWholeSource && !isRangeReplace(edit)) {
        problems.push(
          diagnostic(
            'error',
            'x3.host/raw-writer-whole-source-refused',
            'this host allows range edits only: a whole-source replace from a bounded editor can drop what it never loaded',
          ),
        )
      }
    }
    return { valid: problems.length === 0, diagnostics: Object.freeze(problems) }
  }

  return Object.freeze({
    identity,
    offer,
    async validate(change: ChangeSet): Promise<ValidationResult> {
      return check(change)
    },
    async plan(change: ChangeSet): Promise<AssetEditPlan> {
      const validation = check(change)
      if (!validation.valid) {
        // a refused change still produces a plan object; its diagnostics carry the reason and the
        // coordinator refuses it (no targets means no derived write set)
        return Object.freeze({
          planId: 'raw-writer:refused',
          targets: Object.freeze([]),
          edits: Object.freeze([]),
          semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: 'atomic' }),
          fidelity: RAW_CLAIM,
          diagnostics: validation.diagnostics,
        })
      }
      return Object.freeze({
        planId:
          options.planId?.(change) ??
          `raw-writer:${change.targets.map(target => target.targetId).join('+')}`,
        targets: change.targets,
        edits: change.edits,
        semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: 'atomic' }),
        fidelity: RAW_CLAIM,
        diagnostics: Object.freeze([]),
      })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// evidence policy

export const HOST_RAW_WRITER_EVIDENCE_ID = 'host:raw-writer/by-construction'

/**
 * What a host accepts as proof of one claim. `corpusId`/`corpusDigest` name the run that proved
 * it; a structural guarantee says so in its ids rather than naming a corpus it never had.
 */
export interface FidelityEvidenceRecord {
  readonly writer: WriterIdentity
  readonly claim: FidelityClaim
  readonly evidenceId: string
  readonly corpusId: string
  readonly corpusDigest: string
  readonly conformanceProfile: string
  readonly optionsFingerprint: string
  readonly inputClass: string
  readonly provenAt: string
}

/**
 * The raw writer's evidence: structural, not a corpus run. Writing bytes the caller supplied,
 * with no re-encoding, cannot lose data no corpus would have caught — and the ids say exactly
 * that, so an auditor reading a receipt is not misled into thinking a corpus exists.
 */
export const HOST_RAW_WRITER_EVIDENCE_RECORD: FidelityEvidenceRecord = Object.freeze({
  writer: HOST_RAW_WRITER_IDENTITY,
  claim: RAW_CLAIM,
  evidenceId: HOST_RAW_WRITER_EVIDENCE_ID,
  corpusId: 'by-construction: literal replacement, no re-encoding',
  corpusDigest: 'none:by-construction',
  conformanceProfile: 'org.modkitx/raw-writer-v1',
  optionsFingerprint: 'options:none',
  inputClass: 'any',
  provenAt: '2026-08-19T00:00:00Z',
})

/**
 * What the in-repo archive proof establishes about the ZIP codec's re-assembly.
 *
 * These are *facts about a proof*, not a decision: which writer, which claim, which corpus, run
 * when. The decision — whether this host accepts them — stays with each application, which must
 * pass them to `createEvidenceRegistry` explicitly; nothing here is registered by default.
 *
 * They live in one place because two applications had re-typed the same corpus coordinates
 * verbatim, and coordinates that are re-typed are coordinates that drift: an app that updates its
 * copy after a proof changes, beside one that does not, is two hosts disagreeing about what has
 * been proven while both look correct.
 *
 * Two records because the codec downgrades its own claim honestly: an archive whose layout the
 * central directory does not fully account for cannot promise every unknown byte survives, and
 * "keeps them" and "does not" are different claims needing different evidence.
 */
export const ZIP_VERBATIM_REASSEMBLY_RECORDS: readonly FidelityEvidenceRecord[] = Object.freeze([
  Object.freeze({
    writer: Object.freeze({
      providerId: 'org.modkitx/archive-zip',
      providerVersion: '1.0.0',
      artifactDigest: 'x3:org.modkitx/archive-zip@1.0.0',
      formatId: 'zip',
      representationId: 'archive-namespace',
    }),
    claim: Object.freeze({ roundTrip: 'semantic' as const, preservesUnknownData: true }),
    evidenceId: 'zip-verbatim-reassembly-v1',
    corpusId: 'modkitX3/packages/host/test/archive-edits.test.ts',
    corpusDigest: 'none:proof-suite',
    conformanceProfile: 'org.modkitx/codec-contribution-v1',
    optionsFingerprint: 'options:stored-additions',
    inputClass: 'zip-classic',
    provenAt: '2026-08-19T00:00:00Z',
  }),
  Object.freeze({
    writer: Object.freeze({
      providerId: 'org.modkitx/archive-zip',
      providerVersion: '1.0.0',
      artifactDigest: 'x3:org.modkitx/archive-zip@1.0.0',
      formatId: 'zip',
      representationId: 'archive-namespace',
    }),
    claim: Object.freeze({ roundTrip: 'semantic' as const, preservesUnknownData: false }),
    evidenceId: 'zip-verbatim-reassembly-non-canonical-v1',
    corpusId: 'modkitX3/packages/host/test/archive-edits.test.ts',
    corpusDigest: 'none:proof-suite',
    conformanceProfile: 'org.modkitx/codec-contribution-v1',
    optionsFingerprint: 'options:stored-additions',
    inputClass: 'zip-non-canonical-layout',
    provenAt: '2026-08-19T00:00:00Z',
  }),
])

export interface EvidenceRegistry {
  /** The `evidenceFor` a `CommitCoordinator`/`createSubjectEditing` takes. */
  evidenceFor(plan: AssetEditPlan): FidelityEvidence | undefined
  /** Records this policy holds, newest first. */
  list(): readonly FidelityEvidenceRecord[]
  /** A registry with one more record (registries are immutable). */
  with(record: FidelityEvidenceRecord): EvidenceRegistry
}

function evidenceOf(record: FidelityEvidenceRecord): FidelityEvidence {
  return Object.freeze({
    ...record.claim,
    evidenceId: record.evidenceId,
    corpusId: record.corpusId,
    corpusDigest: record.corpusDigest,
    conformanceProfile: record.conformanceProfile as FidelityEvidence['conformanceProfile'],
    writer: record.writer,
    optionsFingerprint: record.optionsFingerprint,
    inputClass: record.inputClass,
    provenAt: record.provenAt,
  }) as FidelityEvidence
}

const sameClaim = (left: FidelityClaim, right: FidelityClaim): boolean =>
  left.roundTrip === right.roundTrip && left.preservesUnknownData === right.preservesUnknownData

/**
 * An evidence policy over explicit records. A plan is proven when a record's claim is exactly the
 * plan's claim — never a weaker record standing in for a stronger claim. `undefined` means the
 * coordinator refuses the plan as `fidelity-unproven`, which is the correct default for anything
 * the host has not decided about.
 */
export function createEvidenceRegistry(
  records: readonly FidelityEvidenceRecord[] = [HOST_RAW_WRITER_EVIDENCE_RECORD],
): EvidenceRegistry {
  const own = Object.freeze([...records])
  const registry: EvidenceRegistry = {
    evidenceFor(plan: AssetEditPlan): FidelityEvidence | undefined {
      const record = own.find(item => sameClaim(item.claim, plan.fidelity))
      return record === undefined ? undefined : evidenceOf(record)
    },
    list: () => own,
    with: (record: FidelityEvidenceRecord) => createEvidenceRegistry([record, ...own]),
  }
  return Object.freeze(registry)
}
