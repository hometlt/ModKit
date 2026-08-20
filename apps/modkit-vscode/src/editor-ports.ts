/**
 * The webview's editor ports over the subject RPC (S14).
 *
 * A `ViewerModule`-hosted editor from `@modkitx-x3/ui` expects four ports — `edit`, `commit`,
 * `payloads`, `authorization` — and calls them as if it held the host's editing objects. This page
 * holds none of them: the grant snapshot, the commit coordinator, the file backend and every
 * prepared commit live in the extension host. This module is the adapter, and it is deliberately
 * thin: each port method is one RPC call, ids stand in for authority, and nothing here decides
 * anything.
 *
 * What the page therefore cannot do, by construction: commit a plan the extension host did not
 * prepare, replay a prepared commit (the id is spent on first use), or forge a grant — the
 * `authorization` port hands back a marker the serving side ignores, because the real grant never
 * crosses. It is the same adapter Electron's renderer uses, for the same reason.
 */

import type { SubjectEditingArm, SubjectEditingPrepareResult } from '@modkitx-x3/host'
import type {
  AssetEditPlan,
  ChangeSet,
  CommitReceipt,
  PrepareCommitResult,
  SubjectEditTarget,
  ValidationResult,
} from '@modkitx-x3/sdk'

/** The four ports `createCodecPreview` hands an editable stage, plus what the shell needs. */
export interface WebviewEditorPorts {
  /** The `EditSession`, under the name `createCodecPreview` and `EditorModule.mount` both use. */
  readonly edit: unknown
  readonly commit: unknown
  readonly payloads: unknown
  readonly authorization: unknown
  /** Commit whatever is pending. Used by "save before closing"; a no-op when nothing is. */
  save(): Promise<void>
  /** Prepare and commit a plan produced by a codec operation (ADR-HOST-002 Path A). */
  applyPlan(plan: AssetEditPlan): Promise<WebviewEditorStatus>
  /** Release the arm (and with it the extension host's prepared commits for this subject). */
  dispose(): Promise<void>
}

export interface WebviewEditorStatus {
  readonly message: string
  readonly failed: boolean
}

/** A marker the page passes around; the real grant snapshot never leaves the serving side. */
const WEBVIEW_GRANT = Object.freeze({ snapshotId: 'webview', permissions: [], sourceIds: [] })

export interface WebviewEditorPortsOptions {
  readonly arm: SubjectEditingArm
  /** Reports save progress and refusals to the shell (status line, tab dirty marker). */
  readonly onStatus?: (message: string) => void
  /** Marks the tab as having unsaved work the moment a change is proposed. */
  readonly onDirty?: (dirty: boolean) => void
}

const REFUSAL_REASONS: Readonly<Record<string, string>> = Object.freeze({
  'plan-invalid': 'the change did not describe a valid edit of this file',
  'permission-missing': 'this session may not write the file',
  'write-scope-mismatch': 'the edit named a file outside what this session may write',
  'guarantee-unachievable': 'the host cannot promise this write safely enough',
  'fidelity-unproven': 'no evidence backs the writer fidelity claim for this change',
  'confirmation-required': 'a lossy write needs a confirmation this host does not ask for',
  'payload-unavailable': 'the edited bytes never reached the writer',
  'stale-revision': 'the file changed on disk after the change was prepared',
  cancelled: 'the save was cancelled',
})

/** Keep the coordinator's raw reason code in every human-readable refusal. */
export function refusalMessage(reason: string): string {
  const plain = REFUSAL_REASONS[reason]
  return plain === undefined ? `save refused: ${reason}` : `save refused: ${plain} (${reason})`
}

const diagnosticDetail = (
  diagnostics: readonly { readonly message: string }[] | undefined,
): string => {
  const first = diagnostics?.[0]?.message
  return first === undefined ? '' : ` — ${first}`
}

export function prepareStatus(
  result: SubjectEditingPrepareResult,
): WebviewEditorStatus | undefined {
  if (result.state === 'ready') return undefined
  if (result.state === 'conflict') {
    return {
      message: `save refused: the file changed on disk while it was open (${result.conflicts.length} conflict(s))`,
      failed: true,
    }
  }
  return {
    message: `${refusalMessage(result.reason)}${diagnosticDetail(result.diagnostics)}`,
    failed: true,
  }
}

