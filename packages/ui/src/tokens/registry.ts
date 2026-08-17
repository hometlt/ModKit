/**
 * Design token registry — the single authority (ADR-UI-002).
 *
 * Three tiers, one rule: components read tier 2 and tier 3, themes write tier 1 and tier 2 and
 * may override tier 3. Every tier-3 token derives from tier 2, so a theme that sets only palette
 * and semantic roles restyles every component, including ones written later.
 *
 * This module is authored. `tokens.generated.css`, `tokens.generated.ts` and the JSON token
 * contract are emitted from it by `generate.ts` and verified by `pnpm tokens:check`.
 */

export type TokenType =
  'color' | 'length' | 'number' | 'duration' | 'easing' | 'font-family' | 'shadow' | 'z-index'

export interface TokenDefinition {
  /** Dotted name; `color.bg` emits `--mk-color-bg`. */
  readonly name: string
  readonly tier: 1 | 2 | 3
  readonly type: TokenType
  /** Public tokens are part of the theme contract. Private ones are implementation detail. */
  readonly isPublic: boolean
  readonly description: string
  /** Tier 3 only: the component that owns this token. */
  readonly component?: string
  /** Tier 3 only: the tier-2 token this derives from when a theme says nothing. */
  readonly derivesFrom?: string
  /**
   * Tier 3 only: a runtime slot written by the component itself (a row depth, a scrub position).
   * It has a static default and no tier-2 origin, because it is per-instance state rather than a
   * theme value. Themes may still override the default.
   */
  readonly runtimeDefault?: string
}

export const TOKEN_CONTRACT_MAJOR = 1

const t = (
  name: string,
  tier: 1 | 2 | 3,
  type: TokenType,
  description: string,
  extra: Partial<TokenDefinition> = {},
): TokenDefinition => ({ name, tier, type, isPublic: true, description, ...extra })

// ---------------------------------------------------------------- tier 1: palette
const PALETTE_STEPS = [
  '050',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
] as const
const PALETTE_HUES = ['neutral', 'accent', 'ok', 'warn', 'error', 'info'] as const

const tier1: TokenDefinition[] = PALETTE_HUES.flatMap(hue =>
  PALETTE_STEPS.map(step => t(`palette.${hue}.${step}`, 1, 'color', `${hue} ramp step ${step}`)),
)

