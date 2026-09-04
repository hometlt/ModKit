/**
 * Read/write access to a model container's *embedded* binary payloads (buffers, images) as a
 * tiny synthetic filesystem, addressed the same way archive codecs address entries. Shape
 * mirrors `AssetResolver`/`BaseReader`-style contracts used elsewhere in the codebase
 * (`@modkitx/assets`, `@modkitx/archives-processing`) so hosts can treat "the textures baked
 * into this model" the same way they treat "the files inside this archive" — but this is a
 * model-container concern, not an archive codec, since the payloads live inside one model file
 * rather than behind a directory/entry table.
 *
 * Only formats that genuinely embed binary payloads (not just reference external files by path)
 * implement this. `.glb`/`.gltf` (see `codecs/gltf/vfs.ts`) is the only one today: its binary
 * chunk (or base64 `data:` URIs) really does carry raw bytes addressable by bufferView. Formats
 * that merely *reference* textures by name (M3, Unity mesh, sage-w3x, ...) resolve those through
 * `AssetResolver` against an external archive/VFS instead — there's nothing embedded to expose.
 */

export interface EmbeddedAssetEntry {
  /** Synthetic path, e.g. `images/0.png` or `buffers/0.bin`. Stable for a given parse. */
  path: string
  kind: 'buffer' | 'image'
  /** Index into the container's `buffers`/`images` array. */
  index: number
  mimeType?: string
  byteLength: number
}

export interface EmbeddedAssetVfs {
  /** All embedded entries (excludes external file-path references — those aren't embedded). */
  list(): readonly EmbeddedAssetEntry[]
  exists(path: string): boolean
  /** Raw bytes for an embedded entry. Throws if `path` isn't a known embedded entry. */
  get(path: string): Uint8Array
  /**
   * Replace an embedded entry's bytes in place. Only present when the format supports writing.
   * Mutates the in-memory container; call `toBytes()` to get the re-serialized result.
   */
  set?(path: string, data: Uint8Array): void
  /** Re-serialize the container (reflecting any `set()` calls) back to file bytes. */
  toBytes?(): Uint8Array
}
