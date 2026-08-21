/**
 * Game-neutral executable runtime contract.
 *
 * A provider is resolved through the ordinary service-provider plane. It creates a leased session
 * whose numeric resource budget is fixed for that session. Every execution asks the provider to
 * reserve concrete resources; an over-budget request is returned as a structured refusal and is
 * never partially executed.
 */

import type { Lease } from '../asset-capabilities/data-sources.js'
import type { JsonValue } from '../asset-capabilities/types.js'
import type { ServiceProviderModule } from '../runtime-abi.js'

/** Resolver-visible provider factory contract. */
export const RUNTIME_PROVIDER_CONTRACT = 'common.runtime/provider' as const

/** Nested leased-session contract returned by a runtime provider. */
export const RUNTIME_SESSION_CONTRACT = 'common.runtime/session' as const

/** Host-owned matcher profile for runtime ids. */
export const RUNTIME_PROVIDER_MATCHER_PROFILE = 'org.modkitx/runtime-provider-matcher' as const

/** Resource ceiling fixed when a runtime session is created. All values are safe integers. */
export interface RuntimeBudget {
  /** Per-execution admitted wall time. */
  readonly maxWallTimeMs: number
  /** Cumulative ticks admitted during the session. */
  readonly maxTicks: number
  /** Cumulative retained memory admitted during the session. */
  readonly maxMemoryBytes: number
}

/** Resource reservation supplied for one execution. */
export interface RuntimeExecutionResources {
  readonly wallTimeMs: number
  readonly ticks: number
  readonly memoryBytes: number
}

export type RuntimeBudgetRefusalReason = 'max-wall-time-ms' | 'max-ticks' | 'max-memory-bytes'

export type RuntimeDiagnosticSeverity = 'error' | 'warning' | 'information'

export interface RuntimeDiagnostic {
  readonly severity: RuntimeDiagnosticSeverity
  readonly code: string
  readonly message: string
}

export interface RuntimeExecutionRequest {
  readonly entrypoint: string
  readonly arguments?: readonly JsonValue[]
  /** Reservation checked before the entrypoint starts. */
  readonly resources: RuntimeExecutionResources
  readonly signal?: AbortSignal
}

export interface RuntimeExecutionUsage {
  readonly wallTimeMs: number
  readonly ticks: number
  readonly memoryBytes: number
}

export type RuntimeExecutionResult =
  | Readonly<{
      state: 'completed'
      value?: JsonValue
      usage: RuntimeExecutionUsage
      diagnostics: readonly RuntimeDiagnostic[]
    }>
  | Readonly<{
      state: 'refused'
      reason: RuntimeBudgetRefusalReason
      message: string
      limit: number
      requested: number
      usage: RuntimeExecutionUsage
      diagnostics: readonly RuntimeDiagnostic[]
    }>

export type RuntimeSessionState = 'ready' | 'executing' | 'disposed'

export interface RuntimeSessionStatus {
  readonly state: RuntimeSessionState
  readonly executions: number
  readonly ticks: number
  readonly memoryBytes: number
}

/** Leased executable session. Releasing its lease disposes it. */
export interface RuntimeSession {
  readonly contract: typeof RUNTIME_SESSION_CONTRACT
  readonly sessionId: string
  readonly providerId: string
  readonly budget: RuntimeBudget
  execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult>
  status(): Promise<RuntimeSessionStatus>
}

export interface RuntimeSessionCreateRequest {
  readonly sessionId: string
  readonly budget: RuntimeBudget
  readonly signal?: AbortSignal
}

/** Activated runtime factory selected for a runtime id. */
export interface RuntimeProvider {
  readonly contract: typeof RUNTIME_PROVIDER_CONTRACT
  readonly providerId: string
  readonly runtimeIds: readonly string[]
  createSession(request: RuntimeSessionCreateRequest): Promise<Lease<RuntimeSession>>
}

/** JSON-safe route advertised by a runtime provider contribution. */
export interface RuntimeProviderOfferFacet {
  readonly runtimeIds: readonly string[]
}

/** JSON-safe route supplied by a runtime consumer. */
export interface RuntimeProviderRequestFacet {
  readonly runtimeId: string
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.runtime/provider': { 1: RuntimeProvider }
    'common.runtime/session': { 1: RuntimeSession }
  }

  interface ContractRequestMap {
    'common.runtime/provider': {
      1: { presence: 'required'; facet: RuntimeProviderRequestFacet }
    }
    'common.runtime/session': { 1: { presence: 'forbidden' } }
  }

  interface ContractOfferMap {
    'common.runtime/provider': {
      1: { presence: 'required'; facet: RuntimeProviderOfferFacet }
    }
    'common.runtime/session': { 1: { presence: 'forbidden' } }
  }
}

export type RuntimeProviderModule = ServiceProviderModule<typeof RUNTIME_PROVIDER_CONTRACT, 1>
