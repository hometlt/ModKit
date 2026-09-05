/**
 * The Edit panel — the one place this application offers a codec's mutating operations.
 *
 * ADR-HOST-002 Path A end to end, from a control a user can actually reach, and entirely in this
 * page:
 *
 *   pick a form → fill its fields → `operations().invoke(handlerId, input)` → the result carries
 *   `{ kind: 'edit-plan', plan }` → `editing.planFromOperation(plan output)` checks it is a plan for
 *   *this* subject at *this* revision → `coordinator.prepare(plan, { grant })` → `commit` → the tab
 *   is reopened so the stages show the file as it now is.
 *
 * Two things are different from the same panel in the Electron host, and both are simplifications
 * the browser earns: there is no RPC arm and no id indirection, because the PWA holds the host and
 * the coordinator in the page — so the plan the codec produced is the object the coordinator is
 * handed, and the host's own `planFromOperation` runs between them rather than on a far side.
 *
 * The panel is drawn only for a subject the shell holds an editing surface for, and only when at
 * least one of its mutating operations has a form: `offersEditPanel` in `./edit-operations.ts` is
 * the rule and `./inspector.ts` applies it before mounting. A subject with none gets no panel at
 * all rather than a form whose Apply is refused at the end.
 *
 * Three layers can refuse, and the panel keeps them apart because they are three different things
 * for a user to do about it: the *codec* (a path that is not in the archive), the *host* (an output
 * that is not an edit plan for this subject), and the *coordinator* (a file that moved on disk, a
 * grant without `write-source`). Each arrives with its own reason in words and its own code.
 */
import {
  createSurface,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  ViewerMountScope,
} from '@modkit/ui/viewer'
import { DEFAULT_UI_LOCALIZER, type UiLocalizer } from '@modkit/ui/localization'
import {
  mountFieldEditor,
  type FieldEditorControlV1,
  type FieldEditorRegistry,
} from '@modkit/ui/field-editor'
import { subjectCandidateProviderLease } from '@modkit/ui/selector'
import type {
  AnyDescriptor,
  AssetEditPlan,
  JsonValue,
  OperationOutput,
  ViewerModule,
} from '@modkit/sdk'

import {
  declaredMutatingOperations,
  editOffer,
  fidelityNote,
  invokeRefusalMessage,
  isRejected,
  type EditOperationForm,
} from './edit-operations.js'
import type { EditApplyStatus } from './editing.js'

/** What the panel needs of the tab's editing surface; `WebSubjectEditor` satisfies it. */
export interface EditPanelPorts {
  /** Path A's gate. Throws with the host's reason when the output is not this subject's plan. */
  planFromOperation(output: OperationOutput): AssetEditPlan
  /** Prepare and commit. Reports its own refusals to the shell as every other save does. */
  applyPlan(plan: AssetEditPlan): Promise<EditApplyStatus>
}

export interface EditPanelOptions {
  readonly localizer?: UiLocalizer
  readonly fieldEditors?: FieldEditorRegistry
  /**
   * The editing surface this tab holds, or `undefined` when this page will not write the subject.
   * In a browser that is a property of the file, not of the build — see `./editing.ts`.
   */
  portsFor(descriptor: AnyDescriptor): EditPanelPorts | undefined
  /**
   * Close and reopen the tab so its stages read the committed bytes. The subject's revision has
   * moved and a stage still showing the old one would be a lie; this host reopens rather than
   * pretending it can refresh in place, and the panel says so in its status line.
   */
  reopen(descriptor: AnyDescriptor): Promise<boolean>
  /** Remembered across the reopen, because the panel that reported it is remounted by it. */
  lastOutcome(descriptor: AnyDescriptor): string | undefined
  recordOutcome(descriptor: AnyDescriptor, outcome: string): void
  /** Reports to the shell's status line, like every other editing surface in this app. */
  onStatus?(status: EditApplyStatus): void
}

/**
 * What the panel says about the view behind it once a change has been committed.
 *
 * The subject's revision moved, so the tab that was open is showing a file that no longer exists.
 * This host reopens rather than pretending it can refresh in place, and either sentence is a fact
 * about the stage the reader is looking at — not decoration.
 */
export const REOPENED_NOTE = 'the tab was reopened, so this view is not stale'
export const NOT_REOPENED_NOTE = 'the tab could not be reopened, so a view of it may be stale'

