/**
 * Resolved-workspace probes for sc2-mod.
 *
 * Both sides answer with the same projection of the resolved result — the ordered load order — so a
 * difference is a difference in resolution rather than in how each implementation shapes its own
 * objects. MK2 resolves through `ModContextManager`; MK3 resolves through the `content.mount`
 * operation of its published codec, which is what a host actually executes.
 */
import path from 'node:path'
import { blizzardRoot } from '../lib/kit.mjs'

const posix = value => String(value).replace(/\\/g, '/')
/** MK2 names a chain entry by its VFS path, MK3 by a graph root; both end in the mod's own name. */
const baseName = value =>
  posix(typeof value === 'string' ? value : (value?.sourcePath ?? value?.displayName ?? value?.rootId))
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    .toLowerCase()

/**
 * The comparable shape: which packages the mod needs, named the way both implementations name them.
 *
 * MK2 resolves the chain to directories itself, MK3 answers with installation-relative package
 * paths for the host to resolve, so the comparable claim is the set of packages and the active mod
 * — not the order of a list one side builds from a folder scan and the other from the engine's
 * built-in closure.
 */
export const projectWorkspace = (chain, active) => ({
  loadOrder: chain.map(baseName),
  active: baseName(active),
})

/** Case input -> absolute fixture locations, kept out of the corpus so it stays machine-neutral. */
export function locate(input) {
  const mods = path.join(blizzardRoot, 'starcraft2', input.modsDir)
  return { mods, root: path.join(mods, input.leaf) }
}

/** MK2: `ModContextManager` reads the mod tree itself and reports the chain it loaded. */
export async function driveOracle(workspace, input) {
  const { mods, root } = locate(input)
  const manager = new workspace.ModContextManager()
  try {
    const loaded = await manager.load(
      { sources: [{ type: 'mods', path: posix(mods) }], locale: 'enus' },
      posix(root),
    )
    return projectWorkspace(loaded.mod.loadOrder, root)
  } finally {
    await manager.dispose?.()
  }
}

/** One package's declared and engine-implicit dependencies, as the published codec reports them. */
async function requestedDependencies(open, directory) {
  const session = await open(directory)
  try {
    const result = await session.operations().invoke('resolve-dependencies', {})
    if (result?.state !== 'ok') {
      throw Object.assign(new Error(result?.reason ?? 'resolve-dependencies refused'), { code: result?.code })
    }
    const value = result.output.kind === 'json' ? result.output.value : result.output
    return (value.contentDependencies?.dependencies ?? []).map(item => item.path ?? item)
  } finally {
    await session.dispose()
  }
}

/**
 * MK3: the codec answers one level — what this package declares plus the engine's own edges — and
 * the host walks that answer across the packages it has. The walk here is the host's part, by
 * basename against the same directory MK2 is given; every dependency edge is MK3's.
 */
export async function driveMigrated(open, input, readDirectory, compose) {
  const { mods, root } = locate(input)
  const available = new Map(
    (await readDirectory(mods)).map(entry => [entry.toLowerCase(), path.join(mods, entry)]),
  )
  const edges = new Map()
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.shift()
    const name = baseName(directory)
    if (edges.has(name)) continue
    // A package the codec does not route carries no edges of its own; it still belongs to the
    // chain, exactly as it does for MK2, which lists it without parsing it either.
    const dependencies = await requestedDependencies(open, directory).catch(error => {
      if (error?.code === 'unresolved') return []
      throw error
    })
    edges.set(name, { directory, dependencies })
    for (const dependency of dependencies) {
      const resolved = available.get(baseName(dependency))
      if (resolved !== undefined) pending.push(resolved)
    }
  }
  // Ordering is the workspace provider's own, over the edges the codec reported.
  const roots = [...edges].map(([name, entry]) => ({
    rootId: name,
    sourceId: name,
    sourcePath: name,
    displayName: name,
    kind: 'sc2-mod',
    declaredDependencies: entry.dependencies.map(ref => ({ ref, required: true })),
  }))
  const lock = await compose({
    workspaceId: 'sc2-mod-content-parity',
    gameId: 'blizzard/starcraft-2',
    activeRootId: baseName(root),
    sources: [...edges].map(([name, entry]) => ({
      sourceId: name,
      kind: 'namespace',
      location: `file:${posix(entry.directory)}`,
    })),
    roots,
    maxRoots: 64,
    maxDepth: 32,
  })
  return projectWorkspace(lock.loadOrder, root)
}
