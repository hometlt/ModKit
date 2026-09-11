/**
 * The renderer's editing seam, everything of it that is decidable without a window.
 *
 * The Electron renderer cannot run under vitest (it is a browser bundle over the preload bridge),
 * so what is proved here is the part that does not need one: the ports adapter over a fake editing
 * arm — ids in and out, dirty state, the reason a refusal carries, and the change-set shape the
 * arm is actually given — plus the policy rule that decides which stages a subject with no arm may
 * still be shown. The live end of it (an edit reaching a file on disk) is the `--selftest` run.
 */
import { describe, expect, it } from 'vitest'
import { revisionId } from '@modkit/sdk'
import { createUiLocalizer, type UiLocalizer } from '@modkit/ui/localization'
import type {
  AssetEditPlan,
  AssetRevision,
  ChangeSet,
  SubjectEditTarget,
  ValidationResult,
} from '@modkit/sdk'
import type {
  SubjectEditingArm,
  SubjectEditingCommitResult,
  SubjectEditingPrepareResult,
  SubjectEditingState,
} from '@modkit/host'

import {
  commitStatus,
  createRendererEditorPorts,
  normalizeChangeSet,
  prepareStatus,
  refusalMessage,
  type EditorStatus,
} from '../src/editor-ports.js'
import { readOnlyStages, type StageBinding } from '../src/view-policy.js'

const REVISION: AssetRevision = Object.freeze({
  bindings: Object.freeze({ content: revisionId('provider-token:1-2-3-4') }),
  compositionFingerprint: 'fingerprint',
})

const TARGET: SubjectEditTarget = Object.freeze({
  targetId: 'content',
  subjectUri: 'file:///sample.json',
  ownerSource: Object.freeze({ id: 'source-1', uri: 'file:///sample.json' }),
  semanticPath: Object.freeze([]),
  expectedRevision: REVISION,
})

const PLAN = Object.freeze({
  planId: 'raw-writer:content',
  targets: [TARGET],
  edits: [],
  semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: 'atomic' }),
  fidelity: Object.freeze({ roundTrip: 'byte-identical', preservesUnknownData: true }),
  diagnostics: Object.freeze([]),
}) as unknown as AssetEditPlan

interface FakeArm extends SubjectEditingArm {
  readonly proposed: ChangeSet[]
  readonly planned: ChangeSet[]
  readonly committed: string[]
  disposed: boolean
}

function fakeArm(
  overrides: {
    propose?: ValidationResult
    prepare?: SubjectEditingPrepareResult
    commit?: SubjectEditingCommitResult
  } = {},
): FakeArm {
  const proposed: ChangeSet[] = []
  const planned: ChangeSet[] = []
  const committed: string[] = []
  const arm: FakeArm = {
    proposed,
    planned,
    committed,
    disposed: false,
    async state(): Promise<SubjectEditingState> {
      return { revision: REVISION, targets: [TARGET], writableTargetIds: [TARGET.targetId] }
    },
    async propose(change) {
      proposed.push(change)
      return overrides.propose ?? { valid: true, diagnostics: [] }
    },
    async plan(change) {
      planned.push(change)
      return PLAN
    },
    async prepare() {
      return overrides.prepare ?? { state: 'ready', preparedId: 'prepared-1' }
    },
    async commit(preparedId) {
      committed.push(preparedId)
      return (
        overrides.commit ?? {
          state: 'committed',
          receipt: { transactionId: 'tx-1' } as unknown as never,
        }
      )
    },
    async dispose() {
      arm.disposed = true
    },
  }
  return arm
}

interface Recorded {
  readonly status: EditorStatus[]
  readonly dirty: boolean[]
}

async function portsWith(
  arm: SubjectEditingArm,
  localizer?: UiLocalizer,
): Promise<{
  ports: Awaited<ReturnType<typeof createRendererEditorPorts>>
  recorded: Recorded
}> {
  const recorded: Recorded = { status: [], dirty: [] }
  const ports = await createRendererEditorPorts({
    arm,
    ...(localizer === undefined ? {} : { localizer }),
    onStatus: status => recorded.status.push(status),
    onDirty: dirty => recorded.dirty.push(dirty),
  })
  return { ports, recorded }
}

