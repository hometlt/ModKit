/**
 * S12 — connecting extensions: one broken root must not take the application down, a user's
 * directory must never be admitted in-process, and two roots claiming the same extension are a
 * reported conflict rather than a silent race between them.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadExtensionRoots } from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const dataDir = join(repoRoot, 'extensions', 'common', 'data')
const imagesDir = join(repoRoot, 'extensions', 'common', 'images')

const scratch = mkdtempSync(join(tmpdir(), 'x3-extension-roots-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('loadExtensionRoots', () => {
  it('keeps every root that loads and reports the ones that do not', async () => {
    const missing = join(scratch, 'gone')
    const notAnExtension = join(scratch, 'empty')
    mkdirSync(notAnExtension, { recursive: true })
    writeFileSync(join(notAnExtension, 'readme.txt'), 'no manifest here\n')

    const result = await loadExtensionRoots([dataDir, missing, notAnExtension, imagesDir], {
      origin: 'installed',
    })
    expect(result.coordinates).toEqual(['org.modkitx/data', 'org.modkitx/images'])
    expect(result.inputs).toHaveLength(2)
    // a directory that is not there, and one that is not an extension, are failure records
    // rather than exceptions — and neither stops the roots after them from loading
    expect(result.failures.map(item => item.root)).toContain(missing)
    expect(result.failures.find(item => item.root === notAnExtension)?.code).toBe(
      'x3.host/extension-not-an-extension',
    )
    expect(result.inputs.every(input => input.execution?.allowTrustedInProcess === false)).toBe(
      true,
    )
    expect(result.inputs.every(input => input.execution?.origin === 'installed')).toBe(true)
  })

  it('refuses to admit a user root in-process, whatever the caller passes', async () => {
    await expect(
      loadExtensionRoots([dataDir], { origin: 'installed', allowTrustedInProcess: true }),
    ).rejects.toMatchObject({ code: 'x3.host/extension-trust-misdeclared' })
    // bundled roots may be admitted — that decision stays the product's to make explicitly
    const bundled = await loadExtensionRoots([dataDir], {
      origin: 'bundled',
      allowTrustedInProcess: true,
    })
    expect(bundled.inputs[0]?.execution).toEqual({
      origin: 'bundled',
      allowTrustedInProcess: true,
    })
  })

  it('reports a duplicate coordinate instead of loading the same extension twice', async () => {
    const copy = join(scratch, 'data-copy')
    cpSync(dataDir, copy, { recursive: true })
    const result = await loadExtensionRoots([dataDir, copy], { origin: 'installed' })
    expect(result.inputs).toHaveLength(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.code).toBe('x3.host/extension-coordinate-conflict')
    expect(result.failures[0]?.root).toBe(copy)

    // a coordinate the bundled catalog already claimed is refused the same way
    const alreadyClaimed = await loadExtensionRoots([dataDir], {
      origin: 'installed',
      claimed: ['org.modkitx/data'],
    })
    expect(alreadyClaimed.inputs).toEqual([])
    expect(alreadyClaimed.failures[0]?.code).toBe('x3.host/extension-coordinate-conflict')
  })

  it('reports a settings entry whose declared id does not match the directory', async () => {
    const result = await loadExtensionRoots(
      [{ root: dataDir, expectedId: 'org.example/something-else' }],
      { origin: 'installed' },
    )
    expect(result.inputs).toEqual([])
    expect(result.failures[0]).toMatchObject({
      code: 'x3.host/extension-identity-mismatch',
      root: dataDir,
    })
  })
})
