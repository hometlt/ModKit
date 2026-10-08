import { normalizeModkitIdentifier, normalizeModkitSourceIdentifier } from '@modkit/sdk'
import type {
  ExtensionRepositoryManifest,
  ExtensionSourceDescriptor,
  ExtensionWorkspaceConfiguration,
} from './public-types.js'

type UnknownRecord = Record<string, unknown>

interface WorkspaceInput extends UnknownRecord {
  schemaVersion?: unknown
  sources?: unknown
  profiles?: unknown
  activeProfile?: unknown
  lockFile?: unknown
  legacyPaths?: unknown
}

interface SourceInput extends UnknownRecord {
  id?: unknown
  uri?: unknown
  environment?: unknown
  descriptor?: unknown
  publisher?: unknown
  enabled?: unknown
  prefix?: unknown
  source?: unknown
  strip?: unknown
  path?: unknown
  files?: unknown
  version?: unknown
  digest?: unknown
}

interface ProfileInput extends UnknownRecord {
  sources?: unknown
  extensions?: unknown
  locked?: unknown
}

interface ManifestInput extends UnknownRecord {
  schemaVersion?: unknown
  extensions?: unknown
  subjects?: unknown
  blobs?: unknown
}

const SOURCE_ID = /^[a-z0-9][a-z0-9._-]*$/i
const EXTENSION_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i
const REPOSITORY_JSON_PATH =
  /^(?:\.\/)?(?![A-Za-z]:)(?!\\)(?!.*\\)(?!.*\u0000)(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/]+(?:\/[^/]+)*\.json$/u

export class ExtensionManagerError extends Error {
  declare readonly code: string
  declare readonly context: Readonly<UnknownRecord>

  constructor(
    code: string,
    message: string,
    context: Readonly<UnknownRecord> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ExtensionManagerError'
    this.code = code
    this.context = Object.freeze({ ...context })
  }
}

function fail(code: string, message: string, context?: Readonly<UnknownRecord>): never {
  throw new ExtensionManagerError(code, message, context)
}

function object<T extends UnknownRecord = UnknownRecord>(value: unknown, label: string): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('extension-manager/schema-invalid', `${label} must be an object`)
  }
  return value as T
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('extension-manager/schema-invalid', `${label} must be a non-empty string`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : text(value, label)
}

function base64Text(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    fail('extension-manager/schema-invalid', `${label} must be a string`)
  }
  return value
}

function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail('extension-manager/schema-invalid', `${label} must be a list`)
  return Object.freeze(
    value.map((item: unknown, index: number) => text(item, `${label}[${index}]`)),
  )
}

function repositorySubjectPaths(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([])
  const paths = stringList(value, label)
  if (paths.length > 64) {
    fail('extension-manager/schema-invalid', `${label} must not contain more than 64 paths`)
  }
  const seen = new Set<string>()
  return Object.freeze(
    paths.map((path, index) => {
      if (path.length > 512 || !REPOSITORY_JSON_PATH.test(path)) {
        fail(
          'extension-manager/schema-invalid',
          `${label}[${index}] must be a confined repository-relative JSON path`,
        )
      }
      const normalized = path.startsWith('./') ? path.slice(2) : path
      if (seen.has(normalized)) {
        fail('extension-manager/schema-invalid', `${label} contains duplicate «${normalized}»`)
      }
      seen.add(normalized)
      return normalized
    }),
  )
}

