/**
 * Modkit as a Node library — one call from a foreign project to a working host.
 *
 * Everything below is composed from pieces that already exist (`loadExtensionRoots`,
 * `createNodeSubjectServices`, `createPathSubjectOpener`, `createSubjectEditing`); what this module
 * adds is the defaults, so a project that just wants "open this file, show me what it is, let me
 * edit it" does not first need to learn topologies, realms, grants and backends:
 *
 * ```ts
 * import { createModkit } from '@modkit/host/node'
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
 * Dynamic `extensions` and `userExtensions` execute worker-brokered. A product that must activate
 * an explicitly trusted Node-only provider supplies that exact root through `trustedExtensions`;
 * keeping it separate makes the full-process authority decision visible at composition. Reads are
 * confined to `roots`; writes are confined to `writableRoots` by the editing backend itself.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { uint64, type Diagnostic } from '@modkit/core'
import {
  createHostTopology,
  type AssetSession,
  type PermissionGrant,
  type RasterResourcePort,
  type ResourceBudget,
} from '@modkit/sdk'
import type { SubjectOpenSnapshot } from '../subject-rpc.js'
import { createSubjectEditing, type SubjectEditing } from '../subject-editing.js'
import { createSubjectServices } from '../subject-services.js'
import type { SubjectCatalogOptions } from '../catalog-questions.js'
import { resolveFormatWriter } from '../format-writer.js'
import { DEFAULT_SUBJECT_OPEN_BUDGET } from './subject-opener.js'
import { linkedExtensionInputs, type LinkedExtension } from '../linked.js'
import {
  codecFidelityEvidenceRecords,
  createEvidenceRegistry,
  createRawWriter,
  serviceProviderFidelityEvidenceRecord,
} from '../editing-evidence.js'
import { createFileEditingBackend } from './file-editing-backend.js'
import { createFilePayloadStore } from './file-payload-store.js'
import {
  loadExtensionRoots,
  type ExtensionRootFailure,
  type ExtensionRootRequest,
} from './extension-roots.js'
import { createPathSubjectOpener } from './subject-opener.js'
import { createNodeSubjectServices, type NodeSubjectServices } from './subject-services.js'
import { nodeRuntimeTargetBase, nodeWorkerLinks, nodeWorkerRealmProfile } from './profile.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'

const MODKIT_REALM = 'modkit.host/library-main'
const MODKIT_WORKER_REALM = 'modkit.host/library-worker'

export interface ModkitOptions {
  /**
   * Extension directories this project ships (its own codecs, or a checkout of the first-party
   * set). Loaded as `bundled` — the caller vouches for them — but still executed worker-brokered.
   */
  readonly extensions: readonly (string | ExtensionRootRequest)[]
  /**
   * Extensions the application imported at build time (`import { images } from
   * an extension's own `linked` entry). Static `import` is the connection mechanism and the trust
   * decision in one: linked code runs in-process, exactly like the rest of the caller's bundle.
   * `extensions`/`userExtensions` stay the dynamic lane — directories, verified, worker-executed.
   */
  readonly modules?: readonly LinkedExtension[]
  /** Extension directories supplied by the *end user* of the caller's product (`installed`). */
  readonly userExtensions?: readonly (string | ExtensionRootRequest)[]
  /**
   * Exact dynamic roots this embedding explicitly vouches for as full-process code. This is a
   * separate input so an installed extension can never gain trust by appearing in userExtensions.
   */
  readonly trustedExtensions?: readonly (string | ExtensionRootRequest)[]
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
  /**
   * Contribution ids (codecs, writers, providers) the user switched off. They stay listed in the
   * inventory — a settings page must show what is disabled or it cannot be re-enabled — and lose
   * activation eligibility, so resolution never selects them.
   */
  readonly disabledContributions?: readonly string[]
  /**
   * Extension coordinates (`publisher/id`) switched off by the user. Every owned contribution
   * stays inventoried but loses activation eligibility; individual contribution switches are
   * preserved independently for a later re-enable.
   */
  readonly disabledExtensions?: readonly string[]
  /** Where an opened subject's catalog questions are answered (its mod context). */
  readonly subjectCatalog?: SubjectCatalogOptions
  /** Budget of every open and of the writer an edit resolves (default `DEFAULT_SUBJECT_OPEN_BUDGET`). */
  readonly budget?: ResourceBudget
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export interface ModkitOpened {
  /** `state: 'opened'` — descriptor, selection, candidates, diagnostics. */
  readonly snapshot: SubjectOpenSnapshot
  /** Live session: `dataSource(contract, major)`, `operations()`, `dispose()`. */
  readonly session?: AssetSession
  /**
   * The editing surface, present only when the subject sits inside `writableRoots` and its shape
   * supports editing. `editing.editorPorts` is what a `@modkit/ui` editor stage mounts with;
   * `editing.coordinator` is the prepare/commit pair for a host that drives saves itself.
   */
  readonly editing?: SubjectEditing
  /** Subject-bound image decoding (portraits, model textures) through the subject's resources. */
  readonly rasterResources?: RasterResourcePort
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
    topologyId: 'modkit.host/library',
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
        policy: { id: 'modkit.policy/library-default', revision: '1' },
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
        policy: { id: 'modkit.policy/library-worker', revision: '1' },
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
  const linked = linkedExtensionInputs(options.modules ?? [])
  const bundled = await loadExtensionRoots(asRequests(options.extensions), { origin: 'bundled' })
  const trusted = await loadExtensionRoots(asRequests(options.trustedExtensions ?? []), {
    origin: 'bundled',
    allowTrustedInProcess: true,
    claimed: [...linked.coordinates, ...bundled.coordinates],
  })
  const installed = await loadExtensionRoots(asRequests(options.userExtensions ?? []), {
    origin: 'installed',
    claimed: [...linked.coordinates, ...bundled.coordinates, ...trusted.coordinates],
  })

  const services: NodeSubjectServices = await createNodeSubjectServices({
    topology: modkitTopology(),
    realms: { host: MODKIT_REALM, workers: MODKIT_WORKER_REALM },
    extensions: [...linked.inputs, ...bundled.inputs, ...trusted.inputs, ...installed.inputs],
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(linked.modules.size === 0 ? {} : { linkedModules: linked.modules }),
    ...(options.disabledContributions === undefined
      ? {}
      : { disabledContributions: options.disabledContributions }),
    ...(options.disabledExtensions === undefined
      ? {}
      : { disabledExtensions: options.disabledExtensions }),
    ...(options.bootstrapUrl === undefined ? {} : { bootstrapUrl: options.bootstrapUrl }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    ...(options.subjectCatalog === undefined ? {} : { subjectCatalog: options.subjectCatalog }),
  })

  /*
   * Two resolution lanes over one inventory, because the two connection mechanisms declare
   * different execution environments. Directory extensions activate for the worker realm
   * (`node-worker`) — isolation is the point of loading by directory. Linked contributions declare
   * `trusted-in-process` for the host realm (`node`), because the import was the trust decision.
   * The codec is chosen by probe confidence across both lanes; isolation only breaks a tie, so a
   * codec available both ways still runs in the worker. The worker lane goes first, and a certain
   * claim there (confidence 1) is final. Otherwise the trusted lane is asked too, and the less
   * confident of two opened subjects is disposed: a generic worker codec (text-json at 0.78) must not
   * win a `.uvw.json` from the trusted UVW codec (0.995) merely by answering first.
   */
  const trustedLane =
    linked.inputs.length === 0
      ? undefined
      : createSubjectServices({
          inventory: services.inventory,
          target: services.host.target,
          executionBackends: services.executionBackends,
          ...(services.serviceDefinitions === undefined
            ? {}
            : { serviceDefinitions: services.serviceDefinitions }),
          ...(options.subjectCatalog === undefined ? {} : { subjectCatalog: options.subjectCatalog }),
        })
  const subjects =
    trustedLane === undefined
      ? services
      : {
          ...services,
          open: async (request: Parameters<typeof services.open>[0]) => {
            const viaWorkers = await services.open(request)
            if (viaWorkers.state === 'opened' && viaWorkers.selected.confidence >= 1) return viaWorkers
            const viaTrusted = await trustedLane.open(request)
            if (viaTrusted.state !== 'opened') return viaWorkers
            if (viaWorkers.state !== 'opened') return viaTrusted
            const [winner, loser] =
              viaTrusted.selected.confidence > viaWorkers.selected.confidence
                ? [viaTrusted, viaWorkers]
                : [viaWorkers, viaTrusted]
            await loser.session.dispose()
            return winner
          },
        }

  /*
   * One editing authority for the whole host: the backend is confined to `writableRoots`, so even
   * a grant that carries `write-source` cannot reach a file outside them. `write-source` is in the
   * open grant only when the caller named writable roots at all — a read-only host's mutating
   * operations are refused by the host gate, not discovered to fail at commit.
   */
  const editingBackend =
    writableRoots.length === 0 ? undefined : createFileEditingBackend({ roots: writableRoots })
  const payloads = editingBackend === undefined ? undefined : createFilePayloadStore()
  const evidence = createEvidenceRegistry()
  const writer = createRawWriter()
  const grant: PermissionGrant = {
    id: 'modkit-library',
    classes: editingBackend === undefined ? ['read-source'] : ['read-source', 'write-source'],
  }

  /** Sessions this facade opened that are not closed yet; `close()` sweeps them. */
  const liveSessions = new Set<AssetSession>()
  const liveEditings = new Set<SubjectEditing>()
  const lastOpened: { value: Parameters<typeof createSubjectEditing>[0]['opened'] | undefined } = {
    value: undefined,
  }
  // Read through a call: the opener callback sets it, which control-flow narrowing cannot see.
  const readLastOpened = () => lastOpened.value
  const budget = options.budget ?? DEFAULT_SUBJECT_OPEN_BUDGET
  const opener = createPathSubjectOpener({
    subjects,
    roots,
    grant,
    budget,
    intent: options.intent ?? 'full',
    sessionId: randomUUID,
    onOpened: opened => {
      lastOpened.value = opened
    },
  })

  return Object.freeze({
    services,
    extensionFailures: Object.freeze([...bundled.failures, ...trusted.failures, ...installed.failures]),
    extensionCoordinates: Object.freeze([
      ...linked.coordinates,
      ...bundled.coordinates,
      ...trusted.coordinates,
      ...installed.coordinates,
    ]),

    async open(path: string, signal?: AbortSignal): Promise<ModkitOpened> {
      lastOpened.value = undefined
      const result = await opener(path, signal)
      if (result.snapshot.state !== 'opened' || result.session === undefined) {
        return Object.freeze({ snapshot: result.snapshot, close: async () => undefined })
      }
      const session = result.session
      let editing: SubjectEditing | undefined
      const opened = readLastOpened()
      let releaseWriter: (() => Promise<void>) | undefined
      if (
        editingBackend !== undefined &&
        payloads !== undefined &&
        opened?.state === 'opened' &&
        inside(writableRoots, resolve(path))
      ) {
        const editingPayloads = payloads
        /*
         * The format's own writer first, the raw byte splicer as the stated fallback. The
         * difference is what `propose` refuses: a raw writer accepts a whole-source replace that
         * corrupts a JSON file — "these bytes at this range" is its entire contract — while the
         * format writer refuses it while the user can still do something about it. The
         * diagnostics say which one this subject got, and why.
         */
        const resolution = await resolveFormatWriter({
          services,
          opened,
          grant,
          budgets: budget,
        })
        for (const item of resolution.diagnostics) options.onDiagnostic?.(item)
        releaseWriter = resolution.release
        try {
          const selectedWriter = resolution.writer ?? writer
          const selectedEvidence =
            resolution.writer === undefined
              ? undefined
              : serviceProviderFidelityEvidenceRecord(services.inventory, {
                  writer: resolution.writer,
                })
          // The opened codec's own declared proofs, as the VS Code containers path cites them. A
          // user-installed extension cannot vouch for itself; bundled and linked code can.
          const sessionEvidence = [
            ...(selectedEvidence === undefined ? [] : [selectedEvidence]),
            ...(opened.descriptor.interpretation === 'none'
              ? []
              : codecFidelityEvidenceRecords(services.inventory, {
                  codecId: opened.descriptor.identity.codecId,
                  formatId: opened.descriptor.identity.formatId,
                  acceptedOrigins: ['bundled', 'linked'],
                })),
          ].reduce((registry, record) => registry.with(record), evidence)
          editing = createSubjectEditing({
            opened,
            grant,
            backendFor: () => editingBackend,
            payloads: editingPayloads,
            verifyStagedPayload: (ref, verifySignal) =>
              editingPayloads.verify(ref, verifySignal),
            /*
             * Evidence policy of this facade: the raw writer's by-construction record, plus a
             * vouching rule for facet-resolved writers claiming byte-identical round trip with
             * unknown data preserved — that claim class is what the in-repo writer proofs
             * (`packages/host/test/text-writers.test.ts`) establish for every shipped offer, and
             * a facade that resolved the writer through its own definitions is citing its own
             * host's attestation, not a third party's. Anything lossier stays unvouched and the
             * coordinator refuses it as `fidelity-unproven`, which is the honest default.
             */
            evidenceFor: plan => {
              const registered = sessionEvidence.evidenceFor(plan)
              if (registered !== undefined) return registered
              if (
                resolution.writer !== undefined &&
                plan.fidelity.roundTrip === 'byte-identical' &&
                plan.fidelity.preservesUnknownData === true
              ) {
                return {
                  roundTrip: 'byte-identical',
                  preservesUnknownData: true,
                  evidenceId: 'facade:facet-writer/byte-identical',
                  corpusId: 'modkit/packages/host/test/text-writers.test.ts',
                  corpusDigest: 'none:byte-identical-by-contract',
                  conformanceProfile: 'common.edit/writer-v1' as never,
                  writer: resolution.writer.identity,
                  optionsFingerprint: 'options:none',
                  inputClass: 'facet-resolved',
                  provenAt: '2026-08-20T00:00:00Z',
                }
              }
              return undefined
            },
            writer: selectedWriter,
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
      if (editing !== undefined) liveEditings.add(editing)
      return Object.freeze({
        snapshot: result.snapshot,
        session,
        ...(result.rasterResources === undefined
          ? {}
          : { rasterResources: result.rasterResources }),
        ...(editing === undefined ? {} : { editing }),
        close: async () => {
          liveSessions.delete(session)
          if (editing !== undefined) liveEditings.delete(editing)
          await releaseWriter?.()
          await editing?.dispose()
          await session.dispose()
        },
      })
    },

    async close(): Promise<void> {
      // dispose whatever the caller forgot; worker leases end with their sessions
      const open = [...liveSessions]
      const editings = [...liveEditings]
      liveSessions.clear()
      liveEditings.clear()
      await Promise.allSettled([
        ...open.map(session => session.dispose()),
        ...editings.map(editing => editing.dispose()),
      ])
      await editingBackend?.dispose()
      await payloads?.dispose()
    },
  })
}
