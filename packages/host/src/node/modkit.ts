/**
 * Modkit as a Node library — one call from a foreign project to a working host.
 *
 * Everything below is composed from pieces that already exist (`loadExtensionRoots`,
 * `createNodeSubjectServices`, `createPathSubjectOpener`, `createSubjectEditing`); what this module
 * adds is the defaults, so a project that just wants "open this file, show me what it is, let me
 * edit it" does not first need to learn topologies, realms, grants and backends:
 *
 * ```ts
 * import { createModkit } from '@modkitx-x3/host/node'
 *
 * const modkit = await createModkit({
 *   extensions: ['./node_modules/@my-app/codecs'],
 *   roots: [projectDir],
 *   writableRoots: [join(projectDir, 'assets')],
 * })
 * const opened = await modkit.open(join(projectDir, 'assets', 'logo.png'))
 * if (opened.snapshot.state === 'opened') {
 *   // opened.session — data sources; opened.editing?.editorPorts — save path
 * }
 * await modkit.close()
 * ```
 *
 * The security posture is fixed, not configurable, because a facade is where defaults become
 * policy: every extension executes worker-brokered (`allowTrustedInProcess` is not an option here —
 * a caller who needs in-process execution is making an artifact-level trust decision and should
 * compose `createNodeSubjectServices` directly, where that decision is visible); reads are confined
 * to `roots`; writes are confined to `writableRoots` by the editing backend itself, so a grant can
 * never out-promise the filesystem policy.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { uint64, type Diagnostic } from '@modkitx-x3/core'
import { createHostTopology, type AssetSession, type PermissionGrant } from '@modkitx-x3/sdk'
import type { SubjectOpenSnapshot } from '../subject-rpc.js'
import { createSubjectEditing, type SubjectEditing } from '../subject-editing.js'
import { createEvidenceRegistry, createRawWriter } from '../editing-evidence.js'
import { createFileEditingBackend } from './file-editing-backend.js'
import {
  loadExtensionRoots,
  type ExtensionRootFailure,
  type ExtensionRootRequest,
} from './extension-roots.js'
import { createPathSubjectOpener } from './subject-opener.js'
import { createNodeSubjectServices, type NodeSubjectServices } from './subject-services.js'
import { nodeRuntimeTargetBase, nodeWorkerLinks, nodeWorkerRealmProfile } from './profile.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'

const MODKIT_REALM = 'org.modkitx.host/library-main'
const MODKIT_WORKER_REALM = 'org.modkitx.host/library-worker'

export interface ModkitOptions {
  /**
   * Extension directories this project ships (its own codecs, or a checkout of the first-party
   * set). Loaded as `bundled` — the caller vouches for them — but still executed worker-brokered.
   */
  readonly extensions: readonly (string | ExtensionRootRequest)[]
  /** Extension directories supplied by the *end user* of the caller's product (`installed`). */
  readonly userExtensions?: readonly (string | ExtensionRootRequest)[]
  /** Absolute directories subjects may be opened from. Empty opens nothing, by design. */
  readonly roots: readonly string[]
  /**
   * Directories the host may write. Editing is offered only for subjects inside them; absent
   * means a read-only host, which is a fine thing to be.
   */
  readonly writableRoots?: readonly string[]
  /** Open intent (default `'full'`). `'inspect'` is cheaper when nothing will be displayed. */
  readonly intent?: 'inspect' | 'full'
  /** Worker policy override; the lab default suits interactive work. */
  readonly policy?: WorkerBackendPolicy
  /** Where the worker bootstrap lives — required when the caller bundles to CommonJS. */
  readonly bootstrapUrl?: URL
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export interface ModkitOpened {
  /** `state: 'opened'` — descriptor, selection, candidates, diagnostics. */
  readonly snapshot: SubjectOpenSnapshot
  /** Live session: `dataSource(contract, major)`, `operations()`, `dispose()`. */
  readonly session?: AssetSession
  /**
   * The editing surface, present only when the subject sits inside `writableRoots` and its shape
   * supports editing. `editing.editorPorts` is what a `@modkitx-x3/ui` editor stage mounts with;
   * `editing.coordinator` is the prepare/commit pair for a host that drives saves itself.
   */
  readonly editing?: SubjectEditing
  /** Dispose the session (editing state goes with it). */
  close(): Promise<void>
}

export interface Modkit {
  /** The composed services — the escape hatch to everything the facade did not surface. */
  readonly services: NodeSubjectServices
  /** One record per extension directory that did not load; composition survives them. */
  readonly extensionFailures: readonly ExtensionRootFailure[]
  /** Coordinate (`publisher/id`) of every loaded extension, in load order. */
  readonly extensionCoordinates: readonly string[]
  /** Open a file inside `roots`. A path outside them is refused before any filesystem access. */
  open(path: string, signal?: AbortSignal): Promise<ModkitOpened>
  close(): Promise<void>
}

const inside = (roots: readonly string[], path: string): boolean =>
  roots.some(root => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })

