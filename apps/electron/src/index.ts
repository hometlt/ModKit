import { ModkitError, uint64 } from '@modkitx-x3/core'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import { createHostComposition, type ExtensionInput, type HostComposition } from '@modkitx-x3/host'
import { nodeRuntimeTargetBase } from '@modkitx-x3/host/node'

export const ELECTRON_MAIN_REALM = 'org.modkitx.app.electron/main'
export const ELECTRON_RENDERER_REALM = 'org.modkitx.app.electron/renderer'

/** Safe BrowserWindow defaults. The Electron adapter spreads these last and never weakens them. */
export const ELECTRON_SECURE_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const)

export const ELECTRON_BROKER_CHANNELS = Object.freeze([
  'filesystem.read-range',
  'filesystem.atomic-replace',
  'dialog.open-file',
  'dialog.open-directory',
  'dialog.accept-drop',
  'directory.list',
  'filesystem.read-file',
  'process.launch',
] as const)

export type ElectronBrokerChannel = (typeof ELECTRON_BROKER_CHANNELS)[number]

export type ElectronBrokerRequest =
  | {
      readonly channel: 'filesystem.read-range'
      readonly payload: {
        readonly handleId: string
        readonly offset: number
        readonly length: number
      }
    }
  | {
      readonly channel: 'filesystem.atomic-replace'
      readonly payload: { readonly handleId: string; readonly bytes: Uint8Array }
    }
  | { readonly channel: 'dialog.open-file'; readonly payload: { readonly requestId: string } }
  | { readonly channel: 'dialog.open-directory'; readonly payload: { readonly requestId: string } }
  | {
      readonly channel: 'dialog.accept-drop'
      readonly payload: { readonly paths: readonly string[] }
    }
  | { readonly channel: 'directory.list'; readonly payload: { readonly path: string } }
  | {
      readonly channel: 'filesystem.read-file'
      readonly payload: { readonly path: string; readonly maxBytes: number }
    }
  | {
      readonly channel: 'process.launch'
      readonly payload: { readonly toolId: string; readonly args: readonly string[] }
    }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}

export function isElectronBrokerRequest(value: unknown): value is ElectronBrokerRequest {
  if (!record(value) || !text(value['channel']) || !record(value['payload'])) return false
  const payload = value['payload']
  switch (value['channel']) {
    case 'filesystem.read-range':
      return (
        text(payload['handleId']) &&
        Number.isSafeInteger(payload['offset']) &&
        Number(payload['offset']) >= 0 &&
        Number.isSafeInteger(payload['length']) &&
        Number(payload['length']) >= 0
      )
    case 'filesystem.atomic-replace':
      return text(payload['handleId']) && payload['bytes'] instanceof Uint8Array
    case 'dialog.open-file':
    case 'dialog.open-directory':
      return text(payload['requestId'])
    case 'dialog.accept-drop':
      return (
        Array.isArray(payload['paths']) &&
        payload['paths'].length > 0 &&
        payload['paths'].length <= 64 &&
        payload['paths'].every(item => text(item))
      )
    case 'directory.list':
      return text(payload['path'])
    case 'filesystem.read-file':
      return (
        text(payload['path']) &&
        Number.isSafeInteger(payload['maxBytes']) &&
        Number(payload['maxBytes']) > 0
      )
    case 'process.launch':
      return (
        text(payload['toolId']) &&
        Array.isArray(payload['args']) &&
        payload['args'].length <= 128 &&
        payload['args'].every(item => typeof item === 'string' && item.length <= 4096)
      )
    default:
      return false
  }
}

export function assertElectronBrokerRequest(value: unknown): ElectronBrokerRequest {
  if (!isElectronBrokerRequest(value)) {
    throw new ModkitError({
      code: 'x3.app/invalid-electron-broker-request',
      message: 'renderer sent a malformed or non-allowlisted Electron broker request',
    })
  }
  return value
}

export function isAllowedElectronNavigation(target: string, applicationOrigin: string): boolean {
  try {
    const targetUrl = new URL(target)
    const originUrl = new URL(applicationOrigin)
    return targetUrl.origin === originUrl.origin && targetUrl.protocol === originUrl.protocol
  } catch {
    return false
  }
}

export function createElectronTopology(): HostTopology {
  const node = nodeRuntimeTargetBase()
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/electron',
    realms: [
      {
        schemaVersion: 1,
        realmId: ELECTRON_MAIN_REALM,
        revision: '1',
        target: node,
        facilities: [
          'credential.broker',
          'dialog.file-picker',
          'directory.watch',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native-process.rpc',
          'native.load',
          'process.launch',
          'window.custom-chrome',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 16,
          maxWorkerCount: 8,
          maxResidentBytes: uint64('8589934592'),
          maxTransferBytes: uint64('1073741824'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'org.modkitx.policy/electron-main', revision: '1' },
      },
      {
        schemaVersion: 1,
        realmId: ELECTRON_RENDERER_REALM,
        revision: '1',
        target: {
          environment: 'browser-main',
          operatingSystem: node.operatingSystem,
          architecture: node.architecture,
        },
        facilities: ['gpu.webgl2', 'worker.module'],
        budgets: {
          maxConcurrentTasks: 4,
          maxWorkerCount: 4,
          maxResidentBytes: uint64('2147483648'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'org.modkitx.policy/electron-renderer', revision: '1' },
      },
    ],
    links: [
      {
        fromRealm: ELECTRON_RENDERER_REALM,
        toRealm: ELECTRON_MAIN_REALM,
        transports: ['rpc-handle', 'stream', 'structured-clone', 'transferable-buffer'],
      },
      {
        fromRealm: ELECTRON_MAIN_REALM,
        toRealm: ELECTRON_RENDERER_REALM,
        transports: ['rpc-handle', 'stream', 'structured-clone', 'transferable-buffer'],
      },
    ],
  })
}

export interface ElectronApp {
  readonly topology: HostTopology
  readonly main: HostComposition
  readonly renderer: HostComposition
}

export async function createElectronApp(
  extensions: readonly ExtensionInput[] = [],
): Promise<ElectronApp> {
  const topology = createElectronTopology()
  const [main, renderer] = await Promise.all([
    createHostComposition({ topology, realmId: ELECTRON_MAIN_REALM, extensions }),
    createHostComposition({ topology, realmId: ELECTRON_RENDERER_REALM, extensions }),
  ])
  return Object.freeze({ topology, main, renderer })
}

export { createGrantedRoots, type GrantedRoots, type PathTools } from './roots.js'
