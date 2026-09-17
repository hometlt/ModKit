/** Generic, subject-independent operations published by extension service providers. */

import type { Diagnostic } from '@modkit/core'
import type { JsonSchema } from './manifest/contribution-spec-types.js'
import type { PermissionClass } from './manifest/contribution-types.js'
import type { ServiceProviderModule } from './runtime-abi.js'
import type { JsonValue } from './asset-capabilities/types.js'

export const SERVICE_OPERATION_PROVIDER_CONTRACT = 'common.runtime/operation-provider' as const
export const SERVICE_OPERATION_MATCHER_PROFILE = 'modkit/service-operation-matcher' as const

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
  /**
   * Where a product should offer this operation, when it belongs in a view rather than only in a
   * command palette.
   *
   * This is how an extension extends a viewer without shipping code into it: the operation says
   * which viewer surface it belongs on and under what section heading, the viewer renders the
   * section from the declared input schema, and the extension's own code runs where it always did.
   */
  readonly surface?: ServiceOperationSurface
}

export interface ServiceOperationSurface {
  /** The viewer surface this belongs on. `viewer.image` is the image render view's sidebar. */
  readonly target: 'viewer.image'
  /** Section id and heading; operations sharing an id share one section. */
  readonly sectionId: string
  readonly title: string
  /** Codicon name for the section header. */
  readonly icon?: string
  /**
   * The controls the viewer draws, in the same form document a codec publishes for `edit.content`
   * (`{ schemaVersion: 1, forms: [...] }`). Omitted means one button and the operation's defaults.
   *
   * It is stated here, beside the surface, rather than in `inputSchema`: that stays a JSON Schema
   * the host validates the input against, and these are the fields a person fills in.
   */
  readonly forms?: JsonValue
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
