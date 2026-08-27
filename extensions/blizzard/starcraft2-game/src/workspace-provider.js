import { MOD_WORKSPACE_COMPOSITION_CONTRACT, resolveModWorkspaceGraph } from '@modkitx-x3/sdk/mods'

const COMPOSITION_ID = 'org.modkitx.blizzard.starcraft2.workspace'
const GAME_ID = 'org.modkitx/starcraft-2'
const MAXIMUM_ROOTS = 4_096
const MAXIMUM_SOURCES = 128
const MAXIMUM_DEPTH = 128
const MAXIMUM_DEPENDENCIES_PER_ROOT = 256

const IMPLICIT_MOD_DEPENDENCIES = Object.freeze({
  'liberty.sc2mod': Object.freeze(['Core.SC2Mod']),
  'swarm.sc2mod': Object.freeze(['Liberty.SC2Mod']),
  'void.sc2mod': Object.freeze(['Swarm.SC2Mod']),
  'liberty.sc2campaign': Object.freeze(['Liberty.SC2Mod']),
  'swarm.sc2campaign': Object.freeze(['Swarm.SC2Mod']),
  'void.sc2campaign': Object.freeze(['Void.SC2Mod']),
  'libertymulti.sc2mod': Object.freeze(['Liberty.SC2Mod']),
  'swarmmulti.sc2mod': Object.freeze(['Swarm.SC2Mod']),
  'voidmulti.sc2mod': Object.freeze(['Void.SC2Mod']),
  'balancemulti.sc2mod': Object.freeze(['VoidMulti.SC2Mod']),
})
const ENGINE_ROOTS = new Set(['core.sc2mod', ...Object.keys(IMPLICIT_MOD_DEPENDENCIES)])

function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function positiveLimit(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function normalizeRef(value, label = 'dependency reference') {
  if (value.includes('\0')) throw new TypeError(`${label} must not contain NUL bytes`)
  if (/^[a-z]:[\\/]/iu.test(value) || /^[\\/]/u.test(value)) {
    throw new TypeError(`${label} must be relative to its declared source root`)
  }
  const normalized = value
    .replace(/^[a-z][a-z0-9+.-]*:/iu, '')
    .replace(/\\/gu, '/')
    .replace(/^\/+|\/+$/gu, '')
  const parts = []
  for (const part of normalized.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new TypeError(`${label} must not escape its declared source root`)
    parts.push(part)
  }
  if (parts.length === 0) throw new TypeError(`${label} must name a logical path`)
  return parts.join('/').toLowerCase()
}

function validateRootPath(value, label) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    throw new TypeError(`${label} must be a logical path, not a source URI`)
  }
  normalizeRef(value, label)
}

