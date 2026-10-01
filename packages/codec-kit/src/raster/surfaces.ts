import type { RasterImageSource, RasterRegionRequest } from '@modkit/sdk'

/** A surface of a texture: frame (sprite sheet, animation), mip level, array layer, cube face, volume slice. */
export interface RasterSurfaceAddress {
  readonly frame: number
  readonly mipLevel: number
  readonly layer: number
  readonly face: number
  readonly slice: number
}

/**
 * `RasterImageSource['readRegion']` over decoded RGBA8 surfaces, for codecs that decode a whole
 * surface and crop (Relic, Unity, Earth 2150 TEX). `sizeOf` answers from the header, without
 * decoding, and `undefined` for a surface the texture lacks; `decode` returns the surface's tightly
 * packed RGBA8, called only for a request that passed the checks. The last decoded surface is kept,
 * so reading one surface in tiles decodes it once.
 */
export function surfaceRegionReader(
  sizeOf: (
    surface: RasterSurfaceAddress,
  ) => Readonly<{ width: number; height: number }> | undefined,
  decode: (surface: RasterSurfaceAddress, signal?: AbortSignal) => Uint8Array | Promise<Uint8Array>,
): NonNullable<RasterImageSource['readRegion']> {
  let held: { readonly key: string; readonly pixels: Uint8Array } | undefined
  return async (request: RasterRegionRequest, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const surface: RasterSurfaceAddress = Object.freeze({
      frame: request.frame ?? 0,
      mipLevel: request.mipLevel ?? 0,
      layer: request.layer ?? 0,
      face: request.face ?? 0,
      slice: request.slice ?? 0,
    })
    const { x, y, width, height, maxBytes } = request
    for (const value of [x, y, width, height, maxBytes, ...Object.values(surface)])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError(
          'raster region coordinates, surface and budget must be non-negative safe integers',
        )
    if (request.pixelFormat !== 'rgba8') throw new RangeError('raster surfaces read as rgba8')
    const size = sizeOf(surface)
    if (size === undefined)
      throw new RangeError(
        `raster surface frame ${surface.frame}, mip ${surface.mipLevel}, layer ${surface.layer}, face ${surface.face}, slice ${surface.slice} is not present`,
      )
    if (x + width > size.width || y + height > size.height)
      throw new RangeError('raster region is outside the surface')
    if (width * height * 4 > maxBytes) throw new RangeError('raster region exceeds maxBytes')
    const key = Object.values(surface).join(':')
    if (held?.key !== key) {
      const pixels = await decode(surface, signal)
      if (pixels.length !== size.width * size.height * 4)
        throw new TypeError(
          `decoded raster surface is ${pixels.length} bytes, not ${size.width}×${size.height} RGBA8`,
        )
      held = { key, pixels }
    }
    const pixels = new Uint8Array(width * height * 4)
    for (let row = 0; row < height; row += 1) {
      const start = ((y + row) * size.width + x) * 4
      pixels.set(held.pixels.subarray(start, start + width * 4), row * width * 4)
    }
    return Object.freeze({
      width,
      height,
      rowStride: width * 4,
      pixelFormat: 'rgba8' as const,
      pixels,
    })
  }
}
