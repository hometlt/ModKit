import { compareUtf8, diagnostic, type Diagnostic } from '@modkit/core'
import { PERMISSION_CLASSES } from '@modkit/sdk'
import type {
  AssetEditPlan,
  AssetRevision,
  BackendCapability,
  BindingWriteResult,
  ChangeSet,
  CommitAuthorization,
  CommitCoordinator,
  CommitGuarantee,
  CommitReceipt,
  DerivedWriteSet,
  EditSession,
  EditSessionState,
  FidelityEvidence,
  GrantSnapshot,
  PayloadStore,
  PreparedCommit,
  RecoveryRef,
  SourceConflict,
  SourceEdit,
  StagedPayloadRef,
  SubjectEditTarget,
  ValidationResult,
  Writer,
  WriterIdentity,
  WriteSetEntry,
} from '@modkit/sdk'

const GUARANTEE_STRENGTH: Readonly<Record<CommitGuarantee, number>> = Object.freeze({
  'best-effort': 0,
  recoverable: 1,
  transactional: 2,
  atomic: 3,
})

const issuedGrantSnapshots = new WeakSet<object>()

export interface EditingBackendApplyResult {
  readonly after: AssetRevision
  readonly diagnosticIds?: readonly string[]
}

export interface EditingBackendBatchResult extends EditingBackendApplyResult {
  readonly targetId: string
}

export interface EditingBackend {
  readonly profile: BackendCapability
  readonly writable: boolean
  currentRevision(target: SubjectEditTarget, signal?: AbortSignal): Promise<AssetRevision>
  apply(
    edit: SourceEdit,
    options: {
      readonly transactionId: string
      readonly payloads: PayloadStore
      /** Backend MUST perform a conditional write against this exact revision. */
      readonly expectedRevision: AssetRevision
      readonly signal?: AbortSignal
    },
  ): Promise<EditingBackendApplyResult>
  /** One indivisible backend boundary. Required before the host may report `atomic`. */
  applyBatch?(
    requests: readonly {
      readonly edit: SourceEdit
      readonly expectedRevision: AssetRevision
    }[],
    options: {
      readonly transactionId: string
      readonly payloads: PayloadStore
      readonly signal?: AbortSignal
    },
  ): Promise<readonly EditingBackendBatchResult[]>
  rollback?(
    transactionId: string,
    edit: SourceEdit,
    before: AssetRevision,
    signal?: AbortSignal,
  ): Promise<AssetRevision>
}

export interface HostCommitCoordinatorOptions {
  readonly payloads: PayloadStore
  readonly backendFor: (sourceId: string) => EditingBackend | undefined
  readonly evidenceFor: (plan: AssetEditPlan) => FidelityEvidence | undefined
  readonly expectedWriter?: WriterIdentity
  readonly expectedEvidenceContext?: {
    readonly optionsFingerprint: string
    readonly inputClass: string
  }
  readonly isGrantValid: (grant: GrantSnapshot) => boolean
  readonly digest: (value: unknown) => string
  readonly verifyStagedPayload?: (
    ref: StagedPayloadRef,
    signal?: AbortSignal,
  ) => boolean | Promise<boolean>
  readonly createRecovery?: (preparedId: string, planDigest: string) => Promise<RecoveryRef>
  readonly confirmationMatches?: (token: string, plan: AssetEditPlan) => boolean
  readonly now?: () => string
  readonly nextId?: (kind: 'prepared' | 'transaction') => string
  readonly maxInlinePayloadBytes?: number
}

export interface ManagedEditSession extends EditSession {
  markStale(): void
  markCommitting(committing: boolean): void
}

interface InternalPrepared {
  readonly plan: AssetEditPlan
  readonly targets: ReadonlyMap<string, SubjectEditTarget>
  readonly backends: ReadonlyMap<string, EditingBackend>
  readonly prepared: PreparedCommit
  readonly confirmationToken?: string
}

interface HistoryEntry {
  readonly plan: AssetEditPlan
  readonly prepared: InternalPrepared
  readonly receipt: CommitReceipt
  readonly steps: readonly {
    readonly edit: SourceEdit
    readonly backend: EditingBackend
    readonly before: AssetRevision
  }[]
}

function snapshot<Value>(value: Value, ancestors = new WeakSet<object>()): Value {
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('editing inputs cannot contain executable or symbol values')
  }
  if (value instanceof Uint8Array) return value.slice() as Value
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('editing inputs must be acyclic owned data')
    ancestors.add(value)
    const copy = Object.freeze(value.map(item => snapshot(item, ancestors))) as Value
    ancestors.delete(value)
    return copy
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) throw new TypeError('editing inputs must be acyclic owned data')
    const prototype = Object.getPrototypeOf(value) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('editing inputs must contain only plain owned data')
    }
    ancestors.add(value)
    const copy: Record<PropertyKey, unknown> = {}
    for (const key of Reflect.ownKeys(value)) {
      copy[key] = snapshot((value as Record<PropertyKey, unknown>)[key], ancestors)
    }
    ancestors.delete(value)
    return Object.freeze(copy) as Value
  }
  return value
}

function snapshotGrant(grant: GrantSnapshot): GrantSnapshot {
  if (!issuedGrantSnapshots.has(grant)) throw new TypeError('grant snapshot is not host-issued')
  return Object.freeze({
    snapshotId: String(grant.snapshotId),
    permissions: Object.freeze([...grant.permissions]),
    sourceIds: Object.freeze([...grant.sourceIds]),
  }) as GrantSnapshot
}

function grantIsValid(options: HostCommitCoordinatorOptions, grant: GrantSnapshot): boolean {
  try {
    return options.isGrantValid(grant) === true
  } catch {
    return false
  }
}