function basename(value) {
  const normalized = normalizeRef(value)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function normalizedRootName(root) {
  const fromPath = basename(root.sourcePath)
  return fromPath.includes('.') ? fromPath : basename(root.displayName)
}

function sourceIndex(sources) {
  const priorities = new Map()
  sources.forEach((source, index) => {
    if (!priorities.has(source.sourceId)) priorities.set(source.sourceId, index)
  })
  return priorities
}

function candidateRank(root, index, priorities) {
  return [priorities.get(root.sourceId) ?? Number.MAX_SAFE_INTEGER, index]
}

function compareRank(left, right) {
  return left[0] - right[0] || left[1] - right[1]
}

function validateRequest(request) {
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('workspace composition request must be an object')
  nonEmptyString(value.workspaceId, 'workspaceId')
  nonEmptyString(value.activeRootId, 'activeRootId')
  if (value.gameId !== GAME_ID) {
    throw new TypeError(`StarCraft II workspace composition cannot inspect ${String(value.gameId)}`)
  }
  const maxRoots = positiveLimit(value.maxRoots, 'maxRoots', MAXIMUM_ROOTS)
  positiveLimit(value.maxDepth, 'maxDepth', MAXIMUM_DEPTH)
  if (!Array.isArray(value.sources) || value.sources.length > MAXIMUM_SOURCES) {
    throw new TypeError(`sources must be an array with at most ${MAXIMUM_SOURCES} entries`)
  }
  if (!Array.isArray(value.roots) || value.roots.length > maxRoots) {
    throw new TypeError(`roots must be an array with at most maxRoots (${maxRoots}) entries`)
  }
  value.sources.forEach((source, index) => {
    const item = recordOf(source)
    if (item === undefined) throw new TypeError(`sources[${index}] must be an object`)
    nonEmptyString(item.sourceId, `sources[${index}].sourceId`)
    nonEmptyString(item.kind, `sources[${index}].kind`)
    nonEmptyString(item.location, `sources[${index}].location`)
  })
  value.roots.forEach((root, index) => {
    const item = recordOf(root)
    if (item === undefined) throw new TypeError(`roots[${index}] must be an object`)
    nonEmptyString(item.rootId, `roots[${index}].rootId`)
    nonEmptyString(item.sourceId, `roots[${index}].sourceId`)
    nonEmptyString(item.sourcePath, `roots[${index}].sourcePath`)
    validateRootPath(item.sourcePath, `roots[${index}].sourcePath`)
    nonEmptyString(item.displayName, `roots[${index}].displayName`)
    nonEmptyString(item.kind, `roots[${index}].kind`)
    if (
      !Array.isArray(item.declaredDependencies) ||
      item.declaredDependencies.length > MAXIMUM_DEPENDENCIES_PER_ROOT
    ) {
      throw new TypeError(
        `roots[${index}].declaredDependencies must contain at most ${MAXIMUM_DEPENDENCIES_PER_ROOT} entries`,
      )
    }
    item.declaredDependencies.forEach((dependency, dependencyIndex) => {
      const declaration = recordOf(dependency)
      if (declaration === undefined) {
        throw new TypeError(
          `roots[${index}].declaredDependencies[${dependencyIndex}] must be an object`,
        )
      }
      nonEmptyString(
        declaration.ref,
        `roots[${index}].declaredDependencies[${dependencyIndex}].ref`,
      )
      normalizeRef(declaration.ref, `roots[${index}].declaredDependencies[${dependencyIndex}].ref`)
      if (typeof declaration.required !== 'boolean') {
        throw new TypeError(
          `roots[${index}].declaredDependencies[${dependencyIndex}].required must be boolean`,
        )
      }
    })
  })
  return value
}

function buildCandidateIndex(roots, sources) {
  const priorities = sourceIndex(sources)
  const records = roots.map((root, index) => ({
    root,
    rank: candidateRank(root, index, priorities),
    path: normalizeRef(root.sourcePath),
    name: normalizedRootName(root),
  }))
  records.sort((left, right) => compareRank(left.rank, right.rank))
  return records
}

function resolveDependency(records, dependingRoot, ref) {
  const normalized = normalizeRef(ref)
  const name = basename(normalized)
  const globalPath = records.find(item => item.path === normalized)
  if (globalPath !== undefined) return globalPath.root
  const globalName = records.find(item => item.name === name)
  if (globalName !== undefined) return globalName.root

  const parent = normalizeRef(dependingRoot.sourcePath).replace(/\/[^/]*$/u, '')
  if (parent.length === 0) return undefined
  return records.find(item => item.path === `${parent}/${name}`)?.root
}

function shouldLoadDefaultLiberty(root) {
  const name = normalizedRootName(root)
  if (name.endsWith('.sc2map')) return true
  return name.endsWith('.sc2mod') && !ENGINE_ROOTS.has(name)
}

function addDependency(dependencies, seen, records, root, ref, required, provenance) {
  const normalized = normalizeRef(ref)
  const key = basename(normalized)
  if (seen.has(key)) return
  seen.add(key)
  const target = resolveDependency(records, root, ref)
  dependencies.push(
    Object.freeze({
      targetRootId: target?.rootId ?? `${root.rootId}::unresolved::${normalized}`,
      ref,
      required,
      provenance,
    }),
  )
}

function graphRoot(root, activeRootId, records) {
  const dependencies = []
  const seen = new Set()

  if (root.rootId === activeRootId) {
    const core = resolveDependency(records, root, 'Mods/Core.SC2Mod')
    if (core !== undefined && core.rootId !== root.rootId) {
      addDependency(dependencies, seen, records, root, 'Mods/Core.SC2Mod', false, 'implicit')
    }
    if (shouldLoadDefaultLiberty(root)) {
      addDependency(dependencies, seen, records, root, 'Mods/Liberty.SC2Mod', false, 'implicit')
    }
  }

  for (const declaration of root.declaredDependencies) {
    addDependency(
      dependencies,
      seen,
      records,
      root,
      declaration.ref,
      declaration.required,
      'declared',
    )
  }
  for (const ref of IMPLICIT_MOD_DEPENDENCIES[normalizedRootName(root)] ?? []) {
    addDependency(dependencies, seen, records, root, `Mods/${ref}`, true, 'implicit')
  }

  return Object.freeze({
    rootId: root.rootId,
    sourceId: root.sourceId,
    sourcePath: root.sourcePath,
    displayName: root.displayName,
    kind: root.kind,
    ...(root.fingerprint === undefined ? {} : { fingerprint: root.fingerprint }),
    dependencies: Object.freeze(dependencies),
  })
}

export async function composeStarcraft2Workspace(request) {
  request.signal?.throwIfAborted()
  const value = validateRequest(request)
  const records = buildCandidateIndex(value.roots, value.sources)
  const roots = value.roots.map(root => graphRoot(root, value.activeRootId, records))
  request.signal?.throwIfAborted()
  return resolveModWorkspaceGraph({
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    activeRootId: value.activeRootId,
    sources: value.sources,
    roots,
    maxRoots: value.maxRoots,
    maxDepth: value.maxDepth,
  })
}

export const abiVersion = 1
export const provides = Object.freeze([MOD_WORKSPACE_COMPOSITION_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== MOD_WORKSPACE_COMPOSITION_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported mod-workspace selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
      compositionId: COMPOSITION_ID,
      gameIds: Object.freeze([GAME_ID]),
      compose: composeStarcraft2Workspace,
    }),
    release: async () => undefined,
  })
}
