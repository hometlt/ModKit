/**
 * Subject editing — the product wiring of 13D over an opened subject (ADR-HOST-002 §5).
 *
 * `openSubject` gives a session and a descriptor; editing needs four more things the host owns:
 * the subject's `AssetRevision` and edit targets (derived from the descriptor with the same
 * fingerprint rule subject-open used, so a codec's plan and the host's expectation agree byte for
 * byte), a host-issued `GrantSnapshot` cut from the open grant, a `CommitCoordinator` over the
 * host's backends and evidence policy, and — for Path B — a writer-backed edit session. Path A
 * (a codec operation that returns `edit-plan`) goes through `planFromOperation`, which checks the
 * plan against this subject before the coordinator ever sees it.
 *
 * Nothing here writes: the coordinator does, through the backends the caller passed, under the
 * grant the caller holds.
 */

import { canonicalJsonStringify, ModkitError } from '@modkitx-x3/core'
import type {
  AnyDescriptor,
  AssetEditPlan,
  AssetRevision,
  CommitCoordinator,
  EditAuthorization,
  EditAuthorizationPort,
  EditSession,
  FidelityEvidence,
  GrantSnapshot,
  OperationOutput,
  PayloadStore,
  PermissionGrant,
  StagedPayloadRef,
  SubjectEditTarget,
  Writer,
  WriterIdentity,
} from '@modkitx-x3/sdk'
import {
  createCommitCoordinator,
  createEditSession,
  createGrantSnapshot,
  type EditingBackend,
  type HostCommitCoordinatorOptions,
  type ManagedEditSession,
} from './editing.js'
import type { OpenedSubject } from './subject-open.js'

function unsupported(kind: string): ModkitError {
  return new ModkitError({
    code: 'x3.host/edit-topology-unsupported',
    message: `editing a «${kind}» subject is not supported yet (single-source subjects only)`,
    context: { kind },
  })
}

/**
 * The subject's composite revision as 13D sees it, derived from the descriptor's origin with
 * subject-open's fingerprint rule (`{topology, bindingId, source, revision}` canonical JSON).
 */
export function assetRevisionFromDescriptor(descriptor: AnyDescriptor): AssetRevision {
  const origin = descriptor.origin
  if (origin.kind !== 'single') throw unsupported(origin.kind)
  const binding = origin.binding
  return Object.freeze({
    bindings: Object.freeze({ [binding.id]: binding.revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: binding.id,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision: binding.revision,
    }),
  })
}

/** One edit target per origin binding, pinned to the subject's current revision. */
export function subjectEditTargetsFromDescriptor(
  descriptor: AnyDescriptor,
): readonly SubjectEditTarget[] {
  const origin = descriptor.origin
  if (origin.kind !== 'single') throw unsupported(origin.kind)
  const revision = assetRevisionFromDescriptor(descriptor)
  return Object.freeze([
    Object.freeze({
      targetId: origin.binding.id,
      subjectUri: descriptor.subjectUri,
      ownerSource: Object.freeze({ id: origin.binding.source.id, uri: origin.binding.source.uri }),
      semanticPath: Object.freeze([]),
      expectedRevision: revision,
    }),
  ])
}

/** A payload store for hosts that stage nothing: every staged ref is refused honestly. */
export const NO_STAGED_PAYLOADS: PayloadStore = Object.freeze({
  async open(ref: StagedPayloadRef) {
    throw new ModkitError({
      code: 'x3.host/edit-payload-unavailable',
      message: `no payload store can open staged payload «${ref.handleId}»`,
    })
  },
})

export interface SubjectEditingOptions {
  readonly opened: OpenedSubject
  /** The grant the subject was opened under; commit needs `write-source` in it. */
  readonly grant: PermissionGrant
  readonly backendFor: (sourceId: string) => EditingBackend | undefined
  /** Host evidence policy: which fidelity evidence a plan may rely on (none → `fidelity-unproven`). */
  readonly evidenceFor: (plan: AssetEditPlan) => FidelityEvidence | undefined
  readonly payloads?: PayloadStore
  /** Path B: a resolved writer provider for this subject's format/representation. */
  readonly writer?: Writer
  readonly expectedWriter?: WriterIdentity
  readonly expectedEvidenceContext?: HostCommitCoordinatorOptions['expectedEvidenceContext']
  readonly digest?: (value: unknown) => string
  readonly isGrantValid?: (grant: GrantSnapshot) => boolean
  readonly confirmationMatches?: HostCommitCoordinatorOptions['confirmationMatches']
  readonly createRecovery?: HostCommitCoordinatorOptions['createRecovery']
  readonly verifyStagedPayload?: HostCommitCoordinatorOptions['verifyStagedPayload']
  readonly maxInlinePayloadBytes?: number
  readonly now?: () => string
  readonly nextId?: (kind: 'prepared' | 'transaction') => string
  readonly snapshotId?: string
}

/**
 * The four ports a `ViewerModule`-hosted editor (`@modkitx-x3/ui`) expects: the 13D edit session,
 * the commit coordinator, the payload store and a host authorization port. Present only when a
 * writer backs the subject (Path B); the ui drops editable stages when these are absent.
 */
