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

import { diagnostic } from '@modkit/core'
import {
  CODEC_CONTRIBUTION_CONTRACT,
  SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
  type CodecContributionSpecV1,
  type ServiceProviderContributionSpecV1,
  type AssetEditPlan,
  type ChangeSet,
  type FidelityClaim,
  type FidelityEvidence,
  type SourceEdit,
  type ValidationResult,
  type Writer,
  type WriterIdentity,
  type WriterOffer,
} from '@modkit/sdk'
import { inventoryRecordFor, type ExtensionOrigin, type Inventory } from './inventory.js'

/** Identity of the host's own raw writer (plans an editor's byte/text edits with no format code). */
export const HOST_RAW_WRITER_IDENTITY: WriterIdentity = Object.freeze({
  providerId: 'modkit.host/raw-writer',
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

export interface CodecFidelityEvidenceSelection {
  readonly codecId: string
  readonly formatId: string
  /**
   * Extension origins whose authored citations this host accepts. The default is bundled only:
   * an installed extension may describe its proof, but cannot make an application trust it merely
   * by installing itself.
   */
  readonly acceptedOrigins?: readonly ExtensionOrigin[]
}

export interface ServiceProviderFidelityEvidenceSelection {
  /** The value actually selected and leased by the service resolver. */
  readonly writer: Writer
  /** Optional exact logical offer coordinate; an omitted id is accepted only for one full match. */
  readonly offerId?: string
  /** Defaults to bundled. Installed/linked artifacts require an explicit host trust decision. */
  readonly acceptedOrigins?: readonly ExtensionOrigin[]
}

/**
 * Materialize one opened codec's proof citations with writer coordinates from trusted inventory.
 *
 * The contribution owns corpus/evidence coordinates. Inventory owns provider version and artifact
 * digest. Keeping that join here means applications choose a trust origin and a selected codec,
 * but never learn ZIP-, PNG-, or vendor-specific proof literals.
 */
export function codecFidelityEvidenceRecords(
  inventory: Inventory,
  selection: CodecFidelityEvidenceSelection,
): readonly FidelityEvidenceRecord[] {
  const accepted = new Set<ExtensionOrigin>(selection.acceptedOrigins ?? ['bundled'])
  const records: FidelityEvidenceRecord[] = []
  for (const extension of inventory.extensions) {
    if (!accepted.has(extension.origin)) continue
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      const inventoryRecord = contribution.record
      if (
        !contribution.activationEligible ||
        manifest === undefined ||
        inventoryRecord === undefined ||
        manifest.contract.id !== CODEC_CONTRIBUTION_CONTRACT ||
        manifest.contract.major !== 1 ||
        manifest.id !== selection.codecId
      ) {
        continue
      }
      const spec = manifest.spec as unknown as CodecContributionSpecV1
      for (const declaration of spec.fidelityEvidence ?? []) {
        if (declaration.formatId !== selection.formatId) continue
        records.push(
          Object.freeze({
            writer: Object.freeze({
              providerId: manifest.id,
              providerVersion: extension.manifest.version,
              artifactDigest: inventoryRecord.artifactDigest,
              formatId: declaration.formatId,
              representationId: declaration.representationId,
            }),
            claim: Object.freeze({
              ...declaration.claim,
              ...(declaration.claim.notes === undefined
                ? {}
                : { notes: Object.freeze([...declaration.claim.notes]) }),
            }),
            evidenceId: declaration.evidenceId,
            corpusId: declaration.corpusId,
            corpusDigest: declaration.corpusDigest,
            conformanceProfile: declaration.conformanceProfile,
            optionsFingerprint: declaration.optionsFingerprint,
            inputClass: declaration.inputClass,
            provenAt: declaration.provenAt,
          }),
        )
      }
    }
  }
  return Object.freeze(records)
}

/**
 * The proof records for whatever writes an opened subject: its codec, and for a subject composed
 * over a container also the carrier's codec, whose `container.pack` produces every plan of it.
 * Applications build their evidence registry from this instead of naming one codec.
 */
export function subjectFidelityEvidenceRecords(
  inventory: Inventory,
  opened: {
    readonly selected: { readonly contributionId: string }
    readonly descriptor: { readonly identity: { readonly formatId: string } }
    readonly carrier?: {
      readonly selected: { readonly contributionId: string }
      readonly descriptor: { readonly identity: { readonly formatId: string } }
    }
  },
  acceptedOrigins?: readonly ExtensionOrigin[],
): readonly FidelityEvidenceRecord[] {
  const selections = [opened, ...(opened.carrier === undefined ? [] : [opened.carrier])]
  return Object.freeze(
    selections.flatMap(item =>
      codecFidelityEvidenceRecords(inventory, {
        codecId: item.selected.contributionId,
        formatId: item.descriptor.identity.formatId,
        ...(acceptedOrigins === undefined ? {} : { acceptedOrigins }),
      }),
    ),
  )
}

function writerFacet(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function sameWriterIdentity(left: WriterIdentity, right: WriterIdentity): boolean {
  return (
    left.providerId === right.providerId &&
    left.providerVersion === right.providerVersion &&
    left.artifactDigest === right.artifactDigest &&
    left.formatId === right.formatId &&
    left.representationId === right.representationId
  )
}

/**
 * Materialize proof for the exact service writer selected by the resolver.
 *
 * The authored declaration supplies only proof coordinates. Provider identity, extension version
 * and artifact digest must all join back to the activation-eligible inventory object that produced
 * the selected writer. A copied/tampered inventory, ambiguous offer, stale digest, provider alias
 * or evidence mismatch returns `undefined`; the coordinator then fails closed.
 */
export function serviceProviderFidelityEvidenceRecord(
  inventory: Inventory,
  selection: ServiceProviderFidelityEvidenceSelection,
): FidelityEvidenceRecord | undefined {
  const accepted = new Set<ExtensionOrigin>(selection.acceptedOrigins ?? ['bundled'])
  const { identity, offer: selectedOffer } = selection.writer
  if (
    identity.providerId !== selectedOffer.providerId ||
    identity.formatId !== selectedOffer.formatId ||
    identity.representationId !== selectedOffer.representationId
  ) {
    return undefined
  }

  const matches: FidelityEvidenceRecord[] = []
  for (const extension of inventory.extensions) {
    if (
      !accepted.has(extension.origin) ||
      extension.manifest.version !== identity.providerVersion
    ) {
      continue
    }
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      const publicRecord = contribution.record
      const privateRecord = inventoryRecordFor(contribution)
      if (
        !contribution.activationEligible ||
        manifest === undefined ||
        publicRecord === undefined ||
        privateRecord === undefined ||
        privateRecord.publicRecord !== publicRecord ||
        publicRecord.artifactDigest !== identity.artifactDigest ||
        manifest.contract.id !== SERVICE_PROVIDER_CONTRIBUTION_CONTRACT ||
        manifest.contract.major !== 1 ||
        manifest.id !== identity.providerId
      ) {
        continue
      }

      const spec = manifest.spec as unknown as ServiceProviderContributionSpecV1
      const offers = spec.provides.filter(candidate => {
        if (
          candidate.contract !== 'common.edit/writer' ||
          candidate.major !== 1 ||
          (selection.offerId !== undefined && candidate.offerId !== selection.offerId)
        ) {
          return false
        }
        const facet = writerFacet(candidate.facet)
        return (
          facet?.['providerId'] === identity.providerId &&
          facet['fidelityEvidenceId'] === selectedOffer.fidelityEvidenceId &&
          facet['formatId'] === identity.formatId &&
          facet['representationId'] === identity.representationId &&
          facet['mutationMode'] === selectedOffer.mutationMode &&
          facet['minimumRoundTrip'] === selectedOffer.minimumRoundTrip
        )
      })
      if (offers.length !== 1) continue
      const logicalOffer = offers[0]
      if (logicalOffer === undefined) continue
      const declarations = (spec.fidelityEvidence ?? []).filter(
        declaration =>
          declaration.offerId === logicalOffer.offerId &&
          declaration.evidenceId === selectedOffer.fidelityEvidenceId &&
          declaration.claim.roundTrip === selectedOffer.minimumRoundTrip,
      )
      if (declarations.length !== 1) continue
      const declaration = declarations[0]
      if (declaration === undefined) continue
      matches.push(
        Object.freeze({
          writer: Object.freeze({ ...identity }),
          claim: Object.freeze({
            ...declaration.claim,
            ...(declaration.claim.notes === undefined
              ? {}
              : { notes: Object.freeze([...declaration.claim.notes]) }),
          }),
          evidenceId: declaration.evidenceId,
          corpusId: declaration.corpusId,
          corpusDigest: declaration.corpusDigest,
          conformanceProfile: declaration.conformanceProfile,
          optionsFingerprint: declaration.optionsFingerprint,
          inputClass: declaration.inputClass,
          provenAt: declaration.provenAt,
        }),
      )
    }
  }
  return matches.length === 1 ? matches[0] : undefined
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
  conformanceProfile: 'modkit/raw-writer-v1',
  optionsFingerprint: 'options:none',
  inputClass: 'any',
  provenAt: '2026-08-19T00:00:00Z',
})

export interface EvidenceRegistry {
  /** The `evidenceFor` a `CommitCoordinator`/`createSubjectEditing` takes. */
  evidenceFor(plan: AssetEditPlan, expectedWriter?: WriterIdentity): FidelityEvidence | undefined
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
    evidenceFor(
      plan: AssetEditPlan,
      expectedWriter?: WriterIdentity,
    ): FidelityEvidence | undefined {
      const record = own.find(
        item =>
          sameClaim(item.claim, plan.fidelity) &&
          (expectedWriter === undefined || sameWriterIdentity(item.writer, expectedWriter)),
      )
      return record === undefined ? undefined : evidenceOf(record)
    },
    list: () => own,
    with: (record: FidelityEvidenceRecord) => createEvidenceRegistry([record, ...own]),
  }
  return Object.freeze(registry)
}
