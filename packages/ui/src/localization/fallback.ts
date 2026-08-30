import type { UiLocalizer, UiMessageCatalog, UiMessageKey, UiMessageValues } from './index.js'

/**
 * Build the small English fallback owned by one UI surface.
 *
 * Hosts normally inject a locale-aware `UiLocalizer`. Standalone consumers still need useful
 * English text, but importing the aggregate built-in catalog here would make every subpath carry
 * the vocabulary of every other viewer. Keeping the fallback beside its surface preserves both
 * behaviours without process-global locale state.
 */
export function createEnglishUiLocalizer(messages: UiMessageCatalog): UiLocalizer {
  return Object.freeze({
    locale: 'en',
    text(key: UiMessageKey, values: UiMessageValues = {}): string {
      const message = messages[key] ?? key
      return message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu, (_match, name: string) => {
        const value = values[name]
        return value === undefined ? `{${name}}` : String(value)
      })
    },
  })
}

/**
 * Add one surface's English messages underneath a host-supplied localizer.
 *
 * The wrapper is intentional even when a localizer is supplied: composed surfaces pass their
 * translator to child controls, and the child must still be able to add its own small fallback
 * catalog. A real host translation wins; returning the unknown key delegates to this surface.
 */
export function withEnglishUiFallback(
  localizer: UiLocalizer | undefined,
  messages: UiMessageCatalog,
): UiLocalizer {
  const fallback = createEnglishUiLocalizer(messages)
  if (localizer === undefined) return fallback
  return Object.freeze({
    locale: localizer.locale,
    text(key: UiMessageKey, values: UiMessageValues = {}): string {
      const translated = localizer.text(key, values)
      return translated === key ? fallback.text(key, values) : translated
    },
  })
}
