import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import {
  EDITOR_CONTRIBUTION_CONTRACT,
  revisionId,
  validateContributionManifest,
  type AssetEditPlan,
  type AssetRevision,
  type ChangeSet,
  type CommitGuarantee,
  type EditorContributionSpecV1Wire,
  type FidelityClaim,
  type FidelityEvidence,
  type GrantSnapshot,
  type PayloadStore,
  type SourceEdit,
  type SubjectEditTarget,
  type Writer,
  type WriterIdentity,
} from '@modkitx-x3/sdk'
import {
  createCommitCoordinator,
  createEditSession,
  createGrantSnapshot,
  createHostContributionContractRegistry,
  type EditingBackend,
} from '@modkitx-x3/host'

const source = (id: string) => ({ id, uri: `memory://${id}` })

function revision(
  value: string,
  options: { namespace?: boolean; composition?: string } = {},
): AssetRevision {
  return {
    bindings: { content: revisionId(`content-hash.sha256:${value}`) },
    ...(options.namespace
      ? { namespaceRevision: revisionId(`provider-token:${value}-namespace`) }
      : {}),
    compositionFingerprint: options.composition ?? `composition-${value}`,
  }
}

function target(
  targetId: string,
  sourceId: string,
  expectedRevision: AssetRevision,
): SubjectEditTarget {
  return {
    targetId,
    subjectUri: `memory://${sourceId}`,
    ownerSource: source(sourceId),
    semanticPath: ['root'],
    expectedRevision,
  }
}

const byteIdentical: FidelityClaim = {
  roundTrip: 'byte-identical',
  preservesUnknownData: true,
}

const writerIdentity: WriterIdentity = {
  providerId: 'org.example/json-writer',
  providerVersion: '1.0.0',
  artifactDigest: 'sha256:writer',
  formatId: 'jsonc',
  representationId: 'source',
}

const evidenceBase: Pick<
  FidelityEvidence,
  | 'evidenceId'
  | 'corpusId'
  | 'corpusDigest'
  | 'conformanceProfile'
  | 'writer'
  | 'optionsFingerprint'
  | 'inputClass'
  | 'provenAt'
> = {
  evidenceId: 'jsonc-corpus-v1',
  corpusId: 'org.example/jsonc-corpus',
  corpusDigest: 'sha256:corpus',
  conformanceProfile: 'org.example/jsonc-writer-v1',
  writer: writerIdentity,
  optionsFingerprint: 'options:default',
  inputClass: 'jsonc-with-comments',
  provenAt: '2026-08-15T00:00:00.000Z',
}

function evidence(overrides: Partial<typeof evidenceBase> = {}): FidelityEvidence {
  return {
    ...byteIdentical,
    ...evidenceBase,
    ...overrides,
  }
}

function replaceEdit(targetId: string, sourceId: string, text = 'updated'): SourceEdit {
  return {
    operation: 'replace',
    targetId,
    source: source(sourceId),
    payload: { kind: 'text', text },
  }
}

function plan(
  targets: readonly SubjectEditTarget[],
  edits: readonly SourceEdit[],
  options: {
    guarantee?: CommitGuarantee
    fidelity?: FidelityClaim
    planId?: string
  } = {},
): AssetEditPlan {
  return {
    planId: options.planId ?? 'plan-1',
    targets,
    edits,
    semantics: { mutationMode: 'mutate', minimumGuarantee: options.guarantee ?? 'best-effort' },
    fidelity: options.fidelity ?? byteIdentical,
    diagnostics: [],
  }
}

function digest(value: unknown): string {
  return canonicalJsonStringify(JSON.parse(JSON.stringify(value)) as never)
}

class MemoryEditingBackend implements EditingBackend {
  readonly revisions = new Map<string, AssetRevision>()
  readonly applied: string[] = []
  readonly rolledBack: string[] = []
  failTarget?: string

  constructor(
    readonly profile: EditingBackend['profile'],
    readonly writable = true,
  ) {}

  seed(targetId: string, value: AssetRevision): void {
    this.revisions.set(targetId, value)
  }

  async currentRevision(value: SubjectEditTarget): Promise<AssetRevision> {
    const found = this.revisions.get(value.targetId)
    if (found === undefined) throw new TypeError(`missing revision ${value.targetId}`)
    return found
  }

