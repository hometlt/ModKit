import { operationId } from '@modkit/core'
import type { AssetOperationDescriptor } from './assets/operations.js'

/** Known host operations retain native coordinates. Domain operations require an explicit map. */
export const LEGACY_OPERATION_IDS = Object.freeze({
  'view.inspect': 'view.inspect',
  'asset.validate': 'asset.validate',
  'export.raw': 'export.raw',
  'edit.content': 'edit.content',
  'source.save-as': 'source.save-as',
})
export function adaptOperationId(
  id: string,
  owner: { contributionId: string },
  domain: Readonly<Record<string, string>> = {},
): ReturnType<typeof operationId> {
  const target = domain[id] ?? (LEGACY_OPERATION_IDS as Readonly<Record<string, string>>)[id]
  if (target === undefined)
    throw new TypeError(`Legacy operation ${id} requires an explicit MK3 operation mapping`)
  return operationId(target, owner)
}
export function adaptOperationState(operation: AssetOperationDescriptor) {
  return {
    id: operation.id,
    handlerId: operation.handlerId ?? operation.id,
    state: operation.state,
    mutatesSource: operation.mutatesSource,
    ...(operation.reason === undefined ? {} : { reason: operation.reason }),
    ...(operation.permissions === undefined ? {} : { permissions: operation.permissions }),
    ...(operation.diagnosticIds === undefined ? {} : { diagnosticIds: operation.diagnosticIds }),
  }
}
