import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  ExtensionManagerError,
  normalizeRepositoryManifest,
  normalizeWorkspaceConfiguration,
} from './schema.js'
import { snapshotExtensionPresentation } from './catalog.js'
import type {
  LocalExtensionCandidate,
  LocalExtensionCandidateDiagnostic,
  LocalExtensionCandidateDiscovery,
  LocalExtensionCandidateDiscoveryOptions,
} from './node-types.js'
import type {
  ExtensionRepositoryManifest,
  ExtensionSourceDescriptor,
  ExtensionWorkspaceConfiguration,
} from './public-types.js'

type Environment = Record<string, string | undefined>
type RepositoryEntry = ExtensionRepositoryManifest['extensions'][number]
interface DiscoveryLimits {
  readonly maxSources: number
  readonly maxExtensionsPerRepository: number
  readonly maxDescriptorBytes: number
  readonly maxPackageBytes: number
  readonly maxContributionManifests: number
  readonly maxContributionFileBytes: number
  readonly maxContributionBytes: number
}
interface RepositoryMetadata {
  readonly packageName?: string
  readonly displayName?: string
  readonly summary?: string
  readonly version?: string
  readonly license?: string
  readonly homepage?: string
}

const CONFIG_NAME = 'modkit.workspace.json'
const DEFAULT_DESCRIPTOR = 'modkit.repository.json'
const SOURCE_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): never {
  throw new ExtensionManagerError(code, message, context, cause)
}

function inside(root: string, candidate: string): boolean {
  const offset = relative(root, candidate)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}

function boundedPositiveInteger(value: unknown, fallback: number, label: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) {
    fail('extension-manager/options-invalid', `${label} must be a positive safe integer`, {
      value: result,
    })
  }
  return result as number
}

function sourceValue(source: ExtensionSourceDescriptor, environment: Environment): string {
  const override = source.environment === undefined ? undefined : environment[source.environment]
  return override === undefined || override.trim() === '' ? source.uri : override.trim()
}

function sourceUri(value: string, configurationPath: string): string {
  if (SOURCE_SCHEME.test(value) && !WINDOWS_DRIVE.test(value)) return new URL(value).href
  const path = isAbsolute(value) ? resolve(value) : resolve(dirname(configurationPath), value)
  return pathToFileURL(path).href
}

function safeRelativePath(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string') fail('extension-manager/path-invalid', `${label} must be text`)
  if (WINDOWS_DRIVE.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    fail('extension-manager/path-invalid', `${label} must be relative`, { path: value })
  }
  const parts = value
    .replaceAll('\\', '/')
    .split('/')
    .filter(part => part !== '' && part !== '.')
  if (parts.some(part => part === '..')) {
    fail('extension-manager/path-escape', `${label} may not traverse outside its root`, {
      path: value,
    })
  }
  const normalized = parts.join('/')
  if (!allowEmpty && normalized === '') {
    fail('extension-manager/path-invalid', `${label} may not be empty`, { path: value })
  }
  return normalized
}

