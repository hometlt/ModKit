/**
 * Static glTF model surfaces for generic model sources that publish geometry but no material
 * facets. Reuses the UV container, Scene glTF facet/image identity readers and the Host raster
 * port; no filesystem access or independent image parser. Bounded at 64MiB decoded texels.
 * Conflicting sampler identities refuse. Native formats without this public glTF projection
 * remain unsupported rather than becoming white, apparently successful voxel exports.
 */
import type { RasterResourcePort } from '@modkit/sdk'
import type { SceneRendererTexture } from '@modkit/sdk/renderer'
import { readUvmContainer, uvmImageResourceId } from '@modkit/uv/model/container'
import { readUvmFacets } from '../uvm/facets.js'
import { prepareUvmImages, uvmImageTexels } from '../uvm/images.js'
import { array, object, safeIndex } from '../uvm/values.js'

/** Read bounded public container bytes and decode image slices through their subject's Host port. */
export async function readGltfModelSurfaces(
  bytes: Uint8Array,
  raster: RasterResourcePort | undefined,
  signal: AbortSignal,
) {
  if (bytes.byteLength > 64 * 1024 ** 2)
    throw new RangeError('static model container exceeds 64MiB')
  const { document, binary } = readUvmContainer(bytes, undefined, signal)
  const materials = readUvmFacets(
    document,
    binary,
    { maxScalarBytes: 64 * 1024 ** 2 },
    signal,
  ).materialRefs
  const images = array(document, 'images')
  if (images.length > 256) throw new RangeError('model exceeds 256 image budget')
  if (images.length && raster === undefined)
    throw new TypeError('embedded model texture decoder unavailable')
  const textures = new Map<string, SceneRendererTexture>()
  let remaining = 64 * 1024 ** 2
  for (const image of prepareUvmImages(
    document,
    binary,
    images.map((_, i) => i),
    64 * 1024 ** 2,
    signal,
  )) {
    const decoded = await raster!.read(
      { ...image.source, maxBytes: remaining, selection: { mipLevel: 'fit' } },
      signal,
    )
    if (decoded.state !== 'decoded')
      throw new TypeError(`model image ${image.image} could not decode (${decoded.state})`)
    const rgba = uvmImageTexels(decoded)
    if (rgba.byteLength > remaining) throw new RangeError('model decoded textures exceed budget')
    remaining -= rgba.byteLength
    const samplers = array(document, 'samplers')
    let wrap: readonly ['repeat' | 'clamp', 'repeat' | 'clamp'] | undefined
    for (const item of array(document, 'textures')) {
      const texture = object(item, 'texture')
      if (texture['source'] !== image.image) continue
      const sampler =
        texture['sampler'] === undefined
          ? {}
          : object(samplers[safeIndex(texture['sampler'], samplers.length, 'sampler')], 'sampler')
      const modes = [sampler['wrapS'], sampler['wrapT']].map(mode => {
        if (mode !== undefined && mode !== 10497 && mode !== 33071)
          throw new TypeError('model texture wrap mode unsupported')
        return mode === 33071 ? ('clamp' as const) : ('repeat' as const)
      }) as ['repeat' | 'clamp', 'repeat' | 'clamp']
      if (wrap !== undefined && (wrap[0] !== modes[0] || wrap[1] !== modes[1]))
        throw new TypeError('image has conflicting sampler identities')
      wrap = modes
    }
    const id = uvmImageResourceId(document, image.image)
    textures.set(id, {
      id,
      width: decoded.info.width,
      height: decoded.info.height,
      rgba,
      wrapU: wrap?.[0] ?? 'repeat',
      wrapV: wrap?.[1] ?? 'repeat',
    })
  }
  return { materials, textures }
}
