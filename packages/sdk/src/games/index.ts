/** Protocol-neutral contracts for discovering installed games through extension providers. */

import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for bounded game-installation discovery. */
export const GAME_INSTALLATION_DISCOVERY_CONTRACT = 'common.game/installation-discovery' as const

/** Standard service coordinate for a game-owned, side-effect-free native launch plan. */
export const GAME_LAUNCH_PLAN_CONTRACT = 'common.game/launch-plan' as const

/** Host-owned matcher profile for exact game-id routing. */
export const GAME_INSTALLATION_MATCHER_PROFILE = 'org.modkitx/game-installation-matcher' as const

export type GameInstallationOrigin =
  'configured-path' | 'default-directory' | 'registry' | 'steam' | 'epic'

/** One bounded place worth probing; it is not an installation until evidence confirms it. */
export interface GameInstallationCandidate {
  readonly origin: GameInstallationOrigin
  readonly displayName: string
  readonly path: string
  readonly storeAppId?: string
  readonly manifestPath?: string
}

export interface GameInstallationEvidence {
  readonly kind: string
  readonly path: string
  readonly found: boolean
  readonly detail?: string
}

/** Structured outcome for one candidate, including negative evidence. */
export interface GameInstallationProbe {
  readonly candidate: GameInstallationCandidate
  readonly normalizedPath: string
  readonly confirmed: boolean
  readonly version?: string
  readonly buildName?: string
  readonly buildUid?: string
  readonly evidence: readonly GameInstallationEvidence[]
}

/** A confirmed installation safe to hand to the next game-specific composition step. */
export interface GameInstallation {
  readonly gameId: string
  readonly displayName: string
  readonly installPath: string
  readonly normalizedPath: string
  readonly origins: readonly GameInstallationOrigin[]
  readonly version?: string
  readonly buildName?: string
  readonly buildUid?: string
  readonly evidence: readonly GameInstallationEvidence[]
}

/** The host has already resolved this resource to one concrete local path. */
export interface GameLaunchResource {
  readonly kind: 'map'
  readonly path: string
}

/** Inputs a named-game planner may use; the provider never receives process authority. */
export interface GameLaunchPlanRequest {
  readonly gameId: string
  readonly installation: GameInstallation
  readonly resource: GameLaunchResource
  readonly signal?: AbortSignal
}

/**
 * A declarative process plan. Executable and working-directory paths are installation-relative;
 * an application cannot execute this value directly and the host must validate it before use.
 */
export interface GameLaunchPlan {
  readonly schemaVersion: 1
  readonly planId: string
  readonly gameId: string
  readonly installationRoot: string
  readonly resource: GameLaunchResource
  readonly executableRelativePath: string
  readonly workingDirectoryRelativePath: string
  readonly arguments: readonly string[]
  /** Index of the exact resource path in `arguments`, preventing hidden path substitution. */
  readonly resourceArgumentIndex: number
  readonly mode: 'detached'
  readonly stdio: 'ignore'
}

/** Activated pure planner. Actual process creation remains a host-owned side effect. */
export interface GameLaunchPlanner {
  readonly contract: typeof GAME_LAUNCH_PLAN_CONTRACT
  readonly plannerId: string
  readonly gameIds: readonly string[]
  plan(request: GameLaunchPlanRequest): Promise<GameLaunchPlan>
}

export type GameInstallationDiagnosticSeverity = 'error' | 'warning' | 'information'

export interface GameInstallationDiagnostic {
  readonly severity: GameInstallationDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly path?: string
}

export interface GameInstallationDiscoveryRequest {
  readonly gameId: string
  /** Roots explicitly selected or configured by the user; still verified by the provider. */
  readonly configuredPaths?: readonly string[]
  /** Hard ceiling over candidates probed by this call. */
  readonly maxCandidates: number
  readonly signal?: AbortSignal
}

export interface GameInstallationDiscoveryResult {
  readonly gameId: string
  /** False when a candidate boundary was reached before the provider proved enumeration complete. */
  readonly complete: boolean
  readonly probes: readonly GameInstallationProbe[]
  readonly installations: readonly GameInstallation[]
  readonly diagnostics: readonly GameInstallationDiagnostic[]
}

/** Activated discovery provider. Named-game evidence remains outside the host. */
export interface GameInstallationDiscovery {
  readonly contract: typeof GAME_INSTALLATION_DISCOVERY_CONTRACT
  readonly discoveryId: string
  readonly gameIds: readonly string[]
  readonly origins: readonly GameInstallationOrigin[]
  discover(request: GameInstallationDiscoveryRequest): Promise<GameInstallationDiscoveryResult>
}

/** JSON-safe route advertised by a discovery contribution. */
export interface GameInstallationOfferFacet {
  readonly gameIds: readonly string[]
}

/** JSON-safe route supplied by a consumer selecting one named game. */
export interface GameInstallationRequestFacet {
  readonly gameId: string
}

export type GameLaunchOfferFacet = GameInstallationOfferFacet
export type GameLaunchRequestFacet = GameInstallationRequestFacet

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.game/installation-discovery': { 1: GameInstallationDiscovery }
    'common.game/launch-plan': { 1: GameLaunchPlanner }
  }

  interface ContractRequestMap {
    'common.game/installation-discovery': {
      1: { presence: 'required'; facet: GameInstallationRequestFacet }
    }
    'common.game/launch-plan': {
      1: { presence: 'required'; facet: GameLaunchRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.game/installation-discovery': {
      1: { presence: 'required'; facet: GameInstallationOfferFacet }
    }
    'common.game/launch-plan': {
      1: { presence: 'required'; facet: GameLaunchOfferFacet }
    }
  }
}

export type GameInstallationProviderModule = ServiceProviderModule<
  typeof GAME_INSTALLATION_DISCOVERY_CONTRACT,
  1
>

export type GameLaunchProviderModule = ServiceProviderModule<typeof GAME_LAUNCH_PLAN_CONTRACT, 1>
