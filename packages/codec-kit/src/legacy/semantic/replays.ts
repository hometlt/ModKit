import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
} from '../assets/index.js'

export type { ArtifactContext, GameArtifactCodec, GameArtifactKind } from '../assets/index.js'

export type ReplayCodecSummary = ArtifactCodecSummary
export type ReplayRouteOptions = ArtifactRouteOptions

/** Game-neutral replay facade over the shared semantic artifact registry. */
export class ReplayCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('replay codec')
  }
}
