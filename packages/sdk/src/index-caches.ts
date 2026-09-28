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

export interface IndexCacheManifest {
  /** The game or format family (`starcraft2`, `roblox`). */
  readonly game: string
  /** The product or build line the index belongs to (`s2`, `wow_classic`), when there is one. */
  readonly product?: string
  /** `names`: a path index; `content`: a text index over file contents. */
  readonly kind: 'names' | 'content'
  /** The indexed installation or root, as the user would recognise it (a directory, a root label). */
  readonly installation: string
}
