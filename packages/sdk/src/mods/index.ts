/** Protocol-neutral contracts and deterministic graph composition for mod workspaces. */

import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for game-specific mod workspace composition. */
export const MOD_WORKSPACE_COMPOSITION_CONTRACT = 'common.mod/workspace-composition' as const

/** Host-owned matcher profile for exact game-id routing. */
export const MOD_WORKSPACE_MATCHER_PROFILE = 'org.modkitx/mod-workspace-matcher' as const

export type ModWorkspaceDependencyProvenance = 'declared' | 'implicit'

/** One ordered source available to the workspace. Earlier sources have higher priority. */
export interface ModWorkspaceSource {
  readonly sourceId: string
  readonly kind: string
  readonly location: string
  readonly fingerprint?: string
}

/** A game-level dependency reference before a provider interprets its naming rules. */
export interface ModWorkspaceDependencyDeclaration {
  readonly ref: string
  readonly required: boolean
}

/** A root discovered by a bounded source adapter; content remains owned by that adapter. */
export interface ModWorkspaceRootCandidate {
  readonly rootId: string
  readonly sourceId: string
  readonly sourcePath: string
  readonly displayName: string
  readonly kind: string
  readonly fingerprint?: string
  readonly declaredDependencies: readonly ModWorkspaceDependencyDeclaration[]
}

export interface ModWorkspaceCompositionRequest {
  readonly workspaceId: string
  readonly gameId: string
  readonly activeRootId: string
  readonly sources: readonly ModWorkspaceSource[]
  readonly roots: readonly ModWorkspaceRootCandidate[]
  /** Request-owned ceiling; a provider may impose a lower hard limit. */
  readonly maxRoots: number
  /** Maximum dependency depth followed from the active root. */
  readonly maxDepth: number
  readonly signal?: AbortSignal
}

/** A provider-resolved graph edge. targetRootId may name an unavailable required dependency. */
export interface ModWorkspaceGraphDependency {
  readonly targetRootId: string
  readonly ref: string
  readonly required: boolean
  readonly provenance: ModWorkspaceDependencyProvenance
}

/** A root whose game-specific dependency references have been resolved to stable root ids. */
export interface ModWorkspaceGraphRoot {
  readonly rootId: string
  readonly sourceId: string
  readonly sourcePath: string
  readonly displayName: string
  readonly kind: string
  readonly fingerprint?: string
  readonly dependencies: readonly ModWorkspaceGraphDependency[]
}

export interface ModWorkspaceGraphInput {
  readonly workspaceId: string
  readonly gameId: string
  readonly activeRootId: string
  readonly sources: readonly ModWorkspaceSource[]
  readonly roots: readonly ModWorkspaceGraphRoot[]
  readonly maxRoots: number
  readonly maxDepth: number
}

export type ModWorkspaceDiagnosticSeverity = 'error' | 'warning' | 'information'

export interface ModWorkspaceDiagnostic {
  readonly severity: ModWorkspaceDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly rootId?: string
  readonly dependencyRef?: string
  readonly cycle?: readonly string[]
}

