/**
 * The viewer preferences the extension keeps for its pages: the media shell's layout, recent
 * colours, loop. A webview has an origin of its own, so its `localStorage` ends with its tab; the
 * pages send each change here and get them all back in their bootstrap.
 */

/** The global-state key holding them, one object of preference key → JSON value. */
export const UI_PREFERENCES_KEY = 'modkit.uiPreferences'

const MAXIMUM_KEYS = 64
const MAXIMUM_VALUE_BYTES = 16 * 1024

/**
 * The stored preferences with `key` set, or undefined when the page asked to keep something it
 * may not: a malformed key or a value that is not small JSON. The oldest keys go past the limit.
 */
export function withUiPreference(
  stored: unknown,
  key: unknown,
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof key !== 'string' || !/^[A-Za-z][\w.-]{0,63}$/u.test(key)) return undefined
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    return undefined
  }
  if (text === undefined || text.length > MAXIMUM_VALUE_BYTES) return undefined
  const next: Record<string, unknown> =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {}
  delete next[key]
  next[key] = JSON.parse(text) as unknown
  const keys = Object.keys(next)
  for (const old of keys.slice(0, Math.max(0, keys.length - MAXIMUM_KEYS))) delete next[old]
  return next
}