export function createGrantSnapshot(value: {
  readonly snapshotId: string
  readonly permissions: readonly GrantSnapshot['permissions'][number][]
  readonly sourceIds: readonly string[]
}): GrantSnapshot {
  if (
    !isNonBlank(value.snapshotId) ||
    !Array.isArray(value.permissions) ||
    !value.permissions.every(permission =>
      (PERMISSION_CLASSES as readonly string[]).includes(permission),
    ) ||
    !Array.isArray(value.sourceIds) ||
    !value.sourceIds.every(isNonBlank)
  ) {
    throw new TypeError('grant snapshot is malformed')
  }
  const snapshot = Object.freeze({
    snapshotId: value.snapshotId,
    permissions: Object.freeze([...new Set(value.permissions)].sort(compareUtf8)),
    sourceIds: Object.freeze([...new Set(value.sourceIds)].sort(compareUtf8)),
  }) as GrantSnapshot
  issuedGrantSnapshots.add(snapshot)
  return snapshot
}

function revisionValue(revision: AssetRevision) {
  return {
    bindings: Object.fromEntries(
      Object.entries(revision.bindings)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, value]) => [key, String(value)]),
    ),
    ...(revision.namespaceRevision === undefined
      ? {}
      : { namespaceRevision: String(revision.namespaceRevision) }),
    compositionFingerprint: revision.compositionFingerprint,
  }
}

function sameRevision(left: AssetRevision, right: AssetRevision): boolean {
  return JSON.stringify(revisionValue(left)) === JSON.stringify(revisionValue(right))
}

function revisionFingerprint(
  targets: readonly SubjectEditTarget[],
  digest: (value: unknown) => string,
) {
  return digest(
    targets
      .map(target => ({
        targetId: target.targetId,
        revision: revisionValue(target.expectedRevision),
      }))
      .sort((left, right) => compareUtf8(left.targetId, right.targetId)),
  )
}

function normalizedPath(value: string): string | undefined {
  if (value.trim() === '' || value.includes('\\') || value.startsWith('/')) return undefined
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return undefined
  return parts.join('/')
}

function modeOf(edit: SourceEdit): WriteSetEntry['mode'] {
  if (edit.operation === 'replace') return 'in-place'
  return edit.operation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === new Set(keys).size && keys.every(key => allowed.includes(key))
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isAssetSource(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'uri', 'parentIds']) &&
    isNonBlank(value['id']) &&
    isNonBlank(value['uri']) &&
    (value['parentIds'] === undefined ||
      (Array.isArray(value['parentIds']) && value['parentIds'].every(isNonBlank)))
  )
}

function isRevision(value: unknown): value is AssetRevision {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['bindings', 'namespaceRevision', 'compositionFingerprint']) ||
    !isRecord(value['bindings']) ||
    Object.keys(value['bindings']).length === 0 ||
    !Object.values(value['bindings']).every(isNonBlank) ||
    !isNonBlank(value['compositionFingerprint'])
  ) {
    return false
  }
  return value['namespaceRevision'] === undefined || isNonBlank(value['namespaceRevision'])
}

function isRecoveryRef(value: unknown): value is RecoveryRef {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['kind', 'ref', 'digest']) &&
    (value['kind'] === 'journal' || value['kind'] === 'staging') &&
    isNonBlank(value['ref']) &&
    isNonBlank(value['digest'])
  )
}

function isFidelityEvidence(value: unknown): value is FidelityEvidence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'roundTrip',
      'preservesUnknownData',
      'notes',
      'evidenceId',
      'corpusId',
      'corpusDigest',
      'conformanceProfile',
      'writer',
      'optionsFingerprint',
      'inputClass',
      'provenAt',
    ]) ||
    !['byte-identical', 'semantic', 'lossy', 'none'].includes(value['roundTrip'] as string) ||
    typeof value['preservesUnknownData'] !== 'boolean' ||
    (value['notes'] !== undefined &&
      (!Array.isArray(value['notes']) || !value['notes'].every(isNonBlank))) ||
    ![
      value['evidenceId'],
      value['corpusId'],
      value['corpusDigest'],
      value['conformanceProfile'],
      value['optionsFingerprint'],
      value['inputClass'],
      value['provenAt'],
    ].every(isNonBlank) ||
    !isRecord(value['writer']) ||
    !hasExactKeys(value['writer'], [
      'providerId',
      'providerVersion',
      'artifactDigest',
      'formatId',
      'representationId',
    ]) ||
    !Object.values(value['writer']).every(isNonBlank)
  ) {
    return false
  }
  if (value['roundTrip'] === 'byte-identical') return value['preservesUnknownData'] === true
  if (value['roundTrip'] === 'lossy' || value['roundTrip'] === 'none') {
    return value['preservesUnknownData'] === false
  }
  return true
}

function isEditPayload(value: unknown): boolean {
  if (!isRecord(value) || !isNonBlank(value['kind'])) return false
  if (value['kind'] === 'text') {
    return hasExactKeys(value, ['kind', 'text']) && typeof value['text'] === 'string'
  }
  if (value['kind'] === 'inline') {
    return hasExactKeys(value, ['kind', 'bytes']) && value['bytes'] instanceof Uint8Array
  }
  if (value['kind'] !== 'staged' || !hasExactKeys(value, ['kind', 'ref'])) return false
  const ref = value['ref']
  return (
    isRecord(ref) &&
    hasExactKeys(ref, ['storeId', 'handleId', 'digest', 'bytes', 'replayable', 'expiresAt']) &&
    isNonBlank(ref['storeId']) &&
    isNonBlank(ref['handleId']) &&
    isNonBlank(ref['digest']) &&
    typeof ref['bytes'] === 'bigint' &&
    ref['bytes'] >= 0n &&
    ref['replayable'] === true &&
    (ref['expiresAt'] === undefined || isNonBlank(ref['expiresAt']))
  )
}

