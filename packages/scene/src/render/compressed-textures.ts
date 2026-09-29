import type { CompressedTextureFormat } from '@modkit/sdk'
import type { SceneRendererTexture } from '@modkit/sdk/renderer'
import { decodeBcSurface, type BcFormat } from '@modkit/codec-kit/texture/bc'
import { textureAnisotropy } from './texture-filtering.js'

/**
 * Block formats a world scene uploads as they are stored (WEBGL_compressed_texture_s3tc), and the
 * name codec-kit's decoder knows them by for a context without the extension. BC1 is the RGBA
 * variant: its fourth colour of a two-colour block is transparent, as the decoder makes it.
 */
const S3TC: ReadonlyMap<string, Readonly<{ internalFormat: number; bc: BcFormat }>> = new Map<
  string,
  Readonly<{ internalFormat: number; bc: BcFormat }>
>([
  ['bc1-rgba-unorm', Object.freeze({ internalFormat: 0x83f1, bc: 'DXT1' as const })],
  ['bc2-rgba-unorm', Object.freeze({ internalFormat: 0x83f2, bc: 'DXT3' as const })],
  ['bc3-rgba-unorm', Object.freeze({ internalFormat: 0x83f3, bc: 'DXT5' as const })],
])

/**
 * The block formats a world viewer asks its textures in (`compressedTextureFormats`). BC4 and BC5
 * are not among them: the GPU samples them as (r, 0, 0, 1) and (r, g, 0, 1) where the decoded
 * texels the materials were matched against repeat the channels, so they still arrive decoded.
 */
export const SCENE_COMPRESSED_TEXTURE_FORMATS: readonly CompressedTextureFormat[] = Object.freeze([
  ...S3TC.keys(),
])

const DECODABLE: ReadonlyMap<string, Readonly<{ bc: BcFormat; snorm: boolean }>> = new Map<
  string,
  Readonly<{ bc: BcFormat; snorm: boolean }>
>([
  ...[...S3TC].map(([format, { bc }]) => [format, Object.freeze({ bc, snorm: false })] as const),
  ['bc4-r-unorm', Object.freeze({ bc: 'BC4' as const, snorm: false })],
  ['bc4-r-snorm', Object.freeze({ bc: 'BC4' as const, snorm: true })],
  ['bc5-rg-unorm', Object.freeze({ bc: 'BC5' as const, snorm: false })],
  ['bc5-rg-snorm', Object.freeze({ bc: 'BC5' as const, snorm: true })],
])

const decodedTexels = new WeakMap<SceneRendererTexture, Uint8Array>()

/**
 * The RGBA8 texels of a scene texture: its own, or its first stored level decoded once and kept for
 * the texture's life. For what reads pixels on the CPU (cliff masks, terrain layer arrays) and for a
 * context that cannot upload the blocks.
 */
export function sceneTexturePixels(texture: SceneRendererTexture): Uint8Array {
  const compressed = texture.compressed
  if (compressed === undefined) return texture.rgba
  let texels = decodedTexels.get(texture)
  if (texels === undefined) {
    const decoder = DECODABLE.get(compressed.format)
    const level = compressed.subresources[0]
    if (decoder === undefined || level === undefined)
      throw new TypeError(`scene texture ${texture.id} has blocks of an undecodable format`)
    if (level.width !== texture.width || level.height !== texture.height)
      throw new TypeError(`scene texture ${texture.id} has blocks of another size`)
    texels = decodeBcSurface(level.data, 0, level.width, level.height, decoder.bc, decoder.snorm)
    decodedTexels.set(texture, texels)
  }
  return texels
}

/** Bytes a texture holds: its stored blocks, or its RGBA8 texels. */
export function sceneTextureByteLength(texture: SceneRendererTexture): number {
  if (texture.compressed === undefined) return texture.rgba.byteLength
  let bytes = 0
  for (const level of texture.compressed.subresources) bytes += level.data.byteLength
  return bytes
}

const s3tcSupport = new WeakMap<WebGL2RenderingContext, boolean>()

/** A level WebGL takes as S3TC: 0, 1, 2 or a multiple of 4 on each axis (level 0: a multiple). */
function s3tcLevelSize(size: number, level: number): boolean {
  return size % 4 === 0 || (level > 0 && size <= 2)
}

/**
 * Allocate and fill the TEXTURE_2D_ARRAY bound now with the layers' stored blocks, one level chain
 * for all of them: the size is the smallest layer's (a larger layer starts at its level of that
 * size, as its file stores it), the levels those every layer has. Undefined, with nothing
 * allocated, where a layer is missing or decoded, the formats differ, a layer's chain does not pass
 * through the size, or the context cannot take the format: the caller builds the array of texels.
 */
