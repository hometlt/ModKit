/**
 * One toolbar, built the same way by every viewer that has one.
 *
 * Three viewers had grown their own — `code` a search box, `hex` an offset field, `audio` transport
 * buttons — and the tree and the table had none, which is why a strings table in MK3 offered nothing
 * beside the rows while MK2's offered filters, a tree toggle, find and replace, and a raw/preview
 * switch. Writing that set once per viewer would produce five toolbars that look alike and behave
 * differently; this is the shared one.
 *
 * What it deliberately does not do is decide *what* belongs in a toolbar. A viewer knows how to
 * render rows, not which filters a format has, so the host passes a spec and the viewer draws it.
 * That is also what lets a format contribute its own buttons without every viewer learning about it.
 *
 * Every item reports through a callback rather than mutating anything: a toggle says it was pressed,
 * and whoever owns the state decides what that means and calls back to set the new visual state.
 * A toolbar that owned state would be a second source of truth beside the model it sits above.
 */
import { element, setViewerText } from '../viewer/index.js'
import type { PartName } from '../parts.js'

/** A button with an on/off state, drawn pressed when `active`. */
export interface ToolbarToggle {
  readonly kind: 'toggle'
  readonly id: string
  readonly label: string
  /** Icon glyph or short text drawn inside the button; the label stays the accessible name. */
  readonly glyph?: string
  readonly active?: boolean
  readonly onToggle?: (active: boolean) => void
}

/**
 * A filter chip: a toggle that also carries a count.
 *
 * Separate from a toggle because a count is not decoration — "3 errors" and "errors" answer
 * different questions, and a reader deciding whether to click needs the first.
 */
export interface ToolbarChip {
  readonly kind: 'chip'
  readonly id: string
  readonly label: string
  readonly glyph?: string
  readonly count?: number
  readonly active?: boolean
  readonly onToggle?: (active: boolean) => void
}

/** A push button. */
export interface ToolbarAction {
  readonly kind: 'action'
  readonly id: string
  readonly label: string
  readonly glyph?: string
  readonly disabled?: boolean
  readonly onActivate?: () => void
}

/** A search field, reporting on input and on submit. */
export interface ToolbarSearch {
  readonly kind: 'search'
  readonly id: string
  readonly label: string
  readonly placeholder?: string
  readonly value?: string
  readonly onInput?: (value: string) => void
  /** Enter; `backwards` is Shift+Enter, as a find field steps back. */
  readonly onSubmit?: (value: string, backwards: boolean) => void
}

export interface ToolbarSeparator {
  readonly kind: 'separator'
}

/** Pushes everything after it to the far end. */
export interface ToolbarSpacer {
  readonly kind: 'spacer'
}

/** Read-only text, for a count or a status the toolbar owns. */
export interface ToolbarLabel {
  readonly kind: 'label'
  readonly id: string
  readonly text: string
}

export type ToolbarItem =
  | ToolbarToggle
  | ToolbarChip
  | ToolbarAction
  | ToolbarSearch
  | ToolbarSeparator
  | ToolbarSpacer
  | ToolbarLabel

export interface ToolbarSpec {
  /** Accessible name for the toolbar as a whole. */
  readonly label: string
  readonly items: readonly ToolbarItem[]
}

export interface ToolbarHandle {
  readonly root: HTMLElement
  /** Set a toggle's or chip's pressed state without rebuilding the toolbar. */
  setActive(id: string, active: boolean): void
  /** Set a chip's count, or clear it with `undefined`. */
  setCount(id: string, count: number | undefined): void
  setDisabled(id: string, disabled: boolean): void
  setText(id: string, text: string): void
  /** The current value of a search field. */
  value(id: string): string | undefined
  destroy(): void
}

