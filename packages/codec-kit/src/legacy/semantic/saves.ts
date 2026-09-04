/** Browser-safe, game-neutral semantic contracts for saved-game artifacts. */

import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
  type AssetOperationId,
} from '../assets/index.js'

export type { ArtifactContext, GameArtifactCodec, GameArtifactKind } from '../assets/index.js'

export type SaveCodecSummary = ArtifactCodecSummary
export interface SaveRouteOptions extends ArtifactRouteOptions {}

/** Registry for save/profile codecs contributed by games and formats. */
export class SavesCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('save codec')
  }
}

/**
 * Save-domain operation vocabulary. Implementations may expose only the operations supported by
 * a particular format or document.
 */
export const SAVE_OPERATION_IDS = {
  inspect: 'view.inspect',
  validate: 'asset.validate',
  patchValue: 'edit.content',
  saveAs: 'source.save-as',
  exportRaw: 'export.raw',
  sign: 'save.sign',
} as const satisfies Record<string, AssetOperationId>

export type SaveOperationKey = keyof typeof SAVE_OPERATION_IDS

export const SAVE_OPERATION_ID_LIST: readonly AssetOperationId[] = Object.freeze(
  Object.values(SAVE_OPERATION_IDS),
)