export function commitStatus(result: {
  readonly state: string
  readonly reason?: string
  readonly diagnostics?: readonly { readonly message: string }[]
}): WebviewEditorStatus {
  switch (result.state) {
    case 'committed':
      return { message: 'saved', failed: false }
    case 'not-applied':
      return {
        message: `${refusalMessage(result.reason ?? 'unknown')}${diagnosticDetail(result.diagnostics)}`,
        failed: true,
      }
    case 'rolled-back':
      return {
        message: 'save failed: the write was rolled back and the file is unchanged',
        failed: true,
      }
    case 'partially-applied':
      return { message: 'save partially applied: recovery is available', failed: true }
    default:
      return { message: `save ${result.state}`, failed: true }
  }
}

export async function createWebviewEditorPorts(
  options: WebviewEditorPortsOptions,
): Promise<WebviewEditorPorts> {
  const { arm } = options
  const state = await arm.state()
  const targets: readonly SubjectEditTarget[] = state.targets
  /** `prepare` answers with an id; the ui carries the object it was given straight back to us. */
  const preparedIds = new WeakMap<object, string>()
  /** The last plan the editor asked for, so "save before closing" has something to commit. */
  let pending: AssetEditPlan | undefined

  const report = (status: WebviewEditorStatus): void => {
    options.onStatus?.(status.message)
  }

  const preparePlan = async (plan: AssetEditPlan): Promise<SubjectEditingPrepareResult> => {
    const result = await arm.prepare(plan)
    const refusal = prepareStatus(result)
    if (refusal !== undefined) report(refusal)
    return result
  }

  const commitPrepared = async (
    preparedId: string,
  ): Promise<{
    readonly state: string
    readonly receipt?: CommitReceipt
    readonly status: WebviewEditorStatus
  }> => {
    const result = await arm.commit(preparedId)
    const status = commitStatus(result)
    report(status)
    if (result.state === 'committed') {
      pending = undefined
      options.onDirty?.(false)
    }
    return result.state === 'not-applied'
      ? { state: result.state, status }
      : { state: result.state, receipt: result.receipt, status }
  }

  const session = {
    revision: state.revision,
    targets,
    state: () => (pending === undefined ? 'live' : 'dirty'),
    propose: async (change: ChangeSet): Promise<ValidationResult> => {
      options.onDirty?.(true)
      return arm.propose(change)
    },
    plan: async (change: ChangeSet): Promise<AssetEditPlan> => {
      const plan = await arm.plan(change)
      pending = plan
      options.onDirty?.(true)
      return plan
    },
    dispose: async (): Promise<void> => undefined,
  }

  const commit = {
    async prepare(plan: AssetEditPlan): Promise<PrepareCommitResult> {
      const result = await preparePlan(plan)
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
        options.onStatus?.('nothing prepared to save')
        return { state: 'not-applied' }
      }
      const result = await commitPrepared(preparedId)
      return result.receipt === undefined
        ? { state: result.state }
        : { state: result.state, receipt: result.receipt }
    },
    async undo(): Promise<{ state: string }> {
      options.onStatus?.('undo is not available in this host yet')
      return { state: 'not-applied' }
    },
    async redo(): Promise<{ state: string }> {
      options.onStatus?.('redo is not available in this host yet')
      return { state: 'not-applied' }
    },
  }

  const payloads = {
    async open(): Promise<never> {
      // staged payloads would need a byte channel of their own; inline payloads cover today's
      // editors, and pretending otherwise would fail at commit instead of here
      throw new Error('this host does not stage payloads: edits travel inline')
    },
  }

  const authorization = {
    async request(): Promise<{ grant: typeof WEBVIEW_GRANT }> {
      return { grant: WEBVIEW_GRANT }
    },
  }

  return {
    edit: session,
    commit,
    payloads,
    authorization,
    async save() {
      if (pending === undefined) return
      const prepared = await commit.prepare(pending)
      const ready = prepared as unknown as { state: string; prepared?: object }
      if (ready.state !== 'ready' || ready.prepared === undefined) return
      await commit.commit(ready.prepared)
    },
    async applyPlan(plan) {
      try {
        const prepared = await preparePlan(plan)
        if (prepared.state !== 'ready') {
          return prepareStatus(prepared) ?? { message: 'save refused', failed: true }
        }
        return (await commitPrepared(prepared.preparedId)).status
      } catch (error) {
        const status = {
          message: `the host refused the plan: ${error instanceof Error ? error.message : String(error)}`,
          failed: true,
        }
        report(status)
        return status
      }
    },
    dispose: () => arm.dispose(),
  }
}
