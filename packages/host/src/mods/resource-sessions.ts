import type { PageRequest, TreeDataSource, TreeNodeFacts, TreeNodeRef, TreeQuery } from '@modkit/sdk'
import type { ContentSources, ModContext, ModContextTarget } from '@modkit/vfs/content-sources'

type Loaded = {
  readonly id: string
  readonly label: string
  readonly target: ModContextTarget
  readonly baseMods?: readonly string[]
  readonly context: ModContext
  readonly opened: boolean
}

const ROOT = 'loaded-mods'
const MOD = 'mod/'
const NODE = 'node/'
const ref = (id: string, hasChildren = true): TreeNodeRef => ({ id, hasChildren })
/** A package layer's id among the loaded mods. */
const packageId = (gameId: string, layer: { readonly sourceId: string; readonly sourcePath: string }): string =>
  `${gameId}|${layer.sourceId}|${layer.sourcePath.toLowerCase()}`
const nodeId = (id: string, inner: string): string => `${NODE}${encodeURIComponent(id)}/${encodeURIComponent(inner)}`

function childOf(id: string): { mod: string; inner: string } | undefined {
  if (!id.startsWith(NODE)) return undefined
  const cut = id.indexOf('/', NODE.length)
  if (cut < 0) return undefined
  try {
    return { mod: decodeURIComponent(id.slice(NODE.length, cut)), inner: decodeURIComponent(id.slice(cut + 1)) }
  } catch { return undefined }
}

function treeRef(value: unknown): TreeNodeRef {
  if (typeof value !== 'object' || value === null ||
      typeof (value as TreeNodeRef).id !== 'string' ||
      typeof (value as TreeNodeRef).hasChildren !== 'boolean')
    throw new TypeError('mod resource provider returned an invalid node')
  return value as TreeNodeRef
}

function treeFacts(value: unknown): TreeNodeFacts {
  if (typeof value !== 'object' || value === null ||
      typeof (value as TreeNodeFacts).kind !== 'string' ||
      typeof (value as TreeNodeFacts).label !== 'string')
    throw new TypeError('mod resource provider returned invalid facts')
  return value as TreeNodeFacts
}

/** Host-owned loaded mods. Editor tabs borrow the tree; they never own or unload its contexts. */
export class LoadedModResourceSessions {
  private readonly mods = new Map<string, Loaded>()
  /** Loads in flight: concurrent callers for the same target share one `openModContext`. */
  private readonly pending = new Map<string, Promise<boolean>>()
  private disposed = false

  constructor(
    private readonly sources: ContentSources,
    /** `locales` is read at every open (reloads too): the string files the contexts load. */
    private readonly options: { readonly locales?: () => readonly string[] } = {},
  ) {}

  /** The request fields every open carries: the locales chosen now, when the host has any. */
  private localeFields(): { readonly locales?: readonly string[] } {
    const locales = this.options.locales?.()
    return locales === undefined || locales.length === 0 ? {} : { locales: [...locales] }
  }

  list(): readonly { id: string; label: string; contextId: string }[] {
    return [...this.mods.values()].map(mod => ({ id: mod.id, label: mod.label, contextId: mod.context.contextId }))
  }

  async load(target: ModContextTarget, baseMods?: readonly string[]): Promise<boolean> {
    if (this.disposed) throw new Error('mod resources are disposed')
    const open = this.sources.openModContext?.bind(this.sources)
    if (open === undefined) return false
    return this.once(`load|${JSON.stringify([target, baseMods ?? []])}`, async () => {
      const context = await open({ schemaVersion: 1, target, ...(baseMods ? { baseMods } : {}), ...this.localeFields() })
      let changed = false
      for (const layer of context.layers.slice(0, -1)) {
        if (layer.kind !== 'package') continue
        const id = packageId(context.gameId, layer)
        if (this.mods.has(id)) continue
        const dependencyTarget: ModContextTarget = layer.sourceId === 'host'
          ? layer.sourcePath : { sourceId: layer.sourceId, path: layer.sourcePath }
        changed = (await this.once(`dependency|${id}`, async () =>
          this.register(await open({ schemaVersion: 1, target: dependencyTarget, ...this.localeFields() }), dependencyTarget, undefined, false))) || changed
      }
      return (await this.register(context, target, baseMods, true)) || changed
    })
  }

