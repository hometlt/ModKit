/**
 * One command runtime for every application (block 13, works 4–6).
 *
 * Until now each application spelled the same six product verbs for itself. The CLI opened a
 * subject and printed a selection; Electron opened one over IPC and drew it; VS Code opened one and
 * mounted stages. Three spellings of "open this and tell me what it is" is three places for the
 * answer to differ — and exit-gate line 1 of block 13 forbids the end state that drift arrives at:
 * *no domain handler exists only inside an adapter*.
 *
 * So the behaviour lives here and the applications supply capability, never conduct. A command
 * receives a `CommandContext` holding one thing it cannot obtain for itself — a way to open a
 * subject — and answers with a structured result that means the same thing in a terminal, in an
 * IPC reply and in an editor's Problems panel.
 *
 * Three rules the shape enforces:
 *
 *  1. **A missing facility is an answer, not an exception.** §4.2 of the plan says a host without a
 *     facility must return a structured `host-unavailable` carrying the reason *and a safe
 *     alternative*. `unavailable` is therefore a first-class state with both fields required, and a
 *     command that cannot do its job says which command can.
 *  2. **Cancellation is a result, not a throw.** Every command threads the context's `AbortSignal`,
 *     and an aborted run comes back as `failed` with `x3.command/cancelled` — so a CLI exit code, a
 *     progress bar and a webview all learn the same fact the same way.
 *  3. **Nothing here knows a filesystem.** A subject is named by an opaque `ref` string, and what a
 *     ref means is the host's business: a path for the CLI, a path or a `modkit-container:` URI in
 *     VS Code. That is the seam that lets one fixture run in all three.
 */

import type { Diagnostic } from '@modkit/core'
import type { AssetSession, JsonValue } from '@modkit/sdk'
import type { SubjectOpenSnapshot } from '../subject-rpc.js'
import type { SubjectEditing } from '../subject-editing.js'
import type { ServiceOperationCatalog, ServiceOperationInvocation } from '../service-operations.js'

/** The run was asked to stop. Reported, never thrown past the runtime. */
export const COMMAND_CANCELLED = 'x3.command/cancelled'
/** The command needs a subject and the ref did not open. */
export const COMMAND_SUBJECT_UNRESOLVED = 'x3.command/subject-unresolved'
/** The input did not carry what this command requires. */
export const COMMAND_INPUT_INVALID = 'x3.command/input-invalid'
/** No command is registered under that id. */
export const COMMAND_UNKNOWN = 'x3.command/unknown'
/** The subject published no operation this command routes to. §4.2's structured host-unavailable. */
export const COMMAND_UNAVAILABLE = 'x3.command/unavailable'

/** A diagnostic as it travels in a command result: the snapshot shape, so hosts need one reader. */
export interface CommandDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity?: 'error' | 'warning' | 'information' | 'hint'
}

export const commandDiagnostic = (item: Diagnostic): CommandDiagnostic => ({
  code: item.code,
  message: item.message,
  ...(item.severity === undefined ? {} : { severity: item.severity }),
})

/**
 * One step of a running command.
 *
 * `completed`/`total` are optional because honest progress is often unquantified: opening a subject
 * is one indivisible wait, and a bar that invents a percentage for it is decoration. A host maps
 * this onto whatever it has — `withProgress` in VS Code, a line on stderr in the CLI, nothing at
 * all in a headless run.
 */
export interface CommandProgress {
  readonly step: string
  readonly message: string
  readonly completed?: number
  readonly total?: number
}

/** A subject the runtime is working on, and the disposal that goes with it. */
export interface CommandSubject {
  readonly ref: string
  readonly snapshot: SubjectOpenSnapshot
  readonly session?: AssetSession
  /** Host-owned editing authority, present only when the opener may write this subject. */
  readonly editing?: SubjectEditing
  dispose(): Promise<void>
}

/**
 * How this host turns a ref into a subject.
 *
 * The one capability a command cannot supply for itself, and deliberately the only one: everything
 * else a command needs it reads off the opened subject's own descriptor.
 */
export type CommandSubjectOpener = (ref: string, signal?: AbortSignal) => Promise<CommandSubject>

/** Somewhere for a command to put bytes it produced, when the host has such a place. */
export type CommandOutputSink = (
  name: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
) => Promise<string>

/**
 * Where produced bytes go piece by piece, for output too large to hold at once (a multi-gigabyte
 * archive member). A host that has it gets such output streamed; one without it gets whole bytes.
 */
export type CommandOutputStreamSink = (
  name: string,
  chunks: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
) => Promise<string>

