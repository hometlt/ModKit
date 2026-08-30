/**
 * The renderer's editor ports over the subject RPC (S14).
 *
 * A `ViewerModule`-hosted editor from `@modkitx-x3/ui` expects four ports — `edit`, `commit`,
 * `payloads`, `authorization` — and calls them as if it held the host's editing objects. In
 * Electron it holds none of them: the grant snapshot, the commit coordinator, the file backend and
 * every prepared commit live in main. This module is the adapter, and it is deliberately thin:
 * each port method is one RPC call, ids stand in for authority, and nothing here decides anything.
 *
 * What the renderer therefore cannot do, by construction: commit a plan main did not prepare,
 * replay a prepared commit (the id is spent on first use), or forge a grant — the `authorization`
 * port hands back a marker the serving side ignores, because the real grant never crosses.
 *
 * Two host-side jobs live here besides the relaying, because nothing else in the renderer can do
 * them: reporting *why* a save was refused (the coordinator answers with a reason code, and a
 * status line that only said "failed" would be useless), and remembering the last change an editor
 * proposed so "save before closing" can commit it — an `EditorMount` has no host-callable save.
 */

import type { SubjectEditingArm, SubjectEditingPrepareResult } from '@modkitx-x3/host'
import type {
  AssetEditPlan,
  ChangeSet,
  CommitReceipt,
  EditPayload,
  EditRange,
  PrepareCommitResult,
  SourceEdit,
  SubjectEditTarget,
  ValidationResult,
} from '@modkitx-x3/sdk'
import { DEFAULT_UI_LOCALIZER, type UiLocalizer } from '@modkitx-x3/ui/localization'

/** The four ports `createCodecPreview` hands an editable stage, plus this host's lease hygiene. */
export interface RendererEditorPorts {
  /** The 13D edit session, under the one name `createCodecPreview` and `EditorModule.mount`
   * both use. */
  readonly edit: unknown
  readonly commit: unknown
  readonly payloads: unknown
  readonly authorization: unknown
  /**
   * Commit whatever the editor last proposed, if anything. The close prompt's "Save" is the only
   * caller: the buffer lives in the editor, so the last proposal is the only thing the host holds.
   */
  save(): Promise<void>
  /**
   * ADR-HOST-002 Path A: commit a plan a *codec operation* produced.
   *
   * There is no change set and no writer here — the codec already turned the user's input into
   * `SourceEdit`s and the host only has to prepare and commit them. It is the same two arm calls
   * `save()` ends in, and deliberately the same code path: the Edit panel gains no write authority
   * of its own, it hands a plan to the arm exactly as the editors hand one.
   */
  applyPlan(plan: AssetEditPlan): Promise<EditorStatus>
  /** Release the arm (and with it main's prepared commits for this subject). */
  dispose(): Promise<void>
}

/** What the shell shows about a save, and whether it should read as a failure. */
export interface EditorStatus {
  readonly message: string
  readonly failed: boolean
}

/** A marker the renderer passes around; the real grant snapshot never leaves the serving side. */
const RENDERER_GRANT = Object.freeze({ snapshotId: 'renderer', permissions: [], sourceIds: [] })

export interface RendererEditorPortsOptions {
  readonly arm: SubjectEditingArm
  /** Per-host language; omitted for the English-compatible adapter default. */
  readonly localizer?: UiLocalizer
  /** Reports save progress and refusals to the shell's status line. */
  readonly onStatus?: (status: EditorStatus) => void
  /** Reports uncommitted work so the shell can mark the tab and guard closing. */
  readonly onDirty?: (dirty: boolean) => void
}

// ---------------------------------------------------------------------------------------------
// refusal vocabulary

/**
 * The coordinator's refusal reasons in plain words (13D `PrepareCommitResult`/`CommitResult`).
 *
 * A save that fails has exactly one honest answer, and it is not "failed": every reason below is a
 * different thing for the user to do about it. Unknown codes are reported verbatim rather than
 * flattened, so a new reason from the coordinator still reaches the status line.
 */
const REFUSAL_REASON_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'plan-invalid': 'planInvalid',
  'permission-missing': 'permissionMissing',
  'write-scope-mismatch': 'writeScopeMismatch',
  'guarantee-unachievable': 'guaranteeUnachievable',
  'fidelity-unproven': 'fidelityUnproven',
  'confirmation-required': 'confirmationRequired',
  'payload-unavailable': 'payloadUnavailable',
  'stale-revision': 'staleRevision',
  cancelled: 'cancelled',
})

/** `save refused: <plain words> (<code>)`, so a user and a log both get what they need. */
export function refusalMessage(
  reason: string,
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): string {
  const reasonKey = REFUSAL_REASON_KEYS[reason]
  if (reasonKey === undefined) return localizer.text('editor.saveRefused', { reason })
  return localizer.text('editor.saveRefusedCode', {
    reason: localizer.text(`editor.refusal.${reasonKey}`),
    code: reason,
  })
}

