/** Browser-safe, game-neutral semantic contracts for mod artifacts. */

import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
  type AssetOperationId,
} from '../assets/index.js'

export type {
  ArtifactContext,
  GameArtifactCodec,
  GameArtifactKind,
  GameContentResolver,
} from '../assets/index.js'

export type ModCodecSummary = ArtifactCodecSummary
export interface ModRouteOptions extends ArtifactRouteOptions {}

/** Typed mod-domain facade over the shared artifact registry. */
export class ModCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('mod codec')
  }
}

/**
 * Game-neutral operation vocabulary for mod artifacts.
 *
 * A concrete codec decides which operations are available for a document and supplies the
 * handler implementation. These IDs only let hosts expose the same verbs without knowing a
 * particular game or file format.
 */
export const MOD_OPERATION_IDS = {
  /** Resolve the artifact's declared and implicit content dependencies. */
  resolveDependencies: 'content.resolve-dependencies',
  /** Expose the ordered mounted workspace behind the artifact. */
  mountWorkspace: 'content.mount',
  /** Compare content owned by the artifact with inherited content. */
  compareOverrides: 'asset.compare',
  /** Validate the loaded artifact and its dependency state. */
  validate: 'asset.validate',
  /** Extract original content while preserving relative paths. */
  extract: 'container.extract',
  /** Rewrite the mod container. */
  pack: 'container.pack',
  /** Export the mod to another representation. */
  export: 'export.convert',
  /** Return inspector/card data without prescribing a viewer shell. */
  inspect: 'view.inspect',
  /** Apply a codec-defined structural edit to the mod. */
  addLocale: 'edit.structure',
} as const satisfies Record<string, AssetOperationId>

export type ModOperationKey = keyof typeof MOD_OPERATION_IDS

export const MOD_OPERATION_ID_LIST: readonly AssetOperationId[] = Object.freeze(
  Object.values(MOD_OPERATION_IDS),
)
