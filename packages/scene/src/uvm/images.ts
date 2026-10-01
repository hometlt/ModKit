import type { JsonObject, RasterResourceRequest, RasterResourceResult } from '@modkit/sdk'
import { uvmImageLogicalId } from '@modkit/uv/model/container'
import { readUvmTextureColorKeys, type UvmTextureColorKey } from '@modkit/uv/model/validation'
import { array, object, safeIndex, string } from './values.js'

export interface UvmImage {
  readonly image: number
  readonly source:
    | Omit<Extract<RasterResourceRequest, { kind: 'embedded' }>, 'maxBytes'>
    | Omit<Extract<RasterResourceRequest, { kind: 'logical' }>, 'maxBytes'>
}

export interface UvmTextureImage extends UvmImage {
  readonly texture: number
}

/** Shared identity for a material layer and its package-owned decoded image. */
export function uvmImageResourceId(document: JsonObject, index: number): string {
  const images = array(document, 'images')
  const image = object(images[safeIndex(index, images.length, 'image')], 'image')
  if (typeof image['name'] === 'string' && image['name'].length > 0) return image['name']
  if (typeof image['uri'] === 'string' && !image['uri'].startsWith('data:'))
    return uvmImageLogicalId(image['uri'])
  return `uvm-image-${index}`
}

/**
 * The colour key of each image a document keys (UV_texture_color_key, SPEC_UVM §11.6), by the
 * resource id material layers name it with (uvmImageResourceId). A consumer that holds decoded
 * texels per image rather than per texture (the map world) keys them with this. An image whose
 * textures state different keys is left out: one set of texels cannot carry two keys.
 */
export function uvmImageColorKeys(
  document: JsonObject,
  signal?: AbortSignal,
): ReadonlyMap<string, UvmTextureColorKey> {
  const textures = array(document, 'textures')
  const byImage = new Map<number, UvmTextureColorKey | null>()
  for (const [texture, key] of readUvmTextureColorKeys(document, signal)) {
    const source = object(textures[texture], 'texture')['source']
    if (typeof source !== 'number') continue
    const known = byImage.get(source)
    const same =
      known !== undefined &&
      known !== null &&
      known.tolerance === key.tolerance &&
      known.color.every((channel, index) => channel === key.color[index])
    byImage.set(source, known === undefined || same ? key : null)
  }
  const keys = new Map<string, UvmTextureColorKey>()
  for (const [image, key] of byImage)
    if (key !== null) keys.set(uvmImageResourceId(document, image), key)
  return keys
}

/**
 * The sampling filter each image is stated with (glTF sampler magFilter: NEAREST 9728, LINEAR
 * 9729), by the resource id material layers name it with. An image whose textures state different
 * filters is left out: one set of texels is sampled one way.
 */
export function uvmImageFilters(document: JsonObject): ReadonlyMap<string, 'nearest' | 'linear'> {
  const textures = array(document, 'textures')
  const samplers = document['samplers'] === undefined ? [] : array(document, 'samplers')
  const byImage = new Map<number, 'nearest' | 'linear' | null>()
  for (const candidate of textures) {
    const texture = object(candidate, 'texture')
    const source = texture['source']
    const samplerIndex = texture['sampler']
    if (typeof source !== 'number' || typeof samplerIndex !== 'number') continue
    const magnified = object(samplers[samplerIndex] ?? {}, 'sampler')['magFilter']
    const filter = magnified === 9728 ? 'nearest' : magnified === 9729 ? 'linear' : undefined
    if (filter === undefined) continue
    const known = byImage.get(source)
    byImage.set(source, known === undefined || known === filter ? filter : null)
  }
  const filters = new Map<string, 'nearest' | 'linear'>()
  for (const [image, filter] of byImage)
    if (filter !== null) filters.set(uvmImageResourceId(document, image), filter)
  return filters
}

/** Snapshot referenced image payloads before asynchronous host acquisition. No URI is opened here. */
export function prepareUvmTextureImages(
  document: JsonObject,
  binary: Uint8Array,
  indices: readonly number[],
  maxEmbeddedBytes: number,
  signal?: AbortSignal,
): readonly UvmTextureImage[] {
  const textures = array(document, 'textures'),
    images = array(document, 'images')
  const imageIndices = indices.map(textureIndex => {
    const texture = object(textures[safeIndex(textureIndex, textures.length, 'texture')], 'texture')
    return safeIndex(texture['source'], images.length, 'texture image')
  })
  return prepareUvmImages(document, binary, imageIndices, maxEmbeddedBytes, signal).map(
    (image, index) => Object.freeze({ ...image, texture: indices[index]! }),
  )
}

