/**
 * A map's grid layers as images: export one as a grey PNG, import a PNG back into it.
 *
 * Nothing here knows a game. Any map codec that declares the common map-layer operations
 * (`map.layers`, `map.layer-read`, `map.layer-write`) gets this panel; the codec speaks numbers
 * and this side owns the image, so a heightmap exports and imports the same way for every format.
 * Writing is the one edit path: the codec answers with an edit plan and the host commits it.
 * Without a writer or a commit route the buttons say why they are off instead of doing nothing.
 */
import { greyGridFromPng, greyGridToPng } from '@modkit/codec-kit/raster'
import type { AnyDescriptor, AssetEditPlan, JsonValue, OperationSession, ViewerModule } from '@modkit/sdk'
import {
  MAP_LAYERS_OPERATION,
  MAP_LAYER_READ_OPERATION,
  MAP_LAYER_WRITE_OPERATION,
  type MapLayerDescriptor,
  type MapLayerGrid,
  type MapLayerList,
  type MapLayerMeaning,
} from '@modkit/sdk/maps'
import type { ImageExportFile, ImageExportOutcome } from '../image/index.js'
import { MAP_LAYERS_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import type { UiLocalizer } from '../localization/index.js'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  invokeOperation,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'

export interface MapLayersViewerOptions {
  readonly localizer?: UiLocalizer
  /** How this host writes exported files; absent disables export with the reason shown. */
  readonly exportBytes?: (files: readonly ImageExportFile[], signal?: AbortSignal) => Promise<ImageExportOutcome>
  /** Base name of the exported files; the host usually supplies the subject name. */
  readonly exportBaseName?: (descriptor: AnyDescriptor) => string
  /** Commit the plan a layer write produced; absent disables import with the reason shown. */
  readonly applyPlan?: (
    descriptor: AnyDescriptor,
    plan: AssetEditPlan,
  ) => Promise<{ readonly failed: boolean; readonly message: string }>
  /** Show the subject at its new revision after a committed write. */
  readonly reopen?: (descriptor: AnyDescriptor) => Promise<unknown>
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

interface MapLayerRequest {
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly layer: MapLayerDescriptor
  readonly signal?: AbortSignal
}

/** A layer's samples, as `map.layer-read` returns them. */
export async function readMapLayer(request: MapLayerRequest): Promise<MapLayerGrid> {
  const { descriptor, operations, layer, signal } = request
  const read = await invokeOperation(descriptor, operations, MAP_LAYER_READ_OPERATION, { layer: layer.id }, signal === undefined ? {} : { signal })
  if (read.state !== 'ok' || read.output.kind !== 'json') throw new Error(read.state === 'ok' ? read.output.kind : read.reason)
  return read.output.value as unknown as MapLayerGrid
}

/** Layers whose values are classes, not amounts: each value gets a colour of its own. */
const CLASS_MEANINGS: ReadonlySet<MapLayerMeaning> = new Set(['cliff-level', 'pathing', 'flags'])
/** Colours far apart from one another; a layer with more values than these is drawn as a ramp. */
const CLASS_COLOURS: readonly (readonly [number, number, number])[] = [
  [32, 32, 32], [230, 25, 75], [60, 180, 75], [255, 225, 25], [67, 99, 216], [245, 130, 49],
  [145, 30, 180], [70, 240, 240], [240, 50, 230], [188, 246, 12], [250, 190, 190], [0, 128, 128],
  [230, 190, 255], [154, 99, 36], [255, 250, 200], [128, 0, 0],
]

export interface MapLayerPicture {
  readonly width: number
  readonly height: number
  /** RGBA, row 0 at the map's north edge. */
  readonly rgba: Uint8ClampedArray<ArrayBuffer>
  /** The colour of each value present, when the layer is drawn as classes; empty for a ramp. */
  readonly classes: readonly { readonly value: number; readonly colour: string }[]
}

/**
 * A layer's samples as a picture: classes (cliff levels, pathing, flags) with few enough values get
 * a colour each, anything else is a grey ramp from the layer's minimum (black) to its maximum.
 */
export function mapLayerPicture(layer: MapLayerDescriptor, grid: MapLayerGrid): MapLayerPicture {
  const span = layer.maximum - layer.minimum
  const classed = CLASS_MEANINGS.has(layer.meaning) && span < CLASS_COLOURS.length
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4)
  const present = new Set<number>()
  for (let index = 0; index < grid.width * grid.height; index += 1) {
    const value = Math.min(layer.maximum, Math.max(layer.minimum, grid.values[index] ?? layer.minimum))
    let colour: readonly [number, number, number]
    if (classed) {
      present.add(value)
      colour = CLASS_COLOURS[value - layer.minimum] ?? [0, 0, 0]
    } else {
      const grey = span === 0 ? 0 : Math.round(((value - layer.minimum) / span) * 255)
      colour = [grey, grey, grey]
    }
    rgba.set([...colour, 255], index * 4)
  }
  const classes = [...present].sort((a, b) => a - b).map(value => {
    const [r, g, b] = CLASS_COLOURS[value - layer.minimum] ?? [0, 0, 0]
    return { value, colour: `rgb(${r} ${g} ${b})` }
  })
  return { width: grid.width, height: grid.height, rgba, classes }
}

/** A sample as the world value the layer declares (`valueOffset + sample * valueScale` in `unit`). */
export function mapLayerValue(layer: MapLayerDescriptor, sample: number): string {
  if (layer.valueScale === undefined && layer.valueOffset === undefined) return String(sample)
  const value = Number(((layer.valueOffset ?? 0) + sample * (layer.valueScale ?? 1)).toPrecision(4))
  return layer.unit === undefined ? String(value) : `${value} ${layer.unit}`
}

function drawPicture(canvas: HTMLCanvasElement, picture: MapLayerPicture): void {
  canvas.width = picture.width
  canvas.height = picture.height
  canvas.getContext('2d')?.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0)
}

