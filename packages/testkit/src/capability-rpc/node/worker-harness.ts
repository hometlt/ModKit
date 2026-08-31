/**
 * Node `worker_threads` harness for the capability-RPC hostile-worker fixtures
 * (THREAT_MODEL_WORKER_BOUNDARY §2/§4/§5). Test infrastructure only: it spawns a fixture in a real
 * thread through the host's **production spawn path** (`spawnWorkerRealm` from
 * `@modkit/host/node`: `env: {}`, `argv: []`, `execArgv: []`, `resourceLimits`, captured and
 * capped stdio, a dedicated `MessagePort` behind the production `framePortFromMessagePort`), and
 * offers a **reference supervisor** — the observable outcomes any production supervisor
 * (NXT‑114, Root) must reproduce: fail-closed → terminate, exit → peer exit, deadline → cancel →
 * grace → terminate, close → terminate frame → grace → terminate, counters drained. The
 * production backend owns its own policy; this file owns the proof — and because the spawn path
 * is shared, what the fixtures and the conformance kit exercise is the backend's own transport
 * (acc-12), while `env-report` checks the isolation options from inside the thread (T6).
 */

import type { ResourceLimits } from 'node:worker_threads'
import { ModkitError, type Diagnostic } from '@modkit/core'
import {
  createEndpoint,
  protocolLimits,
  type Endpoint,
  type FramePort,
  type ProtocolLimits,
  type ProtocolViolation,
  type SurfaceRegistry,
} from '@modkit/host/execution'
import { spawnWorkerRealm } from '@modkit/host/node'
import type { ConformancePair } from '../conformance.js'

// ---------------------------------------------------------------------------------------------
// fixtures

export type HostileWorkerFixtureId =
  | 'demo-worker'
  | 'proto-pollution'
  | 'bad-values'
  | 'exit-early'
  | 'exit-after-ready'
  | 'throw-uncaught'
  | 'hang-sync'
  | 'hang-async'
  | 'oom'
  | 'event-flood'
  | 'forged-handles'
  | 'wrong-session'
  | 'reply-games'
  | 'ignore-terminate'
  | 'noisy'
  | 'env-report'

const FIXTURE_DIR = new URL('../../../fixtures/hostile-worker/', import.meta.url)

/** File URLs of the shipped fixtures (`packages/testkit/fixtures/hostile-worker/*.mjs`). */
export const HOSTILE_WORKER_FIXTURES: Readonly<Record<HostileWorkerFixtureId, URL>> = Object.freeze(
  {
    'demo-worker': new URL('demo-worker.mjs', FIXTURE_DIR),
    'proto-pollution': new URL('proto-pollution.mjs', FIXTURE_DIR),
    'bad-values': new URL('bad-values.mjs', FIXTURE_DIR),
    'exit-early': new URL('exit-early.mjs', FIXTURE_DIR),
    'exit-after-ready': new URL('exit-after-ready.mjs', FIXTURE_DIR),
    'throw-uncaught': new URL('throw-uncaught.mjs', FIXTURE_DIR),
    'hang-sync': new URL('hang-sync.mjs', FIXTURE_DIR),
    'hang-async': new URL('hang-async.mjs', FIXTURE_DIR),
    oom: new URL('oom.mjs', FIXTURE_DIR),
    'event-flood': new URL('event-flood.mjs', FIXTURE_DIR),
    'forged-handles': new URL('forged-handles.mjs', FIXTURE_DIR),
    'wrong-session': new URL('wrong-session.mjs', FIXTURE_DIR),
    'reply-games': new URL('reply-games.mjs', FIXTURE_DIR),
    'ignore-terminate': new URL('ignore-terminate.mjs', FIXTURE_DIR),
    noisy: new URL('noisy.mjs', FIXTURE_DIR),
    'env-report': new URL('env-report.mjs', FIXTURE_DIR),
  },
)

// ---------------------------------------------------------------------------------------------
// spawning

export interface SpawnWorkerOptions {
  readonly session: string
  readonly generation: number
  readonly resourceLimits?: ResourceLimits
  /** Structured-clone data handed to the fixture as `workerData.options`. */
  readonly fixtureOptions?: Readonly<Record<string, unknown>>
  /** Cap on captured stdout/stderr bytes each (default 64 KiB); the rest is dropped and flagged. */
  readonly outputCapBytes?: number
}

