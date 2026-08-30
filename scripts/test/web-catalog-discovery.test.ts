import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { selectWebExtensions } from '../emit-web-catalog.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('manifest-driven web extension discovery', () => {
  it('finds nested extension roots and ignores ordinary nested packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'x3-web-catalog-nested-'))
    temporaryRoots.push(root)
    const common = join(root, 'extensions', 'common')
    const group = join(common, 'data')
    mkdirSync(group, { recursive: true })
    writeFileSync(
      join(group, 'package.json'),
      `${JSON.stringify({ name: 'grouping-only', private: true }, undefined, 2)}\n`,
      'utf8',
    )
    cpSync(join(repoRoot, 'extensions', 'common', 'images'), join(group, 'images'), {
      recursive: true,
      filter: source => !source.includes(`${join('images', 'node_modules')}`),
    })

    const selection = selectWebExtensions(root)
    expect(selection.included).toHaveLength(1)
    expect(selection.included[0]).toMatchObject({
      name: 'images',
      relativePath: 'common/data/images',
    })
    expect(selection.excluded).toEqual([])
  })
})
