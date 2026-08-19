/**
 * Operation-scoped permission classes (ADR-HOST-002 §2).
 *
 * A codec's runtime variant requests every class its code may use; the validator forces it to
 * include what its declared operations need (`requiredPermissions`, plus `write-source` for a
 * mutating one). Those operation-scoped classes are *capabilities*, not preconditions of opening:
 * a host that lacks them still resolves and activates the codec, narrows the grant, and disables
 * the operations that need them. Everything else a variant requests stays a hard requirement —
 * `read-source` always, and whatever the code needs to load or open.
 *
 * One definition, three consumers: the resolver-facing offer projection (requirements minus
 * capabilities), the gate (hard denial vs degradation) and the host's operation dispatch.
 */

import type { PermissionClass } from './contribution-types.js'

export interface OperationPermissionDeclaration {
  readonly mutatesSource?: boolean
  readonly requiredPermissions?: readonly PermissionClass[]
}

/** Classes only the declared operations need; `read-source` is never one of them. */
export function operationScopedPermissionClasses(
  operations: readonly OperationPermissionDeclaration[] | undefined,
): ReadonlySet<PermissionClass> {
  const out = new Set<PermissionClass>()
  for (const operation of operations ?? []) {
    for (const item of operation.requiredPermissions ?? []) out.add(item)
    if (operation.mutatesSource === true) out.add('write-source')
  }
  out.delete('read-source')
  return out
}

/** The classes a variant requests that are preconditions of resolving/activating it at all. */
export function activationRequiredPermissionClasses(
  requested: readonly PermissionClass[],
  operations: readonly OperationPermissionDeclaration[] | undefined,
): readonly PermissionClass[] {
  const scoped = operationScopedPermissionClasses(operations)
  return Object.freeze(requested.filter(item => !scoped.has(item)))
}
