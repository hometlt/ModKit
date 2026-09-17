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
  JsonValue,
  OperationSession,
  ViewerStatusChoice,
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
import { createMediaShell } from '../media-shell/index.js'
import {
  createImageEditing,
  type EditRect,
  type ImageEditing,
  type ImageEditSurface,
} from '../image-editing/index.js'
import { collectEncodedMedia } from '../media/encoded.js'
import { exportOffer } from '../field-editor/index.js'
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
  /** `image/png` for a view export; a codec conversion names its own target type. */
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** Media type and extension of an `export.convert` target the viewer knows how to name. */
const CONVERT_TARGETS: Readonly<Record<string, { readonly ext: string; readonly type: string }>> =
  Object.freeze({
    png: { ext: 'png', type: 'image/png' },
    dds: { ext: 'dds', type: 'image/vnd-ms.dds' },
    rgba8: { ext: 'rgba', type: 'application/octet-stream' },
  })

/**
 * File name for one conversion preset: `<base>.<ext>` when the preset is named after its target,
 * `<base>.<preset>.<ext>` otherwise — `tex.png`, `tex.dxt1.dds`, `tex.button.dds`, as MK2 wrote.
 */
export function convertedFileName(baseName: string, presetId: string, ext: string): string {
  return presetId === ext ? `${baseName}.${ext}` : `${baseName}.${exportSafeName(presetId)}.${ext}`
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
  /**
   * How this host writes edited pixels back through the codec (`edit.content`). Absent means the
   * Edit section says the format has no encoder instead of offering tools that cannot save.
   */
  readonly savePixels?: (
    request: ImageSaveRequest,
    signal?: AbortSignal,
  ) => Promise<ImageSaveOutcome>
  /** Why saving is unavailable, when `savePixels` is absent. */
  readonly editableReason?: string
  /** Unsaved pixels; the host marks its document dirty, so its own Save applies to them. */
  onEditingChange?(dirty: boolean): void
  /** One committed edit, for a host whose editor owns the undo stack. */
  onEdit?(): void
  /**
   * Hands the host this view's history and save, so the editor's own Undo, Redo and Save drive
   * them and the sidebar draws no buttons of its own. Called again with `undefined` on unmount.
   */
  registerEditing?(handlers: ImageEditingHandlers | undefined): void
  /** False removes the Edit section entirely (a read-only surface, e.g. a card preview). */
  readonly editing?: boolean
  /**
   * Extra sidebar sections, in order, after Edit. This is how an extension adds its own panel — a
   * game extension's texture checks, for instance — without this viewer knowing that game exists.
   */
  readonly sections?: readonly ImageSidebarSection[]
}

/**
 * What a host needs to write painted pixels back: the subject it is writing, the operation session
 * to reach its codec through, and the pixels. The viewer never constructs an edit plan itself.
 */
export interface ImageSaveRequest {
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly image: { readonly width: number; readonly height: number; readonly rgba: Uint8Array }
}

export interface ImageEditingHandlers {
  undo(): boolean
  redo(): boolean
  save(): Promise<void>
  readonly dirty: boolean
}

export type ImageSaveOutcome =
  | { readonly state: 'saved'; readonly message: string }
  | { readonly state: 'refused'; readonly reason: string }

/**
 * A contributed sidebar section is just a viewer module, mounted into the section's body with the
 * same arguments this stage received. That is the whole extension point: a game extension ships a
 * module and a title, and this viewer never learns the game exists.
 */
export interface ImageSidebarSection {
  readonly id: string
  readonly title: string
  /** Codicon name for the section header. */
  readonly icon?: string
  readonly collapsed?: boolean
  readonly module: ViewerModule
}

const ZOOM_CHOICES = [0.25, 0.5, 1, 2, 4, 8] as const
const CHANNELS: readonly ImageChannel[] = ['rgb', 'r', 'g', 'b', 'a']

