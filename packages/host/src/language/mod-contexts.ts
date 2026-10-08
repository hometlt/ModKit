/**
 * The loaded mods' servers a language workspace reads (owner decision 07.10: the loader's
 * ModContext is the one holder of a mod's data for languages, Resources, wiki, cards and Runtime).
 *
 * A host opens one mod context per subject (`resolveContentLanguageSources` with `keepContexts`)
 * and hands them here; they stay open while the workspace lives. This registry:
 * - places a document by its URI in the chain that holds it (`placeOf`): a file on the host's disk
 *   under a layer's host path, or a content-source file under a layer's source path;
 * - brings the editor's open buffers to the server before a request reads it (`synchronize`): the
 *   unsaved text of a file on the host's disk goes over that file (`ModContext.overlay`); a buffer
 *   equal to the file on disk is not sent; a buffer that is gone takes its text away (`release`);
 * - carries a provider's questions to the server (`query`) and completes the files the answer
 *   names (`documents: [{ layerId, path }]`) with the URI the workspace uses for them, so a
 *   provider never builds one;
 * - tells every server that files changed on disk (`invalidate`), lets each build what its first
 *   question needs ahead of it (`prepare`), and closes them (`dispose`).
 *
 * URIs: by default a `file:` URI names a host path and a `content-source://<source>/<path>` URI a
 * path in a content source; an application with its own schemes (VS Code's `modkit-source:`) gives
 * `targetOf` and `uriOf`. Content-source roots follow the layer's declared case sensitivity; host
 * paths follow their filesystem rules. A host that reopens a subject's context (`replace`) keeps
 * the open one when the new one is over the same chain and target (same `contextId`), so a scope a
 * request holds stays valid; a replaced context takes its buffers away before it is closed.
 *
 * The host knows no game: questions and answers are the game's JSON, checked to be JSON.
 */
import { isJsonValue, type JsonValue } from '@modkit/sdk'
import type { LanguageDocument, LanguageWorkspaceModContext } from '@modkit/sdk/language'
import {
  HOST_LAYER_SOURCE_ID,
  type ModContext,
  type ModContextLayer,
  type ModContextOverlay,
  type ModContextTarget,
} from '@modkit/vfs/content-sources'
import { contentSourceUri } from '../content-dependencies.js'

/** Where a document is in a server's chain. */
export interface LanguageModContextPlace {
  readonly scope: string
  readonly gameId: string
  readonly layerId: string
  /** Layer-relative path, as the URI spells it. */
  readonly path: string
  /** On the host's disk, where the editor saves it: its unsaved text goes over the file. */
  readonly writable: boolean
}

export interface LanguageModContexts {
  /** The server whose chain holds a document, and the file it is there; the opened package wins. */
  placeOf(uri: string, gameId?: string): LanguageModContextPlace | undefined
  /** Bring these open buffers to the server of `scope`, and name its state for a request. */
  synchronize(
    scope: string,
    documents: readonly LanguageDocument[],
    signal?: AbortSignal,
  ): Promise<LanguageWorkspaceModContext>
  /** A document closed: its unsaved text leaves its server. */
  release(uri: string): Promise<void>
  /** One question to the server of `scope`. */
  query(scope: string, question: JsonValue, signal?: AbortSignal): Promise<JsonValue>
  /**
   * The contexts a host opened for one key (a subject, a document's package) from now on. A new
   * context over the same chain and target as an open one is closed and the open one kept.
   */
  replace(key: string, contexts: readonly ModContext[]): void
  /** Files changed on disk: every server lists and reads its chain again. */
  invalidate(): Promise<void>
  /** Every server builds what its first question needs now (`ModContext.prepare`); failures are its own. */
  prepare(): Promise<void>
  dispose(): Promise<void>
}

