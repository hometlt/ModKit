/**
 * themes:check — installable themes are complete and self-contained (R-1). Fixtures are built in
 * a temp root: a minimal contract JSON plus theme files that pass or fail one rule each.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const gate = fileURLToPath(new URL('../check-themes.mjs', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'x3-themes-gate-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const contract = {
  contract: { id: 'org.modkitx.ui/token-contract', major: 1 },
  tokens: [
    {
      name: 'palette.neutral.500',
      tier: 1,
      type: 'color',
      public: true,
      cssVariable: '--mk-palette-neutral-500',
    },
    { name: 'color.bg', tier: 2, type: 'color', public: true, cssVariable: '--mk-color-bg' },
    { name: 'color.fg', tier: 2, type: 'color', public: true, cssVariable: '--mk-color-fg' },
    {
      name: 'shadow.focus-ring',
      tier: 2,
      type: 'shadow',
      public: true,
      cssVariable: '--mk-shadow-focus-ring',
    },
    { name: 'space.3', tier: 2, type: 'length', public: true, cssVariable: '--mk-space-3' },
    {
      name: 'font.sans',
      tier: 2,
      type: 'font-family',
      public: true,
      cssVariable: '--mk-font-sans',
    },
    {
      name: 'tree.row-height',
      tier: 3,
      type: 'length',
      public: true,
      cssVariable: '--mk-tree-row-height',
    },
  ],
  themes: [],
}

function makeRoot(name: string, themes: Record<string, string>, fonts: string[] = []): string {
  const root = join(scratch, name)
  mkdirSync(join(root, 'packages', 'ui', 'generated'), { recursive: true })
  writeFileSync(
    join(root, 'packages', 'ui', 'generated', 'token-contract.v1.json'),
    JSON.stringify(contract),
  )
  for (const [id, css] of Object.entries(themes)) {
    mkdirSync(join(root, 'assets', 'themes', id), { recursive: true })
    writeFileSync(join(root, 'assets', 'themes', id, 'theme.css'), css)
  }
  mkdirSync(join(root, 'assets', 'themes'), { recursive: true })
  writeFileSync(
    join(root, 'assets', 'themes', 'modkit.themes.json'),
    JSON.stringify({
      schemaVersion: 1,
      themes: Object.keys(themes).map(id => ({
        id,
        label: id,
        stylesheet: `${id}/theme.css`,
      })),
    }),
  )
  for (const font of fonts) {
    mkdirSync(join(root, 'assets', 'fonts', font.split('/')[0] ?? ''), { recursive: true })
    writeFileSync(join(root, 'assets', 'fonts', font), 'wOF2')
  }
  return root
}

const complete = (id: string, extra = '') => `
:root[data-mk-theme='${id}'] {
  color-scheme: dark;
  --mk-color-bg: #000;
  --mk-color-fg: #fff;
  --mk-shadow-focus-ring: 0 0 0 2px #fff;
}
${extra}
`

function run(root: string) {
  const result = spawnSync(process.execPath, [gate, '--root', root, '--quiet'], {
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('themes:check — installable themes are complete and self-contained', () => {
  it('accepts a theme that declares every appearance role, its own selector and color-scheme; structure may be inherited', () => {
    const root = makeRoot('ok', { nova: complete('nova') })
    const { status, stdout } = run(root)
    expect(status).toBe(0)
    expect(stdout).toContain('1 installable theme(s) complete')
  })

  it('fails a theme that misses an appearance role, names another theme, or lacks color-scheme', () => {
    const root = makeRoot('missing', {
      partial: `:root[data-mk-theme='partial'] { color-scheme: dark; --mk-color-bg: #000; --mk-space-3: 8px; }`,
      other: `:root[data-mk-theme='someone-else'] { --mk-color-bg: #000; --mk-color-fg: #fff; --mk-shadow-focus-ring: none; }`,
    })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain('partial/theme.css: declares 2 tokens but misses 2 appearance role(s)')
    expect(stderr).toContain('--mk-color-fg')
    expect(stderr).toContain("other/theme.css: no [data-mk-theme='other'] selector")
    expect(stderr).toContain("targets another theme's selector [data-mk-theme='someone-else']")
    expect(stderr).toContain('other/theme.css: no color-scheme declaration')
  })

  it('allows url( only inside @font-face and only for files that exist under assets/fonts', () => {
    const root = makeRoot(
      'fonts',
      {
        good: complete(
          'good',
          `@font-face { font-family: Saira; src: url('./fonts/saira/saira-latin.woff2') format('woff2'); }`,
        ),
        remote: complete(
          'remote',
          `@font-face { font-family: X; src: url('https://fonts.gstatic.com/x.woff2'); }`,
        ),
        stray: complete(
          'stray',
          `:root[data-mk-theme='stray'] body { background: url('./x.png'); }`,
        ),
        absent: complete(
          'absent',
          `@font-face { font-family: Y; src: url('./fonts/nope/nope.woff2') format('woff2'); }`,
        ),
      },
      ['saira/saira-latin.woff2'],
    )
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).not.toContain('good/theme.css')
    expect(stderr).toContain('remote/theme.css: @font-face src must be a relative ./fonts/ path')
    expect(stderr).toContain('stray/theme.css: url( outside @font-face')
    expect(stderr).toContain(
      'absent/theme.css: @font-face src «./fonts/nope/nope.woff2» has no file',
    )
  })

  it('an animating theme must carry its own prefers-reduced-motion block', () => {
    const root = makeRoot('motion', {
      restless: complete(
        'restless',
        `:root[data-mk-theme='restless'] body::before { animation: spin 2s linear infinite; } @keyframes spin { to { transform: rotate(1turn); } }`,
      ),
      calm: complete(
        'calm',
        `:root[data-mk-theme='calm'] body::before { animation: spin 2s linear infinite; } @keyframes spin { to { transform: rotate(1turn); } } @media (prefers-reduced-motion: reduce) { :root[data-mk-theme='calm'] body::before { animation-duration: 1ms !important; } }`,
      ),
    })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(
      'restless/theme.css: animates without its own @media (prefers-reduced-motion: reduce) block',
    )
    expect(stderr).not.toContain('calm/theme.css')
  })

  it('keeps the format-neutral repository themes green under the live contract', () => {
    const { status, stdout } = run(repositoryRoot)
    expect(status).toBe(0)
    expect(stdout).toContain('installable theme(s) complete under contract v1')
  })
})
