import { revisionIdFromRef } from '@modkit/sdk'
import type {
  ContentDependencyRequest,
  ContentDependencyResolution,
  ContentSourceEntry,
  ContentSources,
} from '@modkit/vfs/content-sources'

import { normalizeEntryPath } from './container-uri.js'
import type { ContainerRegistry } from './containers.js'

interface InstallationDependency {
  readonly id: string
  readonly kind: 'installation-mod'
  readonly required: boolean
  readonly order: number
  readonly state: 'unresolved'
  readonly path: string
  readonly [key: string]: unknown
}

function installationDependency(value: unknown): InstallationDependency | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Readonly<Record<string, unknown>>
  return item['kind'] === 'installation-mod' &&
    typeof item['id'] === 'string' &&
    item['id'].length > 0 &&
    typeof item['required'] === 'boolean' &&
    Number.isSafeInteger(item['order']) &&
    typeof item['path'] === 'string' &&
    item['path'].length > 0 &&
    item['state'] === 'unresolved'
    ? (value as InstallationDependency)
    : undefined
}

const joinPath = (parent: string, name: string): string =>
  parent === '' ? name : `${parent}/${name}`

const PACKAGE_LANGUAGE_ROOTS = Object.freeze(
  new Set(['gamedata', 'scripts', 'triggerlibs', 'triggers', 'ui']),
)
const PACKAGE_LANGUAGE_EXTENSIONS = Object.freeze(
  new Set([
    'blizwiz',
    'galaxy',
    'json',
    'sc2components',
    'sc2layout',
    'sc2style',
    'sc2triggers',
    'txt',
    'version',
    'xml',
  ]),
)

const extensionOf = (name: string): string =>
  name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : ''

/**
 * Add the current container as an installation dependency source.
 *
 * An installed game's `Mods/*.SC2Mod` commonly live only in CASC. The desktop content provider
 * deliberately sees ordinary files and therefore cannot resolve those paths. This adapter keeps
 * the standard ContentSources contract and lets its existing resolver handle every dependency
 * that is not a directory in the current container.
 */
