/**
 * SearchField — the first PR3 primitive.
 *
 * A primitive, not a viewer contribution: it has no manifest, no ABI and no traits. Consumers
 * import it. Its filter model is MK2's, ported in `../search/matcher.ts`: case-sensitive,
 * whole-word and regular-expression toggles, with an invalid expression matching nothing and
 * reporting itself rather than throwing.
 */
import {
  compileSearch,
  matchRanges,
  type CompiledSearch,
  type SearchMode,
  type SearchOptions,
} from '../search/matcher.js'
import { setPart, setState, type StateName } from '../parts.js'

export interface SearchFieldState {
  readonly query: string
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly mode: SearchMode
  readonly compiled: CompiledSearch
}

export interface SearchFieldOptions {
  readonly label?: string
  readonly placeholder?: string
  /** Show the glob toggle. Off by default; name filters (archive entries) turn it on. */
  readonly allowGlob?: boolean
  readonly initial?: Partial<SearchOptions> & { readonly query?: string }
  /** Debounce in ms; 0 disables. Long lists want this, small ones do not. */
  readonly debounceMs?: number
  onChange(state: SearchFieldState): void
  /** Optional: supply the current corpus so the field can report a live match count. */
  countMatches?(state: SearchFieldState): number | undefined
  onNavigate?(direction: -1 | 1): void
}

export interface SearchField {
  readonly root: HTMLElement
  readonly state: SearchFieldState
  /** Re-evaluate the status line, e.g. after the corpus changed underneath. */
  refresh(): void
  focus(): void
  destroy(): void
}

interface ToggleSpec {
  readonly id: string
  readonly label: string
  readonly title: string
}

const TOGGLES: readonly ToggleSpec[] = [
  { id: 'case', label: 'Aa', title: 'Match case' },
  { id: 'word', label: 'ab', title: 'Match whole word' },
  { id: 'regex', label: '.*', title: 'Use regular expression' },
]

const GLOB_TOGGLE: ToggleSpec = { id: 'glob', label: '*', title: 'Use glob pattern' }

export function createSearchField(document: Document, options: SearchFieldOptions): SearchField {
  const root = document.createElement('div')
  root.className = 'modkit-search'
  setPart(root, 'search')
  root.setAttribute('role', 'search')

  const input = document.createElement('input')
  input.type = 'search'
  input.className = 'modkit-search__input'
  input.placeholder = options.placeholder ?? 'Filter…'
  input.setAttribute('aria-label', options.label ?? 'Filter')
  input.value = options.initial?.query ?? ''
  setPart(input, 'search.input')
  root.append(input)

  const toggleBar = document.createElement('div')
  toggleBar.className = 'modkit-search__toggles'
  setPart(toggleBar, 'search.toggles')
  toggleBar.setAttribute('role', 'group')
  toggleBar.setAttribute('aria-label', 'Filter options')
  root.append(toggleBar)

  const specs = options.allowGlob === true ? [...TOGGLES, GLOB_TOGGLE] : TOGGLES
  const buttons = new Map<string, HTMLButtonElement>()
  for (const spec of specs) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'modkit-search__toggle'
    button.textContent = spec.label
    button.title = spec.title
    button.setAttribute('aria-label', spec.title)
    button.setAttribute('aria-pressed', 'false')
    setPart(button, 'search.toggle')
    toggleBar.append(button)
    buttons.set(spec.id, button)
  }

  const status = document.createElement('output')
  status.className = 'modkit-search__status'
  setPart(status, 'search.status')
  root.append(status)

  const message = document.createElement('p')
  message.className = 'modkit-search__message'
  setPart(message, 'search.message')
  root.append(message)

  let nav: HTMLElement | undefined
  if (options.onNavigate !== undefined) {
    nav = document.createElement('div')
    nav.className = 'modkit-search__nav'
    setPart(nav, 'search.nav')
    for (const [label, direction, title] of [
      ['‹', -1, 'Previous match'],
      ['›', 1, 'Next match'],
    ] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.title = title
      button.setAttribute('aria-label', title)
      button.addEventListener('click', () => options.onNavigate?.(direction))
      nav.append(button)
    }
    root.append(nav)
  }

  let caseSensitive = options.initial?.caseSensitive ?? false
  let wholeWord = options.initial?.wholeWord ?? false
  let mode: SearchMode = options.initial?.mode ?? 'plain'

  const syncToggleUi = (): void => {
    buttons.get('case')?.setAttribute('aria-pressed', String(caseSensitive))
    buttons.get('word')?.setAttribute('aria-pressed', String(wholeWord))
    buttons.get('regex')?.setAttribute('aria-pressed', String(mode === 'regex'))
    buttons.get('glob')?.setAttribute('aria-pressed', String(mode === 'glob'))
    for (const [id, button] of buttons) {
      const pressed = button.getAttribute('aria-pressed') === 'true'
      setState(button, pressed ? ['active'] : [])
      // Whole-word is meaningless for glob patterns; disable rather than silently ignore it.
      if (id === 'word') button.disabled = mode === 'glob'
    }
  }

  let current: SearchFieldState = buildState()

  function buildState(): SearchFieldState {
    const query = input.value
    return {
      query,
      caseSensitive,
      wholeWord,
      mode,
      compiled: compileSearch(query, { caseSensitive, wholeWord, mode }),
    }
  }

  function render(): void {
    const compiled = current.compiled
    const invalid = compiled.kind === 'invalid'
    message.textContent = compiled.kind === 'invalid' ? compiled.message : ''
    const count = options.countMatches?.(current)
    const states: StateName[] = []
    if (invalid) states.push('invalid')
    if (!invalid && count === 0 && compiled.kind !== 'empty') states.push('no-match')
    setState(root, states)
    input.setAttribute('aria-invalid', String(invalid))
    status.textContent = invalid
      ? 'invalid'
      : compiled.kind === 'empty' || count === undefined
        ? ''
        : count === 1
          ? '1 match'
          : `${count} matches`
    if (nav !== undefined) {
      for (const button of nav.querySelectorAll('button')) {
        button.disabled = invalid || count === undefined || count === 0
      }
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const emit = (): void => {
    current = buildState()
    render()
    options.onChange(current)
  }
  const schedule = (): void => {
    const delay = options.debounceMs ?? 0
    if (delay <= 0) {
      emit()
      return
    }
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(emit, delay)
  }

  input.addEventListener('input', schedule)
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      options.onNavigate?.(event.shiftKey ? -1 : 1)
    }
    if (event.key === 'Escape' && input.value !== '') {
      event.preventDefault()
      input.value = ''
      emit()
    }
  })

  buttons.get('case')?.addEventListener('click', () => {
    caseSensitive = !caseSensitive
    syncToggleUi()
    emit()
  })
  buttons.get('word')?.addEventListener('click', () => {
    wholeWord = !wholeWord
    syncToggleUi()
    emit()
  })
  buttons.get('regex')?.addEventListener('click', () => {
    mode = mode === 'regex' ? 'plain' : 'regex'
    syncToggleUi()
    emit()
  })
  buttons.get('glob')?.addEventListener('click', () => {
    mode = mode === 'glob' ? 'plain' : 'glob'
    syncToggleUi()
    emit()
  })

  syncToggleUi()
  render()

  return {
    root,
    get state() {
      return current
    },
    refresh: render,
    focus: () => input.focus(),
    destroy: () => {
      if (timer !== undefined) clearTimeout(timer)
      root.remove()
    },
  }
}

export { matchRanges }
