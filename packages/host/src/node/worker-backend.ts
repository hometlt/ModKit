/**
 * Node worker backend (NXT-114): the `worker-brokered` execution profile on the `node` target.
 * One `worker_threads.Worker` per activation generation, spawned through the production spawn
 * path (`spawnWorkerRealm`: `env: {}`, `argv: []`, `execArgv: []`, V8 `resourceLimits` from the
 * host policy, captured and capped stdio, a dedicated transferred `MessagePort` behind the
 * shared `framePortFromMessagePort` adapter), a host-role capability-RPC endpoint over it, and
 * the supervisor reactions THREAT_MODEL_WORKER_BOUNDARY prescribes:
 *
 *  - protocol failure → the endpoint fails closed and the worker is terminated at once;
 *  - worker exit/error → peer exit: pending calls reject, every host lease is released;
 *  - a call that exceeds its deadline sends `cancel`; if the worker does not answer within the
 *    grace period, it is terminated;
 *  - `release()` sends `terminate`, waits the grace period for a clean exit, then terminates;
 *  - **restart (acc-8)**: after the worker died or was terminated, the next `createCodec` on the
 *    same module lease brings up generation + 1 of the same session — the old port is closed
 *    before the new worker exists, remotes of the old generation stay dead
 *    (`x3.host/rpc-peer-exited` / `x3.host/rpc-endpoint-closed`), no handle travels across, the
 *    entrypoint is re-verified against the digests taken at activation. Restarts are bounded by
 *    `policy.maxRestartsPerLease` (`x3.host/worker-restart-limit`); each one is reported as
 *    `x3.host/worker-restarted`.
 *
 * `load` carries the digest of the entrypoint bytes (`entrypointDigest`); the bootstrap
 * re-verifies and evaluates exactly those bytes. The module the lease exposes is a host-side
 * adapter with the *synchronous* `createCodec(context)` the ABI promises, backed by the remote
 * module: the context's diagnostics sink and the probe/open inputs are exposed to the worker as
 * host capabilities (with their data fields), the returned codec/session/data-source objects are
 * the RPC core's materialized proxies.
 *
 * Honest positioning (§0 of the threat model, decision 1 of §8): this is failure and protocol
 * isolation, not a security sandbox — the worker shares the process. Every activation reports
 * `x3.host/worker-shared-process` through `onDiagnostic`.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ModkitError, type Diagnostic } from '@modkit/core'
import type { RuntimeTarget, RuntimeVariantDeclaration } from '@modkit/sdk'
import {
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type DataSourceSurfaceSource,
  type Endpoint,
  type ProtocolLimits,
  type RemoteCapability,
  type SurfaceRegistry,
} from '../execution/index.js'
import type {
  ExecutionBackend,
  ExecutionBackendActivation,
  ExecutionModuleLease,
} from '../execution/backend.js'
import {
  DEFAULT_WORKER_BACKEND_POLICY,
  type WorkerBackendPolicy,
} from '../execution/worker-policy.js'
import { moduleAdapter, type ConsumerRealm } from '../execution/consumer-adapters.js'
import { spawnWorkerRealm, type WorkerRealm } from './worker-realm.js'

export const WORKER_SHARED_PROCESS_DIAGNOSTIC = 'x3.host/worker-shared-process'
export const WORKER_RESTARTED_DIAGNOSTIC = 'x3.host/worker-restarted'

export interface NodeWorkerBackendOptions {
  /** Host policy (validated by `workerBackendPolicy`); defaults are lab-conservative. */
  readonly policy?: WorkerBackendPolicy
  /**
   * Surfaces of registered contract definitions (data-source and service arms), shared with the
   * worker as data. A function is read at every spawn, so a composition root can register the
   * backend before its definitions are inventoried and still have every worker see them.
   */
  readonly foreignSurfaces?:
    readonly DataSourceSurfaceSource[] | (() => readonly DataSourceSurfaceSource[])
  /** Overrides the surface registry entirely (tests); defaults to the standard registry. */
  readonly surfaces?: SurfaceRegistry
  /** Where the bootstrap lives; defaults to the sibling published entry. */
  readonly bootstrapUrl?: URL
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /**
   * Observability/test seam: awaited right after the entrypoint digest is taken and before the
   * worker is spawned. Lets tests place a tamper deterministically inside the window the worker's
   * re-verification must close.
   */
  readonly afterEntrypointDigest?: (digest: string) => Promise<void> | void
}

