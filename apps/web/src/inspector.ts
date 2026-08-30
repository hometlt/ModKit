/**
 * The workbench panel: what the host knows about the file in front of you, and what it can change.
 *
 * The diagnostics panel and the operation toolbar are not stages — their shipped contribution
 * manifests declare them `kind: 'panel'` and `kind: 'toolbar'`, in the `right-panel` and `toolbar`
 * singleton groups — so this application mounts them in the workbench's panel region rather than
 * forcing them into the centre-stage picker. The Edit panel joins them there for the same reason:
 * it is chrome beside the file, not a way of looking at it.
 *
 * The toolbar is also the one surface that needs a real `OperationSession`: `createCodecPreview`
 * mounts viewers without one, and rightly so. The shell owns the sessions it opened and hands the
 * live one here.
 *
 * **Which operations reach which surface.** The shipped `operationToolbar` invokes with a `null`
 * input and now skips mutating operations itself. This app's filter is therefore not a second
 * mutating rule, it is the `null`-input rule: `view.inspect`, `asset.validate` and `export.raw` are
 * the standard verbs that take no input, and a codec's own operations (`media.seek`, an archive's
 * `container.extract`) take one this toolbar does not collect. They are named in the heading rather
 * than silently dropped. The *mutating* ones are the Edit panel's, which is given the whole
 * descriptor — filtering what the panel is shown would be this app contradicting itself.
 */
import type {
  AnyDescriptor,
  AssetOperationDescriptor,
  OperationSession,
  PresentationSlot,
  ViewerMount,
  ViewerModule,
  ViewerSources,
} from '@modkitx-x3/sdk'
import { presentationSlotId } from '@modkitx-x3/sdk'
import { diagnosticsPanel, operationToolbar } from '@modkitx-x3/ui/panels'
import { element, setViewerText } from '@modkitx-x3/ui/viewer'
import { DEFAULT_UI_LOCALIZER, type UiLocalizer } from '@modkitx-x3/ui/localization'

import { declaredMutatingOperations, editOffer } from './edit-operations.js'

/** The standard non-mutating operations, which take no input and change nothing. */
export const NON_MUTATING_OPERATION_IDS: readonly string[] = Object.freeze([
  'view.inspect',
  'asset.validate',
  'export.raw',
])

/** True for an operation the shipped toolbar can honestly drive with the `null` input it sends. */
const drivableWithNullInput = (operation: AssetOperationDescriptor): boolean =>
  !operation.mutatesSource && NON_MUTATING_OPERATION_IDS.includes(operation.id)

/**
 * The same descriptor with only the operations this host will offer in the toolbar.
 *
 * Filtering the descriptor rather than the buttons is what keeps the toolbar honest: it renders
 * exactly what it is given, so an operation whose input this app does not collect is never drawn
 * and then refused on click.
 */
export function nonMutatingDescriptor(descriptor: AnyDescriptor): AnyDescriptor {
  const operations: readonly AssetOperationDescriptor[] =
    descriptor.operations.filter(drivableWithNullInput)
  return { ...descriptor, operations }
}

/**
 * Non-mutating operations the toolbar was not given, because they take an input.
 *
 * Named rather than hidden: "this codec has an operation you cannot reach from here" is
 * information, and a count of buttons that silently disagrees with the descriptor is not.
 */
export function declinedNonMutatingOperations(
  descriptor: AnyDescriptor,
): readonly AssetOperationDescriptor[] {
  return descriptor.operations.filter(
    operation => !operation.mutatesSource && !drivableWithNullInput(operation),
  )
}

/** Neither panel consumes a data source; this makes the fact explicit instead of passing a stub. */
const noSources: ViewerSources = {
  async get() {
    throw new TypeError('the inspector panels consume no data source')
  },
  async getUnknown() {
    throw new TypeError('the inspector panels consume no data source')
  },
}

function panelSlot(slotId: string, kind: PresentationSlot['kind']): PresentationSlot {
  return {
    slotId: presentationSlotId(slotId),
    kind,
    contributionId: 'org.modkitx.app.web/inspector',
    extensionId: 'org.modkitx.app.web',
    priority: 100,
    bindings: [],
  }
}

export interface InspectorTarget {
  readonly label: string
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  /**
   * Whether this page holds an editing surface for the subject — `describeEditability` said yes
   * *and* the arm produced one. The Edit panel is offered on this plus a form for at least one of
   * the subject's mutating operations, and on nothing else.
   */
  readonly editable: boolean
  /** Why the subject is or is not editable here, in the words the host rail already shows. */
  readonly editNote?: string
}

