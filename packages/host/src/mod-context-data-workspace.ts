/** Read-only Data inputs projected from the game's authoritative ModContext. */
import {
  revisionId,
  isRevisionId,
  type ArtifactByteSource,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type ModWorkspaceGraphRoot,
  type ModWorkspaceLock,
  type ResourceSessionPort,
} from '@modkit/sdk'
import type { ModContext } from '@modkit/vfs/content-sources'
import {
  normalizeCompanionLogicalId,
  type CompanionEnumerationOptions,
  type CompanionOrigin,
} from './input-resolution.js'
import type { DataWorkspaceFileLister } from './data/index.js'
import { createResourceSession } from './resource-session.js'

const PAGE_SIZE = 4096
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

export interface ModContextDataWorkspaceInputs {
  readonly workspace: ModWorkspaceLock
  readonly resources: ResourceSessionPort
  /** Lists a root's files through the context, for the provider's listing queries. */
  readonly listFiles: DataWorkspaceFileLister
}

export interface ModContextNestedRoot {
  /** Existing package layer whose listed directory contains another package (for example a map in a campaign). */
  readonly parentLayerId: string
  /** Layer-relative confined directory of the nested package. */
  readonly path: string
}

/**
 * The context owns dependency resolution and package reads. This adapter only gives the existing
 * Data analyzer its historical lock/resource-port shape; it never resolves dependencies itself.
 * The caller owns both the context and the returned resource session.
 */