export function createContainerDependencyContentSources(
  base: ContentSources,
  containers: Pick<ContainerRegistry, 'list' | 'read' | 'stat' | 'walk'>,
  container: string,
): ContentSources {
  const sourceId = `modkit-container:${encodeURIComponent(container)}`

  const list = async (id: string, path: string): Promise<readonly ContentSourceEntry[]> => {
    if (id !== sourceId) return base.list(id, path)
    const normalized = normalizeEntryPath(path)
    if (/\.(?:sc2mod|sc2map|sc2campaign)$/iu.test(normalized)) {
      const output: ContentSourceEntry[] = []
      let remaining = 65_537
      const children = await containers.list(container, normalized)
      for (const item of children) {
        if (remaining <= 0) break
        const folded = item.name.toLowerCase()
        if (item.kind === 'file') {
          if (!PACKAGE_LANGUAGE_EXTENSIONS.has(extensionOf(item.name))) continue
          output.push(
            Object.freeze({
              path: joinPath(normalized, item.name),
              name: item.name,
              directory: false,
              ...(item.size === undefined ? {} : { size: item.size }),
            }),
          )
          remaining -= 1
          continue
        }
        if (
          folded !== 'base.sc2data' &&
          folded !== 'enus.sc2data' &&
          !PACKAGE_LANGUAGE_ROOTS.has(folded)
        ) {
          continue
        }
        const branch = joinPath(normalized, item.name)
        const entries = await containers.walk(container, branch, remaining)
        for (const entry of entries) {
          output.push(
            Object.freeze({
              path: normalizeEntryPath(entry.path),
              name: entry.name,
              directory: false,
              ...(entry.size === undefined ? {} : { size: Number(entry.size) }),
            }),
          )
        }
        remaining -= entries.length
      }
      return Object.freeze(output)
    }
    return Object.freeze(
      (await containers.list(container, normalized)).map(item =>
        Object.freeze({
          path: joinPath(normalized, item.name),
          name: item.name,
          directory: item.kind === 'directory',
          ...(item.size === undefined ? {} : { size: item.size }),
        }),
      ),
    )
  }

  const read = async (id: string, path: string, maximum: number): Promise<Uint8Array> => {
    if (id !== sourceId) return base.read(id, path, maximum)
    const normalized = normalizeEntryPath(path)
    const entry = await containers.stat(container, normalized)
    if (entry.kind !== 'file') throw new RangeError(`${normalized} is not a file`)
    if (entry.size !== undefined && entry.size > maximum) {
      throw new RangeError(`${normalized} exceeds the content read limit`)
    }
    const bytes = await containers.read(container, normalized)
    if (bytes.byteLength > maximum)
      throw new RangeError(`${normalized} exceeds the content read limit`)
    return bytes
  }

  const resolveDependencies = async (
    request: ContentDependencyRequest,
  ): Promise<ContentDependencyResolution> => {
    const local: InstallationDependency[] = []
    const delegated: unknown[] = []
    for (const value of request.dependencies) {
      const dependency = installationDependency(value)
      if (dependency === undefined) {
        delegated.push(value)
        continue
      }
      try {
        const entry = await containers.stat(container, normalizeEntryPath(dependency.path))
        if (entry.kind !== 'directory') throw new RangeError('dependency is not a directory')
        local.push(dependency)
      } catch {
        delegated.push(value)
      }
    }

    const resolvedByBase =
      delegated.length === 0
        ? Object.freeze({
            schemaVersion: 1 as const,
            gameId: request.gameId,
            complete: request.complete,
            mounts: Object.freeze([]),
            dependencies: Object.freeze([]),
            diagnostics: Object.freeze([]),
          })
        : base.resolveDependencies === undefined
          ? Object.freeze({
              schemaVersion: 1 as const,
              gameId: request.gameId,
              complete: false,
              mounts: Object.freeze([]),
              dependencies: Object.freeze([]),
              diagnostics: Object.freeze([
                Object.freeze({
                  code: 'x3.app/vscode-content-dependency-resolver-unavailable',
                  severity: 'warning',
                  message:
                    'the configured content source cannot resolve dependencies outside the current container',
                }),
              ]),
            })
          : await base.resolveDependencies(
              Object.freeze({ ...request, dependencies: Object.freeze(delegated) }),
            )

    let order = resolvedByBase.mounts.reduce(
      (maximum, mount) => Math.max(maximum, mount.order + 1),
      0,
    )
    const mounts = local
      .sort((left, right) => left.order - right.order)
      .map(dependency => {
        const path = normalizeEntryPath(dependency.path)
        return Object.freeze({
          dependencyId: dependency.id,
          order: order++,
          sourceId,
          sourcePath: path,
          displayName: path.slice(path.lastIndexOf('/') + 1),
          kind: 'installation-mod',
          fingerprint: revisionIdFromRef({
            kind: 'provider-token',
            value: `${sourceId}\0${path}`,
          }),
        })
      })
    const dependencies = local.map(dependency =>
      Object.freeze({
        ...dependency,
        state: 'resolved' as const,
        sourceId,
        sourcePath: normalizeEntryPath(dependency.path),
      }),
    )
    return Object.freeze({
      schemaVersion: 1,
      gameId: request.gameId,
      complete: resolvedByBase.complete,
      mounts: Object.freeze([...resolvedByBase.mounts, ...mounts]),
      dependencies: Object.freeze([...resolvedByBase.dependencies, ...dependencies]),
      diagnostics: Object.freeze([...resolvedByBase.diagnostics]),
    })
  }

  return Object.freeze({
    snapshot: () => base.snapshot(),
    connect: (region: string, accountId?: string) => base.connect(region, accountId),
    disconnect: (connectionId: string) => base.disconnect(connectionId),
    search: (connectionId: string, name: string) => base.search(connectionId, name),
    add: (resultId: string) => base.add(resultId),
    remove: (id: string, path: string) => base.remove(id, path),
    refresh: (id: string) => base.refresh(id),
    list,
    read,
    ...(base.preparePublish === undefined
      ? {}
      : {
          preparePublish: (connectionId: string, filePath: string, packagePath: string) =>
            base.preparePublish!(connectionId, filePath, packagePath),
        }),
    ...(base.publish === undefined
      ? {}
      : { publish: (reviewId: string) => base.publish!(reviewId) }),
    ...(base.deletionCandidates === undefined
      ? {}
      : { deletionCandidates: (connectionId: string) => base.deletionCandidates!(connectionId) }),
    ...(base.deletePublication === undefined
      ? {}
      : { deletePublication: (reviewId: string) => base.deletePublication!(reviewId) }),
    ...(base.download === undefined
      ? {}
      : { download: (id: string, path: string) => base.download!(id, path) }),
    ...(base.clearCache === undefined
      ? {}
      : { clearCache: (id: string, path: string) => base.clearCache!(id, path) }),
    ...(base.prepareDeletePublication === undefined
      ? {}
      : {
          prepareDeletePublication: (id: string, path: string) =>
            base.prepareDeletePublication!(id, path),
        }),
    ...(base.resolveLocalPath === undefined
      ? {}
      : { resolveLocalPath: (id: string, path: string) => base.resolveLocalPath!(id, path) }),
    resolveDependencies,
    ...(base.languageMounts === undefined ? {} : { languageMounts: () => base.languageMounts!() }),
    dispose: () => undefined,
  })
}
