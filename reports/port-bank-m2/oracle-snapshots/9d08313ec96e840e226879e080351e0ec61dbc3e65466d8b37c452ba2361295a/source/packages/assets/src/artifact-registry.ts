/**
 * Narrow generic registry for semantic artifact codecs.
 *
 * Domain packages keep their public registry names as typed subclasses, while routing,
 * summaries, duplicate detection, and route-and-open behavior live here once.
 */

import { ModkitError } from '@modkitx/core/errors'
import type {
  ArtifactContext,
  ArtifactOpenOptions,
  GameArtifactCodec,
  GameArtifactKind,
} from './artifact-codec.js'
import {
  rankDetectionCandidates,
  type AssetCandidate,
  type AssetRoute,
  type DetectionRankingOptions,
  type RejectedCandidate,
} from './detection.js'
import type { AssetSource } from './source.js'

export interface ArtifactCodecSummary {
  readonly id: string
  readonly kind: GameArtifactKind
  readonly supportedGames: readonly string[]
  readonly sourceKinds: readonly string[]
  readonly operationIds: readonly string[]
}

export interface ArtifactRouteOptions extends DetectionRankingOptions {
  /** Restrict routing to codecs declaring this game ID. */
  readonly gameId?: string
}

export interface ArtifactRegistryOpenOptions extends ArtifactRouteOptions, ArtifactOpenOptions {}

export interface OpenedArtifact {
  readonly codec: GameArtifactCodec<unknown>
  readonly document: unknown
}

export class ArtifactCodecRegistry {
  private readonly codecs = new Map<string, GameArtifactCodec<unknown>>()

  constructor(private readonly kind = 'artifact codec') {}

  /** Registers a codec. Registering the same ID twice is a programming error, not a merge. */
  register<TDocument>(codec: GameArtifactCodec<TDocument>): this {
    if (this.codecs.has(codec.id)) {
      throw new ModkitError({
        code: 'CODEC_ALREADY_REGISTERED',
        message: 'A semantic artifact codec with this ID is already registered.',
        context: { codecId: codec.id, registryKind: this.kind },
      })
    }
    this.codecs.set(codec.id, codec as GameArtifactCodec<unknown>)
    return this
  }

  get(id: string): GameArtifactCodec<unknown> | undefined {
    return this.codecs.get(id)
  }

  list(gameId?: string): readonly GameArtifactCodec<unknown>[] {
    const all = [...this.codecs.values()]
    return gameId ? all.filter(codec => codec.supportedGames.includes(gameId)) : all
  }

  /** Serializable projection for settings and telemetry surfaces. */
  summaries(gameId?: string): readonly ArtifactCodecSummary[] {
    return this.list(gameId).map(codec => ({
      id: codec.id,
      kind: codec.kind,
      supportedGames: [...codec.supportedGames],
      sourceKinds: [...codec.sourceKinds],
      operationIds: codec.operations.map(operation => operation.id),
    }))
  }

  async route(
    source: AssetSource,
    context: ArtifactContext = {},
    options: ArtifactRouteOptions = {},
  ): Promise<AssetRoute> {
    const candidates: AssetCandidate[] = []
    const rejected: RejectedCandidate[] = []
    const gameId = options.gameId ?? context.gameId
    for (const codec of this.list(gameId)) {
      if (!codec.sourceKinds.includes(source.descriptor.kind)) {
        rejected.push({
          pluginId: codec.id,
          code: 'unsupported-source-kind',
          detail: source.descriptor.kind,
        })
        continue
      }
      try {
        candidates.push({ detection: await codec.detect(source, context), label: codec.id })
      } catch (error) {
        rejected.push({
          pluginId: codec.id,
          code: 'negative-structure',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const route = rankDetectionCandidates(candidates, options)
    return { ...route, rejected: [...rejected, ...route.rejected] }
  }

  async open(
    source: AssetSource,
    context: ArtifactContext = {},
    options: ArtifactRegistryOpenOptions = {},
  ): Promise<OpenedArtifact | undefined> {
    const route = await this.route(source, context, options)
    if (route.status !== 'resolved') return undefined
    const codec = this.get(route.primary.detection.pluginId)
    if (!codec) return undefined
    return { codec, document: await codec.open(source, context, options) }
  }
}
