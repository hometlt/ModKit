import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
  type AssetOperationId,
} from '../assets/index.js'

export type { ArtifactContext, GameArtifactCodec, GameArtifactKind } from '../assets/index.js'

export const DOCUMENT_OPERATION_IDS = {
  inspect: 'view.inspect',
  validate: 'asset.validate',
  raw: 'export.raw',
  serialize: 'export.convert',
  edit: 'edit.content',
  save: 'source.save',
} as const satisfies Record<string, AssetOperationId>

export type DocumentOperationKey = keyof typeof DOCUMENT_OPERATION_IDS

export const DOCUMENT_OPERATION_ID_LIST: readonly AssetOperationId[] = Object.freeze(
  Object.values(DOCUMENT_OPERATION_IDS),
)

export type DocumentCodecSummary = ArtifactCodecSummary
export type DocumentRouteOptions = ArtifactRouteOptions

/** Game-neutral document facade over the shared semantic artifact registry. */
export class DocumentCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('document codec')
  }
}
