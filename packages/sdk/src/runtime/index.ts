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
import type { LogicalResourceRequirement } from '../resource-session.js'

/** Resolver-visible provider factory contract. */
export const RUNTIME_PROVIDER_CONTRACT = 'common.runtime/provider' as const

/** Nested leased-session contract returned by a runtime provider. */
export const RUNTIME_SESSION_CONTRACT = 'common.runtime/session' as const

/** Host-owned matcher profile for runtime ids. */
export const RUNTIME_PROVIDER_MATCHER_PROFILE = 'modkit/runtime-provider-matcher' as const

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

/** A request the selected runtime understands but cannot execute under its declared profile. */
export type RuntimeCapabilityRefusalReason =
  | 'entrypoint-unavailable'
  | 'native-unavailable'
  | 'unsupported-runtime-subset'
  | 'cancelled'
  | 'session-disposed'

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
  | Readonly<{
      state: 'refused'
      reason: RuntimeCapabilityRefusalReason
      message: string
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
  /** Logical inputs read through ContributionContext.logicalResources, never ambient paths. */
  readonly inputs?: readonly LogicalResourceRequirement[]
  readonly signal?: AbortSignal
}

/** Activated runtime factory selected for a runtime id. */
export interface RuntimeProvider {
  readonly contract: typeof RUNTIME_PROVIDER_CONTRACT
  readonly providerId: string
  readonly runtimeIds: readonly string[]
  /** Explicit opt-in; hosts refuse resource inputs when a provider does not advertise this. */
  readonly inputMode?: 'logical-resources-v1'
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

// ---------------------------------------------------------------------------------------------
// Runtime session v2 (block 12 item 17 — frozen)
//
// v1 is `create → execute → status → dispose`: enough to run something under a budget, and not
// enough to say anything about *what state it is in* or to get that state back later. v2 freezes
// the seven surfaces item 17 names, and freezing means they may be added to only behind a new
// major — a provider written against this list will keep working.
//
// v1 is not deprecated and is not removed. A provider that only executes is a legitimate provider;
// v2 is what a provider must implement to be replayable, snapshot-able and negotiable, and the
// offer list is how it says which of those it actually does. Declaring an offer and then
// refusing it is the one thing conformance will not let a provider do.

/** What a v2 session offers. Anything absent is refused, not attempted. */
export type RuntimeSessionOffer =
  /** `step` advances the state deterministically. */
  | 'step'
  /** `events` yields a bounded, ordered event stream. */
  | 'events'
  /** `snapshot` produces restorable bytes. */
  | 'snapshot'
  /** `restore` accepts them back. */
  | 'restore'
  /** `stateHash` is stable for equal states. */
  | 'state-hash'

/**
 * What a snapshot is a snapshot *of*.
 *
 * Content and schema are separate on purpose: two sessions may hold the same state under different
 * schema versions, and restoring across a schema change is the mistake this identity exists to
 * make impossible. A snapshot names both, and `restore` refuses a schema it does not implement
 * rather than reading the bytes hopefully.
 */
export interface RuntimeStateIdentity {
  /** Algorithm-qualified digest of the canonical state bytes, e.g. `sha256:…`. */
  readonly contentDigest: string
  /** The state schema these bytes are written against. */
  readonly schemaId: string
  /** Major version of that schema; a mismatch is a refusal, never a coercion. */
  readonly schemaVersion: number
}

/** A restorable state capture. `bytes` are opaque to the host and meaningful only to the provider. */
export interface RuntimeSnapshot {
  readonly identity: RuntimeStateIdentity
  readonly bytes: Uint8Array
}

/** One ordered thing that happened inside a session. */
export interface RuntimeEvent {
  /** Monotonic within a session, starting at 1; gaps mean the backlog dropped events. */
  readonly sequence: number
  readonly tick: number
  readonly kind: string
  readonly data?: JsonValue
}

/** Why a v2 call was refused. Every refusal is one of these; none of them is an exception. */
export type RuntimeRefusalReason =
  /** The session does not offer what this call needs. */
  | 'offer-unavailable'
  /** The snapshot names a schema this provider does not implement at that major. */
  | 'schema-mismatch'
  /** The snapshot's bytes do not match its own content digest. */
  | 'digest-mismatch'
  /** A budget dimension would be exceeded. */
  | 'budget-exceeded'
  /** The caller cancelled. */
  | 'cancelled'
  /** The session is disposed. */
  | 'session-disposed'

export interface RuntimeRefusal {
  readonly outcome: 'refused'
  readonly reason: RuntimeRefusalReason
  readonly diagnostics: readonly RuntimeDiagnostic[]
}

export interface RuntimeStepResult {
  readonly outcome: 'stepped'
  readonly status: RuntimeSessionStatus
  readonly diagnostics: readonly RuntimeDiagnostic[]
}

export interface RuntimeSnapshotResult {
  readonly outcome: 'captured'
  readonly snapshot: RuntimeSnapshot
}

export interface RuntimeRestoreResult {
  readonly outcome: 'restored'
  readonly status: RuntimeSessionStatus
}

export interface RuntimeStateHashResult {
  readonly outcome: 'hashed'
  /** Algorithm-qualified. Equal states hash equal; unequal states are not required to differ. */
  readonly stateHash: string
}

/** Frozen v2 session surface. */
export interface RuntimeSessionV2 extends RuntimeSession {
  readonly contract: typeof RUNTIME_SESSION_CONTRACT
  /** Exactly what this provider will do. Anything not listed is refused by `offer-unavailable`. */
  readonly offers: readonly RuntimeSessionOffer[]
  /** The identity the session's state currently carries. */
  identity(): Promise<RuntimeStateIdentity>
  /** Advance by a bounded number of ticks. Deterministic: equal state plus equal ticks, equal result. */
  step(ticks: number, signal?: AbortSignal): Promise<RuntimeStepResult | RuntimeRefusal>
  /** Ordered events since `afterSequence`, bounded by the session's backlog. */
  events(afterSequence?: number): AsyncIterable<RuntimeEvent>
  snapshot(signal?: AbortSignal): Promise<RuntimeSnapshotResult | RuntimeRefusal>
  restore(
    snapshot: RuntimeSnapshot,
    signal?: AbortSignal,
  ): Promise<RuntimeRestoreResult | RuntimeRefusal>
  stateHash(signal?: AbortSignal): Promise<RuntimeStateHashResult | RuntimeRefusal>
}

/** Provider major 2 returns the frozen v2 session surface over every execution backend. */
export interface RuntimeProviderV2 extends RuntimeProvider {
  createSession(request: RuntimeSessionCreateRequest): Promise<Lease<RuntimeSessionV2>>
}

/** The frozen member list, so a conformance run checks the contract rather than one implementation. */
export const RUNTIME_SESSION_V2_MEMBERS = Object.freeze([
  'offers',
  'identity',
  'step',
  'events',
  'snapshot',
  'restore',
  'stateHash',
] as const)

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.runtime/provider': { 1: RuntimeProvider; 2: RuntimeProviderV2 }
    'common.runtime/session': { 1: RuntimeSession; 2: RuntimeSessionV2 }
  }

  interface ContractRequestMap {
    'common.runtime/provider': {
      1: { presence: 'required'; facet: RuntimeProviderRequestFacet }
      2: { presence: 'required'; facet: RuntimeProviderRequestFacet }
    }
    'common.runtime/session': { 1: { presence: 'forbidden' }; 2: { presence: 'forbidden' } }
  }

  interface ContractOfferMap {
    'common.runtime/provider': {
      1: { presence: 'required'; facet: RuntimeProviderOfferFacet }
      2: { presence: 'required'; facet: RuntimeProviderOfferFacet }
    }
    'common.runtime/session': { 1: { presence: 'forbidden' }; 2: { presence: 'forbidden' } }
  }
}

export type RuntimeProviderModule = ServiceProviderModule<typeof RUNTIME_PROVIDER_CONTRACT, 1>