export function normalizeWorkspaceConfiguration(value: unknown): ExtensionWorkspaceConfiguration {
  const input = object<WorkspaceInput>(value, 'workspace configuration')
  if (input.schemaVersion !== 1) {
    fail('extension-manager/schema-version-unsupported', 'workspace schemaVersion must be 1')
  }
  if (!Array.isArray(input.sources)) {
    fail('extension-manager/schema-invalid', 'workspace sources must be a list')
  }
  const ids = new Set<string>()
  const sources: ExtensionSourceDescriptor[] = input.sources.map((raw: unknown, index: number) => {
    const source = object<SourceInput>(raw, `sources[${index}]`)
    const id = normalizeModkitSourceIdentifier(text(source.id, `sources[${index}].id`))
    if (!SOURCE_ID.test(id))
      fail('extension-manager/source-id-invalid', `invalid source id «${id}»`)
    if (ids.has(id)) fail('extension-manager/source-duplicate', `source «${id}» is duplicated`)
    ids.add(id)
    return Object.freeze({
      id,
      uri: text(source.uri, `sources[${index}].uri`),
      ...(source.environment === undefined
        ? {}
        : {
            environment: text(source.environment, `sources[${index}].environment`),
          }),
      ...(source.descriptor === undefined
        ? {}
        : {
            descriptor: text(source.descriptor, `sources[${index}].descriptor`),
          }),
      ...(source.publisher === undefined
        ? {}
        : { publisher: text(source.publisher, `sources[${index}].publisher`) }),
      enabled: source.enabled !== false,
    })
  })

  const profiles: Record<string, ExtensionWorkspaceConfiguration['profiles'][string]> = {}
  if (input.profiles !== undefined) {
    const rawProfiles = object(input.profiles, 'profiles')
    for (const [name, raw] of Object.entries(rawProfiles)) {
      const profile = object<ProfileInput>(raw, `profiles.${name}`)
      profiles[name] = Object.freeze({
        ...(profile.sources === undefined
          ? {}
          : {
              sources: Object.freeze(
                stringList(profile.sources, `profiles.${name}.sources`).map(source =>
                  normalizeModkitSourceIdentifier(source),
                ),
              ),
            }),
        ...(profile.extensions === undefined
          ? {}
          : {
              extensions: Object.freeze(
                stringList(profile.extensions, `profiles.${name}.extensions`).map(extension =>
                  extension === '*' ? extension : normalizeModkitIdentifier(extension),
                ),
              ),
            }),
        locked: profile.locked === true,
      })
    }
  }
  const activeProfile = optionalText(input.activeProfile, 'activeProfile')
  if (activeProfile !== undefined && profiles[activeProfile] === undefined) {
    fail('extension-manager/profile-missing', `active profile «${activeProfile}» is not declared`)
  }

  const legacyPaths: { prefix: readonly string[]; source: string; strip?: number | undefined }[] =
    []
  if (input.legacyPaths !== undefined) {
    if (!Array.isArray(input.legacyPaths)) {
      fail('extension-manager/schema-invalid', 'legacyPaths must be a list')
    }
    for (const [index, raw] of input.legacyPaths.entries()) {
      const entry = object<SourceInput>(raw, `legacyPaths[${index}]`)
      legacyPaths.push(
        Object.freeze({
          prefix: stringList(entry.prefix, `legacyPaths[${index}].prefix`),
          source: normalizeModkitSourceIdentifier(
            text(entry.source, `legacyPaths[${index}].source`),
          ),
          strip:
            Number.isInteger(entry.strip) && (entry.strip as number) >= 0
              ? (entry.strip as number)
              : undefined,
        }),
      )
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    sources: Object.freeze(sources),
    profiles: Object.freeze(profiles),
    ...(activeProfile === undefined ? {} : { activeProfile }),
    ...(input.lockFile === undefined ? {} : { lockFile: text(input.lockFile, 'lockFile') }),
    legacyPaths: Object.freeze(legacyPaths),
  })
}

