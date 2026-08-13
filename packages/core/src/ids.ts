/**
 * Logical ID grammars (owner: MK3/23 §3).
 *
 * ABNF: atom = 1*(lower / digit); segment = atom *("-" atom);
 * dotted = segment *("." segment); qualified = dotted "/" dotted.
 * Versions are separate fields; `@<major>` belongs to display strings only and is
 * rejected by these validators.
 */

export type ContractId = string
export type ProviderId = string
export type ExtensionId = string
export type ErrorCode = string
export type TraitId = string
export type OperationId = string

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DOTTED = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/
const QUALIFIED =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/

/** One `segment` (runtime variant ids). */
export function isSegment(value: string): boolean {
  return SEGMENT.test(value)
}

/** Existing validated dotted grammar (trait ids like `image.raster`, operation ids). */
export function isDottedId(value: string): boolean {
  return DOTTED.test(value)
}

/** `namespace/name` qualified form (contract/provider/extension/error ids). */
export function isQualifiedId(value: string): boolean {
  return QUALIFIED.test(value)
}

export interface QualifiedId {
  readonly namespace: string
  readonly name: string
}

export function parseQualifiedId(value: string): QualifiedId | undefined {
  if (!isQualifiedId(value)) return undefined
  const slash = value.indexOf('/')
  return { namespace: value.slice(0, slash), name: value.slice(slash + 1) }
}
