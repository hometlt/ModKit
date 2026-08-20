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

import type { SubjectEditingArm } from '@modkitx-x3/host'
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
  /** Release the arm (and with it the extension host's prepared commits for this subject). */
  dispose(): Promise<void>
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
      const result = await arm.prepare(plan)
      if (result.state !== 'ready') {
        options.onStatus?.(
          result.state === 'conflict'
            ? 'the file changed on disk while it was open, so the save was refused'
            : `save rejected: ${result.reason}`,
        )
        return result as unknown as PrepareCommitResult
      }
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
      const result = await arm.commit(preparedId)
      if (result.state === 'committed') {
        pending = undefined
        options.onDirty?.(false)
        options.onStatus?.('saved')
      } else {
        options.onStatus?.(`save ${result.state.replace('-', ' ')}`)
      }
      return result.state === 'not-applied'
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
    dispose: () => arm.dispose(),
  }
}
