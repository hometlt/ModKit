import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VIEWER_CSP, VIEWER_CSP_TRUSTED_EDITOR } from '@modkitx-x3/ui/viewer'

// S2 acceptance (BRIEF-12 §5): the browser import test for core / sdk / portable vfs
// must not see `node:*`. host is exempt only in its /node modules; its portable root
// is checked too.
const root = fileURLToPath(new URL('../..', import.meta.url))

function jsFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.js')) out.push(path)
    }
  }
  walk(dir)
  return out
}

function tsFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) out.push(path)
    }
  }
  walk(dir)
  return out
}

const NODE_SPECIFIER = /(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])node:/

function offenders(dir: string, exclude?: (path: string) => boolean): string[] {
  return jsFiles(dir)
    .filter(path => !(exclude?.(path) ?? false))
    .filter(path => NODE_SPECIFIER.test(readFileSync(path, 'utf8')))
}

describe('browser-safety of the portable closure (S2)', () => {
  it('core, sdk, portable vfs and ui dist contain no node:* imports', () => {
    for (const pkg of ['core', 'sdk', 'ui']) {
      expect(offenders(join(root, 'packages', pkg, 'dist')), pkg).toEqual([])
    }
    const nodeOnlyProviders = ['file', 'rapid'].map(provider =>
      join(root, 'packages', 'vfs', 'dist', 'providers', provider),
    )
    expect(
      offenders(join(root, 'packages', 'vfs', 'dist'), path =>
        nodeOnlyProviders.some(provider => path.startsWith(provider)),
      ),
    ).toEqual([])
  })

  it('host stays portable outside its explicit /node modules', () => {
    const nodeDir = join(root, 'packages', 'host', 'dist', 'node')
    expect(offenders(join(root, 'packages', 'host', 'dist'), p => p.startsWith(nodeDir))).toEqual(
      [],
    )
  })

  it('viewer sources contain no executable markup or format implementation imports', () => {
    expect(Object.values(VIEWER_CSP).join(' ')).not.toMatch(/unsafe-(?:inline|eval)/u)
    expect(VIEWER_CSP_TRUSTED_EDITOR.scriptSrc).not.toContain('unsafe-eval')
    const sourceFiles = [
      ...tsFiles(join(root, 'packages', 'ui', 'src')),
      join(root, 'packages', 'testkit', 'src', 'browser', 'index.ts'),
    ]
    expect(sourceFiles.length).toBeGreaterThan(1)
    for (const path of sourceFiles) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/\.innerHTML\s*=/u)
      const specifiers = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/gu)].map(
        match => match[1] ?? '',
      )
      expect(
        specifiers.filter(specifier =>
          /(?:^|\/)(?:codec|codecs|provider|providers|formats?|extensions?)(?:\/|$)/u.test(
            specifier,
          ),
        ),
        path,
      ).toEqual([])
    }
  })
})
