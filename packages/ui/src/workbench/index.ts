import { setPart, setState, type StateName } from '../parts.js'
import { safeViewerText } from '../viewer/index.js'

export interface WorkbenchHostState {
  readonly label: string
  readonly facilities: readonly string[]
  readonly degradedReasons?: readonly string[]
}

export interface WorkbenchOptions {
  readonly title: string
  readonly host?: WorkbenchHostState
}

export interface Workbench {
  readonly root: HTMLElement
  readonly activitybar: HTMLElement
  readonly sidebar: HTMLElement
  readonly main: HTMLElement
  readonly panel: HTMLElement
  setHostState(state: WorkbenchHostState): void
  setSidebar(content?: Node): void
  setMain(content?: Node): void
  setPanel(content?: Node): void
  dispose(): void
}

export function createWorkbench(document: Document, options: WorkbenchOptions): Workbench {
  const root = document.createElement('div')
  root.className = 'modkit-viewer modkit-workbench'
  setPart(root, 'workbench')

  const titlebar = document.createElement('header')
  titlebar.textContent = safeViewerText(options.title, 256)
  setPart(titlebar, 'workbench.titlebar')

  const activitybar = document.createElement('nav')
  activitybar.setAttribute('aria-label', 'Workbench activities')
  setPart(activitybar, 'workbench.activitybar')

  const sidebar = document.createElement('aside')
  setPart(sidebar, 'workbench.sidebar')

  const main = document.createElement('main')
  setPart(main, 'workbench.main')

  const panel = document.createElement('section')
  setPart(panel, 'workbench.panel')

  const statusbar = document.createElement('footer')
  setPart(statusbar, 'workbench.statusbar')

  const hostStatus = document.createElement('span')
  setPart(hostStatus, 'workbench.host-status')
  statusbar.append(hostStatus)
  root.append(titlebar, activitybar, sidebar, main, panel, statusbar)

  const setHostState = (state: WorkbenchHostState): void => {
    const reasons = state.degradedReasons ?? []
    hostStatus.textContent = `${safeViewerText(state.label, 128)} · ${state.facilities.length} facilities`
    hostStatus.title = reasons.length === 0 ? state.facilities.join(', ') : reasons.join('\n')
    const states: StateName[] = reasons.length === 0 ? [] : ['degraded']
    setState(hostStatus, states)
  }
  const replace = (target: HTMLElement, content?: Node): void => {
    target.replaceChildren(...(content === undefined ? [] : [content]))
  }
  setHostState(
    options.host ?? {
      label: 'Host unavailable',
      facilities: [],
      degradedReasons: ['No host profile'],
    },
  )

  return Object.freeze({
    root,
    activitybar,
    sidebar,
    main,
    panel,
    setHostState,
    setSidebar: (content?: Node) => replace(sidebar, content),
    setMain: (content?: Node) => replace(main, content),
    setPanel: (content?: Node) => replace(panel, content),
    dispose: () => root.remove(),
  })
}
