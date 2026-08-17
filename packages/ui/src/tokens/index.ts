/**
 * Token runtime — the only sanctioned way to set a dynamic style value (ADR-UI-001 C3).
 *
 * Components never touch `style` attributes (C1) and never inject stylesheets (C2). Continuous
 * values travel as validated `--mk-*` custom properties on an element the component owns, and are
 * consumed by predeclared rules in the shipped stylesheet.
 *
 * Direct CSS properties such as `element.style.paddingLeft` are deliberately not exposed here:
 * they pass in Chromium but are outside the accepted contract.
 */

import { TOKENS_BY_NAME, cssVariableName, validateTokenValue } from './registry.js'
import type { TokenName } from './generated.js'

export type { TokenName } from './generated.js'
export { TOKEN_NAMES, TOKEN_CONTRACT_MAJOR } from './generated.js'
export {
  TOKENS,
  TOKENS_BY_NAME,
  cssVariableName,
  validateTokenValue,
  type TokenDefinition,
  type TokenType,
  type TokenValidationResult,
} from './registry.js'
export {
  PALETTES,
  PALETTES_BY_ID,
  type Palette,
  type ThemeId,
  type Appearance,
} from './palettes.js'

export const THEME_ATTRIBUTE = 'data-mk-theme'
export const DENSITY_ATTRIBUTE = 'data-mk-density'

export type Density = 'compact' | 'comfortable'

function requireElement(value: unknown): HTMLElement {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('style' in value) ||
    typeof (value as { style?: unknown }).style !== 'object'
  ) {
    throw new TypeError('token target must be a DOM element')
  }
  return value as HTMLElement
}

/**
 * Set a dynamic token value on an owned element.
 * Throws when the token is unregistered or the value fails its declared type — an invalid value
 * must never reach the CSSOM.
 */
export function setToken(element: unknown, name: TokenName, value: string): void {
  const target = requireElement(element)
  const result = validateTokenValue(name, value)
  if (!result.valid) {
    throw new TypeError(`invalid value for token ${name}: ${result.reason ?? 'unknown reason'}`)
  }
  target.style.setProperty(cssVariableName(name), value)
}

/** Remove a previously set dynamic token, falling back to the stylesheet default. */
export function clearToken(element: unknown, name: TokenName): void {
  const target = requireElement(element)
  if (!TOKENS_BY_NAME.has(name)) throw new TypeError(`unknown token: ${name}`)
  target.style.removeProperty(cssVariableName(name))
}

/** Read the resolved value of a token as the browser computes it. */
export function readToken(element: unknown, name: TokenName): string {
  const target = requireElement(element)
  if (!TOKENS_BY_NAME.has(name)) throw new TypeError(`unknown token: ${name}`)
  const view = target.ownerDocument?.defaultView
  if (view === null || view === undefined) return ''
  return view.getComputedStyle(target).getPropertyValue(cssVariableName(name)).trim()
}

/** Stamp an explicit theme choice. Omitting the id restores the `prefers-color-scheme` default. */
export function applyTheme(root: unknown, theme?: string): void {
  const target = requireElement(root)
  if (theme === undefined) target.removeAttribute(THEME_ATTRIBUTE)
  else target.setAttribute(THEME_ATTRIBUTE, theme)
}

export function applyDensity(root: unknown, density: Density): void {
  requireElement(root).setAttribute(DENSITY_ATTRIBUTE, density)
}
