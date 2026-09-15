/** Generic, subject-independent operations published by extension service providers. */

import type { Diagnostic } from '@modkit/core'
import type { JsonSchema } from './manifest/contribution-spec-types.js'
import type { PermissionClass } from './manifest/contribution-types.js'
import type { ServiceProviderModule } from './runtime-abi.js'
import type { JsonValue } from './asset-capabilities/types.js'

export const SERVICE_OPERATION_PROVIDER_CONTRACT =
  'common.runtime/operation-provider' as const
export const SERVICE_OPERATION_MATCHER_PROFILE =
  'modkit/service-operation-matcher' as const

export interface ServiceOperationBudget {
  readonly maxInputBytes: number
  readonly maxOutputBytes: number
  readonly maxWallTimeMs: number
}

/** Inert metadata used by command palettes, MCP discovery and other generic clients. */
export interface ServiceOperationDescriptor {
  readonly schemaVersion: 1
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly requiredPermissions: readonly PermissionClass[]
  readonly effects: 'none' | 'host-state' | 'external'
  readonly inputSchema: JsonSchema
  readonly resultSchema: JsonSchema
  readonly budget: ServiceOperationBudget
}

export interface ServiceOperationRequest {
  readonly operationId: string
  readonly input: JsonValue
  readonly signal?: AbortSignal
}

export type ServiceOperationResult =
  | Readonly<{
      state: 'completed'
      operationId: string
      value: JsonValue
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'refused' | 'failed'
      operationId: string
      code: string
      message: string
      diagnostics: readonly Diagnostic[]
    }>

export interface ServiceOperationProvider {
  readonly contract: typeof SERVICE_OPERATION_PROVIDER_CONTRACT
  readonly providerId: string
  readonly operations: readonly ServiceOperationDescriptor[]
  invoke(request: ServiceOperationRequest): Promise<ServiceOperationResult>
}

export interface ServiceOperationProviderOfferFacet {
  readonly operationIds: readonly string[]
}

export interface ServiceOperationProviderRequestFacet {
  readonly operationId: string
}

declare module './service-contracts.js' {
  interface ContractMap {
    'common.runtime/operation-provider': { 1: ServiceOperationProvider }
  }

  interface ContractRequestMap {
    'common.runtime/operation-provider': {
      1: { presence: 'required'; facet: ServiceOperationProviderRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.runtime/operation-provider': {
      1: { presence: 'required'; facet: ServiceOperationProviderOfferFacet }
    }
  }
}

export type ServiceOperationProviderModule = ServiceProviderModule<
  typeof SERVICE_OPERATION_PROVIDER_CONTRACT,
  1
>