/** One spawned generation: worker, its endpoint and the loaded module root. */
interface Realm {
  readonly generation: number
  readonly worker: WorkerRealm
  readonly endpoint: Endpoint
  readonly root: RemoteCapability
  terminate(reason: string): Promise<void>
}

type Spawned = Omit<Realm, 'root'>

const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Posix path of `entrypoint` relative to `artifactRoot` (the key of the inventory digest map). */
function artifactRelative(artifactRoot: URL, entrypoint: URL): string {
  const root = artifactRoot.href.endsWith('/') ? artifactRoot.href : `${artifactRoot.href}/`
  return entrypoint.href.startsWith(root)
    ? decodeURIComponent(entrypoint.href.slice(root.length))
    : ''
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms).unref())

/**
 * The bootstrap beside this module, for a host that did not name one.
 *
 * `import.meta.url` is empty in a CommonJS bundle — which VS Code requires for an extension entry
 * — and `new URL(x, undefined)` throws a `TypeError` that says nothing about what to do. A named
 * refusal that names the option is the difference between a five-minute fix and an afternoon.
 */
function defaultBootstrapUrl(): URL {
  const base: string | undefined = import.meta.url
  if (base === undefined || base === '') {
    throw new ModkitError({
      code: 'x3.host/worker-bootstrap-unresolved',
      message:
        'this host must pass bootstrapUrl: import.meta.url is unavailable (a CommonJS bundle), ' +
        'so the worker bootstrap beside this module cannot be located',
    })
  }
  return new URL('./worker-bootstrap.js', base)
}

