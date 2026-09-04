import { ModkitError } from '@modkit/core'
import type { GameArtifactCodec, ArtifactContext, ArtifactOpenOptions } from './artifact-codec.js'
import type { AssetSource, AssetSourceKind } from './source.js'
import type { AssetOperationId } from './operations.js'
import type { DetectionRankingOptions, AssetRoute } from './detection.js'

export interface ArtifactCodecSummary {
  readonly id: string
  readonly kind: string
  readonly supportedGames: readonly string[]
  readonly sourceKinds: readonly AssetSourceKind[]
  readonly operationIds: readonly AssetOperationId[]
}
export interface ArtifactRouteOptions extends DetectionRankingOptions {
  readonly gameId?: string
}
export interface ArtifactRegistryOpenOptions extends ArtifactRouteOptions, ArtifactOpenOptions {}
export interface OpenedArtifact {
  readonly codec: GameArtifactCodec<unknown>
  readonly document: unknown
}

/** Compile compatibility for copied semantic declarations; never a second routing plane. */
export class ArtifactCodecRegistry {
  constructor(readonly kind = 'artifact codec') {}
  private unsupported(): never {
    throw new ModkitError({
      code: 'codec-kit/legacy-registry-unavailable',
      message: `${this.kind}: register and resolve the adapted contribution through the MK3 host`,
    })
  }
  register<T>(_codec: GameArtifactCodec<T>): this {
    void _codec
    return this.unsupported()
  }
  get(_id: string): GameArtifactCodec<unknown> | undefined {
    void _id
    return this.unsupported()
  }
  list(_gameId?: string): readonly GameArtifactCodec<unknown>[] {
    void _gameId
    return this.unsupported()
  }
  summaries(_gameId?: string): readonly ArtifactCodecSummary[] {
    void _gameId
    return this.unsupported()
  }
  route(
    _source: AssetSource,
    _context?: ArtifactContext,
    _options?: ArtifactRouteOptions,
  ): Promise<AssetRoute> {
    void _source
    void _context
    void _options
    return this.unsupported()
  }
  open(
    _source: AssetSource,
    _context?: ArtifactContext,
    _options?: ArtifactRegistryOpenOptions,
  ): Promise<OpenedArtifact | undefined> {
    void _source
    void _context
    void _options
    return this.unsupported()
  }
}
