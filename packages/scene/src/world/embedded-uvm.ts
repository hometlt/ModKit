import { diagnostic } from '@modkit/core'
import { resizeRgba } from '@modkit/codec-kit/raster'
import type { RasterResourcePort, SceneRendererTexture } from '@modkit/sdk'
import type { WorldSceneModelResult } from '@modkit/sdk/maps'
import { readUvmContainer } from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import type { UvwEmbeddedModelDecoder } from '@modkit/uv/world'

import { readUvmFacets } from '../uvm/facets.js'
import {
  prepareUvmImages,
  uvmImageColorKeys,
  uvmImageFilters,
  uvmImageResourceId,
  uvmImagesIgnoringAlpha,
  uvmImageTexels,
} from '../uvm/images.js'
import { colorKeyedTexture, storedAlphaIgnored } from './color-keys.js'
import { readUvmModel } from '../uvm/model.js'

function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new TypeError('invalid embedded UVM budget')
  return result
}

/** Decode one package-owned UVM without native codecs, CASC, WZ or filesystem lookup. External
 * images are admitted only when their confined URI is present in the owning UVP media table. */
export function createEmbeddedUvmWorldModelDecoder(
  rasterResources?: RasterResourcePort,
): UvwEmbeddedModelDecoder {
  return async (input, request, signal): Promise<WorldSceneModelResult> => {
    signal?.throwIfAborted()
    const maxBytes = positive(request.maxBytes, 0)
    const maxNodes = positive(request.maxNodes, request.maxMeshes)
    positive(request.maxMeshes, 0)
    positive(request.maxPrimitives, 0)
    const maxPrimitiveBytes = positive(request.maxPrimitiveBytes, 0)
    const maxResources = positive(request.maxResources, maxNodes)
    const maxTextureBytes = positive(request.maxTextureBytes, Math.min(maxBytes, 16 * 1024 * 1024))
    const maxTextureTotalBytes = positive(
      request.maxTextureTotalBytes,
      Math.min(maxBytes, 32 * 1024 * 1024),
    )
    if (input.bytes.byteLength > maxBytes) throw new RangeError('embedded UVM exceeds maxBytes')
    const container = readUvmContainer(
      input.bytes,
      { maxInputBytes: maxBytes, maxJsonBytes: maxBytes, maxDepth: 128, maxNodes: 1_000_000 },
      signal,
    )
    validateUvmDocument(container.document, {
      binaryByteLength: container.binary.byteLength,
      ...(signal === undefined ? {} : { signal }),
    })
    const model = readUvmModel(
      container.document,
      container.binary,
      { maxScalarBytes: maxBytes },
      signal,
    )
    if (model.scene.nodes.length > maxNodes) throw new RangeError('embedded UVM exceeds maxNodes')
    if (model.scene.meshes.length > request.maxMeshes)
      throw new RangeError('embedded UVM exceeds maxMeshes')
    if (model.scene.primitives.length > request.maxPrimitives)
      throw new RangeError('embedded UVM exceeds maxPrimitives')
    for (const primitive of model.scene.primitives) {
      const bytes =
        primitive.positions.byteLength +
        (primitive.indices?.byteLength ?? 0) +
        (primitive.normals?.byteLength ?? 0) +
        (primitive.tangents?.byteLength ?? 0) +
        (primitive.colors?.byteLength ?? 0) +
        (primitive.textureCoordinates?.byteLength ?? 0) +
        (primitive.boneIndices?.byteLength ?? 0) +
        (primitive.boneWeights?.byteLength ?? 0)
      if (bytes > maxPrimitiveBytes)
        throw new RangeError('embedded UVM primitive exceeds maxPrimitiveBytes')
    }
    const facets = readUvmFacets(
      container.document,
      container.binary,
      { maxScalarBytes: maxBytes },
      signal,
    )
    const diagnostics = []
    const resources = []
    const textures: SceneRendererTexture[] = []
    const images = container.document['images']
    // images the game loads with a colour key (UV_texture_color_key): keyed once, here; each
    // sampled with the filter its sampler names
    const colorKeys = uvmImageColorKeys(container.document, signal)
    const opaque = uvmImagesIgnoringAlpha(container.document, signal)
    const filters = uvmImageFilters(container.document)
    let textureBytes = 0
    if (Array.isArray(images)) {
      if (images.length > maxResources) throw new RangeError('embedded UVM exceeds maxResources')
      const prepared = prepareUvmImages(
        container.document,
        container.binary,
        images.map((_, index) => index),
        maxBytes,
        signal,
      )
      // Only consult the package table for logical resources. Never forward a URI to the host.
      const bytesOf = ({ image: index, source }: (typeof prepared)[number]) => {
        const candidate = images[index]
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
          throw new TypeError(`embedded UVM image ${String(index)} is invalid`)
        const uri = (candidate as { readonly uri?: unknown }).uri
        return source.kind === 'embedded'
          ? source
          : typeof uri === 'string'
            ? input.mediaByUri.get(uri)
            : undefined
      }
      // the textures still to read share what is left of the model's texture budget evenly
      let pending = prepared.filter(item => bytesOf(item) !== undefined).length
      for (const item of prepared) {
        signal?.throwIfAborted()
        const id = uvmImageResourceId(container.document, item.image)
        resources.push(
          Object.freeze({ id, role: 'texture' as const, provenance: 'companion' as const }),
        )
        const embedded = bytesOf(item)
        if (embedded === undefined || rasterResources === undefined) {
          diagnostics.push(
            diagnostic(
              'warning',
              'x3.scene/embedded-uvm-texture-unavailable',
              `embedded UVM texture ${id} has no package-owned bytes or raster decoder`,
            ),
          )
          continue
        }
        if (embedded.bytes.byteLength > maxTextureBytes)
          throw new RangeError(`embedded UVM texture ${id} exceeds maxTextureBytes`)
        const left = Math.floor((maxTextureTotalBytes - textureBytes) / Math.max(1, pending))
        pending -= 1
        // Read at the per-texture limit: a texture past what is left of the model's share is
        // shrunk below, not dropped (a package stores plain PNG, with no smaller level to pick).
        const decoded = await rasterResources.read(
          {
            kind: 'embedded',
            bytes: embedded.bytes,
            ...(embedded.mediaType === undefined ? {} : { mediaType: embedded.mediaType }),
            maxBytes: maxTextureBytes,
          },
          signal,
        )
        signal?.throwIfAborted()
        diagnostics.push(...decoded.diagnostics)
        if (decoded.state !== 'decoded' || decoded.info.orientation === 'unknown') {
          diagnostics.push(
            diagnostic(
              'warning',
              'x3.scene/embedded-uvm-texture-undecoded',
              `embedded UVM texture ${id} could not be normalized to top-left RGBA8`,
            ),
          )
          continue
        }
        if (decoded.info.width * decoded.info.height * 4 > maxTextureBytes)
          throw new RangeError(`embedded UVM texture ${id} exceeds maxTextureBytes`)
        // These resources include packed normal/specular channels as well as color images.
        // Preserve their channel values; material presentation owns their interpretation.
        let texels = {
          width: decoded.info.width,
          height: decoded.info.height,
          pixels: uvmImageTexels(decoded, { channels: 'data' }),
        }
        // Past its share of the model's texture budget the texture halves until it fits, as a mip would.
        let { width, height } = texels
        while (width * height * 4 > left && (width > 1 || height > 1)) {
          width = Math.max(1, width >> 1)
          height = Math.max(1, height >> 1)
        }
        if (width * height * 4 > left) {
          diagnostics.push(diagnostic('warning', 'x3.scene/embedded-uvm-texture-over-budget',
            `embedded UVM texture ${id} does not fit the model's texture budget`))
          continue
        }
        if (width !== texels.width || height !== texels.height) {
          diagnostics.push(diagnostic('information', 'x3.scene/embedded-uvm-texture-reduced',
            `embedded UVM texture ${id} reduced from ${String(texels.width)}x${String(texels.height)} to ${String(width)}x${String(height)} to fit the model's texture budget`))
          texels = resizeRgba(texels, width, height)
        }
        const rgba = texels.pixels
        textureBytes += rgba.byteLength
        const filter = filters.get(id)
        const texture = Object.freeze({
          id,
          width,
          height,
          rgba,
          ...(filter === undefined ? {} : { filter }),
        })
        const key = colorKeys.get(id)
        const loaded = opaque.has(id) ? storedAlphaIgnored(texture) : texture
        textures.push(key === undefined ? loaded : colorKeyedTexture(loaded, key))
      }
    }
    return Object.freeze({
      state: 'converted' as const,
      sourceKey: input.digest ?? input.uri,
      uvmBytes: input.bytes.slice(),
      nodes: model.scene.nodes,
      skeleton: model.rig.bindings,
      animations: model.rig.clips,
      materials: facets.materialRefs,
      sockets: facets.sockets,
      resources: Object.freeze(resources),
      textures: Object.freeze(textures),
      meshes: model.scene.meshes,
      primitives: model.scene.primitives,
      diagnostics: Object.freeze(diagnostics),
      complete: textures.length === resources.length,
    })
  }
}
