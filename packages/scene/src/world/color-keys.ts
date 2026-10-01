import { diagnostic } from '@modkit/core'
import type { SceneRendererTexture } from '@modkit/sdk'
import type { WorldSceneModelResult } from '@modkit/sdk/maps'
import { applyColorKeyTransparency } from '@modkit/codec-kit/raster'
import { readUvmContainer } from '@modkit/uv/model/container'
import type { UvmTextureColorKey } from '@modkit/uv/model/validation'

import {
  opaqueTexels,
  uvmImageColorKeys,
  uvmImageFilters,
  uvmImagesIgnoringAlpha,
} from '../uvm/images.js'

const utf8 = new TextDecoder('utf-8', { fatal: false })

/** What a GLB's JSON chunk mentions at all, before anything is parsed: keys, alpha, filters. */
function mentions(
  bytes: Uint8Array,
): Readonly<{ colorKey: boolean; alpha: boolean; filter: boolean }> {
  if (bytes.byteLength < 20) return { colorKey: false, alpha: false, filter: false }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = Math.min(view.getUint32(12, true), bytes.byteLength - 20)
  const json = utf8.decode(bytes.subarray(20, 20 + jsonLength))
  return {
    colorKey: json.includes('UV_texture_color_key'),
    alpha: json.includes('UV_texture_alpha'),
    filter: json.includes('magFilter'),
  }
}

/** A decoded texture whose stored alpha the game ignores (UV_texture_alpha): opaque, before keying. */
export function storedAlphaIgnored<T extends SceneRendererTexture>(texture: T): T {
  return Object.freeze({ ...texture, rgba: opaqueTexels(texture.rgba) })
}

/** Texels of one decoded texture keyed as the game's loader keyed them: transparent black. */
export function colorKeyedTexture<T extends SceneRendererTexture>(
  texture: T,
  key: UvmTextureColorKey,
): T {
  const [r, g, b] = key.color
  return Object.freeze({
    ...texture,
    rgba: applyColorKeyTransparency(
      { width: texture.width, height: texture.height, pixels: texture.rgba },
      { target: { r, g, b }, tolerance: key.tolerance },
    ).pixels,
  })
}

/**
 * A map object's model with its textures as its UVM states them: colour-keyed textures keyed
 * (UV_texture_color_key, SPEC_UVM §11.6) and each sampled with the filter its sampler names
 * (nearest for pixel art). The host hands the world decoded texels per resource id together with
 * the model's UVM; both statements are in that UVM, so the world applies them once, where a model
 * enters it, and every draw of the model sees the same textures. A texture that arrived as
 * GPU-compressed blocks cannot be keyed without decoding them: it keeps its key colour, and says so.
 */
export function presentWorldModelTextures(
  result: WorldSceneModelResult,
  signal?: AbortSignal,
): WorldSceneModelResult {
  if (
    result.state !== 'converted' ||
    result.uvmBytes === undefined ||
    (result.textures?.length ?? 0) === 0
  )
    return result
  const mentioned = mentions(result.uvmBytes)
  if (!mentioned.colorKey && !mentioned.alpha && !mentioned.filter) return result
  const { document } = readUvmContainer(
    result.uvmBytes,
    {
      maxInputBytes: result.uvmBytes.byteLength,
      maxJsonBytes: result.uvmBytes.byteLength,
      maxDepth: 128,
      maxNodes: 1_000_000,
    },
    signal,
  )
  const keys = mentioned.colorKey ? uvmImageColorKeys(document, signal) : new Map()
  const opaque = mentioned.alpha ? uvmImagesIgnoringAlpha(document, signal) : new Set()
  const filters = mentioned.filter ? uvmImageFilters(document) : new Map()
  if (keys.size === 0 && opaque.size === 0 && filters.size === 0) return result
  const unkeyed: string[] = []
  const textures = (result.textures ?? []).map(texture => {
    const filter = filters.get(texture.id)
    const filtered =
      filter === undefined || texture.filter !== undefined
        ? texture
        : Object.freeze({ ...texture, filter })
    const key = keys.get(texture.id)
    if (key === undefined && !opaque.has(texture.id)) return filtered
    if (texture.compressed !== undefined) {
      unkeyed.push(texture.id)
      return filtered
    }
    const loaded = opaque.has(texture.id) ? storedAlphaIgnored(filtered) : filtered
    return key === undefined ? loaded : colorKeyedTexture(loaded, key)
  })
  return Object.freeze({
    ...result,
    textures: Object.freeze(textures),
    diagnostics: Object.freeze([
      ...result.diagnostics,
      ...unkeyed.map(id =>
        diagnostic(
          'warning',
          'x3.scene/world-texture-color-key-compressed',
          `model texture ${id} arrived as GPU-compressed blocks; its colour key or alpha policy is not applied`,
        ),
      ),
    ]),
  })
}
