/**
 * Help while one table value is typed: its syntax and problems under the field, and suggestions at
 * the caret.
 *
 * MK2's strings editor painted the markup as it was typed and completed tags, styles and references.
 * Both answers come from the codec (`TableActions.highlightValue` and `completeValue`); this module
 * only asks, draws and inserts, so it knows no format.
 */
import type { LanguageCompletionItem, TableValueCompletion, TableValueHighlight } from '@modkit/sdk'
import { renderValueWithSpans } from '../spans/index.js'
import { element, setViewerText } from '../viewer/index.js'

/** Quiet time after a keystroke before the codec is asked again. */
const ASSIST_DELAY_MS = 120
/** Suggestions one list shows; a codec that offers a mod's worth of styles is cut here. */
const MAX_SUGGESTIONS = 50

export interface ValueAssistOptions {
  readonly highlight?: (text: string, signal: AbortSignal) => Promise<TableValueHighlight | undefined>
  readonly complete?: (
    text: string,
    offset: number,
    signal: AbortSignal,
  ) => Promise<TableValueCompletion | undefined>
  /** Accessible name of the suggestion list. */
  readonly label: string
}

export interface ValueAssist {
  dispose(): void
}

export function attachValueAssist(
  root: HTMLElement,
  control: HTMLInputElement | HTMLTextAreaElement,
  options: ValueAssistOptions,
): ValueAssist {
  const preview = options.highlight === undefined ? undefined : element(root, 'div', { part: 'table.assist' })
  const problems = options.highlight === undefined ? undefined : element(root, 'ul', { part: 'table.assist' })
  const list = element(root, 'ul', { part: 'table.suggestions', role: 'listbox' })
  list.setAttribute('aria-label', options.label)
  list.hidden = true
  let suggestions: { from: number; to: number; items: readonly LanguageCompletionItem[] } | undefined
  let active = 0
  let pending: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const close = (): void => {
    suggestions = undefined
    list.hidden = true
    list.replaceChildren()
  }

  const mark = (): void => {
    for (const [index, option] of [...list.children].entries()) {
      option.setAttribute('aria-selected', String(index === active))
    }
  }

  /** Put one suggestion in place; a snippet's `$0` is where the caret goes. */
  const accept = (index: number): void => {
    const item = suggestions?.items[index]
    if (suggestions === undefined || item === undefined) return
    const text = control.value
    const from = Math.max(0, Math.min(suggestions.from, text.length))
    const to = Math.max(from, Math.min(suggestions.to, text.length))
    let insert = item.insertText ?? item.label
    let caret = insert.length
    if (item.insertTextFormat === 'snippet' && insert.includes('$0')) {
      caret = insert.indexOf('$0')
      insert = insert.replace('$0', '')
    }
    control.value = text.slice(0, from) + insert + text.slice(to)
    control.setSelectionRange(from + caret, from + caret)
    close()
    // The highlight follows the new text as if it had been typed.
    control.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const showSuggestions = (answer: TableValueCompletion | undefined): void => {
    const items = (answer?.items ?? []).slice(0, MAX_SUGGESTIONS)
    if (answer === undefined || items.length === 0) {
      close()
      return
    }
    suggestions = { from: answer.from, to: answer.to, items }
    active = 0
    list.replaceChildren()
    items.forEach((item, index) => {
      const option = element(list, 'li', { role: 'option' })
      setViewerText(option, item.detail === undefined ? item.label : `${item.label} — ${item.detail}`)
      option.addEventListener('mousedown', event => {
        event.preventDefault() // the focus stays in the field
        accept(index)
      })
    })
    list.hidden = false
    mark()
  }

  const showHighlight = (text: string, highlight: TableValueHighlight | undefined): void => {
    if (preview === undefined || problems === undefined) return
    preview.replaceChildren()
    renderValueWithSpans(preview, text, highlight?.spans ?? [])
    problems.replaceChildren()
    const diagnostics = highlight?.diagnostics ?? []
    for (const problem of diagnostics) {
      const line = element(problems, 'li', {})
      line.dataset['severity'] = problem.severity ?? 'error'
      setViewerText(line, problem.message, 512)
    }
    if (diagnostics.some(problem => (problem.severity ?? 'error') === 'error')) {
      control.setAttribute('aria-invalid', 'true')
    } else {
      control.removeAttribute('aria-invalid')
    }
  }

  const ask = (completing: boolean): void => {
    pending?.abort()
    const controller = new AbortController()
    pending = controller
    const text = control.value
    const offset = control.selectionStart ?? text.length
    void (async () => {
      const [highlight, completion] = await Promise.all([
        options.highlight?.(text, controller.signal).catch(() => undefined),
        completing
          ? options.complete?.(text, offset, controller.signal).catch(() => undefined)
          : undefined,
      ])
      if (controller.signal.aborted) return
      showHighlight(text, highlight)
      if (completing) showSuggestions(completion)
    })()
  }

  const onInput = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => ask(options.complete !== undefined), ASSIST_DELAY_MS)
  }

  const onKey = (raw: Event): void => {
    const event = raw as KeyboardEvent
    if (event.key === ' ' && event.ctrlKey && options.complete !== undefined) {
      event.preventDefault()
      ask(true)
      return
    }
    if (suggestions === undefined) return
    const count = suggestions.items.length
    switch (event.key) {
      case 'ArrowDown':
        active = (active + 1) % count
        mark()
        break
      case 'ArrowUp':
        active = (active + count - 1) % count
        mark()
        break
      case 'Enter':
      case 'Tab':
        accept(active)
        break
      case 'Escape':
        close()
        break
      default:
        return
    }
    // The cell reads Enter as "save" and Escape as "cancel"; with a list open they belong to it.
    event.preventDefault()
    event.stopPropagation()
  }

  control.addEventListener('input', onInput)
  control.addEventListener('keydown', onKey)
  if (options.highlight !== undefined) ask(false)
  return {
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      pending?.abort()
      control.removeEventListener('input', onInput)
      control.removeEventListener('keydown', onKey)
      preview?.remove()
      problems?.remove()
      list.remove()
    },
  }
}
