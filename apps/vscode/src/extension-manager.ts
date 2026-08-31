import { isAbsolute, resolve } from 'node:path'

import type {
  ExtensionManagerEntry,
  ExtensionManagerSnapshot,
  GameSupportExtensionManagerClient,
  GameSupportApplyResult,
  GameSupportPlan,
} from '@modkit/extension-manager'
import { createGameSupportPlan, gameSupportPlansEqual } from '@modkit/extension-manager'
import type { NodeExtensionManager } from '@modkit/extension-manager/node'

import type { ManagedExtensionRootRequest } from './extension-roots.js'

export {
  createExtensionManagerClient,
  type ExtensionManagerClient,
  type ExtensionManagerEntry,
  type ExtensionManagerSnapshot,
  type GameSupportExtensionManagerClient,
  type GameSupportApplyResult,
  type GameSupportPlan,
} from '@modkit/extension-manager'

/** A root already supplied by the build, workspace, or manual `modkit.extensions` configuration. */
export interface StaticExtensionPackage {
  readonly entry: ExtensionManagerEntry
}

export interface VsCodeManagedExtensionState {
  /** Every installed extension root, including roots owned by a disabled package. */
  readonly roots: readonly ManagedExtensionRootRequest[]
  /** Extension coordinates whose owning distribution package is disabled. */
  readonly disabledExtensions: readonly string[]
  /** Exact package owner for each installed extension coordinate. */
  readonly packageByExtension: ReadonlyMap<string, string>
}

export interface CreateVsCodeExtensionManagerClientOptions {
  readonly client: GameSupportExtensionManagerClient
  readonly staticPackages?: () => readonly StaticExtensionPackage[]
}

/**
 * Read enabled manager roots for one host composition. Calling this again on reload is important:
 * package enablement belongs to the manager, never to `modkit.extensions`.
 */
export async function installedManagerExtensionRoots(
  manager: Pick<NodeExtensionManager, 'installedRoots'>,
): Promise<readonly ManagedExtensionRootRequest[]> {
  const roots = await manager.installedRoots()
  return Object.freeze([
    ...roots.map(root => Object.freeze({ root: root.root, expectedId: root.expectedId })),
  ])
}

/**
 * Read the complete manager inventory without using package enablement as a root filter.
 *
 * Package enablement is an activation decision. Keeping disabled package roots here lets the host
 * retain their manifests, contributions and cards while `disabledExtensions` makes every owned
 * contribution ineligible.
 */
export async function installedManagerExtensionState(
  manager: Pick<NodeExtensionManager, 'artifactStore' | 'enablementStore'>,
): Promise<VsCodeManagedExtensionState> {
  const [packages, enablement] = await Promise.all([
    manager.artifactStore.list(),
    manager.enablementStore.list(),
  ])
  const enabled = new Map(enablement.map(entry => [entry.id, entry.enabled]))
  const roots: ManagedExtensionRootRequest[] = []
  const disabledExtensions = new Set<string>()
  const packageByExtension = new Map<string, string>()
  for (const installed of packages) {
    const packageEnabled = enabled.get(installed.id) === true
    for (const item of installed.roots) {
      if (typeof item.root !== 'string' || !isAbsolute(item.root)) {
        throw new TypeError(`installed extension root is not absolute: ${String(item.root)}`)
      }
      if (typeof item.expectedId !== 'string' || item.expectedId.trim().length === 0) {
        throw new TypeError(`installed package ${installed.id} contains an unnamed extension root`)
      }
      roots.push(Object.freeze({ root: resolve(item.root), expectedId: item.expectedId }))
      packageByExtension.set(item.expectedId, installed.id)
      if (!packageEnabled) disabledExtensions.add(item.expectedId)
    }
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    disabledExtensions: Object.freeze([...disabledExtensions].sort()),
    packageByExtension,
  })
}

/**
 * Add immutable build/workspace/manual rows to the shared package-level manager view.
 *
 * Trust, catalog selection, acquisition, enablement and every package mutation remain entirely in
 * the shared client. This adapter has no configuration port by design, so manager commands cannot
 * mirror package roots into the user's hand-authored `modkit.extensions` setting.
 */
