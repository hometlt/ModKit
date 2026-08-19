/**
 * The subject RPC (S9; R6 generalised): one root capability `x3.app/subject-services@1` with two
 * methods — `open(path)` → an inert snapshot, `attach(sessionId)` → the live session under
 * `x3.abi/asset-session@1` — served over capability-RPC (`x3.host/rpc`) on any port-shaped
 * transport: Electron's `MessageChannelMain`, a DOM `MessagePort`, Node `worker_threads` ports,
 * or anything the `framePortFromMessagePort` adapter accepts. Everything below the root comes from
 * the surface authority: the session is the standard ABI surface, `dataSource(contract, major)`
 * resolves its leased surface from the arguments, iterables are real pull streams. Neither side
 * holds a method list — a data-source contract added to the standard table crosses this boundary
 * with zero application changes.
 *
 * Electron's main/renderer pair was the first consumer (R6); the server (S9) exposes the same
 * root over a port it hands to an embedding process or realm. The opener is host policy: it maps
 * a requested path to an opened subject (or refuses), and nothing here touches a file.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type {
  AssetEditPlan,
  AssetRevision,
  AssetSession,
  ChangeSet,
  CommitReceipt,
  PresentationPlan,
  SourceConflict,
  SubjectEditTarget,
  ValidationResult,
} from '@modkitx-x3/sdk'
import type { SubjectEditing } from './subject-editing.js'
import { ABI_ASSET_SESSION } from './execution/abi-surfaces.js'
import { createEndpoint, type Endpoint } from './execution/endpoint.js'
import {
  framePortFromMessagePort,
  type MessagePortFrameOptions,
  type MessagePortLike,
} from './execution/message-port.js'
import { protocolLimits, type ProtocolLimits } from './execution/protocol.js'
import { createStandardSurfaceRegistry } from './execution/surface-adapter.js'
import type { CapabilitySurface } from './execution/surface.js'

// ---------------------------------------------------------------------------------------------
// the one app-level surface

export const SUBJECT_SERVICES = Object.freeze({ contract: 'x3.app/subject-services', major: 1 })
/** The editing arm of an opened subject; leased from `edit(sessionId)` when the host allows it. */
export const SUBJECT_EDITING = Object.freeze({ contract: 'x3.app/subject-editing', major: 1 })
/** Loader-validated module identity of the services root (there is nothing to import). */
export const SUBJECT_SERVICES_URL = 'x3-app://subject-services'

const subjectServicesSurface: CapabilitySurface = {
  ...SUBJECT_SERVICES,
  methods: {
    /** `open(path)` → an inert snapshot (opened carries a `sessionId` to attach). */
    open: { kind: 'value', signal: 'last' },
    /** `attach(sessionId)` → the live session under `x3.abi/asset-session@1`. */
    attach: { kind: 'lease', result: ABI_ASSET_SESSION, wrapper: 'bare' },
    /** `edit(sessionId)` → the editing arm, when this host can write this subject. */
    edit: { kind: 'lease', result: SUBJECT_EDITING, wrapper: 'bare' },
  },
}

/**
 * The editing arm crosses as data and ids, never as authority: the grant snapshot, the prepared
 * commit and the backends stay on the serving side. A consumer proposes a change, receives a plan,
 * prepares it (getting an id back) and commits that id. Nothing it holds can be replayed into a
 * write it was not granted, because it never holds the grant.
 */
const subjectEditingSurface: CapabilitySurface = {
  ...SUBJECT_EDITING,
  releaseVia: 'dispose',
  methods: {
    state: { kind: 'value' },
    propose: { kind: 'value', signal: 'last', arity: 1 },
    plan: { kind: 'value', signal: 'last', arity: 1 },
    prepare: { kind: 'value', signal: 'last', arity: 1 },
    commit: { kind: 'value', signal: 'last', arity: 1 },
    dispose: { kind: 'value' },
  },
}

/** One registry: the services surface names the session ABI surface as a result; closure checked. */
export function subjectRpcSurfaces() {
  return createStandardSurfaceRegistry({
    surfaces: [subjectServicesSurface, subjectEditingSurface],
  })
}

const SUBJECT_RPC_LIMITS: ProtocolLimits = protocolLimits({ defaultCallDeadlineMs: 60_000 })

