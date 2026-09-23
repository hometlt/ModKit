/**
 * What the explorer's gallery needs from the extension host: which names are pictures, and a small
 * picture of one of them.
 *
 * The gallery used to be a sidebar view of its own; it is part of the webview file explorer now, so
 * it shows whatever that explorer lists — archive members, folder files, content-source entries.
 */
import type { Inventory, SubjectOpener } from '@modkit/host'
import type { Lease, RasterImageSource, RasterRegion } from '@modkit/sdk'

/** Largest decode the gallery asks for; a bigger picture is drawn from a smaller mip or not at all. */
const MAXIMUM_THUMBNAIL_SOURCE_BYTES = 16 * 1024 * 1024

/** Image support comes from enabled codec contracts, including external extensions. */
export function imageGalleryExtensions(inventory: Inventory): ReadonlySet<string> {
  const result = new Set<string>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.activationEligible) continue
      const manifest = contribution.manifest
      if (manifest?.contract.id !== 'modkit/codec-contribution') continue
      const spec = manifest.spec as {
        publishesDataSources?: readonly { contract: string }[]
        match?: { extensions?: readonly string[] }
      }
      if (
        !spec.publishesDataSources?.some(source =>
          ['common.view/raster-image-source', 'common.view/vector-scene-source'].includes(
            source.contract,
          ),
        )
      )
        continue
      for (const suffix of spec.match?.extensions ?? [])
        result.add(suffix.replace(/^\./u, '').toLowerCase())
    }
  }
  return result
}

export interface GalleryThumbnail {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

/** Nearest-neighbour downscale of a decoded region to at most `maxEdge` on its long side. */
export function galleryThumbnail(region: RasterRegion, maxEdge = 96): GalleryThumbnail {
  const scale = Math.min(1, maxEdge / Math.max(region.width, region.height))
  const width = Math.max(1, Math.round(region.width * scale))
  const height = Math.max(1, Math.round(region.height * scale))
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = Math.floor(y / scale) * region.rowStride + Math.floor(x / scale) * 4
      rgba.set(region.pixels.subarray(from, from + 4), (y * width + x) * 4)
    }
  }
  return { width, height, rgba }
}

/**
 * A picture of the subject `ref` names, through the same opener every other open in this window
 * uses: a path in the granted folders, a `modkit-container:` member or a `modkit-source:` file.
 * `undefined` when its codec publishes no decoded pixels.
 */
export async function renderGalleryThumbnail(
  open: SubjectOpener,
  ref: string,
  maxEdge = 96,
  signal?: AbortSignal,
): Promise<GalleryThumbnail | undefined> {
  const opened = await open(ref, signal)
  const session = opened.session
  if (session === undefined) return undefined
  let raster: Lease<RasterImageSource> | undefined
  try {
    raster = await session.dataSource('common.view/raster-image-source', 1)
    const info = await raster.value.info(signal)
    if (!info.decodedAccess || !raster.value.readRegion) return undefined
    let mipLevel = 0
    while (
      mipLevel + 1 < info.mipLevels &&
      Math.max(info.width, info.height) / 2 ** mipLevel > maxEdge
    )
      mipLevel++
    const width = Math.max(1, Math.floor(info.width / 2 ** mipLevel))
    const height = Math.max(1, Math.floor(info.height / 2 ** mipLevel))
    if (width * height * 4 > MAXIMUM_THUMBNAIL_SOURCE_BYTES) return undefined
    const region = await raster.value.readRegion(
      {
        x: 0,
        y: 0,
        width,
        height,
        mipLevel,
        frame: 0,
        layer: 0,
        face: 0,
        slice: 0,
        pixelFormat: 'rgba8',
        maxBytes: MAXIMUM_THUMBNAIL_SOURCE_BYTES,
      },
      signal,
    )
    return galleryThumbnail(region, maxEdge)
  } finally {
    await raster?.release()
    await session.dispose()
  }
}