export function createModContextDataWorkspaceInputs(
  context: ModContext,
  options?: { readonly nestedRoot?: ModContextNestedRoot },
): ModContextDataWorkspaceInputs {
  if (context.schemaVersion !== 1 || context.layers.length === 0 || context.layers.length > 256) {
    throw new TypeError('Data workspace requires a nonempty ModContext v1')
  }
  const ids = new Set<string>()
  const prefixes = new Set<string>()
  const layers = context.layers.map((layer, index) => {
    if (ids.has(layer.id)) throw new TypeError(`duplicate ModContext layer ${layer.id}`)
    ids.add(layer.id)
    // Host paths are absolute; keep the real address in source.location and give the resource
    // plane a confined logical prefix. Content-source paths remain native provenance paths.
    const rawPrefix =
      layer.sourcePath === '' || /^[a-z]:[\\/]|^[\\/]/iu.test(layer.sourcePath)
        ? `context-layers/${index}`
        : layer.sourcePath
    const prefix = normalizeCompanionLogicalId(rawPrefix)
    if (prefixes.has(prefix.toLowerCase())) {
      throw new TypeError(`ambiguous ModContext layer path ${prefix}`)
    }
    prefixes.add(prefix.toLowerCase())
    const revision =
      layer.fingerprint !== undefined && isRevisionId(layer.fingerprint)
        ? revisionId(layer.fingerprint)
        : revisionId(`provider-token:${encodeURIComponent(`${context.contextId}/${layer.id}`)}`)
    return { layer, prefix, revision, readLayerId: layer.id, readPrefix: '' }
  })
  if (options?.nestedRoot !== undefined) {
    const parent = layers.find(item => item.layer.id === options.nestedRoot?.parentLayerId)
    if (parent === undefined) throw new TypeError('nested ModContext root has no parent layer')
    const readPrefix = normalizeCompanionLogicalId(options.nestedRoot.path)
    const prefix = `${parent.prefix}/${readPrefix}`
    if (prefixes.has(prefix.toLowerCase()))
      throw new TypeError(`ambiguous ModContext nested path ${prefix}`)
    const layer = Object.freeze({
      id: `${parent.layer.id}:${readPrefix}`,
      sourceId: parent.layer.sourceId,
      sourcePath: prefix,
      displayName: readPrefix.split('/').at(-1)!,
      role: 'primary' as const,
      provenance: 'opened' as const,
      ...(parent.layer.fingerprint === undefined ? {} : { fingerprint: parent.layer.fingerprint }),
    })
    layers.push({
      layer,
      prefix,
      revision: parent.revision,
      readLayerId: parent.layer.id,
      readPrefix,
    })
  }
  if (context.unresolved.length > 0) {
    throw new TypeError(`ModContext has unresolved dependencies: ${context.unresolved.join(', ')}`)
  }
  const roots: readonly ModWorkspaceGraphRoot[] = Object.freeze(
    layers.map(({ layer, prefix }) =>
      Object.freeze({
        rootId: layer.id,
        sourceId: layer.sourceId,
        sourcePath: prefix,
        displayName: layer.displayName,
        kind: layer.role,
        ...(layer.fingerprint === undefined ? {} : { fingerprint: layer.fingerprint }),
        dependencies: Object.freeze([]),
      }),
    ),
  )
  const active = roots.at(-1)!
  const sourceIds = new Set<string>()
  const sources = Object.freeze(
    layers.flatMap(({ layer }) => {
      if (sourceIds.has(layer.sourceId)) return []
      sourceIds.add(layer.sourceId)
      return [
        Object.freeze({
          sourceId: layer.sourceId,
          kind: 'mod-context',
          location: layer.sourcePath,
        }),
      ]
    }),
  )
  const workspace: ModWorkspaceLock = Object.freeze({
    schemaVersion: 1,
    workspaceId: context.contextId,
    gameId: context.gameId,
    activeRootId: active.rootId,
    sources,
    loadOrder: roots,
    dependencyOrder: Object.freeze(roots.slice(0, -1)),
    logicalRoots: Object.freeze([...roots].reverse()),
    diagnostics: Object.freeze([]),
    complete: true,
  })
  const find = (logicalId: string) => {
    const wanted = logicalId.toLowerCase()
    for (const item of [...layers].reverse()) {
      const prefix = item.prefix.toLowerCase()
      if (wanted.startsWith(`${prefix}/`)) {
        return { ...item, relative: logicalId.slice(item.prefix.length + 1) }
      }
    }
    return undefined
  }
  const origin: CompanionOrigin = Object.freeze({
    primaryLogicalId: '__mod_context_data_workspace__',
    caseSensitivity: 'insensitive',
    scopes: Object.freeze(['workspace-dependency-layer'] as const),
    async *enumerate(
      scope: InputSearchScope,
      options: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ) {
      if (scope !== 'workspace-dependency-layer') return
      const prefix = options.prefix === '' ? '' : normalizeCompanionLogicalId(options.prefix)
      for (const item of [...layers].reverse()) {
        signal?.throwIfAborted()
        const root = item.prefix.toLowerCase()
        const wanted = prefix.toLowerCase()
        if (
          wanted !== '' &&
          !wanted.startsWith(`${root}/`) &&
          wanted !== root &&
          !root.startsWith(wanted)
        )
          continue
        const relativePrefix = wanted.startsWith(`${root}/`)
          ? prefix.slice(item.prefix.length + 1)
          : ''
        let cursor: string | undefined
        do {
          const page = await context.files(item.readLayerId, {
            limit: PAGE_SIZE,
            prefix: [item.readPrefix, relativePrefix].filter(Boolean).join('/'),
            ...(cursor === undefined ? {} : { cursor }),
          })
          for (const relative of page.items) {
            signal?.throwIfAborted()
            const nativePath = normalizeCompanionLogicalId(relative)
            if (
              item.readPrefix !== '' &&
              !nativePath.toLowerCase().startsWith(`${item.readPrefix.toLowerCase()}/`)
            )
              continue
            const logicalId = `${item.prefix}/${
              item.readPrefix === '' ? nativePath : nativePath.slice(item.readPrefix.length + 1)
            }`
            if (logicalId.toLowerCase().startsWith(wanted)) {
              yield { logicalId, rootId: item.layer.id }
            }
          }
          cursor = page.nextCursor
        } while (cursor !== undefined)
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      signal?.throwIfAborted()
      const normalized = normalizeCompanionLogicalId(logicalId)
      const item = find(normalized)
      if (item === undefined) throw new RangeError(`ModContext has no layer for ${normalized}`)
      const bytes = await context.read(
        item.readLayerId,
        [item.readPrefix, item.relative].filter(Boolean).join('/'),
        MAX_ENTRY_BYTES,
      )
      const uri = `mod-context://${encodeURIComponent(context.contextId)}/${encodeURIComponent(item.layer.id)}/${item.relative.split('/').map(encodeURIComponent).join('/')}`
      const source: ArtifactByteSource = Object.freeze({
        kind: 'bytes',
        ref: Object.freeze({ id: uri, uri }),
        revision: item.revision,
        size: BigInt(bytes.byteLength),
        async read(offset: bigint, length: number, readSignal?: AbortSignal) {
          readSignal?.throwIfAborted()
          if (
            offset < 0n ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            offset + BigInt(length) > BigInt(bytes.byteLength)
          ) {
            throw new RangeError('ModContext read outside file')
          }
          return bytes.slice(Number(offset), Number(offset) + length)
        },
        async *stream(
          range?: { readonly offset: bigint; readonly length?: bigint },
          streamSignal?: AbortSignal,
        ) {
          streamSignal?.throwIfAborted()
          const start = range === undefined ? 0 : Number(range.offset)
          const end = range?.length === undefined ? bytes.byteLength : start + Number(range.length)
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end > bytes.byteLength ||
            end < start
          ) {
            throw new RangeError('ModContext stream outside file')
          }
          yield bytes.slice(start, end)
        },
      })
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
  const listFiles: DataWorkspaceFileLister = async (rootId, prefix, maximum, signal) => {
    const item = layers.find(candidate => candidate.layer.id === rootId)
    if (item === undefined) throw new RangeError(`ModContext has no layer ${rootId}`)
    const wanted = prefix === '' ? '' : normalizeCompanionLogicalId(prefix)
    const paths: string[] = []
    let cursor: string | undefined
    do {
      signal?.throwIfAborted()
      const page = await context.files(item.readLayerId, {
        limit: PAGE_SIZE,
        prefix: [item.readPrefix, wanted].filter(Boolean).join('/'),
        ...(cursor === undefined ? {} : { cursor }),
      })
      for (const native of page.items) {
        const path = normalizeCompanionLogicalId(native)
        const relative = item.readPrefix === '' ? path : path.slice(item.readPrefix.length + 1)
        if (paths.length === maximum) return { paths, complete: false }
        paths.push(relative)
      }
      cursor = page.nextCursor
    } while (cursor !== undefined)
    return { paths, complete: true }
  }
  return Object.freeze({
    workspace,
    listFiles,
    resources: createResourceSession({
      origin,
      revision: revisionId(`provider-token:${encodeURIComponent(context.contextId)}`),
      revisionPolicy: 'pin',
    }),
  })
}
