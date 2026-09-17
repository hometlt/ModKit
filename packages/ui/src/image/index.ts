/**
 * ImageStage — MK2 `modkit.assetsTextureViewer` parity over the raster-image contract.
 *
 * The codec supplies image facts plus an encoded representation. The lightweight stage may use the
 * platform decoder; a separately selected decoder provider can expose decoded regions without
 * changing this viewer or importing another format codec.
 *
 * Wave 2B added the tools the parity matrix listed as missing: pointer pan, mip/layer/face/slice
 * selection over whatever the raster info declares, side-by-side and difference comparison between
 * two subresources, PNG export of the current subresource or of every subresource at once, and the
 * subresource/format metadata inline instead of only in a separate Metadata stage.
 *
 * Rendering goes to a canvas, so no `img-src blob:` allowance is required. Nothing here anticipates
 * the wave-3 scene contract: this stage stays a 2D raster surface driven by data, and the camera /
 * scene work lands in the model stage, not here.
 */
import type {
  AnyDescriptor,
  MetadataGroup,
  RasterImageInfo,
  RasterImageSource,
  ResolvedAssetDescriptor,
  ViewerModule,
} from '@modkit/sdk'
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

/** Refuse a batch export that would produce more files than a person asked for by accident. */
export const IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES = 256

export type ImageBackground = 'checker' | 'dark' | 'light'
export type ImageChannel = 'rgb' | 'r' | 'g' | 'b' | 'a'
export type ImageCompareMode = 'off' | 'side-by-side' | 'diff'

export interface ImageStageModel {
  readonly bitmap: ImageBitmap
  readonly bytes: number
}

/** One addressable surface of the image. Every axis is zero when the info does not declare it. */
export interface ImageSubresource {
  readonly mipLevel: number
  readonly layer: number
  readonly face: number
  readonly slice: number
}

/** One file an export produced. The viewer never writes; a host that can write is handed these. */
export interface ImageExportFile {
  readonly name: string
  readonly mediaType: 'image/png'
  readonly bytes: Uint8Array
}

/** What the host did with them. A refusal is a stated outcome, never a silent no-op. */
export type ImageExportOutcome =
  | { readonly state: 'written'; readonly names: readonly string[] }
  | { readonly state: 'refused'; readonly reason: string }

const ZERO_SUBRESOURCE: ImageSubresource = Object.freeze({
  mipLevel: 0,
  layer: 0,
  face: 0,
  slice: 0,
})

const axisCount = (info: RasterImageInfo | undefined, axis: keyof ImageSubresource): number => {
  if (info === undefined) return 1
  const counts = {
    mipLevel: info.mipLevels,
    layer: info.layers,
    face: info.faces,
    slice: info.depth,
  } as const
  const value = counts[axis]
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

/** Dimensions of one mip level; floors at 1 on every axis, as every GPU format specifies. */
export function subresourceExtent(
  info: RasterImageInfo,
  mipLevel: number,
): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(1, info.width >>> mipLevel),
    height: Math.max(1, info.height >>> mipLevel),
  }
}

/**
 * Reduce any subject name to a leaf a host will accept: alphanumerics, dot, dash, underscore, and
 * a leading alphanumeric. A viewer that proposes a name must not be able to propose a path.
 */
export function exportSafeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/\.{2,}/gu, '.')
  const trimmed = cleaned.replace(/^[^A-Za-z0-9]+/u, '').slice(0, 96)
  return trimmed.length === 0 ? 'image' : trimmed
}

/** Stable, filesystem-safe suffix naming one subresource. Only declared axes appear. */
export function subresourceLabel(
  info: RasterImageInfo | undefined,
  subresource: ImageSubresource,
): string {
  const parts: string[] = [`mip${subresource.mipLevel}`]
  if (axisCount(info, 'layer') > 1) parts.push(`layer${subresource.layer}`)
  if (axisCount(info, 'face') > 1) parts.push(`face${subresource.face}`)
  if (axisCount(info, 'slice') > 1) parts.push(`slice${subresource.slice}`)
  return parts.join('-')
}