/** Shared image acquisition for standalone models and models embedded in worlds. */
export function prepareUvmImages(
  document: JsonObject,
  binary: Uint8Array,
  indices: readonly number[],
  maxEmbeddedBytes: number,
  signal?: AbortSignal,
): readonly UvmImage[] {
  if (!Number.isSafeInteger(maxEmbeddedBytes) || maxEmbeddedBytes < 0)
    throw new TypeError('invalid image budget')
  const images = array(document, 'images'),
    views = array(document, 'bufferViews')
  const captured = new Map<number, UvmImage['source']>()
  let remaining = maxEmbeddedBytes
  return indices.map(index => {
    signal?.throwIfAborted()
    const imageIndex = safeIndex(index, images.length, 'image')
    let source = captured.get(imageIndex)
    if (source === undefined) {
      const image = object(images[imageIndex], 'image')
      const mediaType =
        image['mimeType'] === undefined ? undefined : string(image['mimeType'], 'image mimeType')
      if ((image['uri'] === undefined) === (image['bufferView'] === undefined))
        throw new TypeError('UVM image requires exactly one URI or bufferView')
      if (image['uri'] !== undefined) {
        const uri = string(image['uri'], 'image URI')
        if (uri.startsWith('data:')) {
          const comma = uri.indexOf(',')
          if (comma < 0) throw new TypeError('invalid image data URI')
          const declaration = uri.slice(5, comma),
            payload = uri.slice(comma + 1)
          const declaredType = declaration.split(';')[0]
          if (mediaType !== undefined && declaredType !== '' && declaredType !== mediaType)
            throw new TypeError('image data URI and mimeType disagree')
          let bytes: Uint8Array
          if (declaration.endsWith(';base64')) {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload))
              throw new TypeError('invalid image base64')
            const length =
              (payload.length / 4) * 3 -
              (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
            if (length > remaining) throw new RangeError('embedded images exceed budget')
            bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0))
          } else {
            let length = 0
            for (let i = 0; i < payload.length; i++, length++) {
              if (payload[i] === '%') {
                if (!/^[0-9a-f]{2}$/iu.test(payload.slice(i + 1, i + 3)))
                  throw new TypeError('invalid image URI escape')
                i += 2
              } else if (payload.charCodeAt(i) > 127)
                throw new TypeError('image URI bytes must be percent encoded')
            }
            if (length > remaining) throw new RangeError('embedded images exceed budget')
            bytes = new Uint8Array(length)
            for (let i = 0, j = 0; i < payload.length; i++, j++) {
              if (payload[i] === '%') {
                bytes[j] = parseInt(payload.slice(i + 1, i + 3), 16)
                i += 2
              } else bytes[j] = payload.charCodeAt(i)
            }
          }
          remaining -= bytes.length
          const type = mediaType ?? declaredType
          source = { kind: 'embedded', bytes, ...(type ? { mediaType: type } : {}) }
        } else
          source = {
            kind: 'logical',
            requirement: {
              id: `uvm-image-${imageIndex}`,
              logicalId: uvmImageLogicalId(uri),
              role: 'texture',
              scopes: [
                'sibling-directory',
                'workspace-dependency-layer',
                'current-mount',
                'enclosing-container',
              ],
            },
          }
      } else {
        const view = object(
          views[safeIndex(image['bufferView'], views.length, 'image bufferView')],
          'image bufferView',
        )
        const offset = view['byteOffset'] ?? 0,
          length = view['byteLength']
        if (
          view['buffer'] !== 0 ||
          view['byteStride'] !== undefined ||
          typeof offset !== 'number' ||
          typeof length !== 'number' ||
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          offset > binary.length ||
          length > binary.length - offset
        )
          throw new TypeError('image bufferView must name a bounded slice of the UVM BIN chunk')
        if (length > remaining) throw new RangeError('embedded images exceed budget')
        remaining -= length
        source = {
          kind: 'embedded',
          bytes: binary.slice(offset, offset + length),
          ...(mediaType === undefined ? {} : { mediaType }),
        }
      }
      captured.set(imageIndex, source)
    }
    return Object.freeze({ image: imageIndex, source })
  })
}

/** Own tightly packed top-left RGBA. Color images become straight alpha; material data channels
 * retain decoder values, including alpha used for a normal component or mask. */
export function uvmImageTexels(
  result: Extract<RasterResourceResult, { state: 'decoded' }>,
  options: { readonly channels?: 'color' | 'data' } = {},
): Uint8Array {
  if (options.channels !== undefined && options.channels !== 'color' && options.channels !== 'data')
    throw new TypeError('invalid image channel interpretation')
  const { info, region } = result
  if (!['top-left', 'bottom-left'].includes(info.orientation))
    throw new TypeError('image orientation is unknown')
  // `unknown` (a DDS says nothing of what its alpha holds) reads as straight: the material's own
  // alphaMode decides blending, and the model viewer draws such textures the same way
  if (
    options.channels !== 'data' &&
    !['none', 'straight', 'premultiplied', 'unknown'].includes(info.alphaMode)
  )
    throw new TypeError('image alpha mode is invalid')
  if (
    !(region.pixels instanceof Uint8Array) ||
    region.pixelFormat !== 'rgba8' ||
    region.width !== info.width ||
    region.height !== info.height ||
    !Number.isSafeInteger(info.width) ||
    !Number.isSafeInteger(info.height) ||
    info.width <= 0 ||
    info.height <= 0 ||
    !Number.isSafeInteger(region.rowStride) ||
    region.rowStride < info.width * 4 ||
    region.rowStride * (info.height - 1) + info.width * 4 > region.pixels.length
  )
    throw new TypeError('invalid image region')
  const rgba = new Uint8Array(info.width * info.height * 4)
  for (let y = 0; y < info.height; y++) {
    const sourceY = info.orientation === 'top-left' ? y : info.height - 1 - y
    rgba.set(
      region.pixels.subarray(
        sourceY * region.rowStride,
        sourceY * region.rowStride + info.width * 4,
      ),
      y * info.width * 4,
    )
  }
  if (options.channels !== 'data' && info.alphaMode === 'premultiplied')
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] ?? 0
      for (let channel = 0; channel < 3; channel++)
        rgba[i + channel] =
          alpha === 0 ? 0 : Math.min(255, Math.round(((rgba[i + channel] ?? 0) * 255) / alpha))
    }
  return rgba
}
