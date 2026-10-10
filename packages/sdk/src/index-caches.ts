/**
 * One directory of index caches per host, shared by every codec and content source: an index of
 * an installation (CASC names, file contents) is built once, whichever part of Modkit asked for it
 * first, and an application lists, sizes and clears them in one place.
 *
 * The host hands the directory to content-source modules as
 * `ContentSourceModuleContext.indexCacheDirectory` and to contributions as the setting
 * {@link INDEX_CACHE_DIRECTORY_SETTING}. Each cache is a folder in it with an
 * {@link INDEX_CACHE_MANIFEST} describing what it indexes; its owner names the folder (CASC keys it
 * by the installation's canonical path) and keeps its files inside.
 */

/** The contribution setting that carries the shared index cache directory. */
export const INDEX_CACHE_DIRECTORY_SETTING = 'indexCacheDirectory'

/** The manifest file inside each cache folder. */
export const INDEX_CACHE_MANIFEST = 'cache.json'

/**
 * The user's switches per product (`s2`, `d3`): an absent product or kind means enabled. `data`:
 * parsed game data a mod server keeps between runs (SC2: the Data parses of stock mod chains).
 */
export type IndexCacheSwitches = Readonly<
  Record<string, { readonly names?: boolean; readonly content?: boolean; readonly data?: boolean }>
>

/** What a cache keeps: a path index, a text index over contents, or parsed game data. */
export type IndexCacheKind = 'names' | 'content' | 'data'

/** Whether an index of this kind may be kept for this product. */
export function indexCacheEnabled(
  switches: IndexCacheSwitches | undefined,
  product: string,
  kind: IndexCacheKind,
): boolean {
  return switches?.[product]?.[kind] !== false
}

export interface IndexCacheManifest {
  /** The game or format family (`starcraft2`, `roblox`). */
  readonly game: string
  /** The product or build line the index belongs to (`s2`, `wow_classic`), when there is one. */
  readonly product?: string
  /** `names`: a path index; `content`: a text index over file contents; `data`: parsed game data. */
  readonly kind: IndexCacheKind
  /** The indexed installation or root, as the user would recognise it (a directory, a root label). */
  readonly installation: string
}
