/**
 * Inspector dock — the descriptor-driven surfaces that sit beside the stage, not inside it.
 *
 * `metadataPanel`, `propertiesTable` and `diagnosticsPanel` read the descriptor; `operationToolbar`
 * and `transportViewer` also need the subject's operation session. None of them is a stage, so none
 * belongs in the tab's view picker: they describe whatever file is focused, and they stay put while
 * the user switches stages. Which viewer backs which slot is `PANEL_POLICY` in `./view-policy.ts`;
 * this file only binds the modules and mounts them.
 */
import {
  diagnosticsPanel,
  element,
  metadataPanel,
  operationToolbar,
  propertiesTable,
  setPart,
  setState,
  setViewerText,
  transportViewer,
} from '@modkitx-x3/ui'
import type { OperationSession, ViewerModule } from '@modkitx-x3/sdk'

import { mountViewer, type MountedViewer } from './mount.js'
import { applicablePanels, PANEL_POLICY } from './view-policy.js'

/** App-owned binding: policy slot id → the independently authored viewer that fills it. */
const PANEL_MODULES: Readonly<Record<string, ViewerModule>> = Object.freeze({
  operations: operationToolbar,
  transport: transportViewer,
  metadata: metadataPanel,
  properties: propertiesTable,
  diagnostics: diagnosticsPanel,
})

/** Slots that cannot be shown without an operation session. */
const NEEDS_OPERATIONS: ReadonlySet<string> = new Set(['operations', 'transport'])

export interface InspectorSubject {
  readonly path: string
  readonly descriptor: Record<string, unknown>
  dataSource(contract: string, major: number): Promise<{ readonly value: unknown }>
  /** Resolved once per subject by the caller; `undefined` when this host has none. */
  operations(): Promise<OperationSession | undefined>
}

export interface InspectorDock {
  readonly root: HTMLElement
  /** Panels currently offered for the shown subject, in policy order. */
  readonly panels: readonly string[]
  readonly activePanel: string | undefined
  show(subject: InspectorSubject | undefined): Promise<void>
  select(panelId: string): Promise<void>
  destroy(): Promise<void>
}

export function createInspectorDock(document: Document): InspectorDock {
  const root = document.createElement('aside')
  setPart(root, 'workbench.panel')
  root.setAttribute('aria-label', 'Inspector')

  const picker = element(root, 'div', { part: 'viewpicker' })
  const modes = element(picker, 'div', { part: 'viewpicker.modes', role: 'tablist' })
  const body = element(root, 'div', {})
  const status = element(root, 'output', { part: 'viewer.status' })

  let current: InspectorSubject | undefined
  let offered: readonly string[] = []
  let active: string | undefined
  let mounted: MountedViewer | undefined
  let generation = 0

  async function unmount(): Promise<void> {
    const held = mounted
    mounted = undefined
    if (held !== undefined) await held.unmount()
    body.replaceChildren()
  }

  async function draw(): Promise<void> {
    const run = (generation += 1)
    await unmount()
    const subject = current
    if (subject === undefined || active === undefined) {
      setViewerText(status, subject === undefined ? 'No file focused.' : 'No panel selected.')
      return
    }
    const module = PANEL_MODULES[active]
    if (module === undefined) {
      setViewerText(status, `no viewer is bound to panel ${active}`)
      return
    }
    const policy = PANEL_POLICY.find(item => item.id === active)
    const operations = NEEDS_OPERATIONS.has(active) ? await subject.operations() : undefined
    if (run !== generation) return
    if (NEEDS_OPERATIONS.has(active) && operations === undefined) {
      setState(root, ['degraded'])
      setViewerText(status, `${subject.path}: this host exposes no operation session.`)
      return
    }
    try {
      mounted = await mountViewer({
        module,
        container: body,
        descriptor: subject.descriptor,
        slotId: `inspector:${active}`,
        ...(policy?.contract === undefined
          ? {}
          : {
              contract: policy.contract,
              source: () => subject.dataSource(policy.contract ?? '', 1),
            }),
        ...(operations === undefined ? {} : { operations }),
      })
      setState(root, [])
      setViewerText(status, subject.path)
    } catch (error) {
      setState(root, ['error'])
      setViewerText(status, error instanceof Error ? error.message : String(error))
    }
  }

  function drawModes(): void {
    modes.replaceChildren()
    for (const id of offered) {
      const label = PANEL_POLICY.find(item => item.id === id)?.label ?? id
      const button = element(modes, 'button', { part: 'viewpicker.mode', text: label })
      button.setAttribute('type', 'button')
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', String(id === active))
      setState(button, id === active ? ['selected'] : [])
      button.addEventListener('click', () => {
        void dock.select(id)
      })
    }
  }

  const dock: InspectorDock = {
    root,
    get panels() {
      return offered
    },
    get activePanel() {
      return active
    },

    async show(subject) {
      current = subject
      offered =
        subject === undefined
          ? []
          : Object.freeze(applicablePanels(subject.descriptor).map(panel => panel.id))
      // Keep the user's chosen panel across files whenever the new subject still offers it.
      active = active !== undefined && offered.includes(active) ? active : offered[0]
      drawModes()
      await draw()
    },

    async select(panelId) {
      if (!offered.includes(panelId)) return
      active = panelId
      drawModes()
      await draw()
    },

    async destroy() {
      current = undefined
      await unmount()
      root.remove()
    },
  }
  return dock
}
