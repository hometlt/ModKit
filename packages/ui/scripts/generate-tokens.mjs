/**
 * Emits the token artifacts from the authored registry (ADR-UI-002).
 *
 *   node scripts/generate-tokens.mjs            write
 *   node scripts/generate-tokens.mjs --check    verify current (CI)
 *
 * Outputs:
 *   src/styles/tokens.generated.css   custom-property defaults + theme blocks + forced-colors
 *   src/tokens/generated.ts           token-name union and array for type-safe component code
 *   generated/token-contract.v1.json  checkable contract consumed by UK-3 theme validation
 *
 * Fails when a public tier-1/tier-2 token has no value in every palette, when any value fails its
 * declared type, or when a tier-3 token derives from a token that does not exist.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

import {
  TOKENS,
  TOKENS_BY_NAME,
  TOKEN_CONTRACT_MAJOR,
  cssVariableName,
  validateTokenValue,
} from '../src/tokens/registry.ts'
import { PALETTES } from '../src/tokens/palettes.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const prettierConfig = (await resolveConfig(root)) ?? {}
const problems = []

// ---------------------------------------------------------------- validation
const themed = TOKENS.filter(token => token.tier !== 3)
for (const palette of PALETTES) {
  for (const token of themed) {
    const value = palette.values[token.name]
    if (value === undefined) {
      problems.push(`palette ${palette.id} is missing a value for \`${token.name}\``)
      continue
    }
    const result = validateTokenValue(token.name, value)
    if (!result.valid) {
      problems.push(
        `palette ${palette.id} value for \`${token.name}\` is invalid: ${result.reason}`,
      )
    }
  }
  for (const name of Object.keys(palette.values)) {
    if (!TOKENS_BY_NAME.has(name)) {
      problems.push(`palette ${palette.id} defines unknown token \`${name}\``)
    }
  }
}
for (const token of TOKENS) {
  if (token.tier !== 3) continue
  if (token.derivesFrom === undefined && token.runtimeDefault === undefined) {
    problems.push(`tier-3 token \`${token.name}\` needs derivesFrom or runtimeDefault`)
  } else if (token.derivesFrom !== undefined && !TOKENS_BY_NAME.has(token.derivesFrom)) {
    problems.push(`tier-3 token \`${token.name}\` derives from unknown \`${token.derivesFrom}\``)
  }
}

const byId = id => {
  const palette = PALETTES.find(p => p.id === id)
  if (palette === undefined) throw new Error(`missing palette ${id}`)
  return palette
}
const light = byId('modkit-light')
const dark = byId('modkit-dark')
const contrast = byId('modkit-high-contrast')

// ---------------------------------------------------------------- CSS
const declarations = (palette, indent) =>
  [
    // UA-rendered widgets (form controls, scrollbars) follow `color-scheme`, not our tokens.
    // Without it a light theme still paints native inputs and selects dark.
    `${indent}color-scheme: ${palette.appearance};`,
    ...themed.map(
      token => `${indent}${cssVariableName(token.name)}: ${palette.values[token.name]};`,
    ),
  ].join('\n')

const tier3Declarations = indent =>
  TOKENS.filter(token => token.tier === 3)
    .map(token =>
      // A runtime slot has a static default; a derived token points at its tier-2 origin.
      token.derivesFrom === undefined
        ? `${indent}${cssVariableName(token.name)}: ${token.runtimeDefault};`
        : `${indent}${cssVariableName(token.name)}: var(${cssVariableName(token.derivesFrom)});`,
    )
    .join('\n')

// ---------------------------------------------------------------- VS Code adapter
// An adapter, not a palette: it hands each semantic role to the host's live `--vscode-*` value and
// falls back to the dark palette so the block still resolves outside a webview.
const VSCODE_MAP = {
  'color.bg': 'editor-background',
  'color.surface': 'editor-background',
  'color.raised': 'sideBar-background',
  'color.sunken': 'input-background',
  'color.overlay': 'editorWidget-background',
  'color.fg': 'foreground',
  'color.fg-muted': 'descriptionForeground',
  'color.fg-subtle': 'disabledForeground',
  'color.fg-link': 'textLink-foreground',
  'color.fg-destructive': 'errorForeground',
  'color.border': 'panel-border',
  'color.border-strong': 'contrastBorder',
  'color.separator': 'panel-border',
  'color.accent': 'button-background',
  'color.accent-fg': 'button-foreground',
  // the wash itself stays the dark fallback (unmapped, as before); its text follows the host's
  // active-selection foreground, which is what Dark+ paints on that wash
  'color.accent-muted-fg': 'list-activeSelectionForeground',
  'color.focus': 'focusBorder',
  'color.hover': 'list-hoverBackground',
  'color.active': 'list-activeSelectionBackground',
  'color.selection': 'list-activeSelectionBackground',
  'color.selection-fg': 'list-activeSelectionForeground',
  'color.selection-inactive': 'list-inactiveSelectionBackground',
  'color.match-highlight': 'editor-findMatchHighlightBackground',
  'color.scrollbar-thumb': 'scrollbarSlider-background',
  'color.scrollbar-thumb-hover': 'scrollbarSlider-hoverBackground',
  'status.error': 'errorForeground',
  'status.warn': 'editorWarning-foreground',
  'status.info': 'editorInfo-foreground',
  'font.sans': 'font-family',
  'font.mono': 'editor-font-family',
  'font.size-md': 'font-size',
}

const adapterDeclarations = themed
  .map(token => {
    const mapped = VSCODE_MAP[token.name]
    const fallback = dark.values[token.name]
    const value = mapped === undefined ? fallback : `var(--vscode-${mapped}, ${fallback})`
    return `    ${cssVariableName(token.name)}: ${value};`
  })
  .join('\n')

const tokenLayer = `@layer mk.tokens {
  /*
   * Every token block selects ":root, :host" (a selector LIST, deliberately not
   * ":where(:root, :host)", whose zero specificity would break the theme cascade): ":root"
   * matches nothing inside a shadow tree, so a bare-:root sheet adopted into one resolves every
   * token to nothing — the embedded element had to regex-rewrite the shipped stylesheet to be
   * usable at all. In a normal document ":host" matches nothing and costs nothing.
   */

  /* Complete light palette on bare :root, so an unstamped document always resolves. */
  :root,
  :host {
${declarations(light, '    ')}

    /* tier 3 derives from tier 2; a theme may override any of these */
${tier3Declarations('    ')}
  }

  /*
   * System dark, applied only when no explicit choice is stamped.
   * The guard must stay \`:not([data-mk-theme])\`: enumerating themes here raises specificity to
   * (0,3,0) and beats every explicit \`[data-mk-theme='x']\` selector at (0,2,0), which silently
   * pins the OS palette. Keep it at (0,2,0) so source order decides and the explicit choice wins.
   */
  @media (prefers-color-scheme: dark) {
    :root:not([data-mk-theme]),
    :host(:not([data-mk-theme])) {
${declarations(dark, '      ')}
    }
  }

  /* Explicit choices win in both directions. */
  :root[data-mk-theme='modkit-dark'],
  :host([data-mk-theme='modkit-dark']) {
${declarations(dark, '    ')}
  }

  :root[data-mk-theme='modkit-light'],

  :host([data-mk-theme='modkit-light']) {
${declarations(light, '    ')}
  }

  :root[data-mk-theme='modkit-high-contrast'],

  :host([data-mk-theme='modkit-high-contrast']) {
${declarations(contrast, '    ')}
  }

  /* Adapter, not a user-selectable theme: the host's own theme drives every role. */
  :root[data-mk-theme='vscode-adapter'],
  :host([data-mk-theme='vscode-adapter']) {
${adapterDeclarations}
  }

  /* Forced colors: hand every semantic role to the system palette (BRIEF-13C C-15). */
  @media (forced-colors: active) {
    :root,
    :host {
      ${cssVariableName('color.bg')}: Canvas;
      ${cssVariableName('color.surface')}: Canvas;
      ${cssVariableName('color.raised')}: Canvas;
      ${cssVariableName('color.sunken')}: Canvas;
      ${cssVariableName('color.overlay')}: Canvas;
      ${cssVariableName('color.fg')}: CanvasText;
      ${cssVariableName('color.fg-muted')}: CanvasText;
      ${cssVariableName('color.fg-subtle')}: GrayText;
      ${cssVariableName('color.fg-disabled')}: GrayText;
      ${cssVariableName('color.fg-link')}: LinkText;
      ${cssVariableName('color.border')}: CanvasText;
      ${cssVariableName('color.border-strong')}: CanvasText;
      ${cssVariableName('color.separator')}: CanvasText;
      ${cssVariableName('color.accent')}: Highlight;
      ${cssVariableName('color.accent-fg')}: HighlightText;
      ${cssVariableName('color.focus')}: Highlight;
      ${cssVariableName('color.selection')}: Highlight;
      ${cssVariableName('color.selection-fg')}: HighlightText;
      ${cssVariableName('color.hover')}: Canvas;
      ${cssVariableName('color.active')}: Canvas;
    }
  }
}
`

// ---------------------------------------------------------------- assembled stylesheet
// One shipped file. C2 forbids injecting stylesheet text at runtime, so the host links this.
const fragment = name => readFileSync(join(root, 'src', 'styles', name), 'utf8').trim()

const css = `/* GENERATED by scripts/generate-tokens.mjs - do not edit. */
/* The single shipped Modkit UI stylesheet. Token contract major ${TOKEN_CONTRACT_MAJOR}. */
/* Authority: src/tokens/registry.ts, src/tokens/palettes.ts, src/styles/*.css */