export function createVsCodeExtensionManagerClient(
  options: CreateVsCodeExtensionManagerClientOptions,
): GameSupportExtensionManagerClient {
  const staticPackages = (): readonly StaticExtensionPackage[] => options.staticPackages?.() ?? []
  const staticPackage = (id: string): StaticExtensionPackage | undefined =>
    staticPackages().find(entry => entry.entry.id === id)

  /**
   * A build/workspace/settings row can declare support for a game even though it does not exist
   * in the mutable package catalogue. Keep that fact in game plans: otherwise a locally supplied
   * game looks unavailable simply because there is nothing to download.
   */
  const mergedSnapshot = async (): Promise<ExtensionManagerSnapshot> => {
    const shared = await options.client.snapshot()
    const rows = new Map(staticPackages().map(item => [item.entry.id, item.entry]))
    for (const entry of shared.entries) {
      if (rows.has(entry.id) && entry.installedVersion === undefined) continue
      rows.set(entry.id, entry)
    }
    return Object.freeze({
      entries: Object.freeze(
        [...rows.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ),
    })
  }

  const staticOnlyIds = async (): Promise<ReadonlySet<string>> => {
    const shared = await options.client.snapshot()
    const managed = new Set(
      shared.entries.filter(entry => entry.installedVersion !== undefined).map(entry => entry.id),
    )
    return new Set(
      staticPackages()
        .map(item => item.entry.id)
        .filter(id => !managed.has(id)),
    )
  }

  const planForMergedSnapshot = async (gameId: string): Promise<GameSupportPlan> => {
    const plan = createGameSupportPlan(await mergedSnapshot(), gameId)
    const immutable = await staticOnlyIds()
    const blocked = plan.actions
      .filter(action => immutable.has(action.packageId))
      .map(action =>
        Object.freeze({
          packageId: action.packageId,
          code: 'modkit/vscode-static-package-immutable',
          message: `${action.packageId} is supplied by the build, workspace or settings and cannot be changed here.`,
        }),
      )
    if (blocked.length === 0) return plan
    return Object.freeze({
      ...plan,
      blocked: Object.freeze([...plan.blocked, ...blocked]),
      ready: false,
    })
  }

  const requireManagedWhenStatic = async (id: string): Promise<void> => {
    if (staticPackage(id) === undefined) return
    const managed = (await options.client.snapshot()).entries.find(
      entry => entry.id === id && entry.installedVersion !== undefined,
    )
    if (managed === undefined) {
      throw new Error(
        `${id} is supplied by the build, workspace or settings and cannot be changed here`,
      )
    }
  }

  const client: GameSupportExtensionManagerClient = {
    async snapshot() {
      // An installed manager row wins and owns its enablement. An available-but-not-installed
      // catalog row must not hide an immutable build/workspace/manual package with the same id.
      return mergedSnapshot()
    },

    refresh: () => options.client.refresh(),

    async install(id, version) {
      await requireManagedWhenStatic(id)
      await options.client.install(id, version)
    },

    async update(id) {
      await requireManagedWhenStatic(id)
      await options.client.update(id)
    },

    async remove(id) {
      await requireManagedWhenStatic(id)
      await options.client.remove(id)
    },

    async setEnabled(id, enabled) {
      await requireManagedWhenStatic(id)
      await options.client.setEnabled(id, enabled)
    },

    planGameSupport: planForMergedSnapshot,

    async applyGameSupport(plan) {
      const gameId = plan.game.id
      const current = await planForMergedSnapshot(gameId)
      if (!gameSupportPlansEqual(plan, current)) {
        throw new Error('game support plan no longer matches the current Modkit installation')
      }
      if (!current.ready) {
        throw new Error('game support plan contains packages that cannot be changed here')
      }

      // A game supplied entirely by the build/workspace is already active. There is no catalogue
      // plan to delegate, but returning a normal no-op result keeps every shell on one contract.
      const sharedSnapshot = await options.client.snapshot()
      const sharedMatches = sharedSnapshot.entries.some(entry =>
        entry.presentation?.games?.some(game => game.id === gameId),
      )
      if (!sharedMatches) {
        return Object.freeze({
          schemaVersion: 1 as const,
          game: current.game,
          status: 'applied' as const,
          applied: Object.freeze([]),
          rollback: Object.freeze([]),
        })
      }

      // The shared manager verifies plans against its own catalogue snapshot. Static targets do
      // not need an action, so delegate the equivalent mutable-only plan rather than weakening
      // its stale-plan or trust checks.
      const sharedPlan = createGameSupportPlan(sharedSnapshot, gameId)
      return options.client.applyGameSupport(sharedPlan)
    },
  }
  return Object.freeze(client)
}

export type ExtensionManagerCommand =
  | { readonly kind: 'install'; readonly id: string; readonly version?: string }
  | { readonly kind: 'update'; readonly id: string }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'set-enabled'; readonly id: string; readonly enabled: boolean }
  | { readonly kind: 'refresh' }

