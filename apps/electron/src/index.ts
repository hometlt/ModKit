import { canonicalJsonStringify, isQualifiedId, ModkitError, uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  type ArtifactByteSource,
  type AnyDescriptor,
  type HostTopology,
  type OpenIntent,
  type PermissionGrant,
  type PresentationPlan,
  type PresentationSlot,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  createHostComposition,
  createServiceContractDefinitionRegistry,
  createServiceFacetMatcherProfileRegistry,
  openSubject,
  resolvePresentationPlan,
  registerServiceContractDefinitionsFromInventory,
  type ExtensionInput,
  type HostComposition,
  type OpenSubjectResult,
} from '@modkitx-x3/host'
import { loadExtensionDirectory, nodeRuntimeTargetBase } from '@modkitx-x3/host/node'

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
  'dialog.reopen-recent',
  'directory.list',
  'filesystem.read-file',
  'filesystem.write-file',
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
  | { readonly channel: 'dialog.reopen-recent'; readonly payload: { readonly path: string } }
  | { readonly channel: 'directory.list'; readonly payload: { readonly path: string } }
  | {
      readonly channel: 'filesystem.read-file'
      readonly payload: { readonly path: string; readonly maxBytes: number }
    }
  | {
      readonly channel: 'filesystem.write-file'
      readonly payload: { readonly path: string; readonly bytes: Uint8Array }
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
    case 'dialog.reopen-recent':
    case 'directory.list':
      return text(payload['path'])
    case 'filesystem.read-file':
      return (
        text(payload['path']) &&
        Number.isSafeInteger(payload['maxBytes']) &&
        Number(payload['maxBytes']) > 0
      )
    case 'filesystem.write-file':
      return text(payload['path']) && payload['bytes'] instanceof Uint8Array
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

export interface ElectronSubjectServices {
  readonly application: ElectronApp
  /** Lowercase extension hints for shell registration; detection remains inventory-owned. */
  readonly supportedExtensions: readonly string[]
  open(options: {
    readonly source: ArtifactByteSource
    readonly path: string
    readonly mediaType?: string
    readonly intent: Exclude<OpenIntent, 'probe'>
    readonly grant: PermissionGrant
    readonly budget: ResourceBudget
    readonly signal?: AbortSignal
  }): Promise<OpenSubjectResult>
}

interface ElectronPresentationTicket {
  readonly bindingId: string
  readonly sessionId: string
}

/** Resolve the renderer's inert stage catalog against one already-opened session descriptor. */
export async function resolveElectronPresentationPlan(
  descriptor: AnyDescriptor,
  catalog: readonly PresentationSlot[],
  selection: {
    readonly sessionId: string
    readonly contributionId: string
    readonly variantId: string
  },
): Promise<PresentationPlan> {
  const digest = (plan: PresentationPlan) => `canonical:${canonicalJsonStringify(plan)}`
  const resolved = await resolvePresentationPlan<ElectronPresentationTicket>({
    descriptor,
    candidates: catalog.map(slot => ({
      ...slot,
      eligible: slot.bindings.every(binding => {
        const contract = 'dataSource' in binding ? binding.dataSource : binding
        return descriptor.dataSources.some(
          source => source.contract === contract.contract && source.major === contract.major,
        )
      }),
    })),
    digest,
    ticketMatches: binding =>
      binding.ticket.bindingId === binding.bindingId &&
      binding.ticket.sessionId === selection.sessionId,
    async resolveBinding(binding) {
      return {
        ...binding,
        offerId: `session:${binding.bindingId}`,
        providerId: selection.contributionId,
        variantId: selection.variantId,
        ticket: { bindingId: binding.bindingId, sessionId: selection.sessionId },
      }
    },
  })
  return resolved.plan
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

/**
 * Load the generated first-party catalog into the privileged realm and prepare the one subject-open
 * pipeline used by Electron. The caller supplies explicit roots from the generated catalog; this
 * helper never scans the repository or trusts installed/linked extensions in-process.
 */
export async function createElectronSubjectServices(
  extensionRoots: readonly string[],
): Promise<ElectronSubjectServices> {
  const loaded = await Promise.all(extensionRoots.map(root => loadExtensionDirectory(root)))
  const bundled: readonly ExtensionInput[] = loaded.map(input => ({
    ...input,
    execution: { origin: 'bundled', allowTrustedInProcess: true },
  }))
  const application = await createElectronApp(bundled)
  const definitions = createServiceContractDefinitionRegistry({
    matcherProfiles: createServiceFacetMatcherProfileRegistry(),
    // Only generated first-party inputs reach this registry. Installed/linked extensions are never
    // promoted by this bootstrap and need an explicit namespace-delegation policy later.
    isNamespaceOwner: () => true,
    validateJsonSchemaRef: () => [],
  })
  const registrations = await registerServiceContractDefinitionsFromInventory(
    application.main.inventory,
    definitions,
  )
  const rejected = registrations.find(result => result.state === 'rejected')
  if (rejected !== undefined) {
    throw new ModkitError({
      code: 'x3.app/electron-contract-definition-rejected',
      message: 'a bundled service contract definition failed closed',
      context: { diagnostics: rejected.diagnostics },
    })
  }

  const supportedExtensions = Object.freeze(
    [
      ...new Set(
        application.main.inventory.extensions.flatMap(extension =>
          extension.contributions.flatMap(contribution => {
            const manifest = contribution.manifest
            if (manifest?.contract.id !== 'org.modkitx/codec-contribution') return []
            const spec = manifest.spec as { readonly match?: { readonly extensions?: unknown } }
            return Array.isArray(spec.match?.extensions)
              ? spec.match.extensions.filter(
                  (value): value is string => typeof value === 'string' && value.length > 0,
                )
              : []
          }),
        ),
      ),
    ].sort(),
  )

  const services: ElectronSubjectServices = {
    application,
    supportedExtensions,
    open: options =>
      openSubject({
        inventory: application.main.inventory,
        serviceDefinitions: definitions,
        target: application.main.target,
        ...options,
      }),
  }
  return Object.freeze(services)
}

export type ElectronSubjectRequest =
  | { readonly operation: 'open'; readonly path: string }
  | {
      readonly operation: 'call'
      readonly sessionId: string
      readonly contract: string
      readonly major: number
      readonly method: string
      readonly args: readonly unknown[]
      readonly handleId?: string
    }
  | { readonly operation: 'close'; readonly sessionId: string }

function boundedCloneValue(value: unknown, depth = 0, nodes = { count: 0 }): boolean {
  nodes.count += 1
  if (nodes.count > 10_000 || depth > 16) return false
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= 65_536
  if (ArrayBuffer.isView(value)) return value.byteLength <= 64 * 1024 * 1024
  if (value instanceof ArrayBuffer) return value.byteLength <= 64 * 1024 * 1024
  if (Array.isArray(value)) {
    return value.length <= 10_000 && value.every(item => boundedCloneValue(item, depth + 1, nodes))
  }
  if (!record(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 1_000 &&
    entries.every(([key, item]) => key.length <= 1024 && boundedCloneValue(item, depth + 1, nodes))
  )
}

/** Main-process validation for the narrow subject-session RPC exposed by preload. */
export function assertElectronSubjectRequest(value: unknown): ElectronSubjectRequest {
  if (!record(value) || !text(value['operation'])) {
    throw new ModkitError({
      code: 'x3.app/invalid-electron-subject-request',
      message: 'renderer sent a malformed Electron subject request',
    })
  }
  const valid =
    (value['operation'] === 'open' && text(value['path'])) ||
    (value['operation'] === 'close' && text(value['sessionId'])) ||
    (value['operation'] === 'call' &&
      text(value['sessionId']) &&
      typeof value['contract'] === 'string' &&
      isQualifiedId(value['contract']) &&
      Number.isSafeInteger(value['major']) &&
      Number(value['major']) >= 0 &&
      typeof value['method'] === 'string' &&
      /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$/u.test(value['method']) &&
      (value['handleId'] === undefined || text(value['handleId'])) &&
      Array.isArray(value['args']) &&
      boundedCloneValue(value['args']))
  if (!valid) {
    throw new ModkitError({
      code: 'x3.app/invalid-electron-subject-request',
      message: 'renderer sent a malformed Electron subject request',
    })
  }
  return value as unknown as ElectronSubjectRequest
}

export { createGrantedRoots, type GrantedRoots, type PathTools } from './roots.js'