async function boundedJson(path: string, maxBytes: number, label: string): Promise<unknown> {
  let info
  try {
    info = statSync(path)
  } catch (cause) {
    fail('extension-manager/source-unreadable', `${label} is unreadable`, { path }, cause)
  }
  if (!info.isFile()) {
    fail('extension-manager/source-unreadable', `${label} must be a regular file`, { path })
  }
  if (info.size > maxBytes) {
    fail('extension-manager/byte-limit', `${label} exceeds its byte limit`, {
      path,
      bytes: info.size,
      maxBytes,
    })
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (cause) {
    fail('extension-manager/json-invalid', `${label} is not valid JSON`, { path }, cause)
  }
}

function embeddedJson(
  files: Readonly<Record<string, string>>,
  name: string,
  maxBytes: number,
  label: string,
): unknown {
  const encoded = files[name]
  if (typeof encoded !== 'string' || !BASE64.test(encoded)) {
    fail('extension-manager/base64-invalid', `${label} is not canonical base64`, { path: name })
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) {
    fail('extension-manager/base64-invalid', `${label} is not canonical base64`, { path: name })
  }
  if (bytes.byteLength > maxBytes) {
    fail('extension-manager/byte-limit', `${label} exceeds its byte limit`, {
      path: name,
      bytes: bytes.byteLength,
      maxBytes,
    })
  }
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (cause) {
    fail(
      'extension-manager/json-invalid',
      `${label} is not valid UTF-8 JSON`,
      { path: name },
      cause,
    )
  }
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function deepFreeze<T>(value: T): T {
  const pending = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue
    pending.push(...Object.values(current))
    Object.freeze(current)
  }
  return value
}

function contributionMetadata(value: unknown, path: string) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'extension-manager/contribution-manifest-invalid',
      'contribution manifest must be an object',
      {
        path,
      },
    )
  }
  if (
    (
      value as {
        readonly schemaVersion?: unknown
        readonly id?: unknown
        readonly displayName?: unknown
        readonly contract?: { readonly id?: unknown; readonly major?: unknown }
      }
    ).schemaVersion !== 1
  ) {
    fail(
      'extension-manager/contribution-manifest-invalid',
      'contribution manifest schemaVersion must be 1',
      { path },
    )
  }
  const id = optionalText(
    (
      value as {
        readonly schemaVersion?: unknown
        readonly id?: unknown
        readonly displayName?: unknown
        readonly contract?: { readonly id?: unknown; readonly major?: unknown }
      }
    ).id,
  )
  const displayName = optionalText(
    (
      value as {
        readonly schemaVersion?: unknown
        readonly id?: unknown
        readonly displayName?: unknown
        readonly contract?: { readonly id?: unknown; readonly major?: unknown }
      }
    ).displayName,
  )
  const contract = (
    value as {
      readonly schemaVersion?: unknown
      readonly id?: unknown
      readonly displayName?: unknown
      readonly contract?: { readonly id?: unknown; readonly major?: unknown }
    }
  ).contract
  const contractId = optionalText(contract?.id)
  const contractMajor = contract?.major
  if (
    id === undefined ||
    displayName === undefined ||
    contractId === undefined ||
    !Number.isSafeInteger(contractMajor) ||
    (contractMajor as number) < 1
  ) {
    fail(
      'extension-manager/contribution-manifest-invalid',
      'contribution manifest must declare id, displayName and a positive contract major',
      { path },
    )
  }
  return Object.freeze({
    id,
    displayName,
    contract: Object.freeze({ id: contractId, major: contractMajor as number }),
    path,
    manifest: deepFreeze(value) as Readonly<Record<string, unknown>>,
  })
}

function contributionPatternParts(pattern: string): Readonly<{ directory: string; name: string }> {
  const slash = pattern.lastIndexOf('/')
  const directory = slash === -1 ? '' : pattern.slice(0, slash)
  const name = slash === -1 ? pattern : pattern.slice(slash + 1)
  if (directory.includes('*') || directory.includes('?')) {
    fail(
      'extension-manager/contribution-pattern-unsupported',
      `contribution manifest pattern «${pattern}» may not wildcard directories`,
      { path: pattern },
    )
  }
  if (name !== '*.json' && (name.includes('*') || name.includes('?'))) {
    fail(
      'extension-manager/contribution-pattern-unsupported',
      `contribution manifest pattern «${pattern}» supports only an exact file or *.json`,
      { path: pattern },
    )
  }
  return Object.freeze({ directory, name })
}

