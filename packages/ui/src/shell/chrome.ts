/**
 * Shell chrome — the header breadcrumb, the footer status strip and the view picker
 * that frame the MK2 viewer window.
 *
 * These are primitives. `viewer-shell` supplies slots and lifecycle; it does not own a renderer
 * (doc 06 §19), and this chrome is equally free of format knowledge: it renders whatever crumbs,
 * status items and view modes the host hands it.
 */
import { setPart, setState } from '../parts.js'
import { safeViewerText } from '../viewer/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { SHELL_CHROME_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export interface Crumb {
  readonly id: string
  readonly label: string
  /** Absent on the last crumb, which is the subject itself. */
  readonly icon?: string
}

export interface ShellHeaderOptions {
  readonly localizer?: UiLocalizer
  readonly crumbs: readonly Crumb[]
  /**
   * Archive paths get deep. Beyond this many segments the middle collapses behind an expander,
   * keeping the root and the tail — the two ends anyone actually navigates by — always visible.
   */
  readonly maximumCrumbs?: number
  onNavigate?(crumb: Crumb): void
}

export interface ShellHeader {
  readonly root: HTMLElement
  update(crumbs: readonly Crumb[]): void
}

export function createShellHeader(document: Document, options: ShellHeaderOptions): ShellHeader {
  const localizer = withEnglishUiFallback(options.localizer, SHELL_CHROME_FALLBACK_MESSAGES)
  const root = document.createElement('header')
  root.className = 'modkit-shell__header'
  setPart(root, 'shell.header')

  const nav = document.createElement('nav')
  nav.className = 'modkit-shell__breadcrumb'
  nav.setAttribute('aria-label', localizer.text('shell.subjectPath'))
  setPart(nav, 'shell.breadcrumb')
  root.append(nav)

  const maximum = options.maximumCrumbs ?? 5
  let expanded = false

  const renderCrumb = (crumb: Crumb, last: boolean): HTMLElement => {
    const node = document.createElement(last ? 'span' : 'button')
    node.className = 'modkit-shell__crumb'
    setPart(node, 'shell.crumb')
    node.title = crumb.label
    if (last) {
      node.setAttribute('aria-current', 'page')
      setState(node, ['active'])
    } else {
      ;(node as HTMLButtonElement).type = 'button'
      node.addEventListener('click', () => options.onNavigate?.(crumb))
    }
    if (crumb.icon !== undefined) {
      const icon = document.createElement('span')
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = safeViewerText(crumb.icon, 4)
      setPart(icon, 'shell.crumb-icon')
      node.append(icon)
    }
    const label = document.createElement('span')
    label.textContent = safeViewerText(crumb.label, 256)
    node.append(label)
    return node
  }

  const update = (crumbs: readonly Crumb[]): void => {
    nav.replaceChildren()
    const collapse = !expanded && crumbs.length > maximum
    const shown = collapse
      ? [crumbs[0] as Crumb, ...crumbs.slice(crumbs.length - (maximum - 1))]
      : crumbs

    shown.forEach((crumb, index) => {
      if (collapse && index === 1) {
        const more = document.createElement('button')
        more.type = 'button'
        more.className = 'modkit-shell__crumb'
        more.textContent = '…'
        more.title = localizer.text('shell.hiddenSegments', {
          count: crumbs.length - maximum + 1,
        })
        more.setAttribute('aria-label', more.title)
        setPart(more, 'shell.crumb-more')
        more.addEventListener('click', () => {
          expanded = true
          update(crumbs)
        })
        nav.append(more)
      }
      nav.append(renderCrumb(crumb, index === shown.length - 1))
    })
  }

  update(options.crumbs)
  return { root, update }
}

export interface StatusItem {
  readonly id: string
  readonly text: string
  readonly title?: string
  readonly severity?: 'ok' | 'warn' | 'error'
  readonly align?: 'start' | 'end'
}

export interface ShellFooter {
  readonly root: HTMLElement
  update(items: readonly StatusItem[]): void
}

