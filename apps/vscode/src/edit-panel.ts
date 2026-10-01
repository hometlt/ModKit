/**
 * The VS Code webview's reachable ADR-HOST-002 Path A surface.
 *
 * The codec operation constructs a plan; the S14 arm prepares and commits it on the extension-host
 * side; then the editor tab is reopened because the subject revision moved. The webview never
 * receives a grant, coordinator, backend, or prepared commit.
 */
import {
  createSurface,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  ViewerMountScope,
} from '@modkit/ui/viewer'
import type { AnyDescriptor, AssetEditPlan, SceneRendererPort, ViewerModule } from '@modkit/sdk'
import type {
  ImageEditingHandlers,
  ImageExportFile,
  ImageExportOutcome,
  ImageViewerOptions,
} from '@modkit/ui/image'
import type { ArchiveAction, ArchiveGalleryOptions, ArchiveTarget } from '@modkit/ui/archive'
import type { CardLocation } from '@modkit/ui/card'
import type { UiLocalizer } from '@modkit/ui/localization'
import type { ModelViewerOptions } from '@modkit/ui/model'
import type { GameTemplateViewerOptions } from '@modkit/ui/template'
import {
  mountFieldEditor,
  type FieldEditorControlV1,
  type FieldEditorRegistry,
} from '@modkit/ui/field-editor'
import { subjectCandidateProviderLease } from '@modkit/ui/selector'
import type { JsonValue } from '@modkit/sdk'

import {
  editOffer,
  editPlanFromOperationOutput,
  invokeRefusalMessage,
  isRejected,
  type EditOperationForm,
} from './edit-operations.js'
import type { WebviewEditorPorts, WebviewEditorStatus } from './editor-ports.js'
import { descriptorOperations } from './view-policy.js'
import { createVscodeLocalizer } from './localization.js'

export interface EditPanelOptions {
  readonly localizer: UiLocalizer
  readonly fieldEditors?: FieldEditorRegistry
  portsFor(descriptor: Record<string, unknown>): WebviewEditorPorts | undefined
  reopen(descriptor: Record<string, unknown>): Promise<boolean>
  lastOutcome(descriptor: Record<string, unknown>): string | undefined
  recordOutcome(descriptor: Record<string, unknown>, outcome: string): void
  onStatus?(status: WebviewEditorStatus): void
  /** How this window writes viewer exports, when it can write at all. */
  readonly exportFiles?: (
    files: readonly ImageExportFile[],
    signal?: AbortSignal,
  ) => Promise<ImageExportOutcome>
  /** Leaf name the image stage derives its export file names from. */
  readonly exportBaseName?: (descriptor: AnyDescriptor) => string
  /**
   * Where the model stage asks for a `common.render/scene-3d` provider.
   *
   * Built from the renderer the extension host selected for this page's realm (see
   * `./renderer-port.ts`). Absent means this page was granted none, and the model stage draws its
   * own 2D wireframe — which is a supported tier, not a failure.
   */
  readonly renderer?: SceneRendererPort
  /** Subject-bound model texture decoding; the page receives pixels, never resource authority. */
  readonly textures?: ModelViewerOptions['textures']
  /** The same subject-bound port, for the textures a model's effects name (plan WC6). */
  readonly rasterResources?: ModelViewerOptions['rasterResources']
  /** The same route for the assets a template names, already encoded for a canvas. */
  readonly templateImages?: GameTemplateViewerOptions['images']
  /** Whether archive views list members the codec calls hidden (`modkit.showHiddenEntries`). */
  readonly showHiddenEntries?: () => boolean
  /** The game-string locale a card opens in (`modkit.locale`); the card falls back to what it has. */
  readonly gameLocale?: string
  /** Relations a graph walk follows from its root (`modkit.maxGraphHops`). */
  readonly graphDepth?: number
  /**
   * The pixel view lends its history and save to the window, so the editor's own Undo, Redo and
   * Save drive them. Called again with `undefined` when that view goes away.
   */
  registerPixelEditing?(handlers: ImageEditingHandlers | undefined): void
  /** One committed pixel edit: one entry in the editor's undo stack. */
  onPixelEdit?(): void
  /** Leave the encoding field out of every form; the status bar's format menu owns that choice. */
  readonly omitEncoding?: boolean
  /** Open one member of the shown archive in an editor tab of its own. */
  openArchiveEntry?(entry: string): Promise<void>
  /** Show a card's source in the editor, at its line when the publisher knows it. */
  openSource?(location: CardLocation): void
  /** Open the model a card's subject names in a tab of its own. */
  openModel?(model: string): void
  /**
   * A subject of the card's selector that a navigation named (an entity clicked in Resources, plan
   * 5.29): read when the card stage mounts, which then opens on it rather than on the subject.
   */
  cardSubject?(): string | undefined
  /** Switch the open subject to another of its views (the replay's 3D world); false when absent. */
  showStage?(stageId: string): Promise<boolean>
  /** A file-manager action on the shown archive; `true` when it changed. */
  archiveAction?(action: ArchiveAction, target: ArchiveTarget): Promise<boolean>
  /** The explorer's gallery of pictures among the shown archive's members. */
  readonly archiveGallery?: ArchiveGalleryOptions
  /** Operations extensions published for the image surface, and how to run one. */
  readonly pixelOperations?: ImageViewerOptions['pixelOperations']
}