  async apply(
    edit: SourceEdit,
    options: {
      transactionId: string
      payloads: PayloadStore
      expectedRevision: AssetRevision
    },
  ): Promise<{ after: AssetRevision }> {
    if (edit.targetId === this.failTarget) throw new Error(`write failed for ${edit.targetId}`)
    const current = this.revisions.get(edit.targetId)
    if (current === undefined) throw new TypeError(`missing target ${edit.targetId}`)
    if (digest(current) !== digest(options.expectedRevision))
      throw new Error('conditional write lost')
    const after = revision(`${edit.targetId}-${this.applied.length + 1}`, {
      namespace: current.namespaceRevision !== undefined,
      composition: `${current.compositionFingerprint}:applied`,
    })
    this.revisions.set(edit.targetId, after)
    this.applied.push(edit.targetId)
    return { after }
  }

  async applyBatch(
    requests: readonly { edit: SourceEdit; expectedRevision: AssetRevision }[],
    options: { transactionId: string; payloads: PayloadStore },
  ) {
    for (const request of requests) {
      if (request.edit.targetId === this.failTarget) {
        throw new Error(`atomic write failed for ${request.edit.targetId}`)
      }
      const current = this.revisions.get(request.edit.targetId)
      if (current === undefined || digest(current) !== digest(request.expectedRevision)) {
        throw new Error('atomic conditional write lost')
      }
    }
    const results = []
    const latest = new Map(
      requests.map(request => [request.edit.targetId, request.expectedRevision]),
    )
    for (const request of requests) {
      const result = await this.apply(request.edit, {
        ...options,
        expectedRevision: latest.get(request.edit.targetId) as AssetRevision,
      })
      latest.set(request.edit.targetId, result.after)
      results.push({ targetId: request.edit.targetId, ...result })
    }
    return results
  }

  async rollback(
    _transactionId: string,
    edit: SourceEdit,
    before: AssetRevision,
  ): Promise<AssetRevision> {
    this.revisions.set(edit.targetId, before)
    this.rolledBack.push(edit.targetId)
    return before
  }
}

function withoutRollback(backend: MemoryEditingBackend): EditingBackend {
  return {
    profile: backend.profile,
    writable: backend.writable,
    currentRevision: value => backend.currentRevision(value),
    apply: (edit, options) => backend.apply(edit, options),
  }
}

const atomicCapability = {
  backendId: 'memory-atomic',
  guarantees: ['atomic', 'transactional', 'recoverable', 'best-effort'] as const,
  supportsPrepare: true,
  supportsRollback: true,
  supportsJournal: true,
  supportsRename: true,
}

const bestEffortCapability = {
  backendId: 'memory-best-effort',
  guarantees: ['best-effort'] as const,
  supportsPrepare: false,
  supportsRollback: false,
  supportsJournal: false,
  supportsRename: true,
}

const transactionalCapability = {
  ...atomicCapability,
  backendId: 'memory-transactional',
  guarantees: ['transactional', 'recoverable', 'best-effort'] as const,
}

const payloads: PayloadStore = {
  async open() {
    throw new Error('no staged payload expected')
  },
}

function grant(id = 'grant-1', sourceIds: readonly string[] = ['a', 'b']): GrantSnapshot {
  return createGrantSnapshot({
    snapshotId: id,
    permissions: ['write-source'],
    sourceIds,
  })
}

function coordinator(
  backends: Readonly<Record<string, EditingBackend>>,
  options: {
    validGrants?: Set<string>
    selectedEvidence?: FidelityEvidence
    recovery?: boolean
    verifyStaged?: boolean
  } = {},
) {
  const validGrants = options.validGrants ?? new Set(['grant-1', 'grant-2'])
  return createCommitCoordinator({
    payloads,
    backendFor: id => backends[id],
    evidenceFor: () => options.selectedEvidence ?? evidence(),
    expectedWriter: writerIdentity,
    expectedEvidenceContext: {
      optionsFingerprint: 'options:default',
      inputClass: 'jsonc-with-comments',
    },
    isGrantValid: value => validGrants.has(value.snapshotId),
    digest,
    verifyStagedPayload: async () => options.verifyStaged ?? true,
    ...(options.recovery
      ? {
          async createRecovery(preparedId: string, planDigest: string) {
            return { kind: 'journal' as const, ref: `journal:${preparedId}`, digest: planDigest }
          },
        }
      : {}),
    confirmationMatches: token => token === 'confirmed',
    now: () => '2026-08-15T00:00:00.000Z',
  })
}

function editorSpec(): EditorContributionSpecV1Wire {
  return {
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
  }
}

