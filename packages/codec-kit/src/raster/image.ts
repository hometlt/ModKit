/**
 * A decoded raster: what every image codec returns and every raster operation consumes. It is
 * codec-kit's own vocabulary, so no extension's codec has to be installed for a package to name it.
 */
export interface RgbaImage {
  width: number
  height: number
  /** Row-major RGBA8 pixels. Length must be width * height * 4. */
  pixels: Uint8Array
}

/**
 * A decoder for a standard payload (DDS, PNG, TGA) that a proprietary container wraps, handed in by
 * the codec that owns the container. Which payload sits inside is that codec's knowledge, so
 * codec-kit takes the decoder instead of naming a format; it may resolve asynchronously.
 */
export type EmbeddedImageDecoderAsync = (bytes: Uint8Array) => Promise<RgbaImage> | RgbaImage
