import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Properties of the single-file production dist (owner authorisation 2026-08-14).
 *
 * These assert the *shape* the authorisation specified, not just that a build ran:
 * one file per published entry, cross-package boundaries preserved as real imports, the
 * exports map untouched, testkit unbundled, and two builds byte-identical.
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const bundlePath = (...parts: string[]) => join(root, ...parts)

const PUBLISHED_ENTRIES = [
  'packages/core/dist/index.js',
  'packages/sdk/dist/index.js',
  'packages/sdk/dist/authoring/index.js',
  'packages/sdk/dist/data-sources.js',
  'packages/sdk/dist/editing.js',
  'packages/sdk/dist/service-contracts.js',
  'packages/sdk/dist/language/index.js',
  'packages/sdk/dist/renderer/index.js',
  'packages/sdk/dist/games/index.js',
  'packages/sdk/dist/mods/index.js',
  'packages/sdk/dist/data/index.js',
  'packages/sdk/dist/maps/index.js',
  'packages/sdk/dist/runtime/index.js',
  'packages/sdk/dist/text-data/index.js',
  'packages/sdk/dist/formats/index.js',
  'packages/sdk/dist/subjects/index.js',
  'packages/sdk/dist/ui-contracts/index.js',
  'packages/vfs/dist/index.js',
  'packages/vfs/dist/providers/file/index.js',
  'packages/vfs/dist/providers/memory/index.js',
  'packages/vfs/dist/providers/http/index.js',
  'packages/vfs/dist/providers/browser-file/index.js',
  'packages/host/dist/index.js',
  'packages/host/dist/node/index.js',
  'packages/host/dist/browser/index.js',
  // capability-RPC core (NXT-105) as its own entry so transports/preloads/testkit depend on the
  // protocol alone, without pulling inventory/resolution/gate code into a renderer or worker
  'packages/host/dist/execution/index.js',
  'packages/host/dist/language/index.js',
  'packages/host/dist/renderer/index.js',
  'packages/host/dist/games/index.js',
  'packages/host/dist/mods/index.js',
  'packages/host/dist/data/index.js',
  'packages/host/dist/maps/index.js',
  'packages/host/dist/runtime/index.js',
  // worker-side bootstrap of the Node worker backend: its own file so `new Worker(url)` finds it
  'packages/host/dist/node/worker-bootstrap.js',
  // worker-side entry of the browser worker backend (S5b): spawned as a module Worker by URL
  'packages/host/dist/browser/worker-entry.js',
  'packages/ui/dist/index.js',
  'packages/ui/dist/viewer/index.js',
  'packages/ui/dist/localization/index.js',
  'packages/ui/dist/code/index.js',
  'packages/ui/dist/editor/index.js',
  'packages/ui/dist/text-virtual/index.js',
  'packages/ui/dist/hex/index.js',
  'packages/ui/dist/tree/index.js',
  'packages/ui/dist/table/index.js',
  'packages/ui/dist/transport/index.js',
  'packages/ui/dist/namespace/index.js',
  'packages/ui/dist/panels/index.js',
  'packages/ui/dist/tokens/index.js',
  'packages/ui/dist/search/matcher.js',
  'packages/ui/dist/primitives/search-field.js',
  'packages/ui/dist/shell/chrome.js',
  'packages/ui/dist/card/index.js',
  'packages/ui/dist/graph/index.js',
  'packages/ui/dist/workbench/index.js',
  'packages/ui/dist/settings/index.js',
  'packages/ui/dist/metadata/index.js',
  'packages/ui/dist/image/index.js',
  'packages/ui/dist/audio/index.js',
  'packages/ui/dist/vector/index.js',
  'packages/ui/dist/video/index.js',
  'packages/ui/dist/model/index.js',
  // the three subpaths the minimal-build lane added: explorer (previewer/tabs), the hex
  // editor, and the encoded-media helper — every exports-map entry must be listed here, or the
  // determinism case reports the honest bundle as a surprise
  'packages/ui/dist/explorer/index.js',
  'packages/ui/dist/hex-editor/index.js',
  'packages/ui/dist/media/encoded.js',
]

