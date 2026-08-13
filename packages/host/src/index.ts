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
  checkGrant,
  type Activation,
  type ActivationGrant,
  type ActivationRequest,
} from './security/gate.js'