/* Fixed layer order: a theme always beats a component default, an app always beats a theme. */
@layer mk.reset, mk.tokens, mk.base, mk.primitives, mk.components, mk.theme, mk.app;

${tokenLayer}

${fragment('base.css')}

${fragment('components.css')}

${fragment('chrome.css')}

${fragment('card.css')}

${fragment('media-shell.css')}

${fragment('image-editing.css')}

${fragment('template.css')}
`

// ---------------------------------------------------------------- TypeScript
const ts = `/* GENERATED by scripts/generate-tokens.mjs - do not edit. */

/** Every registered token name. Component code may only reference members of this union. */
export type TokenName =
${TOKENS.map(token => `  | '${token.name}'`).join('\n')}

export const TOKEN_NAMES: readonly TokenName[] = Object.freeze([
${TOKENS.map(token => `  '${token.name}',`).join('\n')}
])

export const TOKEN_CONTRACT_MAJOR = ${TOKEN_CONTRACT_MAJOR}
`

// ---------------------------------------------------------------- JSON contract
const contract = {
  $schema: 'https://schemas.modkit.org/x3/ui-token-contract.v1.schema.json',
  contract: { id: 'modkit.ui/token-contract', major: TOKEN_CONTRACT_MAJOR },
  tokens: TOKENS.map(token => ({
    name: token.name,
    tier: token.tier,
    type: token.type,
    public: token.isPublic,
    cssVariable: cssVariableName(token.name),
    ...(token.component === undefined ? {} : { component: token.component }),
    ...(token.derivesFrom === undefined ? {} : { derivesFrom: token.derivesFrom }),
    description: token.description,
  })),
  themes: PALETTES.map(palette => ({
    id: palette.id,
    displayName: palette.displayName,
    appearance: palette.appearance,
    ...(palette.isDefaultFor === undefined ? {} : { isDefaultFor: palette.isDefaultFor }),
  })),
}

// ---------------------------------------------------------------- emit
const outputs = [
  { path: join(root, 'styles', 'modkit-ui.css'), body: css, parser: 'css' },
  { path: join(root, 'src', 'tokens', 'generated.ts'), body: ts, parser: 'typescript' },
  {
    path: join(root, 'generated', 'token-contract.v1.json'),
    body: `${JSON.stringify(contract, null, 2)}\n`,
    parser: 'json',
  },
]

for (const output of outputs) {
  const formatted = await format(output.body, { ...prettierConfig, parser: output.parser })
  if (check) {
    if (!existsSync(output.path)) {
      problems.push(`missing generated file: ${output.path} - run pnpm tokens:emit`)
      continue
    }
    if (readFileSync(output.path, 'utf8') !== formatted) {
      problems.push(`out of date: ${output.path} - run pnpm tokens:emit`)
    }
  } else {
    mkdirSync(dirname(output.path), { recursive: true })
    writeFileSync(output.path, formatted)
    console.log(`wrote ${output.path.slice(root.length + 1)}`)
  }
}

if (problems.length > 0) {
  console.error(`\ntoken gate FAILED with ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `\ntoken gate passed (${check ? 'check' : 'emit'}): ${TOKENS.length} tokens, ${PALETTES.length} palettes.`,
)