export function createNodeWorkerBackend(options: NodeWorkerBackendOptions = {}): ExecutionBackend {
  const policy = options.policy ?? DEFAULT_WORKER_BACKEND_POLICY
  const foreignSurfaces = (): readonly DataSourceSurfaceSource[] =>
    typeof options.foreignSurfaces === 'function'
      ? options.foreignSurfaces()
      : (options.foreignSurfaces ?? [])
  const bootstrapUrl = options.bootstrapUrl ?? defaultBootstrapUrl()
  const report = (diagnostic: Diagnostic) => options.onDiagnostic?.(diagnostic)
  const limits: ProtocolLimits = protocolLimits({
    defaultCallDeadlineMs: policy.defaultCallDeadlineMs,
  })

  // the target names the realm the code will run in — the worker realm of a Node host is
  // `node-worker` (a variant's `target.environments` is matched against it by the resolver and
  // the gate); the host process itself (`node`) is where this backend lives, not where it runs code
  const supports = (target: RuntimeTarget, variant: RuntimeVariantDeclaration): boolean =>
    variant.executionProfile === 'worker-brokered' && target.environment === 'node-worker'

  function spawn(
    context: ExecutionBackendActivation,
    session: string,
    generation: number,
  ): Spawned {
    let terminations = 0
    const definitions = foreignSurfaces()
    const surfaces = options.surfaces ?? createStandardSurfaceRegistry({ definitions })
    const worker = spawnWorkerRealm({
      bootstrap: bootstrapUrl,
      session,
      generation,
      workerData: {
        limits,
        artifactRoot: context.artifactRoot.href,
        ...(context.fileDigests === undefined ? {} : { fileDigests: { ...context.fileDigests } }),
        foreignSurfaces: definitions.map(item => ({
          contract: item.contract,
          major: item.major,
          ...(item.surface === undefined ? {} : { surface: item.surface }),
        })),
      },
      resourceLimits: { ...policy.resourceLimits },
      outputCapBytes: policy.outputCapBytes,
      onStdout: text =>
        report({ code: 'x3.host/worker-stdout', severity: 'information', message: text }),
      onStderr: text =>
        report({ code: 'x3.host/worker-stderr', severity: 'warning', message: text }),
      name: `x3-worker:${context.ticket.contributionId}#${generation}`,
    })
    let terminating: Promise<void> | undefined
    const terminate = (reason: string): Promise<void> => {
      terminating ??= (async () => {
        terminations += 1
        report({
          code: 'x3.host/worker-terminated',
          severity: 'warning',
          message: `worker generation ${generation} terminated: ${reason}`,
        })
        await worker.terminate()
      })()
      return terminating
    }
    const endpoint = createEndpoint({
      role: 'host',
      port: worker.port,
      session,
      generation,
      surfaces,
      limits,
      onFailure: failure => {
        const code = 'code' in failure ? failure.code : 'peer-failure'
        void terminate(`protocol failure: ${code}`)
      },
      onDiagnostic: report,
    })
    void worker.exit.then(async ({ code, error }) => {
      await endpoint.peerClosed(
        error === undefined
          ? `worker exited with code ${code}`
          : `worker died: ${error.message} (${(error as { code?: string }).code ?? 'error'})`,
      )
      if (terminations === 0 && error !== undefined) {
        report({ code: 'x3.host/worker-crashed', severity: 'error', message: error.message })
      }
    })
    return { generation, worker, endpoint, terminate }
  }

  /**
   * Runs an outbound request under the hang watchdog: after a deadline, a live worker answers the
   * cancel (a dropped late reply arrives); one that does not within the grace period is killed.
   */
  async function watched<T>(realm: Spawned, request: () => Promise<T>): Promise<T> {
    const before = realm.endpoint.counters().droppedLateReplies
    try {
      return await request()
    } catch (error) {
      if (error instanceof ModkitError && error.code === 'x3.host/rpc-deadline-exceeded') {
        const started = Date.now()
        while (Date.now() - started < policy.graceMs) {
          if (realm.endpoint.counters().droppedLateReplies > before || realm.worker.exited) break
          await delay(10)
        }
        if (realm.endpoint.counters().droppedLateReplies === before && !realm.worker.exited) {
          void realm.terminate('cancel not honoured within the grace period after a deadline')
        }
      }
      throw error
    }
  }

  /** Graceful shutdown of one generation: `terminate` frame → grace → `worker.terminate()`. */
  async function shutdown(realm: Spawned, reason: string): Promise<void> {
    await realm.endpoint.close(reason)
    const exitedInTime = await Promise.race([
      realm.worker.exit.then(() => true),
      delay(policy.graceMs).then(() => false),
    ])
    if (!exitedInTime) await realm.terminate('terminate frame not honoured within the grace period')
    await realm.worker.exit
  }

  async function activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
    if (context.entrypoint.protocol !== 'file:') {
      throw new ModkitError({
        code: 'x3.host/execution-load-rejected',
        message: `the worker backend loads file: entrypoints only, received ${context.entrypoint.protocol}`,
      })
    }
    // the inventory's per-file digest of the entrypoint (still valid: the gate re-verified the
    // artifact digest just now) — or, without a map, the exact bytes hashed here so the worker can
    // refuse anything that changes between here and evaluation (and on every restart)
    const entrypointDigest =
      context.fileDigests?.[artifactRelative(context.artifactRoot, context.entrypoint)] ??
      sha256(await readFile(fileURLToPath(context.entrypoint)))
    await options.afterEntrypointDigest?.(entrypointDigest)

    const session = randomUUID()
    let generation = 0
    let restarts = 0
    let released = false

    const bringUp = async (previous: Realm | undefined, signal?: AbortSignal): Promise<Realm> => {
      if (previous !== undefined && !previous.worker.exited) {
        // never two live generations of one session: kill and wait, the exit handler closes the port
        await previous.terminate('replaced by a new generation')
        await previous.worker.exit
      }
      generation += 1
      const spawnedAt = performance.now()
      const spawned = spawn(context, session, generation)
      try {
        const loaded = await watched(spawned, () =>
          spawned.endpoint.load(
            {
              moduleUrl: context.entrypoint.href,
              contributionId: context.ticket.contributionId,
              variantId: context.variant.variantId,
              artifactDigest: context.ticket.artifactDigest,
              entrypointDigest,
            },
            {
              deadlineMs: policy.loadDeadlineMs,
              ...(signal === undefined ? {} : { signal }),
            },
          ),
        )
        /*
         * What a codec activation cost, where a person can read it: spawning the realm and
         * evaluating the module graph are the two halves, and only the second one moves when a
         * package barrel is narrowed. Reported as information, once per realm brought up.
         */
        report({
          code: 'x3.host/worker-realm-ready',
          severity: 'information',
          message: `${context.ticket.contributionId} realm ${generation} ready in ${Math.round(performance.now() - spawnedAt)} ms (spawn and module load)`,
        })
        return { ...spawned, root: loaded.root }
      } catch (error) {
        await shutdown(spawned, 'load failed')
        throw error
      }
    }

    // reported before any extension code is evaluated (module evaluation already runs it): the
    // boundary this activation gets is a worker thread, not a sandbox
    report({
      code: WORKER_SHARED_PROCESS_DIAGNOSTIC,
      severity: 'information',
      message: `${context.ticket.contributionId} runs in a worker thread: failure and protocol isolation, not a security sandbox (SB-1)`,
    })
    let current: Promise<Realm> = bringUp(undefined, context.signal)
    const first = await current // the activation itself fails when the first generation cannot load

    // serialized: concurrent callers after a death share one restart
    let chain: Promise<unknown> = Promise.resolve()
    const realm = (): Promise<Realm> => {
      const next = chain.then(
        async () => {
          if (released) {
            throw new ModkitError({
              code: 'x3.host/rpc-endpoint-closed',
              message: 'the module lease was released',
            })
          }
          const live = await current.catch(() => undefined)
          if (live !== undefined && !live.worker.exited && live.endpoint.state === 'open')
            return live
          if (restarts >= policy.maxRestartsPerLease) {
            throw new ModkitError({
              code: 'x3.host/worker-restart-limit',
              message: `worker for ${context.ticket.contributionId} died after ${restarts} restart(s); the host policy allows ${policy.maxRestartsPerLease}`,
              context: { restarts, maxRestartsPerLease: policy.maxRestartsPerLease },
              retryability: 'never',
            })
          }
          restarts += 1
          report({
            code: WORKER_RESTARTED_DIAGNOSTIC,
            severity: 'warning',
            message: `worker for ${context.ticket.contributionId} is restarted as generation ${generation + 1} (restart ${restarts} of ${policy.maxRestartsPerLease}); leases of generation ${generation} stay invalid`,
          })
          current = bringUp(live)
          return current
        },
        async () => undefined as never,
      )
      chain = next.catch(() => undefined)
      return next
    }

    const release = async (): Promise<void> => {
      if (released) return
      released = true
      const live = await current.catch(() => undefined)
      if (live !== undefined) await shutdown(live, 'released')
    }
    // the consumer adapters see realms structurally; the watchdog resolves the live realm's
    // supervision state (deadline → cancel → grace → terminate) through the backend's own map
    const consumerWatch = async <T>(
      target: ConsumerRealm,
      request: () => Promise<T>,
    ): Promise<T> => {
      const live = await current.catch(() => undefined)
      return live !== undefined && live.endpoint === target.endpoint
        ? watched(live, request)
        : request()
    }
    const module = moduleAdapter(context.ticket.contributionId, first.root, realm, consumerWatch)
    return Object.freeze({ module, release })
  }

  return Object.freeze({ profile: 'worker-brokered', supports, activate })
}

// ---------------------------------------------------------------------------------------------
// host-side ABI adapters over the remote module
