/** Compile-only proof for the BRIEF-13D editing ABI and its negative boundaries. */
import { revisionId, type AssetSourceRef } from '@modkitx-x3/sdk'
import type {
  AssetEditPlan,
  ChangeSet,
  CommitCoordinator,
  DerivedWriteSet,
  EditorContributionSpecV1Wire,
  GrantSnapshot,
  PayloadStore,
  PreparedCommit,
  SourceEdit,
  StagedPayloadRef,
  SubjectEditTarget,
  WriterProviderContributionSpec,
} from '@modkitx-x3/sdk/editing'

declare const source: AssetSourceRef
declare const coordinator: CommitCoordinator
declare const payloads: PayloadStore
declare const plan: AssetEditPlan

export const editingTarget = {
  targetId: 'document',
  subjectUri: 'x3-subject:v1:document',
  ownerSource: source,
  semanticPath: ['root'],
  expectedRevision: {
    bindings: { content: revisionId('content-hash.sha256:abc') },
    compositionFingerprint: 'composition:abc',
  },
} satisfies SubjectEditTarget

export const editingOperations = [
  {
    operation: 'replace',
    targetId: 'document',
    source,
    range: { kind: 'utf16', offset: 4, length: 2 },
    payload: { kind: 'text', text: 'value' },
  },
  {
    operation: 'create',
    targetId: 'archive',
    source,
    newPath: 'entries/new.txt',
    payload: { kind: 'inline', bytes: new Uint8Array([1, 2, 3]) },
  },
  { operation: 'delete', targetId: 'obsolete', source },
  { operation: 'rename', targetId: 'entry', source, newPath: 'entries/renamed.txt' },
] as const satisfies readonly SourceEdit[]

export const stagedPayload = {
  storeId: 'host-staging',
  handleId: 'payload-1',
  digest: 'sha256:payload',
  bytes: 4n,
  replayable: true,
} as const satisfies StagedPayloadRef

export const editingChangeSet = {
  targets: [editingTarget],
  edits: [editingOperations[0]],
  semanticIntent: { pointer: '/name' },
  provenance: { actor: 'user' },
} as const satisfies ChangeSet

export const editorContribution = {
  sessionModel: 'single-subject',
  selectionKinds: ['text-range'],
  semanticLocationKinds: ['json-pointer'],
  requiresTransactions: true,
  requiresOperations: ['edit.content', 'source.save'],
  consumesDataSources: [{ contract: 'common.view/text-data-source', major: 1 }],
  writer: {
    formatId: 'jsonc',
    representationId: 'source',
    mutationMode: 'mutate',
    minimumRoundTrip: 'byte-identical',
  },
  priority: 300,
  scaleLimits: { maximumSourceBytes: '18446744073709551615' },
} as const satisfies EditorContributionSpecV1Wire

export const writerContribution = {
  lifecycleScope: 'session',
  provides: [
    {
      offerId: 'jsonc-writer',
      contract: 'common.edit/writer',
      major: 1,
      version: '1.0.0',
      facet: {
        providerId: 'org.example/jsonc-writer',
        fidelityEvidenceId: 'jsonc-corpus-v1',
        formatId: 'jsonc',
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
    },
  ],
} as const satisfies WriterProviderContributionSpec

export const stagedReader = payloads.open(stagedPayload)

export const invalidDelete: SourceEdit = {
  operation: 'delete',
  targetId: 'document',
  source,
  // @ts-expect-error A delete edit never carries replacement payload data.
  payload: { kind: 'text', text: 'forged' },
}

export const invalidStagedPayload: StagedPayloadRef = {
  storeId: 'host-staging',
  handleId: 'payload-2',
  digest: 'sha256:payload',
  bytes: 1n,
  replayable: true,
  // @ts-expect-error Large payloads cross through a staged handle, not an iterable.
  stream: (async function* () {
    yield new Uint8Array([1])
  })(),
}

// @ts-expect-error The host-owned nominal write set cannot be forged by an extension.
export const forgedWriteSet: DerivedWriteSet = { entries: [], digest: 'forged' }

// @ts-expect-error The host-owned prepared authority cannot be forged by an extension.
export const forgedPrepared: PreparedCommit = {
  preparedId: 'forged',
  plan,
  planDigest: 'forged',
  writeSet: forgedWriteSet,
  authorization: {
    requiredPermissions: [],
    granted: true,
    achievableGuarantee: 'atomic',
    missing: [],
    scopeSatisfied: true,
  },
  preparedRevisionFingerprint: 'forged',
  fidelity: {} as never,
}

declare const grant: GrantSnapshot
// @ts-expect-error Commit accepts only host-issued PreparedCommit, never an authored plan.
export const directCommit = coordinator.commit(plan, { grant })

export const invalidWriterContribution = {
  lifecycleScope: 'session',
  provides: [
    // @ts-expect-error Writer offers require the contract-owned capability/fidelity facet.
    {
      offerId: 'missing-writer-facet',
      contract: 'common.edit/writer',
      major: 1,
      version: '1.0.0',
    },
  ],
} as const satisfies WriterProviderContributionSpec
