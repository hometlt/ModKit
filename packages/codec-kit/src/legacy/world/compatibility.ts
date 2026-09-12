import { canonicalBytes, type CanonicalValue } from './canonical.js'
import { sha256Hex } from './sha256.js'

export const WORLD_V0_ROOT_SCHEMA_VERSION = 1 as const
export const WORLD_V0_ROOT_ALGORITHM = 'sha256' as const

export type WorldV0RootDomain =
  | 'multiverse.world-v0/world-state'
  | 'multiverse.world-v0/continuation'
  | 'multiverse.world-v0/composition'
  | 'multiverse.world-v0/content'
  | 'multiverse.world-v0/envelope'

export interface WorldV0CompatibilityInputs {
  readonly worldState: CanonicalValue
  readonly continuation: CanonicalValue
  readonly composition: CanonicalValue
  readonly content: CanonicalValue
  readonly protocolProfile: string
}

export interface WorldV0CompatibilityEnvelope {
  readonly schemaVersion: typeof WORLD_V0_ROOT_SCHEMA_VERSION
  readonly algorithm: typeof WORLD_V0_ROOT_ALGORITHM
  readonly protocolProfile: string
  readonly worldStateRoot: string
  readonly continuationRoot: string
  readonly compositionRoot: string
  readonly contentRoot: string
  readonly envelopeRoot: string
}

export function computeWorldV0Root(domain: WorldV0RootDomain, value: CanonicalValue): string {
  return sha256Hex(
    canonicalBytes({
      schemaVersion: WORLD_V0_ROOT_SCHEMA_VERSION,
      domain,
      value,
    }),
  )
}

export function computeWorldV0CompatibilityEnvelope(
  inputs: WorldV0CompatibilityInputs,
): WorldV0CompatibilityEnvelope {
  const roots = {
    worldStateRoot: computeWorldV0Root('multiverse.world-v0/world-state', inputs.worldState),
    continuationRoot: computeWorldV0Root('multiverse.world-v0/continuation', inputs.continuation),
    compositionRoot: computeWorldV0Root('multiverse.world-v0/composition', inputs.composition),
    contentRoot: computeWorldV0Root('multiverse.world-v0/content', inputs.content),
  }
  return {
    schemaVersion: WORLD_V0_ROOT_SCHEMA_VERSION,
    algorithm: WORLD_V0_ROOT_ALGORITHM,
    protocolProfile: inputs.protocolProfile,
    ...roots,
    envelopeRoot: computeWorldV0Root('multiverse.world-v0/envelope', {
      protocolProfile: inputs.protocolProfile,
      ...roots,
    }),
  }
}

