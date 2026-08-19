#!/usr/bin/env node
// Installable-theme gate (REPORT_NEXUS_UI_ADAPTATION §4.4, R-1; ADR-UI-002).
//
// An installable theme is one stylesheet under assets/themes/<id>/theme.css that redefines
// tokens under `[data-mk-theme='<id>']` and may decorate public parts. It touches no component.
// A theme only overrides what it sets; everything else resolves to the *light* base on bare
// `:root`. Structure (spacing, sizes, z-index, motion timing, font stacks) is shared and may be
// inherited on purpose. Appearance roles may not: a dark theme that forgets `color.canvas-bg`
// silently paints a light scene ground. So:
//
//   1. every public tier-2 token of type `color` or `shadow` in the token contract is declared;
//   2. the file declares `color-scheme` and only ever targets its own `[data-mk-theme='<id>']`
//      (id = directory name);
//   3. `url(` appears only inside `@font-face` blocks and points at a relative `./fonts/...` file
//      that exists under assets/fonts (VIEWER_CSP: `font-src 'self'`; nothing else may load);
//   4. a theme that animates carries its own `@media (prefers-reduced-motion: reduce)` block —
//      base.css only neutralises motion under `.modkit-viewer`, and shell decor may sit outside;
//   5. no inline `<style>`/`style=` residue and no `@import`.
//
// Data-only: reads the contract JSON and the CSS text; nothing is executed or rendered.
//
// Usage: node scripts/check-themes.mjs [--root <dir>] [--quiet]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = argValue('--root') === undefined ? defaultRoot : resolve(argValue('--root'))
const quiet = args.includes('--quiet')

const REQUIRED_TYPES = new Set(['color', 'shadow'])

export function requiredTokens(contract) {
  return contract.tokens
    .filter(token => token.tier === 2 && token.public && REQUIRED_TYPES.has(token.type))
    .map(token => token.cssVariable)
    .sort()
}

/** Strip comments; return the text with every `@font-face { … }` block removed and the blocks. */
function splitFontFaces(css) {
  const blocks = []
  const rest = css.replace(/@font-face\s*\{[^{}]*\}/gu, match => {
    blocks.push(match)
    return ''
  })
  return { rest, blocks }
}

export function checkThemeFile({ id, css, contract, fontsRoot }) {
  const problems = []
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  const declared = new Set([...source.matchAll(/(--mk-[a-z0-9-]+)\s*:/gu)].map(m => m[1]))
  const missing = requiredTokens(contract).filter(name => !declared.has(name))
  if (missing.length > 0) {
    problems.push(
      `declares ${declared.size} tokens but misses ${missing.length} appearance role(s): ${missing.join(', ')}`,
    )
  }
  const selectorPattern = /\[data-mk-theme=(['"])([^'"\]]+)\1\]/gu
  const selectors = new Set([...source.matchAll(selectorPattern)].map(m => m[2]))
  if (!selectors.has(id)) problems.push(`no [data-mk-theme='${id}'] selector (id = directory name)`)
  for (const other of selectors) {
    if (other !== id) problems.push(`targets another theme's selector [data-mk-theme='${other}']`)
  }
  if (!/color-scheme\s*:/u.test(source)) problems.push('no color-scheme declaration')
  if (/@import\b/u.test(source)) problems.push('@import is not allowed in a theme')
  if (/<\s*style\b|\bstyle\s*=/u.test(source)) problems.push('markup residue (<style> or style=)')

  const { rest, blocks } = splitFontFaces(source)
  if (/url\s*\(/iu.test(rest)) {
    problems.push('url( outside @font-face (only self-hosted fonts may load; VIEWER_CSP)')
  }
  for (const block of blocks) {
    for (const match of block.matchAll(/url\s*\(\s*(['"]?)([^'")]+)\1\s*\)/giu)) {
      const target = match[2].trim()
      if (!target.startsWith('./fonts/')) {
        problems.push(`@font-face src must be a relative ./fonts/ path, got «${target}»`)
        continue
      }
      const file = join(fontsRoot, target.slice('./fonts/'.length))
      if (!existsSync(file) || !statSync(file).isFile()) {
        problems.push(`@font-face src «${target}» has no file under assets/fonts`)
      }
    }
  }
  const animates = /@keyframes\b|\banimation(?:-name)?\s*:/u.test(source)
  if (animates && !/prefers-reduced-motion\s*:\s*reduce/u.test(source)) {
    problems.push('animates without its own @media (prefers-reduced-motion: reduce) block')
  }
  return { declared: declared.size, required: requiredTokens(contract).length, problems, animates }
}

function main() {
  const contractPath = join(root, 'packages', 'ui', 'generated', 'token-contract.v1.json')
  if (!existsSync(contractPath)) {
    process.stderr.write(`themes:check: missing ${contractPath} — run pnpm tokens:emit\n`)
    process.exit(2)
  }
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
  const themesRoot = join(root, 'assets', 'themes')
  const fontsRoot = join(root, 'assets', 'fonts')
  const ids = existsSync(themesRoot)
    ? readdirSync(themesRoot)
        .filter(name => statSync(join(themesRoot, name)).isDirectory())
        .sort()
    : []
  const failures = []
  let checked = 0
  for (const id of ids) {
    const file = join(themesRoot, id, 'theme.css')
    if (!existsSync(file)) {
      failures.push(`assets/themes/${id}: no theme.css`)
      continue
    }
    const result = checkThemeFile({ id, css: readFileSync(file, 'utf8'), contract, fontsRoot })
    checked += 1
    for (const problem of result.problems)
      failures.push(`assets/themes/${id}/theme.css: ${problem}`)
    if (!quiet) {
      process.stdout.write(
        `  ${id}: ${result.declared} tokens declared, ${result.required} appearance roles required${result.animates ? ', animates' : ''}${result.problems.length === 0 ? ' — ok' : ''}\n`,
      )
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `themes:check: ${failures.length} problem(s)\n${failures.map(f => `  - ${f}`).join('\n')}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(
    `themes:check: ${checked} installable theme(s) complete under contract v${contract.contract.major}\n`,
  )
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
