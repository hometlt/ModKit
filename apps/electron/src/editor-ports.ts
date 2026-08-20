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

/** The four ports `createCodecPreview` hands an editable stage. */
export interface RendererEditorPorts {
  /** The `EditSession`, under the name `createCodecPreview` and `EditorModule.mount` both use. */
  readonly edit: unknown
  readonly commit: unknown
  readonly payloads: unknown
  readonly authorization: unknown
  /** Release the arm (and with it main's prepared commits for this subject). */
  dispose(): Promise<void>
}

/** A marker the renderer passes around; the real grant snapshot never leaves the serving side. */
const RENDERER_GRANT = Object.freeze({ snapshotId: 'renderer', permissions: [], sourceIds: [] })

export interface RendererEditorPortsOptions {
  readonly arm: SubjectEditingArm
  /** Reports save progress and refusals to the shell (status line, tab dirty marker). */
  readonly onStatus?: (message: string) => void
}

export async function createRendererEditorPorts(
  options: RendererEditorPortsOptions,
): Promise<RendererEditorPorts> {
  const { arm } = options
  const state = await arm.state()
  const targets: readonly SubjectEditTarget[] = state.targets
  /** `prepare` answers with an id; the ui carries the object it was given straight back to us. */
  const preparedIds = new WeakMap<object, string>()

  const session = {
    revision: state.revision,
    targets,
    state: () => 'live',
    propose: async (change: ChangeSet): Promise<ValidationResult> => arm.propose(change),
    plan: async (change: ChangeSet): Promise<AssetEditPlan> => arm.plan(change),
    dispose: async (): Promise<void> => undefined,
  }

  const commit = {
    async prepare(plan: AssetEditPlan): Promise<PrepareCommitResult> {
      const result = await arm.prepare(plan)
      if (result.state !== 'ready') {
        options.onStatus?.(
          result.state === 'conflict'
            ? 'the source changed while it was open'
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
      options.onStatus?.(
        result.state === 'committed' ? 'saved' : `save ${result.state.replace('-', ' ')}`,
      )
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
    async request(): Promise<{ grant: typeof RENDERER_GRANT }> {
      return { grant: RENDERER_GRANT }
    },
  }

  return {
    edit: session,
    commit,
    payloads,
    authorization,
    dispose: () => arm.dispose(),
  }
}