export function createShellFooter(
  document: Document,
  items: readonly StatusItem[] = [],
): ShellFooter {
  const root = document.createElement('footer')
  root.className = 'modkit-shell__footer'
  root.setAttribute('role', 'status')
  setPart(root, 'shell.footer')

  const start = document.createElement('div')
  start.className = 'modkit-shell__footer-start'
  setPart(start, 'shell.footer-start')
  const end = document.createElement('div')
  end.className = 'modkit-shell__footer-end'
  setPart(end, 'shell.footer-end')
  root.append(start, end)

  const update = (next: readonly StatusItem[]): void => {
    start.replaceChildren()
    end.replaceChildren()
    for (const item of next) {
      const node = document.createElement('span')
      node.className = 'modkit-shell__status-item'
      node.textContent = safeViewerText(item.text, 256)
      if (item.title !== undefined) node.title = item.title
      if (item.severity !== undefined) node.dataset['severity'] = item.severity
      setPart(node, 'shell.status-item')
      ;(item.align === 'end' ? end : start).append(node)
    }
  }

  update(items)
  return { root, update }
}

export interface ViewMode {
  readonly id: string
  /** Short glyph shown in the segmented control. */
  readonly glyph: string
  readonly title: string
}

export interface ViewPickerOptions {
  readonly localizer?: UiLocalizer
  /** Segmented icon buttons, top-left in MK2. */
  readonly modes: readonly ViewMode[]
  readonly activeMode?: string
  /** Named viewers for the same subject, the top-right select in MK2. */
  readonly viewers?: readonly { readonly id: string; readonly label: string }[]
  readonly activeViewer?: string
  onMode?(id: string): void
  onViewer?(id: string): void
}

export interface ViewPicker {
  readonly root: HTMLElement
  setMode(id: string): void
}

export function createViewPicker(document: Document, options: ViewPickerOptions): ViewPicker {
  const localizer = withEnglishUiFallback(options.localizer, SHELL_CHROME_FALLBACK_MESSAGES)
  const root = document.createElement('div')
  root.className = 'modkit-viewpicker'
  setPart(root, 'viewpicker')

  const modes = document.createElement('div')
  modes.className = 'modkit-viewpicker__modes'
  modes.setAttribute('role', 'group')
  modes.setAttribute('aria-label', localizer.text('shell.viewMode'))
  setPart(modes, 'viewpicker.modes')
  root.append(modes)

  const buttons = new Map<string, HTMLButtonElement>()
  for (const mode of options.modes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'modkit-viewpicker__mode'
    button.textContent = safeViewerText(mode.glyph, 4)
    button.title = mode.title
    button.setAttribute('aria-label', mode.title)
    button.setAttribute('aria-pressed', 'false')
    setPart(button, 'viewpicker.mode')
    button.addEventListener('click', () => {
      setMode(mode.id)
      options.onMode?.(mode.id)
    })
    modes.append(button)
    buttons.set(mode.id, button)
  }

  function setMode(id: string): void {
    for (const [key, button] of buttons) {
      const on = key === id
      button.setAttribute('aria-pressed', String(on))
      setState(button, on ? ['active'] : [])
    }
  }

  if (options.viewers !== undefined && options.viewers.length > 0) {
    const select = document.createElement('select')
    select.className = 'modkit-viewpicker__select'
    select.setAttribute('aria-label', localizer.text('shell.viewer'))
    setPart(select, 'viewpicker.select')
    for (const viewer of options.viewers) {
      const option = document.createElement('option')
      option.value = viewer.id
      option.textContent = safeViewerText(viewer.label, 128)
      select.append(option)
    }
    if (options.activeViewer !== undefined) select.value = options.activeViewer
    select.addEventListener('change', () => options.onViewer?.(select.value))
    root.append(select)
  }

  setMode(options.activeMode ?? options.modes[0]?.id ?? '')
  return { root, setMode }
}