async function localContributionPaths(
  root: string,
  patterns: readonly string[],
): Promise<readonly (readonly [string, string])[]> {
  const paths = new Map<string, string>()
  for (const pattern of patterns) {
    const parts = contributionPatternParts(pattern)
    const directoryPath = resolve(root, ...parts.directory.split('/').filter(Boolean))
    if (!inside(root, directoryPath) || !existsSync(directoryPath)) {
      fail(
        'extension-manager/contribution-path-missing',
        `contribution manifest directory for «${pattern}» is missing`,
        { path: directoryPath },
      )
    }
    const realDirectory = realpathSync(directoryPath)
    if (!inside(root, realDirectory) || !statSync(realDirectory).isDirectory()) {
      fail(
        'extension-manager/contribution-path-invalid',
        `contribution manifest directory for «${pattern}» is not confined`,
        { path: realDirectory },
      )
    }
    if (parts.name === '*.json') {
      const entries = await readdir(realDirectory, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue
        if (!entry.isFile()) {
          fail(
            'extension-manager/contribution-node-refused',
            'contribution manifests must be regular files',
            { path: join(realDirectory, entry.name) },
          )
        }
        const path = realpathSync(join(realDirectory, entry.name))
        if (!inside(root, path)) {
          fail('extension-manager/path-escape', 'contribution manifest escapes its extension', {
            path,
          })
        }
        paths.set(path, relative(root, path).split(sep).join('/'))
      }
    } else {
      const lexical = join(realDirectory, parts.name)
      if (!existsSync(lexical)) {
        fail('extension-manager/contribution-path-missing', 'contribution manifest is missing', {
          path: lexical,
        })
      }
      const path = realpathSync(lexical)
      if (!inside(root, path)) {
        fail('extension-manager/path-escape', 'contribution manifest escapes its extension', {
          path,
        })
      }
      paths.set(path, relative(root, path).split(sep).join('/'))
    }
  }
  return [...paths.entries()].sort((left, right) => left[1].localeCompare(right[1]))
}

function embeddedContributionNames(
  files: Readonly<Record<string, string>>,
  patterns: readonly string[],
): readonly string[] {
  const names = new Set<string>()
  const available = Object.keys(files)
  for (const pattern of patterns) {
    const parts = contributionPatternParts(pattern)
    if (parts.name === '*.json') {
      const prefix = parts.directory === '' ? '' : `${parts.directory}/`
      for (const name of available) {
        const normalized = safeRelativePath(name, 'embedded contribution path')
        if (!normalized.startsWith(prefix)) continue
        const remainder = normalized.slice(prefix.length)
        if (remainder !== '' && !remainder.includes('/') && remainder.endsWith('.json')) {
          names.add(normalized)
        }
      }
    } else {
      const name = parts.directory === '' ? parts.name : `${parts.directory}/${parts.name}`
      if (files[name] === undefined) {
        fail('extension-manager/contribution-path-missing', 'embedded contribution is missing', {
          path: name,
        })
      }
      names.add(name)
    }
  }
  return [...names].sort()
}

