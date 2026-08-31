import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverTextDataEntrypoints,
  relativeEntrypointSpecifier,
} from '../text-data-entrypoints.mjs'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function contribution(root: string, packageName: string, kind: 'codec' | 'provider') {
  const extension = join(root, 'extensions', 'data', packageName)
  const contributions = join(extension, 'contributions')
  const implementation = join(extension, 'src', 'moved-family')
  mkdirSync(contributions, { recursive: true })
  mkdirSync(implementation, { recursive: true })
  const entrypoint = join(implementation, `${kind}.js`)
  writeFileSync(entrypoint, 'export const createCodec = () => ({})\n')
  const manifest = {
    contract: {
      id: kind === 'codec' ? 'modkit/codec-contribution' : 'modkit/service-provider-contribution',
    },
    runtimeVariants: [{ entrypoint: `./src/moved-family/${kind}.js` }],
    spec:
      kind === 'codec'
        ? { formatRefs: [{ formatId: 'json' }] }
        : { provides: [{ contract: 'common.text-data/json-syntax' }] },
  }
  writeFileSync(join(contributions, `${kind}.json`), JSON.stringify(manifest))
}

describe('text-data contribution entrypoint discovery', () => {
  it('continues to resolve entrypoints after the extension directory is renamed', () => {
    const root = mkdtempSync(join(tmpdir(), 'modkit-entrypoints-'))
    temporary.push(root)
    contribution(root, 'original-name', 'codec')
    contribution(root, 'original-name', 'provider')
    renameSync(
      join(root, 'extensions', 'data', 'original-name'),
      join(root, 'extensions', 'data', 'renamed-extension'),
    )

    const result = discoverTextDataEntrypoints(root, ['json'])
    expect(result).toHaveLength(2)
    expect(result.every(entry => entry.absolute?.includes('renamed-extension'))).toBe(true)
    expect(result.every(entry => entry.reason === undefined)).toBe(true)
  })

  it('emits portable gallery specifiers and keeps the tracked generated module path-independent', () => {
    const checkout = join(tmpdir(), 'portable-modkit-checkout')
    expect(
      relativeEntrypointSpecifier(
        join(checkout, 'examples', 'gallery', 'src', 'generated.ts'),
        join(checkout, 'packages', 'host', 'native-text', 'json', 'codec.js'),
      ),
    ).toBe('../../../packages/host/native-text/json/codec.js')

    const tracked = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        'examples',
        'modkit-ui-gallery',
        'src',
        'text-data-entrypoints.generated.ts',
      ),
      'utf8',
    )
    expect(tracked).not.toMatch(/[A-Za-z]:[\\/]/u)
    expect(tracked).toContain("from '../../../packages/host/native-text/json/")
  })
})