export function createEditPanel(options: EditPanelOptions): ViewerModule {
  const localizer = options.localizer ?? DEFAULT_UI_LOCALIZER
  const text = localizer.text
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, text('web.inspector.edit'))
      const candidateLease = await subjectCandidateProviderLease(args.sources, args.slot)
      if (candidateLease !== undefined) scope.lease(candidateLease)
      const descriptor = args.descriptor
      const ports = options.portsFor(descriptor)
      const offer = editOffer(descriptor, {
        editable: ports !== undefined,
        ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
      })

      const form = element(root, 'div', { part: 'form' })
      const chooser = element(form, 'div', { part: 'form.row' })
      element(chooser, 'label', { part: 'form.label', text: text('edit.operation') })
      const picker = element(chooser, 'select', { part: 'form.select' })
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError('no select element')
      picker.setAttribute('aria-label', text('edit.mutatingOperation'))
      const summary = element(form, 'p', { part: 'form.description' })
      const pane = element(form, 'div', { part: 'form.control' })
      const actions = element(form, 'div', { part: 'form.actions' })
      const apply = element(actions, 'button', { part: 'form.button', text: text('edit.apply') })
      apply.setAttribute('type', 'button')
      const status = element(form, 'output', { part: 'form.status' })
      // A bare container: every line inside it is a `form.description`, and a part that wrapped
      // parts of the same name would be a styling hook the theme cannot tell apart.
      const notes = element(form, 'div')

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
            text: text('web.edit.unsupported', {
              operation: item.operationId,
              reason: item.reason,
            }),
          })
        }
      }

      /** The controls of the selected form; rebuilt on every change of the picker. */
      const inputs = new Map<string, FieldEditorControlV1>()
      const selectedForm = (): EditOperationForm | undefined =>
        offer.forms.find(item => item.id === picker.value) ?? offer.forms[0]

      const drawFields = async (): Promise<void> => {
        await Promise.all([...inputs.values()].map(input => input.unmount?.()))
        inputs.clear()
        pane.replaceChildren()
        const chosen = selectedForm()
        if (chosen === undefined) {
          setViewerText(summary, text('edit.status.noneDrivable'))
          apply.setAttribute('disabled', '')
          return
        }
        apply.removeAttribute('disabled')
        setViewerText(summary, `${chosen.summary} (${chosen.operationId} → ${chosen.handlerId})`)
        for (const item of chosen.fields) {
          const row = element(pane, 'div', { part: 'form.row' })
          const fieldLabel = item.label
          element(row, 'label', { part: 'form.label', text: fieldLabel })
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
          input = chosen.build(values)
        } catch (error) {
          say(
            text('edit.applyFailed', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            true,
          )
          return
        }

        const formLabel = chosen.label
        say(text('web.edit.invoking', { operation: formLabel, handler: chosen.handlerId }), false)
        let result
        try {
          result = await args.operations.invoke(chosen.handlerId, input, { signal: scope.signal })
        } catch (error) {
          // A codec that refuses before producing a plan rejects the call; its own words are the
          // only useful answer, so they are shown rather than a generic failure.
          say(
            text('web.edit.codecRefused', {
              reason: error instanceof Error ? error.message : String(error),
            }),
            true,
          )
          return
        }
        if (isRejected(result)) {
          say(invokeRefusalMessage(result), true)
          return
        }

        let plan: AssetEditPlan
        try {
          // The host's own check, not a cast: an operation declared as mutating that hands back
          // JSON, or a plan pinned to another revision, is refused here rather than several layers
          // later with a much worse message.
          plan = ports.planFromOperation(result.output)
        } catch (error) {
          say(
            text('web.edit.hostRefused', {
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
        const outcome = `${formLabel} — ${applied.message}${fidelityNote(plan)}`
        /*
         * Recorded *before* the reopen, because the reopen unmounts this panel and the one that
         * replaces it is where the user reads what just happened. The claim about the reopen is
         * part of the sentence, and corrected below the moment it turns out not to be true — a
         * "Last change" note that quietly implied a fresh view would be the same lie as a stale
         * stage.
         */
        options.recordOutcome(descriptor, `${outcome}; ${REOPENED_NOTE}`)
        say(text('web.edit.appliedReopening', { outcome }), false)
        if (scope.signal.aborted) return
        const reopened = await options.reopen(descriptor)
        if (!reopened) {
          options.recordOutcome(descriptor, `${outcome}; ${NOT_REOPENED_NOTE}`)
          if (!scope.signal.aborted) {
            say(text('web.edit.appliedReopenFailed', { outcome }), true)
          }
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
        const option = element(picker, 'option', {
          text: item.label,
        })
        option.setAttribute('value', item.id)
      }
      picker.addEventListener('change', () => void drawFields())
      await drawFields()
      drawNotes()
      const declared = declaredMutatingOperations(descriptor).length
      if (offer.forms.length === 0) {
        setState(root, ['degraded'])
        say(
          offer.unsupported.length === 0
            ? text('edit.status.noneDrivable')
            : text('web.edit.noneDrivableCount', {
                unsupported: offer.unsupported.length,
                declared,
              }),
          false,
        )
      } else {
        say(text('web.edit.formsAvailable', { forms: offer.forms.length, declared }), false)
      }

      return {
        async update() {
          // The offer is derived from the descriptor this panel was mounted for; a subject whose
          // revision moved is re-shown by the inspector, which mounts the panel again.
        },
        async unmount() {
          await scope.close()
          root.remove()
        },
      }
    },
  })
}