export interface LanguageModContextsOptions {
  /** The contexts of key `''` (`replace` adds others). */
  readonly contexts?: readonly ModContext[]
  /** How a workspace URI names a host path or a content-source path (default: `file:`, `content-source:`). */
  readonly targetOf?: (uri: string) => ModContextTarget | undefined
  /**
   * The URI the workspace uses for a host path or a content-source path; where it gives none, a
   * content-source path has its `content-source:` URI and a host path none.
   */
  readonly uriOf?: (target: ModContextTarget) => string | undefined
  /** The largest file read to compare a buffer with what is on disk. */
  readonly maxDocumentBytes?: number
}

const MAX_SCOPE_DOCUMENTS = 4_096
const decoder = new TextDecoder()
let registries = 0

interface Entry {
  readonly scope: string
  readonly key: string
  readonly context: ModContext
}

/** What the server holds for one open buffer. */
interface Pushed {
  readonly scope: string
  readonly uri: string
  readonly layerId: string
  readonly path: string
  readonly text: string
  /** False while the buffer equals the file on disk and nothing went over it. */
  readonly overlaid: boolean
}

/** A path compared the way its file system compares it: drive and UNC paths without case. */
function pathKey(path: string): string {
  const slashed = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  return /^(?:[A-Za-z]:|\/\/)/u.test(slashed) ? slashed.toLowerCase() : slashed
}

/** A `file:` URI's host path, or a `content-source:` URI's source and path. */
export function languageModContextTarget(uri: string): ModContextTarget | undefined {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return undefined
  }
  try {
    if (url.protocol === 'content-source:') {
      const sourceId = decodeURIComponent(url.host)
      const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/')
      return sourceId === '' ? undefined : Object.freeze({ sourceId, path })
    }
    if (url.protocol !== 'file:') return undefined
    const path = decodeURIComponent(url.pathname)
    if (url.host !== '') return `//${url.host}${path}`
    return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path
  } catch {
    return undefined
  }
}

/** The layer-relative path of `path` under `base`, compared as the file system compares them. */
function relativeTo(
  base: string,
  path: string,
  hostPath: boolean,
  caseSensitive: boolean,
): string | undefined {
  const slashed = path.replaceAll('\\', '/')
  const root = base.replaceAll('\\', '/').replace(/\/+$/u, '')
  const key = hostPath ? pathKey(slashed) : caseSensitive ? slashed : slashed.toLowerCase()
  const rootKey = hostPath ? pathKey(root) : caseSensitive ? root : root.toLowerCase()
  if (rootKey === '' || !key.startsWith(`${rootKey}/`)) return undefined
  const relative = slashed.slice(root.length + 1)
  return relative === '' ? undefined : relative
}

const defaultUriOf = (target: ModContextTarget): string | undefined =>
  typeof target === 'string' ? undefined : contentSourceUri(target.sourceId, target.path)

