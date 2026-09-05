/**
 * The Edit panel — the one place this application offers a codec's mutating operations.
 *
 * ADR-HOST-002 Path A end to end, from a control a user can actually reach:
 *
 *   pick a form → fill its fields → `operations().invoke(handlerId, input)` → the result carries
 *   `{ kind: 'edit-plan', plan }` → the plan goes to the S14 arm (`prepare` then `commit`, both in
 *   main) → the tab is reopened so the stage shows the file as it now is.
 *
 * The renderer holds no grant and gains none: `applyPlan` is one call on the arm, main owns the
 * coordinator, the backend, the grant snapshot and every prepared commit. Nothing here writes and
 * nothing here widens the preload bridge.
 *
 * The panel is drawn only for a subject the shell holds an editing arm for — `editOffer` in
 * `./edit-operations.ts` is the rule, and `./inspector.ts` applies it before mounting. A subject
 * without an arm gets no panel at all rather than a form whose Apply is refused at the end.
 *
 * The shipped `operationToolbar` is wrapped here too: it invokes every declared operation with a
 * `null` input, which is right for the read-only verbs and wrong for a mutating one whose input is
 * a record. `nonMutatingOperationToolbar` hands it a descriptor without the mutating operations, so
 * the Operations panel offers exactly what `null` is a valid input for and this panel owns the rest.
 */
import {
  createSurface,
  defineViewerModule,
  element,
  operationToolbar,
  setState,
  setViewerText,
  ViewerMountScope,
} from '@modkit/ui'
import { DEFAULT_UI_LOCALIZER, type UiLocalizer } from '@modkit/ui/localization'
import {
  mountFieldEditor,
  type FieldEditorControlV1,
  type FieldEditorRegistry,
} from '@modkit/ui/field-editor'
import type { AnyDescriptor, AssetEditPlan, JsonValue, ViewerModule } from '@modkit/sdk'

import {
  editOffer,
  editPlanFromOperationOutput,
  invokeRefusalMessage,
  isRejected,
  type EditOperationForm,
} from './edit-operations.js'
import type { EditorStatus } from './editor-ports.js'
import { descriptorOperations } from './view-policy.js'

/** What the panel needs of the tab's editing arm; `RendererEditorPorts` satisfies it. */
export interface EditPanelPorts {
  /** Prepare and commit a plan an operation produced. Reports its own refusals to the shell. */
  applyPlan(plan: AssetEditPlan): Promise<EditorStatus>
}

export interface EditPanelOptions {
  readonly localizer?: UiLocalizer
  readonly fieldEditors?: FieldEditorRegistry
  /** The arm this tab holds, or `undefined` when main refused one for the subject. */
  portsFor(descriptor: Record<string, unknown>): EditPanelPorts | undefined
  /**
   * Close and reopen the tab so its stages read the committed bytes. The subject's revision has
   * moved and a stage still showing the old one would be a lie; this host reopens rather than
   * pretending it can refresh in place, and the panel says so.
   */
  reopen(descriptor: Record<string, unknown>): Promise<boolean>
  /** Remembered across the reopen, because the panel that reported it is remounted by it. */
  lastOutcome(descriptor: Record<string, unknown>): string | undefined
  recordOutcome(descriptor: Record<string, unknown>, outcome: string): void
  /** Reports to the shell's status line, like every other editing surface in this app. */
  onStatus?(status: EditorStatus): void
}

const asRecord = (descriptor: AnyDescriptor): Record<string, unknown> =>
  descriptor as unknown as Record<string, unknown>

/**
 * What the plan said it would not keep, appended to the outcome.
 *
 * A codec that re-assembles a container states honestly when the result cannot account for every
 * byte of the original. The coordinator commits it — the claim is `semantic`, not `lossy`, so it
 * asks for no confirmation — which means the only place the user can learn it is here.
 */
export function fidelityNote(
  plan: AssetEditPlan,
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): string {
  if (plan.fidelity.preservesUnknownData) return ''
  const notes = plan.fidelity.notes ?? []
  return notes.length === 0
    ? localizer.text('edit.fidelityUnknownBytes')
    : localizer.text('edit.fidelityNotes', { notes: notes.join('; ') })
}

/** A descriptor with the mutating operations taken out, for a toolbar that invokes with `null`. */
export function withoutMutatingOperations(descriptor: AnyDescriptor): AnyDescriptor {
  const record = asRecord(descriptor)
  const operations = record['operations']
  if (!Array.isArray(operations)) return descriptor
  const kept = operations.filter(
    item => (item as { mutatesSource?: unknown }).mutatesSource !== true,
  )
  if (kept.length === operations.length) return descriptor
  return { ...record, operations: kept } as unknown as AnyDescriptor
}

/**
 * The shipped operation toolbar over the read-only verbs only.
 *
 * `operationToolbar` invokes with a `null` input, which every standard read verb accepts and no
 * mutating operation does. Filtering the descriptor is the app's binding decision, not a change to
 * the component: the same module is mounted, with the operations it can honestly drive.
 */
export const nonMutatingOperationToolbar: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const mounted = await operationToolbar.mount({
      ...args,
      descriptor: withoutMutatingOperations(args.descriptor),
    })
    return {
      async update(next) {
        await mounted.update({ ...next, descriptor: withoutMutatingOperations(next.descriptor) })
      },
      unmount: () => mounted.unmount(),
    }
  },
})