/** What the shell says about a `prepare` that did not reach `ready`. */
export function prepareStatus(
  result: SubjectEditingPrepareResult,
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): EditorStatus | undefined {
  if (result.state === 'ready') return undefined
  if (result.state === 'conflict') {
    return {
      message: localizer.text('editor.saveConflict', { count: result.conflicts.length }),
      failed: true,
    }
  }
  return { message: refusalMessage(result.reason, localizer), failed: true }
}

/** What the shell says about a `commit`. `committed` is the only state that is not a problem. */
export function commitStatus(
  result: {
    readonly state: string
    readonly reason?: string
  },
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): EditorStatus {
  switch (result.state) {
    case 'committed':
      return { message: localizer.text('editor.saved'), failed: false }
    case 'not-applied':
      return { message: refusalMessage(result.reason ?? 'unknown', localizer), failed: true }
    case 'rolled-back':
      return {
        message: localizer.text('editor.rolledBack'),
        failed: true,
      }
    case 'partially-applied':
      return { message: localizer.text('editor.partiallySaved'), failed: true }
    default:
      return { message: localizer.text('editor.saveState', { state: result.state }), failed: true }
  }
}

// ---------------------------------------------------------------------------------------------
// change-set normalisation

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Bring a ui editor's change set to the 13D `ChangeSet` the arm accepts.
 *
 * `textEditor` already authors the 13D shape (`targets` + `replace` edits carrying `targetId` and
 * `source`). The hex editor and the Monaco stage still author the pre-13D one — a `baseRevisions`
 * map, edits keyed by `bindingId`, `provenance.origin` — which the raw writer cannot even read
 * (`change.targets.map` throws before validation starts). Only the host knows the subject's edit
 * targets, so filling them in is this adapter's job rather than a cast that would fail at the
 * writer. A change that is already well formed passes through untouched.
 *
 * This is a compatibility shim over a defect in the editor modules, not a feature — see the note
 * to Root. It is deliberately narrow: it never invents an operation other than `replace`, and it
 * refuses a change it cannot place on a target.
 */
export function normalizeChangeSet(
  change: unknown,
  targets: readonly SubjectEditTarget[],
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): ChangeSet {
  if (!isRecord(change) || !Array.isArray(change['edits'])) {
    throw new TypeError(localizer.text('editor.changeSetEditsRequired'))
  }
  const authored = change['edits']
  const declared = Array.isArray(change['targets'])
    ? (change['targets'] as readonly SubjectEditTarget[])
    : targets
  const provenance = isRecord(change['provenance']) ? change['provenance'] : {}
  const actor = provenance['actor']
  const target = declared[0]

  const edits = authored.map((item): SourceEdit => {
    if (!isRecord(item)) throw new TypeError(localizer.text('editor.editObjectRequired'))
    if (typeof item['operation'] === 'string') return item as unknown as SourceEdit
    if (target === undefined) {
      throw new TypeError(localizer.text('editor.noEditTarget'))
    }
    const payload = item['payload']
    if (!isRecord(payload) || typeof payload['kind'] !== 'string') {
      throw new TypeError(localizer.text('editor.legacyPayloadRequired'))
    }
    const range = item['range']
    return {
      operation: 'replace',
      targetId: target.targetId,
      source: target.ownerSource,
      ...(isRecord(range) ? { range: range as unknown as EditRange } : {}),
      payload: payload as unknown as EditPayload,
    }
  })

  return {
    targets: declared,
    edits,
    ...(isRecord(change['semanticIntent'])
      ? { semanticIntent: change['semanticIntent'] as NonNullable<ChangeSet['semanticIntent']> }
      : {}),
    provenance: { actor: actor === 'automation' || actor === 'agent' ? actor : 'user' },
  }
}

// ---------------------------------------------------------------------------------------------
// the ports