// ---------------------------------------------------------------- tier 2: semantic roles
const tier2: TokenDefinition[] = [
  // surfaces
  t('color.bg', 2, 'color', 'window ground behind everything'),
  t('color.surface', 2, 'color', 'default component surface'),
  t('color.raised', 2, 'color', 'surface above the default plane'),
  t('color.sunken', 2, 'color', 'inset surface such as an input well'),
  t('color.overlay', 2, 'color', 'floating surface: menu, popover, dialog'),
  t('color.scrim', 2, 'color', 'dimming layer behind a modal'),
  // text
  t('color.fg', 2, 'color', 'primary text'),
  t('color.fg-muted', 2, 'color', 'secondary text'),
  t('color.fg-subtle', 2, 'color', 'tertiary text and placeholders'),
  t('color.fg-inverse', 2, 'color', 'text on an accent fill'),
  t('color.fg-disabled', 2, 'color', 'disabled text'),
  t('color.fg-link', 2, 'color', 'hyperlink text'),
  t('color.fg-destructive', 2, 'color', 'destructive action text'),
  // lines
  t('color.border', 2, 'color', 'default separator and component border'),
  t('color.border-strong', 2, 'color', 'emphasised border'),
  t('color.separator', 2, 'color', 'hairline between list sections'),
  // interaction
  t('color.accent', 2, 'color', 'primary action fill'),
  t('color.accent-fg', 2, 'color', 'text on the accent fill'),
  t('color.accent-muted', 2, 'color', 'low-emphasis accent wash'),
  t('color.focus', 2, 'color', 'focus ring'),
  t('color.hover', 2, 'color', 'hover wash'),
  t('color.active', 2, 'color', 'pressed wash'),
  t('color.selection', 2, 'color', 'active selection fill'),
  t('color.selection-inactive', 2, 'color', 'selection fill when the surface is unfocused'),
  t('color.selection-fg', 2, 'color', 'text on a selection fill'),
  t('color.match-highlight', 2, 'color', 'search match highlight'),
  t('color.drop-target', 2, 'color', 'drag-and-drop target indicator'),
  t('color.readonly', 2, 'color', 'read-only field wash'),
  // status
  ...['ok', 'warn', 'error', 'info'].flatMap(s => [
    t(`status.${s}`, 2, 'color', `${s} indicator colour`),
    t(`status.${s}-fg`, 2, 'color', `text on a ${s} fill`),
    t(`status.${s}-bg`, 2, 'color', `${s} background wash`),
    t(`status.${s}-border`, 2, 'color', `${s} border`),
  ]),
  // scrollbars
  t('color.scrollbar-track', 2, 'color', 'scrollbar trough'),
  t('color.scrollbar-thumb', 2, 'color', 'scrollbar thumb'),
  t('color.scrollbar-thumb-hover', 2, 'color', 'scrollbar thumb, hovered'),
  t('color.scrollbar-thumb-active', 2, 'color', 'scrollbar thumb while dragging'),
  t('color.scrollbar-shadow', 2, 'color', 'hairline separating a scrolled pane from its content'),
  // canvas / GPU surfaces — these are not UI chrome and need their own roles
  t('color.canvas-bg', 2, 'color', 'canvas or WebGL scene ground'),
  t('color.canvas-grid', 2, 'color', 'scene grid lines'),
  t('color.canvas-gizmo', 2, 'color', 'scene gizmo and axis handles'),
  // Axis identity is a convention users read at a glance (X red, Y green, Z blue), so the three
  // get their own roles rather than borrowing from the categorical ramp, which a theme may reorder.
  t('color.axis-x', 2, 'color', 'X axis handle and line'),
  t('color.axis-y', 2, 'color', 'Y axis handle and line'),
  t('color.axis-z', 2, 'color', 'Z axis handle and line'),
  t('color.canvas-selection', 2, 'color', 'selected geometry outline'),
  // graph / chart categorical ramp
  ...['1', '2', '3', '4', '5', '6'].map(n =>
    t(`chart.categorical-${n}`, 2, 'color', `categorical series ${n}`),
  ),
  t('color.graph-node', 2, 'color', 'relation-graph node fill'),
  t('color.graph-edge', 2, 'color', 'relation-graph edge stroke'),
  t('color.graph-edge-dead', 2, 'color', 'unresolved reference edge'),
  // diff
  t('color.diff-added', 2, 'color', 'added line or cell wash'),
  t('color.diff-removed', 2, 'color', 'removed line or cell wash'),
  t('color.diff-changed', 2, 'color', 'changed line or cell wash'),
  // space
  ...['0', '1', '2', '3', '4', '5', '6', '7', '8'].map(n =>
    t(`space.${n}`, 2, 'length', `spacing step ${n}`),
  ),
  // radius
  ...['none', 'sm', 'md', 'lg', 'pill'].map(r =>
    t(`radius.${r}`, 2, 'length', `corner radius ${r}`),
  ),
  // type
  t('font.sans', 2, 'font-family', 'UI typeface stack'),
  t('font.mono', 2, 'font-family', 'monospace stack for IDs, code, offsets'),
  ...['xs', 'sm', 'md', 'lg', 'xl'].map(s => t(`font.size-${s}`, 2, 'length', `font size ${s}`)),
  ...['normal', 'medium', 'bold'].map(w => t(`font.weight-${w}`, 2, 'number', `font weight ${w}`)),
  ...['tight', 'normal', 'loose'].map(l => t(`line.${l}`, 2, 'number', `line height ${l}`)),
  // metrics
  t('size.row', 2, 'length', 'list and table row height'),
  t('size.control', 2, 'length', 'default control height'),
  t('size.icon', 2, 'length', 'default icon box'),
  t('size.touch', 2, 'length', 'minimum touch target'),
  t('size.scrollbar', 2, 'length', 'scrollbar thickness'),
  t('size.scrollbar-thin', 2, 'length', 'scrollbar thickness inside dense panes'),
  // layering
  ...['base', 'sticky', 'dropdown', 'overlay', 'modal', 'toast'].map(z =>
    t(`z.${z}`, 2, 'z-index', `stacking band: ${z}`),
  ),
  // motion
  ...['fast', 'normal', 'slow'].map(d =>
    t(`motion.${d}`, 2, 'duration', `transition duration ${d}`),
  ),
  t('motion.ease', 2, 'easing', 'default easing curve'),
  // elevation
  ...['1', '2', '3'].map(e => t(`elevation.${e}`, 2, 'shadow', `elevation level ${e}`)),
  t('shadow.focus-ring', 2, 'shadow', 'focus ring shadow'),
]