/** Read a layer, write it as a grey PNG through the host's writer; the written file's name. */
export async function exportMapLayerPng(
  request: MapLayerRequest & {
    readonly exportBytes: NonNullable<MapLayersViewerOptions['exportBytes']>
    readonly baseName: string
  },
): Promise<string> {
  const { layer, signal } = request
  const grid = await readMapLayer(request)
  const name = `${request.baseName}.${layer.id}.png`
  const bytes = await greyGridToPng(grid, layer.maximum, signal)
  const outcome = await request.exportBytes([{ name, mediaType: 'image/png', bytes }], signal)
  if (outcome.state !== 'written') throw new Error(outcome.reason)
  return outcome.names[0] ?? name
}

/** A PNG → the layer's numbers → the codec's edit plan → committed; the commit's message. */
export async function importMapLayerPng(
  request: MapLayerRequest & {
    readonly png: Uint8Array
    readonly applyPlan: (plan: AssetEditPlan) => Promise<{ readonly failed: boolean; readonly message: string }>
  },
): Promise<string> {
  const { descriptor, operations, layer, signal } = request
  const grid = await greyGridFromPng(request.png, layer, signal)
  const input = { layer: layer.id, width: grid.width, height: grid.height, values: [...grid.values] } satisfies JsonValue
  const written = await invokeOperation(descriptor, operations, MAP_LAYER_WRITE_OPERATION, input, signal === undefined ? {} : { signal })
  if (written.state !== 'ok') throw new Error(written.reason)
  if (written.output.kind !== 'edit-plan') throw new Error(written.output.kind)
  const applied = await request.applyPlan(written.output.plan)
  if (applied.failed) throw new Error(applied.message)
  return applied.message
}

