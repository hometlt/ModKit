import { diagnostic } from '@modkit/core'
import type { RasterResourcePort, SceneRendererTexture } from '@modkit/sdk'
import type { WorldSceneModelResult } from '@modkit/sdk/maps'
import { readUvmContainer } from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import type { UvwEmbeddedModelDecoder } from '@modkit/uv/world'

import { readUvmFacets } from '../uvm/facets.js'
import { readUvmModel } from '../uvm/model.js'

function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0) throw new TypeError('invalid embedded UVM budget')
  return result
}

function texture(
  id: string,
  decoded: Awaited<ReturnType<RasterResourcePort['read']>>,
): SceneRendererTexture | undefined {
  if (decoded.state !== 'decoded' || decoded.info.orientation === 'unknown') return undefined
  const rowBytes = decoded.region.width * 4
  const rgba = new Uint8Array(rowBytes * decoded.region.height)
  for (let y = 0; y < decoded.region.height; y += 1) {
    const sourceY = decoded.info.orientation === 'bottom-left' ? decoded.region.height - 1 - y : y
    rgba.set(
      decoded.region.pixels.subarray(
        sourceY * decoded.region.rowStride,
        sourceY * decoded.region.rowStride + rowBytes,
      ),
      y * rowBytes,
    )
  }
  return Object.freeze({ id, width: decoded.region.width, height: decoded.region.height, rgba })
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
    if (model.scene.meshes.length > request.maxMeshes) throw new RangeError('embedded UVM exceeds maxMeshes')
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
      if (bytes > maxPrimitiveBytes) throw new RangeError('embedded UVM primitive exceeds maxPrimitiveBytes')
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
    let textureBytes = 0
    if (Array.isArray(images)) {
      if (images.length > maxResources) throw new RangeError('embedded UVM exceeds maxResources')
      for (const [index, candidate] of images.entries()) {
        signal?.throwIfAborted()
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
          throw new TypeError(`embedded UVM image ${String(index)} is invalid`)
        const image = candidate as { readonly uri?: unknown; readonly name?: unknown }
        if (typeof image.uri !== 'string') continue
        const id = typeof image.name === 'string' && image.name.length > 0 ? image.name : image.uri
        resources.push(Object.freeze({ id, role: 'texture' as const, provenance: 'companion' as const }))
        const embedded = input.mediaByUri.get(image.uri)
        if (embedded === undefined || rasterResources === undefined) {
          diagnostics.push(diagnostic(
            'warning',
            'x3.scene/embedded-uvm-texture-unavailable',
            `embedded UVM texture ${image.uri} is not available in its UVP media table`,
          ))
          continue
        }
        if (embedded.bytes.byteLength > maxTextureBytes)
          throw new RangeError(`embedded UVM texture ${image.uri} exceeds maxTextureBytes`)
        const decoded = await rasterResources.read(
          {
            kind: 'embedded',
            bytes: embedded.bytes,
            ...(embedded.mediaType === undefined ? {} : { mediaType: embedded.mediaType }),
            maxBytes: maxTextureBytes,
          },
          signal,
        )
        const value = texture(id, decoded)
        if (value === undefined) {
          diagnostics.push(diagnostic(
            'warning',
            'x3.scene/embedded-uvm-texture-undecoded',
            `embedded UVM texture ${image.uri} could not be normalized to top-left RGBA8`,
          ))
          continue
        }
        textureBytes += value.rgba.byteLength
        if (textureBytes > maxTextureTotalBytes)
          throw new RangeError('embedded UVM textures exceed maxTextureTotalBytes')
        textures.push(value)
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