/** Resolve compact file references without decoding bytes; installation still checks every file. */
export function normalizeRepositoryManifest(value: unknown): ExtensionRepositoryManifest {
  const input = object<ManifestInput>(value, 'repository manifest')
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    fail('extension-manager/schema-version-unsupported', 'repository schemaVersion must be 1 or 2')
  }
  const compact = input.schemaVersion === 2
  if (compact && !Array.isArray(input.blobs))
    fail('extension-manager/schema-invalid', 'compact repository blobs must be a list')
  const blobs = compact
    ? (input.blobs as unknown[]).map((blob, index) => base64Text(blob, `blobs[${index}]`))
    : []
  const fileContent = (encoded: unknown, label: string): string => {
    if (!compact) return base64Text(encoded, label)
    if (
      typeof encoded !== 'number' ||
      !Number.isSafeInteger(encoded) ||
      encoded < 0 ||
      encoded >= blobs.length
    ) {
      fail('extension-manager/schema-invalid', `${label} must reference an existing blob`)
    }
    return blobs[encoded] as string
  }
  if (!Array.isArray(input.extensions)) {
    fail('extension-manager/schema-invalid', 'repository extensions must be a list')
  }
  const ids = new Set<string>()
  const extensions: ExtensionRepositoryManifest['extensions'][number][] = input.extensions.map(
    (raw: unknown, index: number) => {
      const entry = object<SourceInput>(raw, `extensions[${index}]`)
      const rawId = optionalText(entry.id, `extensions[${index}].id`)
      const id = rawId === undefined ? undefined : normalizeModkitIdentifier(rawId)
      if (id !== undefined && !EXTENSION_ID.test(id)) {
        fail('extension-manager/extension-id-invalid', `invalid extension id «${id}»`)
      }
      if (id !== undefined && ids.has(id)) {
        fail('extension-manager/extension-duplicate', `extension «${id}» is duplicated`)
      }
      if (id !== undefined) ids.add(id)
      const path = optionalText(entry.path, `extensions[${index}].path`)
      let files
      if (entry.files !== undefined) {
        const rawFiles = object(entry.files, `extensions[${index}].files`)
        files = Object.freeze(
          Object.fromEntries(
            Object.entries(rawFiles).map(([name, encoded]) => [
              text(name, `extensions[${index}].files key`),
              fileContent(encoded, `extensions[${index}].files.${name}`),
            ]),
          ),
        )
      }
      if (path === undefined && files === undefined) {
        fail(
          'extension-manager/schema-invalid',
          `extensions[${index}] must declare path or embedded files`,
        )
      }
      return Object.freeze({
        ...(id === undefined ? {} : { id }),
        ...(path === undefined ? {} : { path }),
        ...(files === undefined ? {} : { files }),
        enabled: entry.enabled !== false,
      })
    },
  )
  let subjects
  if (input.subjects !== undefined) {
    const rawSubjects = object(input.subjects, 'repository subjects')
    const vendors = repositorySubjectPaths(rawSubjects['vendors'], 'subjects.vendors')
    const games = repositorySubjectPaths(rawSubjects['games'], 'subjects.games')
    subjects = Object.freeze({ vendors, games })
  }
  return Object.freeze({
    schemaVersion: 1,
    extensions: Object.freeze(extensions),
    ...(subjects === undefined ? {} : { subjects }),
  })
}

/** Encode identical file bytes once; consumers normalize v2 to the same v1 installation model. */
export function compactRepositoryManifest(value: unknown): Readonly<{
  schemaVersion: 2
  blobs: readonly string[]
  extensions: readonly Readonly<{
    id?: string
    path?: string
    enabled: boolean
    files?: Readonly<Record<string, number>>
  }>[]
  subjects?: ExtensionRepositoryManifest['subjects']
}> {
  const manifest = normalizeRepositoryManifest(value)
  const blobs: string[] = []
  const indexes = new Map<string, number>()
  const extensions = manifest.extensions.map(entry => {
    const metadata = {
      ...(entry.id === undefined ? {} : { id: entry.id }),
      ...(entry.path === undefined ? {} : { path: entry.path }),
      enabled: entry.enabled,
    }
    if (entry.files === undefined) return Object.freeze(metadata)
    const files = Object.fromEntries(
      Object.entries(entry.files).map(([path, bytes]) => {
        let index = indexes.get(bytes)
        if (index === undefined) {
          index = blobs.length
          indexes.set(bytes, index)
          blobs.push(bytes)
        }
        return [path, index]
      }),
    )
    return Object.freeze({ ...metadata, files: Object.freeze(files) })
  })
  return Object.freeze({
    schemaVersion: 2,
    blobs: Object.freeze(blobs),
    extensions: Object.freeze(extensions),
    ...(manifest.subjects === undefined ? {} : { subjects: manifest.subjects }),
  })
}

export function normalizeExtensionLock(value: unknown): unknown {
  const input = object<ManifestInput>(value, 'extension lock')
  if (input.schemaVersion !== 1) {
    fail('extension-manager/schema-version-unsupported', 'lock schemaVersion must be 1')
  }
  if (!Array.isArray(input.extensions)) {
    fail('extension-manager/schema-invalid', 'lock extensions must be a list')
  }
  const ids = new Set<string>()
  const extensions = input.extensions.map((raw: unknown, index: number) => {
    const entry = object<SourceInput>(raw, `extensions[${index}]`)
    const id = normalizeModkitIdentifier(text(entry.id, `extensions[${index}].id`))
    if (!EXTENSION_ID.test(id))
      fail('extension-manager/extension-id-invalid', `invalid lock id «${id}»`)
    if (ids.has(id))
      fail('extension-manager/extension-duplicate', `extension «${id}» is duplicated`)
    ids.add(id)
    return Object.freeze({
      id,
      source: normalizeModkitSourceIdentifier(text(entry.source, `extensions[${index}].source`)),
      version: text(entry.version, `extensions[${index}].version`),
      digest: text(entry.digest, `extensions[${index}].digest`).toLowerCase(),
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    extensions: Object.freeze(extensions),
  })
}
