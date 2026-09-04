import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
} from '../assets/index.js'

export type { ArtifactContext, GameArtifactCodec, GameArtifactKind } from '../assets/index.js'

export type LayoutCodecSummary = ArtifactCodecSummary
export type LayoutRouteOptions = ArtifactRouteOptions

/** Game-neutral layout facade over the shared semantic artifact registry. */
export class LayoutCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('layout codec')
  }
}
