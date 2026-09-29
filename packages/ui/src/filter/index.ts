/**
 * Quick filter — MK2's `text-filter.ts` and its filter widget, carried over as one component.
 *
 * The matcher is MK2's verbatim (case / whole word / regular expression, `null` = no filter,
 * `false` = invalid expression). The widget keeps MK2's behaviour: it is only a funnel button until
 * clicked, Escape clears the text and then closes it, it closes on blur when empty, and an invalid
 * expression marks the widget instead of throwing.
 */
import { setPart, setState } from '../parts.js'
import { iconButton } from '../icons/index.js'
import type { UiLocalizer } from '../localization/index.js'
import { FILTER_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

function isWordChar(ch: string): boolean {
  return ch !== '' && /[A-Za-z0-9_]/u.test(ch)
}

function hasWordBoundary(text: string, start: number, end: number): boolean {
  return !isWordChar(text.charAt(start - 1)) && !isWordChar(text.charAt(end))
}

export interface PlainMatcher {
  readonly kind: 'plain'
  readonly needle: string
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
}

/** `null` = no filter text (matches everything); `false` = invalid regex (matches nothing). */
export type TextMatcher = PlainMatcher | RegExp | null | false

export interface FilterOptions {
  readonly text: string
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly regex: boolean
}

export function compileMatcher(
  options: FilterOptions,
  onError: (message: string) => void = () => undefined,
): TextMatcher {
  onError('')
  const { text, caseSensitive, wholeWord, regex } = options
  if (text === '') return null
  if (!regex) {
    return {
      kind: 'plain',
      needle: caseSensitive ? text : text.toLowerCase(),
      caseSensitive,
      wholeWord,
    }
  }
  try {
    const source = wholeWord ? `(?<![A-Za-z0-9_])(?:${text})(?![A-Za-z0-9_])` : text
    return new RegExp(source, caseSensitive ? 'u' : 'iu')
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Invalid regular expression')
    return false
  }
}

/**
 * The same options as one global expression, for finding and replacing: plain text is escaped, so
 * a plain replacement never reads `$1`. `null` = no text; `false` = an invalid expression.
 */
export function compilePattern(
  options: FilterOptions,
  onError: (message: string) => void = () => undefined,
): RegExp | null | false {
  const text = options.regex ? options.text : options.text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const matcher = compileMatcher({ ...options, text, regex: true }, onError)
  if (matcher instanceof RegExp) return new RegExp(matcher.source, `${matcher.flags}g`)
  return matcher === false ? false : null
}

/** True if `text` matches the compiled matcher (or there is no active filter). */
export function textMatches(text: string, matcher: TextMatcher): boolean {
  if (matcher === null) return true
  if (matcher === false) return false
  if (matcher instanceof RegExp) return matcher.test(text)
  const needle = matcher.needle
  if (needle === '') return true
  const hay = matcher.caseSensitive ? text : text.toLowerCase()
  let index = hay.indexOf(needle)
  while (index >= 0) {
    if (!matcher.wholeWord || hasWordBoundary(text, index, index + needle.length)) return true
    index = hay.indexOf(needle, index + Math.max(1, needle.length))
  }
  return false
}

export interface FilterWidgetOptions {
  readonly localizer?: UiLocalizer
  /** Toggle states to start from (the text always starts empty). */
  readonly initial?: Partial<Omit<FilterOptions, 'text'>>
  onChange(options: FilterOptions): void
}

export interface FilterWidget {
  readonly root: HTMLElement
  readonly options: FilterOptions
  matcher(): TextMatcher
  open(): void
  clear(): void
}

export function createFilterWidget(
  parent: HTMLElement,
  widgetOptions: FilterWidgetOptions,
): FilterWidget {
  const localizer = withEnglishUiFallback(widgetOptions.localizer, FILTER_FALLBACK_MESSAGES)
  const document = parent.ownerDocument
  const state = {
    text: '',
    caseSensitive: widgetOptions.initial?.caseSensitive ?? false,
    wholeWord: widgetOptions.initial?.wholeWord ?? false,
    regex: widgetOptions.initial?.regex ?? false,
  }
  let error = ''

  const root = document.createElement('div')
  setPart(root, 'filter')
  root.title = localizer.text('filter.title')
  parent.append(root)
  const opener = iconButton(root, 'filter', localizer.text('filter.title'), () => widget.open())
  setPart(opener, 'filter.opener')
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = localizer.text('filter.placeholder')
  input.setAttribute('aria-label', localizer.text('filter.title'))
  setPart(input, 'filter.input')
  root.append(input)

  const toggles = (
    [
      ['caseSensitive', 'case-sensitive', 'filter.matchCase'],
      ['wholeWord', 'whole-word', 'filter.wholeWord'],
      ['regex', 'regex', 'filter.regex'],
    ] as const
  ).map(([key, name, label]) => {
    const button = iconButton(root, name, localizer.text(label), () => {
      state[key] = !state[key]
      changed()
    })
    setPart(button, 'filter.option')
    return [key, button] as const
  })

  const matcher = (): TextMatcher =>
    compileMatcher(state, message => {
      error = message
    })

  const sync = (): void => {
    matcher()
    const open = root.dataset['open'] === 'true'
    setState(root, [
      ...(open ? (['active'] as const) : []),
      ...(error === '' ? [] : (['invalid'] as const)),
    ])
    root.title = error === '' ? localizer.text('filter.title') : error
    for (const [key, button] of toggles) button.setAttribute('aria-pressed', String(state[key]))
  }

  const changed = (): void => {
    sync()
    widgetOptions.onChange({ ...state })
  }

  const close = (): void => {
    root.dataset['open'] = 'false'
    sync()
  }

  input.addEventListener('input', () => {
    state.text = input.value
    changed()
  })
  input.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (state.text === '') close()
    else widget.clear()
  })
  root.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement) && state.text === '') close()
    }, 100)
  })

  const widget: FilterWidget = {
    root,
    get options() {
      return { ...state }
    },
    matcher,
    open() {
      root.dataset['open'] = 'true'
      sync()
      input.focus()
      input.select()
    },
    clear() {
      state.text = ''
      input.value = ''
      changed()
    },
  }
  close()
  return widget
}