async function readContributions(
  root: string,
  files: Readonly<Record<string, string>> | undefined,
  patterns: readonly string[],
  sourceId: string,
  limits: DiscoveryLimits,
) {
  const diagnostics: LocalExtensionCandidateDiagnostic[] = []
  const contributions: LocalExtensionCandidate['contributions'][number][] = []
  let entries
  try {
    entries =
      files === undefined
        ? await localContributionPaths(root, patterns)
        : embeddedContributionNames(files, patterns).map(name => [name, name])
  } catch (error) {
    diagnostics.push(diagnostic(error, sourceId, root))
    return Object.freeze({
      contributions: Object.freeze(contributions),
      diagnostics: Object.freeze(diagnostics),
    })
  }
  if (entries.length > limits.maxContributionManifests) {
    diagnostics.push(
      diagnostic(
        new ExtensionManagerError(
          'extension-manager/contribution-limit',
          'extension has too many contribution manifests',
          { entries: entries.length, maxEntries: limits.maxContributionManifests },
        ),
        sourceId,
        root,
      ),
    )
    return Object.freeze({
      contributions: Object.freeze(contributions),
      diagnostics: Object.freeze(diagnostics),
    })
  }
  let totalBytes = 0
  const ids = new Set()
  for (const [path, relativePath] of entries) {
    try {
      let value
      let bytes
      if (files === undefined) {
        const info = statSync(path)
        bytes = info.size
        if (!info.isFile() || bytes > limits.maxContributionFileBytes) {
          fail(
            'extension-manager/contribution-byte-limit',
            'contribution manifest exceeds its file byte limit',
            { path, bytes, maxBytes: limits.maxContributionFileBytes },
          )
        }
        try {
          value = JSON.parse(await readFile(path, 'utf8'))
        } catch (cause) {
          fail(
            'extension-manager/json-invalid',
            'contribution manifest is not valid JSON',
            { path },
            cause,
          )
        }
      } else {
        const encoded = files[path]
        if (typeof encoded !== 'string' || !BASE64.test(encoded)) {
          fail(
            'extension-manager/base64-invalid',
            'embedded contribution is not canonical base64',
            {
              path,
            },
          )
        }
        const data = Buffer.from(encoded, 'base64')
        if (data.toString('base64') !== encoded) {
          fail(
            'extension-manager/base64-invalid',
            'embedded contribution is not canonical base64',
            {
              path,
            },
          )
        }
        bytes = data.byteLength
        if (bytes > limits.maxContributionFileBytes) {
          fail(
            'extension-manager/contribution-byte-limit',
            'embedded contribution exceeds its file byte limit',
            { path, bytes, maxBytes: limits.maxContributionFileBytes },
          )
        }
        try {
          value = JSON.parse(data.toString('utf8'))
        } catch (cause) {
          fail(
            'extension-manager/json-invalid',
            'embedded contribution is not valid UTF-8 JSON',
            { path },
            cause,
          )
        }
      }
      totalBytes += bytes
      if (totalBytes > limits.maxContributionBytes) {
        fail(
          'extension-manager/contribution-byte-limit',
          'extension contributions exceed their total byte limit',
          { bytes: totalBytes, maxBytes: limits.maxContributionBytes },
        )
      }
      const contribution = contributionMetadata(value, relativePath)
      if (ids.has(contribution.id)) {
        fail(
          'extension-manager/contribution-duplicate',
          `contribution «${contribution.id}» is duplicated`,
          { path: relativePath, id: contribution.id },
        )
      }
      ids.add(contribution.id)
      contributions.push(contribution)
    } catch (error) {
      diagnostics.push(diagnostic(error, sourceId, relativePath))
    }
  }
  contributions.sort(
    (left, right) =>
      left.contract.id.localeCompare(right.contract.id) || left.id.localeCompare(right.id),
  )
  return Object.freeze({
    contributions: Object.freeze(contributions),
    diagnostics: Object.freeze(diagnostics),
  })
}

