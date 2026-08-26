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
import type { OpenedSubject, UnresolvedSubject } from './subject-open.js'

function unsupported(kind: string): ModkitError {
  return new ModkitError({
    code: 'x3.host/edit-topology-unsupported',
    message: `editing a «${kind}» subject is not supported yet (single-source and namespace subjects only)`,
    context: { kind },
  })
}

/**
 * The subject's composite revision as 13D sees it, derived from the descriptor's origin with
 * subject-open's fingerprint rule (`{topology, bindingId, source, revision}` canonical JSON).
 *
 * Two topologies answer, and the difference between them is the whole point of the namespace case.
 * A `single` subject is one artifact: it can be replaced, and its revision is that artifact's. A
 * `namespace` subject is a directory of artifacts: it can gain and lose entries, so its revision is
 * the namespace's own, carried in `namespaceRevision` — the field the commit coordinator requires
 * before it will accept a `create`, `delete` or `rename`. Slice 12-2 pinned the absence of this
 * branch as the reason a writer could not export a new artifact through the durable-write seam at
 * all; this is that hole closed, and it needed no ABI change, because `topology: 'namespace'`
 * already carries exactly the field the rule asks for.
 */
export function assetRevisionFromDescriptor(descriptor: AnyDescriptor): AssetRevision {
  const origin = descriptor.origin
  if (origin.kind === 'namespace') {
    // one binding, and it is the namespace itself: the file backend edits single-binding subjects,
    // and a directory is exactly one thing to pin
    return Object.freeze({
      bindings: Object.freeze({ [origin.root.id]: origin.revision }),
      namespaceRevision: origin.revision,
      compositionFingerprint: canonicalJsonStringify({
        topology: 'namespace',
        root: { id: origin.root.id, uri: origin.root.uri },
        revision: origin.revision,
      }),
    })
  }
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
  const revision = assetRevisionFromDescriptor(descriptor)
  if (origin.kind === 'namespace') {
    return Object.freeze([
      Object.freeze({
        targetId: origin.root.id,
        subjectUri: descriptor.subjectUri,
        ownerSource: Object.freeze({ id: origin.root.id, uri: origin.root.uri }),
        semanticPath: Object.freeze([]),
        expectedRevision: revision,
      }),
    ])
  }
  if (origin.kind !== 'single') throw unsupported(origin.kind)
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
  /**
   * The subject being edited — or, for a namespace target, merely *identified*.
   *
   * Only the descriptor is read here, and an unresolved subject carries one. That is not a
   * loophole but the point: a directory no codec claims is still a perfectly good namespace to
   * create an artifact in, and requiring a codec to have interpreted it first would mean an export
   * could only write next to file types the host already understands. Editing the *bytes* of a
   * subject still needs a writer, which needs a session; creating an entry beside them does not.
   */
  readonly opened: OpenedSubject | UnresolvedSubject
  /** The grant the subject was opened under; commit needs `write-source` in it. */
  readonly grant: PermissionGrant
  readonly backendFor: (sourceId: string) => EditingBackend | undefined
  /** Host evidence policy: which fidelity evidence a plan may rely on (none → `fidelity-unproven`). */
  readonly evidenceFor: (plan: AssetEditPlan) => FidelityEvidence | undefined
  readonly payloads?: PayloadStore
  /** Path B: a resolved writer provider for this subject's format/representation. */
  readonly writer?: Writer
  /**
   * Pin every plan to one writer identity.
   *
   * Only for a host where exactly one writer can produce a plan. It is a **trap for any host that
   * also offers Path A**: a codec-produced plan carries the codec's identity, not this one, so
   * pinning turns every mutating operation into `fidelity-unproven` — a refusal whose message
   * points at the evidence registry while the actual cause is this line. Leave it unset unless
   * you mean "no writer but this one may ever write here", and never set it beside `operations`
   * that mutate.
   */
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

/**
 * Inline-payload ceiling for a subject a product is editing. The coordinator's own default is
 * 1 MiB — right for a primitive, unusable for a product: a format whose edit is a whole-source
 * rewrite (an archive repack, an image encode) exceeds it with the first real file, and the user
 * sees `payload-unavailable` for a save that is perfectly ordinary. 16 MiB covers those and stays
 * far below the realms' transfer limits. Larger sources need staged payloads, which no codec can
 * produce yet — a known limit, not a silent truncation: above this the commit is refused.
 */
const DEFAULT_INLINE_PAYLOAD_BYTES = 16 * 1024 * 1024

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
    maxInlinePayloadBytes: options.maxInlinePayloadBytes ?? DEFAULT_INLINE_PAYLOAD_BYTES,
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