export function createEditPanel(options: EditPanelOptions): ViewerModule {
  const localizer = options.localizer ?? DEFAULT_UI_LOCALIZER
  const text = localizer.text
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, text('electron.panel.edit'))
      const descriptor = asRecord(args.descriptor)
      const ports = options.portsFor(descriptor)
      const offer = editOffer(descriptor, {
        editable: ports !== undefined,
        localizer,
        ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
      })

      const chooser = element(root, 'div', { part: 'form.row' })
      element(chooser, 'label', { part: 'form.label', text: text('edit.operation') })
      const picker = element(chooser, 'select', { part: 'form.select' })
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError('no select element')
      picker.setAttribute('aria-label', text('edit.mutatingOperation'))
      const summary = element(root, 'p', { part: 'form.description' })
      const pane = element(root, 'div', { part: 'settings.pane' })
      const controls = element(root, 'div', { part: 'form.control' })
      const apply = element(controls, 'button', {
        part: 'operations.button',
        text: text('edit.apply'),
      })
      apply.setAttribute('type', 'button')
      const status = element(root, 'output', { part: 'operations.status' })
      const notes = element(root, 'div', { part: 'form.status' })

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
            text: text('edit.lastChange', { change: previous }),
          })
        }
        for (const item of offer.unsupported) {
          element(notes, 'div', {
            part: 'form.description',
            text: text('electron.edit.unsupported', {
              operation: item.operationId,
              reason: item.reason,
            }),
          })
        }
      }

      /** The controls of the selected form; rebuilt on every change of the picker. */
      const inputs = new Map<string, FieldEditorControlV1>()
      const selectedForm = (): EditOperationForm | undefined =>
        offer.forms.find(form => form.id === picker.value) ?? offer.forms[0]

      const drawFields = async (): Promise<void> => {
        await Promise.all([...inputs.values()].map(input => input.unmount?.()))
        inputs.clear()
        pane.replaceChildren()
        const form = selectedForm()
        if (form === undefined) {
          setViewerText(summary, text('edit.status.noneDrivable'))
          apply.setAttribute('disabled', '')
          return
        }
        apply.removeAttribute('disabled')
        setViewerText(summary, `${form.summary} (${form.operationId} → ${form.handlerId})`)
        for (const field of form.fields) {
          const row = element(pane, 'div', { part: 'form.row' })
          element(row, 'label', { part: 'form.label', text: field.label })
          const control = element(row, 'div', { part: 'form.control' })
          inputs.set(
            field.name,
            await mountFieldEditor(
              control,
              field,
              scope.signal,
              options.fieldEditors,
              field.editorId,
            ),
          )
          if (field.hint !== undefined) {
            element(row, 'span', { part: 'form.description', text: field.hint })
          }
        }
      }

      const run = async (): Promise<void> => {
        const form = selectedForm()
        if (form === undefined || ports === undefined) {
          say(text('edit.sessionUnavailable'), true)
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
          input = form.build(values)
        } catch (error) {
          say(
            text('edit.applyFailed', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            true,
          )
          return
        }

        const formLabel = form.label
        say(
          text('electron.edit.invoking', { operation: formLabel, handler: form.handlerId }),
          false,
        )
        let result
        try {
          result = await args.operations.invoke(form.handlerId, input, { signal: scope.signal })
        } catch (error) {
          // A codec that refuses before producing a plan rejects the call; its own words are the
          // only useful answer, so they are shown rather than a generic failure.
          say(
            text('electron.edit.codecRefused', {
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
          plan = editPlanFromOperationOutput(result.output, localizer)
        } catch (error) {
          say(error instanceof Error ? error.message : String(error), true)
          return
        }

        const applied = await ports.applyPlan(plan)
        if (applied.failed) {
          say(applied.message, true)
          return
        }
        const outcome = `${formLabel} — ${applied.message}${fidelityNote(plan, localizer)}`
        options.recordOutcome(descriptor, outcome)
        say(text('electron.edit.appliedReopening', { outcome }), false)
        if (scope.signal.aborted) return
        const reopened = await options.reopen(descriptor)
        if (!reopened && !scope.signal.aborted) {
          say(text('electron.edit.appliedReopenFailed', { outcome }), true)
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

      for (const form of offer.forms) {
        const option = element(picker, 'option', {
          text: form.label,
        })
        option.setAttribute('value', form.id)
      }
      picker.addEventListener('change', () => void drawFields())
      await drawFields()
      drawNotes()
      const declared = descriptorOperations(descriptor).filter(item => item.mutatesSource).length
      if (offer.forms.length === 0) {
        setState(root, ['degraded'])
        say(
          offer.unsupported.length === 0
            ? text('edit.status.noneDrivable')
            : text('electron.edit.noneDrivableCount', {
                unsupported: offer.unsupported.length,
                declared,
              }),
          false,
        )
      } else {
        say(text('electron.edit.formsAvailable', { forms: offer.forms.length, declared }), false)
      }

      return {
        async update() {
          // The offer is derived from the descriptor this panel was mounted for; a subject whose
          // revision moved is re-shown by the dock, which mounts the panel again.
        },
        async unmount() {
          await scope.close()
          root.remove()
        },
      }
    },
  })
}
