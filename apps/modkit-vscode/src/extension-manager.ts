import type {
  ExtensionManagerClient,
  ExtensionManagerEntry,
  ExtensionManagerSnapshot,
} from '@modkitx/extension-manager'
import type { NodeExtensionManager } from '@modkitx/extension-manager/node'

import type { ManagedExtensionRootRequest } from './extension-roots.js'

export {
  createExtensionManagerClient,
  type ExtensionManagerClient,
  type ExtensionManagerEntry,
  type ExtensionManagerSnapshot,
} from '@modkitx/extension-manager'

/** A root already supplied by the build, workspace, or manual `modkit.extensions` configuration. */
export interface StaticExtensionPackage {
  readonly entry: ExtensionManagerEntry
}

export interface CreateVsCodeExtensionManagerClientOptions {
  readonly client: ExtensionManagerClient
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
 * Add immutable build/workspace/manual rows to the shared package-level manager view.
 *
 * Trust, catalog selection, acquisition, enablement and every package mutation remain entirely in
 * the shared client. This adapter has no configuration port by design, so manager commands cannot
 * mirror package roots into the user's hand-authored `modkit.extensions` setting.
 */
export function createVsCodeExtensionManagerClient(
  options: CreateVsCodeExtensionManagerClientOptions,
): ExtensionManagerClient {
  const staticPackages = (): readonly StaticExtensionPackage[] => options.staticPackages?.() ?? []
  const staticPackage = (id: string): StaticExtensionPackage | undefined =>
    staticPackages().find(entry => entry.entry.id === id)

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

  const client: ExtensionManagerClient = {
    async snapshot() {
      // An installed manager row wins and owns its enablement. An available-but-not-installed
      // catalog row must not hide an immutable build/workspace/manual package with the same id.
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

  constructor(private readonly client: ExtensionManagerClient) {}

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

  async execute(command: ExtensionManagerCommand): Promise<ExtensionManagerSnapshot> {
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
    this.invalidate()
    return this.snapshot()
  }
}