/** What a ui editor calls on the `edit`/`commit` ports, seen from outside `unknown`. */
interface Ports {
  readonly edit: {
    readonly targets: readonly SubjectEditTarget[]
    propose(change: unknown): Promise<ValidationResult>
    plan(change: unknown): Promise<AssetEditPlan>
    dispose(): Promise<void>
  }
  readonly commit: {
    prepare(plan: AssetEditPlan): Promise<{ state: string; prepared?: object }>
    commit(prepared: object): Promise<{ state: string }>
  }
  readonly authorization: { request(): Promise<{ grant: unknown }> }
}

const asPorts = (value: { edit: unknown; commit: unknown; authorization: unknown }): Ports =>
  value as unknown as Ports

describe('normalizeChangeSet', () => {
  it('leaves a change an editor already authored in the 13D shape alone', () => {
    const authored: ChangeSet = {
      targets: [TARGET],
      edits: [
        {
          operation: 'replace',
          targetId: 'content',
          source: TARGET.ownerSource,
          payload: { kind: 'text', text: 'next' },
        },
      ],
      provenance: { actor: 'user' },
    }
    expect(normalizeChangeSet(authored, [TARGET])).toEqual(authored)
  })

  it('preserves semantic writer intent while it normalizes the editor payload', () => {
    const authored: ChangeSet = {
      targets: [TARGET],
      edits: [
        {
          operation: 'replace',
          targetId: TARGET.targetId,
          source: TARGET.ownerSource,
          payload: { kind: 'inline', bytes: new Uint8Array(2 * 1 * 4) },
        },
      ],
      semanticIntent: { width: 2, height: 1 },
      provenance: { actor: 'user' },
    }

    expect(normalizeChangeSet(authored, [TARGET]).semanticIntent).toEqual({ width: 2, height: 1 })
  })

  it('places a legacy byte-range edit (the hex editor) on the host-known target', () => {
    // What `hexEditor` authors today: no targets, no operation, `bindingId` instead of `targetId`.
    const legacy = {
      baseRevisions: { content: 'content-hash.sha256:whatever' },
      edits: [
        {
          kind: 'bytes',
          bindingId: 'content',
          range: { kind: 'bytes', offset: 0n, length: 1n },
          payload: { kind: 'inline', bytes: new Uint8Array([0x5a]) },
        },
      ],
      provenance: { origin: 'hex-editor' },
    }
    const normalized = normalizeChangeSet(legacy, [TARGET])
    expect(normalized.targets).toEqual([TARGET])
    expect(normalized.provenance).toEqual({ actor: 'user' })
    expect(normalized.edits).toEqual([
      {
        operation: 'replace',
        targetId: 'content',
        source: TARGET.ownerSource,
        range: { kind: 'bytes', offset: 0n, length: 1n },
        payload: { kind: 'inline', bytes: new Uint8Array([0x5a]) },
      },
    ])
  })

  it('places a legacy utf16 text edit (the Monaco stage) the same way', () => {
    const legacy = {
      edits: [
        {
          kind: 'text',
          bindingId: 'content',
          range: { kind: 'utf16', offset: 0, length: 4 },
          payload: { kind: 'text', text: 'next' },
        },
      ],
      provenance: { origin: 'ui-monaco' },
    }
    const [edit] = normalizeChangeSet(legacy, [TARGET]).edits
    expect(edit).toMatchObject({ operation: 'replace', targetId: 'content' })
  })

  it('refuses rather than invents: no target to place a legacy edit on, and no edits at all', () => {
    const legacy = { edits: [{ payload: { kind: 'text', text: 'x' } }] }
    expect(() => normalizeChangeSet(legacy, [])).toThrow(/no edit target/u)
    expect(() => normalizeChangeSet({ provenance: {} }, [TARGET])).toThrow(/edits/u)
    expect(() => normalizeChangeSet(undefined, [TARGET])).toThrow(/edits/u)
  })
})