function packageMetadata(packageJson: unknown, expectedId: string | undefined, label: string) {
  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    fail('extension-manager/extension-package-invalid', `${label} must be an object`)
  }
  const manifest = (packageJson as Record<string, unknown>)['modkit']
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('extension-manager/extension-manifest-missing', `${label} has no package.json#modkit`)
  }
  const publisher = optionalText((manifest as Record<string, unknown>)['publisher'])
  const extensionId = optionalText((manifest as Record<string, unknown>)['id'])
  if (publisher === undefined || extensionId === undefined) {
    fail('extension-manager/extension-manifest-invalid', `${label} has no valid publisher and id`)
  }
  const id = `${publisher}/${extensionId}`
  if (expectedId !== undefined && expectedId !== id) {
    fail(
      'extension-manager/extension-id-mismatch',
      `extension «${id}» does not match declared id «${expectedId}»`,
      { expectedId, actualId: id },
    )
  }
  const version = optionalText((packageJson as Record<string, unknown>)['version'])
  if (version === undefined) {
    fail('extension-manager/extension-version-missing', `extension «${id}» has no version`)
  }
  const rawManifests = (manifest as Record<string, unknown>)['contributionManifests'] ?? []
  if (!Array.isArray(rawManifests)) {
    fail(
      'extension-manager/extension-manifest-invalid',
      `extension «${id}» contributionManifests must be a list`,
    )
  }
  const contributionManifests = rawManifests.map((value, index) =>
    safeRelativePath(value, `contributionManifests[${index}]`),
  )
  const packageName = optionalText((packageJson as Record<string, unknown>)['name'])
  const presentation =
    (manifest as Record<string, unknown>)['presentation'] === undefined
      ? undefined
      : snapshotExtensionPresentation(
          (manifest as Record<string, unknown>)['presentation'],
          `${label}#modkit.presentation`,
        )
  const displayName =
    presentation?.displayName ??
    optionalText((packageJson as Record<string, unknown>)['displayName']) ??
    packageName ??
    id
  return Object.freeze({
    id,
    publisher,
    extensionId,
    version,
    ...(packageName === undefined ? {} : { packageName }),
    displayName,
    ...(presentation?.description === undefined &&
    optionalText((packageJson as Record<string, unknown>)['description']) === undefined
      ? {}
      : {
          summary:
            presentation?.description ??
            optionalText((packageJson as Record<string, unknown>)['description']),
        }),
    ...(optionalText((packageJson as Record<string, unknown>)['license']) === undefined
      ? {}
      : { license: optionalText((packageJson as Record<string, unknown>)['license']) }),
    ...(optionalText((packageJson as Record<string, unknown>)['homepage']) === undefined
      ? {}
      : { homepage: optionalText((packageJson as Record<string, unknown>)['homepage']) }),
    ...(presentation === undefined ? {} : { presentation }),
    contributionManifests: Object.freeze(contributionManifests),
  }) as unknown as Omit<
    LocalExtensionCandidate,
    'enabled' | 'selected' | 'embedded' | 'sourceId' | 'contributions' | 'diagnostics'
  >
}

function selectedProfile(configuration: ExtensionWorkspaceConfiguration, requested?: string) {
  const name = requested ?? configuration.activeProfile
  if (name !== undefined && configuration.profiles[name] === undefined) {
    fail('extension-manager/profile-missing', `profile «${name}» is not declared`, {
      profile: name,
    })
  }
  return Object.freeze({
    name,
    value: name === undefined ? undefined : configuration.profiles[name],
  })
}

function matchesSelection(id: string, patterns?: readonly string[]): boolean {
  if (patterns === undefined || patterns.length === 0) return true
  return patterns.some(pattern => {
    if (pattern === '*') return true
    if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1))
    return id === pattern
  })
}

function diagnostic(
  error: unknown,
  sourceId: string,
  path?: string,
): LocalExtensionCandidateDiagnostic {
  if (error instanceof ExtensionManagerError) {
    const resolvedPath = error.context['path'] ?? path
    return Object.freeze({
      severity: 'error',
      code: error.code,
      message: error.message,
      sourceId,
      ...(resolvedPath === undefined ? {} : { path: resolvedPath as string }),
    })
  }
  return Object.freeze({
    severity: 'error',
    code: 'extension-manager/local-discovery-failed',
    message: error instanceof Error ? error.message : String(error),
    sourceId,
    ...(path === undefined ? {} : { path }),
  })
}

