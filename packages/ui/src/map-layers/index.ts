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

/** Read a layer, write it as a grey PNG through the host's writer; the written file's name. */
export async function exportMapLayerPng(
  request: MapLayerRequest & {
    readonly exportBytes: NonNullable<MapLayersViewerOptions['exportBytes']>
    readonly baseName: string
  },
): Promise<string> {
  const { descriptor, operations, layer, signal } = request
  const read = await invokeOperation(descriptor, operations, MAP_LAYER_READ_OPERATION, { layer: layer.id }, signal === undefined ? {} : { signal })
  if (read.state !== 'ok' || read.output.kind !== 'json') throw new Error(read.state === 'ok' ? read.output.kind : read.reason)
  const grid = read.output.value as unknown as MapLayerGrid
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
        for (const layer of layers) {
          const row = element(root, 'div', { part: 'form.row' })
          element(row, 'span', { part: 'form.label', text: layer.label })
          element(row, 'span', {
            part: 'form.description',
            text: localizer.text('viewer.mapLayersSize', {
              width: layer.width,
              height: layer.height,
              minimum: layer.minimum,
              maximum: layer.maximum,
            }),
          })
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