export interface WorkerExit {
  readonly code: number
  /** Set when the worker died from an uncaught error or a resource limit (`ERR_WORKER_OUT_OF_MEMORY`). */
  readonly error?: Error
}

export interface SpawnedWorker {
  readonly threadId: number
  readonly port: FramePort
  readonly exit: Promise<WorkerExit>
  readonly output: { stdout: string; stderr: string; truncated: boolean }
  /** `worker.terminate()`; resolves with the exit code; idempotent. */
  terminate(): Promise<number>
  /** True once `exit` has settled. */
  readonly exited: boolean
}

/**
 * Spawns a fixture (by id or file URL) in a real worker thread through the host's production
 * spawn path. The fixture receives `workerData = { session, generation, port, options }` and must
 * speak the protocol on `port` (`MessagePort`, transferred).
 */
export function spawnFixtureWorker(
  fixture: HostileWorkerFixtureId | URL,
  options: SpawnWorkerOptions,
): SpawnedWorker {
  const url = fixture instanceof URL ? fixture : HOSTILE_WORKER_FIXTURES[fixture]
  const output = { stdout: '', stderr: '', truncated: false }
  const realm = spawnWorkerRealm({
    bootstrap: url,
    session: options.session,
    generation: options.generation,
    workerData: { options: options.fixtureOptions ?? {} },
    ...(options.resourceLimits === undefined ? {} : { resourceLimits: options.resourceLimits }),
    outputCapBytes: options.outputCapBytes ?? 64 * 1024,
    onStdout: chunk => void (output.stdout += chunk),
    onStderr: chunk => void (output.stderr += chunk),
    name: `x3-hostile-${typeof fixture === 'string' ? fixture : 'custom'}`,
  })
  const exit = realm.exit.then(({ code, error }) => {
    output.truncated = realm.outputTruncated
    return error === undefined ? { code } : { code, error }
  })
  return {
    threadId: realm.threadId,
    port: realm.port,
    exit,
    output,
    get exited() {
      return realm.exited
    },
    terminate: () => realm.terminate(),
  }
}

// ---------------------------------------------------------------------------------------------
// reference supervisor

export interface SuperviseOptions extends SpawnWorkerOptions {
  readonly surfaces: SurfaceRegistry
  readonly limits?: ProtocolLimits
  /** How long the supervisor waits for a peer to honour `cancel`/`terminate` before `terminate()`. */
  readonly graceMs?: number
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export type SupervisionEnd =
  | { readonly kind: 'closed'; readonly exit: WorkerExit }
  | { readonly kind: 'peer-exited'; readonly exit: WorkerExit }
  | { readonly kind: 'violation'; readonly violation: ProtocolViolation; readonly exit: WorkerExit }
  | { readonly kind: 'peer-failure'; readonly error: ModkitError; readonly exit: WorkerExit }

export interface SupervisedWorker {
  readonly spawned: SpawnedWorker
  readonly endpoint: Endpoint
  /** Settles once the endpoint is no longer open *and* the worker has exited. */
  readonly end: Promise<SupervisionEnd>
  /** Reasons the supervisor terminated the worker itself (grace expiries, violations). */
  readonly terminations: readonly string[]
  /**
   * Graceful release: `terminate` frame → wait `graceMs` for the worker to exit → `terminate()`.
   * Idempotent; resolves within `graceMs + ε` regardless of the worker.
   */
  release(reason: string): Promise<SupervisionEnd>
  /**
   * Runs an outbound request under the hang watchdog: if it ends with
   * `x3.host/rpc-deadline-exceeded` and the peer does not acknowledge the cancel within `graceMs`
   * (no dropped late reply arrives), the worker is terminated.
   */
  watched<T>(request: () => Promise<T>): Promise<T>
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms).unref())

/**
 * The reference supervisor: spawns a fixture, runs a host endpoint over its port and reacts the
 * way the threat model prescribes. Every reaction is observable through `end`, `terminations`,
 * `endpoint.counters()` and `spawned.exit`, which is what the acceptance tests assert on.
 */