function isEditRange(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['kind', 'offset', 'length'])) return false
  if (value['kind'] === 'bytes') {
    return (
      typeof value['offset'] === 'bigint' &&
      value['offset'] >= 0n &&
      typeof value['length'] === 'bigint' &&
      value['length'] >= 0n
    )
  }
  return (
    value['kind'] === 'utf16' &&
    Number.isSafeInteger(value['offset']) &&
    Number.isSafeInteger(value['length']) &&
    (value['offset'] as number) >= 0 &&
    (value['length'] as number) >= 0
  )
}

function isSourceEdit(value: unknown): value is SourceEdit {
  if (!isRecord(value) || !isNonBlank(value['operation'])) return false
  const common =
    isNonBlank(value['targetId']) &&
    isAssetSource(value['source']) &&
    (value['label'] === undefined || typeof value['label'] === 'string')
  if (!common) return false
  if (value['operation'] === 'replace') {
    return (
      hasExactKeys(value, ['operation', 'targetId', 'source', 'range', 'payload', 'label']) &&
      (value['range'] === undefined || isEditRange(value['range'])) &&
      isEditPayload(value['payload'])
    )
  }
  if (value['operation'] === 'create') {
    return (
      hasExactKeys(value, ['operation', 'targetId', 'source', 'newPath', 'payload', 'label']) &&
      isNonBlank(value['newPath']) &&
      isEditPayload(value['payload'])
    )
  }
  if (value['operation'] === 'delete') {
    return hasExactKeys(value, ['operation', 'targetId', 'source', 'label'])
  }
  return (
    value['operation'] === 'rename' &&
    hasExactKeys(value, ['operation', 'targetId', 'source', 'newPath', 'label']) &&
    isNonBlank(value['newPath'])
  )
}

function planDigestValue(plan: AssetEditPlan) {
  const payload = (edit: SourceEdit) => {
    if (!('payload' in edit)) return undefined
    if (edit.payload.kind === 'inline') {
      return { kind: 'inline', bytes: [...edit.payload.bytes] }
    }
    if (edit.payload.kind === 'staged') {
      return {
        kind: 'staged',
        ref: { ...edit.payload.ref, bytes: edit.payload.ref.bytes.toString(10) },
      }
    }
    return edit.payload
  }
  return {
    planId: plan.planId,
    targets: plan.targets.map(target => ({
      ...target,
      expectedRevision: revisionValue(target.expectedRevision),
    })),
    edits: plan.edits.map(edit => ({
      ...edit,
      ...(edit.operation === 'replace' && edit.range?.kind === 'bytes'
        ? {
            range: {
              kind: 'bytes',
              offset: edit.range.offset.toString(10),
              length: edit.range.length.toString(10),
            },
          }
        : {}),
      ...(payload(edit) === undefined ? {} : { payload: payload(edit) }),
    })),
    semantics: plan.semantics,
    fidelity: plan.fidelity,
    diagnostics: plan.diagnostics,
  }
}

function fidelityMatches(
  plan: AssetEditPlan,
  evidence: FidelityEvidence | undefined,
  expectedWriter: WriterIdentity | undefined,
  expectedContext: HostCommitCoordinatorOptions['expectedEvidenceContext'],
): evidence is FidelityEvidence {
  if (!isFidelityEvidence(evidence) || evidence.roundTrip !== plan.fidelity.roundTrip) return false
  if (evidence.preservesUnknownData !== plan.fidelity.preservesUnknownData) return false
  if (
    expectedContext !== undefined &&
    (evidence.optionsFingerprint !== expectedContext.optionsFingerprint ||
      evidence.inputClass !== expectedContext.inputClass)
  ) {
    return false
  }
  if (expectedWriter === undefined) return true
  return (
    evidence.writer.providerId === expectedWriter.providerId &&
    evidence.writer.providerVersion === expectedWriter.providerVersion &&
    evidence.writer.artifactDigest === expectedWriter.artifactDigest &&
    evidence.writer.formatId === expectedWriter.formatId &&
    evidence.writer.representationId === expectedWriter.representationId
  )
}

function strongestGuarantee(backends: readonly EditingBackend[]): CommitGuarantee {
  const unique = new Set(backends)
  const single = [...unique][0]
  if (
    unique.size === 1 &&
    single !== undefined &&
    single.profile.guarantees.includes('atomic') &&
    single.applyBatch !== undefined
  ) {
    return 'atomic'
  }
  if (
    backends.every(backend => backend.profile.supportsPrepare && backend.profile.supportsRollback)
  ) {
    return 'transactional'
  }
  if (backends.every(backend => backend.profile.supportsJournal)) return 'recoverable'
  return 'best-effort'
}

function derive(
  plan: AssetEditPlan,
  targets: ReadonlyMap<string, SubjectEditTarget>,
  grant: GrantSnapshot,
  options: HostCommitCoordinatorOptions,
):
  | {
      readonly writeSet: DerivedWriteSet
      readonly authorization: CommitAuthorization
      readonly backends: ReadonlyMap<string, EditingBackend>
    }
  | { readonly rejection: 'plan-invalid' | 'source-read-only' } {
  const entries: WriteSetEntry[] = []
  const backends = new Map<string, EditingBackend>()
  for (const edit of plan.edits) {
    const target = targets.get(edit.targetId)
    const backend = options.backendFor(edit.source.id)
    if (target === undefined || backend === undefined || target.ownerSource.id !== edit.source.id) {
      return { rejection: 'plan-invalid' }
    }
    if (!backend.writable && plan.semantics.mutationMode === 'mutate') {
      return { rejection: 'source-read-only' }
    }
    if (edit.operation === 'rename' && !backend.profile.supportsRename) {
      return { rejection: 'plan-invalid' }
    }
    const path =
      edit.operation === 'create' || edit.operation === 'rename'
        ? normalizedPath(edit.newPath)
        : undefined
    if ((edit.operation === 'create' || edit.operation === 'rename') && path === undefined) {
      return { rejection: 'plan-invalid' }
    }
    entries.push(
      Object.freeze({
        targetId: edit.targetId,
        source: snapshot(edit.source),
        backendId: backend.profile.backendId,
        mode: modeOf(edit),
        ...(path === undefined ? {} : { normalizedPath: path }),
      }),
    )
    backends.set(edit.targetId, backend)
  }
  entries.sort(
    (left, right) =>
      compareUtf8(left.targetId, right.targetId) ||
      compareUtf8(left.source.id, right.source.id) ||
      compareUtf8(left.mode, right.mode),
  )
  const requiredPermissions =
    plan.semantics.mutationMode === 'mutate' ? ['write-source' as const] : []
  const missing = requiredPermissions.filter(permission => !grant.permissions.includes(permission))
  const scopeSatisfied = entries.every(entry => grant.sourceIds.includes(entry.source.id))
  const achievableGuarantee = strongestGuarantee([...backends.values()])
  const writeSet = Object.freeze({
    entries: Object.freeze(entries),
    digest: options.digest(
      entries.map(entry => ({
        targetId: entry.targetId,
        sourceId: entry.source.id,
        backendId: entry.backendId,
        mode: entry.mode,
        ...(entry.normalizedPath === undefined ? {} : { normalizedPath: entry.normalizedPath }),
      })),
    ),
  }) as DerivedWriteSet
  return {
    writeSet,
    backends,
    authorization: Object.freeze({
      requiredPermissions: Object.freeze(requiredPermissions),
      granted: missing.length === 0 && scopeSatisfied,
      achievableGuarantee,
      missing: Object.freeze(missing),
      scopeSatisfied,
    }),
  }
}

