/**
 * Browser worker backend (S5): `worker-brokered` on the `browser-worker` target, the same
 * capability-RPC core and consumer adapters as the Node backend. Loading is
 * verify-then-snapshot: `loadVerifiedModuleGraph` fetches every artifact file, checks it against
 * the inventory's per-file digests and mints immutable module URLs, so what the worker imports is
 * the verified bytes by construction (no TOCTOU window to close). Bare specifiers resolve through
 * the app's module map, honestly unverified (SB-1, like `node_modules` on Node; digests are SB-4).
 *
 * The realm is injected (`realm` factory): the web app supplies a DOM `Worker` +
 * `MessageChannel`; tests inject an in-process realm running `runBrowserWorkerBootstrap` over a
 * loopback pair — the endpoints, loader and adapters under test are the production ones.
 *
 * Honesty (24 §6.1): a browser worker gives crash/hang/protocol isolation and the browser's own
 * origin sandbox; it has no V8 resource-limit API, so the policy here carries deadlines and grace
 * only. Every activation reports `x3.host/worker-shared-origin`.
 */

import { ModkitError, type Diagnostic } from '@modkit/core'
import type { RuntimeTarget, RuntimeVariantDeclaration } from '@modkit/sdk'
import {
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type DataSourceSurfaceSource,
  type Endpoint,
  type FramePort,
  type ProtocolLimits,
  type RetainedValuePolicy,
  type SurfaceRegistry,
} from '../execution/index.js'
import type {
  ExecutionBackend,
  ExecutionBackendActivation,
  ExecutionModuleLease,
} from '../execution/backend.js'
import { moduleAdapter, type ConsumerRealm } from '../execution/consumer-adapters.js'
import { loadVerifiedModuleGraph, type VerifiedLoaderOptions } from './verified-loader.js'

export const WORKER_SHARED_ORIGIN_DIAGNOSTIC = 'x3.host/worker-shared-origin'

export interface BrowserWorkerPolicy {
  readonly loadDeadlineMs: number
  readonly defaultCallDeadlineMs: number
  readonly graceMs: number
}

export const DEFAULT_BROWSER_WORKER_POLICY: BrowserWorkerPolicy = Object.freeze({
  loadDeadlineMs: 15_000,
  defaultCallDeadlineMs: 30_000,
  graceMs: 1_000,
})

/** What the app's realm factory returns: the host end of a spawned worker's channel. */
export interface BrowserWorkerRealmHandle {
  readonly port: FramePort
  /** Hard stop (`worker.terminate()`); idempotent. */
  terminate(): void | Promise<void>
}

export interface BrowserWorkerSpawn {
  readonly session: string
  readonly generation: number
  readonly limits: ProtocolLimits
  readonly foreignSurfaces: readonly DataSourceSurfaceSource[]
  /** The verified module snapshot the worker must evaluate. */
  readonly moduleUrl: string
}

export type BrowserWorkerRealmFactory = (
  spawn: BrowserWorkerSpawn,
) => BrowserWorkerRealmHandle | Promise<BrowserWorkerRealmHandle>

export interface BrowserWorkerBackendOptions {
  /** Spawns the real DOM Worker (or an in-process bootstrap in tests). */
  readonly realm: BrowserWorkerRealmFactory
  /** Fetch/digest/mint hooks of the verified loader (the app binds fetch/WebCrypto/blob URLs). */
  readonly loader: Pick<
    VerifiedLoaderOptions,
    | 'fetchBytes'
    | 'digest'
    | 'createModuleUrl'
    | 'resolveBare'
    | 'resolvePinned'
    | 'maxFiles'
    | 'maxTotalBytes'
  >
  readonly policy?: BrowserWorkerPolicy
  readonly foreignSurfaces?:
    readonly DataSourceSurfaceSource[] | (() => readonly DataSourceSurfaceSource[])
  /** Overrides the surface registry entirely (tests); defaults to the standard registry. */
  readonly surfaces?: SurfaceRegistry
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** Immutable call values each worker keeps between calls (see `RetainedValuePolicy`). */
  readonly retainedValues?: RetainedValuePolicy
}

