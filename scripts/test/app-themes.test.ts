import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { appThemeStylesheets, renderAppThemeDomData, resolveAppThemes } from '../lib/app-themes.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'modkit-app-themes-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function themeRoot(
  name: string,
  themes: readonly { readonly id: string; readonly label: string; readonly stylesheet: string }[],
): string {
  const root = join(scratch, name)
  mkdirSync(root, { recursive: true })
  for (const theme of themes) {
    const target = join(root, ...theme.stylesheet.split('/'))
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(
      target,
      `:root[data-mk-theme='${theme.id}'] { color-scheme: dark; --mk-color-bg: #000; }\n`,
    )
  }
  writeFileSync(join(root, 'modkit.themes.json'), JSON.stringify({ schemaVersion: 1, themes }))
  return root
}

describe('data-driven static app themes', () => {
  it('keeps a generic build input format-neutral', () => {
    const themes = resolveAppThemes({ repositoryRoot, environmentValue: '' })
    expect(themes.map(theme => theme.id)).toEqual([
      'modkit-dark',
      'modkit-light',
      'modkit-high-contrast',
      'nexus-forge',
      'nexus-dominion',
    ])
    expect(JSON.stringify(themes)).not.toMatch(/starcraft|\bsc2\b/iu)
  })

  it('adds an external fixture only through its manifest data', () => {
    const external = themeRoot('external', [
      { id: 'fixture', label: 'Fixture Theme', stylesheet: 'fixture/theme.css' },
    ])
    const themes = resolveAppThemes({ repositoryRoot, environmentValue: external })
    expect(appThemeStylesheets(themes).at(-1)).toMatchObject({
      id: 'fixture',
      label: 'Fixture Theme',
      stylesheet: './theme-fixture.css',
    })
    expect(renderAppThemeDomData(themes)).toContain('Fixture Theme')
  })

  it('fails closed on duplicate ids, traversal and missing CSS', () => {
    const duplicate = themeRoot('duplicate', [
      { id: 'nexus-forge', label: 'Duplicate', stylesheet: 'duplicate/theme.css' },
    ])
    expect(() => resolveAppThemes({ repositoryRoot, environmentValue: duplicate })).toThrow(
      /duplicate theme id/u,
    )

    const traversal = themeRoot('traversal', [])
    writeFileSync(
      join(traversal, 'modkit.themes.json'),
      JSON.stringify({
        schemaVersion: 1,
        themes: [{ id: 'escape', label: 'Escape', stylesheet: '../escape.css' }],
      }),
    )
    expect(() => resolveAppThemes({ repositoryRoot, environmentValue: traversal })).toThrow(
      /traversal-free/u,
    )

    const missing = themeRoot('missing', [])
    writeFileSync(
      join(missing, 'modkit.themes.json'),
      JSON.stringify({
        schemaVersion: 1,
        themes: [{ id: 'missing', label: 'Missing', stylesheet: 'missing.css' }],
      }),
    )
    expect(() => resolveAppThemes({ repositoryRoot, environmentValue: missing })).toThrow(
      /is missing/u,
    )

    const externalResource = themeRoot('external-resource', [
      { id: 'external-resource', label: 'External resource', stylesheet: 'theme.css' },
    ])
    writeFileSync(
      join(externalResource, 'theme.css'),
      '@import url("https://example.invalid/x.css");',
    )
    expect(() => resolveAppThemes({ repositoryRoot, environmentValue: externalResource })).toThrow(
      /must be self-contained/u,
    )
  })

  it('keeps both app runtime/build paths free of product theme names', () => {
    const paths = [
      'apps/web/src/settings.ts',
      'apps/web/src/shell.ts',
      'apps/web/scripts/build.mjs',
      'apps/web/public/service-worker.js',
      'apps/electron/src/renderer.ts',
      'apps/electron/scripts/build-app.mjs',
      'scripts/lib/app-themes.mjs',
      'assets/themes/modkit.themes.json',
    ]
    for (const path of paths) {
      expect(readFileSync(join(repositoryRoot, path), 'utf8'), path).not.toMatch(
        /starcraft|theme-sc2|mk-sc2|\bsc2\b/iu,
      )
    }
  })

  it('emits generic and externally themed Web and Electron builds from the same manifests', () => {
    const genericOut = join(scratch, 'web-generic')
    execFileSync(
      process.execPath,
      [join(repositoryRoot, 'apps', 'web', 'scripts', 'build.mjs'), '--out', genericOut],
      { cwd: repositoryRoot, env: { ...process.env, MODKIT_APP_THEME_ROOTS: '' } },
    )
    const genericHtml = readFileSync(join(genericOut, 'index.html'), 'utf8')
    expect(genericHtml).toContain('modkit-app-themes')
    expect(genericHtml).not.toMatch(/starcraft|theme-sc2|\bsc2\b/iu)

    const genericElectronOut = join(scratch, 'electron-generic')
    execFileSync(
      process.execPath,
      [
        join(repositoryRoot, 'apps', 'electron', 'scripts', 'build-app.mjs'),
        '--out',
        genericElectronOut,
      ],
      { cwd: repositoryRoot, env: { ...process.env, MODKIT_APP_THEME_ROOTS: '' } },
    )
    const genericElectronHtml = readFileSync(join(genericElectronOut, 'index.html'), 'utf8')
    expect(genericElectronHtml).toContain('modkit-app-themes')
    expect(genericElectronHtml).not.toMatch(/starcraft|theme-sc2|\bsc2\b/iu)

    const external = themeRoot('web-external', [
      { id: 'fixture-web', label: 'Fixture Web', stylesheet: 'fixture/theme.css' },
    ])
    const externalOut = join(scratch, 'web-external-build')
    execFileSync(
      process.execPath,
      [join(repositoryRoot, 'apps', 'web', 'scripts', 'build.mjs'), '--out', externalOut],
      {
        cwd: repositoryRoot,
        env: { ...process.env, MODKIT_APP_THEME_ROOTS: external },
      },
    )
    const externalHtml = readFileSync(join(externalOut, 'index.html'), 'utf8')
    const serviceWorker = readFileSync(join(externalOut, 'service-worker.js'), 'utf8')
    expect(externalHtml).toContain('Fixture Web')
    expect(externalHtml).toContain('./theme-fixture-web.css')
    expect(readFileSync(join(externalOut, 'theme-fixture-web.css'), 'utf8')).toContain(
      "data-mk-theme='fixture-web'",
    )
    expect(serviceWorker).toContain("'./theme-fixture-web.css'")
    expect(serviceWorker).not.toContain('MODKIT_APP_THEME_CACHE')

    const externalElectronOut = join(scratch, 'electron-external-build')
    execFileSync(
      process.execPath,
      [
        join(repositoryRoot, 'apps', 'electron', 'scripts', 'build-app.mjs'),
        '--out',
        externalElectronOut,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, MODKIT_APP_THEME_ROOTS: external },
      },
    )
    const externalElectronHtml = readFileSync(join(externalElectronOut, 'index.html'), 'utf8')
    expect(externalElectronHtml).toContain('Fixture Web')
    expect(externalElectronHtml).toContain('./theme-fixture-web.css')
    expect(readFileSync(join(externalElectronOut, 'theme-fixture-web.css'), 'utf8')).toContain(
      "data-mk-theme='fixture-web'",
    )
  })
})
