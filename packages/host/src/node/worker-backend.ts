/**
 * Node worker backend (NXT-114): the `worker-brokered` execution profile on the `node` target.
 * One `worker_threads.Worker` per activation, spawned from the host's own bootstrap with the
 * isolation options of THREAT_MODEL_WORKER_BOUNDARY §2 (`env: {}`, `argv: []`, `execArgv: []`,
 * V8 `resourceLimits` from the host policy, captured and capped stdio, a dedicated transferred
 * `MessagePort`), a host-role capability-RPC endpoint over it, and the supervisor reactions the
 * threat model prescribes:
 *
 *  - protocol failure → the endpoint fails closed and the worker is terminated at once;
 *  - worker exit/error → peer exit: pending calls reject, every host lease is released;
 *  - a call that exceeds its deadline sends `cancel`; if the worker does not answer within the
 *    grace period, it is terminated;
 *  - `release()` sends `terminate`, waits the grace period for a clean exit, then terminates.
 *
 * `load` carries the digest of the entrypoint bytes the host just read (`entrypointDigest`); the
 * bootstrap re-verifies and evaluates exactly those bytes. The module the lease exposes is a
 * host-side adapter with the *synchronous* `createCodec(context)` the ABI promises, backed by the
 * remote module: the context's diagnostics sink and the probe/open inputs are exposed to the
 * worker as host capabilities (with their data fields), the returned codec/session/data-source
 * objects are the RPC core's materialized proxies.
 *
 * Honest positioning (§0 of the threat model, decision 1 of §8): this is failure and protocol
 * isolation, not a security sandbox — the worker shares the process. Every activation reports
 * `x3.host/worker-shared-process` through `onDiagnostic`.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker } from 'node:worker_threads'
import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import type {
  AssetInput,
  AssetSession,
  Codec,
  CodecProbeRequest,
  ContributionContext,
  DetectionResult,
  OpenIntent,
  ResourceBudget,
  RuntimeTarget,
  RuntimeVariantDeclaration,
} from '@modkitx-x3/sdk'
import {
  ABI_ARTIFACT_SOURCE,
  ABI_ASSET_INPUT,
  ABI_DIAGNOSTIC_SINK,
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type DataSourceSurfaceSource,
  type Endpoint,
  type FramePort,
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

export const WORKER_SHARED_PROCESS_DIAGNOSTIC = 'x3.host/worker-shared-process'

export interface NodeWorkerBackendOptions {
  /** Host policy (validated by `workerBackendPolicy`); defaults are lab-conservative. */
  readonly policy?: WorkerBackendPolicy
  /** Surfaces of registered foreign data-source definitions, shared with the worker as data. */
  readonly foreignSurfaces?: readonly DataSourceSurfaceSource[]
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

interface ActiveWorker {
  readonly worker: Worker
  readonly endpoint: Endpoint
  readonly exit: Promise<number>
  readonly exited: boolean
  terminate(reason: string): Promise<void>
}

const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms).unref())

function framePortOver(port: import('node:worker_threads').MessagePort): FramePort {
  return {
    post: (frame, transfer) => port.postMessage(frame, [...transfer]),
    onFrame: handler => {
      const listener = (payload: unknown) => handler(payload)
      port.on('message', listener)
      return () => port.off('message', listener)
    },
  }
}

function capped(sink: (chunk: string) => void, cap: number): (chunk: Buffer | string) => void {
  let seen = 0
  return chunk => {
    if (seen >= cap) return
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const room = cap - seen
    seen += Math.min(room, text.length)
    sink(text.length > room ? text.slice(0, room) : text)
  }
}