const asRecord = (descriptor: AnyDescriptor): Record<string, unknown> =>
  descriptor as unknown as Record<string, unknown>

/** State the plan's own fidelity limitation beside the successful outcome. */
export function fidelityNote(
  plan: AssetEditPlan,
  localizer: UiLocalizer = createVscodeLocalizer('en'),
): string {
  if (plan.fidelity.preservesUnknownData) return ''
  const notes = plan.fidelity.notes ?? []
  return notes.length === 0
    ? ` (${localizer.text('vscode.edit.fidelityLoss')})`
    : ` (${localizer.text('vscode.edit.fidelityNotes', { notes: notes.join('; ') })})`
}

/**
 * Writing painted pixels back: the same Path A round trip the panel below drives, with the input
 * fixed to the codec's `replace` transform.
 *
 * The image stage hands over the pixels and its own operation session; this side invokes the
 * codec's `edit.content` handler, applies the plan through the subject's editing arm and reopens
 * the tab on the new revision, exactly as an edit-panel form does.
 */
// Every writable raster codec takes painted pixels as `edit.content` `replace`; its other
// operations (a PNG text field, say) are not a way to save pixels.
const pixelSaveHandler = (descriptor: Record<string, unknown>): string | undefined =>
  descriptorOperations(descriptor).find(item => item.id === 'edit.content' && item.mutatesSource)
    ?.handlerId

/**
 * Why painted pixels of this subject cannot be saved, or undefined when they can. The Edit section
 * asks before it offers tools, and Save asks again, so the two never disagree.
 */
export function pixelSaveRefusal(
  options: Pick<EditPanelOptions, 'localizer' | 'portsFor'>,
  subject: AnyDescriptor,
): string | undefined {
  const descriptor = asRecord(subject)
  if (options.portsFor(descriptor) === undefined) return options.localizer.text('vscode.edit.noArm')
  return pixelSaveHandler(descriptor) === undefined
    ? options.localizer.text('imageEditing.unavailable')
    : undefined
}

export function createVsCodePixelSaver(
  options: EditPanelOptions,
): NonNullable<ImageViewerOptions['savePixels']> {
  const localizer = options.localizer
  return async (request, signal) => {
    const descriptor = asRecord(request.descriptor)
    const refusal = pixelSaveRefusal(options, request.descriptor)
    const ports = options.portsFor(descriptor)
    const handlerId = pixelSaveHandler(descriptor)
    if (refusal !== undefined || ports === undefined || handlerId === undefined)
      return { state: 'refused', reason: refusal ?? localizer.text('vscode.edit.nothingHere') }
    let result
    try {
      result = await request.operations.invoke(
        handlerId,
        {
          transform: 'replace',
          format: 'keep',
          image: {
            width: request.image.width,
            height: request.image.height,
            pixels: base64Of(request.image.rgba),
          },
        },
        ...(signal === undefined ? [] : [{ signal }]),
      )
    } catch (error) {
      return { state: 'refused', reason: error instanceof Error ? error.message : String(error) }
    }
    if (isRejected(result)) {
      return { state: 'refused', reason: invokeRefusalMessage(result, localizer) }
    }
    let plan: AssetEditPlan
    try {
      plan = editPlanFromOperationOutput(result.output)
    } catch (error) {
      return { state: 'refused', reason: error instanceof Error ? error.message : String(error) }
    }
    if (request.mode === 'bytes') {
      // Save As and the editor's backup: the same plan, its file handed back instead of applied.
      const bytes = wholeFileBytes(plan)
      return bytes === undefined
        ? { state: 'refused', reason: localizer.text('vscode.edit.notWholeFile') }
        : { state: 'encoded', bytes }
    }
    const applied = await ports.applyPlan(plan)
    if (applied.failed) return { state: 'refused', reason: applied.message }
    const outcome = `${localizer.text('vscode.edit.apply')} — ${applied.message}`
    options.recordOutcome(descriptor, outcome)
    await options.reopen(descriptor)
    return { state: 'saved', message: outcome }
  }
}

