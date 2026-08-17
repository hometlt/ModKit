/**
 * Minimal in-memory implementations of the four host-owned editor ports.
 *
 * The editor never owns saving (doc 06 §16): it builds a ChangeSet, the coordinator re-checks
 * revisions and permissions, and the authorization port grants. These stubs keep that separation
 * honest — the editor still has to go through every port, they simply succeed locally and log.
 */
import type {
  AssetEditPlan,
  ChangeSet,
  CommitCoordinator,
  EditAuthorizationPort,
  EditSession,
  PayloadStore,
} from '@modkitx-x3/sdk'

export type EditorPortLog = (line: string) => void

export function createEditorPorts(revision: string, log: EditorPortLog) {
  const session = {
    revision,
    targets: [],
    state() {
      return { kind: 'clean' }
    },
    async propose(change: ChangeSet) {
      log(`propose: ${change.edits?.length ?? 0} edit(s)`)
      return { state: 'valid', diagnostics: [] }
    },
    async plan(change: ChangeSet) {
      log(`plan: ${change.edits?.length ?? 0} edit(s)`)
      return {
        baseRevisions: { content: revision },
        edits: change.edits ?? [],
        provenance: { origin: 'gallery' },
      }
    },
    async dispose() {
      log('edit session disposed')
    },
  } as unknown as EditSession

  const commit = {
    async prepare(plan: AssetEditPlan) {
      log(`prepare: ${plan.edits?.length ?? 0} edit(s)`)
      return { state: 'prepared', prepared: { plan }, diagnostics: [] }
    },
    async commit() {
      log('commit: accepted (gallery has no backing store)')
      return { state: 'committed', revision, diagnostics: [] }
    },
  } as unknown as CommitCoordinator

  const payloads = {
    async open() {
      throw new Error('the gallery stages no payloads')
    },
  } as unknown as PayloadStore

  const authorization = {
    async request() {
      log('authorization: granted')
      return { grant: { id: 'gallery-grant', permissions: ['edit-source'] } }
    },
  } as unknown as EditAuthorizationPort

  return { session, commit, payloads, authorization }
}
