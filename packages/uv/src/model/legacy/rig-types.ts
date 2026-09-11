/**
 * Type-only binding for unmodified MK2 kernels. Their objects use optional JS properties which
 * JSON emission omits. Explicit JOINTS_0 admits the frozen member access under MK3's strict
 * noPropertyAccessFromIndexSignature setting; no compiler flag or algorithm is changed.
 */
export type UvmJsonValue = string | number | boolean | null | UvmJsonValue[] | UvmJsonObject
export interface UvmJsonObject {
  [key: string]: UvmJsonValue | undefined
  JOINTS_0?: number
}
