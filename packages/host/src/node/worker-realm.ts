/**
 * The production spawn path of a `worker_threads` realm (THREAT_MODEL_WORKER_BOUNDARY §2): one
 * `Worker` with the isolation options the threat model requires — `env: {}` (never `SHARE_ENV`),
 * `argv: []`, `execArgv: []` (no inherited `--inspect*`/`--require`), V8 `resourceLimits` from
 * the caller's policy, captured and capped stdout/stderr, unmanaged fds tracked — plus a
 * dedicated transferred `MessagePort` adapted to a `FramePort` by the shared
 * `framePortFromMessagePort`. Exit tracking and an idempotent `terminate()` come with it.
 *
 * The Node worker backend spawns every generation through this function; the testkit's fixture
 * harness and the conformance kit's real-thread pair spawn through it as well, so what the kit
 * and the hostile-worker acceptance prove is literally the production spawn path and adapter
 * (acc-12), not a look-alike.
 */

import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker, type ResourceLimits } from 'node:worker_threads'
import { framePortFromMessagePort, type FramePort } from '../execution/index.js'

export interface WorkerRealmSpawn {
  /** File URL of the module the worker runs (a bootstrap or a fixture). */
  readonly bootstrap: URL
  readonly session: string
  readonly generation: number
  /**
   * Extra structured-clone data for `workerData`; the spawner adds `session`, `generation` and the
   * transferred `port`. Must not contain `SharedArrayBuffer`s (T12).
   */
  readonly workerData?: Readonly<Record<string, unknown>>
  readonly resourceLimits?: ResourceLimits
  /** Cap on delivered stdout and stderr text, each; the rest is dropped and flagged. */
  readonly outputCapBytes?: number
  readonly onStdout?: (text: string) => void
  readonly onStderr?: (text: string) => void
  /** Thread name shown in inspectors and diagnostics. */
  readonly name?: string
}

export interface WorkerRealmExit {
  readonly code: number
  /** Set when the worker died from an uncaught error or a resource limit (`ERR_WORKER_OUT_OF_MEMORY`). */
  readonly error?: Error
}

export interface WorkerRealm {
  readonly threadId: number
  /** Host end of the dedicated channel through the production adapter. */
  readonly port: FramePort
  readonly exit: Promise<WorkerRealmExit>
  /** True once `exit` has settled. */
  readonly exited: boolean
  /** True once either stream exceeded `outputCapBytes`. */
  readonly outputTruncated: boolean
  /** `worker.terminate()`; resolves with the exit code; idempotent. */
  terminate(): Promise<number>
}

const DEFAULT_OUTPUT_CAP = 64 * 1024

function capped(
  stream: NodeJS.ReadableStream | null,
  sink: ((text: string) => void) | undefined,
  cap: number,
  state: { bytes: number; truncated: boolean },
): void {
  if (stream === null) return
  stream.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (state.bytes >= cap) {
      state.truncated = true
      return
    }
    const room = cap - state.bytes
    if (text.length > room) {
      state.bytes = cap
      state.truncated = true
      sink?.(text.slice(0, room))
      return
    }
    state.bytes += text.length
    sink?.(text)
  })
}

export function spawnWorkerRealm(spawn: WorkerRealmSpawn): WorkerRealm {
  const channel = new MessageChannel()
  const cap = spawn.outputCapBytes ?? DEFAULT_OUTPUT_CAP
  const outState = { bytes: 0, truncated: false }
  const errState = { bytes: 0, truncated: false }
  const worker = new Worker(fileURLToPath(spawn.bootstrap), {
    workerData: {
      ...(spawn.workerData ?? {}),
      session: spawn.session,
      generation: spawn.generation,
      port: channel.port2,
    },
    transferList: [channel.port2],
    ...(spawn.resourceLimits === undefined ? {} : { resourceLimits: { ...spawn.resourceLimits } }),
    env: {},
    argv: [],
    execArgv: [],
    stdout: true,
    stderr: true,
    trackUnmanagedFds: true,
    ...(spawn.name === undefined ? {} : { name: spawn.name }),
  })
  capped(worker.stdout, spawn.onStdout, cap, outState)
  capped(worker.stderr, spawn.onStderr, cap, errState)
  let exited = false
  let lastError: Error | undefined
  const exit = new Promise<WorkerRealmExit>(resolve => {
    worker.on('error', error => {
      lastError = error
    })
    worker.on('exit', code => {
      exited = true
      // the old port is closed here, before any successor generation can be spawned (T7)
      channel.port1.close()
      resolve(lastError === undefined ? { code } : { code, error: lastError })
    })
  })
  const port = framePortFromMessagePort(channel.port1)
  let terminating: Promise<number> | undefined
  return {
    threadId: worker.threadId,
    port,
    exit,
    get exited() {
      return exited
    },
    get outputTruncated() {
      return outState.truncated || errState.truncated
    },
    terminate() {
      terminating ??= worker.terminate()
      return terminating
    },
  }
}