export interface CommandContext {
  readonly openSubject: CommandSubjectOpener
  /** Where produced bytes go. Absent means this host cannot write; commands say so structurally. */
  readonly writeOutput?: CommandOutputSink
  readonly writeOutputStream?: CommandOutputStreamSink
  /** Generic subject-independent extension operations, supplied by hosts that authorize them. */
  readonly serviceOperations?: {
    catalog(request: {
      readonly offset: number
      readonly limit: number
      readonly activate: boolean
      readonly signal?: AbortSignal
    }): Promise<ServiceOperationCatalog>
    invoke(request: {
      readonly operationId: string
      readonly input: JsonValue
      readonly signal?: AbortSignal
    }): Promise<ServiceOperationInvocation>
  }
  readonly progress?: (progress: CommandProgress) => void
  readonly signal?: AbortSignal
}

export type CommandResult =
  | {
      readonly state: 'ok'
      readonly command: string
      readonly data: JsonValue
      readonly diagnostics: readonly CommandDiagnostic[]
    }
  | {
      readonly state: 'unavailable'
      readonly command: string
      readonly code: string
      /** Why this host, or this subject, cannot serve the command. */
      readonly reason: string
      /** What the caller can do instead — required, because §4.2 requires it. */
      readonly alternative: string
      readonly diagnostics: readonly CommandDiagnostic[]
    }
  | {
      readonly state: 'failed'
      readonly command: string
      readonly code: string
      readonly message: string
      readonly diagnostics: readonly CommandDiagnostic[]
    }

export interface CommandDescriptor {
  /** Stable id, `subject.<verb>`; the same string in argv, in an IPC payload and in a menu. */
  readonly id: string
  /** Short human title, for a command palette. */
  readonly title: string
  /** One line a `--help` prints. */
  readonly summary: string
  /** True when the command needs a subject ref in its input. */
  readonly needsSubject: boolean
  /** True when the command may write to the source. All six of block 13's first commands read. */
  readonly mutatesSource: boolean
  /** The standard operation it routes to, when it routes to one. Data for a conformance table. */
  readonly operationId?: string
  run(context: CommandContext, input: CommandInput): Promise<CommandResult>
}

/** The input a command receives: a subject ref plus whatever else that command declares. */
export interface CommandInput {
  readonly subject?: string
  readonly [key: string]: JsonValue | undefined
}

export interface CommandRuntime {
  readonly descriptors: readonly CommandDescriptor[]
  get(id: string): CommandDescriptor | undefined
  run(id: string, input: CommandInput, context: CommandContext): Promise<CommandResult>
}

export const ok = (
  command: string,
  data: JsonValue,
  diagnostics: readonly CommandDiagnostic[] = [],
): CommandResult => ({ state: 'ok', command, data, diagnostics })

export const unavailable = (
  command: string,
  reason: string,
  alternative: string,
  diagnostics: readonly CommandDiagnostic[] = [],
  code = COMMAND_UNAVAILABLE,
): CommandResult => ({ state: 'unavailable', command, code, reason, alternative, diagnostics })

export const failed = (
  command: string,
  code: string,
  message: string,
  diagnostics: readonly CommandDiagnostic[] = [],
): CommandResult => ({ state: 'failed', command, code, message, diagnostics })

/**
 * Build a runtime over a set of descriptors.
 *
 * The wrapper around each `run` is the whole of the runtime's own behaviour, and it is three
 * things: a subject ref is required when the descriptor says so, an abort becomes a result rather
 * than an exception, and any other throw becomes a `failed` carrying its message. An application
 * calling `run` therefore never needs a try/catch to stay correct — which is exactly what stopped
 * three of them from agreeing.
 */
export function createCommandRuntime(descriptors: readonly CommandDescriptor[]): CommandRuntime {
  const byId = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]))
  if (byId.size !== descriptors.length) {
    throw new TypeError('two commands share one id; a command id names exactly one behaviour')
  }
  const sorted = Object.freeze([...descriptors].sort((a, b) => (a.id < b.id ? -1 : 1)))

  return Object.freeze({
    descriptors: sorted,
    get: (id: string) => byId.get(id),
    async run(id: string, input: CommandInput, context: CommandContext) {
      const descriptor = byId.get(id)
      if (descriptor === undefined) {
        return failed(id, COMMAND_UNKNOWN, `no command is registered as «${id}»`)
      }
      if (descriptor.needsSubject && (input.subject ?? '') === '') {
        return failed(
          id,
          COMMAND_INPUT_INVALID,
          `«${id}» needs a subject, and the input names none`,
        )
      }
      try {
        if (context.signal?.aborted === true) {
          return failed(id, COMMAND_CANCELLED, 'the run was cancelled before it started')
        }
        return await descriptor.run(context, input)
      } catch (error) {
        if (context.signal?.aborted === true || isAbort(error)) {
          return failed(id, COMMAND_CANCELLED, 'the run was cancelled')
        }
        return failed(
          id,
          'x3.command/failed',
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
