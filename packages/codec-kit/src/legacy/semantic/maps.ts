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

/** Cross-game map scene verb; retained outside any concrete game codec namespace. */
export const MAP_SCENE_3D_OPERATION_ID = 'map.scene-3d'

/** Host-gated game launch verb named by the canonical architecture migration table. */
export const GAME_LAUNCH_MAP_OPERATION_ID = 'game.launch-map'

export const MAP_OPERATION_IDS = {
  inspect: 'view.inspect',
  validate: 'asset.validate',
  thumbnail: 'view.thumbnail',
  preview2d: 'view.render',
  scene3d: MAP_SCENE_3D_OPERATION_ID,
  extract: 'container.extract',
  edit: 'edit.content',
  pack: 'container.pack',
  saveAs: 'source.save-as',
  launch: GAME_LAUNCH_MAP_OPERATION_ID,
} as const satisfies Record<string, AssetOperationId>

export type MapOperationKey = keyof typeof MAP_OPERATION_IDS

export const MAP_OPERATION_ID_LIST: readonly AssetOperationId[] = Object.freeze(
  Object.values(MAP_OPERATION_IDS),
)

export type MapCodecSummary = ArtifactCodecSummary
export type MapRouteOptions = ArtifactRouteOptions

/** Game-neutral map facade over the shared semantic artifact registry. */
export class MapCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('map codec')
  }
}
