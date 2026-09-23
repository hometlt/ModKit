import { delimiter, isAbsolute, resolve } from 'node:path'
import { PERMISSION_CLASSES, type PermissionClass } from '@modkit/sdk'

export const MODKIT_MCP_ROOTS_ENV = 'MODKIT_MCP_ROOTS'
export const MODKIT_MCP_EXTENSIONS_ENV = 'MODKIT_MCP_EXTENSIONS'
export const MODKIT_MCP_OPERATION_PERMISSIONS_ENV = 'MODKIT_MCP_OPERATION_PERMISSIONS'
export const MODKIT_MCP_ALLOW_EDITS_ENV = 'MODKIT_MCP_ALLOW_EDITS'
export const MODKIT_MCP_CONTENT_SOURCE_CONFIG_ENV = 'MODKIT_MCP_CONTENT_SOURCE_CONFIG'
export const MODKIT_MCP_CONTENT_SOURCE_STORAGE_ENV = 'MODKIT_MCP_CONTENT_SOURCE_STORAGE'

export interface ModkitMcpConfiguration {
  /** Allow bounded, temporary MCP output resources. No filesystem write authority. */
  readonly outputArtifacts?: boolean
  /** Permit explicit prepare/commit/undo/redo tools inside the configured roots. */
  readonly allowEdits?: boolean
  readonly roots: readonly string[]
  readonly extensions: readonly string[]
  readonly operationPermissions?: readonly PermissionClass[]
  readonly allowEffectfulServiceOperations?: boolean
  readonly trustExtensions?: boolean
  readonly contentSourceConfig?: string
  readonly contentSourceStorage?: string
  /** Packages a root that belongs to no package opens inside; the game's own default when absent. */
  readonly baseMods?: readonly string[]
}

const USAGE = `Usage: modkit-mcp --root <absolute-directory> --extension <absolute-directory> [--root ...] [--extension ...] [--output-artifacts] [--allow-edits] [--operation-permission <class> ...] [--allow-effectful-service-operations] [--trust-extensions] [--content-source-config <absolute-file> --content-source-storage <absolute-directory>] [--base-mod <package> ...]\n\nEnvironment fallback:\n  ${MODKIT_MCP_ROOTS_ENV}=<paths separated by ${JSON.stringify(delimiter)}>\n  ${MODKIT_MCP_EXTENSIONS_ENV}=<paths separated by ${JSON.stringify(delimiter)}>\n  ${MODKIT_MCP_OPERATION_PERMISSIONS_ENV}=<permission classes separated by ${JSON.stringify(delimiter)}>\n  ${MODKIT_MCP_ALLOW_EDITS_ENV}=true|false\n  ${MODKIT_MCP_CONTENT_SOURCE_CONFIG_ENV}=<absolute-file>\n  ${MODKIT_MCP_CONTENT_SOURCE_STORAGE_ENV}=<absolute-directory>\n`

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

const envBoolean = (name: string, value: string | undefined): boolean => {
  if (value === undefined || value.trim().length === 0) return false
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new ConfigurationError(`${name} must be true or false`)
}

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
  let allowEdits = envBoolean(MODKIT_MCP_ALLOW_EDITS_ENV, env[MODKIT_MCP_ALLOW_EDITS_ENV])
  let allowEffectfulServiceOperations = false
  let trustExtensions = false
  let contentSourceConfig: string | undefined
  let contentSourceStorage: string | undefined
  const baseMods: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--output-artifacts') {
      outputArtifacts = true
      continue
    }
    if (option === '--allow-edits') {
      allowEdits = true
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
    if (
      option !== '--root' &&
      option !== '--extension' &&
      option !== '--operation-permission' &&
      option !== '--content-source-config' &&
      option !== '--content-source-storage' &&
      option !== '--base-mod'
    ) {
      throw new ConfigurationError(`unknown option: ${option ?? ''}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new ConfigurationError(`${option} requires one absolute directory`)
    }
    if (option === '--root') roots.push(value)
    else if (option === '--extension') extensions.push(value)
    else if (option === '--operation-permission') operationPermissions.push(value)
    else if (option === '--content-source-config') contentSourceConfig = value
    else if (option === '--base-mod') baseMods.push(value)
    else contentSourceStorage = value
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
  contentSourceConfig ??= env[MODKIT_MCP_CONTENT_SOURCE_CONFIG_ENV]
  contentSourceStorage ??= env[MODKIT_MCP_CONTENT_SOURCE_STORAGE_ENV]
  if ((contentSourceConfig === undefined) !== (contentSourceStorage === undefined)) {
    throw new ConfigurationError('content source config and storage must be supplied together')
  }
  if (contentSourceConfig !== undefined && !isAbsolute(contentSourceConfig)) {
    throw new ConfigurationError('content source config must be an absolute path')
  }
  if (contentSourceStorage !== undefined && !isAbsolute(contentSourceStorage)) {
    throw new ConfigurationError('content source storage must be an absolute path')
  }
  return Object.freeze({
    ...(outputArtifacts ? { outputArtifacts: true } : {}),
    ...(allowEdits ? { allowEdits: true } : {}),
    roots: uniqueAbsolute('root', selectedRoots),
    extensions: uniqueAbsolute('extension', selectedExtensions),
    operationPermissions: Object.freeze(
      [...new Set(selectedPermissions)].sort(),
    ) as readonly PermissionClass[],
    allowEffectfulServiceOperations,
    trustExtensions,
    ...(contentSourceConfig === undefined
      ? {}
      : {
          contentSourceConfig: resolve(contentSourceConfig),
          contentSourceStorage: resolve(contentSourceStorage!),
        }),
    ...(baseMods.length === 0 ? {} : { baseMods: Object.freeze([...new Set(baseMods)]) }),
  })
}

export const modkitMcpUsage = (): string => USAGE
