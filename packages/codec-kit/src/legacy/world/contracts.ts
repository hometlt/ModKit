export type WorldPhase = 'input' | 'ai' | 'script' | 'simulation' | 'output'

export type WorldAccessKey = string

export interface WorldCadence {
  readonly everyTicks: number
  readonly offsetTicks?: number
}

export interface WorldTickContext {
  readonly tick: number
  readonly deltaSeconds: number
}

export interface ExclusiveSystemProvider {
  readonly slotId: string
  readonly providerId: string
}

export interface SystemDeclaration<Context extends WorldTickContext = WorldTickContext> {
  readonly id: string
  readonly phase: WorldPhase
  readonly cadence: WorldCadence
  readonly reads: readonly WorldAccessKey[]
  readonly writes: readonly WorldAccessKey[]
  readonly after?: readonly string[]
  readonly before?: readonly string[]
  readonly exclusive?: ExclusiveSystemProvider
  readonly run: (context: Context) => void
}

export interface WorldCompositionLock {
  readonly exclusiveSlots: Readonly<Record<string, string>>
}

export interface LinkedSystem<Context extends WorldTickContext = WorldTickContext> {
  readonly declaration: SystemDeclaration<Context>
  readonly order: number
}

export interface LinkedWorldSchedule<Context extends WorldTickContext = WorldTickContext> {
  readonly systems: readonly LinkedSystem<Context>[]
  readonly composition: WorldCompositionLock
}

export interface WorldScheduleDiagnostic {
  readonly severity: 'error'
  readonly code:
    | 'multiverse.world/invalid-declaration'
    | 'multiverse.world/duplicate-system'
    | 'multiverse.world/missing-dependency'
    | 'multiverse.world/backward-phase-edge'
    | 'multiverse.world/dependency-cycle'
    | 'multiverse.world/unordered-access-conflict'
    | 'multiverse.world/missing-exclusive-selection'
    | 'multiverse.world/unknown-exclusive-selection'
    | 'multiverse.world/multiple-exclusive-providers'
  readonly message: string
  readonly systemIds?: readonly string[]
  readonly accessKey?: string
  readonly slotId?: string
}

export class WorldScheduleError extends Error {
  readonly diagnostics: readonly WorldScheduleDiagnostic[]

  constructor(diagnostics: readonly WorldScheduleDiagnostic[]) {
    super(diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n'))
    this.name = 'WorldScheduleError'
    this.diagnostics = Object.freeze([...diagnostics])
  }
}
