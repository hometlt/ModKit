import type {
  Architecture,
  HostBudgets,
  HostFacilityId,
  HostPolicyRef,
  HostRealmProfile,
  HostTransportKind,
  HostTransportLink,
  OperatingSystem,
  RuntimeTargetBase,
} from '@modkitx-x3/sdk'

function operatingSystem(): Exclude<OperatingSystem, 'any'> {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

function architecture(): Exclude<Architecture, 'any'> {
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm') return 'arm32'
  if (process.arch === 'arm64') return 'arm64'
  return 'x64'
}

export function nodeRuntimeTargetBase(): RuntimeTargetBase {
  return Object.freeze({
    environment: 'node',
    operatingSystem: operatingSystem(),
    architecture: architecture(),
  })
}

/**
 * The realm a Node host spawns `worker_threads` into: portable (`worker-brokered`) variants
 * declare `node-worker`, so a composition root that resolves for this target selects them and the
 * Node worker backend honours them (R‑A2/W4 in IMPLEMENTATION_NOTES).
 */
export function nodeWorkerRuntimeTargetBase(): RuntimeTargetBase {
  return Object.freeze({
    environment: 'node-worker',
    operatingSystem: operatingSystem(),
    architecture: architecture(),
  })
}

export interface NodeWorkerRealmOptions {
  readonly realmId: string
  readonly revision?: string
  /** Facilities the worker realm may claim; workers reach the host only through the broker. */
  readonly facilities?: readonly HostFacilityId[]
  readonly budgets: HostBudgets
  readonly policy: HostPolicyRef
}

/**
 * The `node-worker` realm a Node composition root adds next to its host realm: the target every
 * portable variant is resolved and activated for. Facilities default to none — a worker owns no
 * ambient facility of its own; what it gets, it gets brokered from the host realm.
 */
export function nodeWorkerRealmProfile(options: NodeWorkerRealmOptions): HostRealmProfile {
  return Object.freeze({
    schemaVersion: 1,
    realmId: options.realmId,
    revision: options.revision ?? '1',
    target: nodeWorkerRuntimeTargetBase(),
    facilities: Object.freeze([...(options.facilities ?? [])]),
    budgets: options.budgets,
    policy: options.policy,
  })
}

/** Transports a Node host and its worker realm share: structured clone, transfer, RPC handles. */
export const NODE_WORKER_LINK_TRANSPORTS: readonly HostTransportKind[] = Object.freeze([
  'rpc-handle',
  'stream',
  'structured-clone',
  'transferable-buffer',
])

/** The two directed links between a Node host realm and its worker realm. */
export function nodeWorkerLinks(
  hostRealm: string,
  workerRealm: string,
): readonly HostTransportLink[] {
  return Object.freeze([
    { fromRealm: hostRealm, toRealm: workerRealm, transports: NODE_WORKER_LINK_TRANSPORTS },
    { fromRealm: workerRealm, toRealm: hostRealm, transports: NODE_WORKER_LINK_TRANSPORTS },
  ])
}