export function uploadCompressedTextureArray(
  gl: WebGL2RenderingContext,
  textures: readonly (SceneRendererTexture | undefined)[],
  filter: 'nearest' | 'linear',
): Readonly<{ width: number; height: number; bytes: number }> | undefined {
  const layers: SceneRendererTexture[] = []
  for (const texture of textures) {
    if (texture?.compressed === undefined) return undefined
    layers.push(texture)
  }
  const first = layers[0]?.compressed
  const format = first === undefined ? undefined : S3TC.get(first.format)
  if (first === undefined || format === undefined || !s3tcSupported(gl)) return undefined
  if (layers.some(layer => layer.compressed!.format !== first.format)) return undefined
  const width = Math.min(...layers.map(layer => layer.width))
  const height = Math.min(...layers.map(layer => layer.height))
  // Each layer's levels from the one of the array's size down.
  const chains = layers.map(layer => {
    const levels = layer.compressed!.subresources
    const start = levels.findIndex(level => level.width === width && level.height === height)
    return start < 0 ? undefined : levels.slice(start)
  })
  if (chains.some(chain => chain === undefined)) return undefined
  const count = Math.min(...chains.map(chain => chain!.length))
  const sizes = chains[0]!.slice(0, count)
  if (
    count === 0 ||
    sizes.some(
      (level, index) => !s3tcLevelSize(level.width, index) || !s3tcLevelSize(level.height, index),
    ) ||
    chains.some(chain =>
      chain!
        .slice(0, count)
        .some(
          (level, index) =>
            level.width !== sizes[index]!.width || level.height !== sizes[index]!.height,
        ),
    )
  )
    return undefined
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, count, format.internalFormat, width, height, layers.length)
  let bytes = 0
  chains.forEach((chain, layer) =>
    chain!.slice(0, count).forEach((level, index) => {
      gl.compressedTexSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        index,
        0,
        0,
        layer,
        level.width,
        level.height,
        1,
        format.internalFormat,
        level.data,
      )
      bytes += level.data.byteLength
    }),
  )
  applyStoredLevelFilter(gl, gl.TEXTURE_2D_ARRAY, count, filter)
  return Object.freeze({ width, height, bytes })
}

/**
 * Upload a texture's stored blocks, every stored level, to the texture bound at TEXTURE_2D, with
 * the filter the texel path applies (mips from the file, not generated). False, with nothing
 * uploaded, where the context lacks WEBGL_compressed_texture_s3tc, the format is not S3TC or a
 * level is not whole blocks: the caller uploads `sceneTexturePixels` instead.
 */
export function uploadCompressedTexture(
  gl: WebGL2RenderingContext,
  texture: SceneRendererTexture,
  filter: 'nearest' | 'linear',
): boolean {
  const compressed = texture.compressed
  const format = compressed === undefined ? undefined : S3TC.get(compressed.format)
  if (compressed === undefined || format === undefined) return false
  const levels = compressed.subresources
  if (
    !s3tcSupported(gl) ||
    levels.length === 0 ||
    levels.some(
      (level, index) =>
        level.mipLevel !== index ||
        !s3tcLevelSize(level.width, index) ||
        !s3tcLevelSize(level.height, index),
    )
  )
    return false
  for (const level of levels)
    gl.compressedTexImage2D(
      gl.TEXTURE_2D,
      level.mipLevel,
      format.internalFormat,
      level.width,
      level.height,
      0,
      level.data,
    )
  applyStoredLevelFilter(gl, gl.TEXTURE_2D, levels.length, filter)
  return true
}

function s3tcSupported(gl: WebGL2RenderingContext): boolean {
  let supported = s3tcSupport.get(gl)
  if (supported === undefined) {
    supported = gl.getExtension('WEBGL_compressed_texture_s3tc') !== null
    s3tcSupport.set(gl, supported)
  }
  return supported
}

/** The filter the texel path applies, over the levels the file stores instead of generated ones. */
function applyStoredLevelFilter(
  gl: WebGL2RenderingContext,
  target: number,
  levels: number,
  filter: 'nearest' | 'linear',
): void {
  gl.texParameteri(target, gl.TEXTURE_BASE_LEVEL, 0)
  gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, levels - 1)
  if (filter === 'nearest') {
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return
  }
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  const anisotropy = textureAnisotropy(gl)
  if (anisotropy !== undefined) gl.texParameterf(target, anisotropy.parameter, anisotropy.value)
}