async function conflictsFor(
  targets: ReadonlyMap<string, SubjectEditTarget>,
  backends: ReadonlyMap<string, EditingBackend>,
  signal?: AbortSignal,
): Promise<readonly SourceConflict[]> {
  const conflicts: SourceConflict[] = []
  for (const [targetId, target] of targets) {
    const backend = backends.get(targetId)
    if (backend === undefined) continue
    const actual = snapshot(await backend.currentRevision(target, signal))
    if (!sameRevision(target.expectedRevision, actual)) {
      conflicts.push(
        Object.freeze({
          targetId,
          expected: snapshot(target.expectedRevision),
          actual: snapshot(actual),
        }),
      )
    }
  }
  return Object.freeze(conflicts.sort((left, right) => compareUtf8(left.targetId, right.targetId)))
}

async function payloadsAvailable(
  plan: AssetEditPlan,
  options: HostCommitCoordinatorOptions,
  signal?: AbortSignal,
): Promise<boolean> {
  const maximum = options.maxInlinePayloadBytes ?? 1024 * 1024
  for (const edit of plan.edits) {
    if (!('payload' in edit)) continue
    if (edit.payload.kind === 'inline' && edit.payload.bytes.byteLength > maximum) return false
    if (
      edit.payload.kind === 'text' &&
      new TextEncoder().encode(edit.payload.text).byteLength > maximum
    )
      return false
    if (edit.payload.kind !== 'staged') continue
    if (!edit.payload.ref.replayable || edit.payload.ref.bytes < 0n) return false
    if (
      edit.payload.ref.expiresAt !== undefined &&
      Date.parse(edit.payload.ref.expiresAt) <=
        Date.parse(options.now?.() ?? new Date().toISOString())
    ) {
      return false
    }
    if (options.verifyStagedPayload === undefined) return false
    try {
      if ((await options.verifyStagedPayload(edit.payload.ref as never, signal)) !== true)
        return false
    } catch {
      return false
    }
  }
  return true
}

function invalidPlan(plan: AssetEditPlan): boolean {
  if (
    !isRecord(plan) ||
    !hasExactKeys(plan, ['planId', 'targets', 'edits', 'semantics', 'fidelity', 'diagnostics']) ||
    !isNonBlank(plan.planId) ||
    !Array.isArray(plan.targets) ||
    plan.targets.length === 0 ||
    !Array.isArray(plan.edits) ||
    plan.edits.length === 0 ||
    !Array.isArray(plan.diagnostics) ||
    !isRecord(plan.semantics) ||
    !hasExactKeys(plan.semantics, ['mutationMode', 'minimumGuarantee']) ||
    !['export-only', 'mutate'].includes(plan.semantics.mutationMode) ||
    !['atomic', 'transactional', 'recoverable', 'best-effort'].includes(
      plan.semantics.minimumGuarantee,
    ) ||
    !isRecord(plan.fidelity) ||
    !hasExactKeys(plan.fidelity, ['roundTrip', 'preservesUnknownData', 'notes']) ||
    !['byte-identical', 'semantic', 'lossy', 'none'].includes(plan.fidelity.roundTrip) ||
    typeof plan.fidelity.preservesUnknownData !== 'boolean' ||
    (plan.fidelity.notes !== undefined &&
      (!Array.isArray(plan.fidelity.notes) || !plan.fidelity.notes.every(isNonBlank))) ||
    (plan.fidelity.roundTrip === 'byte-identical' && plan.fidelity.preservesUnknownData !== true) ||
    ((plan.fidelity.roundTrip === 'lossy' || plan.fidelity.roundTrip === 'none') &&
      plan.fidelity.preservesUnknownData !== false)
  ) {
    return true
  }
  const ids = new Set<string>()
  for (const target of plan.targets) {
    if (
      !isRecord(target) ||
      !hasExactKeys(target, [
        'targetId',
        'subjectUri',
        'ownerSource',
        'semanticPath',
        'expectedRevision',
      ]) ||
      !isNonBlank(target.targetId) ||
      ids.has(target.targetId) ||
      !isNonBlank(target.subjectUri) ||
      !isAssetSource(target.ownerSource) ||
      !Array.isArray(target.semanticPath) ||
      !target.semanticPath.every(isNonBlank) ||
      !isRevision(target.expectedRevision)
    ) {
      return true
    }
    ids.add(target.targetId)
  }
  const editedIds = new Set<string>()
  for (const edit of plan.edits) {
    if (!isSourceEdit(edit) || !ids.has(edit.targetId)) return true
    editedIds.add(edit.targetId)
    if (
      (edit.operation === 'create' || edit.operation === 'delete' || edit.operation === 'rename') &&
      plan.targets.find(target => target.targetId === edit.targetId)?.expectedRevision
        .namespaceRevision === undefined
    ) {
      return true
    }
  }
  return editedIds.size !== ids.size || [...ids].some(id => !editedIds.has(id))
}

