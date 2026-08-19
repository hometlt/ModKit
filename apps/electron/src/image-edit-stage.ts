/**
 * Editable image stage — `createImageEditor` over a codec's raster source.
 *
 * `@modkitx-x3/ui` ships the editing surface but no viewer contribution for it, so the application
 * composes the stage. What it deliberately does **not** compose is a save path: this host has no
 * writer for image bytes yet (the host's `createSubjectEditing` ports are landing in a Root slice),
 * and inventing one — re-encoding the canvas in the renderer and writing the file — would produce
 * a file no codec vouched for.
 *
 * So the stage is honest instead of hopeful: it says the edits are in memory, it marks itself
 * `readonly` for themes and assistive technology, and its Save control is disabled with the reason
 * on it. It is registered as a plain (non-`editable`) stage, which is what keeps
 * `createCodecPreview` from handing it the four editor ports and implying a commit that cannot
 * happen.
 */
import {
  createImageEditor,
  createSurface,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  ViewerMountScope,
  type ImageEditor,
} from '@modkitx-x3/ui'
import type { RasterImageSource, ViewerModule } from '@modkitx-x3/sdk'

/** The same ceiling the read-only image stage applies before it materialises pixels. */
const MAXIMUM_DECODED_BYTES = 64 * 1024 * 1024

export const IMAGE_EDIT_NO_SAVE_PATH =
  'Edits are in memory only: this host has no save path for image bytes yet.'

/** Decode the codec's raster source to pixels, preferring its own decoded access. */
async function loadPixels(
  source: RasterImageSource,
  container: HTMLElement,
  signal?: AbortSignal,
): Promise<ImageData> {
  const info = await source.info(signal)
  const decodedBytes = info.width * info.height * 4
  if (
    info.decodedAccess &&
    source.readRegion !== undefined &&
    Number.isSafeInteger(decodedBytes) &&
    decodedBytes <= MAXIMUM_DECODED_BYTES
  ) {
    const region = await source.readRegion(
      {
        x: 0,
        y: 0,
        width: info.width,
        height: info.height,
        frame: 0,
        mipLevel: 0,
        layer: 0,
        face: 0,
        slice: 0,
        pixelFormat: 'rgba8',
        maxBytes: MAXIMUM_DECODED_BYTES,
      },
      signal,
    )
    const pixels = new Uint8ClampedArray(region.pixels.byteLength)
    pixels.set(region.pixels)
    return new ImageData(pixels, region.width, region.height)
  }

  const encoded = await source.encoded(signal)
  const media = await encoded.descriptor()
  if (media.bytes > BigInt(MAXIMUM_DECODED_BYTES)) {
    throw new RangeError(`encoded image exceeds the editing budget: ${media.bytes} bytes`)
  }
  const total = Number(media.bytes)
  const bytes = new Uint8Array(total)
  let offset = 0
  while (offset < total) {
    const chunk = await encoded.read(BigInt(offset), Math.min(1024 * 1024, total - offset), signal)
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError('encoded image ended outside its declared size')
    }
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: media.mediaType }))
  try {
    const canvas = container.ownerDocument.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new TypeError('2d canvas context is unavailable')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

export const imageEditStage: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Image editor')
    const stage = element(root, 'div', { part: 'image' })
    const readout = element(stage, 'output', { part: 'image.readout' })
    const canvas = element(stage, 'canvas', { part: 'image.canvas' }) as HTMLCanvasElement
    canvas.tabIndex = 0

    const lease = await args.sources.getUnknown({
      bindingId: 'content',
      contract: 'common.view/raster-image-source',
      major: 1,
    } as never)
    if (lease === undefined) throw new TypeError('image binding is unavailable')
    scope.lease(lease)

    setState(stage, ['loading'])
    try {
      const pixels = await loadPixels(lease.value as RasterImageSource, stage, scope.signal)
      const surface: ImageEditor = createImageEditor(stage, {
        source: pixels,
        onChange: current => {
          setViewerText(
            readout,
            `${current.width}x${current.height} · edited in memory · ${IMAGE_EDIT_NO_SAVE_PATH}`,
          )
        },
      })
      scope.cleanup(() => surface.destroy())
      canvas.width = pixels.width
      canvas.height = pixels.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new TypeError('2d canvas context is unavailable')
      context.putImageData(surface.pixels, 0, 0)
      surface.attach(canvas, scope.signal)

      // The one control a user looks for, present and explicitly unavailable rather than absent.
      const save = element(stage, 'button', {
        part: 'operations.button',
        text: 'Save',
      }) as HTMLButtonElement
      save.type = 'button'
      save.disabled = true
      save.title = IMAGE_EDIT_NO_SAVE_PATH
      // `readonly` is the registered state for "this surface cannot write back".
      setState(stage, ['readonly'])
      setViewerText(readout, `${pixels.width}x${pixels.height} · ${IMAGE_EDIT_NO_SAVE_PATH}`)
    } catch (error) {
      setState(stage, ['error'])
      canvas.remove()
      element(stage, 'p', {
        part: 'viewer.empty',
        text: `These bytes cannot be opened for editing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }

    return {
      async update() {
        // Pixels are the user's working copy; a descriptor refresh must not discard their edits.
      },
      async unmount() {
        await scope.close()
        root.remove()
      },
    }
  },
})