const asRequests = (
  entries: readonly (string | ExtensionRootRequest)[],
): readonly ExtensionRootRequest[] =>
  entries.map(entry => (typeof entry === 'string' ? { root: entry } : entry))

/** The default topology: one Node realm for the host, one for the codec workers. */
function modkitTopology() {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.host/library',
    realms: [
      {
        schemaVersion: 1,
        realmId: MODKIT_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: ['filesystem.read-random', 'worker.module'],
        budgets: {
          maxConcurrentTasks: 8,
          maxWorkerCount: 4,
          maxResidentBytes: uint64('4294967296'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 60_000,
        },
        policy: { id: 'org.modkitx.policy/library-default', revision: '1' },
      },
      nodeWorkerRealmProfile({
        realmId: MODKIT_WORKER_REALM,
        budgets: {
          maxConcurrentTasks: 8,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('4294967296'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 60_000,
        },
        policy: { id: 'org.modkitx.policy/library-worker', revision: '1' },
      }),
    ],
    links: [...nodeWorkerLinks(MODKIT_REALM, MODKIT_WORKER_REALM)],
  })
}

export async function createModkit(options: ModkitOptions): Promise<Modkit> {
  const roots = options.roots.map(root => resolve(root))
  const writableRoots = (options.writableRoots ?? []).map(root => resolve(root))

  // the caller's set and the end user's set, loaded independently: one broken directory becomes a
  // record beside the others, never an exception that takes the host down
  const bundled = await loadExtensionRoots(asRequests(options.extensions), { origin: 'bundled' })
  const installed = await loadExtensionRoots(asRequests(options.userExtensions ?? []), {
    origin: 'installed',
    claimed: bundled.coordinates,
  })

  const services = await createNodeSubjectServices({
    topology: modkitTopology(),
    realms: { host: MODKIT_REALM, workers: MODKIT_WORKER_REALM },
    extensions: [...bundled.inputs, ...installed.inputs],
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.bootstrapUrl === undefined ? {} : { bootstrapUrl: options.bootstrapUrl }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })

  /*
   * One editing authority for the whole host: the backend is confined to `writableRoots`, so even
   * a grant that carries `write-source` cannot reach a file outside them. `write-source` is in the
   * open grant only when the caller named writable roots at all — a read-only host's mutating
   * operations are refused by the host gate, not discovered to fail at commit.
   */
  const editingBackend =
    writableRoots.length === 0 ? undefined : createFileEditingBackend({ roots: writableRoots })
  const evidence = createEvidenceRegistry()
  const writer = createRawWriter()
  const grant: PermissionGrant = {
    id: 'modkit-library',
    classes: editingBackend === undefined ? ['read-source'] : ['read-source', 'write-source'],
  }

  /** Sessions this facade opened that are not closed yet; `close()` sweeps them. */
  const liveSessions = new Set<AssetSession>()
  const lastOpened: { value: Parameters<typeof createSubjectEditing>[0]['opened'] | undefined } = {
    value: undefined,
  }
  const opener = createPathSubjectOpener({
    subjects: services,
    roots,
    grant,
    intent: options.intent ?? 'full',
    sessionId: randomUUID,
    onOpened: opened => {
      lastOpened.value = opened
    },
  })

  return Object.freeze({
    services,
    extensionFailures: Object.freeze([...bundled.failures, ...installed.failures]),
    extensionCoordinates: Object.freeze([...bundled.coordinates, ...installed.coordinates]),

    async open(path: string, signal?: AbortSignal): Promise<ModkitOpened> {
      lastOpened.value = undefined
      const result = await opener(path, signal)
      if (result.snapshot.state !== 'opened' || result.session === undefined) {
        return Object.freeze({ snapshot: result.snapshot, close: async () => undefined })
      }
      const session = result.session
      let editing: SubjectEditing | undefined
      const opened = lastOpened.value
      if (
        editingBackend !== undefined &&
        opened !== undefined &&
        inside(writableRoots, resolve(path))
      ) {
        try {
          editing = createSubjectEditing({
            opened,
            grant,
            backendFor: () => editingBackend,
            evidenceFor: plan => evidence.evidenceFor(plan),
            writer,
          })
        } catch (error) {
          // a subject shape editing does not support yet still opens read-only; the caller sees why
          options.onDiagnostic?.({
            severity: 'information',
            code: 'x3.host/subject-not-editable',
            message: `${path} opened without editing: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      }
      liveSessions.add(session)
      return Object.freeze({
        snapshot: result.snapshot,
        session,
        ...(editing === undefined ? {} : { editing }),
        close: async () => {
          liveSessions.delete(session)
          await session.dispose()
        },
      })
    },

    async close(): Promise<void> {
      // dispose whatever the caller forgot; worker leases end with their sessions
      const open = [...liveSessions]
      liveSessions.clear()
      await Promise.allSettled(open.map(session => session.dispose()))
    },
  })
}
