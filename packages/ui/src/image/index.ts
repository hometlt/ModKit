/**
 * ImageStage — MK2 `modkit.assetsTextureViewer` parity over the raster-image contract.
 *
 * The codec supplies image facts plus an encoded representation. The lightweight stage may use the
 * platform decoder; a separately selected decoder provider can expose decoded regions without
 * changing this viewer or importing another format codec.
 *
 * Rendering goes to a canvas, so no `img-src blob:` allowance is required.
 */
import type { RasterImageSource, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { setToken } from '../tokens/index.js'
import { collectEncodedMedia } from '../media/encoded.js'
import type { UiLocalizer } from '../localization/index.js'
import { IMAGE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** Refuse to materialise more than this; a texture atlas is fine, a 2 GiB blob is not. */
export const IMAGE_MAXIMUM_BYTES = 64 * 1024 * 1024

export type ImageBackground = 'checker' | 'dark' | 'light'
export type ImageChannel = 'rgb' | 'r' | 'g' | 'b' | 'a'

export interface ImageStageModel {
  readonly bitmap: ImageBitmap
  readonly bytes: number
}

async function loadBitmap(
  source: RasterImageSource,
  signal?: AbortSignal,
): Promise<ImageStageModel> {
  const info = await source.info(signal)
  const decodedBytes = info.width * info.height * 4
  if (
    info.decodedAccess &&
    source.readRegion !== undefined &&
    Number.isSafeInteger(decodedBytes) &&
    decodedBytes <= IMAGE_MAXIMUM_BYTES
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
        maxBytes: IMAGE_MAXIMUM_BYTES,
      },
      signal,
    )
    const pixels = new Uint8ClampedArray(region.pixels.byteLength)
    pixels.set(region.pixels)
    const bitmap = await createImageBitmap(new ImageData(pixels, region.width, region.height))
    return { bitmap, bytes: region.pixels.byteLength }
  }
  const encoded = await source.encoded(signal)
  const media = await collectEncodedMedia(encoded, IMAGE_MAXIMUM_BYTES, signal)
  const bitmap = await createImageBitmap(
    new Blob([media.bytes as BlobPart], { type: media.mediaType }),
  )
  return { bitmap, bytes: media.bytes.byteLength }
}

function drawChecker(context: CanvasRenderingContext2D, width: number, height: number): void {
  const cell = 8
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const even = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2
      context.fillStyle = even ? '#808080' : '#a0a0a0'
      context.fillRect(x, y, cell, cell)
    }
  }
}

function isolateChannel(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  channel: ImageChannel,
): void {
  if (channel === 'rgb') return
  const frame = context.getImageData(0, 0, width, height)
  const data = frame.data
  const index = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3
  for (let at = 0; at < data.length; at += 4) {
    const value = data[at + index] as number
    data[at] = value
    data[at + 1] = value
    data[at + 2] = value
    data[at + 3] = 255
  }
  context.putImageData(frame, 0, 0)
}

export interface ImageViewerOptions {
  readonly localizer?: UiLocalizer
}

export function createImageViewer(options: ImageViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, IMAGE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.image'))
      const stage = element(root, 'div', { part: 'image' })

      const toolbar = element(stage, 'div', { part: 'image.toolbar', role: 'toolbar' })
      toolbar.setAttribute('aria-label', localizer.text('viewer.imageControls'))
      const readout = element(stage, 'output', { part: 'image.readout' })
      const canvas = element(stage, 'canvas', { part: 'image.canvas' }) as HTMLCanvasElement
      canvas.tabIndex = 0

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/raster-image-source',
      )
      if (lease === undefined) throw new TypeError('image binding is unavailable')
      scope.lease(lease)

      let model: ImageStageModel | undefined
      let zoom = 1
      let fit = true
      let background: ImageBackground = 'checker'
      let channel: ImageChannel = 'rgb'

      const context = canvas.getContext('2d')
      if (context === null) throw new TypeError('2d canvas context is unavailable')

      const paint = (): void => {
        if (model === undefined) return
        const { bitmap } = model
        const box = stage.getBoundingClientRect()
        const available = {
          width: Math.max(64, box.width - 8),
          height: Math.max(64, box.height - 96),
        }
        const scale = fit
          ? Math.min(available.width / bitmap.width, available.height / bitmap.height, 1)
          : zoom
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.width = width
        canvas.height = height
        // C3: the rendered size travels as a validated token, never as a style attribute.
        setToken(canvas, 'size.icon', `${Math.min(width, 4096)}px`)
        context.imageSmoothingEnabled = scale < 1
        if (background === 'checker') drawChecker(context, width, height)
        else {
          context.fillStyle = background === 'dark' ? '#141414' : '#f4f4f4'
          context.fillRect(0, 0, width, height)
        }
        context.drawImage(bitmap, 0, 0, width, height)
        isolateChannel(context, width, height, channel)
        setViewerText(
          readout,
          localizer.text('viewer.imageSummary', {
            width: bitmap.width,
            height: bitmap.height,
            size: (model.bytes / 1024).toFixed(1),
            scale: Math.round(scale * 100),
            channel:
              channel === 'rgb'
                ? ''
                : localizer.text('viewer.imageChannel', { channel: channel.toUpperCase() }),
          }),
        )
      }

      const button = (label: string, title: string, onClick: () => void): void => {
        const node = element(toolbar, 'button', {
          text: label,
          part: 'operations.button',
        }) as HTMLButtonElement
        node.type = 'button'
        node.title = title
        node.addEventListener('click', () => {
          onClick()
          paint()
        })
        scope.cleanup(() => node.replaceWith(node.cloneNode(true)))
      }

      button(localizer.text('viewer.fit'), localizer.text('viewer.fitTitle'), () => {
        fit = true
      })
      button('1:1', localizer.text('viewer.actualPixels'), () => {
        fit = false
        zoom = 1
      })
      button('−', localizer.text('viewer.zoomOut'), () => {
        fit = false
        zoom = Math.max(0.1, zoom / 1.5)
      })
      button('+', localizer.text('viewer.zoomIn'), () => {
        fit = false
        zoom = Math.min(32, zoom * 1.5)
      })
      button('BG', localizer.text('viewer.cycleBackdrop'), () => {
        background = background === 'checker' ? 'dark' : background === 'dark' ? 'light' : 'checker'
      })
      for (const value of ['rgb', 'r', 'g', 'b', 'a'] as const) {
        button(
          value.toUpperCase(),
          localizer.text('viewer.isolateChannel', { channel: value.toUpperCase() }),
          () => {
            channel = value
          },
        )
      }

      setState(stage, ['loading'])
      try {
        model = await loadBitmap(lease.value as RasterImageSource, scope.signal)
        setState(stage, [])
        paint()
      } catch (error) {
        setState(stage, ['error'])
        canvas.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.imageDecodeError', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        })
      }

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
        paint()
      })
    },
  })
}

export const imageViewer: ViewerModule = createImageViewer()