// ---------------------------------------------------------------- tier 3: component tokens
const c = (
  name: string,
  component: string,
  type: TokenType,
  derivesFrom: string,
  description: string,
): TokenDefinition => t(name, 3, type, description, { component, derivesFrom })

const runtime = (
  name: string,
  component: string,
  type: TokenType,
  runtimeDefault: string,
  description: string,
): TokenDefinition => t(name, 3, type, description, { component, runtimeDefault })

const tier3: TokenDefinition[] = [
  runtime('tree.indent-level', 'tree', 'number', '0', 'nesting depth of the current tree row'),
  runtime('card.grid-columns', 'card', 'number', '5', 'column count of the current card grid'),
  c('table.row-height', 'table', 'length', 'size.row', 'table row height'),
  c('table.header-bg', 'table', 'color', 'color.raised', 'table header background'),
  c('table.cell-padding-x', 'table', 'length', 'space.2', 'table cell horizontal padding'),
  c('tree.indent', 'tree', 'length', 'space.4', 'tree nesting indent per level'),
  c('tree.row-height', 'tree', 'length', 'size.row', 'tree row height'),
  c('hex.byte-gap', 'hex', 'length', 'space.1', 'gap between hex byte columns'),
  c('hex.gutter-fg', 'hex', 'color', 'color.fg-subtle', 'hex offset gutter text'),
  c('text.line-height', 'text', 'number', 'line.normal', 'text stage line height'),
  c('shell.rail-width', 'shell', 'length', 'space.8', 'default side rail width'),
  c('shell.splitter-size', 'shell', 'length', 'space.1', 'splitter hit area thickness'),
  c('toolbar.height', 'toolbar', 'length', 'size.control', 'toolbar height'),
  c('panel.padding', 'panel', 'length', 'space.3', 'panel content padding'),
  c('transport.track-height', 'transport', 'length', 'space.2', 'transport scrub track height'),
]

export const TOKENS: readonly TokenDefinition[] = Object.freeze([...tier1, ...tier2, ...tier3])

export const TOKENS_BY_NAME: ReadonlyMap<string, TokenDefinition> = new Map(
  TOKENS.map(token => [token.name, token]),
)

/** `color.fg-muted` -> `--mk-color-fg-muted` */
export function cssVariableName(tokenName: string): string {
  return `--mk-${tokenName.replace(/\./gu, '-')}`
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu
const FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla|color-mix|oklch|lab|lch)\([^;{}]*\)$/iu
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ch|%|vh|vw|vmin|vmax)$|^0$/u
const DURATION = /^(?:\d+\.?\d*|\.\d+)m?s$/u
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/u
const EASING =
  /^(?:linear|ease|ease-in|ease-out|ease-in-out|steps\([^;{}]*\)|cubic-bezier\([^;{}]*\))$/u
const SHADOW = /^(?:none|[-\w\s.,()#%/]+)$/u
const FONT_FAMILY = /^[-\w\s.,'"()]+$/u

/** Anything that could load a resource or escape the declaration is rejected outright. */
const FORBIDDEN = /url\(|expression\(|javascript:|@import|[;{}]|<|>/iu

export interface TokenValidationResult {
  readonly valid: boolean
  readonly reason?: string
}

/**
 * Validate a value against its token's declared type.
 * This is the runtime half of ADR-UI-001 C3 and the theme-value half of ADR-UI-002.
 */
export function validateTokenValue(tokenName: string, value: string): TokenValidationResult {
  const token = TOKENS_BY_NAME.get(tokenName)
  if (token === undefined) return { valid: false, reason: `unknown token: ${tokenName}` }
  if (typeof value !== 'string' || value.length === 0) {
    return { valid: false, reason: 'value must be a non-empty string' }
  }
  if (value.length > 256) return { valid: false, reason: 'value exceeds 256 characters' }
  if (FORBIDDEN.test(value)) {
    return { valid: false, reason: 'value contains a resource load or declaration escape' }
  }
  const ok = (() => {
    switch (token.type) {
      case 'color':
        return HEX.test(value) || FUNCTIONAL_COLOR.test(value) || /^[a-z-]+$/iu.test(value)
      case 'length':
        return LENGTH.test(value)
      case 'number':
        return NUMBER.test(value)
      case 'duration':
        return DURATION.test(value)
      case 'easing':
        return EASING.test(value)
      case 'font-family':
        return FONT_FAMILY.test(value)
      case 'shadow':
        return SHADOW.test(value)
      case 'z-index':
        return NUMBER.test(value)
      default:
        return false
    }
  })()
  return ok ? { valid: true } : { valid: false, reason: `value is not a valid ${token.type}` }
}