export interface InspectorOptions {
  readonly localizer?: UiLocalizer
  /**
   * The Edit panel module, mounted only for a subject this host can honestly offer one for.
   * Absent means this build ships no mutating surface at all, which is a decision for the shell.
   */
  readonly editPanel?: ViewerModule
}

export interface Inspector {
  readonly root: HTMLElement
  /** Replace what the panel is about. `undefined` clears it. */
  show(target: InspectorTarget | undefined): Promise<void>
  destroy(): Promise<void>
}

export function createInspector(document: Document, options: InspectorOptions = {}): Inspector {
  const text = (options.localizer ?? DEFAULT_UI_LOCALIZER).text
  const root = document.createElement('div')
  root.className = 'web-inspector'
  root.setAttribute('aria-label', text('web.inspector.label'))

  const heading = element(root, 'div', { part: 'viewer.status' })
  // A bare container: each line inside is its own `form.description`, and a part wrapping parts of
  // the same name would be a styling hook a theme cannot tell apart.
  const declined = element(root, 'div')
  const toolbarHost = element(root, 'div', { part: 'viewer.toolbar' })
  const editHost = document.createElement('div')
  editHost.className = 'web-inspector-edit'
  const diagnosticsHost = document.createElement('div')
  diagnosticsHost.className = 'web-inspector-diagnostics'
  root.append(editHost, diagnosticsHost)

  let mounted: ViewerMount[] = []

  const unmountAll = async (): Promise<void> => {
    for (const mount of mounted.reverse()) await mount.unmount()
    mounted = []
    toolbarHost.replaceChildren()
    editHost.replaceChildren()
    diagnosticsHost.replaceChildren()
    declined.replaceChildren()
  }

  const mount = async (
    module: ViewerModule,
    container: HTMLElement,
    slot: PresentationSlot,
    target: InspectorTarget,
    descriptor: AnyDescriptor,
  ): Promise<void> => {
    mounted.push(
      await module.mount({
        container,
        descriptor,
        slot,
        sources: noSources,
        operations: target.operations,
      }),
    )
  }

  /** One sentence per operation this panel declines to offer, and why. */
  const drawDeclined = (target: InspectorTarget): void => {
    const lines: string[] = []
    const needInput = declinedNonMutatingOperations(target.descriptor)
    if (needInput.length > 0) {
      lines.push(
        text('web.inspector.needInput', {
          operations: needInput.map(operation => operation.id).join(', '),
        }),
      )
    }
    const mutating = declaredMutatingOperations(target.descriptor)
    if (mutating.length > 0 && !target.editable) {
      lines.push(
        text('web.inspector.noEdit', {
          operations: mutating.map(operation => operation.id).join(', '),
          reason: target.editNote ?? text('web.inspector.noWritableHandle'),
        }),
      )
    }
    const offer = editOffer(target.descriptor, { editable: target.editable })
    if (offer.forms.length === 0) {
      for (const item of offer.unsupported) {
        lines.push(
          text('web.inspector.noForm', { operation: item.operationId, reason: item.reason }),
        )
      }
    }
    for (const line of lines) element(declined, 'p', { part: 'form.description', text: line })
  }

  return {
    root,

    async show(target) {
      await unmountAll()
      if (target === undefined) {
        setViewerText(heading, text('web.inspector.noFile'))
        return
      }
      const offered = nonMutatingDescriptor(target.descriptor)
      const offer = editOffer(target.descriptor, { editable: target.editable })
      setViewerText(
        heading,
        text('web.inspector.summary', {
          label: target.label,
          read: offered.operations.length,
          forms: offer.forms.length,
          write: declaredMutatingOperations(target.descriptor).length,
          diagnostics: target.descriptor.diagnostics.length,
        }),
      )
      drawDeclined(target)
      await mount(
        operationToolbar,
        toolbarHost,
        panelSlot('operations', 'toolbar'),
        target,
        offered,
      )
      /*
       * The offer rule, applied once, here: editable *and* at least one mutating operation this app
       * has a form for. The panel checks it again from its own ports — a panel that trusted its
       * host to have checked would be a panel that draws a form when the host is wrong.
       */
      if (options.editPanel !== undefined && offer.forms.length > 0) {
        await mount(
          options.editPanel,
          editHost,
          panelSlot('edit', 'panel'),
          target,
          target.descriptor,
        )
      }
      await mount(
        diagnosticsPanel,
        diagnosticsHost,
        panelSlot('diagnostics', 'panel'),
        target,
        target.descriptor,
      )
    },

    async destroy() {
      await unmountAll()
      root.remove()
    },
  }
}
