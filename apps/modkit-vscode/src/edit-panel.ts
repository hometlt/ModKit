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
} from '@modkitx-x3/ui/viewer'
import type { AnyDescriptor, AssetEditPlan, ViewerModule } from '@modkitx-x3/sdk'

import {
  editOffer,
  editPlanFromOperationOutput,
  invokeRefusalMessage,
  isRejected,
  type EditOperationForm,
} from './edit-operations.js'
import type { WebviewEditorPorts, WebviewEditorStatus } from './editor-ports.js'
import { descriptorOperations } from './view-policy.js'

export interface EditPanelOptions {
  portsFor(descriptor: Record<string, unknown>): WebviewEditorPorts | undefined
  reopen(descriptor: Record<string, unknown>): Promise<boolean>
  lastOutcome(descriptor: Record<string, unknown>): string | undefined
  recordOutcome(descriptor: Record<string, unknown>, outcome: string): void
  onStatus?(status: WebviewEditorStatus): void
}

const asRecord = (descriptor: AnyDescriptor): Record<string, unknown> =>
  descriptor as unknown as Record<string, unknown>

/** State the plan's own fidelity limitation beside the successful outcome. */
export function fidelityNote(plan: AssetEditPlan): string {
  if (plan.fidelity.preservesUnknownData) return ''
  const notes = plan.fidelity.notes ?? []
  return notes.length === 0
    ? ' (this rewrite does not keep bytes the format does not account for)'
    : ` (${notes.join('; ')})`
}

export function createVsCodeEditPanel(options: EditPanelOptions): ViewerModule {
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, 'Edit')
      const descriptor = asRecord(args.descriptor)
      const ports = options.portsFor(descriptor)
      const offer = editOffer(descriptor, { editable: ports !== undefined })

      const chooser = element(root, 'div', { part: 'form.row' })
      element(chooser, 'label', { part: 'form.label', text: 'Operation' })
      const picker = element(chooser, 'select', { part: 'form.select' })
      if (!(picker instanceof HTMLSelectElement)) throw new TypeError('no select element')
      picker.setAttribute('aria-label', 'Mutating operation')
      const summary = element(root, 'p', { part: 'form.description' })
      const pane = element(root, 'div', { part: 'settings.pane' })
      const actions = element(root, 'div', { part: 'form.actions' })
      const apply = element(actions, 'button', { part: 'form.button', text: 'Apply' })
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
          element(notes, 'div', { part: 'form.description', text: `Last change: ${previous}` })
        }
        for (const item of offer.unsupported) {
          element(notes, 'div', {
            part: 'form.description',
            text: `${item.operationId}: not available in this host yet — ${item.reason}`,
          })
        }
      }

      const inputs = new Map<string, HTMLInputElement>()
      const selectedForm = (): EditOperationForm | undefined =>
        offer.forms.find(item => item.id === picker.value) ?? offer.forms[0]

      const drawFields = (): void => {
        inputs.clear()
        pane.replaceChildren()
        const chosen = selectedForm()
        if (chosen === undefined) {
          setViewerText(summary, 'This subject declares no mutating operation this host can drive.')
          apply.setAttribute('disabled', '')
          return
        }
        apply.removeAttribute('disabled')
        setViewerText(summary, `${chosen.summary} (${chosen.operationId} → ${chosen.handlerId})`)
        for (const item of chosen.fields) {
          const row = element(pane, 'div', { part: 'form.row' })
          element(row, 'label', { part: 'form.label', text: item.label })
          const input = element(row, 'input', { part: 'form.input' })
          if (!(input instanceof HTMLInputElement)) continue
          input.type = 'text'
          input.name = item.name
          input.value = item.initial
          input.setAttribute('aria-label', item.label)
          if (item.hint !== undefined) input.title = item.hint
          inputs.set(item.name, input)
          if (item.hint !== undefined) {
            element(row, 'span', { part: 'form.description', text: item.hint })
          }
        }
      }

      const run = async (): Promise<void> => {
        const chosen = selectedForm()
        if (chosen === undefined || ports === undefined) {
          say('this host holds no editing arm for the file, so nothing can be applied', true)
          return
        }
        const values = new Map<string, string>()
        for (const [name, input] of inputs) values.set(name, input.value)

        let input
        try {
          input = chosen.build(values)
        } catch (error) {
          say(`cannot apply: ${error instanceof Error ? error.message : String(error)}`, true)
          return
        }

        say(`${chosen.label}: invoking ${chosen.handlerId}…`, false)
        let result
        try {
          result = await args.operations.invoke(chosen.handlerId, input, { signal: scope.signal })
        } catch (error) {
          say(
            `refused by the codec: ${error instanceof Error ? error.message : String(error)}`,
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
          plan = editPlanFromOperationOutput(result.output)
        } catch (error) {
          say(
            `the host refused the plan: ${error instanceof Error ? error.message : String(error)}`,
            true,
          )
          return
        }

        const applied = await ports.applyPlan(plan)
        if (applied.failed) {
          say(applied.message, true)
          return
        }
        const outcome = `${chosen.label} — ${applied.message}${fidelityNote(plan)}`
        options.recordOutcome(descriptor, outcome)
        say(`${outcome}; reopening the file to show it as it now is`, false)
        if (scope.signal.aborted) return
        const reopened = await options.reopen(descriptor)
        if (!reopened && !scope.signal.aborted) {
          say(`${outcome}; the tab could not be reopened, so this view is stale`, true)
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
      picker.addEventListener('change', drawFields)
      drawFields()
      drawNotes()
      const declared = descriptorOperations(descriptor).filter(item => item.mutatesSource).length
      if (offer.forms.length === 0) {
        setState(root, ['degraded'])
        say(
          offer.unsupported.length === 0
            ? 'nothing here can change this file'
            : `${offer.unsupported.length} of ${declared} mutating operation(s) declared, none drivable here`,
          false,
        )
      } else {
        say(`${offer.forms.length} form(s) over ${declared} mutating operation(s)`, false)
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