describe('refusal vocabulary', () => {
  it('names every coordinator reason in words, and keeps the code for a log', () => {
    for (const reason of [
      'plan-invalid',
      'permission-missing',
      'write-scope-mismatch',
      'guarantee-unachievable',
      'fidelity-unproven',
      'confirmation-required',
      'payload-unavailable',
      'stale-revision',
      'cancelled',
    ]) {
      const message = refusalMessage(reason)
      expect(message).toContain(reason)
      expect(message.length).toBeGreaterThan(`save refused: ${reason}`.length)
    }
  })

  it('passes an unknown reason through instead of flattening it to "failed"', () => {
    expect(refusalMessage('teapot')).toBe('save refused: teapot')
  })

  it('reports a prepare conflict as a conflict and a ready prepare as nothing to say', () => {
    expect(prepareStatus({ state: 'ready', preparedId: 'p' })).toBeUndefined()
    const conflict = prepareStatus({
      state: 'conflict',
      conflicts: [{ targetId: 'content' } as unknown as never],
    })
    expect(conflict?.failed).toBe(true)
    expect(conflict?.message).toMatch(/changed on disk/u)
    expect(
      prepareStatus({ state: 'rejected', reason: 'fidelity-unproven', diagnostics: [] }),
    ).toMatchObject({ failed: true })
  })

  it('separates a committed save from every way of not being saved', () => {
    expect(commitStatus({ state: 'committed' })).toEqual({ message: 'saved', failed: false })
    expect(commitStatus({ state: 'not-applied', reason: 'stale-revision' })).toMatchObject({
      failed: true,
    })
    expect(commitStatus({ state: 'not-applied', reason: 'stale-revision' }).message).toContain(
      'stale-revision',
    )
    expect(commitStatus({ state: 'rolled-back' }).failed).toBe(true)
    expect(commitStatus({ state: 'partially-applied' }).failed).toBe(true)
  })

  it('localises save outcomes and refusal explanations while keeping reason codes', () => {
    const ru = createUiLocalizer('ru')
    expect(commitStatus({ state: 'committed' }, ru)).toEqual({
      message: 'Сохранено',
      failed: false,
    })
    expect(refusalMessage('fidelity-unproven', ru)).toBe(
      'Сохранение отклонено: нет подтверждения заявленной точности записи для этого изменения (fidelity-unproven)',
    )
    expect(prepareStatus({ state: 'conflict', conflicts: [] }, ru)?.message).toContain(
      'файл изменился на диске',
    )
  })
})

