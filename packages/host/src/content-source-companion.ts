/**
 * Companions of a subject that lives in a content source (an installation tree, a storage): the
 * portable twin of the filesystem origin for a file on disk. A model opened from `local:earth-2160`
 * finds its skin and motions next to it (`sibling-directory`), a path from the source's root
 * (`current-mount`) and the assets of the container folder it sits in (`enclosing-container`) —
 * found by exact `ContentSources.lookup` where available, otherwise listed one folder at a time;
 * bytes come from `ContentSources.read`, with no recursive walk. Its mod's resources stay with `createContentAssetOrigin`
 * (`workspace-dependency-layer`), layered behind this origin.
 */

import type { Diagnostic } from '@modkit/core'
import { throwIfAborted } from '@modkit/core'
import {
  CODEC_CONTRIBUTION_CONTRACT,
  revisionIdFromRef,
  type ArtifactSource,
  type CodecContributionSpecV1Wire,
  type InputSearchScope,
  type Lease,
} from '@modkit/sdk'
import type { ContentSourceEntry, ContentSources } from '@modkit/vfs/content-sources'
import {
  createCompanionInputResolver,
  createLayeredCompanionOrigin,
  createSignatureTraitProbe,
  normalizeCompanionLogicalId,
  type CompanionEnumerationOptions,
  type CompanionOrigin,
  type CompanionOriginEntry,
} from './input-resolution.js'
import type { Inventory } from './inventory.js'
import { artifactByteSourceFromBytes } from './source-bridge.js'
import type { SubjectInputResolver } from './subject-open.js'
import { lookupExactContentSourceFile, normalizedContentSourcePath as normalized } from './content-source-exact-lookup.js'

/**
 * Extensions of the archive formats a namespace codec opens. A loose folder named like one of them
 * is that archive unpacked, so it bounds the `enclosing-container` companion scope too.
 */
export function containerExtensionsOf(inventory: Inventory): readonly string[] {
  const extensions = new Set<string>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT) continue
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
      if (spec.sourceTopology !== 'namespace' || spec.container === undefined) continue
      for (const value of spec.match.extensions ?? []) extensions.add(value.toLowerCase())
    }
  }
  return Object.freeze([...extensions].sort())
}

/** Per container extension, the asset directories its codec declares (first declaration wins). */
export function containerAssetRootsOf(
  inventory: Inventory,
): Readonly<Record<string, readonly string[]>> {
  const roots: Record<string, readonly string[]> = {}
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT) continue
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
      const assetRoots = spec.container?.assetRoots
      if (spec.sourceTopology !== 'namespace' || assetRoots === undefined) continue
      for (const value of spec.match.extensions ?? []) roots[value.toLowerCase()] ??= assetRoots
    }
  }
  return Object.freeze(roots)
}

/** Per marker file a container codec declares (`pack.mcmeta`), that container's asset directories. */
export function containerMarkersOf(
  inventory: Inventory,
): Readonly<Record<string, readonly string[]>> {
  const markers: Record<string, readonly string[]> = {}
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      // a codec that cannot activate (an invalid spec, switched off) marks nothing
      if (!contribution.activationEligible || manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT)
        continue
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
      if (spec.sourceTopology !== 'namespace') continue
      for (const marker of spec.container?.markers ?? [])
        markers[marker.toLowerCase()] ??= spec.container?.assetRoots ?? ['']
    }
  }
  return Object.freeze(markers)
}

export interface ContentSourceCompanionOriginOptions {
  readonly contentSources: Pick<ContentSources, 'list' | 'read' | 'lookup'>
  /** The subject: a file of one content source. */
  readonly target: { readonly sourceId: string; readonly path: string }
  /** As the filesystem origin takes them: {@link containerExtensionsOf} and its siblings. */
  readonly containerExtensions?: readonly string[]
  readonly containerAssetRoots?: Readonly<Record<string, readonly string[]>>
  readonly containerMarkers?: Readonly<Record<string, readonly string[]>>
  /** Largest companion read whole. Default 64 MiB, as the mod layers read theirs. */
  readonly maximumEntryBytes?: number
}

const join = (base: string, path: string): string =>
  base === '' ? path : path === '' ? base : `${base}/${path}`
const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const fold = (value: string): string => value.toLowerCase()