describe('13D universal editing contracts and host transaction coordinator', () => {
  it('discovers a declarative editor and refuses trait/data-only lookalikes (D-01/D-02)', async () => {
    const manifest = {
      schemaVersion: 1,
      contract: { id: EDITOR_CONTRIBUTION_CONTRACT, major: 1 },
      id: 'org.example/jsonc-editor',
      displayName: 'JSONC editor',
      runtimeVariants: [
        {
          variantId: 'browser',
          entrypoint: './editor.js',
          target: { environments: ['browser-main'] },
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: [],
        },
      ],
      spec: editorSpec(),
    }
    const registry = createHostContributionContractRegistry().validationRegistry()
    const valid = await validateContributionManifest(manifest, registry)
    expect(valid.specState, JSON.stringify(valid.diagnostics)).toBe('validated')
    expect(valid.inventoryEligible).toBe(true)
    const invalid = await validateContributionManifest(
      {
        ...manifest,
        id: 'org.example/lookalike',
        spec: { ...editorSpec(), requiresOperations: [] },
      },
      registry,
    )
    expect(invalid.specState).toBe('invalid')
    expect(invalid.diagnostics.map(item => item.code)).toContain(
      'x3.sdk/editor-edit-operation-missing',
    )
  })

  it('runs ChangeSet → validate → plan → prepared snapshot → commit (D-03/D-13)', async () => {
    const initial = revision('initial')
    const editTarget = target('main', 'a', initial)
    const change: ChangeSet = {
      targets: [editTarget],
      edits: [replaceEdit('main', 'a', 'before-mutation')],
      provenance: { actor: 'user' },
    }
    const writer: Writer = {
      identity: writerIdentity,
      offer: {
        providerId: writerIdentity.providerId,
        fidelityEvidenceId: 'jsonc-corpus-v1',
        formatId: 'jsonc',
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
      async validate(value) {
        return { valid: value.edits.length === 1, diagnostics: [] }
      },
      async plan(value) {
        return plan(value.targets, value.edits)
      },
    }
    const session = createEditSession({ revision: initial, targets: [editTarget], writer })
    await expect(session.propose(change)).resolves.toEqual({ valid: true, diagnostics: [] })
    const sessionPlan = await session.plan(change)
    expect(sessionPlan.edits).toHaveLength(1)
    const authored = plan([editTarget], [replaceEdit('main', 'a', 'before-mutation')])
    const backend = new MemoryEditingBackend(atomicCapability)
    backend.seed('main', initial)
    const commits = coordinator({ a: backend })
    const prepared = await commits.prepare(authored, { grant: grant() })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return
    ;(authored.edits[0] as { payload: { text: string } }).payload.text = 'hostile-after-prepare'
    const result = await commits.commit(prepared.prepared, { grant: grant('grant-2') })
    expect(result.state).toBe('committed')
    expect(backend.applied).toEqual(['main'])
    expect(prepared.prepared.writeSet.entries).toHaveLength(1)
    expect('writeSet' in authored).toBe(false)
    expect(await commits.commit(prepared.prepared, { grant: grant('grant-2') })).toMatchObject({
      state: 'not-applied',
      reason: 'plan-invalid',
    })
    const cyclic = plan([editTarget], [replaceEdit('main', 'a')]) as AssetEditPlan & {
      cycle?: unknown
    }
    cyclic.cycle = cyclic
    expect(await commits.prepare(cyclic, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'plan-invalid',
    })
    await session.dispose()
    expect(session.state()).toBe('disposed')
  })

  it('rechecks revoked grants and revisions immediately before side effects (D-14…D-17)', async () => {
    const initial = revision('initial', { namespace: true })
    const editTarget = target('sidecar', 'a', initial)
    const backend = new MemoryEditingBackend(atomicCapability)
    backend.seed('sidecar', initial)
    const validGrants = new Set(['grant-1', 'grant-2'])
    const commits = coordinator({ a: backend }, { validGrants })
    const authored = plan([editTarget], [replaceEdit('sidecar', 'a')])
    const first = await commits.prepare(authored, { grant: grant() })
    expect(first.state).toBe('ready')
    if (first.state !== 'ready') return
    validGrants.delete('grant-2')
    expect(await commits.commit(first.prepared, { grant: grant('grant-2') })).toMatchObject({
      state: 'not-applied',
      reason: 'permission-missing',
    })
    expect(backend.applied).toEqual([])

    validGrants.add('no-write')
    const noWrite = createGrantSnapshot({
      snapshotId: 'no-write',
      permissions: [],
      sourceIds: ['a'],
    })
    expect(await commits.prepare(authored, { grant: noWrite })).toMatchObject({
      state: 'rejected',
      reason: 'permission-missing',
    })

    validGrants.add('grant-2')
    const second = await commits.prepare(authored, { grant: grant() })
    expect(second.state).toBe('ready')
    if (second.state !== 'ready') return
    backend.seed('sidecar', revision('external', { namespace: true, composition: 'changed' }))
    const stale = await commits.commit(second.prepared, { grant: grant('grant-2') })
    expect(stale).toMatchObject({ state: 'not-applied', reason: 'stale-revision' })
    expect(stale.state === 'not-applied' ? stale.conflicts?.[0]?.targetId : undefined).toBe(
      'sidecar',
    )
    expect(backend.applied).toEqual([])

    const missingVector = plan(
      [{ ...editTarget, expectedRevision: { bindings: {}, compositionFingerprint: 'x' } }],
      [replaceEdit('sidecar', 'a')],
    )
    expect(await commits.prepare(missingVector, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'plan-invalid',
    })

    const compositeRevision: AssetRevision = {
      bindings: {
        map: revisionId('content-hash.sha256:map'),
        sidecar: revisionId('content-hash.sha256:sidecar'),
      },
      compositionFingerprint: 'composition:map-and-sidecar',
    }
    const compositeTarget = target('composite', 'a', compositeRevision)
    backend.seed('composite', compositeRevision)
    const compositePlan = plan([compositeTarget], [replaceEdit('composite', 'a', 'map update')], {
      planId: 'map-sidecar-plan',
    })
    const compositePrepared = await commits.prepare(compositePlan, { grant: grant() })
    expect(compositePrepared.state).toBe('ready')
    if (compositePrepared.state !== 'ready') return
    backend.seed('composite', {
      ...compositeRevision,
      bindings: {
        ...compositeRevision.bindings,
        sidecar: revisionId('content-hash.sha256:externally-changed-sidecar'),
      },
    })
    expect(
      await commits.commit(compositePrepared.prepared, { grant: grant('grant-2') }),
    ).toMatchObject({ state: 'not-applied', reason: 'stale-revision' })
    expect(backend.applied).toEqual([])
  })

  it('rolls back transactional failures and returns durable recovery for partial writes (D-05/D-06/D-18/D-19)', async () => {
    const firstRevision = revision('first')
    const secondRevision = revision('second')
    const atomicBoundary = new MemoryEditingBackend(atomicCapability)
    atomicBoundary.seed('first', firstRevision)
    atomicBoundary.seed('second', secondRevision)
    atomicBoundary.failTarget = 'second'
    const indivisiblePlan = plan(
      [target('first', 'a', firstRevision), target('second', 'b', secondRevision)],
      [replaceEdit('first', 'a'), replaceEdit('second', 'b')],
      { guarantee: 'atomic', planId: 'm3-m3a-atomic' },
    )
    const atomicCoordinator = coordinator({ a: atomicBoundary, b: atomicBoundary })
    const atomicReady = await atomicCoordinator.prepare(indivisiblePlan, { grant: grant() })
    expect(atomicReady.state).toBe('ready')
    if (atomicReady.state !== 'ready') return
    expect(
      await atomicCoordinator.commit(atomicReady.prepared, { grant: grant('grant-2') }),
    ).toMatchObject({ state: 'not-applied' })
    expect(atomicBoundary.applied).toEqual([])

    const atomic = new MemoryEditingBackend(transactionalCapability)
    atomic.seed('first', firstRevision)
    atomic.seed('second', secondRevision)
    atomic.failTarget = 'second'
    const transactional = coordinator({ a: atomic, b: atomic }, { recovery: true })
    const atomicPlan = plan(
      [target('first', 'a', firstRevision), target('second', 'b', secondRevision)],
      [replaceEdit('first', 'a'), replaceEdit('second', 'b')],
      { guarantee: 'transactional' },
    )
    const ready = await transactional.prepare(atomicPlan, { grant: grant() })
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    const rolledBack = await transactional.commit(ready.prepared, { grant: grant('grant-2') })
    expect(rolledBack.state).toBe('rolled-back')
    expect(atomic.rolledBack).toEqual(['first'])
    expect(await atomic.currentRevision(atomicPlan.targets[0] as SubjectEditTarget)).toEqual(
      firstRevision,
    )

    const left = new MemoryEditingBackend({ ...bestEffortCapability, backendId: 'left' })
    const right = new MemoryEditingBackend({ ...bestEffortCapability, backendId: 'right' })
    left.seed('first', firstRevision)
    right.seed('second', secondRevision)
    right.failTarget = 'second'
    const partialPlan = plan(
      [target('first', 'a', firstRevision), target('second', 'b', secondRevision)],
      [replaceEdit('first', 'a'), replaceEdit('second', 'b')],
    )
    expect(
      await coordinator({ a: withoutRollback(left), b: withoutRollback(right) }).prepare(
        partialPlan,
        { grant: grant() },
      ),
    ).toMatchObject({
      state: 'rejected',
      reason: 'guarantee-unachievable',
    })
    const recoverable = coordinator(
      { a: withoutRollback(left), b: withoutRollback(right) },
      { recovery: true },
    )
    const partialReady = await recoverable.prepare(partialPlan, { grant: grant() })
    expect(partialReady.state).toBe('ready')
    if (partialReady.state !== 'ready') return
    const partial = await recoverable.commit(partialReady.prepared, { grant: grant('grant-2') })
    expect(partial.state).toBe('partially-applied')
    if (partial.state === 'partially-applied') {
      expect(partial.receipt.recovery).toMatchObject({ kind: 'journal' })
      expect(partial.receipt.writes.map(write => write.state)).toEqual(['applied', 'failed'])
    }
  })

  it('binds fidelity, confirmation and staged payload authority (D-10/D-11/D-20…D-22)', async () => {
    const initial = revision('initial')
    const editTarget = target('main', 'a', initial)
    const backend = new MemoryEditingBackend(atomicCapability)
    backend.seed('main', initial)
    const authored = plan([editTarget], [replaceEdit('main', 'a')])
    const wrongEvidence = evidence({
      writer: { ...writerIdentity, artifactDigest: 'sha256:other-writer' },
    })
    expect(
      await coordinator({ a: backend }, { selectedEvidence: wrongEvidence }).prepare(authored, {
        grant: grant(),
      }),
    ).toMatchObject({ state: 'rejected', reason: 'fidelity-unproven' })
    const wrongOptions = evidence({ optionsFingerprint: 'options:other' })
    expect(
      await coordinator({ a: backend }, { selectedEvidence: wrongOptions }).prepare(authored, {
        grant: grant(),
      }),
    ).toMatchObject({ state: 'rejected', reason: 'fidelity-unproven' })

    const lossy = plan([editTarget], [replaceEdit('main', 'a')], {
      fidelity: { roundTrip: 'lossy', preservesUnknownData: false },
    })
    const lossyEvidence: FidelityEvidence = {
      ...evidenceBase,
      roundTrip: 'lossy',
      preservesUnknownData: false,
    }
    const lossyCoordinator = coordinator({ a: backend }, { selectedEvidence: lossyEvidence })
    expect(await lossyCoordinator.prepare(lossy, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'confirmation-required',
    })
    expect(
      await lossyCoordinator.prepare(lossy, { grant: grant(), confirmationToken: 'confirmed' }),
    ).toMatchObject({ state: 'ready' })

    const staged = plan(
      [editTarget],
      [
        {
          operation: 'replace',
          targetId: 'main',
          source: source('a'),
          payload: {
            kind: 'staged',
            ref: {
              storeId: 'host',
              handleId: 'payload-1',
              digest: 'sha256:payload',
              bytes: 10n,
              replayable: true,
            },
          },
        },
      ],
    )
    expect(
      await coordinator({ a: backend }, { verifyStaged: false }).prepare(staged, {
        grant: grant(),
      }),
    ).toMatchObject({ state: 'rejected', reason: 'payload-unavailable' })
    const stagedCoordinator = coordinator({ a: backend }, { verifyStaged: true })
    const stagedReady = await stagedCoordinator.prepare(staged, { grant: grant() })
    expect(stagedReady.state).toBe('ready')
    const invalidReplay = {
      ...staged,
      edits: [
        {
          ...(staged.edits[0] as Extract<SourceEdit, { operation: 'replace' }>),
          payload: {
            kind: 'staged',
            ref: {
              storeId: 'host',
              handleId: 'payload-invalid',
              digest: 'sha256:invalid',
              bytes: 10n,
              replayable: false,
            },
          },
        },
      ],
    } as unknown as AssetEditPlan
    expect(await stagedCoordinator.prepare(invalidReplay, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'plan-invalid',
    })
    const expired = {
      ...staged,
      edits: [
        {
          ...(staged.edits[0] as Extract<SourceEdit, { operation: 'replace' }>),
          payload: {
            kind: 'staged',
            ref: {
              storeId: 'host',
              handleId: 'payload-expired',
              digest: 'sha256:expired',
              bytes: 10n,
              replayable: true,
              expiresAt: '2026-08-14T00:00:00.000Z',
            },
          },
        },
      ],
    } as AssetEditPlan
    expect(await stagedCoordinator.prepare(expired, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'payload-unavailable',
    })
  })

  it('rejects traversal/read-only sources and supports fresh-grant undo/redo (D-07…D-09/D-23/D-24)', async () => {
    const namespaceRevision = revision('archive', { namespace: true })
    const archiveTarget = target('archive', 'a', namespaceRevision)
    const backend = new MemoryEditingBackend(atomicCapability)
    backend.seed('archive', namespaceRevision)
    const commits = coordinator({ a: backend })
    const traversal = plan(
      [archiveTarget],
      [
        {
          operation: 'create',
          targetId: 'archive',
          source: source('a'),
          newPath: '../outside.bin',
          payload: { kind: 'inline', bytes: new Uint8Array([1]) },
        },
      ],
    )
    expect(await commits.prepare(traversal, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'plan-invalid',
    })
    const renameTraversal = plan(
      [archiveTarget],
      [
        {
          operation: 'rename',
          targetId: 'archive',
          source: source('a'),
          newPath: 'entries\\..\\outside.bin',
        },
      ],
    )
    expect(await commits.prepare(renameTraversal, { grant: grant() })).toMatchObject({
      state: 'rejected',
      reason: 'plan-invalid',
    })

    const readOnly = new MemoryEditingBackend(atomicCapability, false)
    readOnly.seed('archive', namespaceRevision)
    expect(
      await coordinator({ a: readOnly }).prepare(
        plan([archiveTarget], [replaceEdit('archive', 'a')]),
        { grant: grant() },
      ),
    ).toMatchObject({ state: 'rejected', reason: 'source-read-only' })

    const authored = plan([archiveTarget], [replaceEdit('archive', 'a')])
    const ready = await commits.prepare(authored, { grant: grant() })
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    const committed = await commits.commit(ready.prepared, { grant: grant('grant-2') })
    expect(committed.state).toBe('committed')
    if (committed.state !== 'committed') return
    const revoked = createGrantSnapshot({
      snapshotId: 'revoked',
      permissions: ['write-source'],
      sourceIds: ['a'],
    })
    expect(await commits.undo(committed.receipt.transactionId, { grant: revoked })).toMatchObject({
      state: 'not-applied',
      reason: 'permission-missing',
    })
    expect(
      await commits.undo(committed.receipt.transactionId, { grant: grant('grant-2') }),
    ).toMatchObject({ state: 'committed' })
    expect(
      await commits.redo(committed.receipt.transactionId, { grant: grant('grant-2') }),
    ).toMatchObject({ state: 'committed' })
  })

  it('undoes multiple writes to one target through their exact per-step revisions', async () => {
    const initial = revision('same-target')
    const sameTarget = target('same', 's', initial)
    const backend = new MemoryEditingBackend(atomicCapability)
    backend.seed('same', initial)
    const commits = coordinator(
      { s: backend },
      { validGrants: new Set(['same-target-prepare', 'same-target-commit', 'same-target-undo']) },
    )
    const ready = await commits.prepare(
      plan([sameTarget], [replaceEdit('same', 's'), replaceEdit('same', 's')], {
        guarantee: 'atomic',
        planId: 'same-target-plan',
      }),
      { grant: grant('same-target-prepare', ['s']) },
    )
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    const committed = await commits.commit(ready.prepared, {
      grant: grant('same-target-commit', ['s']),
    })
    expect(committed.state).toBe('committed')
    if (committed.state !== 'committed') return
    expect(committed.receipt.after).toHaveLength(1)
    expect(backend.revisions.get('same')).not.toEqual(initial)

    const undone = await commits.undo(committed.receipt.transactionId, {
      grant: grant('same-target-undo', ['s']),
    })
    expect(undone.state).toBe('committed')
    expect(backend.revisions.get('same')).toEqual(initial)
    if (undone.state === 'committed') expect(undone.receipt.after).toEqual([initial])
  })
})
