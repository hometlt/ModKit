import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRealTestFile, QUICK_TEST_INCLUDE, REAL_TEST_INCLUDE } from '../../vitest.tiers.config.js'

const repoRoot = join(import.meta.dirname, '..', '..')
const roots = ['packages', 'apps', 'scripts', 'extensions'] as const
const skippedDirectories = new Set(['node_modules', 'dist', 'dist-app', 'fixtures'])

function inventory(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...inventory(join(directory, entry.name)))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(relative(repoRoot, join(directory, entry.name)).split(sep).join('/'))
    }
  }
  return files
}

describe('1C test tier routing', () => {
  const all = roots.flatMap(root => inventory(join(repoRoot, root))).sort()
  const real = all.filter(isRealTestFile)
  const owner = all.filter(file => !isRealTestFile(file))

  it('routes every current root Vitest file to exactly one owner or real tier', () => {
    expect(new Set([...owner, ...real]).size).toBe(all.length)
    expect(owner).not.toContainEqual(expect.stringMatching(/(?:corpus[^/]*|-real)\.test\.ts$/u))
    // files named *-real or *corpus* route themselves; only these are listed by hand
    expect(real.filter(file => !/(?:corpus[^/]*|-real)\.test\.ts$/u.test(file))).toEqual([
      'apps/web/test/edit-panel.test.ts',
      'apps/web/test/embed.test.ts',
      'packages/ui/test/browser-e2e.test.ts',
      'scripts/test/debug-launchers.test.ts',
    ])
  })

  it('keeps quick inside owner and all flattened image tests under root ownership', () => {
    expect(QUICK_TEST_INCLUDE.every(file => owner.includes(file))).toBe(true)
    const images = all.filter(file => file.startsWith('extensions/images/test/'))
    expect(images.length).toBeGreaterThan(0)
    expect(owner.filter(file => file.startsWith('extensions/images/test/'))).toEqual(images)
  })

  it('keeps future corpus and real-name patterns visible in the real config', () => {
    expect(REAL_TEST_INCLUDE).toContain('**/*corpus*.test.ts')
    expect(REAL_TEST_INCLUDE).toContain('**/*-real.test.ts')
    expect(isRealTestFile('packages/example/test/new-corpus-fixture.test.ts')).toBe(true)
    expect(isRealTestFile('packages/example/test/new-real.test.ts')).toBe(true)
  })
})
