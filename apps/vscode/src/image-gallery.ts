/**
 * What the explorer's gallery needs from the extension host: which names are pictures, and a small
 * picture of one of them.
 *
 * The gallery used to be a sidebar view of its own; it is part of the webview file explorer now, so
 * it shows whatever that explorer lists — archive members, folder files, content-source entries.
 */
import type { Inventory, SubjectOpener } from '@modkit/host'
import { renderModelGalleryThumbnail, type ModelGalleryOptions } from './model-gallery.js'
import type {
  ByteRangeSource,
  Lease,
  RasterImageSource,
  RasterRegion,
  VectorSceneSource,
} from '@modkit/sdk'

/** Largest decode the gallery asks for; a bigger picture is drawn from a smaller mip or not at all. */
const MAXIMUM_THUMBNAIL_SOURCE_BYTES = 16 * 1024 * 1024
/** Longest SVG text a vector thumbnail carries to the page. */
const MAXIMUM_THUMBNAIL_SVG_CHARACTERS = 2 * 1024 * 1024
/** Largest file the page is asked to decode itself. */
export const MAXIMUM_BROWSER_IMAGE_BYTES = 16 * 1024 * 1024

/** Formats a browser decodes on its own, by extension. */
const BROWSER_IMAGE_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

/**
 * The media type of a picture the page can decode itself (plan 7.37): the fallback for a format
 * whose codec publishes no decoded pixels (WebP, GIF animations) or none at all.
 */
export function browserImageType(name: string): string | undefined {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? undefined : BROWSER_IMAGE_TYPES[name.slice(dot + 1).toLowerCase()]
}

/** Enabled picture codecs, with model codecs opted into the explorer separately from Convert. */
export function imageGalleryExtensions(
  inventory: Inventory,
  includeModels = false,
): ReadonlySet<string> {
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
          [
            'common.view/raster-image-source',
            'common.view/vector-scene-source',
            ...(includeModels ? ['common.view/model-scene-source'] : []),
          ].includes(source.contract),
        )
      )
        continue
      for (const suffix of spec.match?.extensions ?? [])
        result.add(suffix.replace(/^\./u, '').toLowerCase())
    }
  }
  return result
}

/**
 * A small picture: decoded pixels, or a vector picture's SVG text (SVG, EMF, WMF — plan 7.37), which
 * the page draws, having the canvas the extension host lacks.
 */
export type GalleryThumbnail =
  | { readonly width: number; readonly height: number; readonly rgba: Uint8Array }
  | { readonly svg: string }
  /** A file in a format the page decodes itself. */
  | { readonly image: Uint8Array; readonly mediaType: string }
  /** A font's own bytes, which the page sets a sample in (plan 7.26). */
  | { readonly font: Uint8Array }

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
  models?: ModelGalleryOptions,
): Promise<GalleryThumbnail | undefined> {
  const opened = await open(ref, signal)
  const session = opened.session
  if (session === undefined) return undefined
  try {
    // a font is shown as text set in it, not as its glyph sheet shrunk to a thumbnail
    const descriptor = await Promise.resolve()
      .then(() => session.descriptor())
      .catch(() => undefined)
    if (descriptor?.traits.some(trait => trait.id === 'content.fonts') === true) {
      return await fontThumbnail(session, signal)
    }
    return (
      (await rasterThumbnail(session, maxEdge, signal).catch(() => undefined)) ??
      (await vectorThumbnail(session, signal)) ??
      (models === undefined
        ? undefined
        : await renderModelGalleryThumbnail(opened, models, maxEdge, signal))
    )
  } finally {
    await session.dispose()
  }
}

async function fontThumbnail(
  session: ThumbnailSession,
  signal?: AbortSignal,
): Promise<GalleryThumbnail | undefined> {
  const lease = (await session
    .dataSource('common.view/byte-range-source', 1)
    .catch(() => undefined)) as Lease<ByteRangeSource> | undefined
  if (lease === undefined) return undefined
  try {
    const size = await lease.value.size()
    if (size > BigInt(MAXIMUM_THUMBNAIL_SOURCE_BYTES)) return undefined
    // a copy the bridge can carry: the read may view a pooled buffer
    return { font: new Uint8Array(await lease.value.read(0n, Number(size), signal)) }
  } finally {
    await lease.release()
  }
}

type ThumbnailSession = NonNullable<Awaited<ReturnType<SubjectOpener>>['session']>

async function vectorThumbnail(
  session: ThumbnailSession,
  signal?: AbortSignal,
): Promise<GalleryThumbnail | undefined> {
  const lease = (await session
    .dataSource('common.view/vector-scene-source', 1)
    .catch(() => undefined)) as Lease<VectorSceneSource> | undefined
  if (lease === undefined) return undefined
  try {
    const document = await lease.value.document(signal)
    return document.text.length <= MAXIMUM_THUMBNAIL_SVG_CHARACTERS
      ? { svg: document.text }
      : undefined
  } finally {
    await lease.release()
  }
}

async function rasterThumbnail(
  session: ThumbnailSession,
  maxEdge: number,
  signal?: AbortSignal,
): Promise<GalleryThumbnail | undefined> {
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
  }
}
