/** Protocol-neutral contracts for discovering installed games through extension providers. */

import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for bounded game-installation discovery. */
export const GAME_INSTALLATION_DISCOVERY_CONTRACT = 'common.game/installation-discovery' as const

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

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.game/installation-discovery': { 1: GameInstallationDiscovery }
  }

  interface ContractRequestMap {
    'common.game/installation-discovery': {
      1: { presence: 'required'; facet: GameInstallationRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.game/installation-discovery': {
      1: { presence: 'required'; facet: GameInstallationOfferFacet }
    }
  }
}

export type GameInstallationProviderModule = ServiceProviderModule<
  typeof GAME_INSTALLATION_DISCOVERY_CONTRACT,
  1
>