describe('the renderer editor ports over an editing arm', () => {
  it('uses the instance localizer for save and commit-port status', async () => {
    const { ports, recorded } = await portsWith(fakeArm(), createUiLocalizer('ru'))
    await ports.save()
    expect(recorded.status.at(-1)?.message).toBe('Нет изменений для сохранения')
    expect(await asPorts(ports).commit.commit({})).toEqual({ state: 'not-applied' })
    expect(recorded.status.at(-1)?.message).toBe('Нет подготовленных изменений для сохранения')
  })

  it('hands the editor an opaque handle and spends the id on commit — no prepared commit crosses', async () => {
    const arm = fakeArm()
    const { ports, recorded } = await portsWith(arm)
    const prepared = await asPorts(ports).commit.prepare(PLAN)
    expect(prepared.state).toBe('ready')
    const handle = prepared.prepared
    if (handle === undefined) throw new Error('prepare returned no handle')
    // The handle carries an id and nothing else: no plan, no write set, no grant.
    expect(Object.keys(handle)).toEqual(['preparedId'])
    expect(await asPorts(ports).commit.commit(handle)).toMatchObject({ state: 'committed' })
    expect(arm.committed).toEqual(['prepared-1'])
    expect(recorded.status.at(-1)).toEqual({ message: 'saved', failed: false })
  })

  it('refuses to commit an object it never prepared', async () => {
    const arm = fakeArm()
    const { ports, recorded } = await portsWith(arm)
    expect(await asPorts(ports).commit.commit({})).toEqual({ state: 'not-applied' })
    expect(arm.committed).toEqual([])
    expect(recorded.status.at(-1)?.message).toBe('nothing prepared to save')
  })

  it('names the edit session exactly as the previewer and EditorModule.mount do', async () => {
    // the rename has landed, so there is one name; a second alias would let a host bind the wrong
    // one and still compile, which is how the two names diverged in the first place
    const ports = await createRendererEditorPorts({ arm: fakeArm() })
    expect(ports.edit).toBeDefined()
    expect((ports as unknown as Record<string, unknown>)['session']).toBeUndefined()
  })

  it('never hands out the real grant', async () => {
    const { ports } = await portsWith(fakeArm())
    const { grant } = await asPorts(ports).authorization.request()
    expect(grant).toMatchObject({ snapshotId: 'renderer', permissions: [], sourceIds: [] })
  })

  it('marks the tab dirty when the editor proposes and clean when the commit lands', async () => {
    const arm = fakeArm()
    const { ports, recorded } = await portsWith(arm)
    await asPorts(ports).edit.propose({
      edits: [{ payload: { kind: 'text', text: 'next' } }],
    })
    expect(recorded.dirty).toEqual([true])
    // the arm was given a real ChangeSet, not the editor's legacy shape
    expect(arm.proposed[0]?.targets).toEqual([TARGET])
    const prepared = await asPorts(ports).commit.prepare(PLAN)
    if (prepared.prepared === undefined) throw new Error('prepare returned no handle')
    await asPorts(ports).commit.commit(prepared.prepared)
    expect(recorded.dirty).toEqual([true, false])
  })

  it('keeps the arm alive when a stage unmounts: only dispose() releases it', async () => {
    const arm = fakeArm()
    const { ports } = await portsWith(arm)
    // switching stages unmounts the editor, which disposes its `edit` port
    await asPorts(ports).edit.dispose()
    expect(arm.disposed).toBe(false)
    await ports.dispose()
    expect(arm.disposed).toBe(true)
  })

  it('save() replays the last proposal, and says so when there is nothing to replay', async () => {
    const arm = fakeArm()
    const { ports, recorded } = await portsWith(arm)
    await ports.save()
    expect(recorded.status.at(-1)).toEqual({ message: 'nothing to save', failed: false })
    expect(arm.committed).toEqual([])

    await asPorts(ports).edit.propose({ edits: [{ payload: { kind: 'text', text: 'next' } }] })
    await ports.save()
    expect(arm.committed).toEqual(['prepared-1'])
    expect(recorded.dirty.at(-1)).toBe(false)

    // the proposal is spent: saving again has nothing to commit rather than writing twice
    await ports.save()
    expect(arm.committed).toEqual(['prepared-1'])
  })

  it('surfaces the reason a prepare refused instead of a generic failure', async () => {
    const arm = fakeArm({
      prepare: { state: 'rejected', reason: 'fidelity-unproven', diagnostics: [] },
    })
    const { ports, recorded } = await portsWith(arm)
    await asPorts(ports).edit.propose({ edits: [{ payload: { kind: 'text', text: 'n' } }] })
    await ports.save()
    expect(arm.committed).toEqual([])
    expect(recorded.status.at(-1)?.message).toContain('fidelity-unproven')
    expect(recorded.status.at(-1)?.failed).toBe(true)
    // refused, so the work is still uncommitted and the tab must still say so
    expect(recorded.dirty.at(-1)).toBe(true)
  })

  it('surfaces a conflict from prepare as the source having changed', async () => {
    const arm = fakeArm({ prepare: { state: 'conflict', conflicts: [] } })
    const { ports, recorded } = await portsWith(arm)
    await asPorts(ports).edit.propose({ edits: [{ payload: { kind: 'text', text: 'n' } }] })
    await ports.save()
    expect(recorded.status.at(-1)?.message).toMatch(/changed on disk/u)
  })

  it('stops at a writer refusal rather than planning and preparing anyway', async () => {
    const arm = fakeArm({
      propose: { valid: false, diagnostics: [{ severity: 'error', code: 'x', message: 'nope' }] },
    })
    const { ports, recorded } = await portsWith(arm)
    await asPorts(ports).edit.propose({ edits: [{ payload: { kind: 'text', text: 'n' } }] })
    await ports.save()
    expect(arm.planned).toEqual([])
    expect(arm.committed).toEqual([])
    expect(recorded.status.at(-1)?.message).toContain('nope')
  })
})

