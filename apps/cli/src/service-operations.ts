import process from 'node:process'
import {
  commandRequest,
  createModkitCommandRuntime,
  discoverServiceOperations,
  executeCommandRequest,
  invokeServiceOperation,
  SERVICE_OPERATION_INVOKE_COMMAND,
  SERVICE_OPERATIONS_COMMAND,
} from '@modkit/host'
import { PERMISSION_CLASSES, type PermissionClass } from '@modkit/sdk'
import { createModkitCliSubjectServices, loadModkitCliExtensions } from './profile.js'
import { cliExtensionFailure } from './extension-validation.js'
import { readOperationInput, renderCommandReceipt, renderCommandResult } from './commands.js'

export const SERVICE_OPERATION_USAGE =
  'usage: modkit operations --ext <dir> [--ext <dir>...] [--permission <class>...] [--trust] [--no-activate] [--offset <n>] [--limit <n>] [--format text|json|protocol-json] | modkit invoke <operation-id> --ext <dir> [--ext <dir>...] --input <json-file> [--permission <class>...] [--allow-effectful] [--trust] [--format text|json|protocol-json]\n'

export interface ServiceOperationCliArguments {
  readonly mode: 'catalog' | 'invoke'
  readonly operationId?: string
  readonly roots: readonly string[]
  readonly permissions: readonly PermissionClass[]
  readonly trust: boolean
  readonly allowEffectful: boolean
  readonly activate: boolean
  readonly offset: number
  readonly limit: number
  readonly inputFile?: string
  readonly format: 'text' | 'json' | 'protocol-json'
}

export function parseServiceOperationArguments(
  mode: 'catalog' | 'invoke',
  operationId: string | undefined,
  argv: readonly string[],
): ServiceOperationCliArguments | undefined {
  if (mode === 'invoke' && (operationId === undefined || operationId.startsWith('--')))
    return undefined
  const roots: string[] = []
  const permissions: PermissionClass[] = []
  const knownPermissions = new Set<string>(PERMISSION_CLASSES)
  let trust = false
  let allowEffectful = false
  let activate = true
  let offset = 0
  let limit = 50
  let inputFile: string | undefined
  let format: ServiceOperationCliArguments['format'] = 'text'
  const value = (index: number) => {
    const candidate = argv[index]
    return candidate === undefined || candidate.startsWith('--') ? undefined : candidate
  }
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--trust') trust = true
    else if (option === '--allow-effectful') allowEffectful = true
    else if (option === '--no-activate' && mode === 'catalog') activate = false
    else if (option === '--ext') {
      const selected = value(index + 1)
      if (selected === undefined) return undefined
      roots.push(selected)
      index += 1
    } else if (option === '--permission') {
      const selected = value(index + 1)
      if (selected === undefined || !knownPermissions.has(selected)) return undefined
      permissions.push(selected as PermissionClass)
      index += 1
    } else if (option === '--input' && mode === 'invoke') {
      inputFile = value(index + 1)
      if (inputFile === undefined) return undefined
      index += 1
    } else if ((option === '--offset' || option === '--limit') && mode === 'catalog') {
      const selected = value(index + 1)
      if (selected === undefined || !/^\d+$/u.test(selected)) return undefined
      if (option === '--offset') offset = Number(selected)
      else limit = Number(selected)
      index += 1
    } else if (option === '--format') {
      const selected = value(index + 1)
      if (selected !== 'text' && selected !== 'json' && selected !== 'protocol-json')
        return undefined
      format = selected
      index += 1
    } else return undefined
  }
  if (roots.length === 0 || limit < 1 || limit > 100 || !Number.isSafeInteger(offset))
    return undefined
  if (mode === 'invoke' && inputFile === undefined) return undefined
  return Object.freeze({
    mode,
    ...(operationId === undefined ? {} : { operationId }),
    roots: Object.freeze(roots),
    permissions: Object.freeze([...new Set(permissions)].sort()),
    trust,
    allowEffectful,
    activate,
    offset,
    limit,
    ...(inputFile === undefined ? {} : { inputFile }),
    format,
  })
}

const budget = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
  deadlineMs: 1_800_000,
})

export async function runServiceOperationCommand(
  arguments_: ServiceOperationCliArguments,
  options: {
    readonly signal?: AbortSignal
    readonly writeStdout?: (text: string) => void
    readonly writeStderr?: (text: string) => void
  } = {},
): Promise<number> {
  const stdout = options.writeStdout ?? (text => void process.stdout.write(text))
  const stderr = options.writeStderr ?? (text => void process.stderr.write(text))
  try {
    const loaded = await loadModkitCliExtensions(arguments_.roots, arguments_.trust, options.signal)
    const services = await createModkitCliSubjectServices(loaded.inputs)
    const admission = cliExtensionFailure(
      arguments_.mode === 'catalog' ? SERVICE_OPERATIONS_COMMAND : SERVICE_OPERATION_INVOKE_COMMAND,
      arguments_.operationId === undefined ? {} : { operationId: arguments_.operationId },
      services.inventory,
      loaded.failures,
    )
    if (admission !== undefined) {
      stdout(
        arguments_.format === 'protocol-json'
          ? renderCommandReceipt(admission)
          : renderCommandResult(admission.result, arguments_.format === 'json'),
      )
      return 1
    }
    // Subject codecs prefer the isolated worker realm. Host-state and external operations publish
    // Node variants deliberately, so their common resolver must target the CLI host realm.
    const operationServices = Object.freeze({ ...services, target: services.host.target })
    const grant = { id: 'modkit-cli-service-operations', classes: arguments_.permissions }
    const runtime = createModkitCommandRuntime()
    const context = {
      openSubject: async () => {
        throw new Error('service operation commands do not open subjects')
      },
      serviceOperations: {
        catalog: (request: {
          offset: number
          limit: number
          activate: boolean
          signal?: AbortSignal
        }) =>
          discoverServiceOperations({
            services: operationServices,
            alternateTargets: [services.target],
            grant,
            budgets: budget,
            offset: request.offset,
            limit: request.limit,
            activate: request.activate,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          }),
        invoke: (request: {
          operationId: string
          input: import('@modkit/sdk').JsonValue
          signal?: AbortSignal
        }) =>
          invokeServiceOperation({
            services: operationServices,
            alternateTargets: [services.target],
            operationId: request.operationId,
            input: request.input,
            grant,
            budgets: budget,
            allowedEffects: arguments_.allowEffectful
              ? ['none', 'host-state', 'external']
              : ['none'],
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          }),
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }
    const command =
      arguments_.mode === 'catalog' ? SERVICE_OPERATIONS_COMMAND : SERVICE_OPERATION_INVOKE_COMMAND
    const input =
      arguments_.mode === 'catalog'
        ? { offset: arguments_.offset, limit: arguments_.limit, activate: arguments_.activate }
        : {
            operationId: arguments_.operationId!,
            operationInput: await readOperationInput(arguments_.inputFile!, options.signal),
          }
    const receipt = await executeCommandRequest(runtime, commandRequest(command, input), context)
    stdout(
      arguments_.format === 'protocol-json'
        ? renderCommandReceipt(receipt)
        : renderCommandResult(receipt.result, arguments_.format === 'json'),
    )
    return receipt.result.state === 'ok' ? 0 : 1
  } catch (error) {
    stderr(
      `modkit ${arguments_.mode === 'catalog' ? 'operations' : 'invoke'}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }
}