/** Every subresource the info declares, in file order. Bounded by the batch-export ceiling. */
export function enumerateSubresources(
  info: RasterImageInfo,
  maximum = IMAGE_MAXIMUM_EXPORTED_SUBRESOURCES,
): readonly ImageSubresource[] {
  const all: ImageSubresource[] = []
  for (let layer = 0; layer < axisCount(info, 'layer'); layer += 1) {
    for (let face = 0; face < axisCount(info, 'face'); face += 1) {
      for (let mipLevel = 0; mipLevel < axisCount(info, 'mipLevel'); mipLevel += 1) {
        const depth = Math.max(1, axisCount(info, 'slice') >>> mipLevel)
        for (let slice = 0; slice < depth; slice += 1) {
          if (all.length >= maximum) return Object.freeze(all)
          all.push(Object.freeze({ mipLevel, layer, face, slice }))
        }
      }
    }
  }
  return Object.freeze(all)
}

async function loadSubresource(
  source: RasterImageSource,
  info: RasterImageInfo,
  subresource: ImageSubresource,
  signal?: AbortSignal,
): Promise<ImageStageModel> {
  const extent = subresourceExtent(info, subresource.mipLevel)
  const decodedBytes = extent.width * extent.height * 4
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
        width: extent.width,
        height: extent.height,
        frame: 0,
        mipLevel: subresource.mipLevel,
        layer: subresource.layer,
        face: subresource.face,
        slice: subresource.slice,
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
  /*
   * The encoded fallback is the whole file, so it can only ever be the base image. Asking it for
   * a subresource would silently hand back mip 0 under another name.
   */
  if (
    subresource.mipLevel !== 0 ||
    subresource.layer !== 0 ||
    subresource.face !== 0 ||
    subresource.slice !== 0
  ) {
    throw new TypeError('this image exposes no decoded subresources; only the base image is shown')
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

/** Per-channel absolute difference, so "identical" reads as black and any drift is visible. */
export function differenceOf(left: ImageData, right: ImageData): ImageData {
  const width = Math.min(left.width, right.width)
  const height = Math.min(left.height, right.height)
  const output = new ImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4
      const a = (y * left.width + x) * 4
      const b = (y * right.width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[from + channel] = Math.abs(
          (left.data[a + channel] as number) - (right.data[b + channel] as number),
        )
      }
      output.data[from + 3] = 255
    }
  }
  return output
}

/** `AnyDescriptor` also covers the unresolved arm, which carries no metadata. */
function metadataGroups(descriptor: AnyDescriptor): readonly MetadataGroup[] {
  return 'identity' in descriptor ? ((descriptor as ResolvedAssetDescriptor).metadata ?? []) : []
}