async function optionalRepositoryMetadata(
  root: string,
  maxBytes: number,
  diagnostics: LocalExtensionCandidateDiagnostic[],
  sourceId: string,
): Promise<RepositoryMetadata> {
  const path = join(root, 'package.json')
  if (!existsSync(path)) return Object.freeze({})
  try {
    const value = (await boundedJson(path, maxBytes, 'repository package.json')) as Record<
      string,
      unknown
    >
    return Object.freeze({
      ...(optionalText(value['name']) === undefined
        ? {}
        : { packageName: optionalText(value['name']) }),
      ...(optionalText(value['displayName']) === undefined
        ? {}
        : { displayName: optionalText(value['displayName']) }),
      ...(optionalText(value['description']) === undefined
        ? {}
        : { summary: optionalText(value['description']) }),
      ...(optionalText(value['version']) === undefined
        ? {}
        : { version: optionalText(value['version']) }),
      ...(optionalText(value['license']) === undefined
        ? {}
        : { license: optionalText(value['license']) }),
      ...(optionalText(value['homepage']) === undefined
        ? {}
        : { homepage: optionalText(value['homepage']) }),
    }) as RepositoryMetadata
  } catch (error) {
    diagnostics.push(diagnostic(error, sourceId, path))
    return Object.freeze({})
  }
}

async function extensionCandidate(
  source: ExtensionSourceDescriptor,
  entry: RepositoryEntry,
  repositoryRoot: string,
  sourceSelected: boolean,
  profile: ExtensionWorkspaceConfiguration['profiles'][string] | undefined,
  limits: DiscoveryLimits,
): Promise<LocalExtensionCandidate> {
  let root
  let relativePath
  let embedded = false
  let packageJson
  if (entry.files !== undefined) {
    embedded = true
    packageJson = embeddedJson(
      entry.files,
      'package.json',
      limits.maxPackageBytes,
      'embedded extension package.json',
    )
  } else {
    relativePath = safeRelativePath(entry.path ?? '', 'extension path', true)
    const lexical = resolve(repositoryRoot, ...relativePath.split('/').filter(Boolean))
    if (!inside(repositoryRoot, lexical) || !existsSync(lexical)) {
      fail('extension-manager/extension-root-invalid', 'extension root is missing or unconfined', {
        sourceId: source.id,
        path: lexical,
      })
    }
    root = realpathSync(lexical)
    if (!inside(repositoryRoot, root) || !statSync(root).isDirectory()) {
      fail(
        'extension-manager/extension-root-invalid',
        'extension root is not a confined directory',
        {
          sourceId: source.id,
          path: root,
        },
      )
    }
    packageJson = await boundedJson(
      join(root, 'package.json'),
      limits.maxPackageBytes,
      'extension package.json',
    )
  }
  const metadata = packageMetadata(packageJson, entry.id, `extension in source «${source.id}»`)
  const inspected = await readContributions(
    root as string,
    entry.files,
    metadata.contributionManifests,
    source.id,
    limits,
  )
  const selected =
    sourceSelected && entry.enabled && matchesSelection(metadata.id, profile?.extensions)
  return Object.freeze({
    ...metadata,
    sourceId: source.id,
    sourcePublisher: source.publisher,
    enabled: entry.enabled,
    selected,
    embedded,
    ...(relativePath === undefined ? {} : { relativePath }),
    ...(root === undefined ? {} : { root }),
    contributions: inspected.contributions,
    diagnostics: inspected.diagnostics,
  }) as unknown as LocalExtensionCandidate
}

/**
 * Read the local repositories declared by the nearest Modkit workspace without loading extension
 * modules, materializing artifacts, traversing unrelated directories, or contacting a registry.
 */