/**
 * The companions of a file in a content source. Content sources fold case, as installations and
 * storages do; ids of `sibling-directory` are relative to the file's folder, of `current-mount`
 * to the source's root, of `enclosing-container` to the container's asset directories.
 */
export function createContentSourceCompanionOrigin(
  options: ContentSourceCompanionOriginOptions,
): CompanionOrigin {
  const { contentSources } = options
  const { sourceId } = options.target
  const primary = normalized(options.target.path)
  if (primary === '') throw new TypeError('a content-source companion origin needs a file path')
  const maximumEntryBytes = options.maximumEntryBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(maximumEntryBytes) || maximumEntryBytes <= 0)
    throw new TypeError('maximumEntryBytes must be a positive safe integer')
  const directory = parentOf(primary)
  const list = async (path: string): Promise<readonly ContentSourceEntry[]> => {
    try {
      return await contentSources.list(sourceId, path)
    } catch {
      return [] // a folder the source does not have holds no companions
    }
  }
  // The nearest ancestor folder named like a container format, found without reading.
  const suffixes = (options.containerExtensions ?? []).map(extension => `.${fold(extension)}`)
  let named: string | undefined
  for (let current = directory; current !== ''; current = parentOf(current)) {
    const name = fold(nameOf(current))
    if (suffixes.some(suffix => name.endsWith(suffix) && name.length > suffix.length)) {
      named = current
      break
    }
  }
  const markers = options.containerMarkers ?? {}
  const markerNames = Object.keys(markers)
  /** The container and its asset directories that exist, in lookup order; found once. */
  let containerBases: Promise<readonly string[]> | undefined
  const bases = (): Promise<readonly string[]> =>
    (containerBases ??= (async () => {
      let container = named
      let patterns: readonly string[] | undefined
      if (container === undefined && markerNames.length > 0) {
        // ponytail: one listing per ancestor folder, only for codecs that declare marker files
        for (let current = directory; ; current = parentOf(current)) {
          const names = new Set((await list(current)).map(entry => fold(entry.name)))
          const marker = markerNames.find(file => names.has(fold(file)))
          if (marker !== undefined) {
            container = current
            patterns = markers[marker] ?? ['']
            break
          }
          if (current === '') break
        }
      }
      if (container === undefined) return []
      const containerName = fold(nameOf(container))
      patterns ??= Object.entries(options.containerAssetRoots ?? {}).find(([extension]) =>
        containerName.endsWith(`.${fold(extension)}`),
      )?.[1] ?? ['']
      const folders = (await list(container)).filter(entry => entry.directory)
      const found: string[] = []
      for (const pattern of patterns) {
        const names =
          pattern === ''
            ? [container]
            : pattern.startsWith('*')
              ? folders
                  .filter(entry => fold(entry.name).endsWith(fold(pattern.slice(1))))
                  .map(entry => join(container, entry.name))
                  .sort()
              : folders
                  .filter(entry => fold(entry.name) === fold(pattern))
                  .map(entry => join(container, entry.name))
        for (const base of names)
          if (!found.some(item => fold(item) === fold(base))) found.push(base)
      }
      return found
    })())
  /** The folder each id was last found in, for `open`. */
  const located = new Map<string, string>()

  async function* enumerateBase(
    base: string,
    scope: InputSearchScope,
    yielded: Set<string>,
    enumeration: CompanionEnumerationOptions,
    signal?: AbortSignal,
  ): AsyncIterable<CompanionOriginEntry> {
    throwIfAborted(signal)
    const prefix = enumeration.prefix.replaceAll('\\', '/')
    const parent = prefix.slice(0, prefix.lastIndexOf('/') + 1)
    if (enumeration.exactPath === true && contentSources.lookup !== undefined) {
      const requested = join(base, normalized(prefix))
      const entry = await lookupExactContentSourceFile(contentSources, sourceId, requested, signal)
      if (entry !== undefined && !entry.directory) {
        const canonical = entry.path
        const logicalId = base === '' ? canonical : canonical.slice(base.length + 1)
        if (
          scope === 'sibling-directory' ||
          (fold(canonical) !== fold(primary) && !yielded.has(fold(logicalId)))
        ) {
          if (scope !== 'sibling-directory') yielded.add(fold(logicalId))
          located.set(fold(logicalId), base)
          yield Object.freeze({
            logicalId,
            ...(entry.size === undefined ? {} : { size: BigInt(entry.size) }),
          })
        }
        return
      }
    }
    for (const entry of await list(join(base, normalized(parent)))) {
      throwIfAborted(signal)
      if (entry.directory) continue
      const logicalId = parent + entry.name
      // each exact request has its own prefix: unrelated names would spend the entry budget
      if (!fold(logicalId).startsWith(fold(prefix))) continue
      if (scope !== 'sibling-directory') {
        if (fold(join(base, logicalId)) === fold(primary) || yielded.has(fold(logicalId))) continue
        yielded.add(fold(logicalId))
      }
      located.set(fold(logicalId), base)
      yield Object.freeze({
        logicalId,
        ...(entry.size === undefined ? {} : { size: BigInt(entry.size) }),
      })
    }
  }

  return Object.freeze({
    primaryLogicalId: nameOf(primary),
    caseSensitivity: 'insensitive' as const,
    scopes: Object.freeze<InputSearchScope[]>([
      'sibling-directory',
      'current-mount',
      ...(named !== undefined || markerNames.length > 0 ? ['enclosing-container' as const] : []),
    ]),
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ): AsyncIterable<CompanionOriginEntry> {
      throwIfAborted(signal)
      const roots =
        scope === 'sibling-directory'
          ? [directory]
          : scope === 'current-mount'
            ? ['']
            : scope === 'enclosing-container'
              ? await bases()
              : []
      // asset directories overlay in order: the first spelling of an id wins
      const yielded = new Set<string>()
      for (const base of roots) yield* enumerateBase(base, scope, yielded, enumeration, signal)
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(signal)
      const id = normalizeCompanionLogicalId(logicalId)
      // ponytail: an id found in two scopes opens where it was found last
      const path = join(located.get(fold(id)) ?? directory, id)
      const bytes = await contentSources.read(sourceId, path, maximumEntryBytes)
      throwIfAborted(signal)
      const uri = `content-source://${encodeURIComponent(sourceId)}/${path.split('/').map(encodeURIComponent).join('/')}`
      const source = artifactByteSourceFromBytes(
        Object.freeze({ id: `${sourceId}:${path}`, uri }),
        revisionIdFromRef({
          kind: 'provider-token',
          value: `${sourceId}\0${path}\0${String(bytes.byteLength)}`,
        }),
        bytes,
      )
      return Object.freeze({ value: source, release: async () => undefined })
    },
  } satisfies CompanionOrigin)
}

