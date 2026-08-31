/** Production inventory-fact -> provider-offer catalog projection (A-2). */

import {
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  isQualifiedId,
  isTraitId,
  parseSemver,
  type OperationId,
} from '@modkit/core'
import type {
  ContractOffer,
  ContractRequirement,
  JsonValue,
  ProviderOffer,
  RuntimeTargetConstraint,
  TraitDefinitionOffer,
} from '@modkit/sdk'
import { PROVIDER_OFFER_INVENTORY_FACT } from './contribution-registry.js'
import {
  inventoryRecordFor,
  type Inventory,
  type InventoryContribution,
  type InventoryRecord,
} from './inventory.js'

interface OfferInventoryBinding {
  readonly contribution: InventoryContribution
  readonly record: InventoryRecord
  readonly offerFingerprint: string
}

const offerBindings = new WeakMap<ProviderOffer, OfferInventoryBinding>()

export function inventoryBindingForOffer(offer: ProviderOffer): OfferInventoryBinding | undefined {
  return offerBindings.get(offer)
}

function object(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Readonly<Record<string, JsonValue>>
}

function string(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-blank string`)
  }
  return value
}

function safeMajor(value: JsonValue | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a safe non-negative integer`)
  }
  return value as number
}

function parseRequirement(value: JsonValue, label: string): ContractRequirement {
  const item = object(value, label)
  return Object.freeze({
    contract: contractId(string(item.contract, `${label}.contract`)),
    major: safeMajor(item.major, `${label}.major`),
    ...(item.range === undefined ? {} : { range: string(item.range, `${label}.range`) }),
  })
}

function parseContractOffer(value: JsonValue, label: string): ContractOffer {
  const item = object(value, label)
  const version = string(item.version, `${label}.version`)
  const major = safeMajor(item.major, `${label}.major`)
  const parsed = parseSemver(version)
  if (parsed === undefined || parsed.major !== major) {
    throw new TypeError(`${label}.version must be exact SemVer in declared major`)
  }
  return Object.freeze({
    offerId: string(item.offerId, `${label}.offerId`),
    contract: contractId(string(item.contract, `${label}.contract`)),
    major,
    version,
    ...(item.facet === undefined ? {} : { facet: item.facet }),
  })
}

function parseOutputs(value: JsonValue | undefined): readonly TraitDefinitionOffer[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TypeError('outputs must be an array')
  return Object.freeze(
    value.map((raw, index) => {
      const item = object(raw, `outputs[${index}]`)
      const id = string(item.id, `outputs[${index}].id`)
      if (!isTraitId(id)) throw new TypeError(`outputs[${index}].id is not a trait id`)
      return Object.freeze({
        id,
        ...(item.definitionVersion === undefined
          ? {}
          : {
              definitionVersion: string(
                item.definitionVersion,
                `outputs[${index}].definitionVersion`,
              ),
            }),
      })
    }),
  )
}

function parseTarget(value: JsonValue | undefined): RuntimeTargetConstraint {
  const target = object(value as JsonValue, 'target')
  // This fact came from a schema-validated runtime variant. Snapshotting here severs any
  // remaining caller references; the resolver is the final semantic target gate.
  return JSON.parse(canonicalJsonStringify(target)) as RuntimeTargetConstraint
}

function parseProviderOffer(value: JsonValue): ProviderOffer {
  const item = object(value, 'provider offer fact')
  const provides = item.provides
  if (!Array.isArray(provides) || provides.length === 0) {
    throw new TypeError('provider offer fact needs at least one logical offer')
  }
  const kind = item.kind
  if (
    !['primary', 'replacement', 'augmentation', 'projection', 'operation'].includes(String(kind))
  ) {
    throw new TypeError('provider offer kind is invalid')
  }
  const providerId = string(item.providerId, 'providerId')
  if (!isQualifiedId(providerId)) throw new TypeError('providerId must be qualified')
  const parseRequirementArray = (
    raw: JsonValue | undefined,
    label: string,
  ): readonly ContractRequirement[] | undefined => {
    if (raw === undefined) return undefined
    if (!Array.isArray(raw)) throw new TypeError(`${label} must be an array`)
    return Object.freeze(raw.map((entry, index) => parseRequirement(entry, `${label}[${index}]`)))
  }
  const operations = item.operations
  if (operations !== undefined && !Array.isArray(operations)) {
    throw new TypeError('operations must be an array')
  }
  const requires = parseRequirementArray(item.requires, 'requires')
  const outputs = parseOutputs(item.outputs)
  const requiredPermissions = item.requiredPermissions
  if (requiredPermissions !== undefined && !Array.isArray(requiredPermissions)) {
    throw new TypeError('requiredPermissions must be an array')
  }
  return Object.freeze({
    kind: kind as ProviderOffer['kind'],
    extensionId: string(item.extensionId, 'extensionId'),
    extensionVersion: string(item.extensionVersion, 'extensionVersion'),
    providerId,
    runtimeVariant: string(item.runtimeVariant, 'runtimeVariant'),
    target: parseTarget(item.target),
    ...(requiredPermissions === undefined
      ? {}
      : {
          requiredPermissions: requiredPermissions as NonNullable<
            ProviderOffer['requiredPermissions']
          >,
        }),
    provides: Object.freeze(
      provides.map((entry, index) => parseContractOffer(entry, `provides[${index}]`)),
    ),
    ...(requires === undefined ? {} : { requires }),
    ...(outputs === undefined ? {} : { outputs }),
    ...(operations === undefined
      ? {}
      : {
          operations: Object.freeze(
            operations.map((entry, index) => string(entry, `operations[${index}]`) as OperationId),
          ),
        }),
    ...(item.replaces === undefined
      ? {}
      : { replaces: parseRequirement(item.replaces, 'replaces') }),
  })
}

/** Deterministic production catalog. Malformed trusted projections fail closed. */
export function offersFromInventory(inventory: Inventory): readonly ProviderOffer[] {
  const catalog: ProviderOffer[] = []
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.activationEligible) continue
      const privateRecord = inventoryRecordFor(contribution)
      if (privateRecord === undefined || contribution.record === undefined) continue
      for (const fact of contribution.facts) {
        if (fact.contract.id !== PROVIDER_OFFER_INVENTORY_FACT || fact.contract.major !== 1) {
          continue
        }
        const offer = parseProviderOffer(fact.value)
        const offerFingerprint = canonicalJsonStringify(offer)
        offerBindings.set(offer, {
          contribution,
          record: privateRecord.publicRecord,
          offerFingerprint,
        })
        catalog.push(offer)
      }
    }
  }
  return Object.freeze(
    catalog.sort((left, right) =>
      compareUtf8(canonicalJsonStringify(left), canonicalJsonStringify(right)),
    ),
  )
}