export async function discoverLocalExtensionCandidates(
  options: LocalExtensionCandidateDiscoveryOptions = {},
): Promise<LocalExtensionCandidateDiscovery> {
  const environment = options.environment ?? process.env
  const maxWorkspaceBytes = boundedPositiveInteger(
    options.maxWorkspaceBytes,
    1024 * 1024,
    'maxWorkspaceBytes',
  )
  const configurationPath =
    options.configurationPath ??
    findLocalWorkspaceConfigurationSync(options.workspaceRoot ?? process.cwd(), environment)
  const loaded = loadLocalWorkspaceConfigurationSync(configurationPath, maxWorkspaceBytes)
  const profile = selectedProfile(loaded.configuration, options.profile)
  const limits = Object.freeze({
    maxSources: boundedPositiveInteger(options.maxSources, 64, 'maxSources'),
    maxExtensionsPerRepository: boundedPositiveInteger(
      options.maxExtensionsPerRepository,
      512,
      'maxExtensionsPerRepository',
    ),
    maxDescriptorBytes: boundedPositiveInteger(
      options.maxDescriptorBytes,
      1024 * 1024,
      'maxDescriptorBytes',
    ),
    maxPackageBytes: boundedPositiveInteger(
      options.maxPackageBytes,
      1024 * 1024,
      'maxPackageBytes',
    ),
    maxContributionManifests: boundedPositiveInteger(
      options.maxContributionManifests,
      512,
      'maxContributionManifests',
    ),
    maxContributionFileBytes: boundedPositiveInteger(
      options.maxContributionFileBytes,
      16 * 1024 * 1024,
      'maxContributionFileBytes',
    ),
    maxContributionBytes: boundedPositiveInteger(
      options.maxContributionBytes,
      64 * 1024 * 1024,
      'maxContributionBytes',
    ),
  })
  if (loaded.configuration.sources.length > limits.maxSources) {
    fail('extension-manager/source-limit', 'extension workspace has too many sources', {
      sources: loaded.configuration.sources.length,
      maxSources: limits.maxSources,
    })
  }

  const repositories = []
  const extensions = []
  const diagnostics = []
  for (const source of loaded.configuration.sources) {
    const uri = sourceUri(sourceValue(source, environment), loaded.path)
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') {
      diagnostics.push(
        Object.freeze({
          severity: 'info',
          code: 'extension-manager/non-local-source-skipped',
          message: `source «${source.id}» is not a local file repository`,
          sourceId: source.id,
          uri,
        }),
      )
      continue
    }
    let repositoryRoot
    try {
      const lexicalRoot = fileURLToPath(parsed)
      if (!existsSync(lexicalRoot)) {
        fail('extension-manager/repository-root-invalid', 'repository root is missing', {
          sourceId: source.id,
          path: lexicalRoot,
        })
      }
      repositoryRoot = realpathSync(lexicalRoot)
      if (!statSync(repositoryRoot).isDirectory()) {
        fail('extension-manager/repository-root-invalid', 'repository root must be a directory', {
          sourceId: source.id,
          path: repositoryRoot,
        })
      }
      const descriptor = safeRelativePath(
        source.descriptor ?? DEFAULT_DESCRIPTOR,
        `descriptor for source «${source.id}»`,
      )
      const lexicalDescriptor = resolve(repositoryRoot, ...descriptor.split('/'))
      if (!inside(repositoryRoot, lexicalDescriptor) || !existsSync(lexicalDescriptor)) {
        fail('extension-manager/repository-manifest-missing', 'repository manifest is missing', {
          sourceId: source.id,
          path: lexicalDescriptor,
        })
      }
      const descriptorPath = realpathSync(lexicalDescriptor)
      if (!inside(repositoryRoot, descriptorPath)) {
        fail('extension-manager/path-escape', 'repository manifest escapes its repository', {
          sourceId: source.id,
          path: descriptorPath,
        })
      }
      const manifest = normalizeRepositoryManifest(
        await boundedJson(descriptorPath, limits.maxDescriptorBytes, 'repository manifest'),
      )
      if (manifest.extensions.length > limits.maxExtensionsPerRepository) {
        fail('extension-manager/extension-limit', 'repository has too many extension entries', {
          sourceId: source.id,
          extensions: manifest.extensions.length,
          maxExtensions: limits.maxExtensionsPerRepository,
        })
      }
      const sourceSelected =
        source.enabled &&
        (profile.value?.sources === undefined || profile.value.sources.includes(source.id))
      const metadata = await optionalRepositoryMetadata(
        repositoryRoot,
        limits.maxPackageBytes,
        diagnostics,
        source.id,
      )
      const repositoryExtensions = []
      for (const entry of manifest.extensions) {
        try {
          const candidate = await extensionCandidate(
            source,
            entry,
            repositoryRoot,
            sourceSelected,
            profile.value,
            limits,
          )
          repositoryExtensions.push(candidate)
          extensions.push(candidate)
          diagnostics.push(...candidate.diagnostics)
        } catch (error) {
          diagnostics.push(diagnostic(error, source.id, repositoryRoot))
        }
      }
      repositoryExtensions.sort((left, right) => left.id.localeCompare(right.id))
      repositories.push(
        Object.freeze({
          sourceId: source.id,
          uri,
          root: repositoryRoot,
          descriptorPath,
          publisher: source.publisher,
          enabled: source.enabled,
          selected: sourceSelected,
          packageName: metadata.packageName,
          displayName: metadata.displayName ?? metadata.packageName ?? basename(repositoryRoot),
          summary: metadata.summary,
          version: metadata.version,
          license: metadata.license,
          homepage: metadata.homepage,
          extensions: Object.freeze(repositoryExtensions),
        }),
      )
    } catch (error) {
      diagnostics.push(diagnostic(error, source.id, repositoryRoot))
    }
  }

  repositories.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  extensions.sort((left, right) => left.id.localeCompare(right.id))
  const byId = new Map()
  for (const extension of extensions) {
    const previous = byId.get(extension.id)
    if (previous !== undefined) {
      diagnostics.push(
        Object.freeze({
          severity: 'error',
          code: 'extension-manager/extension-duplicate',
          message: `extension «${extension.id}» is declared by more than one local source`,
          sourceId: extension.sourceId,
          conflictingSourceId: previous.sourceId,
        }),
      )
    } else byId.set(extension.id, extension)
  }

  return Object.freeze({
    configurationPath: loaded.path,
    workspaceRoot: dirname(loaded.path),
    profile: profile.name,
    repositories: Object.freeze(repositories),
    extensions: Object.freeze(extensions),
    diagnostics: Object.freeze(diagnostics),
  }) as unknown as LocalExtensionCandidateDiscovery
}