// ---------------------------------------------------------------------------------------------
// wire snapshots (inert data; the session itself is a capability, never part of the snapshot)

export interface SubjectOpenedSnapshot {
  readonly state: 'opened'
  readonly sessionId: string
  readonly descriptor: Record<string, unknown>
  /** A host that resolves presentation (Electron) ships the plan; others omit it. */
  readonly presentation?: PresentationPlan
  readonly selected: {
    readonly contributionId: string
    readonly variantId: string
    readonly confidence: number
  }
  readonly candidates: readonly unknown[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
}

export interface SubjectUnresolvedSnapshot {
  readonly state: 'unresolved'
  readonly reason: string
  readonly candidates: readonly unknown[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
}

export type SubjectOpenSnapshot = SubjectOpenedSnapshot | SubjectUnresolvedSnapshot

/** What the editing arm reports about the subject it can write. */
export interface SubjectEditingState {
  readonly revision: AssetRevision
  readonly targets: readonly SubjectEditTarget[]
}

/** `prepare` answers with an id, never with the prepared commit itself. */
export type SubjectEditingPrepareResult =
  | { readonly state: 'ready'; readonly preparedId: string }
  | { readonly state: 'conflict'; readonly conflicts: readonly SourceConflict[] }
  | {
      readonly state: 'rejected'
      readonly reason: string
      readonly diagnostics: readonly Diagnostic[]
    }

export type SubjectEditingCommitResult =
  | { readonly state: 'committed'; readonly receipt: CommitReceipt }
  | { readonly state: 'rolled-back'; readonly receipt: CommitReceipt }
  | { readonly state: 'partially-applied'; readonly receipt: CommitReceipt }
  | {
      readonly state: 'not-applied'
      readonly reason: string
      readonly diagnostics: readonly Diagnostic[]
    }

/** Serving-side opener: host policy from a requested path to a snapshot (+ the live session). */
export type SubjectOpener = (
  path: string,
  signal?: AbortSignal,
) => Promise<{ readonly snapshot: SubjectOpenSnapshot; readonly session?: AssetSession }>

// ---------------------------------------------------------------------------------------------
// serving side (worker role: it serves capabilities)

export interface ExposeSubjectRpcOptions {
  /** `MessagePortMain`, a DOM `MessagePort`, a Node port, or anything port-shaped. */
  readonly port: MessagePortLike
  /** `'emitter-event'` for `MessagePortMain`; default follows the port's shape. */
  readonly listener?: MessagePortFrameOptions['listener']
  /** Endpoint identity; the consumer must connect with the same pair. */
  readonly session: string
  readonly generation?: number
  readonly open: SubjectOpener
  /**
   * Host policy: the editing wiring for an opened session, or `undefined` when this host cannot
   * write this subject (no backend, no writer, no `write-source` in the grant). The consumer sees
   * `edit()` refuse, which is the honest answer — not a save button that fails at the end.
   */
  readonly editing?: (sessionId: string) => SubjectEditing | undefined
  /** Module identity the loader accepts (defaults to the generic root URL). */
  readonly moduleUrl?: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export interface SubjectRpcExposure {
  readonly endpoint: Endpoint
  /** Graceful close: pending (never attached) sessions are disposed, attached ones cascade. */
  close(reason: string): Promise<void>
}

export function exposeSubjectRpc(options: ExposeSubjectRpcOptions): SubjectRpcExposure {
  const moduleUrl = options.moduleUrl ?? SUBJECT_SERVICES_URL
  /** Opened sessions the consumer has not attached yet, keyed by the snapshot's sessionId. */
  const pending = new Map<string, AssetSession>()
  const services = {
    open: async (path: unknown, signal?: AbortSignal): Promise<SubjectOpenSnapshot> => {
      if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
        throw new TypeError('open(path) expects a non-empty path string')
      }
      const result = await options.open(path, signal)
      if (result.snapshot.state === 'opened') {
        if (result.session === undefined) {
          throw new TypeError('an opened snapshot must carry its session')
        }
        pending.set(result.snapshot.sessionId, result.session)
      }
      return result.snapshot
    },
    attach: async (sessionId: unknown) => {
      const session = typeof sessionId === 'string' ? pending.get(sessionId) : undefined
      if (session === undefined) {
        throw new TypeError('subject session is unavailable (already attached or never opened)')
      }
      pending.delete(sessionId as string)
      // the handle owns the session from here: releaseVia dispose (or cascade) releases the lease
      let disposed = false
      return {
        value: session,
        release: async () => {
          if (disposed) return
          disposed = true
          await session.dispose()
        },
      }
    },
    edit: async (sessionId: unknown) => {
      const editing = typeof sessionId === 'string' ? options.editing?.(sessionId) : undefined
      if (editing === undefined) {
        throw new TypeError('this subject is not editable in this host')
      }
      // ids, not authority: the grant snapshot and the prepared commit never leave this side
      const prepared = new Map<string, Parameters<typeof editing.coordinator.commit>[0]>()
      let sequence = 0
      const arm = {
        state: (): SubjectEditingState => ({
          revision: editing.revision,
          targets: editing.targets,
        }),
        propose: async (change: unknown, signal?: AbortSignal): Promise<ValidationResult> => {
          if (editing.session === undefined) {
            throw new TypeError('this subject has no writer, so a change cannot be validated')
          }
          void signal
          return editing.session.propose(change as ChangeSet)
        },
        plan: async (change: unknown, signal?: AbortSignal): Promise<AssetEditPlan> => {
          if (editing.session === undefined) {
            throw new TypeError('this subject has no writer, so a change cannot be planned')
          }
          void signal
          return editing.session.plan(change as ChangeSet)
        },
        prepare: async (
          plan: unknown,
          signal?: AbortSignal,
        ): Promise<SubjectEditingPrepareResult> => {
          const result = await editing.coordinator.prepare(plan as AssetEditPlan, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'ready') {
            sequence += 1
            const preparedId = `prepared-${sequence}`
            prepared.set(preparedId, result.prepared)
            return { state: 'ready', preparedId }
          }
          if (result.state === 'conflict') return { state: 'conflict', conflicts: result.conflicts }
          return { state: 'rejected', reason: result.reason, diagnostics: result.diagnostics }
        },
        commit: async (
          preparedId: unknown,
          signal?: AbortSignal,
        ): Promise<SubjectEditingCommitResult> => {
          const found = typeof preparedId === 'string' ? prepared.get(preparedId) : undefined
          if (found === undefined) {
            throw new TypeError('unknown prepared commit (already committed, or never prepared)')
          }
          prepared.delete(preparedId as string)
          const result = await editing.coordinator.commit(found, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'not-applied') {
            return { state: 'not-applied', reason: result.reason, diagnostics: result.diagnostics }
          }
          return { state: result.state, receipt: result.receipt }
        },
        dispose: async (): Promise<void> => {
          prepared.clear()
          await editing.session?.dispose()
        },
      }
      let released = false
      return {
        value: arm,
        release: async () => {
          if (released) return
          released = true
          await arm.dispose()
        },
      }
    },
  }
  const endpoint = createEndpoint({
    role: 'worker',
    port: framePortFromMessagePort(
      options.port,
      options.listener === undefined ? {} : { listener: options.listener },
    ),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    loader: async request => {
      if (request.moduleUrl !== moduleUrl) {
        throw new TypeError('the subject-services endpoint serves exactly one module')
      }
      return { module: services, surface: SUBJECT_SERVICES, release: () => undefined }
    },
    ...(options.onDiagnostic === undefined
      ? {}
      : {
          onDiagnostic: (diagnostic: { code: string; message: string }) =>
            options.onDiagnostic?.(diagnostic),
        }),
    onFailure: failure => {
      options.onDiagnostic?.({
        code: 'x3.app/subject-rpc-failed',
        message: `${failure.code}: ${failure.message}`,
      })
    },
  })
  let closed = false
  return {
    endpoint,
    async close(reason: string): Promise<void> {
      if (closed) return
      closed = true
      await endpoint.close(reason)
      const orphans = [...pending.values()]
      pending.clear()
      await Promise.allSettled(orphans.map(session => session.dispose()))
    },
  }
}

// ---------------------------------------------------------------------------------------------
// consuming side (host role: it consumes capabilities)

/** The shape a preview/tool needs; `dataSource` leases come straight from the proxy. */
export interface SubjectPreviewSession {
  readonly presentation?: PresentationPlan
  descriptor(): Promise<Record<string, unknown>>
  dataSource(contract: string, major: number): Promise<{ value: unknown }>
  dispose(): Promise<void>
}

export type SubjectClientOpenResult =
  | {
      readonly state: 'opened'
      readonly snapshot: SubjectOpenedSnapshot
      readonly session: SubjectPreviewSession
    }
  | { readonly state: 'unresolved'; readonly snapshot: SubjectUnresolvedSnapshot }

/** The editing arm as a consumer sees it: data in, ids back, no authority anywhere. */
export interface SubjectEditingArm {
  state(): Promise<SubjectEditingState>
  propose(change: ChangeSet): Promise<ValidationResult>
  plan(change: ChangeSet): Promise<AssetEditPlan>
  prepare(plan: AssetEditPlan): Promise<SubjectEditingPrepareResult>
  commit(preparedId: string): Promise<SubjectEditingCommitResult>
  dispose(): Promise<void>
}

export interface SubjectRpcClient {
  open(path: string): Promise<SubjectClientOpenResult>
  /**
   * The editing arm of an opened session. Rejects when the serving side cannot write this subject
   * — which is the honest answer, and the reason a consumer can hide a save button rather than
   * offer one that fails at the end.
   */
  edit(sessionId: string): Promise<SubjectEditingArm>
  close(reason: string): Promise<void>
}

export interface ConnectSubjectRpcOptions {
  /** The port the serving side handed over (or anything port-shaped in tests). */
  readonly port: MessagePortLike
  /** Default `'event-target'` (a DOM `MessagePort`). */
  readonly listener?: MessagePortFrameOptions['listener']
  readonly session: string
  readonly generation?: number
  /** Must match the serving side's module identity (defaults to the generic root URL). */
  readonly moduleUrl?: string
  /** Identity recorded for the loaded root (defaults name the generic services composition). */
  readonly contributionId?: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

interface ServicesProxy {
  open(path: string): Promise<SubjectOpenSnapshot>
  attach(sessionId: string): Promise<Record<string, unknown>>
  edit(sessionId: string): Promise<SubjectEditingArm>
}

export async function connectSubjectRpc(
  options: ConnectSubjectRpcOptions,
): Promise<SubjectRpcClient> {
  const endpoint = createEndpoint({
    role: 'host',
    port: framePortFromMessagePort(
      options.port,
      options.listener === undefined ? {} : { listener: options.listener },
    ),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    ...(options.onDiagnostic === undefined
      ? {}
      : {
          onDiagnostic: (diagnostic: { code: string; message: string }) =>
            options.onDiagnostic?.(diagnostic),
        }),
    onFailure: failure => {
      options.onDiagnostic?.({
        code: 'x3.app/subject-rpc-failed',
        message: `${failure.code}: ${failure.message}`,
      })
    },
  })
  const loaded = await endpoint.load({
    moduleUrl: options.moduleUrl ?? SUBJECT_SERVICES_URL,
    contributionId: options.contributionId ?? 'org.modkitx.app/subject-services',
    variantId: 'main',
    artifactDigest: 'sha256:app-composition',
  })
  const services = endpoint.materialize(loaded.root) as unknown as ServicesProxy
  return {
    async open(path: string): Promise<SubjectClientOpenResult> {
      const snapshot = await services.open(path)
      if (snapshot.state !== 'opened') return { state: 'unresolved', snapshot }
      // the bare lease: a materialized `x3.abi/asset-session@1` proxy; dispose releases the handle
      const proxy = (await services.attach(snapshot.sessionId)) as {
        descriptor(): Promise<Record<string, unknown>>
        dataSource(contract: string, major: number): Promise<{ value: unknown }>
        dispose(): Promise<void>
      }
      const session: SubjectPreviewSession = {
        ...(snapshot.presentation === undefined ? {} : { presentation: snapshot.presentation }),
        // the descriptor already crossed inside the snapshot; asking again would re-run the codec
        descriptor: async () => snapshot.descriptor,
        dataSource: (contract, major) => proxy.dataSource(contract, major),
        dispose: () => proxy.dispose(),
      }
      return { state: 'opened', snapshot, session }
    },
    edit: (sessionId: string) => services.edit(sessionId),
    close: (reason: string) => endpoint.close(reason),
  }
}
