import { delimiter, isAbsolute, resolve } from 'node:path'
import { PERMISSION_CLASSES, type PermissionClass } from '@modkit/sdk'

export const MODKIT_MCP_ROOTS_ENV = 'MODKIT_MCP_ROOTS'
export const MODKIT_MCP_EXTENSIONS_ENV = 'MODKIT_MCP_EXTENSIONS'
export const MODKIT_MCP_OPERATION_PERMISSIONS_ENV = 'MODKIT_MCP_OPERATION_PERMISSIONS'

export interface ModkitMcpConfiguration {
  /** Allow bounded, temporary MCP output resources. No filesystem write authority. */
  readonly outputArtifacts?: boolean
  readonly roots: readonly string[]
  readonly extensions: readonly string[]
  readonly operationPermissions?: readonly PermissionClass[]
  readonly allowEffectfulServiceOperations?: boolean
  readonly trustExtensions?: boolean
}

const USAGE = `Usage: modkit-mcp --root <absolute-directory> --extension <absolute-directory> [--root ...] [--extension ...] [--output-artifacts] [--operation-permission <class> ...] [--allow-effectful-service-operations] [--trust-extensions]\n\nEnvironment fallback:\n  ${MODKIT_MCP_ROOTS_ENV}=<paths separated by ${JSON.stringify(delimiter)}>\n  ${MODKIT_MCP_EXTENSIONS_ENV}=<paths separated by ${JSON.stringify(delimiter)}>\n  ${MODKIT_MCP_OPERATION_PERMISSIONS_ENV}=<permission classes separated by ${JSON.stringify(delimiter)}>\n`

export class ConfigurationError extends TypeError {
  readonly usage = USAGE
}

const envPaths = (value: string | undefined): readonly string[] =>
  value === undefined
    ? []
    : value
        .split(delimiter)
        .map(item => item.trim())
        .filter(Boolean)

const uniqueAbsolute = (kind: string, values: readonly string[]): readonly string[] => {
  if (values.length === 0) {
    throw new ConfigurationError(`at least one ${kind} must be supplied explicitly`)
  }
  const unique = new Set<string>()
  for (const value of values) {
    if (value.length > 4_096) throw new ConfigurationError(`${kind} path is too long`)
    if (!isAbsolute(value)) {
      throw new ConfigurationError(`${kind} paths must be absolute: ${value}`)
    }
    unique.add(resolve(value))
  }
  return Object.freeze([...unique])
}

/** Parse only explicit CLI/env allowlists. No current-directory or installation discovery fallback. */
export function parseModkitMcpConfiguration(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModkitMcpConfiguration {
  const roots: string[] = []
  const extensions: string[] = []
  const operationPermissions: string[] = []
  let outputArtifacts = false
  let allowEffectfulServiceOperations = false
  let trustExtensions = false
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--output-artifacts') {
      outputArtifacts = true
      continue
    }
    if (option === '--allow-effectful-service-operations') {
      allowEffectfulServiceOperations = true
      continue
    }
    if (option === '--trust-extensions') {
      trustExtensions = true
      continue
    }
    if (option === '--help' || option === '-h') throw new ConfigurationError('help requested')
    if (option !== '--root' && option !== '--extension' && option !== '--operation-permission') {
      throw new ConfigurationError(`unknown option: ${option ?? ''}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new ConfigurationError(`${option} requires one absolute directory`)
    }
    if (option === '--root') roots.push(value)
    else if (option === '--extension') extensions.push(value)
    else operationPermissions.push(value)
    index += 1
  }
  const selectedRoots = roots.length > 0 ? roots : envPaths(env[MODKIT_MCP_ROOTS_ENV])
  const selectedExtensions =
    extensions.length > 0 ? extensions : envPaths(env[MODKIT_MCP_EXTENSIONS_ENV])
  const selectedPermissions =
    operationPermissions.length > 0
      ? operationPermissions
      : envPaths(env[MODKIT_MCP_OPERATION_PERMISSIONS_ENV])
  const knownPermissions = new Set<string>(PERMISSION_CLASSES)
  for (const permission of selectedPermissions) {
    if (!knownPermissions.has(permission)) {
      throw new ConfigurationError(`unknown operation permission class: ${permission}`)
    }
  }
  return Object.freeze({
    ...(outputArtifacts ? { outputArtifacts: true } : {}),
    roots: uniqueAbsolute('root', selectedRoots),
    extensions: uniqueAbsolute('extension', selectedExtensions),
    operationPermissions: Object.freeze([...new Set(selectedPermissions)].sort()) as readonly PermissionClass[],
    allowEffectfulServiceOperations,
    trustExtensions,
  })
}

export const modkitMcpUsage = (): string => USAGE