async function encodePng(bitmap: ImageBitmap): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (blob === null) throw new TypeError('the platform encoder produced no PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

export interface ImageViewerOptions {
  readonly localizer?: UiLocalizer
  /**
   * How this host writes exported files, when it can. A host that omits it gets export controls
   * that say why they are disabled rather than buttons that quietly do nothing.
   */
  readonly exportBytes?: (
    files: readonly ImageExportFile[],
    signal?: AbortSignal,
  ) => Promise<ImageExportOutcome>
  /** Base name the exported files are derived from; the host usually supplies the subject name. */
  readonly exportBaseName?: (descriptor: AnyDescriptor) => string
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
      const subresourceBar = element(stage, 'div', {
        part: 'image.subresources',
        role: 'toolbar',
      })
      subresourceBar.setAttribute('aria-label', localizer.text('viewer.imageSubresources'))
      const readout = element(stage, 'output', { part: 'image.readout' })
      const canvas = element(stage, 'canvas', { part: 'image.canvas' }) as HTMLCanvasElement
      canvas.tabIndex = 0
      const facts = element(stage, 'dl', { part: 'image.metadata' })

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/raster-image-source',
      )
      if (lease === undefined) throw new TypeError('image binding is unavailable')
      scope.lease(lease)
      const source = lease.value as RasterImageSource

      let info: RasterImageInfo | undefined
      let model: ImageStageModel | undefined
      let comparison: ImageStageModel | undefined
      let subresource: ImageSubresource = ZERO_SUBRESOURCE
      let compareWith: ImageSubresource = ZERO_SUBRESOURCE
      let compare: ImageCompareMode = 'off'
      let zoom = 1
      let fit = true
      let panX = 0
      let panY = 0
      let background: ImageBackground = 'checker'
      let channel: ImageChannel = 'rgb'
      let note = ''
      const decoded = new Map<string, ImageStageModel>()

      const context = canvas.getContext('2d')
      if (context === null) throw new TypeError('2d canvas context is unavailable')

      const key = (value: ImageSubresource): string =>
        `${value.mipLevel}/${value.layer}/${value.face}/${value.slice}`

      const modelFor = async (value: ImageSubresource): Promise<ImageStageModel> => {
        const cached = decoded.get(key(value))
        if (cached !== undefined) return cached
        if (info === undefined) throw new TypeError('image info is unavailable')
        const loaded = await loadSubresource(source, info, value, scope.signal)
        decoded.set(key(value), loaded)
        return loaded
      }

      const drawInto = (
        target: CanvasRenderingContext2D,
        bitmap: ImageBitmap,
        x: number,
        y: number,
        width: number,
        height: number,
      ): void => {
        target.imageSmoothingEnabled = width < bitmap.width
        target.drawImage(bitmap, x, y, width, height)
      }

      const bitmapData = (bitmap: ImageBitmap): ImageData => {
        const scratch = document.createElement('canvas')
        scratch.width = bitmap.width
        scratch.height = bitmap.height
        const scratchContext = scratch.getContext('2d')
        if (scratchContext === null) throw new TypeError('2d canvas context is unavailable')
        scratchContext.drawImage(bitmap, 0, 0)
        return scratchContext.getImageData(0, 0, bitmap.width, bitmap.height)
      }

      const paint = (): void => {
        if (model === undefined) return
        const { bitmap } = model
        const box = stage.getBoundingClientRect()
        const available = {
          width: Math.max(64, box.width - 8),
          height: Math.max(64, box.height - 160),
        }
        const wide = compare === 'side-by-side' && comparison !== undefined
        const contentWidth = wide ? bitmap.width * 2 + 8 : bitmap.width
        const scale = fit
          ? Math.min(available.width / contentWidth, available.height / bitmap.height, 1)
          : zoom
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const gap = wide ? 8 : 0
        canvas.width = wide ? width * 2 + gap : width
        canvas.height = height
        // C3: the rendered size travels as a validated token, never as a style attribute.
        setToken(canvas, 'size.icon', `${Math.min(canvas.width, 4096)}px`)
        if (background === 'checker') drawChecker(context, canvas.width, canvas.height)
        else {
          context.fillStyle = background === 'dark' ? '#141414' : '#f4f4f4'
          context.fillRect(0, 0, canvas.width, canvas.height)
        }
        if (compare === 'diff' && comparison !== undefined) {
          context.putImageData(
            differenceOf(bitmapData(bitmap), bitmapData(comparison.bitmap)),
            0,
            0,
          )
        } else {
          drawInto(context, bitmap, panX, panY, width, height)
          if (wide && comparison !== undefined) {
            drawInto(context, comparison.bitmap, width + gap + panX, panY, width, height)
          }
        }
        isolateChannel(context, canvas.width, canvas.height, channel)
        setViewerText(
          readout,
          `${localizer.text('viewer.imageSummary', {
            width: bitmap.width,
            height: bitmap.height,
            size: (model.bytes / 1024).toFixed(1),
            scale: Math.round(scale * 100),
            channel:
              channel === 'rgb'
                ? ''
                : localizer.text('viewer.imageChannel', { channel: channel.toUpperCase() }),
          })} · ${localizer.text('viewer.imageSubresource', {
            subresource: subresourceLabel(info, subresource),
          })}${
            compare === 'off'
              ? ''
              : ` · ${localizer.text('viewer.imageCompareWith', {
                  subresource: subresourceLabel(info, compareWith),
                  mode: compare,
                })}`
          }${note === '' ? '' : ` · ${note}`}`,
        )
      }

      const reload = (): void => {
        void (async () => {
          try {
            model = await modelFor(subresource)
            comparison = compare === 'off' ? undefined : await modelFor(compareWith)
            note = ''
          } catch (error) {
            note = error instanceof Error ? error.message : String(error)
          }
          paint()
        })()
      }

      const button = (
        parent: HTMLElement,
        label: string,
        title: string,
        onClick: () => void,
      ): HTMLButtonElement => {
        const node = element(parent, 'button', {
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
        return node
      }

      button(toolbar, localizer.text('viewer.fit'), localizer.text('viewer.fitTitle'), () => {
        fit = true
        panX = 0
        panY = 0
      })
      button(toolbar, '1:1', localizer.text('viewer.actualPixels'), () => {
        fit = false
        zoom = 1
        panX = 0
        panY = 0
      })
      button(toolbar, '−', localizer.text('viewer.zoomOut'), () => {
        fit = false
        zoom = Math.max(0.1, zoom / 1.5)
      })
      button(toolbar, '+', localizer.text('viewer.zoomIn'), () => {
        fit = false
        zoom = Math.min(32, zoom * 1.5)
      })
      button(toolbar, 'BG', localizer.text('viewer.cycleBackdrop'), () => {
        background = background === 'checker' ? 'dark' : background === 'dark' ? 'light' : 'checker'
      })
      for (const value of ['rgb', 'r', 'g', 'b', 'a'] as const) {
        button(
          toolbar,
          value.toUpperCase(),
          localizer.text('viewer.isolateChannel', { channel: value.toUpperCase() }),
          () => {
            channel = value
          },
        )
      }

      /*
       * Pointer pan. The MK2 texture viewer panned with a drag and this one could only zoom, which
       * made 1:1 on a 2048px atlas a view of its top-left corner and nothing else.
       */
      let dragging: number | undefined
      let originX = 0
      let originY = 0
      const onPointerDown = (event: PointerEvent): void => {
        dragging = event.pointerId
        originX = event.clientX - panX
        originY = event.clientY - panY
        canvas.setPointerCapture(event.pointerId)
      }
      const onPointerMove = (event: PointerEvent): void => {
        if (dragging !== event.pointerId) return
        panX = event.clientX - originX
        panY = event.clientY - originY
        paint()
      }
      const onPointerUp = (event: PointerEvent): void => {
        if (dragging !== event.pointerId) return
        dragging = undefined
        canvas.releasePointerCapture(event.pointerId)
      }
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointercancel', onPointerUp)
      scope.cleanup(() => {
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerUp)
      })

      const renderSubresourceControls = (): void => {
        subresourceBar.replaceChildren()
        if (info === undefined) return
        const axes: readonly (readonly [keyof ImageSubresource, string])[] = [
          ['mipLevel', 'mip'],
          ['layer', 'layer'],
          ['face', 'face'],
          ['slice', 'slice'],
        ]
        for (const [axis, name] of axes) {
          const count = axisCount(info, axis)
          if (count <= 1) continue
          const step = (delta: number): void => {
            const next = Math.min(count - 1, Math.max(0, subresource[axis] + delta))
            subresource = Object.freeze({ ...subresource, [axis]: next })
            reload()
          }
          button(
            subresourceBar,
            `${name}−`,
            localizer.text('viewer.imagePreviousSubresource', { axis: name }),
            () => step(-1),
          )
          button(
            subresourceBar,
            `${name}+`,
            localizer.text('viewer.imageNextSubresource', { axis: name }),
            () => step(1),
          )
        }
        if (enumerateSubresources(info).length > 1) {
          button(
            subresourceBar,
            localizer.text('viewer.imageCompare'),
            localizer.text('viewer.imageCompareTitle'),
            () => {
              compare =
                compare === 'off' ? 'side-by-side' : compare === 'side-by-side' ? 'diff' : 'off'
              if (compare !== 'off' && key(compareWith) === key(subresource)) {
                compareWith = Object.freeze({
                  ...subresource,
                  mipLevel: Math.min(axisCount(info, 'mipLevel') - 1, subresource.mipLevel + 1),
                })
              }
              reload()
            },
          )
        }
        const canExport = options.exportBytes !== undefined
        const baseName = exportSafeName(
          options.exportBaseName === undefined ? 'image' : options.exportBaseName(args.descriptor),
        )
        const runExport = (all: boolean): void => {
          const write = options.exportBytes
          if (write === undefined || info === undefined) return
          note = localizer.text('viewer.imageExporting')
          paint()
          void (async () => {
            try {
              const wanted = all ? enumerateSubresources(info) : [subresource]
              const files: ImageExportFile[] = []
              for (const value of wanted) {
                const loaded = await modelFor(value)
                files.push({
                  name: `${baseName}.${subresourceLabel(info, value)}.png`,
                  mediaType: 'image/png',
                  bytes: await encodePng(loaded.bitmap),
                })
              }
              const outcome = await write(files, scope.signal)
              note =
                outcome.state === 'written'
                  ? localizer.text('viewer.imageExported', { count: outcome.names.length })
                  : localizer.text('viewer.imageExportRefused', { reason: outcome.reason })
            } catch (error) {
              note = localizer.text('viewer.imageExportRefused', {
                reason: error instanceof Error ? error.message : String(error),
              })
            }
            paint()
          })()
        }
        const single = button(
          subresourceBar,
          localizer.text('viewer.imageExport'),
          localizer.text('viewer.imageExportTitle'),
          () => runExport(false),
        )
        const batch = button(
          subresourceBar,
          localizer.text('viewer.imageExportAll'),
          localizer.text('viewer.imageExportAllTitle'),
          () => runExport(true),
        )
        for (const node of [single, batch]) {
          node.disabled = !canExport
          if (!canExport) node.title = localizer.text('viewer.imageExportUnavailable')
        }
      }

      /*
       * Format, compression and subresource facts inline. They were reachable only by leaving for
       * the Metadata stage, which is exactly the split the parity matrix called out.
       */
      const renderFacts = (descriptor: AnyDescriptor): void => {
        facts.replaceChildren()
        if (info !== undefined) {
          for (const [label, value] of [
            ['size', `${info.width} × ${info.height}`],
            ['mipLevels', String(axisCount(info, 'mipLevel'))],
            ['layers', String(axisCount(info, 'layer'))],
            ['faces', String(axisCount(info, 'face'))],
            ['depth', String(axisCount(info, 'slice'))],
            ['channels', `${info.channels} × ${info.bitDepth}-bit`],
            ['alphaMode', String(info.alphaMode)],
            ['colorSpace', String(info.colorSpace)],
          ] as const) {
            const row = element(facts, 'div', { part: 'metadata.row' })
            element(row, 'dt', { text: label, part: 'metadata.label' })
            const cell = element(row, 'dd', { part: 'metadata.value' })
            setViewerText(cell, value, 512)
          }
        }
        for (const group of metadataGroups(descriptor)) {
          for (const entry of group.entries) {
            const row = element(facts, 'div', { part: 'metadata.row' })
            element(row, 'dt', { text: `${group.label} · ${entry.key}`, part: 'metadata.label' })
            const cell = element(row, 'dd', { part: 'metadata.value' })
            setViewerText(cell, entry.value, 512)
          }
        }
      }

      setState(stage, ['loading'])
      try {
        info = await source.info(scope.signal)
        model = await modelFor(subresource)
        renderSubresourceControls()
        renderFacts(args.descriptor)
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
        renderFacts(descriptor)
        paint()
      })
    },
  })
}

export const imageViewer: ViewerModule = createImageViewer()
