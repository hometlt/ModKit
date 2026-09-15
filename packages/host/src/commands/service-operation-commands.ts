import type { JsonValue } from '@modkit/sdk'
import {
  COMMAND_INPUT_INVALID,
  commandDiagnostic,
  failed,
  ok,
  unavailable,
  type CommandDescriptor,
  type CommandContext,
  type CommandInput,
} from './runtime.js'
import type { CommandRoutingTarget } from './protocol.js'

export const SERVICE_OPERATIONS_COMMAND = 'service.operations'
export const SERVICE_OPERATION_INVOKE_COMMAND = 'service.invoke'

const json = (value: unknown): JsonValue => value as JsonValue

const integer = (value: unknown, fallback: number): number | undefined => {
  const selected = value ?? fallback
  return Number.isSafeInteger(selected) && Number(selected) >= 0 ? Number(selected) : undefined
}

const catalogCommand: CommandDescriptor = Object.freeze({
  id: SERVICE_OPERATIONS_COMMAND,
  title: 'Extension operations',
  summary: 'List bounded subject-independent extension operations and their activation state.',
  needsSubject: false,
  mutatesSource: false,
  async run(context: CommandContext, input: CommandInput) {
    if (context.serviceOperations === undefined) {
      return unavailable(
        SERVICE_OPERATIONS_COMMAND,
        'this host does not expose the extension operation catalog',
        'use a host configured with service-operation authority',
      )
    }
    const offset = integer(input['offset'], 0)
    const limit = integer(input['limit'], 50)
    const activate = input['activate'] ?? true
    if (
      offset === undefined ||
      limit === undefined ||
      limit < 1 ||
      limit > 100 ||
      typeof activate !== 'boolean'
    ) {
      return failed(
        SERVICE_OPERATIONS_COMMAND,
        COMMAND_INPUT_INVALID,
        'offset must be non-negative, limit must be 1..100, and activate must be boolean',
      )
    }
    const result = await context.serviceOperations.catalog({
      offset,
      limit,
      activate,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    return ok(SERVICE_OPERATIONS_COMMAND, json(result), result.entries.flatMap(entry => entry.diagnostics).map(commandDiagnostic))
  },
})

const invokeCommand: CommandDescriptor = Object.freeze({
  id: SERVICE_OPERATION_INVOKE_COMMAND,
  title: 'Invoke extension operation',
  summary: 'Invoke one exact subject-independent extension operation through the common host route.',
  needsSubject: false,
  mutatesSource: true,
  async run(context: CommandContext, input: CommandInput) {
    if (context.serviceOperations === undefined) {
      return unavailable(
        SERVICE_OPERATION_INVOKE_COMMAND,
        'this host does not expose extension operation invocation',
        `inspect ${SERVICE_OPERATIONS_COMMAND} in an operation-capable host`,
      )
    }
    const operationId = input['operationId']
    const operationInput = input['operationInput']
    if (typeof operationId !== 'string' || operationId.trim().length === 0 || operationInput === undefined) {
      return failed(
        SERVICE_OPERATION_INVOKE_COMMAND,
        COMMAND_INPUT_INVALID,
        'operationId and operationInput are required',
      )
    }
    const result = await context.serviceOperations.invoke({
      operationId,
      input: operationInput,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const diagnostics = result.diagnostics.map(commandDiagnostic)
    if (result.state === 'invoked') {
      return ok(SERVICE_OPERATION_INVOKE_COMMAND, json(result), diagnostics)
    }
    if (result.state === 'failed') {
      return failed(
        SERVICE_OPERATION_INVOKE_COMMAND,
        result.diagnostics.at(-1)?.code ?? 'x3.command/service-operation-failed',
        result.diagnostics.at(-1)?.message ?? `${operationId} failed`,
        diagnostics,
      )
    }
    return unavailable(
      SERVICE_OPERATION_INVOKE_COMMAND,
      result.diagnostics.at(-1)?.message ?? `${operationId} is unavailable`,
      `inspect ${SERVICE_OPERATIONS_COMMAND} with activation enabled`,
      diagnostics,
      result.diagnostics.at(-1)?.code,
    )
  },
})

export const SERVICE_OPERATION_COMMANDS: readonly CommandDescriptor[] = Object.freeze([
  catalogCommand,
  invokeCommand,
])

export const SERVICE_OPERATION_COMMAND_TARGETS: readonly CommandRoutingTarget[] = Object.freeze([
  Object.freeze({
    commandId: SERVICE_OPERATIONS_COMMAND,
    operationIds: Object.freeze([]),
    dataSourceContracts: Object.freeze([]),
    hostCallers: Object.freeze(['cli', 'mcp', 'electron', 'pwa', 'server', 'vscode']),
  }),
  Object.freeze({
    commandId: SERVICE_OPERATION_INVOKE_COMMAND,
    operationIds: Object.freeze(['common.runtime/operation-provider@1']),
    dataSourceContracts: Object.freeze([]),
    hostCallers: Object.freeze(['cli', 'mcp', 'electron', 'pwa', 'server', 'vscode']),
  }),
])
