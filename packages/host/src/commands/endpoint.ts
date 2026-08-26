/**
 * A lifecycle-aware endpoint for the versioned command protocol.
 *
 * Applications contribute exactly one host binding: how an opaque subject reference is opened in
 * their realm. The catalog, request/receipt envelope, cancellation and bounded run table remain
 * host-owned, so an IPC bridge and a browser shell cannot grow subtly different command rules.
 */
import type { SubjectOpener } from '../subject-rpc.js'
import { commandSubjectsFrom } from './subject-opener.js'
import {
  describeCommandContracts,
  executeCommandRequest,
  type CommandContractDocument,
  type CommandReceipt,
  type CommandRequest,
} from './protocol.js'
import { createCommandRuntime, type CommandOutputSink, type CommandProgress } from './runtime.js'
import { SUBJECT_COMMANDS } from './subject-commands.js'
import { SUBJECT_COMMAND_TARGETS } from './subject-command-targets.js'

export const DEFAULT_COMMAND_MAX_CONCURRENT_RUNS = 32

export interface CommandProtocolRunOptions {
  /** Caller-owned cancellation handle. Reusing a live handle is refused. */
  readonly runId?: string
  readonly signal?: AbortSignal
  readonly progress?: (progress: CommandProgress) => void
  readonly writeOutput?: CommandOutputSink
}

export interface SubjectCommandEndpointOptions {
  readonly openSubject: SubjectOpener
  readonly maxConcurrentRuns?: number
}

export interface SubjectCommandEndpoint {
  readonly catalog: CommandContractDocument
  execute(request: CommandRequest, options?: CommandProtocolRunOptions): Promise<CommandReceipt>
  cancel(runId: string): boolean
  /** Terminal lifecycle boundary: abort everything, await cleanup, and refuse every later run. */
  dispose(): Promise<void>
  readonly activeRuns: number
  readonly closed: boolean
}

/** Compose a bounded protocol endpoint over one application's already-authorized subject realm. */
export function createSubjectCommandEndpoint(
  options: SubjectCommandEndpointOptions,
): SubjectCommandEndpoint {
  const maximum = options.maxConcurrentRuns ?? DEFAULT_COMMAND_MAX_CONCURRENT_RUNS
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new TypeError('maxConcurrentRuns must be a positive safe integer')
  }
  const runtime = createCommandRuntime(SUBJECT_COMMANDS)
  const opener = commandSubjectsFrom(options.openSubject)
  const active = new Set<AbortController>()
  const tasks = new Set<Promise<CommandReceipt>>()
  const byRunId = new Map<string, AbortController>()
  let closed = false
  let disposing: Promise<void> | undefined

  return Object.freeze({
    catalog: describeCommandContracts(runtime, Object.values(SUBJECT_COMMAND_TARGETS)),
    async execute(
      request: CommandRequest,
      runOptions: CommandProtocolRunOptions = {},
    ): Promise<CommandReceipt> {
      if (closed) throw new Error('the command endpoint is closed')
      if (active.size >= maximum) {
        throw new RangeError(`the command endpoint already has its ${maximum} permitted runs`)
      }
      const runId = runOptions.runId
      if (runId !== undefined) {
        if (runId === '') throw new TypeError('a command run id must not be empty')
        if (byRunId.has(runId)) throw new TypeError(`command run «${runId}» is already active`)
      }

      const controller = new AbortController()
      const abort = () => controller.abort()
      if (runOptions.signal?.aborted === true) controller.abort()
      else runOptions.signal?.addEventListener('abort', abort, { once: true })
      active.add(controller)
      if (runId !== undefined) byRunId.set(runId, controller)
      const task = executeCommandRequest(runtime, request, {
        openSubject: opener,
        signal: controller.signal,
        ...(runOptions.progress === undefined ? {} : { progress: runOptions.progress }),
        ...(runOptions.writeOutput === undefined ? {} : { writeOutput: runOptions.writeOutput }),
      })
      tasks.add(task)
      try {
        return await task
      } finally {
        tasks.delete(task)
        active.delete(controller)
        if (runId !== undefined) byRunId.delete(runId)
        runOptions.signal?.removeEventListener('abort', abort)
      }
    },
    cancel(runId: string): boolean {
      const controller = byRunId.get(runId)
      controller?.abort()
      return controller !== undefined
    },
    dispose(): Promise<void> {
      if (disposing !== undefined) return disposing
      closed = true
      for (const controller of active) controller.abort()
      disposing = Promise.allSettled([...tasks]).then(() => undefined)
      return disposing
    },
    get activeRuns(): number {
      return active.size
    },
    get closed(): boolean {
      return closed
    },
  })
}
