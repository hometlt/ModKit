/**
 * Game-neutral execution contracts.
 *
 * This package intentionally contains no game AST, simulation, transport, filesystem, or host
 * code. Concrete providers (for example `sc2-runtime`) adapt their own execution state to these
 * contracts, allowing a replay viewer, CLI, or browser worker to share one lifecycle surface.
 */

import type { CancellationToken } from '../assets/index.js'

/** JSON-like data that can cross a host/worker boundary without provider-specific classes. */
export interface RuntimeValueObject {
  readonly [key: string]: RuntimeValue
}

export type RuntimeValue =
  null | boolean | number | string | readonly RuntimeValue[] | RuntimeValueObject

export type RuntimeCapability =
  'execute' | 'events' | 'snapshot' | 'restore' | 'native-host' | 'replay-assistance'

export type RuntimeSessionState = 'created' | 'running' | 'suspended' | 'disposed' | 'failed'

export interface RuntimeClockState {
  /** Monotonic provider time in seconds. */
  readonly timeSeconds: number
  /** Monotonic deterministic tick number. */
  readonly tick: number
  /** Nominal simulation ticks per second, when the provider is tick-based. */
  readonly ticksPerSecond?: number
}

/** A provider-owned deterministic clock. It never reads wall time implicitly. */
export interface RuntimeClock {
  readonly state: RuntimeClockState
  advance(deltaSeconds: number, cancellation?: CancellationToken): Promise<RuntimeClockState>
}

export interface RuntimeBudget {
  /** Maximum wall-clock work the caller permits for one operation. */
  readonly maxWallTimeMs?: number
  /** Maximum deterministic ticks the caller permits for one operation. */
  readonly maxTicks?: number
  /** Maximum provider-owned bytes retained by an operation/session. */
  readonly maxMemoryBytes?: number
}

export interface RuntimeExecutionRequest {
  /** Provider-defined stable entrypoint, never a host command string. */
  readonly entrypoint: string
  /** Serializable provider-defined arguments. */
  readonly arguments?: readonly RuntimeValue[]
  readonly cancellation?: CancellationToken
  readonly budget?: RuntimeBudget
}

export interface RuntimeExecutionResult {
  readonly value?: RuntimeValue
  readonly state: RuntimeSessionState
  readonly clock: RuntimeClockState
  readonly diagnostics: readonly RuntimeDiagnostic[]
}

export type RuntimeDiagnosticSeverity = 'info' | 'warning' | 'error'

/** Structured runtime evidence: failures and unsupported behavior never need raw console output. */
export interface RuntimeDiagnostic {
  readonly code: string
  readonly severity: RuntimeDiagnosticSeverity
  readonly message: string
  readonly providerId?: string
  readonly source?: string
  readonly context?: Readonly<Record<string, RuntimeValue>>
}

export interface RuntimeEvent {
  readonly type: string
  readonly clock: RuntimeClockState
  readonly payload?: RuntimeValue
}

export interface RuntimeSnapshot {
  readonly schemaVersion: 1
  readonly providerId: string
  readonly clock: RuntimeClockState
  readonly state: RuntimeValue
}

export interface RuntimeNativeInvocation {
  readonly name: string
  readonly arguments: readonly RuntimeValue[]
  readonly cancellation?: CancellationToken
}

/** The provider asks the host to service a game-specific native without importing host APIs. */
export interface RuntimeNativeHost {
  invoke(invocation: RuntimeNativeInvocation): Promise<RuntimeValue | undefined>
}

export interface RuntimeSession {
  readonly providerId: string
  readonly capabilities: readonly RuntimeCapability[]
  readonly state: RuntimeSessionState
  readonly clock: RuntimeClock
  execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult>
  events(): AsyncIterable<RuntimeEvent>
  diagnostics(): readonly RuntimeDiagnostic[]
  snapshot?(): Promise<RuntimeSnapshot>
  restore?(snapshot: RuntimeSnapshot, cancellation?: CancellationToken): Promise<void>
  dispose(): Promise<void>
}

export interface RuntimeProviderCreateOptions {
  readonly cancellation?: CancellationToken
  readonly budget?: RuntimeBudget
  readonly nativeHost?: RuntimeNativeHost
}

export interface RuntimeProvider<
  TOptions extends RuntimeProviderCreateOptions = RuntimeProviderCreateOptions,
> {
  readonly id: string
  readonly displayName: string
  readonly capabilities: readonly RuntimeCapability[]
  createSession(options: TOptions): Promise<RuntimeSession>
}
