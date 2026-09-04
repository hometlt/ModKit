/**
 * Semantic-artifact contracts from canonical architecture sections 5.2 and 5.3.
 *
 * `GameArtifactCodec` and `GameContentResolver` are game-neutral: every `<domain>-processing`
 * package (`mods-processing`, and `maps-processing`, `data-processing`, `scripts-processing`,
 * `layouts-processing`, `localization-processing`, `replays-processing`, `saves-processing` as
 * they are built) needs the identical shapes. `@modkitx/assets` is their shared home so eight
 * domain packages do not each grow a structurally-identical, silently-diverging copy; it already
 * owns the value types these interfaces reference (`ContentMount`, `ContentDependency`,
 * `ContentListRequest` in `./content.js`).
 *
 * `ArtifactContext` is referenced by section 5.2's signatures but never defined anywhere in the
 * canonical plan; the shape below is `mods-processing`'s proposal, adopted here as the shared
 * definition (see the type's own note).
 */

import type { AssetOperationDescriptor } from './operations.js'
import type {
  ContentDependency,
  ContentListRequest,
  ContentMount,
  ContentResolveRequest,
  ResolvedContentSource,
} from './content.js'
import type { CancellationToken } from './cancellation.js'
import type { DetectionResult } from './detection.js'
import type { AssetDescriptor } from './descriptor.js'
import type { AssetChild, AssetSource, AssetSourceKind } from './source.js'
import type { HostId } from './contributions.js'
import type {
  ArtifactOperationSession,
  ArtifactOperationSessionOptions,
} from './artifact-session.js'

/** Canonical architecture section 5.2, verbatim. */
export type GameArtifactKind =
  | 'document'
  | 'map'
  | 'mod'
  | 'campaign'
  | 'data'
  | 'script'
  | 'layout'
  | 'localization'
  | 'replay'
  | 'save'

/**
 * Per-call context threaded through `detect`/`open`/`describe`.
 *
 * Section 5.2 names this type but never defines it. This pilot deliberately keeps it to
 * *declared facts plus cancellation*: the same axes `AssetSourceContext` already carries, plus
 * the host identity needed to filter viewer contributions. Host **services** (a mod workspace
 * manager, a VFS, a schema registry) are injected into the codec at construction instead, so a
 * context value stays cheap, serializable-ish, and impossible to smuggle capabilities through.
 */
export interface ArtifactContext {
  /** Stable game codec ID, e.g. `starcraft-2`. Never a display name. */
  readonly gameId?: string
  /** Game build/version string when the host knows it. */
  readonly build?: string
  /** Active locale, e.g. `enUS`. */
  readonly locale?: string
  /** Host asking for the work, so contributions can be filtered without a second pass. */
  readonly hostId?: HostId
  /** Stable codec IDs of enclosing semantic artifacts, outermost first. */
  readonly parentArtifactIds?: readonly string[]
  readonly cancellation?: CancellationToken
}

/**
 * Runtime services supplied for one open operation.
 *
 * These values are deliberately separate from {@link ArtifactContext}: the context contains
 * declared, serializable-ish facts used by detection, while open options may carry live host
 * services. A codec may retain the resolver on its runtime document, but never in the
 * serializable descriptor.
 */
export interface ArtifactOpenOptions {
  readonly contentResolver?: GameContentResolver
}

/** Canonical architecture section 5.2, verbatim. */
export interface GameArtifactCodec<TDocument> {
  readonly id: string
  readonly kind: GameArtifactKind
  readonly supportedGames: readonly string[]
  readonly sourceKinds: readonly AssetSourceKind[]

  detect(source: AssetSource, context: ArtifactContext): Promise<DetectionResult>
  open(
    source: AssetSource,
    context: ArtifactContext,
    options?: ArtifactOpenOptions,
  ): Promise<TDocument>
  describe(document: TDocument, context: ArtifactContext): Promise<AssetDescriptor>
  createSession(
    document: TDocument,
    context: ArtifactContext,
    descriptor: AssetDescriptor,
    options?: ArtifactOperationSessionOptions,
  ): ArtifactOperationSession | Promise<ArtifactOperationSession>

  /**
   * The operations this codec can ever offer, with their default state. `describe()` returns
   * the *per-document* states, which may disable an operation the codec generally supports.
   */
  readonly operations: readonly AssetOperationDescriptor[]
}

/**
 * Canonical architecture section 5.3, verbatim.
 *
 * "`mods-processing` owns the default mounted-workspace implementation. A replay asks for the
 * content matching its game/build/map metadata through this interface."
 */
export interface GameContentResolver {
  readonly gameId: string
  readonly build?: string
  readonly mounts: readonly ContentMount[]

  /** Resolve the winning source, or the selected mount's source when `mountIds` is supplied. */
  resolve(request: ContentResolveRequest): Promise<AssetSource | undefined>
  /** Resolve every matching mount with explicit load/resolution ordering and provenance. */
  resolveAll(request: ContentResolveRequest): AsyncIterable<ResolvedContentSource>
  list(request?: ContentListRequest): AsyncIterable<AssetChild>
  dependencies(): Promise<readonly ContentDependency[]>
}
