/**
 * The workbench panel: what the host knows about the file in front of you.
 *
 * The diagnostics panel and the operation toolbar are not stages — their shipped contribution
 * manifests declare them `kind: 'panel'` and `kind: 'toolbar'`, in the `right-panel` and `toolbar`
 * singleton groups — so this application mounts them in the workbench's panel region rather than
 * forcing them into the centre-stage picker.
 *
 * The toolbar is also the one surface that needs a real `OperationSession`: `createCodecPreview`
 * mounts viewers without one, and rightly so. The shell owns the sessions it opened and hands the
 * live one here.
 *
 * Only non-mutating operations are offered. This host has no editing backend and no save path, and
 * the toolbar invokes with a `null` input, so the three standard read-only operations are exactly
 * what it can honestly run.
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
import { diagnosticsPanel, element, operationToolbar, setViewerText } from '@modkitx-x3/ui'

/** The standard non-mutating operations, which take no input and change nothing. */
export const NON_MUTATING_OPERATION_IDS: readonly string[] = Object.freeze([
  'view.inspect',
  'asset.validate',
  'export.raw',
])

/**
 * The same descriptor with only the operations this host will offer.
 *
 * Filtering the descriptor rather than the buttons is what keeps the toolbar honest: it renders
 * exactly what it is given, so a mutating operation is never drawn and then refused on click.
 */
export function nonMutatingDescriptor(descriptor: AnyDescriptor): AnyDescriptor {
  const operations: readonly AssetOperationDescriptor[] = descriptor.operations.filter(
    operation => !operation.mutatesSource && NON_MUTATING_OPERATION_IDS.includes(operation.id),
  )
  return { ...descriptor, operations }
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
}

export interface Inspector {
  readonly root: HTMLElement
  /** Replace what the panel is about. `undefined` clears it. */
  show(target: InspectorTarget | undefined): Promise<void>
  destroy(): Promise<void>
}

export function createInspector(document: Document): Inspector {
  const root = document.createElement('div')
  root.className = 'web-inspector'

  const heading = element(root, 'div', { part: 'viewer.status' })
  const toolbarHost = element(root, 'div', { part: 'viewer.toolbar' })
  const diagnosticsHost = document.createElement('div')
  diagnosticsHost.className = 'web-inspector-diagnostics'
  root.append(diagnosticsHost)

  let mounted: ViewerMount[] = []

  const unmountAll = async (): Promise<void> => {
    for (const mount of mounted.reverse()) await mount.unmount()
    mounted = []
    toolbarHost.replaceChildren()
    diagnosticsHost.replaceChildren()
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

  return {
    root,

    async show(target) {
      await unmountAll()
      if (target === undefined) {
        setViewerText(heading, 'No file is open.')
        return
      }
      const offered = nonMutatingDescriptor(target.descriptor)
      setViewerText(
        heading,
        `${target.label} · ${offered.operations.length} non-mutating operation(s) · ` +
          `${target.descriptor.diagnostics.length} diagnostic(s)`,
      )
      await mount(
        operationToolbar,
        toolbarHost,
        panelSlot('operations', 'toolbar'),
        target,
        offered,
      )
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
