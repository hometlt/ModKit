/** Electron-main composition of the public Node extension manager. */
import { isAbsolute, resolve } from 'node:path'

import {
  createNodeExtensionManager,
  type CreateNodeExtensionManagerOptions,
  type NodeExtensionManager,
  type NodeExtensionVfsOptions,
  type NodeTrustedPublicKeys,
} from '@modkitx/extension-manager/node'

export type ElectronExtensionManagerBackend = NodeExtensionManager

export interface ElectronManagedExtensionState {
  /** Every installed root, including roots owned by a disabled distribution package. */
  readonly roots: readonly { readonly root: string; readonly expectedId: string }[]
  /** Root coordinates whose package-level switch is off. */
  readonly disabledExtensions: readonly string[]
}

export interface ElectronExtensionManagerBackendOptions {
  readonly registry: string
  readonly storeRoot: string
  readonly baseDirectory?: string
  readonly trustedPublicKeys?: NodeTrustedPublicKeys
  readonly fetch?: typeof globalThis.fetch
  readonly vfs?: CreateNodeExtensionManagerOptions['vfs']
  readonly vfsOptions?: NodeExtensionVfsOptions
}

/**
 * Electron adds no catalog, trust, acquisition, enablement or lifecycle implementation of its
 * own. The public Node manager is the sole source of truth for managed packages.
 */
export function createElectronExtensionManagerBackend(
  options: ElectronExtensionManagerBackendOptions,
): ElectronExtensionManagerBackend {
  return createNodeExtensionManager({
    root: options.storeRoot,
    catalog: options.registry,
    ...(options.baseDirectory === undefined ? {} : { baseDirectory: options.baseDirectory }),
    trustedPublicKeys: options.trustedPublicKeys ?? Object.freeze({}),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.vfs === undefined ? {} : { vfs: options.vfs }),
    ...(options.vfsOptions === undefined ? {} : { vfsOptions: options.vfsOptions }),
    channels: ['stable', 'preview', 'development'],
  })
}

/**
 * Reads materialized package roots without filtering disabled packages out of inventory.
 * Activation is a later host decision keyed by coordinate; this keeps cards and tree rows present.
 */
export async function readElectronManagedExtensionState(
  manager: ElectronExtensionManagerBackend,
): Promise<ElectronManagedExtensionState> {
  const [packages, enablement] = await Promise.all([
    manager.artifactStore.list(),
    manager.enablementStore.list(),
  ])
  const enabled = new Map(enablement.map(entry => [entry.id, entry.enabled]))
  const roots: { root: string; expectedId: string }[] = []
  const disabledExtensions = new Set<string>()
  for (const installed of packages) {
    const packageEnabled = enabled.get(installed.id) === true
    for (const root of installed.roots) {
      if (typeof root.root !== 'string' || !isAbsolute(root.root)) {
        throw new TypeError(`installed extension root is not absolute: ${root.root}`)
      }
      if (typeof root.expectedId !== 'string' || root.expectedId.trim() === '') {
        throw new TypeError('installed extension root has no expected coordinate')
      }
      roots.push({ root: resolve(root.root), expectedId: root.expectedId })
      if (!packageEnabled) disabledExtensions.add(root.expectedId)
    }
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    disabledExtensions: Object.freeze([...disabledExtensions].sort()),
  })
}