export interface ModWorkspaceLock {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly gameId: string
  readonly activeRootId: string
  /** Source precedence captured in the lock; index zero is highest priority. */
  readonly sources: readonly ModWorkspaceSource[]
  /** Dependencies first and the active root last, with every root included once. */
  readonly loadOrder: readonly ModWorkspaceGraphRoot[]
  /** loadOrder without the active root. */
  readonly dependencyOrder: readonly ModWorkspaceGraphRoot[]
  readonly diagnostics: readonly ModWorkspaceDiagnostic[]
  readonly complete: boolean
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

function immutableDiagnostic(value: ModWorkspaceDiagnostic): ModWorkspaceDiagnostic {
  return Object.freeze({
    ...value,
    ...(value.cycle === undefined ? {} : { cycle: Object.freeze([...value.cycle]) }),
  })
}

function immutableSource(value: ModWorkspaceSource): ModWorkspaceSource {
  return Object.freeze({ ...value })
}

function immutableRoot(value: ModWorkspaceGraphRoot): ModWorkspaceGraphRoot {
  return Object.freeze({
    ...value,
    dependencies: Object.freeze(value.dependencies.map(item => Object.freeze({ ...item }))),
  })
}

/**
 * Compose a game-neutral dependency graph into a deterministic workspace lock.
 *
 * Providers resolve their own naming and implicit-layer rules before calling this function. The
 * platform algorithm only validates source/root identity, follows bounded edges, reports missing
 * or cyclic dependencies, and emits dependency-first order.
 */
export function resolveModWorkspaceGraph(input: ModWorkspaceGraphInput): ModWorkspaceLock {
  const maxRoots = positiveLimit(input.maxRoots, 'maxRoots')
  const maxDepth = positiveLimit(input.maxDepth, 'maxDepth')
  if (input.roots.length > maxRoots) {
    throw new TypeError(`roots exceeds maxRoots (${input.roots.length} > ${maxRoots})`)
  }

  const diagnostics: ModWorkspaceDiagnostic[] = []
  const sourceIds = new Set<string>()
  for (const source of input.sources) {
    if (sourceIds.has(source.sourceId)) {
      diagnostics.push({
        severity: 'error',
        code: 'common.mod/source-id-duplicate',
        message: `workspace source id is duplicated: ${source.sourceId}`,
      })
    } else {
      sourceIds.add(source.sourceId)
    }
  }

  const roots = new Map<string, ModWorkspaceGraphRoot>()
  for (const root of input.roots) {
    if (!sourceIds.has(root.sourceId)) {
      diagnostics.push({
        severity: 'error',
        code: 'common.mod/root-source-unavailable',
        message: `${root.rootId} names unavailable source ${root.sourceId}`,
        rootId: root.rootId,
      })
      continue
    }
    if (roots.has(root.rootId)) {
      diagnostics.push({
        severity: 'error',
        code: 'common.mod/root-id-duplicate',
        message: `workspace root id is duplicated: ${root.rootId}`,
        rootId: root.rootId,
      })
      continue
    }
    roots.set(root.rootId, immutableRoot(root))
  }

  const order: ModWorkspaceGraphRoot[] = []
  const state = new Map<string, 'visiting' | 'visited'>()
  const missing = new Set<string>()
  const cycles = new Set<string>()
  let complete = diagnostics.every(item => item.severity !== 'error')

  const visit = (rootId: string, depth: number, path: readonly string[]): void => {
    const currentState = state.get(rootId)
    if (currentState === 'visited') return
    if (currentState === 'visiting') {
      complete = false
      const start = path.indexOf(rootId)
      const cycle = [...(start === -1 ? path : path.slice(start)), rootId]
      const key = cycle.join('\u0000')
      if (!cycles.has(key)) {
        cycles.add(key)
        diagnostics.push({
          severity: 'error',
          code: 'common.mod/dependency-cycle',
          message: `workspace dependency cycle: ${cycle.join(' -> ')}`,
          rootId,
          cycle,
        })
      }
      return
    }
    if (depth > maxDepth) {
      complete = false
      diagnostics.push({
        severity: 'error',
        code: 'common.mod/dependency-depth-exceeded',
        message: `${rootId} exceeds workspace dependency depth ${maxDepth}`,
        rootId,
      })
      return
    }

    const root = roots.get(rootId)
    if (root === undefined) return
    state.set(rootId, 'visiting')
    const nextPath = [...path, rootId]
    for (const dependency of root.dependencies) {
      const target = roots.get(dependency.targetRootId)
      if (target !== undefined) {
        visit(target.rootId, depth + 1, nextPath)
        continue
      }
      const key = `${rootId}\u0000${dependency.targetRootId}\u0000${dependency.ref}`
      if (missing.has(key)) continue
      missing.add(key)
      if (dependency.required) complete = false
      diagnostics.push({
        severity: dependency.required ? 'error' : 'warning',
        code: dependency.required
          ? 'common.mod/dependency-unresolved'
          : 'common.mod/optional-dependency-unresolved',
        message: `${rootId} cannot resolve ${dependency.ref}`,
        rootId,
        dependencyRef: dependency.ref,
      })
    }
    state.set(rootId, 'visited')
    order.push(root)
  }

  if (!roots.has(input.activeRootId)) {
    complete = false
    diagnostics.push({
      severity: 'error',
      code: 'common.mod/active-root-unavailable',
      message: `active workspace root is unavailable: ${input.activeRootId}`,
      rootId: input.activeRootId,
    })
  } else {
    visit(input.activeRootId, 0, [])
  }

  const loadOrder = Object.freeze([...order])
  const dependencyOrder = Object.freeze(order.filter(root => root.rootId !== input.activeRootId))
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    gameId: input.gameId,
    activeRootId: input.activeRootId,
    sources: Object.freeze(input.sources.map(immutableSource)),
    loadOrder,
    dependencyOrder,
    diagnostics: Object.freeze(diagnostics.map(immutableDiagnostic)),
    complete,
  })
}

/** Activated game-specific workspace provider. Content access remains outside this capability. */
export interface ModWorkspaceComposition {
  readonly contract: typeof MOD_WORKSPACE_COMPOSITION_CONTRACT
  readonly compositionId: string
  readonly gameIds: readonly string[]
  compose(request: ModWorkspaceCompositionRequest): Promise<ModWorkspaceLock>
}

/** JSON-safe route advertised by a workspace contribution. */
export interface ModWorkspaceOfferFacet {
  readonly gameIds: readonly string[]
}

/** JSON-safe route supplied by a consumer selecting one named game. */
export interface ModWorkspaceRequestFacet {
  readonly gameId: string
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.mod/workspace-composition': { 1: ModWorkspaceComposition }
  }

  interface ContractRequestMap {
    'common.mod/workspace-composition': {
      1: { presence: 'required'; facet: ModWorkspaceRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.mod/workspace-composition': {
      1: { presence: 'required'; facet: ModWorkspaceOfferFacet }
    }
  }
}

export type ModWorkspaceProviderModule = ServiceProviderModule<
  typeof MOD_WORKSPACE_COMPOSITION_CONTRACT,
  1
>
