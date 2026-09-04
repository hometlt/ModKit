/** Browser-safe, game-neutral semantic script registry and operation vocabulary. */

import {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRouteOptions,
  type AssetOperationId,
} from '../assets/index.js'

export type { ArtifactContext, GameArtifactCodec, GameArtifactKind } from '../assets/index.js'

export type ScriptCodecSummary = ArtifactCodecSummary
export interface ScriptRouteOptions extends ArtifactRouteOptions {}

/** Registry for script-domain codecs supplied by a host or generated codec catalog. */
export class ScriptCodecRegistry extends ArtifactCodecRegistry {
  constructor() {
    super('script codec')
  }
}

/** Document outline / symbol tree. */
export const SCRIPT_SYMBOLS_OPERATION_ID = 'script.symbols'

/** Find references at a source position. */
export const SCRIPT_REFERENCES_OPERATION_ID = 'script.references'

/** Completion proposals at a source position. */
export const SCRIPT_COMPLETION_OPERATION_ID = 'script.completion'

/** Whole-document formatting. */
export const SCRIPT_FORMAT_OPERATION_ID = 'script.format'

/** Lowering to an executable representation; execution remains separately permissioned. */
export const SCRIPT_COMPILE_OPERATION_ID = 'script.compile'

/** Game-neutral operation vocabulary shared by script codecs and hosts. */
export const SCRIPT_OPERATION_IDS = {
  parse: 'view.inspect',
  symbols: SCRIPT_SYMBOLS_OPERATION_ID,
  references: SCRIPT_REFERENCES_OPERATION_ID,
  diagnostics: 'asset.validate',
  completion: SCRIPT_COMPLETION_OPERATION_ID,
  formatting: SCRIPT_FORMAT_OPERATION_ID,
  refactor: 'edit.structure',
  edit: 'edit.content',
  compile: SCRIPT_COMPILE_OPERATION_ID,
  convert: 'export.convert',
  compare: 'asset.compare',
  search: 'asset.search',
} as const satisfies Record<string, AssetOperationId>

export type ScriptOperationKey = keyof typeof SCRIPT_OPERATION_IDS

export const SCRIPT_OPERATION_ID_LIST: readonly AssetOperationId[] = Object.freeze(
  Object.values(SCRIPT_OPERATION_IDS),
)

/** Compatibility name for the script-domain IDs not supplied by the shared asset vocabulary. */
export const LOCAL_SCRIPT_OPERATION_IDS: readonly AssetOperationId[] = Object.freeze([
  SCRIPT_SYMBOLS_OPERATION_ID,
  SCRIPT_REFERENCES_OPERATION_ID,
  SCRIPT_COMPLETION_OPERATION_ID,
  SCRIPT_FORMAT_OPERATION_ID,
  SCRIPT_COMPILE_OPERATION_ID,
])
