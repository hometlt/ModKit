/**
 * Workbench frame — title bar, activity bar, sidebar, main area, panel, status bar.
 *
 * **The frame carries no layout, and that is a decision rather than an omission.** This module
 * stamps the `workbench.*` parts and nothing else: `modkit-ui.css` has no geometry rules for them,
 * so every host writes its own grid (the PWA in `apps/web/app.css`, Electron in its renderer
 * stylesheet). Shipping a default here would be the friendlier answer for a new host, and it was
 * considered; it was not taken because two hosts that already have grids would then be overriding
 * a third one, and a wrong override is harder to see than an absent rule.
 *
 * The consequence a theme author must know: **geometry is not part of the styling contract.** A
 * theme may colour `[data-mk-part="workbench.sidebar"]`, but it cannot assume the sidebar is on
 * the left, or that the panel is horizontal, because the host decides both. Parts and tokens are
 * the contract; the arrangement is the application's.
 */
import { setPart, setState, type StateName } from '../parts.js'
import { safeViewerText } from '../viewer/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { WORKBENCH_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export interface WorkbenchHostState {
  readonly label: string
  readonly facilities: readonly string[]
  readonly degradedReasons?: readonly string[]
}

export interface WorkbenchOptions {
  readonly localizer?: UiLocalizer
  readonly title: string
  readonly host?: WorkbenchHostState
  /**
   * Omit application chrome when a host already provides it (for example, a VS Code editor).
   * `aside` retains only the workbench sidebar beside `main`; title, activity, panel and status
   * are never mounted in this mode.
   */
  readonly embedded?: boolean | { readonly aside?: boolean }
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
  const localizer = withEnglishUiFallback(options.localizer, WORKBENCH_FALLBACK_MESSAGES)
  const root = document.createElement('div')
  root.className = 'modkit-viewer modkit-workbench'
  setPart(root, 'workbench')
  const embedded = options.embedded !== undefined && options.embedded !== false
  const includeAside = typeof options.embedded === 'object' && options.embedded.aside === true
  if (embedded) root.classList.add('modkit-workbench--embedded')

  const titlebar = document.createElement('header')
  titlebar.textContent = safeViewerText(options.title, 256)
  setPart(titlebar, 'workbench.titlebar')

  const activitybar = document.createElement('nav')
  activitybar.setAttribute('aria-label', localizer.text('workbench.activities'))
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
  if (embedded) {
    if (includeAside) root.append(sidebar)
    root.append(main)
  } else {
    root.append(titlebar, activitybar, sidebar, main, panel, statusbar)
  }

  const setHostState = (state: WorkbenchHostState): void => {
    const reasons = state.degradedReasons ?? []
    hostStatus.textContent = localizer.text('workbench.facilities', {
      label: safeViewerText(state.label, 128),
      count: state.facilities.length,
    })
    hostStatus.title = reasons.length === 0 ? state.facilities.join(', ') : reasons.join('\n')
    const states: StateName[] = reasons.length === 0 ? [] : ['degraded']
    setState(hostStatus, states)
  }
  const replace = (target: HTMLElement, content?: Node): void => {
    target.replaceChildren(...(content === undefined ? [] : [content]))
  }
  setHostState(
    options.host ?? {
      label: localizer.text('workbench.hostUnavailable'),
      facilities: [],
      degradedReasons: [localizer.text('workbench.noHostProfile')],
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