export function extensionManagerCommandCompletion(
  command: ExtensionManagerCommand,
  success: string,
): { readonly message: string; readonly reload: boolean } {
  const reload = command.kind !== 'refresh'
  return Object.freeze({
    message: `Modkit: ${success}${reload ? '. Reload the window for it to take effect.' : ''}`,
    reload,
  })
}

/** Small command layer shared by the tree view and command-palette adapters. */
export class ExtensionManagerController {
  private snapshotPromise: Promise<ExtensionManagerSnapshot> | undefined
  private readonly listeners = new Set<() => void>()
  /** Storage has changed, while this extension host still runs the composition from startup. */
  private readonly reloadPendingIds = new Set<string>()

  constructor(private readonly client: GameSupportExtensionManagerClient) {}

  snapshot(): Promise<ExtensionManagerSnapshot> {
    this.snapshotPromise ??= this.client.snapshot()
    return this.snapshotPromise
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  invalidate(): void {
    this.snapshotPromise = undefined
    for (const listener of this.listeners) listener()
  }

  /** Package ids whose manager state is current but whose runtime activation needs a reload. */
  pendingReloadIds(): readonly string[] {
    return Object.freeze([...this.reloadPendingIds].sort())
  }

  planGameSupport(gameId: string): Promise<GameSupportPlan> {
    return this.client.planGameSupport(gameId)
  }

  async applyGameSupport(plan: GameSupportPlan): Promise<GameSupportApplyResult> {
    const result = await this.client.applyGameSupport(plan)
    if (result.status !== 'rolled-back') {
      for (const action of result.applied) this.reloadPendingIds.add(action.packageId)
      if (result.failed !== undefined && 'packageId' in result.failed) {
        this.reloadPendingIds.add(result.failed.packageId)
      }
    }
    this.invalidate()
    return result
  }

  private async apply(command: ExtensionManagerCommand): Promise<void> {
    switch (command.kind) {
      case 'install':
        await this.client.install(command.id, command.version)
        break
      case 'update':
        await this.client.update(command.id)
        break
      case 'remove':
        await this.client.remove(command.id)
        break
      case 'set-enabled':
        await this.client.setEnabled(command.id, command.enabled)
        break
      case 'refresh':
        await this.client.refresh()
        break
    }
  }

  async execute(command: ExtensionManagerCommand): Promise<ExtensionManagerSnapshot> {
    await this.apply(command)
    if (command.kind !== 'refresh') this.reloadPendingIds.add(command.id)
    this.invalidate()
    return this.snapshot()
  }

  /** Execute a user-requested batch sequentially and publish one final tree refresh. */
  async executeBatch(
    commands: readonly ExtensionManagerCommand[],
  ): Promise<ExtensionManagerSnapshot> {
    try {
      for (const command of commands) {
        await this.apply(command)
        if (command.kind !== 'refresh') this.reloadPendingIds.add(command.id)
      }
    } finally {
      this.invalidate()
    }
    return this.snapshot()
  }
}
