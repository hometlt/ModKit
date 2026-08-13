import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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

const NODE_SPECIFIER = /(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])node:/

function offenders(dir: string, exclude?: (path: string) => boolean): string[] {
  return jsFiles(dir)
    .filter(path => !(exclude?.(path) ?? false))
    .filter(path => NODE_SPECIFIER.test(readFileSync(path, 'utf8')))
}

describe('browser-safety of the portable closure (S2)', () => {
  it('core, sdk and vfs dist contain no node:* imports', () => {
    for (const pkg of ['core', 'sdk', 'vfs']) {
      expect(offenders(join(root, 'packages', pkg, 'dist')), pkg).toEqual([])
    }
  })

  it('host stays portable outside its explicit /node modules', () => {
    const nodeDir = join(root, 'packages', 'host', 'dist', 'node')
    expect(offenders(join(root, 'packages', 'host', 'dist'), p => p.startsWith(nodeDir))).toEqual(
      [],
    )
  })
})
