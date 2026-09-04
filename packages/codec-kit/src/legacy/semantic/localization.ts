/** Browser-safe, game-neutral localization artifact registry facade. */

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

export type LocalizationCodecSummary = ArtifactCodecSummary
export interface LocalizationRouteOptions extends ArtifactRouteOptions {}

/** Empty by default: hosts explicitly register localization codecs supplied by plugins. */
export class LocalizationCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('localization codec')
  }
}
