import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  type Architecture,
  type HostTopology,
  type OperatingSystem,
} from '@modkitx-x3/sdk'
import { createHostComposition, type ExtensionInput, type HostComposition } from '@modkitx-x3/host'
import { nodeRuntimeTargetBase } from '@modkitx-x3/host/node'

export const VSCODE_DESKTOP_EXTENSION_REALM = 'org.modkitx.app.vscode/desktop-extension'
export const VSCODE_WEB_EXTENSION_REALM = 'org.modkitx.app.vscode/web-extension'
export const VSCODE_WEBVIEW_REALM = 'org.modkitx.app.vscode/webview'

const desktopBudgets = () => ({
  maxConcurrentTasks: 12,
  maxWorkerCount: 6,
  maxResidentBytes: uint64('6442450944'),
  maxTransferBytes: uint64('536870912'),
  defaultDeadlineMs: 180_000,
})

const webviewBudgets = () => ({
  maxConcurrentTasks: 4,
  maxWorkerCount: 2,
  maxResidentBytes: uint64('1610612736'),
  maxTransferBytes: uint64('134217728'),
  defaultDeadlineMs: 120_000,
})

function bridgeLinks(extensionRealm: string) {
  const transports = ['rpc-handle', 'stream', 'structured-clone', 'transferable-buffer'] as const
  return [
    { fromRealm: extensionRealm, toRealm: VSCODE_WEBVIEW_REALM, transports },
    { fromRealm: VSCODE_WEBVIEW_REALM, toRealm: extensionRealm, transports },
  ]
}

export function createVsCodeDesktopTopology(): HostTopology {
  const node = nodeRuntimeTargetBase()
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/vscode-desktop',
    realms: [
      {
        schemaVersion: 1,
        realmId: VSCODE_DESKTOP_EXTENSION_REALM,
        revision: '1',
        target: node,
        facilities: [
          'credential.broker',
          'dialog.file-picker',
          'directory.watch',
          'editor.host-native',
          'extension.catalog.read',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native.load',
          'process.launch',
          'product.inventory.read',
          'worker.module',
        ],
        budgets: desktopBudgets(),
        policy: { id: 'org.modkitx.policy/vscode-desktop', revision: '1' },
      },
      {
        schemaVersion: 1,
        realmId: VSCODE_WEBVIEW_REALM,
        revision: '1',
        target: {
          environment: 'browser-main',
          operatingSystem: node.operatingSystem,
          architecture: node.architecture,
        },
        facilities: ['gpu.webgl2', 'worker.module'],
        budgets: webviewBudgets(),
        policy: { id: 'org.modkitx.policy/vscode-webview', revision: '1' },
      },
    ],
    links: bridgeLinks(VSCODE_DESKTOP_EXTENSION_REALM),
  })
}

export interface VsCodeWebIdentity {
  readonly operatingSystem: Exclude<OperatingSystem, 'any'>
  readonly architecture: Exclude<Architecture, 'any'>
}

export function createVsCodeWebTopology(identity: VsCodeWebIdentity): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/vscode-web',
    realms: [
      {
        schemaVersion: 1,
        realmId: VSCODE_WEB_EXTENSION_REALM,
        revision: '1',
        target: { environment: 'browser-worker', ...identity },
        facilities: ['editor.host-native', 'extension.catalog.read', 'network.range-fetch'],
        budgets: desktopBudgets(),
        policy: { id: 'org.modkitx.policy/vscode-web-extension', revision: '1' },
      },
      {
        schemaVersion: 1,
        realmId: VSCODE_WEBVIEW_REALM,
        revision: '1',
        target: { environment: 'browser-main', ...identity },
        facilities: ['gpu.webgl2', 'worker.module'],
        budgets: webviewBudgets(),
        policy: { id: 'org.modkitx.policy/vscode-webview', revision: '1' },
      },
    ],
    links: bridgeLinks(VSCODE_WEB_EXTENSION_REALM),
  })
}

export interface VsCodeApp {
  readonly topology: HostTopology
  readonly extensionHost: HostComposition
  readonly webview: HostComposition
}

async function compose(
  topology: HostTopology,
  extensionRealm: string,
  extensions: readonly ExtensionInput[],
): Promise<VsCodeApp> {
  const [extensionHost, webview] = await Promise.all([
    createHostComposition({ topology, realmId: extensionRealm, extensions }),
    createHostComposition({ topology, realmId: VSCODE_WEBVIEW_REALM, extensions }),
  ])
  return Object.freeze({ topology, extensionHost, webview })
}

export function createVsCodeDesktopApp(
  extensions: readonly ExtensionInput[] = [],
): Promise<VsCodeApp> {
  return compose(createVsCodeDesktopTopology(), VSCODE_DESKTOP_EXTENSION_REALM, extensions)
}

export function createVsCodeWebApp(
  identity: VsCodeWebIdentity,
  extensions: readonly ExtensionInput[] = [],
): Promise<VsCodeApp> {
  return compose(createVsCodeWebTopology(identity), VSCODE_WEB_EXTENSION_REALM, extensions)
}