function chipText(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} ${count}`
}

/**
 * Build a toolbar into `parent`.
 *
 * `part` names the container so a viewer that already has a declared toolbar part — `hex.toolbar`,
 * `image.toolbar` — keeps it, and everything else falls back to the shared `viewer.toolbar`. The
 * items always carry the shared `toolbar.*` parts: a theme styles a toggle once.
 */
export function createToolbar(
  parent: HTMLElement,
  spec: ToolbarSpec,
  options: { readonly part?: PartName } = {},
): ToolbarHandle {
  const root = element(parent, 'div', {
    className: 'modkit-toolbar',
    role: 'toolbar',
    part: options.part ?? 'viewer.toolbar',
  })
  root.setAttribute('aria-label', spec.label)

  const nodes = new Map<string, HTMLElement>()
  const counts = new Map<string, number | undefined>()
  const labels = new Map<string, string>()
  const cleanups: (() => void)[] = []

  for (const item of spec.items) {
    if (item.kind === 'separator') {
      const node = element(root, 'span', { part: 'toolbar.separator' })
      node.setAttribute('role', 'separator')
      node.setAttribute('aria-orientation', 'vertical')
      continue
    }
    if (item.kind === 'spacer') {
      element(root, 'span', { part: 'toolbar.spacer' })
      continue
    }
    if (item.kind === 'label') {
      const node = element(root, 'output', { part: 'toolbar.label' })
      setViewerText(node, item.text, 512)
      nodes.set(item.id, node)
      continue
    }
    if (item.kind === 'search') {
      const wrap = element(root, 'span', { part: 'toolbar.search' })
      const input = element(wrap, 'input', { part: 'toolbar.search-input' }) as HTMLInputElement
      input.type = 'search'
      input.setAttribute('aria-label', item.label)
      if (item.placeholder !== undefined) input.placeholder = item.placeholder
      if (item.value !== undefined) input.value = item.value
      const onInput = () => item.onInput?.(input.value)
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          item.onSubmit?.(input.value, event.shiftKey)
        }
      }
      input.addEventListener('input', onInput)
      input.addEventListener('keydown', onKey)
      cleanups.push(() => {
        input.removeEventListener('input', onInput)
        input.removeEventListener('keydown', onKey)
      })
      nodes.set(item.id, input)
      continue
    }

    const isChip = item.kind === 'chip'
    const button = element(root, 'button', {
      part: isChip ? 'toolbar.chip' : item.kind === 'toggle' ? 'toolbar.toggle' : 'toolbar.action',
    }) as HTMLButtonElement
    button.type = 'button'
    button.title = item.label
    button.setAttribute('aria-label', item.label)
    const text = isChip
      ? chipText(item.glyph ?? item.label, (item as ToolbarChip).count)
      : (item.glyph ?? item.label)
    setViewerText(button, text, 128)
    labels.set(item.id, item.glyph ?? item.label)

    if (item.kind === 'action') {
      button.disabled = item.disabled === true
      const onClick = () => item.onActivate?.()
      button.addEventListener('click', onClick)
      cleanups.push(() => button.removeEventListener('click', onClick))
    } else {
      /*
       * `aria-pressed` rather than a class: a toggle's state has a native expression, and a screen
       * reader announces it without the theme having to opt in.
       */
      button.setAttribute('aria-pressed', item.active === true ? 'true' : 'false')
      if (isChip) counts.set(item.id, (item as ToolbarChip).count)
      const onClick = () => {
        const next = button.getAttribute('aria-pressed') !== 'true'
        button.setAttribute('aria-pressed', next ? 'true' : 'false')
        item.onToggle?.(next)
      }
      button.addEventListener('click', onClick)
      cleanups.push(() => button.removeEventListener('click', onClick))
    }
    nodes.set(item.id, button)
  }

  return {
    root,
    setActive(id, active) {
      nodes.get(id)?.setAttribute('aria-pressed', active ? 'true' : 'false')
    },
    setCount(id, count) {
      const node = nodes.get(id)
      if (node === undefined) return
      counts.set(id, count)
      setViewerText(node, chipText(labels.get(id) ?? id, count), 128)
    },
    setDisabled(id, disabled) {
      const node = nodes.get(id)
      if (node instanceof HTMLButtonElement) node.disabled = disabled
    },
    setText(id, text) {
      const node = nodes.get(id)
      if (node !== undefined) setViewerText(node, text, 512)
    },
    value(id) {
      const node = nodes.get(id)
      return node instanceof HTMLInputElement ? node.value : undefined
    },
    destroy() {
      for (const cleanup of cleanups) cleanup()
      cleanups.length = 0
      root.remove()
    },
  }
}
