/** Compile-only negative proof for the primitive A-1 ID constructors. */

import {
  contractId,
  operationId,
  traitId,
  type ContractId,
  type OperationId,
  type TraitId,
} from '../src/index.js'

export const contract = contractId('org.example/codec')
export const trait = traitId('content.binary')
export const operation = operationId('data.parse', {
  contributionId: 'org.example/text-json',
})

// @ts-expect-error Raw strings have not passed the qualified-ID constructor.
export const rawContract: ContractId = 'org.example/codec'
// @ts-expect-error Raw strings have not passed the dotted trait-ID constructor.
export const rawTrait: TraitId = 'content.binary'
// @ts-expect-error Raw strings have not passed operation ownership validation.
export const rawOperation: OperationId = 'data.parse'
// @ts-expect-error Contracts use the qualified namespace/name grammar.
export const malformedContract = contractId('not-qualified')
// @ts-expect-error Traits require a dotted lower-case ID.
export const malformedTrait = traitId('Content')
// @ts-expect-error A codec cannot claim another codec's non-domain namespace.
export const stolenOperation = operationId('foreign-codec.decode', {
  contributionId: 'org.example/plain-text',
})

declare const dynamicContract: string
declare const dynamicTrait: string
export const parsedDynamicContract = contractId(dynamicContract)
export const parsedDynamicTrait = traitId(dynamicTrait)
