import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as codecKit from '../src/index.js'

// The bundled extensions' codecs are JavaScript: tsc never sees their named imports, and they run
// against the built dist, so a lost export stayed invisible until the next dist (9e66ca8d dropped
// createVectorSceneSource and SVG/EMF/WMF/fonts opened as text). Check them against the source.
const repo = join(import.meta.dirname, '..', '..', '..')

describe('codec-kit exports the bundled extensions import', () => {
  it('has every name a bundled JS codec imports from @modkit/codec-kit', () => {
    const files = execFileSync('git', ['ls-files', '--', 'extensions/*.js', 'extensions/*.mjs'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(file => file !== '' && !/\/(dist|test)\//u.test(file))
    const missing: string[] = []
    for (const file of files) {
      const text = readFileSync(join(repo, file), 'utf8')
      for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@modkit\/codec-kit'/gu))
        for (const item of match[1]!.split(',')) {
          const name = item
            .trim()
            .replace(/^type\s+/u, '')
            .split(/\s+as\s+/u)[0]!
          if (name !== '' && !item.trim().startsWith('type ') && !(name in codecKit))
            missing.push(`${file}: ${name}`)
        }
    }
    expect(files.length).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })
})
