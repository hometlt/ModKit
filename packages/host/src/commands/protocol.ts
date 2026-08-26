/**
 * Versioned, JSON-safe command documents for every application caller (blocks 14B/14C).
 *
 * The executable behaviour remains in `CommandRuntime`. This module only snapshots that runtime's
 * public contract and wraps one invocation/result in a stable envelope, so a batch runner never
 * has to infer meaning from terminal prose or copy a domain handler into its own adapter.
 */
import type { JsonValue } from '@modkitx-x3/sdk'
import type { SubjectCommandTarget } from './subject-command-targets.js'
import type { CommandContext, CommandInput, CommandResult, CommandRuntime } from './runtime.js'

export const COMMAND_PROTOCOL_SCHEMA_VERSION = 'modkit-command-protocol-1' as const

export interface CommandContractDocument {
  readonly schemaVersion: typeof COMMAND_PROTOCOL_SCHEMA_VERSION
  readonly commands: readonly CommandContract[]
}

export interface CommandContract {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly input: {
    readonly subject: 'required' | 'optional'
    /** Command-specific values such as `entry` and `target` are JSON fields, never argv syntax. */
    readonly additionalProperties: true
  }
  readonly effects: { readonly mutatesSource: boolean }
  readonly routing: {
    readonly operationIds: readonly string[]
    readonly dataSourceContracts: readonly string[]
  }
  readonly callers: readonly string[]
  readonly result: {
    readonly states: readonly ['ok', 'unavailable', 'failed']
    readonly diagnostics: true
    readonly unavailableAlternativeRequired: true
  }
}

export interface CommandRequest {
  readonly schemaVersion: typeof COMMAND_PROTOCOL_SCHEMA_VERSION
  readonly command: string
  readonly input: CommandInput
}

export interface CommandReceipt {
  readonly schemaVersion: typeof COMMAND_PROTOCOL_SCHEMA_VERSION
  readonly request: CommandRequest
  readonly result: CommandResult
}

const RESULT_STATES = Object.freeze(['ok', 'unavailable', 'failed'] as const)

const immutableJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutableJson(item)))
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, immutableJson(item as JsonValue)]),
      ),
    ) as JsonValue
  }
  return value
}

const snapshotInput = (input: CommandInput): CommandInput =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(input).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, immutableJson(value)]],
      ),
    ),
  )

const snapshotResult = (result: CommandResult): CommandResult => {
  const diagnostics = Object.freeze(result.diagnostics.map(item => Object.freeze({ ...item })))
  if (result.state === 'ok') {
    return Object.freeze({ ...result, data: immutableJson(result.data), diagnostics })
  }
  return Object.freeze({ ...result, diagnostics })
}

/** Describe the live runtime and its data-only routing bindings without importing any handler. */
export function describeCommandContracts(
  runtime: CommandRuntime,
  targets: readonly SubjectCommandTarget[],
): CommandContractDocument {
  const byId = new Map<string, SubjectCommandTarget>(
    targets.map(target => [target.commandId, target]),
  )
  const commands = runtime.descriptors.map(descriptor => {
    const target = byId.get(descriptor.id)
    if (target === undefined) {
      throw new TypeError(`command contract has no routing target for «${descriptor.id}»`)
    }
    return Object.freeze({
      id: descriptor.id,
      title: descriptor.title,
      summary: descriptor.summary,
      input: Object.freeze({
        subject: descriptor.needsSubject ? ('required' as const) : ('optional' as const),
        additionalProperties: true as const,
      }),
      effects: Object.freeze({ mutatesSource: descriptor.mutatesSource }),
      routing: Object.freeze({
        operationIds: Object.freeze([...target.operationIds]),
        dataSourceContracts: Object.freeze([...target.dataSourceContracts]),
      }),
      callers: Object.freeze([...target.hostCallers]),
      result: Object.freeze({
        states: RESULT_STATES,
        diagnostics: true as const,
        unavailableAlternativeRequired: true as const,
      }),
    })
  })
  if (byId.size !== commands.length) {
    throw new TypeError('command contract targets and live runtime descriptors differ')
  }
  return Object.freeze({
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    commands: Object.freeze(commands),
  })
}

/** Build a request from structured values; adapters own argv/UI parsing, not command semantics. */
export function commandRequest(command: string, input: CommandInput): CommandRequest {
  if (command === '') throw new TypeError('a command request needs a non-empty command id')
  return Object.freeze({
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    command,
    input: snapshotInput(input),
  })
}

/** Execute through the shared runtime and return one versioned, JSON-safe receipt. */
export async function executeCommandRequest(
  runtime: CommandRuntime,
  request: CommandRequest,
  context: CommandContext,
): Promise<CommandReceipt> {
  if (request.schemaVersion !== COMMAND_PROTOCOL_SCHEMA_VERSION) {
    throw new TypeError(`unsupported command protocol ${String(request.schemaVersion)}`)
  }
  const stableRequest = commandRequest(request.command, request.input)
  const result = await runtime.run(stableRequest.command, stableRequest.input, context)
  return Object.freeze({
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    request: stableRequest,
    result: snapshotResult(result),
  })
}