  private once(key: string, run: () => Promise<boolean>): Promise<boolean> {
    const current = this.pending.get(key)
    if (current !== undefined) return current
    const next = run().finally(() => this.pending.delete(key))
    this.pending.set(key, next)
    return next
  }

  private async register(context: ModContext, target: ModContextTarget, baseMods?: readonly string[], opened = true): Promise<boolean> {
    const primary = context.layers.at(-1)
    if (primary?.kind !== 'package') {
      await context.dispose()
      return false
    }
    const id = packageId(context.gameId, primary)
    const previous = this.mods.get(id)
    if (previous?.context.contextId === context.contextId) {
      await context.dispose()
      if (opened && !previous.opened) {
        this.mods.set(id, { ...previous, opened: true })
        return true
      }
      return false
    }
    const loaded: Loaded = { id, label: primary.displayName, target, ...(baseMods ? { baseMods } : {}), context, opened: opened || previous?.opened === true }
    this.mods.set(id, loaded)
    await previous?.context.dispose()
    return true
  }

  /** Unload a mod and the dependencies only it loaded; one another opened mod stands on stays. */
  async unload(id: string): Promise<void> {
    const current = this.mods.get(id)
    if (current === undefined) return
    this.mods.delete(id)
    const needed = new Set<string>()
    for (const mod of this.mods.values())
      if (mod.opened)
        for (const layer of mod.context.layers) if (layer.kind === 'package') needed.add(packageId(mod.context.gameId, layer))
    const orphans = [...this.mods.values()].filter(mod => !mod.opened && !needed.has(mod.id))
    for (const orphan of orphans) this.mods.delete(orphan.id)
    await current.context.dispose()
    await Promise.allSettled(orphans.map(mod => mod.context.dispose()))
  }

  /** Reopen all loaded contexts after their shared content source invalidated a package. */
  async reloadAll(): Promise<void> {
    const opened = [...this.mods.values()]
    const replacement = new LoadedModResourceSessions(this.sources, this.options)
    try {
      for (const mod of opened) {
        if (mod.opened) await replacement.load(mod.target, mod.baseMods)
      }
    } catch (error) {
      await replacement.dispose()
      throw error
    }
    this.mods.clear()
    for (const [id, mod] of replacement.mods) this.mods.set(id, mod)
    replacement.mods.clear()
    await Promise.allSettled(opened.map(mod => mod.context.dispose()))
  }

  /**
   * Reopen only the loaded mods whose chain holds a changed file (a layer is that file, or a folder
   * above it), dependents included; the others keep their contexts. `true` when any was reopened.
   * The caller refreshes the content source first, as for `reloadAll`.
   */
  async reloadHolding(sourceId: string, path: string): Promise<boolean> {
    const spelled = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
    const changed = spelled(path)
    const holds = (mod: Loaded) =>
      mod.context.layers.some(layer => {
        if (layer.sourceId !== sourceId) return false
        const root = spelled(layer.sourcePath)
        return changed === root || changed.startsWith(`${root}/`)
      })
    const affected = [...this.mods.values()].filter(holds)
    if (affected.length === 0) return false
    const replacement = new LoadedModResourceSessions(this.sources, this.options)
    try {
      for (const mod of affected) {
        if (mod.opened) await replacement.load(mod.target, mod.baseMods)
      }
    } catch (error) {
      await replacement.dispose()
      throw error
    }
    for (const mod of affected) this.mods.delete(mod.id)
    for (const [id, mod] of replacement.mods) {
      // a dependency the change did not touch keeps the context it had
      if (this.mods.has(id)) await mod.context.dispose()
      else this.mods.set(id, mod)
    }
    replacement.mods.clear()
    await Promise.allSettled(affected.map(mod => mod.context.dispose()))
    return true
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const contexts = [...this.mods.values()].map(mod => mod.context)
    this.mods.clear()
    await Promise.allSettled(contexts.map(context => context.dispose()))
  }