export function createBrowserWorkerBackend(options: BrowserWorkerBackendOptions): ExecutionBackend {
  const policy = options.policy ?? DEFAULT_BROWSER_WORKER_POLICY
  const foreignSurfaces = (): readonly DataSourceSurfaceSource[] =>
    typeof options.foreignSurfaces === 'function'
      ? options.foreignSurfaces()
      : (options.foreignSurfaces ?? [])
  const report = (diagnostic: Diagnostic) => options.onDiagnostic?.(diagnostic)
  const limits = protocolLimits({ defaultCallDeadlineMs: policy.defaultCallDeadlineMs })

  const supports = (target: RuntimeTarget, variant: RuntimeVariantDeclaration): boolean =>
    variant.executionProfile === 'worker-brokered' && target.environment === 'browser-worker'

  async function activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
    const root = context.artifactRoot.href
    const entrypoint = context.entrypoint.href
    if (!entrypoint.startsWith(root.endsWith('/') ? root : `${root}/`)) {
      throw new ModkitError({
        code: 'x3.host/execution-load-rejected',
        message: 'the entrypoint must live inside its artifact root',
      })
    }
    // verify-then-snapshot: after this line the module URLs *are* the verified bytes
    const graph = await loadVerifiedModuleGraph(entrypoint, {
      artifactRoot: root,
      ...(context.fileDigests === undefined ? {} : { fileDigests: context.fileDigests }),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
      ...options.loader,
    })
    const definitions = foreignSurfaces()
    const surfaces = options.surfaces ?? createStandardSurfaceRegistry({ definitions })
    const session = `browser:${context.ticket.contributionId}:${Date.now().toString(36)}`
    const generation = 1
    const handle = await options.realm({
      session,
      generation,
      limits,
      foreignSurfaces: definitions,
      moduleUrl: graph.url,
    })
    let terminated = false
    const terminate = async (reason: string): Promise<void> => {
      if (terminated) return
      terminated = true
      report({
        code: 'x3.host/worker-terminated',
        severity: 'warning',
        message: `browser worker terminated: ${reason}`,
      })
      await handle.terminate()
    }
    const endpoint: Endpoint = createEndpoint({
      role: 'host',
      port: handle.port,
      session,
      generation,
      surfaces,
      limits,
      ...(options.retainedValues === undefined ? {} : { retainedValues: options.retainedValues }),
      onFailure: failure => {
        const code = 'code' in failure ? failure.code : 'peer-failure'
        void terminate(`protocol failure: ${String(code)}`)
      },
      onDiagnostic: report,
    })
    report({
      code: WORKER_SHARED_ORIGIN_DIAGNOSTIC,
      severity: 'information',
      message: `${context.ticket.contributionId} runs in a browser worker: crash/hang/protocol isolation inside the page origin — ambient Web APIs of the origin are not revoked (24 §6.1 SB-1); loaded from a verified snapshot (${graph.verified.length} file(s), ${graph.unverified.length} unverified dependenc(y/ies))`,
    })
    let released = false
    const release = async (): Promise<void> => {
      if (released) return
      released = true
      await endpoint.close('released')
      await terminate('released')
    }
    let loaded
    try {
      loaded = await endpoint.load(
        {
          moduleUrl: graph.url,
          contributionId: context.ticket.contributionId,
          variantId: context.variant.variantId,
          artifactDigest: context.ticket.artifactDigest,
        },
        {
          deadlineMs: policy.loadDeadlineMs,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        },
      )
    } catch (error) {
      await release()
      throw error
    }
    const live: ConsumerRealm = { endpoint, root: loaded.root }
    // watchdog: a deadline the worker does not answer with a (dropped) late reply is a hang
    const watch = async <T>(target: ConsumerRealm, request: () => Promise<T>): Promise<T> => {
      const before = target.endpoint.counters().droppedLateReplies
      try {
        return await request()
      } catch (error) {
        if (error instanceof ModkitError && error.code === 'x3.host/rpc-deadline-exceeded') {
          const started = Date.now()
          while (Date.now() - started < policy.graceMs) {
            if (target.endpoint.counters().droppedLateReplies > before) break
            await new Promise(resolve => setTimeout(resolve, 10))
          }
          if (target.endpoint.counters().droppedLateReplies === before) {
            void terminate('cancel not honoured within the grace period after a deadline')
          }
        }
        throw error
      }
    }
    const module = moduleAdapter(
      context.ticket.contributionId,
      loaded.root,
      async () => live,
      watch,
    )
    return Object.freeze({ module, release })
  }

  return Object.freeze({ profile: 'worker-brokered', supports, activate })
}
