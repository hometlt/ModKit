/** Host routing for generic subject-independent extension operations. */

import { contractId, diagnostic, type Diagnostic } from '@modkit/core'
import {
  SERVICE_OPERATION_MATCHER_PROFILE,
  SERVICE_OPERATION_PROVIDER_CONTRACT,
  type JsonValue,
  type PermissionGrant,
  type ResourceBudget,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
  type ServiceContractDefinitionSpecV1Wire,
  type ServiceFacetMatchContext,
  type ServiceFacetMatchResult,
  type ServiceFacetMatcherProfile,
  type ServiceOperationDescriptor,
  type ServiceOperationProvider,
  type ServiceOperationProviderOfferFacet,
  type ServiceOperationProviderRequestFacet,
  type ServiceOperationResult,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import type { Inventory } from './inventory.js'
import { createHostServiceResolver } from './service-leases.js'

export const STANDARD_SERVICE_OPERATION_OWNER = 'modkit/service-operations'

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function operationIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmpty)) return undefined
  return new Set(value).size === value.length ? value : undefined
}

function parseOffer(value: unknown): ServiceOperationProviderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => key !== 'operationIds')) return undefined
  const ids = operationIds(record['operationIds'])
  return ids === undefined ? undefined : { operationIds: ids }
}

function parseRequest(value: unknown): ServiceOperationProviderRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => key !== 'operationId')) return undefined
  return nonEmpty(record['operationId']) ? { operationId: record['operationId'] } : undefined
}

function matchServiceOperation(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/service-operation-facet-invalid',
          `${context.contract}@${context.major}: operation request and offer routes must be well formed`,
        ),
      ],
    }
  }
  return offer.operationIds.includes(request.operationId)
    ? { state: 'match', selectionKey: `operation=${request.operationId}` }
    : { state: 'no-match' }
}

export const SERVICE_OPERATION_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(SERVICE_OPERATION_MATCHER_PROFILE),
  major: 1,
  match: matchServiceOperation,
})

export const SERVICE_OPERATION_PROVIDER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/service-operation-provider-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/service-operation-provider-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: SERVICE_OPERATION_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.runtime/operation-provider-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'providerId', 'operations']),
      methods: Object.freeze({
        invoke: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

export function registerStandardServiceOperationDefinitions(
  definitions: ServiceContractDefinitionRegistry,
) {
  return definitions.replaceOwnerInventory(STANDARD_SERVICE_OPERATION_OWNER, [
    {
      definition: SERVICE_OPERATION_PROVIDER_CONTRACT_DEFINITION,
      provenance: {
        ownerExtensionId: STANDARD_SERVICE_OPERATION_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: 'host:common.runtime/operation-provider@1',
        manifestDigest: 'host:common.runtime/operation-provider@1',
        artifactDigest: 'host:standard-service-operation-definition',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-service-operation-definition',
      },
    },
  ])
}

export interface ServiceOperationHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface InvokeServiceOperationRequest {
  readonly services: ServiceOperationHostServices
  readonly operationId: string
  readonly input: JsonValue
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type ServiceOperationInvocation =
  | Readonly<{
      state: 'invoked'
      descriptor: ServiceOperationDescriptor
      result: ServiceOperationResult
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{ state: 'unresolved'; diagnostics: readonly Diagnostic[] }>

function isProvider(value: unknown): value is ServiceOperationProvider {
  const record = recordOf(value)
  return (
    record?.['contract'] === SERVICE_OPERATION_PROVIDER_CONTRACT &&
    nonEmpty(record['providerId']) &&
    Array.isArray(record['operations']) &&
    typeof record['invoke'] === 'function'
  )
}

/** Resolve, invoke and release one exact extension operation through the common provider plane. */
export async function invokeServiceOperation(
  request: InvokeServiceOperationRequest,
): Promise<ServiceOperationInvocation> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/service-operation-unavailable',
          'this host registered no service-contract definitions',
        ),
      ],
    }
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  try {
    const lease = await resolver.port.resolve({
      contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
      major: 1,
      facet: { operationId: request.operationId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isProvider(lease.value)) {
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-provider-invalid',
            'the selected operation provider has an invalid runtime surface',
          ),
        ],
      }
    }
    const descriptor = lease.value.operations.find(item => item.id === request.operationId)
    if (descriptor === undefined) {
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-descriptor-missing',
            `the selected provider did not publish ${request.operationId}`,
          ),
        ],
      }
    }
    const result = await lease.value.invoke({
      operationId: request.operationId,
      input: request.input,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    return Object.freeze({
      state: 'invoked' as const,
      descriptor,
      result,
      diagnostics: Object.freeze([...resolver.diagnostics]),
    })
  } catch (error) {
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/service-operation-unresolved',
          `no provider resolved for ${request.operationId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  } finally {
    await resolver.release()
  }
}
