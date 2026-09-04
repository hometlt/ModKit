/** Browser-safe, game-neutral semantic data codec registry. */

import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
} from '../assets/index.js'

export type {
  ArtifactContext,
  GameArtifactCodec,
  GameArtifactKind,
  GameContentResolver,
} from '../assets/index.js'

export type DataCodecSummary = ArtifactCodecSummary
export interface DataRouteOptions extends ArtifactRouteOptions {}

/** Routes data artifacts through codecs supplied by the host. */
export class DataCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('data codec')
  }
}
