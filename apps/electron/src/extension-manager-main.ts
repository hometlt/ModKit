/** Electron-main composition of the public Node extension manager. */
import {
  createNodeExtensionManager,
  type CreateNodeExtensionManagerOptions,
  type NodeExtensionManager,
  type NodeExtensionVfsOptions,
  type NodeTrustedPublicKeys,
} from '@modkitx/extension-manager/node'

export type ElectronExtensionManagerBackend = NodeExtensionManager

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
