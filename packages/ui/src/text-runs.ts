import { isGameTemplateTextRun, type GameTemplateTextRun } from '@modkit/sdk/templates'
import { setPart, type PartName } from './parts.js'
import { setViewerText } from './viewer/index.js'

/** A run's colour reaches CSS only as hex: `#rrggbb`, or `#rrggbbaa` for a translucent one. */
const RUN_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu

/** The runs a value holds — text a producer already styled — or `undefined` for any other value. */
export function textRunsOf(value: unknown): readonly GameTemplateTextRun[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(isGameTemplateTextRun)
    ? value
    : undefined
}

/**
 * Text a producer already styled, appended to `target`: a table cell, a card value. Text goes in
 * through `textContent` and a colour only as hex (`#rrggbb`, `#rrggbbaa`); an image is a named slot
 * (its name in a span) that the host's pixels may fill, and an unresolved run is marked with why.
 */
export function appendTextRuns(
  target: HTMLElement,
  runs: readonly GameTemplateTextRun[],
  parts: { readonly asset: PartName; readonly unresolved: PartName },
): void {
  const document = target.ownerDocument
  for (const run of runs) {
    if (run.asset !== undefined) {
      const slot = document.createElement('span')
      setPart(slot, parts.asset)
      slot.dataset['asset'] = run.asset
      slot.title = run.asset
      const name = document.createElement('span')
      setViewerText(name, run.asset.split(/[\\/]/u).pop() ?? run.asset)
      slot.append(name)
      target.append(slot)
      continue
    }
    run.text.split('\n').forEach((line, index) => {
      if (index > 0) target.append(document.createElement('br'))
      if (line === '') return
      const span = document.createElement('span')
      setViewerText(span, line)
      if (run.color !== undefined && RUN_COLOR.test(run.color)) span.style.color = run.color
      if (run.bold === true) span.style.fontWeight = 'bold'
      if (run.italic === true) span.style.fontStyle = 'italic'
      if (run.underline === true) span.style.textDecoration = 'underline'
      // A style sheet's glyph height, relative to a 16-unit body and kept readable in a row.
      if (run.size !== undefined) {
        span.style.fontSize = `${Math.min(2, Math.max(0.75, run.size / 16))}em`
      }
      if (run.unresolved !== undefined) {
        setPart(span, parts.unresolved)
        span.title = run.unresolved
      }
      target.append(span)
    })
  }
}
