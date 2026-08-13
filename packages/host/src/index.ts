export {
  buildInventory,
  inventoryHasErrors,
  type ExtensionInput,
  type Inventory,
  type InventoryContribution,
  type InventoryExtension,
} from './inventory.js'
export { resolveProvider, RESOLVER_VERSION } from './resolution/resolver.js'
export { buildLockEntry, buildLockKey, serializePolicyLock } from './resolution/lock.js'
export {
  activateContribution,
  issueActivationTicket,
  SUPPORTED_EXECUTION_PROFILES,
  type Activation,
  type ActivationRequest,
  type ActivationTicket,
} from './security/gate.js'
export { assertRelativeEntrypoint, resolveContainedEntrypoint } from './security/entrypoint.js'