export function createImageViewer(options: ImageViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, IMAGE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.image'))
      /*
       * MK2's layout: gallery | render area | sidebar. The render area holds only the image, full
       * size and with no margins; every fact and control is a sidebar section, and size, format,
       * channels and zoom live in the host status bar (MK2's `StatusBarGroup`).
       */
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'image' })
      const canvas = element(stage, 'canvas', { part: 'image.canvas' }) as HTMLCanvasElement
      canvas.tabIndex = 0
      canvas.setAttribute('aria-label', localizer.text('viewer.image'))
      // Without a host status bar the same controls sit over the render area.
      const overlay =
        args.status === undefined
          ? element(stage, 'div', { part: 'image.toolbar', role: 'toolbar' })
          : undefined
      overlay?.setAttribute('aria-label', localizer.text('viewer.imageControls'))
      const readout = element(stage, 'output', { part: 'image.readout' })

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
      // Fixed, as in MK2: the checkerboard is what "transparent" looks like, not a preference.
      const background: ImageBackground = 'checker'
      let channel: ImageChannel = 'rgb'
      let note = ''
      let descriptor = args.descriptor
      const decoded = new Map<string, ImageStageModel>()
      /*
       * Edited pixels, once the tools have touched them: an `ImageData` the editing module mutates
       * in place, drawn from its own canvas instead of the decoded bitmap.
       */
      let working: ImageData | undefined
      let workingCanvas: HTMLCanvasElement | undefined
      let editing: ImageEditing | undefined
      /** Where the image was last drawn, in CSS pixels of the render area. */
      let placed = { x: 0, y: 0, width: 1, height: 1, scale: 1 }

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

      const bitmapData = (bitmap: ImageBitmap): ImageData => {
        const scratch = root.ownerDocument.createElement('canvas')
        scratch.width = bitmap.width
        scratch.height = bitmap.height
        const scratchContext = scratch.getContext('2d')
        if (scratchContext === null) throw new TypeError('2d canvas context is unavailable')
        scratchContext.drawImage(bitmap, 0, 0)
        return scratchContext.getImageData(0, 0, bitmap.width, bitmap.height)
      }

      /** The pixels the tools work on, decoded from the shown subresource on first use. */
      const ensureWorking = (): ImageData | undefined => {
        if (working !== undefined) return working
        if (model === undefined) return undefined
        working = bitmapData(model.bitmap)
        workingCanvas = root.ownerDocument.createElement('canvas')
        workingCanvas.width = working.width
        workingCanvas.height = working.height
        workingCanvas.getContext('2d')?.putImageData(working, 0, 0)
        return working
      }

      const shown = (): { width: number; height: number; image: CanvasImageSource } | undefined => {
        if (working !== undefined && workingCanvas !== undefined) {
          return { width: working.width, height: working.height, image: workingCanvas }
        }
        if (model === undefined) return undefined
        return { width: model.bitmap.width, height: model.bitmap.height, image: model.bitmap }
      }

      /** The scale "Fit" means: the whole image inside the render area, never enlarged. */
      const fitScale = (): number => {
        const current = shown()
        if (current === undefined) return 1
        const box = stage.getBoundingClientRect()
        const wide = compare === 'side-by-side' && comparison !== undefined
        const contentWidth = wide ? current.width * 2 + 8 : current.width
        return Math.min(
          Math.max(16, box.width) / contentWidth,
          Math.max(16, box.height) / current.height,
          1,
        )
      }
      const currentScale = (): number => (fit ? fitScale() : zoom)

      const formatLabel = (): string => {
        const encoding = metadataGroups(descriptor)
          .flatMap(group => group.entries)
          .find(entry => /^(encoding|format|pixelformat|compression)$/iu.test(entry.key))
        const base =
          'identity' in descriptor
            ? (descriptor as ResolvedAssetDescriptor).identity.formatLabel
            : localizer.text('viewer.image')
        return encoding === undefined ? base : `${base} · ${String(encoding.value)}`
      }

      /**
       * The format menu: a target format, and its encodings as that format's own second step —
       * "DDS" then "DXT5 / DXT1 / RGBA8", rather than one flat list of every pairing.
       */
      const formatChoices = (): readonly ViewerStatusChoice[] => {
        if (options.exportBytes === undefined) return []
        const groups = new Map<string, { readonly id: string; readonly label: string }[]>()
        for (const preset of conversions()) {
          // Labels are authored as "DDS · DXT5 (BC3)": the part before the separator is the format.
          const [head, ...rest] = preset.form.label.split(' · ')
          const format = (head ?? preset.form.label).trim()
          const encoding = rest.join(' · ').trim()
          groups.set(format, [
            ...(groups.get(format) ?? []),
            { id: `convert:${preset.form.id}`, label: encoding === '' ? format : encoding },
          ])
        }
        return [
          { id: 'export-png', label: localizer.text('viewer.imageExport') },
          ...(info !== undefined && enumerateSubresources(info).length > 1
            ? [{ id: 'export-all', label: localizer.text('viewer.imageExportAll') }]
            : []),
          ...[...groups].map(([format, encodings]) =>
            encodings.length === 1 && encodings[0] !== undefined
              ? { id: encodings[0].id, label: format }
              : { id: `format:${format}`, label: format, choices: encodings },
          ),
        ]
      }

      const publishStatus = (): void => {
        const current = shown()
        if (current === undefined) return
        const scale = currentScale()
        const bytes = model?.bytes ?? 0
        const items = [
          {
            id: 'size',
            icon: 'symbol-ruler',
            text: `${current.width} × ${current.height}`,
            tooltip: localizer.text('viewer.imageResizeTitle'),
            align: 'start' as const,
            action: editing !== undefined,
          },
          {
            id: 'format',
            icon: 'file',
            text: formatLabel(),
            tooltip: localizer.text('viewer.imageConvert'),
            align: 'start' as const,
            choices: formatChoices(),
          },
          { id: 'bytes', text: `${(bytes / 1024).toFixed(1)} KiB`, align: 'start' as const },
          {
            id: 'channel',
            icon: 'symbol-color',
            text: channel.toUpperCase(),
            tooltip: localizer.text('viewer.imageChannels'),
            align: 'end' as const,
            selected: channel,
            choices: CHANNELS.map(value => ({ id: value, label: value.toUpperCase() })),
          },
          {
            id: 'zoom',
            icon: 'zoom-in',
            text: fit
              ? `${localizer.text('viewer.fit')} (${Math.round(scale * 100)}%)`
              : `${Math.round(scale * 100)}%`,
            tooltip: localizer.text('viewer.fitTitle'),
            align: 'end' as const,
            selected: fit ? 'fit' : String(zoom),
            choices: [
              { id: 'fit', label: localizer.text('viewer.fit') },
              ...ZOOM_CHOICES.map(value => ({ id: String(value), label: `${value * 100}%` })),
            ],
          },
        ].filter(item => item.text !== '')
        args.status?.set(items, (itemId, choiceId) => {
          if (itemId === 'channel' && CHANNELS.includes(choiceId as ImageChannel)) {
            channel = choiceId as ImageChannel
          } else if (itemId === 'size') {
            editing?.openResize()
            return
          } else if (itemId === 'format') {
            if (choiceId === 'export-png') runExport(false)
            else if (choiceId === 'export-all') runExport(true)
            else if (choiceId.startsWith('convert:'))
              runConversion(choiceId.slice('convert:'.length))
            return
          } else if (itemId === 'zoom') {
            if (choiceId === 'fit') {
              fit = true
              panX = 0
              panY = 0
            } else {
              const value = Number(choiceId)
              if (Number.isFinite(value) && value > 0) {
                fit = false
                zoom = value
              }
            }
          }
          paint()
        })
      }

      const paint = (preview?: ImageData, previewRect?: EditRect): void => {
        const current = shown()
        if (current === undefined) return
        if (preview !== undefined && workingCanvas !== undefined && previewRect !== undefined) {
          workingCanvas
            .getContext('2d')
            ?.putImageData(
              preview,
              0,
              0,
              previewRect.x,
              previewRect.y,
              previewRect.w,
              previewRect.h,
            )
        }
        const box = stage.getBoundingClientRect()
        const ratio = globalThis.devicePixelRatio || 1
        const cssWidth = Math.max(1, Math.round(box.width))
        const cssHeight = Math.max(1, Math.round(box.height))
        canvas.width = Math.round(cssWidth * ratio)
        canvas.height = Math.round(cssHeight * ratio)
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, cssWidth, cssHeight)
        const scale = currentScale()
        const width = Math.max(1, Math.round(current.width * scale))
        const height = Math.max(1, Math.round(current.height * scale))
        const wide = compare === 'side-by-side' && comparison !== undefined
        const gap = wide ? 8 : 0
        const total = wide ? width * 2 + gap : width
        const x = Math.round((cssWidth - total) / 2 + panX)
        const y = Math.round((cssHeight - height) / 2 + panY)
        placed = { x, y, width, height, scale }
        // The backdrop covers only the image, as in MK2: the render area keeps the editor colour.
        const backdrop = (left: number): void => {
          context.save()
          context.beginPath()
          context.rect(left, y, width, height)
          context.clip()
          if (background === 'checker') {
            context.translate(left, y)
            drawChecker(context, width, height)
          } else {
            context.fillStyle = background === 'dark' ? '#141414' : '#f4f4f4'
            context.fillRect(left, y, width, height)
          }
          context.restore()
        }
        const draw = (image: CanvasImageSource, left: number): void => {
          backdrop(left)
          context.imageSmoothingEnabled = scale < 1
          context.drawImage(image, left, y, width, height)
        }
        if (compare === 'diff' && comparison !== undefined && model !== undefined) {
          const scratch = root.ownerDocument.createElement('canvas')
          scratch.width = model.bitmap.width
          scratch.height = model.bitmap.height
          scratch
            .getContext('2d')
            ?.putImageData(
              differenceOf(bitmapData(model.bitmap), bitmapData(comparison.bitmap)),
              0,
              0,
            )
          draw(scratch, x)
        } else {
          draw(current.image, x)
          if (wide && comparison !== undefined) draw(comparison.bitmap, x + width + gap)
        }
        if (channel !== 'rgb') {
          const left = Math.max(0, x)
          const top = Math.max(0, y)
          const right = Math.min(cssWidth, x + total)
          const bottom = Math.min(cssHeight, y + height)
          if (right > left && bottom > top) {
            context.save()
            context.setTransform(1, 0, 0, 1, 0, 0)
            const sx = Math.round(left * ratio)
            const sy = Math.round(top * ratio)
            const frame = context.getImageData(
              sx,
              sy,
              Math.max(1, Math.round((right - left) * ratio)),
              Math.max(1, Math.round((bottom - top) * ratio)),
            )
            const scratch = root.ownerDocument.createElement('canvas')
            scratch.width = frame.width
            scratch.height = frame.height
            const scratchContext = scratch.getContext('2d')
            if (scratchContext !== null) {
              scratchContext.putImageData(frame, 0, 0)
              isolateChannel(scratchContext, frame.width, frame.height, channel)
              context.drawImage(scratch, sx, sy)
            }
            context.restore()
          }
        }
        setViewerText(
          readout,
          `${
            compare === 'off'
              ? ''
              : localizer.text('viewer.imageCompareWith', {
                  subresource: subresourceLabel(info, compareWith),
                  mode: compare,
                })
          }${note === '' ? '' : `${compare === 'off' ? '' : ' · '}${note}`}`,
        )
        readout.hidden = compare === 'off' && note === ''
        renderOverlay()
        publishStatus()
        editing?.refresh()
      }

      const resize = new ResizeObserver(() => paint())
      resize.observe(stage)
      scope.cleanup(() => resize.disconnect())

      const reload = (): void => {
        void (async () => {
          try {
            working = undefined
            workingCanvas = undefined
            model = await modelFor(subresource)
            comparison = compare === 'off' ? undefined : await modelFor(compareWith)
            note = ''
          } catch (error) {
            note = error instanceof Error ? error.message : String(error)
          }
          renderSections()
          paint()
        })()
      }

      const button = (
        parent: HTMLElement,
        label: string,
        title: string,
        onClick: () => void,
        pressed?: boolean,
      ): HTMLButtonElement => {
        const node = element(parent, 'button', {
          text: label,
          part: 'operations.button',
        }) as HTMLButtonElement
        node.type = 'button'
        node.title = title
        if (pressed !== undefined) node.setAttribute('aria-pressed', String(pressed))
        node.addEventListener('click', () => {
          onClick()
          paint()
        })
        return node
      }

      const renderOverlay = (): void => {
        if (overlay === undefined) return
        overlay.replaceChildren()
        button(
          overlay,
          localizer.text('viewer.fit'),
          localizer.text('viewer.fitTitle'),
          () => {
            fit = true
            panX = 0
            panY = 0
          },
          fit,
        )
        button(
          overlay,
          '1:1',
          localizer.text('viewer.actualPixels'),
          () => {
            fit = false
            zoom = 1
          },
          !fit && zoom === 1,
        )
        button(overlay, '−', localizer.text('viewer.zoomOut'), () => {
          zoom = Math.max(0.1, currentScale() / 1.5)
          fit = false
        })
        button(overlay, '+', localizer.text('viewer.zoomIn'), () => {
          zoom = Math.min(32, currentScale() * 1.5)
          fit = false
        })
        for (const value of CHANNELS) {
          button(
            overlay,
            value.toUpperCase(),
            localizer.text('viewer.isolateChannel', { channel: value.toUpperCase() }),
            () => {
              channel = value
            },
            channel === value,
          )
        }
        element(overlay, 'span', {
          part: 'image.readout',
          text: `${Math.round(currentScale() * 100)}%`,
        })
      }

      // Wheel zoom about the pointer and drag pan, as in MK2 — and the part of MK3 to keep.
      const onWheel = (event: WheelEvent): void => {
        if (shown() === undefined) return
        event.preventDefault()
        const before = currentScale()
        const next = Math.min(32, Math.max(0.05, before * (event.deltaY < 0 ? 1.25 : 0.8)))
        const box = stage.getBoundingClientRect()
        const cx = event.clientX - box.left - box.width / 2 - panX
        const cy = event.clientY - box.top - box.height / 2 - panY
        panX -= cx * (next / before - 1)
        panY -= cy * (next / before - 1)
        fit = false
        zoom = next
        paint()
      }
      let dragging: number | undefined
      let originX = 0
      let originY = 0
      const onPointerDown = (event: PointerEvent): void => {
        // While the Edit section is open the tools take the left button; panning stays otherwise.
        if (editing?.pointerDown(event) === true) return
        dragging = event.pointerId
        originX = event.clientX - panX
        originY = event.clientY - panY
        canvas.setPointerCapture(event.pointerId)
      }
      const onPointerMove = (event: PointerEvent): void => {
        if (editing?.pointerMove(event) === true) return
        if (dragging !== event.pointerId) return
        panX = event.clientX - originX
        panY = event.clientY - originY
        paint()
      }
      const onPointerUp = (event: PointerEvent): void => {
        if (editing?.pointerUp(event) === true) return
        if (dragging !== event.pointerId) return
        dragging = undefined
        canvas.releasePointerCapture(event.pointerId)
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (editing?.keyDown(event) !== true) return
        event.preventDefault()
        event.stopPropagation()
      }
      canvas.addEventListener('wheel', onWheel, { passive: false })
      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointercancel', onPointerUp)
      root.addEventListener('keydown', onKeyDown)
      canvas.addEventListener('dblclick', () => {
        if (editing?.active === true) return
        fit = true
        panX = 0
        panY = 0
        paint()
      })
      scope.cleanup(() => {
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerUp)
        root.removeEventListener('keydown', onKeyDown)
      })

      const facts = (parent: HTMLElement, rows: readonly (readonly [string, string])[]): void => {
        const list = element(parent, 'dl', { part: 'image.metadata' })
        for (const [label, value] of rows) {
          const row = element(list, 'div', { part: 'metadata.row' })
          element(row, 'dt', { text: label, part: 'metadata.label' })
          const cell = element(row, 'dd', { part: 'metadata.value' })
          setViewerText(cell, value, 512)
        }
      }

      const runExport = (all: boolean): void => {
        const write = options.exportBytes
        if (write === undefined || info === undefined) return
        const imageInfo = info
        const baseName = exportSafeName(
          options.exportBaseName === undefined ? 'image' : options.exportBaseName(descriptor),
        )
        note = localizer.text('viewer.imageExporting')
        paint()
        void (async () => {
          try {
            const wanted = all ? enumerateSubresources(imageInfo) : [subresource]
            const files: ImageExportFile[] = []
            for (const value of wanted) {
              const loaded = await modelFor(value)
              files.push({
                name: `${baseName}.${subresourceLabel(imageInfo, value)}.png`,
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

      /** The codec's own `export.convert` presets, as data the status menu and a button can use. */
      const conversions = (): readonly {
        readonly form: { readonly id: string; readonly label: string; readonly handlerId: string }
        readonly input: JsonValue
        readonly target: { readonly ext: string; readonly type: string }
      }[] =>
        exportOffer(descriptor).flatMap(form => {
          let input
          try {
            input = form.build(new Map())
          } catch {
            return []
          }
          const target =
            typeof input === 'object' && input !== null && !Array.isArray(input)
              ? CONVERT_TARGETS[String((input as Readonly<Record<string, unknown>>)['target'])]
              : undefined
          return target === undefined ? [] : [{ form, input, target }]
        })

      const runConversion = (formId: string): void => {
        const preset = conversions().find(item => item.form.id === formId)
        const write = options.exportBytes
        if (preset === undefined || write === undefined) return
        const baseName = exportSafeName(
          options.exportBaseName === undefined ? 'image' : options.exportBaseName(descriptor),
        )
        note = localizer.text('viewer.imageConverting', { preset: preset.form.label })
        paint()
        void (async () => {
          try {
            const result = await args.operations.invoke(preset.form.handlerId, preset.input, {
              signal: scope.signal,
            })
            if (result.state !== 'ok') throw new Error(result.reason)
            const output = result.output as { kind: string; value?: unknown }
            if (output.kind !== 'bytes' || !(output.value instanceof Uint8Array)) {
              throw new Error(`the codec answered ${output.kind}, not bytes`)
            }
            const outcome = await write(
              [
                {
                  name: convertedFileName(baseName, preset.form.id, preset.target.ext),
                  mediaType: preset.target.type,
                  bytes: output.value,
                },
              ],
              scope.signal,
            )
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

      // ---------------------------------------------------------------- editing
      const editSurface: ImageEditSurface = {
        pixels: () => ensureWorking(),
        replace(next) {
          working = next
          workingCanvas = root.ownerDocument.createElement('canvas')
          workingCanvas.width = next.width
          workingCanvas.height = next.height
          workingCanvas.getContext('2d')?.putImageData(next, 0, 0)
          paint()
        },
        show(preview, rect) {
          if (preview === undefined) {
            const current = working
            if (current !== undefined) workingCanvas?.getContext('2d')?.putImageData(current, 0, 0)
            paint()
            return
          }
          paint(preview, rect)
        },
        toImage(event) {
          const current = shown()
          const box = stage.getBoundingClientRect()
          const scale = placed.scale
          const x = (event.clientX - box.left - placed.x) / scale
          const y = (event.clientY - box.top - placed.y) / scale
          return {
            x: Math.max(0, Math.min(current?.width ?? 0, x)),
            y: Math.max(0, Math.min(current?.height ?? 0, y)),
          }
        },
        toScreen(rect) {
          return {
            left: placed.x + rect.x * placed.scale,
            top: placed.y + rect.y * placed.scale,
            width: rect.w * placed.scale,
            height: rect.h * placed.scale,
          }
        },
        channel: () => channel,
      }

      const saveEdits = async (pixels: ImageData): Promise<void> => {
        const save = options.savePixels
        if (save === undefined) return
        note = localizer.text('viewer.imageSaving')
        paint()
        const outcome = await save(
          {
            descriptor,
            operations: args.operations,
            image: {
              width: pixels.width,
              height: pixels.height,
              rgba: new Uint8Array(pixels.data),
            },
          },
          scope.signal,
        )
        note =
          outcome.state === 'saved'
            ? outcome.message
            : localizer.text('viewer.imageSaveRefused', { reason: outcome.reason })
        paint()
        if (outcome.state !== 'saved') throw new Error(outcome.reason)
      }

      const renderSections = (): void => {
        shell.clearSections()
        if (info !== undefined && model !== undefined) {
          const extent = subresourceExtent(info, subresource.mipLevel)
          facts(
            shell.section('image', localizer.text('viewer.imageSectionImage'), { icon: 'info' })
              .body,
            [
              [localizer.text('viewer.imageDimensions'), `${extent.width} × ${extent.height}`],
              [localizer.text('viewer.imageAspect'), (extent.width / extent.height).toFixed(3)],
              [
                localizer.text('viewer.imageHasAlpha'),
                info.alphaMode === 'none' || info.channels < 4 ? 'no' : 'yes',
              ],
            ],
          )
          facts(
            shell.section('format', localizer.text('viewer.imageSectionFormat'), { icon: 'file' })
              .body,
            [
              [localizer.text('viewer.imageFormat'), formatLabel()],
              [localizer.text('viewer.imageMipLevels'), String(axisCount(info, 'mipLevel'))],
              [localizer.text('viewer.imageChannels'), `${info.channels} × ${info.bitDepth}-bit`],
              [localizer.text('viewer.imageColorSpace'), String(info.colorSpace)],
            ],
          )
          const axes: readonly (readonly [keyof ImageSubresource, string])[] = [
            ['mipLevel', 'mip'],
            ['layer', 'layer'],
            ['face', 'face'],
            ['slice', 'slice'],
          ]
          if (axes.some(([axis]) => axisCount(info, axis) > 1)) {
            const body = shell.section('subresource', localizer.text('viewer.imageSubresources'), {
              icon: 'layers',
            }).body
            const bar = element(body, 'div', { part: 'image.subresources', role: 'toolbar' })
            const current = info
            for (const [axis, name] of axes) {
              const count = axisCount(current, axis)
              if (count <= 1) continue
              const step = (delta: number): void => {
                const next = Math.min(count - 1, Math.max(0, subresource[axis] + delta))
                subresource = Object.freeze({ ...subresource, [axis]: next })
                reload()
              }
              button(
                bar,
                `${name}−`,
                localizer.text('viewer.imagePreviousSubresource', { axis: name }),
                () => step(-1),
              )
              element(bar, 'span', {
                part: 'image.readout',
                text: `${subresource[axis]}/${count - 1}`,
              })
              button(
                bar,
                `${name}+`,
                localizer.text('viewer.imageNextSubresource', { axis: name }),
                () => step(1),
              )
            }
            if (enumerateSubresources(current).length > 1) {
              button(
                bar,
                localizer.text('viewer.imageCompare'),
                localizer.text('viewer.imageCompareTitle'),
                () => {
                  compare =
                    compare === 'off' ? 'side-by-side' : compare === 'side-by-side' ? 'diff' : 'off'
                  if (compare !== 'off' && key(compareWith) === key(subresource)) {
                    compareWith = Object.freeze({
                      ...subresource,
                      mipLevel: Math.min(
                        axisCount(current, 'mipLevel') - 1,
                        subresource.mipLevel + 1,
                      ),
                    })
                  }
                  reload()
                },
                compare !== 'off',
              )
            }
          }
        }
        /*
         * Edit is MK2's section: collapsed until asked for, because expanding it is what puts the
         * tools on the pointer. The host says whether the codec can write these pixels back.
         */
        if (options.editing !== false) {
          const section = shell.section('edit', localizer.text('viewer.imageSectionEdit'), {
            icon: 'tools',
            collapsed: true,
          })
          editing?.destroy()
          editing = createImageEditing(section.body, {
            localizer,
            surface: editSurface,
            overlay: stage,
            editable: options.savePixels !== undefined,
            ...(options.editableReason === undefined
              ? {}
              : { unavailableReason: options.editableReason }),
            ...(options.savePixels === undefined ? {} : { onSave: saveEdits }),
            onDirty(dirty) {
              options.onEditingChange?.(dirty)
            },
            onEdit() {
              options.onEdit?.()
            },
          })
          const surfaceEditing = editing
          options.registerEditing?.({
            undo: () => surfaceEditing.undo(),
            redo: () => surfaceEditing.redo(),
            save: () => surfaceEditing.save(),
            get dirty() {
              return surfaceEditing.dirty
            },
          })
          editing.setActive(!section.collapsed)
          section.onToggle(collapsed => {
            editing?.setActive(!collapsed)
            paint()
          })
        }
        for (const contributed of options.sections ?? []) {
          const section = shell.section(contributed.id, contributed.title, {
            ...(contributed.icon === undefined ? {} : { icon: contributed.icon }),
            collapsed: contributed.collapsed ?? true,
          })
          void contributed.module
            .mount({ ...args, container: section.body })
            .then(mounted => {
              scope.cleanup(() => void mounted.unmount())
            })
            // A section whose module cannot bind (no such data source here) is removed, not empty.
            .catch(() => section.root.remove())
        }
        /*
         * The codec's own metadata, without the host's technical groups: identity and traits are
         * plumbing, and a group that repeats the Image and Format sections is noise.
         */
        const groups = metadataGroups(descriptor).filter(
          group => !/^(identity|traits|detection)$/iu.test(group.id),
        )
        if (groups.length > 0) {
          const body = shell.section('metadata', localizer.text('viewer.imageSectionMetadata'), {
            icon: 'symbol-misc',
            collapsed: true,
          }).body
          for (const group of groups) {
            if (groups.length > 1) {
              element(body, 'h3', { part: 'image.metadata-group', text: group.label })
            }
            facts(
              body,
              group.entries.map(entry => [entry.key, String(entry.value)] as const),
            )
          }
        }
      }

      setState(stage, ['loading'])
      try {
        info = await source.info(scope.signal)
        model = await modelFor(subresource)
        renderSections()
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
      scope.cleanup(() => {
        editing?.destroy()
        options.registerEditing?.(undefined)
        args.status?.clear()
      })

      return createViewerMount(root, scope, args, ({ descriptor: next }) => {
        descriptor = next
        root.dataset['revision'] = next.revision
        renderSections()
        paint()
      })
    },
  })
}

export const imageViewer: ViewerModule = createImageViewer()