/**
 * Every module specifier the file still depends on. Matches `from '…'` (import and export
 * statements alike, including multi-line ones) and dynamic `import('…')` — in generated ESM
 * these forms are the only way a specifier appears.
 */
function importSpecifiers(source: string): string[] {
  const statik = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(m => m[1] as string)
  const dynamic = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    m => m[1] as string,
  )
  return [...statik, ...dynamic]
}

describe('single-file production dist', () => {
  it.each(PUBLISHED_ENTRIES)('%s is one self-contained file', entry => {
    const source = readFileSync(bundlePath(entry), 'utf8')
    const relative = importSpecifiers(source).filter(s => s.startsWith('.'))
    expect(relative, `${entry} still imports its own modules`).toEqual([])
  })

  it('keeps cross-package and third-party imports external', () => {
    const sdk = readFileSync(bundlePath('packages/sdk/dist/index.js'), 'utf8')
    // sdk uses core at runtime: that must remain a real package import, never inlined —
    // inlining would duplicate a sibling package's module state.
    expect(importSpecifiers(sdk)).toContain('@modkitx-x3/core')
    // JSON Schema validators are emitted at build time. Runtime compilation would violate the
    // production viewer CSP and break every codec.open() in browser hosts.
    expect(sdk).not.toContain('ajv/dist/2020.js')
    expect(sdk).not.toContain('new Function')
    expect(sdk).not.toContain('unsafe-eval')

    const host = readFileSync(bundlePath('packages/host/dist/index.js'), 'utf8')
    const hostImports = importSpecifiers(host)
    expect(hostImports).toContain('@modkitx-x3/core')
    expect(hostImports).toContain('@modkitx-x3/sdk')

    const ui = readFileSync(bundlePath('packages/ui/dist/index.js'), 'utf8')
    expect(ui).not.toContain('node:')
  })

  it('does not bundle the dev-only testkit', () => {
    const testkit = readFileSync(bundlePath('packages/testkit/dist/index.js'), 'utf8')
    // testkit stays modular: its entry still re-exports its own files.
    expect(importSpecifiers(testkit).some(s => s.startsWith('.'))).toBe(true)
  })

  it('leaves the exports map and the .d.ts API in place', () => {
    for (const pkg of ['core', 'sdk', 'vfs', 'host', 'ui']) {
      const manifest = JSON.parse(
        readFileSync(bundlePath('packages', pkg, 'package.json'), 'utf8'),
      ) as { exports: Record<string, string | { types: string; default: string }> }
      for (const entry of Object.values(manifest.exports).filter(
        (value): value is { types: string; default: string } => typeof value !== 'string',
      )) {
        expect(entry.types.endsWith('.d.ts')).toBe(true)
        // The declaration files come from tsc and are NOT bundled: the type API is unchanged.
        const declaration = readFileSync(bundlePath('packages', pkg, entry.types.slice(2)), 'utf8')
        expect(declaration.length).toBeGreaterThan(0)
      }
      if (pkg === 'core' || pkg === 'sdk') {
        expect(manifest.exports['./schemas/*.schema.json']).toBe('./schemas/*.schema.json')
      }
    }
  })

  it('produces byte-identical output on two consecutive builds', () => {
    const run = () => {
      const result = spawnSync(process.execPath, [join(root, 'scripts', 'bundle.mjs')], {
        cwd: root,
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      return readFileSync(join(root, 'scripts', 'bundle-hashes.json'), 'utf8')
    }
    const first = run()
    const second = run()
    expect(second).toBe(first)
    const hashes = JSON.parse(first) as Record<string, string>
    expect(Object.keys(hashes).sort()).toEqual(
      [...PUBLISHED_ENTRIES, 'apps/modkit-cli/dist/main.js'].sort(),
    )
  })
})