export interface ContentSourceInputResolverOptions {
  readonly contentSources: Pick<ContentSources, 'list' | 'read' | 'lookup'>
  readonly target: { readonly sourceId: string; readonly path: string }
  /** The inventory the subject is resolved against: container scopes and `expected` traits. */
  readonly inventory: Inventory
  /** Behind the subject's own source, in precedence order: its mod's layers, mounted games. */
  readonly assetOrigins?: readonly CompanionOrigin[]
  readonly onDiagnostic?: (item: Diagnostic) => void
  /** Ceiling for the whole resolution, normally the open's own deadline. */
  readonly deadlineMs?: number
  readonly maximumEntryBytes?: number
}

/**
 * `createFilesystemInputResolver` for a subject in a content source: the source's own folders
 * first, then `assetOrigins` (pass `createContentAssetOrigin` for the subject's mod).
 */
export function createContentSourceInputResolver(
  options: ContentSourceInputResolverOptions,
): SubjectInputResolver {
  const own = createContentSourceCompanionOrigin({
    contentSources: options.contentSources,
    target: options.target,
    containerExtensions: containerExtensionsOf(options.inventory),
    containerAssetRoots: containerAssetRootsOf(options.inventory),
    containerMarkers: containerMarkersOf(options.inventory),
    ...(options.maximumEntryBytes === undefined
      ? {}
      : { maximumEntryBytes: options.maximumEntryBytes }),
  })
  return createCompanionInputResolver(
    options.assetOrigins === undefined || options.assetOrigins.length === 0
      ? own
      : createLayeredCompanionOrigin([own, ...options.assetOrigins]),
    {
      traitProbe: createSignatureTraitProbe(options.inventory),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
      ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    },
  )
}