function findLocalWorkspaceConfigurationSync(
  start = process.cwd(),
  environment: Environment = process.env,
): string {
  const explicit = environment['MODKIT_EXTENSION_WORKSPACE']
  if (explicit !== undefined && explicit.trim() !== '') {
    const path = resolve(explicit)
    if (!existsSync(path)) {
      fail('extension-manager/workspace-missing', `configured workspace «${path}» is missing`, {
        path,
      })
    }
    return path
  }
  let current = resolve(start)
  if (existsSync(current) && statSync(current).isFile()) current = dirname(current)
  for (;;) {
    const candidate = join(current, CONFIG_NAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  fail(
    'extension-manager/workspace-missing',
    `no ${CONFIG_NAME} exists at or above «${resolve(start)}»`,
    { start: resolve(start) },
  )
}

function loadLocalWorkspaceConfigurationSync(
  path: string,
  maxBytes: number,
): { readonly path: string; readonly configuration: ExtensionWorkspaceConfiguration } {
  const resolved = realpathSync(resolve(path))
  const info = statSync(resolved)
  if (!info.isFile() || info.size > maxBytes) {
    fail('extension-manager/byte-limit', 'extension workspace exceeds its byte limit', {
      path: resolved,
      bytes: info.size,
      maxBytes,
    })
  }
  let value
  try {
    value = JSON.parse(readFileSync(resolved, 'utf8'))
  } catch (cause) {
    fail(
      'extension-manager/json-invalid',
      `extension workspace «${path}» is not valid JSON`,
      {
        path,
      },
      cause,
    )
  }
  return Object.freeze({ path: resolved, configuration: normalizeWorkspaceConfiguration(value) })
}