export function createNodeWorkerBackend(options: NodeWorkerBackendOptions = {}): ExecutionBackend {
  const policy = options.policy ?? DEFAULT_WORKER_BACKEND_POLICY
  const foreignSurfaces = options.foreignSurfaces ?? []
  const surfaces =
    options.surfaces ?? createStandardSurfaceRegistry({ definitions: foreignSurfaces })
  const bootstrapUrl = options.bootstrapUrl ?? new URL('./worker-bootstrap.js', import.meta.url)
  const report = (diagnostic: Diagnostic) => options.onDiagnostic?.(diagnostic)
  const limits: ProtocolLimits = protocolLimits({
    defaultCallDeadlineMs: policy.defaultCallDeadlineMs,
  })

  const supports = (target: RuntimeTarget, variant: RuntimeVariantDeclaration): boolean =>
    variant.executionProfile === 'worker-brokered' && target.environment === 'node'

  async function spawn(context: ExecutionBackendActivation): Promise<ActiveWorker> {
    const session = randomUUID()
    const generation = 1
    const channel = new MessageChannel()
    let terminations = 0
    const worker = new Worker(fileURLToPath(bootstrapUrl), {
      workerData: {
        session,
        generation,
        port: channel.port2,
        limits,
        artifactRoot: context.artifactRoot.href,
        foreignSurfaces: foreignSurfaces.map(item => ({
          contract: item.contract,
          major: item.major,
          ...(item.surface === undefined ? {} : { surface: item.surface }),
        })),
      },
      transferList: [channel.port2],
      resourceLimits: { ...policy.resourceLimits },
      env: {},
      argv: [],
      execArgv: [],
      stdout: true,
      stderr: true,
      trackUnmanagedFds: true,
      name: `x3-worker:${context.ticket.contributionId}`,
    })
    worker.stdout.on(
      'data',
      capped(
        text => report({ code: 'x3.host/worker-stdout', severity: 'information', message: text }),
        policy.outputCapBytes,
      ),
    )
    worker.stderr.on(
      'data',
      capped(
        text => report({ code: 'x3.host/worker-stderr', severity: 'warning', message: text }),
        policy.outputCapBytes,
      ),
    )
    let exited = false
    let lastError: Error | undefined
    const exit = new Promise<number>(resolve => {
      worker.on('error', error => {
        lastError = error
      })
      worker.on('exit', code => {
        exited = true
        channel.port1.close()
        resolve(code)
      })
    })
    let terminating: Promise<void> | undefined
    const terminate = (reason: string): Promise<void> => {
      terminating ??= (async () => {
        terminations += 1
        report({
          code: 'x3.host/worker-terminated',
          severity: 'warning',
          message: `worker terminated: ${reason}`,
        })
        await worker.terminate()
      })()
      return terminating
    }
    const endpoint = createEndpoint({
      role: 'host',
      port: framePortOver(channel.port1),
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
    void exit.then(async code => {
      await endpoint.peerClosed(
        lastError === undefined
          ? `worker exited with code ${code}`
          : `worker died: ${lastError.message} (${(lastError as { code?: string }).code ?? 'error'})`,
      )
      if (terminations === 0 && lastError !== undefined) {
        report({
          code: 'x3.host/worker-crashed',
          severity: 'error',
          message: lastError.message,
        })
      }
    })
    const active: ActiveWorker = {
      worker,
      endpoint,
      exit,
      get exited() {
        return exited
      },
      terminate,
    }
    return active
  }

  /**
   * Runs an outbound request under the hang watchdog: after a deadline, a live worker answers the
   * cancel (a dropped late reply arrives); one that does not within the grace period is killed.
   */
  async function watched<T>(active: ActiveWorker, request: () => Promise<T>): Promise<T> {
    const before = active.endpoint.counters().droppedLateReplies
    try {
      return await request()
    } catch (error) {
      if (error instanceof ModkitError && error.code === 'x3.host/rpc-deadline-exceeded') {
        const started = Date.now()
        while (Date.now() - started < policy.graceMs) {
          if (active.endpoint.counters().droppedLateReplies > before || active.exited) break
          await delay(10)
        }
        if (active.endpoint.counters().droppedLateReplies === before && !active.exited) {
          void active.terminate('cancel not honoured within the grace period after a deadline')
        }
      }
      throw error
    }
  }

  async function activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
    if (context.entrypoint.protocol !== 'file:') {
      throw new ModkitError({
        code: 'x3.host/execution-load-rejected',
        message: `the worker backend loads file: entrypoints only, received ${context.entrypoint.protocol}`,
      })
    }
    // the gate verified the artifact; hash the exact bytes of the entrypoint now so the worker can
    // refuse anything that changes between here and evaluation
    const entrypointDigest = sha256(await readFile(fileURLToPath(context.entrypoint)))
    await options.afterEntrypointDigest?.(entrypointDigest)
    const active = await spawn(context)
    report({
      code: WORKER_SHARED_PROCESS_DIAGNOSTIC,
      severity: 'information',
      message: `${context.ticket.contributionId} runs in a worker thread: failure and protocol isolation, not a security sandbox (SB-1)`,
    })
    let released = false
    const release = async (): Promise<void> => {
      if (released) return
      released = true
      await active.endpoint.close('released')
      const exitedInTime = await Promise.race([
        active.exit.then(() => true),
        delay(policy.graceMs).then(() => false),
      ])
      if (!exitedInTime)
        await active.terminate('terminate frame not honoured within the grace period')
      await active.exit
    }
    let loaded
    try {
      loaded = await watched(active, () =>
        active.endpoint.load(
          {
            moduleUrl: context.entrypoint.href,
            contributionId: context.ticket.contributionId,
            variantId: context.variant.variantId,
            artifactDigest: context.ticket.artifactDigest,
            entrypointDigest,
          },
          {
            deadlineMs: policy.loadDeadlineMs,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          },
        ),
      )
    } catch (error) {
      await release()
      throw error
    }
    const module = moduleAdapter(active, loaded.root, request => watched(active, request))
    return Object.freeze({ module, release })
  }

  return Object.freeze({ profile: 'worker-brokered', supports, activate })
}

// ---------------------------------------------------------------------------------------------
// host-side ABI adapters over the remote module

type Watch = <T>(request: () => Promise<T>) => Promise<T>

function moduleAdapter(
  active: ActiveWorker,
  root: RemoteCapability,
  watch: Watch,
): Record<string, unknown> {
  const endpoint = active.endpoint
  return Object.freeze({
    abiVersion: root.data['abiVersion'],
    createCodec: (context: ContributionContext): Codec => {
      const sink = endpoint.expose(
        { report: (diagnostic: Diagnostic) => context.diagnostics.report(diagnostic) },
        ABI_DIAGNOSTIC_SINK,
      )
      const codec = watch(() =>
        root.call('createCodec', [{ budgets: context.budgets, diagnostics: sink }]),
      ).then(outcome => {
        if (outcome.kind !== 'lease') {
          throw new ModkitError({
            code: 'x3.host/invalid-codec-module',
            message: 'createCodec did not lease a codec',
          })
        }
        return outcome.remote
      })
      codec.catch(() => undefined)
      return codecAdapter(active, codec, watch)
    },
  })
}

function codecAdapter(active: ActiveWorker, codec: Promise<RemoteCapability>, watch: Watch): Codec {
  const endpoint = active.endpoint
  return {
    async probe(request: CodecProbeRequest, signal?: AbortSignal): Promise<DetectionResult> {
      const remote = await codec
      const source = endpoint.expose(request.source as object, ABI_ARTIFACT_SOURCE)
      try {
        const outcome = await watch(() =>
          remote.call(
            'probe',
            [{ source, plan: request.plan }],
            signal === undefined ? {} : { signal },
          ),
        )
        if (outcome.kind !== 'value') {
          throw new ModkitError({
            code: 'x3.host/rpc-bad-return',
            message: 'probe returned a handle',
          })
        }
        return outcome.value as unknown as DetectionResult
      } finally {
        await source.release()
      }
    },
    async open(
      input: AssetInput,
      intent: OpenIntent,
      budget: ResourceBudget,
      signal?: AbortSignal,
    ) {
      const remote = await codec
      const exposedInput = endpoint.expose(input as unknown as object, ABI_ASSET_INPUT)
      const outcome = await watch(() =>
        remote.call('open', [exposedInput, intent, budget], signal === undefined ? {} : { signal }),
      ).catch(async (error: unknown) => {
        await exposedInput.release()
        throw error
      })
      if (outcome.kind !== 'lease') {
        await exposedInput.release()
        throw new ModkitError({
          code: 'x3.host/rpc-bad-return',
          message: 'open did not lease a session',
        })
      }
      return sessionAdapter(active, outcome.remote, exposedInput, watch) as unknown as AssetSession
    },
  }
}

function sessionAdapter(
  active: ActiveWorker,
  session: RemoteCapability,
  exposedInput: { release(): Promise<void> },
  watch: Watch,
) {
  const endpoint = active.endpoint
  const materialized = endpoint.materialize(session) as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >
  let state: 'live' | 'stale-revision' | 'disposed' = 'live'
  const operations = {
    invoke: async (...args: unknown[]) => {
      const outcome = await watch(() => session.call('operations'))
      if (outcome.kind !== 'lease')
        throw new ModkitError({
          code: 'x3.host/rpc-bad-return',
          message: 'operations did not lease',
        })
      const ops = endpoint.materialize(outcome.remote) as Record<
        string,
        (...a: unknown[]) => Promise<unknown>
      >
      try {
        return await ops['invoke']?.(...args)
      } finally {
        await outcome.remote.release()
      }
    },
    dispose: async () => undefined,
  }
  return {
    revision: session.data['revision'],
    state: () => state,
    descriptor: () => materialized['descriptor']?.(),
    dataSource: (contract: string, major: number) => materialized['dataSource']?.(contract, major),
    operations: () => operations,
    events: (signal?: AbortSignal) =>
      materialized['events']?.(...(signal === undefined ? [] : [signal])),
    dispose: async () => {
      state = 'disposed'
      try {
        await materialized['dispose']?.()
      } finally {
        await exposedInput.release()
      }
    },
  }
}