export function createLanguageModContexts(
  options: LanguageModContextsOptions = {},
): LanguageModContexts {
  const registry = (registries += 1)
  const targetOf = options.targetOf ?? languageModContextTarget
  const uriOf = (target: ModContextTarget): string | undefined =>
    options.uriOf?.(target) ?? defaultUriOf(target)
  const maxDocumentBytes = options.maxDocumentBytes ?? 64 * 1_024 * 1_024
  let entries: Entry[] = []
  let opened = 0
  /** By scope and URI: a host file two chains hold is a buffer of each. */
  const pushed = new Map<string, Pushed>()
  const pushedKey = (scope: string, uri: string): string => JSON.stringify([scope, uri])
  let disposed = false
  /** One change of the servers' buffers or contexts at a time, in the order asked for. */
  let queue: Promise<unknown> = Promise.resolve()
  const serially = <Value>(work: () => Promise<Value>): Promise<Value> => {
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }

  const entryOf = (scope: string): Entry => {
    const entry = disposed ? undefined : entries.find(item => item.scope === scope)
    if (entry === undefined) throw new TypeError(`no loaded mod is served as ${scope}`)
    return entry
  }

  const layerPlace = (
    entry: Entry,
    layer: ModContextLayer,
    target: ModContextTarget,
  ): LanguageModContextPlace | undefined => {
    const host = layer.sourceId === HOST_LAYER_SOURCE_ID
    if (host !== (typeof target === 'string')) return undefined
    if (typeof target !== 'string' && target.sourceId !== layer.sourceId) return undefined
    const path = relativeTo(
      layer.sourcePath,
      typeof target === 'string' ? target : target.path,
      host,
      layer.caseSensitive === true,
    )
    return path === undefined
      ? undefined
      : Object.freeze({
          scope: entry.scope,
          gameId: entry.context.gameId,
          layerId: layer.id,
          path,
          writable: host,
        })
  }

  /** The strongest layer of one chain that holds the document. */
  const placeIn = (entry: Entry, uri: string): LanguageModContextPlace | undefined => {
    const target = targetOf(uri)
    if (target === undefined) return undefined
    const layers = entry.context.layers
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const place = layerPlace(entry, layers[index]!, target)
      if (place !== undefined) return place
    }
    return undefined
  }

  /** The URI the workspace uses for one file of a context's layer. */
  const fileUri = (context: ModContext, layerId: string, path: string): string | undefined => {
    const layer = context.layers.find(item => item.id === layerId)
    if (layer === undefined || path === '') return undefined
    const parts = path.split('/').filter(Boolean)
    if (layer.sourceId === HOST_LAYER_SOURCE_ID) {
      return uriOf(`${layer.sourcePath.replace(/[\\/]+$/u, '')}/${parts.join('/')}`)
    }
    return uriOf(
      Object.freeze({
        sourceId: layer.sourceId,
        path: [...layer.sourcePath.split('/').filter(Boolean), ...parts].join('/'),
      }),
    )
  }

  /** The text a host file has on disk, or undefined when the layer does not hold it. */
  const diskText = async (
    context: ModContext,
    layerId: string,
    path: string,
  ): Promise<string | undefined> => {
    try {
      return decoder.decode(await context.read(layerId, path, maxDocumentBytes))
    } catch {
      return undefined
    }
  }

  /** Take one scope's buffers away from its server and close its context. */
  const retire = async (entry: Entry): Promise<void> => {
    const removals: ModContextOverlay[] = []
    for (const [key, known] of pushed) {
      if (known.scope !== entry.scope) continue
      pushed.delete(key)
      if (known.overlaid) removals.push(Object.freeze({ layerId: known.layerId, path: known.path }))
    }
    try {
      if (removals.length > 0) await entry.context.overlay?.(removals)
    } finally {
      await entry.context.dispose()
    }
  }

  const add = (key: string, context: ModContext): Entry => {
    const entry = Object.freeze({ scope: `mod-context:${registry}:${(opened += 1)}`, key, context })
    entries.push(entry)
    return entry
  }
  for (const context of options.contexts ?? []) add('', context)

  const api: LanguageModContexts = {
    placeOf(uri, gameId) {
      if (disposed) return undefined
      let found: LanguageModContextPlace | undefined
      for (const entry of entries) {
        if (gameId !== undefined && entry.context.gameId !== gameId) continue
        const place = placeIn(entry, uri)
        if (place === undefined) continue
        // The chain that opened the document's own package answers for it before one that only
        // depends on that package.
        if (entry.context.layers.find(layer => layer.id === place.layerId)?.role === 'primary')
          return place
        found ??= place
      }
      return found
    },

    synchronize(scope, documents, signal) {
      return serially(async () => {
        const entry = entryOf(scope)
        signal?.throwIfAborted()
        const context = entry.context
        const changes: ModContextOverlay[] = []
        const open = new Set<string>()
        for (const document of documents.slice(0, MAX_SCOPE_DOCUMENTS)) {
          const place = placeIn(entry, document.uri)
          if (place === undefined || !place.writable || context.overlay === undefined) continue
          open.add(document.uri)
          const key = pushedKey(scope, document.uri)
          const known = pushed.get(key)
          if (known !== undefined && known.text === document.text) continue
          if (
            known === undefined &&
            (await diskText(context, place.layerId, place.path)) === document.text
          ) {
            pushed.set(
              key,
              Object.freeze({ ...place, uri: document.uri, text: document.text, overlaid: false }),
            )
            continue
          }
          changes.push(
            Object.freeze({ layerId: place.layerId, path: place.path, text: document.text }),
          )
          pushed.set(
            key,
            Object.freeze({ ...place, uri: document.uri, text: document.text, overlaid: true }),
          )
        }
        // A buffer of this server the editor no longer has open: its text leaves.
        for (const [key, known] of pushed) {
          if (known.scope !== scope || open.has(known.uri)) continue
          pushed.delete(key)
          if (known.overlaid)
            changes.push(Object.freeze({ layerId: known.layerId, path: known.path }))
        }
        // An empty overlay asks the server its revision now: on a shared server another client may
        // have edited the chain since this client last heard.
        await context.overlay?.(changes)
        return Object.freeze({
          scope,
          gameId: context.gameId,
          revision: context.revision ?? '0',
          complete: context.unresolved.length === 0,
        })
      })
    },

    release(uri) {
      return serially(async () => {
        for (const [key, known] of [...pushed]) {
          if (known.uri !== uri) continue
          pushed.delete(key)
          const context = entries.find(entry => entry.scope === known.scope)?.context
          if (!disposed && known.overlaid) {
            await context?.overlay?.([Object.freeze({ layerId: known.layerId, path: known.path })])
          }
        }
      })
    },

    async query(scope, question, signal) {
      const { context } = entryOf(scope)
      if (context.query === undefined)
        throw new TypeError(`the loaded mod ${scope} answers no questions`)
      if (!isJsonValue(question)) throw new TypeError('a mod context question must be JSON')
      const answer = await context.query(question, signal)
      signal?.throwIfAborted()
      if (!isJsonValue(answer))
        throw new TypeError('a mod context answered with something other than JSON')
      if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return answer
      const documents = (answer as { readonly documents?: unknown }).documents
      if (!Array.isArray(documents)) return answer
      return Object.freeze({
        ...answer,
        documents: Object.freeze(
          documents.map(item => {
            const record = item as { readonly layerId?: unknown; readonly path?: unknown } | null
            if (typeof record?.layerId !== 'string' || typeof record.path !== 'string') return item
            const uri = fileUri(context, record.layerId, record.path)
            return uri === undefined ? item : Object.freeze({ ...(item as object), uri })
          }),
        ),
      }) as JsonValue
    },

    replace(key, contexts) {
      if (disposed) {
        void Promise.allSettled(contexts.map(context => context.dispose()))
        return
      }
      const before = entries.filter(entry => entry.key === key)
      const kept = new Set<Entry>()
      const surplus: ModContext[] = []
      for (const context of contexts) {
        const same = before.find(
          entry => !kept.has(entry) && entry.context.contextId === context.contextId,
        )
        if (same === undefined) add(key, context)
        else {
          kept.add(same)
          surplus.push(context)
        }
      }
      const retired = before.filter(entry => !kept.has(entry))
      entries = entries.filter(entry => !retired.includes(entry))
      void serially(async () => {
        await Promise.allSettled([
          ...retired.map(retire),
          ...surplus.map(context => context.dispose()),
        ])
      })
    },

    invalidate() {
      return serially(async () => {
        await Promise.all(entries.map(entry => entry.context.invalidate?.()))
      })
    },

    async prepare() {
      // Not in the buffers' queue: building a chain's Data must not hold up an edit reaching it.
      await Promise.allSettled(entries.map(entry => entry.context.prepare?.()))
    },

    async dispose() {
      if (disposed) return
      disposed = true
      const closing = entries
      entries = []
      await serially(async () => {
        await Promise.allSettled(closing.map(retire))
      })
    },
  }
  return Object.freeze(api)
}
