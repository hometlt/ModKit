import { ModkitError } from '@modkitx-x3/core'
import {
  createHostTopology,
  hostRealmCacheKey,
  runtimeTargetForHostRealm,
  type ContributionContractRegistry,
  type HostRealmProfile,
  type HostTopology,
  type RuntimeTarget,
} from '@modkitx-x3/sdk'
import { createHostContributionContractRegistry } from './contribution-registry.js'
import { buildInventory, type ExtensionInput, type Inventory } from './inventory.js'
import { DEFAULT_EXECUTION_BACKENDS, type ExecutionBackendRegistry } from './execution/backend.js'

export interface HostCompositionOptions {
  readonly topology: HostTopology
  readonly realmId: string
  readonly extensions?: readonly ExtensionInput[]
  readonly contributionContracts?: ContributionContractRegistry
  readonly executionBackends?: ExecutionBackendRegistry
  /** Contribution ids switched off by the user; see `InventoryBuildOptions`. */
  readonly disabledContributions?: readonly string[]
}

export interface HostComposition {
  readonly topology: HostTopology
  readonly profile: HostRealmProfile
  readonly target: RuntimeTarget
  readonly profileCacheKey: string
  readonly inventory: Inventory
  /** Realm-specific mechanisms; availability is no longer inferred from a global profile list. */
  readonly executionBackends: ExecutionBackendRegistry
}

/**
 * Shared composition root used by leaf applications. It owns no product, format or viewer routing;
 * callers inject a topology, extension inputs and optional contribution-contract registrations.
 */
export async function createHostComposition(
  options: HostCompositionOptions,
): Promise<HostComposition> {
  const topology = createHostTopology(options.topology)
  const profile = topology.realms.find(candidate => candidate.realmId === options.realmId)
  if (profile === undefined) {
    throw new ModkitError({
      code: 'x3.host/unknown-composition-realm',
      message: `host topology «${topology.topologyId}» has no realm «${options.realmId}»`,
      context: { topologyId: topology.topologyId, realmId: options.realmId },
    })
  }
  const inventory = await buildInventory(
    options.extensions ?? [],
    options.contributionContracts ?? createHostContributionContractRegistry(),
    options.disabledContributions === undefined
      ? {}
      : { disabledContributions: options.disabledContributions },
  )
  return Object.freeze({
    topology,
    profile,
    target: runtimeTargetForHostRealm(profile),
    profileCacheKey: hostRealmCacheKey(profile),
    inventory,
    executionBackends: options.executionBackends ?? DEFAULT_EXECUTION_BACKENDS,
  })
}