/*
 * ADR-HOST-002 Path A: the codec authored the edits, so there is no change set and no writer —
 * only the two arm calls a save ends in. The point of these is that the Edit panel gains no write
 * path of its own: it hands a plan to the same arm, and every refusal reaches it in words.
 */
describe('applyPlan — a codec operation`s plan, committed through the same arm', () => {
  it('prepares and commits the plan it was given, and never proposes or plans a change set', async () => {
    const arm = fakeArm()
    const { ports, recorded } = await portsWith(arm)
    expect(await ports.applyPlan(PLAN)).toEqual({ message: 'saved', failed: false })
    expect(arm.committed).toEqual(['prepared-1'])
    // the writer is never consulted: the plan came from the codec, already complete
    expect(arm.proposed).toEqual([])
    expect(arm.planned).toEqual([])
    expect(recorded.status.at(-1)).toEqual({ message: 'saved', failed: false })
  })

  it('returns the same refusal it reports, so the panel and the status line say one thing', async () => {
    const arm = fakeArm({
      prepare: { state: 'rejected', reason: 'fidelity-unproven', diagnostics: [] },
    })
    const { ports, recorded } = await portsWith(arm)
    const result = await ports.applyPlan(PLAN)
    expect(result.failed).toBe(true)
    expect(result.message).toContain('fidelity-unproven')
    expect(result).toEqual(recorded.status.at(-1))
    expect(arm.committed).toEqual([])
  })

  it('reports a conflict as the file having changed on disk, not as a failure', async () => {
    const arm = fakeArm({ prepare: { state: 'conflict', conflicts: [] } })
    const { ports } = await portsWith(arm)
    const result = await ports.applyPlan(PLAN)
    expect(result.message).toMatch(/changed on disk/u)
    expect(result.failed).toBe(true)
    expect(arm.committed).toEqual([])
  })

  it('reports a commit the host would not apply with the reason the host gave', async () => {
    const arm = fakeArm({
      commit: { state: 'not-applied', reason: 'stale-revision', diagnostics: [] },
    })
    const { ports } = await portsWith(arm)
    const result = await ports.applyPlan(PLAN)
    expect(result.failed).toBe(true)
    expect(result.message).toContain('stale-revision')
    // the id was still spent, which is the arm's rule and not something this host may work around
    expect(arm.committed).toEqual(['prepared-1'])
  })
})

describe('the read-only stage rule', () => {
  const stage = (id: string, module: unknown, editable?: boolean): StageBinding => ({
    id,
    label: id,
    contract: 'common.view/text-data-source',
    module,
    ...(editable === undefined ? {} : { editable }),
  })
  const editor = { mount: () => undefined }
  const viewer = { mount: () => undefined }

  it('keeps a slot whose read-only entry is a different module', () => {
    const kept = readOnlyStages([stage('text', editor, true)], [stage('text', viewer)])
    expect(kept.map(item => item.id)).toEqual(['text'])
  })

  it('drops a slot whose read-only entry is the editor itself — it would have no ports', () => {
    expect(readOnlyStages([stage('code', editor, true)], [stage('code', editor)])).toEqual([])
  })

  it('keeps a plain viewer even when both lists name the same module', () => {
    expect(readOnlyStages([stage('tree', viewer)], [stage('tree', viewer)])).toHaveLength(1)
  })
})
