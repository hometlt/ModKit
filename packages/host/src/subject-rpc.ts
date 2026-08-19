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

import type { AssetSession, PresentationPlan } from '@modkitx-x3/sdk'
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
/** Loader-validated module identity of the services root (there is nothing to import). */
export const SUBJECT_SERVICES_URL = 'x3-app://subject-services'

const subjectServicesSurface: CapabilitySurface = {
  ...SUBJECT_SERVICES,
  methods: {
    /** `open(path)` → an inert snapshot (opened carries a `sessionId` to attach). */
    open: { kind: 'value', signal: 'last' },
    /** `attach(sessionId)` → the live session under `x3.abi/asset-session@1`. */
    attach: { kind: 'lease', result: ABI_ASSET_SESSION, wrapper: 'bare' },
  },
}

/** One registry: the services surface names the session ABI surface as a result; closure checked. */
export function subjectRpcSurfaces() {
  return createStandardSurfaceRegistry({ surfaces: [subjectServicesSurface] })
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

export interface SubjectRpcClient {
  open(path: string): Promise<SubjectClientOpenResult>
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
    close: (reason: string) => endpoint.close(reason),
  }
}
