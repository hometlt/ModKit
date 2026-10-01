import type { AnyDescriptor, VectorSceneInfo, VectorSceneSource, ViewerModule } from '@modkit/sdk'
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
import { createMediaShell, MEDIA_ZOOM_CHOICES, mediaFacts } from '../media-shell/index.js'
import type { ImageExportFile, ImageExportOutcome } from '../image/index.js'
import { canvasPng } from '../media/encoded.js'
import { type UiLocalizer } from '../localization/index.js'
import { VECTOR_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const VECTOR_MAXIMUM_TEXT_BYTES = 32 * 1024 * 1024
/** Most pixels one PNG export draws, as RGBA bytes. */
export const VECTOR_MAXIMUM_EXPORT_BYTES = 64 * 1024 * 1024
/** Scales the PNG export offers, of the drawing's own size. */
const EXPORT_SCALES = [1, 2, 4, 8] as const

export interface VectorViewerOptions {
  readonly localizer?: UiLocalizer
  /** How the host writes exported files; without it the PNG export is not offered. */
  readonly exportBytes?: (
    files: readonly ImageExportFile[],
    signal?: AbortSignal,
  ) => Promise<ImageExportOutcome>
  /** Base name an exported file takes; the host usually supplies the subject name. */
  readonly exportBaseName?: (descriptor: AnyDescriptor) => string
}

/**
 * The drawing's own size: its width and height, else its viewBox, else what the browser gives the
 * image, else the 300 × 150 every browser gives a replaced element that says nothing.
 */
export function vectorExtent(
  info: VectorSceneInfo,
  image?: { readonly naturalWidth: number; readonly naturalHeight: number },
): { readonly width: number; readonly height: number } {
  const positive = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value > 0
  if (positive(info.width) && positive(info.height)) {
    return { width: info.width, height: info.height }
  }
  const box = info.viewBox
  if (box !== undefined && positive(box[2]) && positive(box[3])) {
    return { width: box[2], height: box[3] }
  }
  if (image !== undefined && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { width: image.naturalWidth, height: image.naturalHeight }
  }
  return { width: 300, height: 150 }
}

/** A leaf name a host will accept, from a subject name; never a path. */
const exportName = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .slice(0, 96) || 'vector'

export function createVectorViewer(options: VectorViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, VECTOR_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.vector'))
      /*
       * The image viewer's layout, as MK2's vector viewer had it: the drawing alone in the render
       * area over a checkerboard, zoomed about the pointer and dragged, with its facts and export
       * in the sidebar and its size and zoom in the host status bar.
       */
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'vector' })
      const readout = element(stage, 'output', { part: 'vector.readout' })
      const image = element(stage, 'img', { part: 'vector.image' }) as HTMLImageElement
      image.alt = localizer.text('viewer.vectorPreview')
      image.draggable = false

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/vector-scene-source',
      )
      if (lease === undefined) throw new TypeError('vector binding is unavailable')
      scope.lease(lease)

      let info: VectorSceneInfo | undefined
      let objectUrl: string | undefined
      let zoom = 1
      let fit = true
      let panX = 0
      let panY = 0
      let descriptor = args.descriptor
      const extent = () => (info === undefined ? undefined : vectorExtent(info, image))
      /** Fit draws the whole drawing in the render area, enlarged too: a vector loses nothing. */
      const scale = (): number => {
        const size = extent()
        if (!fit || size === undefined) return zoom
        const box = stage.getBoundingClientRect()
        return Math.max(
          0.01,
          Math.min(Math.max(16, box.width) / size.width, Math.max(16, box.height) / size.height),
        )
      }

      const publishStatus = (): void => {
        const size = extent()
        if (size === undefined) return
        const now = scale()
        args.status?.set(
          [
            {
              id: 'size',
              icon: 'symbol-ruler',
              text: `${Math.round(size.width)} × ${Math.round(size.height)}`,
              align: 'start' as const,
            },
            ...(info?.viewBox === undefined
              ? []
              : [
                  {
                    id: 'viewbox',
                    text: `viewBox ${info.viewBox.join(' ')}`,
                    align: 'start' as const,
                  },
                ]),
            {
              id: 'zoom',
              icon: 'zoom-in',
              text: fit
                ? `${localizer.text('viewer.fit')} (${Math.round(now * 100)}%)`
                : `${Math.round(now * 100)}%`,
              tooltip: localizer.text('viewer.fitTitle'),
              align: 'end' as const,
              selected: fit ? 'fit' : String(zoom),
              choices: [
                { id: 'fit', label: localizer.text('viewer.fit') },
                ...MEDIA_ZOOM_CHOICES.map(value => ({
                  id: String(value),
                  label: `${value * 100}%`,
                })),
              ],
            },
          ],
          (itemId, choiceId) => {
            if (itemId !== 'zoom') return
            if (choiceId === 'fit') {
              fit = true
              panX = 0
              panY = 0
            } else if (Number(choiceId) > 0) {
              fit = false
              zoom = Number(choiceId)
            }
            place()
          },
        )
      }
      scope.cleanup(() => args.status?.clear())

      /** Sized rather than transformed, so the browser draws the vector sharp at every zoom. */
      const place = (): void => {
        const size = extent()
        if (size === undefined) return
        const box = stage.getBoundingClientRect()
        const now = scale()
        const width = size.width * now
        const height = size.height * now
        image.style.width = `${width}px`
        image.style.height = `${height}px`
        image.style.left = `${box.width / 2 + panX - width / 2}px`
        image.style.top = `${box.height / 2 + panY - height / 2}px`
        publishStatus()
      }
      const resize = new ResizeObserver(() => place())
      resize.observe(stage)
      scope.cleanup(() => resize.disconnect())

      // Wheel zoom about the pointer, drag to pan and a double click back to Fit, as for an image.
      stage.addEventListener(
        'wheel',
        event => {
          if (info === undefined) return
          event.preventDefault()
          const before = scale()
          const next = Math.min(64, Math.max(0.01, before * (event.deltaY < 0 ? 1.25 : 0.8)))
          const box = stage.getBoundingClientRect()
          const x = event.clientX - box.left - box.width / 2 - panX
          const y = event.clientY - box.top - box.height / 2 - panY
          panX -= x * (next / before - 1)
          panY -= y * (next / before - 1)
          fit = false
          zoom = next
          place()
        },
        { passive: false, signal: scope.signal },
      )
      let dragging: number | undefined
      let originX = 0
      let originY = 0
      stage.addEventListener(
        'pointerdown',
        event => {
          dragging = event.pointerId
          originX = event.clientX - panX
          originY = event.clientY - panY
          stage.setPointerCapture(event.pointerId)
        },
        { signal: scope.signal },
      )
      stage.addEventListener(
        'pointermove',
        event => {
          if (dragging !== event.pointerId) return
          panX = event.clientX - originX
          panY = event.clientY - originY
          place()
        },
        { signal: scope.signal },
      )
      const release = (event: PointerEvent): void => {
        if (dragging !== event.pointerId) return
        dragging = undefined
        stage.releasePointerCapture(event.pointerId)
      }
      stage.addEventListener('pointerup', release, { signal: scope.signal })
      stage.addEventListener('pointercancel', release, { signal: scope.signal })
      stage.addEventListener(
        'dblclick',
        () => {
          fit = true
          panX = 0
          panY = 0
          place()
        },
        { signal: scope.signal },
      )

      /** The drawing as a PNG at `factor` times its own size, through the host's writer. */
      const exportPng = async (factor: number, note: HTMLElement): Promise<void> => {
        const write = options.exportBytes
        const size = extent()
        if (write === undefined || size === undefined || objectUrl === undefined) return
        const width = Math.max(1, Math.round(size.width * factor))
        const height = Math.max(1, Math.round(size.height * factor))
        if (width * height * 4 > VECTOR_MAXIMUM_EXPORT_BYTES) {
          setViewerText(note, localizer.text('viewer.vectorExportTooLarge', { width, height }), 512)
          return
        }
        setViewerText(note, localizer.text('viewer.vectorExporting'), 512)
        try {
          const drawing = new Image(width, height)
          drawing.src = objectUrl
          await drawing.decode()
          const canvas = root.ownerDocument.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (context === null) throw new TypeError('2d canvas context is unavailable')
          context.drawImage(drawing, 0, 0, width, height)
          const base = exportName(options.exportBaseName?.(descriptor) ?? 'vector')
          const outcome = await write(
            [
              {
                name: factor === 1 ? `${base}.png` : `${base}@${factor}x.png`,
                mediaType: 'image/png',
                bytes: await canvasPng(canvas),
              },
            ],
            scope.signal,
          )
          setViewerText(
            note,
            outcome.state === 'written'
              ? localizer.text('viewer.vectorExported', { name: outcome.names.join(', ') })
              : localizer.text('viewer.vectorExportRefused', { reason: outcome.reason }),
            512,
          )
        } catch (error) {
          setViewerText(
            note,
            localizer.text('viewer.vectorExportRefused', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            512,
          )
        }
      }

      setState(stage, ['loading'])
      try {
        const source = lease.value as VectorSceneSource
        const [read, document] = await Promise.all([
          source.info(scope.signal),
          source.document(scope.signal),
        ])
        if (document.profile !== 'uvg.secure-static.v1') {
          throw new TypeError(`unsupported vector security profile ${document.profile}`)
        }
        const textBytes = new TextEncoder().encode(document.text).byteLength
        if (textBytes > VECTOR_MAXIMUM_TEXT_BYTES) {
          throw new RangeError(`vector document exceeds the stage budget: ${textBytes} bytes`)
        }
        info = read
        const url = URL.createObjectURL(
          new Blob([document.text], { type: `${document.mediaType};charset=utf-8` }),
        )
        objectUrl = url
        scope.cleanup(() => URL.revokeObjectURL(url))
        image.src = url
        await image.decode().catch(() => undefined)
        setViewerText(
          readout,
          localizer.text('viewer.vectorSummary', {
            nodes: read.nodes,
            paths: read.paths,
            shapes: read.shapes,
            text: read.textNodes,
          }),
        )
        const size = vectorExtent(read, image)
        mediaFacts(
          shell.section('vector', localizer.text('viewer.vector'), { icon: 'info' }).body,
          [
            [
              localizer.text('viewer.vectorSize'),
              `${Math.round(size.width)} × ${Math.round(size.height)}`,
            ],
            ...(read.viewBox === undefined
              ? []
              : [['viewBox', read.viewBox.join(' ')] as [string, string]]),
            [localizer.text('viewer.vectorNodes'), String(read.nodes)],
            [localizer.text('viewer.vectorPaths'), String(read.paths)],
            [localizer.text('viewer.vectorShapes'), String(read.shapes)],
            [localizer.text('viewer.vectorText'), String(read.textNodes)],
            [localizer.text('viewer.vectorGradients'), String(read.gradients)],
          ],
        )
        if (options.exportBytes !== undefined) {
          const body = shell.section('export', localizer.text('viewer.vectorExport'), {
            icon: 'export',
          }).body
          const factor = element(body, 'select') as HTMLSelectElement
          factor.setAttribute('aria-label', localizer.text('viewer.vectorExportScale'))
          factor.title = factor.getAttribute('aria-label') ?? ''
          for (const value of EXPORT_SCALES) {
            const option = element(factor, 'option', { text: `${value}×` }) as HTMLOptionElement
            option.value = String(value)
          }
          const run = element(body, 'button', {
            part: 'operations.button',
            text: localizer.text('viewer.vectorExportPng'),
          }) as HTMLButtonElement
          run.type = 'button'
          const note = element(body, 'output', { part: 'viewer.status' })
          run.addEventListener('click', () => void exportPng(Number(factor.value), note), {
            signal: scope.signal,
          })
        }
        setState(stage, [])
        place()
      } catch (error) {
        setState(stage, ['error'])
        image.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.vectorError', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        })
      }

      return createViewerMount(root, scope, args, ({ descriptor: next }) => {
        descriptor = next
        root.dataset['revision'] = next.revision
      })
    },
  })
}

export const vectorViewer: ViewerModule = createVectorViewer()
