import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { authoredExtensionRootsRelativeTo } from '../lib/authored-extension-roots.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const commonRoot = join(repoRoot, 'extensions', 'common')

describe('hand-authored linked extension entries', () => {
  const extensions = [
    ...authoredExtensionRootsRelativeTo(commonRoot),
    { directory: join(repoRoot, 'extensions', 'ps1'), relativePath: 'ps1' },
  ]
    .filter(({ directory }) => existsSync(join(directory, 'contributions')))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

  it.each(extensions)('$relativePath mentions every contribution manifest', extension => {
    const root = extension.directory
    const linkedPath = join(root, 'src', 'linked.js')
    const linked = readFileSync(linkedPath, 'utf8')
    const contributions = readdirSync(join(root, 'contributions'))
      .filter(name => name.endsWith('.json'))
      .sort()
    for (const contribution of contributions) {
      expect(linked, `${extension.relativePath} omits ${contribution}`).toContain(
        `contributions/${contribution}`,
      )
    }
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      readonly exports?: Readonly<Record<string, unknown>>
    }
    expect(packageJson.exports?.['./linked']).toBe('./src/linked.js')
  })

  it('keeps the complete image entry at the measured hand-authored size', () => {
    const lines = readFileSync(join(commonRoot, 'images', 'src', 'linked.js'), 'utf8')
      .split(/\r?\n/u)
      .filter(line => line.trim().length > 0)
    expect(lines).toHaveLength(102)
  })

  it('has no generated linked-extension package or emitter', () => {
    expect(existsSync(join(repoRoot, 'packages', 'extensions-linked', 'package.json'))).toBe(false)
    expect(existsSync(join(repoRoot, 'scripts', 'emit-linked-extensions.mjs'))).toBe(false)
  })
})
