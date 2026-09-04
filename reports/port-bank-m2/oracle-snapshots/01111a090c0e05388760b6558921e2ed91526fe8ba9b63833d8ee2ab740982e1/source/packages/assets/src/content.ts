/**
 * Game-content types referenced by `GameContentResolver` (canonical architecture, section 5.3).
 *
 * Maps, data, layouts, and replays consume a narrow content interface rather than an
 * SC2-specific workspace class. The resolver interface itself is defined by Phase A item 5 and
 * implemented by `mods-processing`; `@modkitx/assets` owns only the domain-neutral value types
 * it references, because nothing lower in the dependency direction can own them.
 */

import type { AssetRequest } from './companions.js'
import type {
  AssetChildListOptions,
  AssetSource,
  AssetSourceDescriptor,
  AssetSourceKind,
} from './source.js'

/**
 * Role of a mount inside an ordered content chain. Mount *order* is game-codec evidence (base
 * before patch before language before user content); the role only labels what a mount is.
 */
export type ContentMountRole =
  'base' | 'patch' | 'language' | 'dependency' | 'workspace' | 'user' | 'overlay'

/**
 * One ordered layer of resolvable content. Later mounts (higher {@link ContentMount.order})
 * shadow earlier ones for the same logical path.
 */
export interface ContentMount {
  readonly id: string
  readonly label?: string
  /** Structural kind of the mounted root; a mount is never a bare `file`. */
  readonly kind: Exclude<AssetSourceKind, 'file'>
  readonly root: AssetSourceDescriptor
  /** Ascending resolution order; the highest matching order wins. */
  readonly order: number
  readonly role?: ContentMountRole
  readonly readOnly: boolean
  /** Locale of a localized mount, e.g. `enUS`. */
  readonly locale?: string
}

/** Listing request across the resolved mount chain. */
export interface ContentListRequest extends AssetChildListOptions {
  /** Resource role, matching {@link import('./companions.js').AssetRequest.role}. */
  readonly role?: string
  /** Restrict listing to these mounts; omit to list the whole chain. */
  readonly mountIds?: readonly string[]
  /** When true, shadowed duplicates from lower mounts are also emitted. */
  readonly includeShadowed?: boolean
}

/** Ordering for sources returned from an ordered content chain. */
export type ContentSourceOrder =
  /** Engine load order: base/dependencies first, winning workspace/overlay last. */
  | 'load'
  /** Lookup order: winning workspace/overlay first, base/dependencies last. */
  | 'resolution'

/**
 * Resolve one logical content path against either the whole chain or selected mounts.
 *
 * `mountIds` is explicit provenance, not a path-routing hint: providers resolve the same
 * logical path inside only those mounts and never infer a mount from string prefixes.
 */
export interface ContentResolveRequest extends AssetRequest {
  readonly mountIds?: readonly string[]
  readonly order?: ContentSourceOrder
}

/** One runtime source together with the ordered mount that supplied it. */
export interface ResolvedContentSource {
  readonly mount: ContentMount
  readonly source: AssetSource
}

export type ContentDependencyKind = 'mod' | 'map' | 'campaign' | 'library' | 'game-data' | 'unknown'

export type ContentDependencyState = 'resolved' | 'missing' | 'ambiguous' | 'circular'

/** One entry of a declared dependency chain, resolved against the available mounts. */
export interface ContentDependency {
  /** Stable dependency identifier as declared by the artifact, e.g. `Mods/Liberty.SC2Mod`. */
  readonly id: string
  readonly kind: ContentDependencyKind
  readonly label?: string
  readonly required: boolean
  readonly state: ContentDependencyState
  /** Where it resolved to, when `state` is `resolved`. */
  readonly source?: AssetSourceDescriptor
  readonly version?: string
  /** Transitive dependencies, in declaration order. */
  readonly dependencies?: readonly ContentDependency[]
  readonly diagnosticIds?: readonly string[]
}

/** Mounts in resolution order (highest {@link ContentMount.order} first). */
export function orderContentMounts(mounts: readonly ContentMount[]): readonly ContentMount[] {
  return [...mounts].sort((a, b) => b.order - a.order || a.id.localeCompare(b.id))
}

/** Flattens a dependency tree depth-first, deduplicated by ID, in first-seen order. */
export function flattenContentDependencies(
  dependencies: readonly ContentDependency[],
): readonly ContentDependency[] {
  const seen = new Set<string>()
  const flat: ContentDependency[] = []
  const visit = (entries: readonly ContentDependency[]): void => {
    for (const entry of entries) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      flat.push(entry)
      if (entry.dependencies) visit(entry.dependencies)
    }
  }
  visit(dependencies)
  return flat
}
