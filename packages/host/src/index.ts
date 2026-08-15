export {
  buildInventory,
  inventoryHasErrors,
  type ArtifactAttestationInput,
  type ExtensionInput,
  type Inventory,
  type InventoryContribution,
  type InventoryExtension,
  type InventoryRecord,
} from './inventory.js'
export {
  createHostContributionContractRegistry,
  PROVIDER_OFFER_INVENTORY_FACT,
  VIEWER_CONTRIBUTION_INVENTORY_FACT,
} from './contribution-registry.js'
export { offersFromInventory } from './offers.js'
export {
  createServiceContractDefinitionRegistry,
  registerServiceContractDefinitionsFromInventory,
  type ServiceContractDefinitionRegistryOptions,
} from './service-definitions.js'
export { resolveProvider, RESOLVER_VERSION } from './resolution/resolver.js'
export {
  createContractResolverPort,
  resolveServiceProvider,
  type ContractResolverRuntimeOptions,
  type FacetAwareProviderRequest,
} from './resolution/service-resolver.js'
export {
  buildLockEntry,
  buildLockKey,
  parsePolicyLock,
  replayPolicyLock,
  serializePolicyLock,
  type ProviderPolicyLock,
} from './resolution/lock.js'
export {
  activateContribution,
  resolveForActivation,
  SUPPORTED_EXECUTION_PROFILES,
  type Activation,
  type ActivationRequest,
  type ActivationTicket,
} from './security/gate.js'
export { assertRelativeEntrypoint, resolveContainedEntrypoint } from './security/entrypoint.js'
export {
  assembleSubjectDescriptor,
  createAssetSession,
  type AssetSessionOptions,
  type HostOperationContext,
  type HostOperationHandler,
  type ManagedAssetSession,
} from './session.js'
export { createV1DescriptorProjectionPort } from './v1-projection.js'