  tree(includeDependencies = true): TreeDataSource {
    const thisSessions = this
    const query = async (mod: Loaded, action: string, extra: object = {}, signal?: AbortSignal): Promise<unknown> => {
      if (mod.context.query === undefined) throw new Error(`${mod.label} does not publish semantic resources`)
      return mod.context.query({ kind: 'resources.tree', action, ...extra }, signal)
    }
    /**
     * A question a context does not answer (a Westwood context answers `data.entities` only) is
     * refused with a RangeError: such a mod has no resources here, which is no failure of the rest.
     */
    const unanswered = (error: unknown): boolean => error instanceof RangeError
    const page = (items: readonly TreeNodeRef[], request: PageRequest) => {
      const start = request.cursor === undefined ? 0 : Number(request.cursor)
      if (!Number.isSafeInteger(start) || start < 0 || start > items.length) throw new RangeError('invalid resource cursor')
      return {
        items: items.slice(start, start + request.limit),
        ...(start + request.limit < items.length ? { nextCursor: String(start + request.limit) } : {}),
      }
    }
    return {
      async root() { return ref(ROOT) },
      async children(node, request, signal) {
        signal?.throwIfAborted()
        // a mod that publishes no semantic resources (a plain folder layer) is listed without children
        if (node.id === ROOT) return page([...thisSessions.mods.values()]
          .filter(mod => includeDependencies || mod.opened)
          .map(mod => ref(MOD + encodeURIComponent(mod.id), mod.context.query !== undefined)), request)
        if (node.id.startsWith(MOD)) {
          const mod = thisSessions.mods.get(decodeURIComponent(node.id.slice(MOD.length)))
          if (mod === undefined || mod.context.query === undefined) return page([], request)
          let root: TreeNodeRef
          try {
            root = treeRef(await query(mod, 'root', {}, signal))
          } catch (error) {
            if (unanswered(error)) return page([], request)
            throw error
          }
          const answer = await query(mod, 'children', { node: root, page: request }, signal) as { items?: unknown[]; nextCursor?: string }
          return { items: (answer.items ?? []).map(item => {
            const inner = treeRef(item)
            return ref(nodeId(mod.id, inner.id), inner.hasChildren)
          }), ...(answer.nextCursor === undefined ? {} : { nextCursor: answer.nextCursor }) }
        }
        const target = childOf(node.id)
        const mod = target === undefined ? undefined : thisSessions.mods.get(target.mod)
        if (mod === undefined || target === undefined) return page([], request)
        const answer = await query(mod, 'children', { node: ref(target.inner, node.hasChildren), page: request }, signal) as { items?: unknown[]; nextCursor?: string }
        return { items: (answer.items ?? []).map(item => {
          const inner = treeRef(item)
          return ref(nodeId(mod.id, inner.id), inner.hasChildren)
        }), ...(answer.nextCursor === undefined ? {} : { nextCursor: answer.nextCursor }) }
      },
      async facts(node) {
        if (node.id === ROOT) return { kind: 'resources', label: 'Resources',
          preview: `${[...thisSessions.mods.values()].filter(mod => includeDependencies || mod.opened).length} mods` }
        if (node.id.startsWith(MOD)) {
          const mod = thisSessions.mods.get(decodeURIComponent(node.id.slice(MOD.length)))
          if (mod === undefined) throw new Error('mod was unloaded')
          return { kind: 'mod', label: mod.label, preview: `${mod.context.layers.length} layers` }
        }
        const target = childOf(node.id)
        const mod = target === undefined ? undefined : thisSessions.mods.get(target.mod)
        if (mod === undefined || target === undefined) throw new Error('mod resource was unloaded')
        return treeFacts(await query(mod, 'facts', { node: ref(target.inner, node.hasChildren) }))
      },
      async *search(search: TreeQuery, signal?: AbortSignal) {
        for (const mod of thisSessions.mods.values()) {
          if ((!includeDependencies && !mod.opened) || mod.context.query === undefined) continue
          signal?.throwIfAborted()
          let answer: { items?: unknown[] }
          try {
            answer = await query(mod, 'search', { node: ref('root'), pattern: search.pattern }, signal) as { items?: unknown[] }
          } catch (error) {
            if (unanswered(error)) continue
            throw error
          }
          for (const item of answer.items ?? []) {
            const inner = treeRef(item)
            yield ref(nodeId(mod.id, inner.id), inner.hasChildren)
          }
        }
      },
    }
  }
}
