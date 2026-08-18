/**
 * R6: the Electron subject bridge is capability-RPC (`x3.host/rpc`), not a hand-rolled IPC.
 *
 * Main exposes one root capability per window — `x3.app/subject-services@1` with two methods —
 * over an Electron `MessageChannelMain` port pair; the renderer consumes materialized proxies.
 * Everything below the root comes from the surface authority: the session is
 * `x3.abi/asset-session@1`, its `dataSource(contract, major)` resolves the leased surface from
 * the arguments through the standard registry, iterables are real pull streams, the encoded-media
 * capability is the auxiliary standard surface. Neither side holds a method list of its own —
 * `DATA_SOURCE_METHODS`/`REMOTE_VALUE_METHODS` are gone, and a data-source contract added to the
 * standard table (or a definition surface) crosses this boundary with **zero** Electron changes.
 *
 * The transport is the production `framePortFromMessagePort` adapter (`emitter-event` style for
 * `MessagePortMain` in main, `event-target` for the DOM port in the renderer) — the same adapter
 * the conformance kit proves, including the `MessagePortMain` event shape.
 */

import type { AssetSession, PresentationPlan } from '@modkitx-x3/sdk'
import {
  createEndpoint,
  createStandardSurfaceRegistry,
  framePortFromMessagePort,
  protocolLimits,
  type CapabilitySurface,
  type Endpoint,
  type MessagePortFrameOptions,
  type MessagePortLike,
  type ProtocolLimits,
} from '@modkitx-x3/host/execution'
import { ABI_ASSET_SESSION } from '@modkitx-x3/host/execution'

// ---------------------------------------------------------------------------------------------
// the one app-level surface

export const ELECTRON_SUBJECT_SERVICES = Object.freeze({
  contract: 'x3.app/subject-services',
  major: 1,
})
/** Loader-validated module identity of the services root (there is nothing to import). */
export const ELECTRON_SUBJECT_SERVICES_URL = 'x3-app://electron/subject-services'

const subjectServicesSurface: CapabilitySurface = {
  ...ELECTRON_SUBJECT_SERVICES,
  methods: {
    /** `open(path)` → an inert snapshot (opened carries a `sessionId` to attach). */
    open: { kind: 'value', signal: 'last' },
    /** `attach(sessionId)` → the live session under `x3.abi/asset-session@1`. */
    attach: { kind: 'lease', result: ABI_ASSET_SESSION, wrapper: 'bare' },
  },
}

function subjectSurfaces() {
  // one registry: the services surface names x3.abi/asset-session@1 as a result, and the
  // registry validates that closure at creation time
  return createStandardSurfaceRegistry({ surfaces: [subjectServicesSurface] })
}

const SUBJECT_RPC_LIMITS: ProtocolLimits = protocolLimits({ defaultCallDeadlineMs: 60_000 })

// ---------------------------------------------------------------------------------------------
// wire snapshots (inert data; the session itself is a capability, never part of the snapshot)

export interface SubjectOpenedSnapshot {
  readonly state: 'opened'
  readonly sessionId: string
  readonly descriptor: Record<string, unknown>
  readonly presentation: PresentationPlan
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

/** Main-side opener: everything the old `modkit.subject` open branch did, minus the transport. */
export type ElectronSubjectOpener = (
  path: string,
  signal?: AbortSignal,
) => Promise<{ readonly snapshot: SubjectOpenSnapshot; readonly session?: AssetSession }>

// ---------------------------------------------------------------------------------------------
// main side (worker role: it serves capabilities)

export interface ExposeSubjectRpcOptions {
  /** `MessagePortMain`, a DOM `MessagePort` or anything port-shaped; adapted structurally. */
  readonly port: MessagePortLike | MessagePort
  /** `'emitter-event'` for `MessagePortMain`; tests pass other styles. */
  readonly listener?: MessagePortFrameOptions['listener']
  /** Endpoint identity; the renderer must connect with the same pair. */
  readonly session: string
  readonly generation?: number
  readonly open: ElectronSubjectOpener
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export interface SubjectRpcExposure {
  readonly endpoint: Endpoint
  /** Graceful close: pending (never attached) sessions are disposed, attached ones cascade. */
  close(reason: string): Promise<void>
}

export function exposeElectronSubjectRpc(options: ExposeSubjectRpcOptions): SubjectRpcExposure {
  /** Opened sessions the renderer has not attached yet, keyed by the snapshot's sessionId. */
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
      options.port as MessagePortLike,
      options.listener === undefined ? {} : { listener: options.listener },
    ),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    loader: async request => {
      if (request.moduleUrl !== ELECTRON_SUBJECT_SERVICES_URL) {
        throw new TypeError('the subject-services endpoint serves exactly one module')
      }
      return { module: services, surface: ELECTRON_SUBJECT_SERVICES, release: () => undefined }
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
// renderer side (host role: it consumes capabilities)

/** The shape `createCodecPreview` needs; `dataSource` leases come straight from the proxy. */
export interface SubjectPreviewSession {
  readonly presentation: PresentationPlan
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
  /** The DOM `MessagePort` the preload forwarded (or anything port-shaped in tests). */
  readonly port: MessagePortLike | MessagePort
  /** Default `'event-target'` (a DOM `MessagePort`). */
  readonly listener?: MessagePortFrameOptions['listener']
  readonly session: string
  readonly generation?: number
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

interface ServicesProxy {
  open(path: string): Promise<SubjectOpenSnapshot>
  attach(sessionId: string): Promise<Record<string, unknown>>
}

export async function connectElectronSubjectRpc(
  options: ConnectSubjectRpcOptions,
): Promise<SubjectRpcClient> {
  const endpoint = createEndpoint({
    role: 'host',
    port: framePortFromMessagePort(
      options.port as MessagePortLike,
      options.listener === undefined ? {} : { listener: options.listener },
    ),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectSurfaces(),
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
    moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
    contributionId: 'org.modkitx.app.electron/subject-services',
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
        presentation: snapshot.presentation,
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