export function createCommitCoordinator(options: HostCommitCoordinatorOptions): CommitCoordinator {
  options = Object.freeze({
    ...options,
    payloads: Object.freeze({ open: options.payloads.open.bind(options.payloads) }),
    ...(options.expectedWriter === undefined
      ? {}
      : { expectedWriter: snapshot(options.expectedWriter) }),
    ...(options.expectedEvidenceContext === undefined
      ? {}
      : { expectedEvidenceContext: snapshot(options.expectedEvidenceContext) }),
  })
  let serial = 0
  const nextId = (kind: 'prepared' | 'transaction') =>
    options.nextId?.(kind) ?? `${kind}-${String(++serial).padStart(6, '0')}`
  const preparedInputs = new WeakMap<object, InternalPrepared>()
  const history = new Map<string, HistoryEntry>()

  const prepare: CommitCoordinator['prepare'] = async (authoredPlan, prepareOptions) => {
    if (prepareOptions.signal?.aborted) {
      return { state: 'rejected', reason: 'cancelled', diagnostics: [] }
    }
    let grant: GrantSnapshot
    let plan: AssetEditPlan
    try {
      grant = snapshotGrant(prepareOptions.grant)
      plan = snapshot(authoredPlan)
    } catch {
      return { state: 'rejected', reason: 'plan-invalid', diagnostics: [] }
    }
    if (!grantIsValid(options, grant) || invalidPlan(plan)) {
      return { state: 'rejected', reason: 'plan-invalid', diagnostics: [] }
    }
    const targetMap = new Map(plan.targets.map(target => [target.targetId, target]))
    let derived: ReturnType<typeof derive>
    try {
      derived = derive(plan, targetMap, grant, options)
    } catch {
      return { state: 'rejected', reason: 'plan-invalid', diagnostics: [] }
    }
    if ('rejection' in derived) {
      return { state: 'rejected', reason: derived.rejection, diagnostics: [] }
    }
    if (!derived.authorization.scopeSatisfied) {
      return { state: 'rejected', reason: 'write-scope-mismatch', diagnostics: [] }
    }
    if (derived.authorization.missing.length > 0) {
      return { state: 'rejected', reason: 'permission-missing', diagnostics: [] }
    }
    if (
      GUARANTEE_STRENGTH[derived.authorization.achievableGuarantee] <
      GUARANTEE_STRENGTH[plan.semantics.minimumGuarantee]
    ) {
      return { state: 'rejected', reason: 'guarantee-unachievable', diagnostics: [] }
    }
    const canPartiallyApply =
      plan.edits.length > 1 && derived.authorization.achievableGuarantee !== 'atomic'
    if (canPartiallyApply && options.createRecovery === undefined) {
      return { state: 'rejected', reason: 'guarantee-unachievable', diagnostics: [] }
    }
    let fidelity: FidelityEvidence | undefined
    try {
      fidelity = options.evidenceFor(plan)
    } catch {
      fidelity = undefined
    }
    let proven = false
    try {
      proven = fidelityMatches(
        plan,
        fidelity,
        options.expectedWriter,
        options.expectedEvidenceContext,
      )
    } catch {
      proven = false
    }
    if (!proven) {
      /*
       * "Unproven" has two very different causes and one used to look like the other: no evidence
       * record covers this claim (the host's policy is incomplete), or a record exists and the
       * plan came from a writer this host pinned away (`expectedWriter`). The second sent an
       * implementer to audit an evidence registry that was fine. The diagnostic names which.
       */
      const pinned =
        options.expectedWriter !== undefined &&
        fidelity !== undefined &&
        fidelity.writer.providerId !== options.expectedWriter.providerId
      return {
        state: 'rejected',
        reason: 'fidelity-unproven',
        diagnostics: [
          {
            severity: 'error',
            code: pinned ? 'x3.host/fidelity-writer-pinned' : 'x3.host/fidelity-evidence-missing',
            message: pinned
              ? `this host pinned writes to «${options.expectedWriter?.providerId}», and this plan came from «${fidelity?.writer.providerId}»`
              : `no fidelity evidence covers ${plan.fidelity.roundTrip}/preservesUnknownData=${String(plan.fidelity.preservesUnknownData)} for this plan`,
            path: [],
          },
        ],
      }
    }
    if (
      (plan.fidelity.roundTrip === 'lossy' || plan.fidelity.roundTrip === 'none') &&
      (prepareOptions.confirmationToken === undefined ||
        !(options.confirmationMatches?.(prepareOptions.confirmationToken, plan) ?? false))
    ) {
      return { state: 'rejected', reason: 'confirmation-required', diagnostics: [] }
    }
    if (!(await payloadsAvailable(plan, options, prepareOptions.signal))) {
      return { state: 'rejected', reason: 'payload-unavailable', diagnostics: [] }
    }
    let conflicts: readonly SourceConflict[]
    try {
      conflicts = await conflictsFor(targetMap, derived.backends, prepareOptions.signal)
    } catch {
      return { state: 'rejected', reason: 'plan-invalid', diagnostics: [] }
    }
    if (conflicts.length > 0) return { state: 'conflict', conflicts }
    let prepared: PreparedCommit
    try {
      const planDigest = options.digest(planDigestValue(plan))
      prepared = Object.freeze({
        preparedId: nextId('prepared'),
        plan: snapshot(plan),
        planDigest,
        writeSet: derived.writeSet,
        authorization: derived.authorization,
        preparedRevisionFingerprint: revisionFingerprint(plan.targets, options.digest),
        fidelity: snapshot(fidelity),
      }) as PreparedCommit
    } catch {
      return { state: 'rejected', reason: 'plan-invalid', diagnostics: [] }
    }
    const internal = Object.freeze({
      plan,
      targets: targetMap,
      backends: derived.backends,
      prepared,
      ...(prepareOptions.confirmationToken === undefined
        ? {}
        : { confirmationToken: prepareOptions.confirmationToken }),
    })
    preparedInputs.set(prepared, internal)
    return { state: 'ready', prepared }
  }

  const commit: CommitCoordinator['commit'] = async (publicPrepared, commitOptions) => {
    const internal = preparedInputs.get(publicPrepared)
    if (internal === undefined) {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    if (commitOptions.signal?.aborted) {
      return { state: 'not-applied', reason: 'cancelled', diagnostics: [] }
    }
    let grant: GrantSnapshot
    try {
      grant = snapshotGrant(commitOptions.grant)
    } catch {
      return { state: 'not-applied', reason: 'permission-missing', diagnostics: [] }
    }
    if (!grantIsValid(options, grant)) {
      return { state: 'not-applied', reason: 'permission-missing', diagnostics: [] }
    }
    let fresh: ReturnType<typeof derive>
    try {
      fresh = derive(internal.plan, internal.targets, grant, options)
    } catch {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    if ('rejection' in fresh) {
      return { state: 'not-applied', reason: fresh.rejection, diagnostics: [] }
    }
    if (!fresh.authorization.scopeSatisfied) {
      return { state: 'not-applied', reason: 'write-scope-mismatch', diagnostics: [] }
    }
    if (fresh.authorization.missing.length > 0) {
      return { state: 'not-applied', reason: 'permission-missing', diagnostics: [] }
    }
    if (
      fresh.writeSet.digest !== internal.prepared.writeSet.digest ||
      GUARANTEE_STRENGTH[fresh.authorization.achievableGuarantee] <
        GUARANTEE_STRENGTH[internal.plan.semantics.minimumGuarantee]
    ) {
      return { state: 'not-applied', reason: 'guarantee-unachievable', diagnostics: [] }
    }
    if (!(await payloadsAvailable(internal.plan, options, commitOptions.signal))) {
      return { state: 'not-applied', reason: 'payload-unavailable', diagnostics: [] }
    }
    let conflicts: readonly SourceConflict[]
    try {
      conflicts = await conflictsFor(internal.targets, fresh.backends, commitOptions.signal)
    } catch {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    if (conflicts.length > 0) {
      return {
        state: 'not-applied',
        reason: 'stale-revision',
        conflicts,
        diagnostics: [],
      }
    }

    const transactionId = nextId('transaction')
    const before = internal.plan.targets.map(target => snapshot(target.expectedRevision))
    const writes: BindingWriteResult[] = []
    const latestRevisions = new Map(
      internal.plan.targets.map(target => [target.targetId, target.expectedRevision]),
    )
    const finalRevisions = () =>
      internal.plan.targets.map(target =>
        snapshot(latestRevisions.get(target.targetId) ?? target.expectedRevision),
      )
    const applied: { edit: SourceEdit; backend: EditingBackend; before: AssetRevision }[] = []
    if (fresh.authorization.achievableGuarantee === 'atomic') {
      const backend = [...new Set(fresh.backends.values())][0]
      if (backend?.applyBatch === undefined) {
        return { state: 'not-applied', reason: 'guarantee-unachievable', diagnostics: [] }
      }
      preparedInputs.delete(publicPrepared)
      try {
        const results = await backend.applyBatch(
          internal.plan.edits.map(edit => ({
            edit,
            expectedRevision:
              latestRevisions.get(edit.targetId) ??
              (internal.targets.get(edit.targetId) as SubjectEditTarget).expectedRevision,
          })),
          {
            transactionId,
            payloads: options.payloads,
            ...(commitOptions.signal === undefined ? {} : { signal: commitOptions.signal }),
          },
        )
        if (
          results.length !== internal.plan.edits.length ||
          results.some((result, index) => result.targetId !== internal.plan.edits[index]?.targetId)
        ) {
          throw new TypeError('atomic backend returned a malformed write result')
        }
        results.forEach((result, index) => {
          const edit = internal.plan.edits[index] as SourceEdit
          const stepBefore = latestRevisions.get(edit.targetId) as AssetRevision
          latestRevisions.set(edit.targetId, snapshot(result.after))
          applied.push({ edit, backend, before: stepBefore })
          writes.push(
            Object.freeze({
              targetId: edit.targetId,
              source: snapshot(edit.source),
              state: 'applied' as const,
              diagnosticIds: Object.freeze([...(result.diagnosticIds ?? [])]),
            }),
          )
          commitOptions.onProgress?.(index + 1)
        })
      } catch (error) {
        return {
          state: 'not-applied',
          reason: commitOptions.signal?.aborted ? 'cancelled' : 'plan-invalid',
          diagnostics: [
            diagnostic(
              'error',
              'x3.host/edit-write-failed',
              error instanceof Error ? error.message : String(error),
            ),
          ],
        }
      }
      const receipt = Object.freeze({
        transactionId,
        committedAt: options.now?.() ?? new Date().toISOString(),
        mutationMode: internal.plan.semantics.mutationMode,
        commitGuarantee: 'atomic' as const,
        status: 'committed' as const,
        undo:
          backend.profile.supportsRollback && backend.rollback !== undefined
            ? ('snapshot' as const)
            : ('none' as const),
        before: Object.freeze(before),
        after: Object.freeze(finalRevisions()),
        writes: Object.freeze(writes),
        fidelity: internal.prepared.fidelity,
      }) satisfies CommitReceipt
      history.set(transactionId, {
        plan: internal.plan,
        prepared: internal,
        receipt,
        steps: Object.freeze([...applied]),
      })
      return {
        state: 'committed',
        receipt: receipt as CommitReceipt & { readonly status: 'committed' },
      }
    }
    const needsRecovery = internal.plan.edits.length > 1
    let recovery: RecoveryRef | undefined
    try {
      recovery = needsRecovery
        ? await options.createRecovery?.(internal.prepared.preparedId, internal.prepared.planDigest)
        : undefined
    } catch {
      return { state: 'not-applied', reason: 'guarantee-unachievable', diagnostics: [] }
    }
    if (needsRecovery && !isRecoveryRef(recovery)) {
      return { state: 'not-applied', reason: 'guarantee-unachievable', diagnostics: [] }
    }
    if (recovery !== undefined) recovery = snapshot(recovery)
    preparedInputs.delete(publicPrepared)
    for (let index = 0; index < internal.plan.edits.length; index += 1) {
      const edit = internal.plan.edits[index] as SourceEdit
      const backend = fresh.backends.get(edit.targetId) as EditingBackend
      const target = internal.targets.get(edit.targetId) as SubjectEditTarget
      const expectedRevision = latestRevisions.get(edit.targetId) ?? target.expectedRevision
      try {
        const result = await backend.apply(edit, {
          transactionId,
          payloads: options.payloads,
          expectedRevision,
          ...(commitOptions.signal === undefined ? {} : { signal: commitOptions.signal }),
        })
        latestRevisions.set(edit.targetId, snapshot(result.after))
        applied.push({ edit, backend, before: expectedRevision })
        writes.push(
          Object.freeze({
            targetId: edit.targetId,
            source: snapshot(edit.source),
            state: 'applied',
            diagnosticIds: Object.freeze([...(result.diagnosticIds ?? [])]),
          }),
        )
        commitOptions.onProgress?.(index + 1)
      } catch (error) {
        writes.push(
          Object.freeze({
            targetId: edit.targetId,
            source: snapshot(edit.source),
            state: 'failed',
            diagnosticIds: Object.freeze(['x3.host/edit-write-failed']),
          }),
        )
        const diagnostics: Diagnostic[] = [
          diagnostic(
            'error',
            'x3.host/edit-write-failed',
            error instanceof Error ? error.message : String(error),
          ),
        ]
        if (applied.length === 0) {
          return {
            state: 'not-applied',
            reason: commitOptions.signal?.aborted ? 'cancelled' : 'plan-invalid',
            diagnostics,
          }
        }
        if (
          applied.every(
            item => item.backend.profile.supportsRollback && item.backend.rollback !== undefined,
          )
        ) {
          const rolledBackTargets = new Set<string>()
          try {
            for (const item of [...applied].reverse()) {
              latestRevisions.set(
                item.edit.targetId,
                await (item.backend.rollback as NonNullable<EditingBackend['rollback']>)(
                  transactionId,
                  item.edit,
                  item.before,
                  commitOptions.signal,
                ),
              )
              rolledBackTargets.add(item.edit.targetId)
            }
          } catch (rollbackError) {
            if (recovery === undefined) {
              return {
                state: 'not-applied',
                reason: 'guarantee-unachievable',
                diagnostics: [
                  ...diagnostics,
                  diagnostic(
                    'error',
                    'x3.host/edit-rollback-failed',
                    rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                  ),
                ],
              }
            }
            return {
              state: 'partially-applied',
              receipt: Object.freeze({
                transactionId,
                committedAt: options.now?.() ?? new Date().toISOString(),
                mutationMode: internal.plan.semantics.mutationMode,
                commitGuarantee: fresh.authorization.achievableGuarantee,
                status: 'partially-applied',
                undo: 'none',
                before: Object.freeze(before),
                after: Object.freeze(finalRevisions()),
                writes: Object.freeze(
                  writes.map(write =>
                    write.state === 'applied' && rolledBackTargets.has(write.targetId)
                      ? Object.freeze({ ...write, state: 'rolled-back' as const })
                      : write,
                  ),
                ),
                recovery,
                fidelity: internal.prepared.fidelity,
              }),
            }
          }
          const rolledWrites = writes.map(write =>
            write.state === 'applied'
              ? Object.freeze({ ...write, state: 'rolled-back' as const })
              : write,
          )
          return {
            state: 'rolled-back',
            receipt: Object.freeze({
              transactionId,
              committedAt: options.now?.() ?? new Date().toISOString(),
              mutationMode: internal.plan.semantics.mutationMode,
              commitGuarantee: fresh.authorization.achievableGuarantee,
              status: 'rolled-back',
              undo: 'none',
              before: Object.freeze(before),
              after: Object.freeze(finalRevisions()),
              writes: Object.freeze(rolledWrites),
              fidelity: internal.prepared.fidelity,
            }),
          }
        }
        if (recovery === undefined) {
          throw new TypeError('partial commit requires a durable recovery reference')
        }
        return {
          state: 'partially-applied',
          receipt: Object.freeze({
            transactionId,
            committedAt: options.now?.() ?? new Date().toISOString(),
            mutationMode: internal.plan.semantics.mutationMode,
            commitGuarantee: fresh.authorization.achievableGuarantee,
            status: 'partially-applied',
            undo: 'none',
            before: Object.freeze(before),
            after: Object.freeze(finalRevisions()),
            writes: Object.freeze(writes),
            recovery,
            fidelity: internal.prepared.fidelity,
          }),
        }
      }
    }

    const receipt = Object.freeze({
      transactionId,
      committedAt: options.now?.() ?? new Date().toISOString(),
      mutationMode: internal.plan.semantics.mutationMode,
      commitGuarantee: fresh.authorization.achievableGuarantee,
      status: 'committed',
      undo: applied.every(
        item => item.backend.profile.supportsRollback && item.backend.rollback !== undefined,
      )
        ? 'snapshot'
        : 'none',
      before: Object.freeze(before),
      after: Object.freeze(finalRevisions()),
      writes: Object.freeze(writes),
      ...(recovery === undefined ? {} : { recovery }),
      fidelity: internal.prepared.fidelity,
    }) satisfies CommitReceipt
    history.set(transactionId, {
      plan: internal.plan,
      prepared: internal,
      receipt,
      steps: Object.freeze([...applied]),
    })
    return {
      state: 'committed',
      receipt: receipt as CommitReceipt & { readonly status: 'committed' },
    }
  }

  const undo: CommitCoordinator['undo'] = async (transactionId, undoOptions) => {
    const item = history.get(transactionId)
    if (item === undefined) {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    let grant: GrantSnapshot
    try {
      grant = snapshotGrant(undoOptions.grant)
    } catch {
      return { state: 'not-applied', reason: 'permission-missing', diagnostics: [] }
    }
    if (!grantIsValid(options, grant)) {
      return { state: 'not-applied', reason: 'permission-missing', diagnostics: [] }
    }
    let fresh: ReturnType<typeof derive>
    try {
      fresh = derive(item.plan, item.prepared.targets, grant, options)
    } catch {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    if ('rejection' in fresh || fresh.authorization.missing.length > 0) {
      return { state: 'not-applied', reason: 'permission-missing', diagnostics: [] }
    }
    if (!fresh.authorization.scopeSatisfied) {
      return { state: 'not-applied', reason: 'write-scope-mismatch', diagnostics: [] }
    }
    const currentTargets = new Map(
      item.plan.targets.map((target, index) => [
        target.targetId,
        Object.freeze({ ...target, expectedRevision: item.receipt.after[index] as AssetRevision }),
      ]),
    )
    let conflicts: readonly SourceConflict[]
    try {
      conflicts = await conflictsFor(currentTargets, fresh.backends, undoOptions.signal)
    } catch {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    if (conflicts.length > 0) {
      return { state: 'not-applied', reason: 'stale-revision', conflicts, diagnostics: [] }
    }
    const latestRevisions = new Map(
      item.plan.targets.map((target, index) => [
        target.targetId,
        item.receipt.after[index] as AssetRevision,
      ]),
    )
    for (const step of [...item.steps].reverse()) {
      const backend = fresh.backends.get(step.edit.targetId)
      if (backend?.rollback === undefined) {
        return { state: 'not-applied', reason: 'guarantee-unachievable', diagnostics: [] }
      }
      latestRevisions.set(
        step.edit.targetId,
        await backend.rollback(transactionId, step.edit, step.before, undoOptions.signal),
      )
    }
    const after = item.plan.targets.map(target =>
      snapshot(latestRevisions.get(target.targetId) ?? target.expectedRevision),
    )
    const receipt = Object.freeze({
      transactionId: nextId('transaction'),
      committedAt: options.now?.() ?? new Date().toISOString(),
      mutationMode: item.plan.semantics.mutationMode,
      commitGuarantee: item.receipt.commitGuarantee,
      status: 'committed',
      undo: 'none',
      before: item.receipt.after,
      after: Object.freeze(after),
      writes: Object.freeze(
        item.receipt.writes.map(write =>
          Object.freeze({ ...write, state: 'rolled-back' as const }),
        ),
      ),
      fidelity: item.receipt.fidelity,
    }) satisfies CommitReceipt
    return {
      state: 'committed',
      receipt: receipt as CommitReceipt & { readonly status: 'committed' },
    }
  }

  const redo: CommitCoordinator['redo'] = async (transactionId, redoOptions) => {
    const item = history.get(transactionId)
    if (item === undefined) {
      return { state: 'not-applied', reason: 'plan-invalid', diagnostics: [] }
    }
    const prepared = await prepare(item.plan, {
      grant: redoOptions.grant,
      confirmationToken: item.prepared.confirmationToken ?? 'explicit-redo',
      ...(redoOptions.signal === undefined ? {} : { signal: redoOptions.signal }),
    })
    if (prepared.state === 'conflict') {
      return {
        state: 'not-applied',
        reason: 'stale-revision',
        conflicts: prepared.conflicts,
        diagnostics: [],
      }
    }
    if (prepared.state === 'rejected') {
      return { state: 'not-applied', reason: prepared.reason, diagnostics: prepared.diagnostics }
    }
    return commit(prepared.prepared, redoOptions)
  }

  return Object.freeze({ prepare, commit, undo, redo })
}

export function createEditSession(options: {
  readonly revision: AssetRevision
  readonly targets: readonly SubjectEditTarget[]
  readonly writer: Writer
}): ManagedEditSession {
  let state: EditSessionState = 'live'
  const targets = snapshot(options.targets)
  const revision = snapshot(options.revision)
  const validate = options.writer.validate.bind(options.writer)
  const plan = options.writer.plan.bind(options.writer)
  const ensureLive = () => {
    if (state !== 'live') throw new TypeError(`edit session is ${state}`)
  }
  return Object.freeze({
    revision,
    targets,
    state: () => state,
    async propose(change: ChangeSet): Promise<ValidationResult> {
      ensureLive()
      const result = snapshot(await validate(snapshot(change)))
      if (
        !isRecord(result) ||
        !hasExactKeys(result, ['valid', 'diagnostics']) ||
        typeof result['valid'] !== 'boolean' ||
        !Array.isArray(result['diagnostics'])
      ) {
        return {
          valid: false,
          diagnostics: [
            diagnostic(
              'error',
              'x3.host/edit-validation-result-invalid',
              'writer returned a malformed validation result',
            ),
          ],
        }
      }
      return result
    },
    async plan(change: ChangeSet): Promise<AssetEditPlan> {
      ensureLive()
      return snapshot(await plan(snapshot(change)))
    },
    markStale() {
      if (state !== 'disposed') state = 'stale-revision'
    },
    markCommitting(committing: boolean) {
      if (state === 'disposed') return
      state = committing ? 'committing' : 'live'
    },
    async dispose() {
      state = 'disposed'
    },
  })
}