/**
 * The whole new file an edit plan writes, when it is one replacement of a file's entire content
 * (an image codec's `replace`); undefined for a ranged or multi-file plan, or a staged payload.
 */
export function wholeFileBytes(plan: AssetEditPlan): Uint8Array | undefined {
  const [edit, ...others] = plan.edits
  if (edit === undefined || others.length > 0) return undefined
  if (edit.operation !== 'replace' || edit.range !== undefined) return undefined
  if (edit.payload.kind === 'inline') return edit.payload.bytes
  return edit.payload.kind === 'text' ? new TextEncoder().encode(edit.payload.text) : undefined
}

/** Pixels cross the operation boundary as JSON; base64 keeps that from being one number per byte. */
function base64Of(bytes: Uint8Array): string {
  let text = ''
  // Chunked: `String.fromCharCode(...bytes)` overflows the argument list on a real texture.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(text)
}

export function createVsCodeEditPanel(options: EditPanelOptions): ViewerModule {
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const candidateLease = await subjectCandidateProviderLease(args.sources, args.slot)
      if (candidateLease !== undefined) scope.lease(candidateLease)
      const localizer = options.localizer
      const root = createSurface(args.container, localizer.text('vscode.edit.title'))
      const descriptor = asRecord(args.descriptor)
      const ports = options.portsFor(descriptor)
      const offer = editOffer(descriptor, {
        editable: ports !== undefined,
        localizer,
        ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
      })

      const chooser = element(root, 'div', { part: 'form.row' })
      element(chooser, 'label', {
        part: 'form.label',
        text: localizer.text('vscode.edit.operation'),
      })
      const picker = element(chooser, 'select', { part: 'form.select' })
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError('no select element')
      picker.setAttribute('aria-label', localizer.text('vscode.edit.mutatingOperation'))
      const summary = element(root, 'p', { part: 'form.description' })
      const pane = element(root, 'div', { part: 'settings.pane' })
      const actions = element(root, 'div', { part: 'form.actions' })
      const apply = element(actions, 'button', {
        part: 'form.button',
        text: localizer.text('vscode.edit.apply'),
      })
      apply.setAttribute('type', 'button')
      const status = element(root, 'output', { part: 'form.status' })
      const notes = element(root, 'div')

      const say = (message: string, failed: boolean): void => {
        setViewerText(status, message)
        setState(status, failed ? ['error'] : [])
        options.onStatus?.({ message, failed })
      }

      const drawNotes = (): void => {
        notes.replaceChildren()
        const previous = options.lastOutcome(descriptor)
        if (previous !== undefined) {
          element(notes, 'div', {
            part: 'form.description',
            text: localizer.text('vscode.edit.lastChange', { change: previous }),
          })
        }
        for (const item of offer.unsupported) {
          element(notes, 'div', {
            part: 'form.description',
            text: localizer.text('vscode.edit.unsupported', {
              operation: item.operationId,
              reason: item.reason,
            }),
          })
        }
      }

      const inputs = new Map<string, FieldEditorControlV1>()
      const selectedForm = (): EditOperationForm | undefined =>
        offer.forms.find(item => item.id === picker.value) ?? offer.forms[0]

      const drawFields = async (): Promise<void> => {
        await Promise.all([...inputs.values()].map(input => input.unmount?.()))
        inputs.clear()
        pane.replaceChildren()
        const chosen = selectedForm()
        if (chosen === undefined) {
          setViewerText(summary, localizer.text('vscode.edit.noOperation'))
          apply.setAttribute('disabled', '')
          return
        }
        apply.removeAttribute('disabled')
        setViewerText(summary, `${chosen.summary} (${chosen.operationId} → ${chosen.handlerId})`)
        for (const item of chosen.fields) {
          /*
           * Encoding is not asked twice. The status bar's format menu is where a target encoding is
           * chosen for this subject; an in-place transform keeps whatever the source used, which is
           * what omitting the field means to every one of these forms.
           */
          if (options.omitEncoding === true && item.name === 'format') continue
          const row = element(pane, 'div', { part: 'form.row' })
          element(row, 'label', { part: 'form.label', text: item.label })
          const control = element(row, 'div', { part: 'form.control' })
          inputs.set(
            item.name,
            await mountFieldEditor(
              control,
              item,
              scope.signal,
              options.fieldEditors,
              item.editorId,
              candidateLease?.value,
            ),
          )
          if (item.hint !== undefined) {
            element(row, 'span', { part: 'form.description', text: item.hint })
          }
        }
      }

      const run = async (): Promise<void> => {
        const chosen = selectedForm()
        if (chosen === undefined || ports === undefined) {
          say(localizer.text('vscode.edit.noArm'), true)
          return
        }
        const values = new Map<string, JsonValue>()
        for (const [name, input] of inputs) {
          const problem = input.validate()
          if (problem !== undefined) throw new TypeError(problem)
          values.set(name, input.read())
        }

        let input
        try {
          input = chosen.build(values)
        } catch (error) {
          say(
            localizer.text('vscode.edit.cannotApply', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            true,
          )
          return
        }

        say(
          localizer.text('vscode.edit.invoking', {
            operation: chosen.label,
            handler: chosen.handlerId,
          }),
          false,
        )
        let result
        try {
          result = await args.operations.invoke(chosen.handlerId, input, { signal: scope.signal })
        } catch (error) {
          say(
            localizer.text('vscode.edit.codecRefused', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            true,
          )
          return
        }
        if (isRejected(result)) {
          say(invokeRefusalMessage(result, localizer), true)
          return
        }

        let plan: AssetEditPlan
        try {
          plan = editPlanFromOperationOutput(result.output)
        } catch (error) {
          say(
            localizer.text('vscode.edit.hostRefusedPlan', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            true,
          )
          return
        }

        const applied = await ports.applyPlan(plan)
        if (applied.failed) {
          say(applied.message, true)
          return
        }
        const outcome = `${chosen.label} — ${applied.message}${fidelityNote(plan, localizer)}`
        options.recordOutcome(descriptor, outcome)
        say(localizer.text('vscode.edit.reopenSuccess', { outcome }), false)
        if (scope.signal.aborted) return
        const reopened = await options.reopen(descriptor)
        if (!reopened && !scope.signal.aborted) {
          say(localizer.text('vscode.edit.reopenFailed', { outcome }), true)
        }
      }

      apply.addEventListener('click', () => {
        apply.setAttribute('disabled', '')
        void run()
          .catch((error: unknown) => {
            say(error instanceof Error ? error.message : String(error), true)
          })
          .finally(() => {
            if (!scope.signal.aborted) apply.removeAttribute('disabled')
          })
      })

      for (const item of offer.forms) {
        const option = element(picker, 'option', { text: item.label })
        option.setAttribute('value', item.id)
      }
      picker.addEventListener('change', () => void drawFields())
      await drawFields()
      drawNotes()
      const declared = descriptorOperations(descriptor).filter(item => item.mutatesSource).length
      if (offer.forms.length === 0) {
        setState(root, ['degraded'])
        say(
          offer.unsupported.length === 0
            ? localizer.text('vscode.edit.nothingHere')
            : localizer.text('vscode.edit.noneDrivable', {
                unsupported: offer.unsupported.length,
                declared,
              }),
          false,
        )
      } else {
        say(localizer.text('vscode.edit.counts', { forms: offer.forms.length, declared }), false)
      }

      return {
        async update() {
          // A committed revision is represented by a fresh tab and a fresh mount.
        },
        async unmount() {
          await scope.close()
          root.remove()
        },
      }
    },
  })
}