export async function createRendererEditorPorts(
  options: RendererEditorPortsOptions,
): Promise<RendererEditorPorts> {
  const { arm } = options
  const localizer = options.localizer ?? DEFAULT_UI_LOCALIZER
  const state = await arm.state()
  const targets: readonly SubjectEditTarget[] = state.targets
  /** `prepare` answers with an id; the ui carries the object it was given straight back to us. */
  const preparedIds = new WeakMap<object, string>()
  /**
   * The last change an editor proposed and this host has not committed. It is both the dirty
   * signal and the only thing "save before closing" can act on — an `EditorMount` exposes
   * `update` and `unmount`, and nothing a host may call to make it save.
   */
  let pending: ChangeSet | undefined

  const report = (status: EditorStatus): void => {
    options.onStatus?.(status)
  }

  const markPending = (change: ChangeSet): ChangeSet => {
    pending = change
    options.onDirty?.(true)
    return change
  }

  const markSaved = (): void => {
    pending = undefined
    options.onDirty?.(false)
  }

  const session = {
    revision: state.revision,
    targets,
    state: () => 'live',
    propose: async (change: ChangeSet): Promise<ValidationResult> =>
      arm.propose(markPending(normalizeChangeSet(change, targets, localizer))),
    plan: async (change: ChangeSet): Promise<AssetEditPlan> =>
      arm.plan(markPending(normalizeChangeSet(change, targets, localizer))),
    dispose: async (): Promise<void> => {
      // Switching stages unmounts the editor, which disposes its edit port. The arm outlives the
      // stage — the tab still holds it — so this releases nothing; `dispose()` below does.
    },
  }

  const prepare = async (plan: AssetEditPlan): Promise<SubjectEditingPrepareResult> => {
    const result = await arm.prepare(plan)
    const refusal = prepareStatus(result, localizer)
    if (refusal !== undefined) report(refusal)
    return result
  }

  const commitPrepared = async (
    preparedId: string,
  ): Promise<{ state: string; receipt?: CommitReceipt; status: EditorStatus }> => {
    const result = await arm.commit(preparedId)
    const status = commitStatus(result, localizer)
    report(status)
    if (result.state === 'committed') markSaved()
    return result.state === 'not-applied'
      ? { state: result.state, status }
      : { state: result.state, receipt: result.receipt, status }
  }

  const commit = {
    async prepare(plan: AssetEditPlan): Promise<PrepareCommitResult> {
      const result = await prepare(plan)
      if (result.state !== 'ready') return result as unknown as PrepareCommitResult
      // the ui hands this object back to `commit`; the id rides along in a side table so nothing
      // resembling a prepared commit is ever fabricated here
      const handle = Object.freeze({ preparedId: result.preparedId })
      preparedIds.set(handle, result.preparedId)
      return { state: 'ready', prepared: handle } as unknown as PrepareCommitResult
    },
    async commit(prepared: object): Promise<{ state: string; receipt?: CommitReceipt }> {
      const preparedId =
        preparedIds.get(prepared) ?? (prepared as { preparedId?: string }).preparedId
      if (preparedId === undefined) {
        report({ message: localizer.text('editor.nothingPrepared'), failed: true })
        return { state: 'not-applied' }
      }
      // The ui's commit port takes the 13D result shape; the status line was already told.
      const committed = await commitPrepared(preparedId)
      return committed.receipt === undefined
        ? { state: committed.state }
        : { state: committed.state, receipt: committed.receipt }
    },
    async undo(): Promise<{ state: string; reason: string }> {
      const reason = localizer.text('editor.replayUnsupported')
      report({ message: localizer.text('editor.undoRefused', { reason }), failed: true })
      return { state: 'not-applied', reason }
    },
    async redo(): Promise<{ state: string; reason: string }> {
      const reason = localizer.text('editor.replayUnsupported')
      report({ message: localizer.text('editor.redoRefused', { reason }), failed: true })
      return { state: 'not-applied', reason }
    },
  }

  const payloads = {
    async open(): Promise<never> {
      // staged payloads would need a byte channel of their own; inline payloads cover today's
      // editors, and pretending otherwise would fail at commit instead of here
      throw new Error(localizer.text('editor.inlinePayloadOnly'))
    },
  }

  const authorization = {
    async request(): Promise<{ grant: typeof RENDERER_GRANT }> {
      return { grant: RENDERER_GRANT }
    },
  }

  return {
    edit: session,
    commit,
    payloads,
    authorization,
    async save(): Promise<void> {
      const change = pending
      if (change === undefined) {
        report({ message: localizer.text('editor.nothingToSave'), failed: false })
        return
      }
      const validation = await arm.propose(change)
      if (!validation.valid) {
        const first = validation.diagnostics[0]
        report({
          message: localizer.text('editor.saveRefused', {
            reason: first === undefined ? localizer.text('editor.writerRejected') : first.message,
          }),
          failed: true,
        })
        return
      }
      const result = await prepare(await arm.plan(change))
      if (result.state !== 'ready') return
      await commitPrepared(result.preparedId)
    },
    async applyPlan(plan: AssetEditPlan): Promise<EditorStatus> {
      const prepared = await prepare(plan)
      if (prepared.state !== 'ready') {
        // `prepare` already reported it; returning the same words keeps the panel and the status
        // line saying one thing.
        return (
          prepareStatus(prepared, localizer) ?? {
            message: localizer.text('editor.saveRefused', { reason: 'unknown' }),
            failed: true,
          }
        )
      }
      return (await commitPrepared(prepared.preparedId)).status
    },
    dispose: () => arm.dispose(),
  }
}