export function createMapLayersViewer(options: MapLayersViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, MAP_LAYERS_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.mapLayers'))
      const render = async ({ descriptor }: { readonly descriptor: AnyDescriptor }) => {
        root.replaceChildren()
        const status = element(root, 'p', { part: 'form.status', role: 'status' })
        const say = (text: string) => setViewerText(status, text)
        const failed = (reason: string) => say(localizer.text('viewer.mapLayersFailed', { reason }))
        const listed = await invokeOperation(descriptor, args.operations, MAP_LAYERS_OPERATION, {}, { signal: scope.signal })
        if (listed.state !== 'ok' || listed.output.kind !== 'json') {
          failed(listed.state === 'ok' ? listed.output.kind : listed.reason)
          return
        }
        const layers = (listed.output.value as unknown as MapLayerList).layers
        if (layers.length === 0) say(localizer.text('viewer.mapLayersEmpty'))
        const writable = descriptor.operations.some(item => item.id === MAP_LAYER_WRITE_OPERATION)
        // The chosen layer drawn large, with what its colours mean.
        const view = element(root, 'div', { part: 'map-layers.view' })
        view.hidden = true
        const image = element(view, 'canvas', { part: 'map-layers.image' }) as HTMLCanvasElement
        const legend = element(view, 'div', { part: 'map-layers.legend' })
        const show = (layer: MapLayerDescriptor, picture: MapLayerPicture): void => {
          view.hidden = false
          drawPicture(image, picture)
          image.setAttribute('aria-label', layer.label)
          legend.replaceChildren()
          if (picture.classes.length === 0) {
            element(legend, 'span', {
              text: localizer.text('viewer.mapLayersRamp', {
                minimum: mapLayerValue(layer, layer.minimum),
                maximum: mapLayerValue(layer, layer.maximum),
              }),
            })
          }
          for (const item of picture.classes) {
            const swatch = element(legend, 'span', { part: 'map-layers.swatch' })
            swatch.style.background = item.colour
            element(legend, 'span', { text: mapLayerValue(layer, item.value) })
          }
        }
        const pictures: { readonly layer: MapLayerDescriptor; readonly thumbnail: HTMLCanvasElement; readonly size: HTMLElement }[] = []
        for (const layer of layers) {
          const row = element(root, 'div', { part: 'form.row' })
          const thumbnail = element(row, 'canvas', { part: 'map-layers.thumbnail' }) as HTMLCanvasElement
          thumbnail.tabIndex = 0
          thumbnail.setAttribute('role', 'button')
          thumbnail.setAttribute('aria-label', localizer.text('viewer.mapLayersShow', { layer: layer.label }))
          element(row, 'span', { part: 'form.label', text: layer.label })
          const size = element(row, 'span', {
            part: 'form.description',
            text: localizer.text('viewer.mapLayersSize', {
              width: layer.width,
              height: layer.height,
              minimum: layer.minimum,
              maximum: layer.maximum,
            }),
          })
          pictures.push({ layer, thumbnail, size })
          const actions = element(row, 'div', { part: 'form.actions' })
          const exportButton = element(actions, 'button', { part: 'form.button', text: localizer.text('viewer.mapLayersExport') }) as HTMLButtonElement
          const exportBytes = options.exportBytes
          if (exportBytes === undefined) {
            exportButton.disabled = true
            exportButton.title = localizer.text('viewer.mapLayersNoWriter')
          }
          exportButton.addEventListener('click', () => {
            void exportLayer(descriptor, layer).then(say, error => failed(reasonOf(error)))
          })
          const importButton = element(actions, 'button', { part: 'form.button', text: localizer.text('viewer.mapLayersImport') }) as HTMLButtonElement
          const refusal = !layer.editable || !writable
            ? localizer.text('viewer.mapLayersReadOnly')
            : options.applyPlan === undefined
              ? localizer.text('viewer.mapLayersNoEditing')
              : undefined
          if (refusal !== undefined) {
            importButton.disabled = true
            importButton.title = refusal
          }
          const picker = element(actions, 'input', { part: 'form.input' }) as HTMLInputElement
          picker.type = 'file'
          picker.accept = 'image/png'
          picker.hidden = true
          importButton.addEventListener('click', () => picker.click())
          picker.addEventListener('change', () => {
            const file = picker.files?.[0]
            picker.value = ''
            if (file === undefined) return
            void file
              .arrayBuffer()
              .then(bytes => importLayer(descriptor, layer, new Uint8Array(bytes)))
              .then(say, error => failed(reasonOf(error)))
          })
        }
        // Each layer is read on its own: one the codec cannot read says why and leaves the rest drawn.
        let shown = false
        for (const { layer, thumbnail, size } of pictures) {
          try {
            const picture = mapLayerPicture(layer, await readMapLayer({ descriptor, operations: args.operations, layer, signal: scope.signal }))
            drawPicture(thumbnail, picture)
            const pick = () => show(layer, picture)
            thumbnail.addEventListener('click', pick)
            thumbnail.addEventListener('keydown', event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              pick()
            })
            if (!shown) pick()
            shown = true
          } catch (error) {
            thumbnail.hidden = true
            setViewerText(size, localizer.text('viewer.mapLayersFailed', { reason: reasonOf(error) }))
          }
        }
      }

      const exportLayer = async (descriptor: AnyDescriptor, layer: MapLayerDescriptor): Promise<string> => {
        const name = await exportMapLayerPng({
          descriptor,
          operations: args.operations,
          layer,
          exportBytes: options.exportBytes!,
          baseName: options.exportBaseName?.(descriptor) ?? 'map',
          signal: scope.signal,
        })
        return localizer.text('viewer.mapLayersExported', { name })
      }

      const importLayer = async (descriptor: AnyDescriptor, layer: MapLayerDescriptor, png: Uint8Array): Promise<string> => {
        const message = await importMapLayerPng({
          descriptor,
          operations: args.operations,
          layer,
          png,
          applyPlan: plan => options.applyPlan!(descriptor, plan),
          signal: scope.signal,
        })
        await options.reopen?.(descriptor)
        return localizer.text('viewer.mapLayersImported', { layer: layer.label, message })
      }

      await render(args)
      return createViewerMount(root, scope, args, render)
    },
  })
}
