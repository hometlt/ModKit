/**
 * Draw a value with its syntax runs, shared by every surface that shows one value.
 *
 * The tree, the table and the properties panel all display a single value, and a codec that knows
 * the grammar of that value can say which parts are what. Doing it here rather than in each widget
 * keeps one renderer and one token vocabulary; doing it per widget is how three slightly different
 * highlighters appear and then disagree.
 *
 * Nothing is guessed. A value with no spans renders as plain text, exactly as before.
 */
import type { ValueSpan } from '@modkit/sdk'
import { setPart } from '../viewer/index.js'
import { safeViewerText } from '../viewer/index.js'

/** Maximum characters rendered; a cell is not a document and a huge value must not stall a page. */
export const SPAN_TEXT_LIMIT = 4096

/**
 * Order the runs and drop the ones a surface cannot draw.
 *
 * Overlapping runs are the interesting case: a codec may report a string that contains a reference.
 * Nesting would need a tree, and a cell is one line, so the first run wins and the rest of the
 * overlap is dropped — a stable, explainable rule rather than whichever happened to be last.
 */
export function normalizeSpans(
  spans: readonly ValueSpan[],
  length: number,
): readonly ValueSpan[] {
  const ordered = [...spans]
    .filter(span => span.from >= 0 && span.to > span.from && span.from < length)
    .map(span => (span.to > length ? { ...span, to: length } : span))
    .sort((left, right) => left.from - right.from || right.to - left.to)
  const kept: ValueSpan[] = []
  let cursor = 0
  for (const span of ordered) {
    if (span.from < cursor) continue
    kept.push(span)
    cursor = span.to
  }
  return kept
}

/**
 * Render `text` into `host`, wrapping each run in an element a theme can select.
 *
 * Returns whether anything was highlighted, so a caller can tell "no grammar" from "no matches"
 * without inspecting the DOM it just built.
 */
export function renderValueWithSpans(
  host: HTMLElement,
  text: string,
  spans: readonly ValueSpan[] | undefined,
  limit = SPAN_TEXT_LIMIT,
): boolean {
  const shown = safeViewerText(text, limit)
  host.replaceChildren()
  const usable = spans === undefined ? [] : normalizeSpans(spans, shown.length)
  if (usable.length === 0) {
    host.append(host.ownerDocument.createTextNode(shown))
    return false
  }
  let cursor = 0
  for (const span of usable) {
    if (span.from > cursor) {
      host.append(host.ownerDocument.createTextNode(shown.slice(cursor, span.from)))
    }
    const run = host.ownerDocument.createElement('span')
    setPart(run, 'value.token')
    // A data attribute, not a CSS custom property: the kind selects a rule, it is not a value.
    run.dataset['mkToken'] = span.kind
    if (span.modifiers !== undefined && span.modifiers.length > 0) {
      run.dataset['mkTokenModifiers'] = span.modifiers.join(' ')
    }
    run.textContent = shown.slice(span.from, span.to)
    host.append(run)
    cursor = span.to
  }
  if (cursor < shown.length) host.append(host.ownerDocument.createTextNode(shown.slice(cursor)))
  return true
}
