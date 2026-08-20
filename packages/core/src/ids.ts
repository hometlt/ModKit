/**
 * Logical ID grammars (owner: MK3/23 §3).
 *
 * ABNF: atom = 1*(lower / digit); segment = atom *("-" atom);
 * dotted = segment *("." segment); qualified = dotted "/" dotted.
 * Versions are separate fields; `@<major>` belongs to display strings only and is
 * rejected by these validators.
 */

declare const CONTRACT_ID_BRAND: unique symbol
declare const TRAIT_ID_BRAND: unique symbol
declare const OPERATION_ID_BRAND: unique symbol

/** Validated runtime IDs. Wire schemas still carry strings and brand them after validation. */
export type ContractId = string & { readonly [CONTRACT_ID_BRAND]: true }
export type ProviderId = string
export type ExtensionId = string
/** Wire-facing diagnostics remain strings; constructors and persistent schemas validate them. */
export type ErrorCode = string
export type TraitId = string & { readonly [TRAIT_ID_BRAND]: true }
export type OperationId = string & { readonly [OPERATION_ID_BRAND]: true }
export type ContractIdLiteral<Value extends string> = ContractId & Value
export type ErrorCodeLiteral<Value extends string> = Value
export type TraitIdLiteral<Value extends string> = TraitId & Value
export type OperationIdLiteral<Value extends string> = OperationId & Value

/** Compile-time coarse shapes; runtime constructors enforce the complete grammar below. */
export type QualifiedIdLiteral<Value extends string> =
  Value extends Lowercase<Value>
    ? Value extends `${infer Namespace}/${infer Local}`
      ? Namespace extends ''
        ? never
        : Local extends ''
          ? never
          : Value
      : never
    : never

export type DottedIdLiteral<Value extends string> =
  Value extends Lowercase<Value>
    ? Value extends `${infer Namespace}.${infer Local}`
      ? Namespace extends ''
        ? never
        : Local extends ''
          ? never
          : Value
      : never
    : never

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

/** Runtime guard for values crossing the JSON wire boundary. */
export function isContractId(value: string): value is ContractId {
  return isQualifiedId(value)
}

export function isErrorCode(value: string): value is ErrorCode {
  return isQualifiedId(value)
}

/** Runtime guard for values crossing the JSON wire boundary. */
export function isTraitId(value: string): value is TraitId {
  return value.includes('.') && isDottedId(value)
}

export function contractId<const Value extends string>(
  value: string extends Value ? Value : QualifiedIdLiteral<Value>,
): ContractIdLiteral<Value> {
  if (!isQualifiedId(value)) throw new TypeError(`invalid contract id: ${value}`)
  return value as unknown as ContractIdLiteral<Value>
}

export function errorCode<const Value extends string>(
  value: string extends Value ? Value : QualifiedIdLiteral<Value>,
): ErrorCodeLiteral<Value> {
  if (!isErrorCode(value)) throw new TypeError(`invalid diagnostic/error code: ${value}`)
  return value as unknown as ErrorCodeLiteral<Value>
}

export function traitId<const Value extends string>(
  value: string extends Value ? Value : DottedIdLiteral<Value>,
): TraitIdLiteral<Value> {
  if (!isTraitId(value)) throw new TypeError(`invalid trait id: ${value}`)
  return value as unknown as TraitIdLiteral<Value>
}

export const OPERATION_DOMAINS = Object.freeze([
  'archive',
  'model',
  'image',
  'audio',
  'video',
  'vector',
  'document',
  'game',
  'map',
  'mod',
  'data',
  'script',
  'layout',
  'localization',
  'replay',
  'save',
  'runtime',
] as const)

export type OperationDomain = (typeof OPERATION_DOMAINS)[number]

/** Standard container member read: `{ entryId }` in, extracted `bytes` out. */
export const CONTAINER_EXTRACT_OPERATION_ID = 'container.extract' as const

export const SHARED_OPERATION_IDS = Object.freeze([
  'view.render',
  'view.inspect',
  'view.thumbnail',
  'view.hex',
  'media.play',
  'media.play-pause',
  'media.seek',
  'media.set-rate',
  'media.select-track',
  'edit.content',
  'edit.structure',
  'edit.field',
  'edit.undo-redo',
  'source.save',
  'source.save-as',
  'export.raw',
  'export.convert',
  CONTAINER_EXTRACT_OPERATION_ID,
  'container.pack',
  'asset.search',
  'asset.validate',
  'asset.compare',
  'content.resolve-dependencies',
  'content.mount',
] as const)

export type SharedOperationId = (typeof SHARED_OPERATION_IDS)[number]

export type OperationIdFor<ContributionId extends string> =
  | SharedOperationId
  | `${OperationDomain}.${Lowercase<string>}`
  | `${ContributionId}.${Lowercase<string>}`

type SingleOperationVerb<Value extends string> =
  Value extends Lowercase<Value>
    ? Value extends `${string}.${string}` | `${string}/${string}`
      ? never
      : Value
    : never

type OwnedOperationLiteral<
  ContributionId extends string,
  Id extends string,
> = Id extends SharedOperationId
  ? Id
  : Id extends `${OperationDomain}.${infer Verb}`
    ? SingleOperationVerb<Verb> extends never
      ? never
      : Id
    : Id extends `${ContributionId}.${infer Verb}`
      ? SingleOperationVerb<Verb> extends never
        ? never
        : Id
      : never

/** AC §5: shared, declared-domain, and codec-local namespaces only. */
export function operationId<const ContributionId extends string, const Id extends string>(
  value: string extends Id ? Id : OwnedOperationLiteral<ContributionId, Id>,
  owner: {
    readonly contributionId: string extends ContributionId
      ? ContributionId
      : QualifiedIdLiteral<ContributionId>
  },
): OperationIdLiteral<Id> {
  if (!isQualifiedId(owner.contributionId)) {
    throw new TypeError(`invalid contribution id for operation ownership: ${owner.contributionId}`)
  }
  const codecPrefix = owner.contributionId
  const localSuffix = value.startsWith(`${codecPrefix}.`)
    ? value.slice(codecPrefix.length + 1)
    : undefined
  const canonicalDomain = OPERATION_DOMAINS.some(domain => {
    const prefix = `${domain}.`
    return value.startsWith(prefix) && isSegment(value.slice(prefix.length))
  })
  if (
    (SHARED_OPERATION_IDS as readonly string[]).includes(value) ||
    canonicalDomain ||
    (localSuffix !== undefined && isSegment(localSuffix))
  ) {
    return value as unknown as OperationIdLiteral<Id>
  }
  throw new TypeError(
    `operation id ${value} is outside shared, canonical domain, and ${codecPrefix} namespaces`,
  )
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