export function superviseFixtureWorker(
  fixture: HostileWorkerFixtureId | URL,
  options: SuperviseOptions,
): SupervisedWorker {
  const graceMs = options.graceMs ?? 250
  const limits = options.limits ?? protocolLimits({ defaultCallDeadlineMs: 500 })
  const spawned = spawnFixtureWorker(fixture, options)
  const terminations: string[] = []
  let violation: ProtocolViolation | undefined
  let peerFailure: ModkitError | undefined
  let closedByUs = false
  let endResolve: (end: SupervisionEnd) => void = () => undefined
  const end = new Promise<SupervisionEnd>(resolve => {
    endResolve = resolve
  })
  const terminate = (reason: string) => {
    terminations.push(reason)
    void spawned.terminate()
  }
  const endpoint = createEndpoint({
    role: 'host',
    port: spawned.port,
    session: options.session,
    generation: options.generation,
    surfaces: options.surfaces,
    limits,
    onFailure: failure => {
      // fail-closed: the endpoint is already 'failed' and every lease invalidated (T1/T7/T8)
      if (failure instanceof ModkitError) peerFailure = failure
      else violation = failure
      terminate(`protocol failure: ${'code' in failure ? failure.code : 'peer failure'}`)
    },
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  void spawned.exit.then(async exit => {
    // T2/T14: exit or error → peer exit; pending calls reject deterministically
    await endpoint.peerClosed(`worker exited with code ${exit.code}`)
    if (violation !== undefined) endResolve({ kind: 'violation', violation, exit })
    else if (peerFailure !== undefined)
      endResolve({ kind: 'peer-failure', error: peerFailure, exit })
    else if (closedByUs) endResolve({ kind: 'closed', exit })
    else endResolve({ kind: 'peer-exited', exit })
  })
  let releasing: Promise<SupervisionEnd> | undefined
  const release = (reason: string): Promise<SupervisionEnd> => {
    releasing ??= (async () => {
      closedByUs = true
      await endpoint.close(reason) // sends `terminate`, tears down locally
      const exitedInTime = await Promise.race([
        spawned.exit.then(() => true),
        delay(graceMs).then(() => false),
      ])
      if (!exitedInTime) terminate(`terminate frame not honoured within ${graceMs} ms`) // T13
      return end
    })()
    return releasing
  }
  const watched = async <T>(request: () => Promise<T>): Promise<T> => {
    const dropsBefore = endpoint.counters().droppedLateReplies
    try {
      return await request()
    } catch (error) {
      if (error instanceof ModkitError && error.code === 'x3.host/rpc-deadline-exceeded') {
        // T3: the cancel frame is out; a live worker answers it (late reply → dropped & counted)
        const started = Date.now()
        while (Date.now() - started < graceMs) {
          if (endpoint.counters().droppedLateReplies > dropsBefore || spawned.exited) break
          await delay(10)
        }
        if (endpoint.counters().droppedLateReplies === dropsBefore && !spawned.exited)
          terminate(`cancel not honoured within ${graceMs} ms after a deadline`)
      }
      throw error
    }
  }
  return { spawned, endpoint, end, terminations, release, watched }
}

// ---------------------------------------------------------------------------------------------
// conformance kit over a real thread

/**
 * A host-only `ConformancePair` whose far side is the `demo-worker` fixture in a real thread —
 * `runFramePortConformance(identity => demoWorkerPair(identity))` runs the kit's host-observable
 * subset across `worker_threads`, structured clone and transfer included; the in-process-only
 * cases are reported as `skipped`. Each pair spawns (and on `close` terminates) its own worker.
 */
export function demoWorkerPair(
  identity: { readonly session: string; readonly generation: number },
  options: Omit<SpawnWorkerOptions, 'session' | 'generation'> = {},
): ConformancePair {
  const spawned = spawnFixtureWorker('demo-worker', { ...identity, ...options })
  return {
    transport: 'node:worker_threads:demo-worker',
    host: spawned.port,
    farSide: 'demo-world',
    async close() {
      await spawned.terminate()
    },
  }
}