export interface SubjectEditorPorts {
  readonly edit: EditSession
  readonly commit: CommitCoordinator
  readonly payloads: PayloadStore
  readonly authorization: EditAuthorizationPort
}

export interface SubjectEditing {
  readonly revision: AssetRevision
  readonly targets: readonly SubjectEditTarget[]
  /** Host-issued; `permissions` are the open grant's classes, `sourceIds` the subject's sources. */
  readonly grantSnapshot: GrantSnapshot
  readonly coordinator: CommitCoordinator
  /** Present when a writer was supplied (Path B). */
  readonly session?: ManagedEditSession
  /** The ui editor ports, present when a writer was supplied. */
  readonly editorPorts?: SubjectEditorPorts
  /**
   * Path A: accept an `edit-plan` operation output for this subject. Refuses any other output
   * kind, a plan whose targets are not this subject's, or a plan pinned to another revision.
   */
  planFromOperation(output: OperationOutput): AssetEditPlan
}

const defaultDigest = (value: unknown): string =>
  canonicalJsonStringify(JSON.parse(JSON.stringify(value)) as never)

export function createSubjectEditing(options: SubjectEditingOptions): SubjectEditing {
  const descriptor = options.opened.descriptor
  const revision = assetRevisionFromDescriptor(descriptor)
  const targets = subjectEditTargetsFromDescriptor(descriptor)
  const grantSnapshot = createGrantSnapshot({
    snapshotId: options.snapshotId ?? `${options.grant.id}#edit`,
    permissions: options.grant.classes,
    sourceIds: targets.map(target => target.ownerSource.id),
  })
  const issued = new Set([grantSnapshot.snapshotId])
  const coordinator = createCommitCoordinator({
    payloads: options.payloads ?? NO_STAGED_PAYLOADS,
    backendFor: options.backendFor,
    evidenceFor: options.evidenceFor,
    ...(options.expectedWriter === undefined ? {} : { expectedWriter: options.expectedWriter }),
    ...(options.expectedEvidenceContext === undefined
      ? {}
      : { expectedEvidenceContext: options.expectedEvidenceContext }),
    isGrantValid: options.isGrantValid ?? (grant => issued.has(grant.snapshotId)),
    digest: options.digest ?? defaultDigest,
    ...(options.verifyStagedPayload === undefined
      ? {}
      : { verifyStagedPayload: options.verifyStagedPayload }),
    ...(options.createRecovery === undefined ? {} : { createRecovery: options.createRecovery }),
    ...(options.confirmationMatches === undefined
      ? {}
      : { confirmationMatches: options.confirmationMatches }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nextId === undefined ? {} : { nextId: options.nextId }),
    ...(options.maxInlinePayloadBytes === undefined
      ? {}
      : { maxInlinePayloadBytes: options.maxInlinePayloadBytes }),
  })
  const session =
    options.writer === undefined
      ? undefined
      : createEditSession({ revision, targets, writer: options.writer })
  // one authorization port over the host-issued snapshot: the user already chose to edit; a host
  // with a stricter policy (a confirm dialog, a per-save grant) replaces this without the editor
  // knowing. `request` hands back the same snapshot `prepare`/`commit` validate.
  const authorization: EditAuthorizationPort = Object.freeze({
    async request(): Promise<EditAuthorization | undefined> {
      return { grant: grantSnapshot }
    },
  })
  const editorPorts: SubjectEditorPorts | undefined =
    session === undefined
      ? undefined
      : Object.freeze({
          edit: session,
          commit: coordinator,
          payloads: options.payloads ?? NO_STAGED_PAYLOADS,
          authorization,
        })
  const targetIds = new Set(targets.map(target => target.targetId))
  const sourceIds = new Set(targets.map(target => target.ownerSource.id))
  const expected = canonicalJsonStringify(revision)

  const editing: SubjectEditing = {
    revision,
    targets,
    grantSnapshot,
    coordinator,
    ...(session === undefined ? {} : { session }),
    ...(editorPorts === undefined ? {} : { editorPorts }),
    planFromOperation(output) {
      if (output.kind !== 'edit-plan') {
        throw new ModkitError({
          code: 'x3.host/edit-plan-expected',
          message: `operation returned «${output.kind}», not an edit plan`,
        })
      }
      const plan = output.plan
      for (const target of plan.targets) {
        if (
          !targetIds.has(target.targetId) ||
          !sourceIds.has(target.ownerSource.id) ||
          canonicalJsonStringify(target.expectedRevision) !== expected
        ) {
          throw new ModkitError({
            code: 'x3.host/edit-plan-subject-mismatch',
            message: `edit plan target «${target.targetId}» is not this subject at its open revision`,
            context: { targetId: target.targetId },
          })
        }
      }
      for (const edit of plan.edits) {
        if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
          throw new ModkitError({
            code: 'x3.host/edit-plan-subject-mismatch',
            message: `edit «${edit.operation}» on «${edit.source.id}» is not this subject`,
            context: { targetId: edit.targetId, sourceId: edit.source.id },
          })
        }
      }
      return plan
    },
  }
  return Object.freeze(editing)
}
