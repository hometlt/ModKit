import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDirectoryArtifactSource, openPathArtifactSource } from '@modkit/host/node'

const temporary: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'modkit-directory-source-'))
  temporary.push(directory)
  await writeFile(join(directory, 'Triggers'), 'trigger bytes')
  await writeFile(join(directory, 'MapScript.galaxy'), 'galaxy bytes')
  return directory
}

describe('bounded filesystem directory artifact source', () => {
  it('opens a loose directory as one namespace and keeps child reads confined', async () => {
    const directory = await fixture()
    const source = await openPathArtifactSource(directory, { maxEntries: 16, maxDepth: 8 })
    expect(source.kind).toBe('namespace')
    if (source.kind !== 'namespace') throw new TypeError('expected a namespace source')

    const lease = await source.openNamespace()
    const listed = []
    for await (const entry of lease.value.list('')) listed.push(entry)
    expect(listed).toEqual([
      { path: 'MapScript.galaxy', kind: 'file', size: 12n },
      { path: 'Triggers', kind: 'file', size: 13n },
    ])

    const opened = await lease.value.open('Triggers')
    expect(opened.value.kind).toBe('bytes')
    if (opened.value.kind !== 'bytes') throw new TypeError('expected bytes')
    expect(new TextDecoder().decode(await opened.value.read(0n, 13))).toBe('trigger bytes')
    await opened.release()
    await expect(lease.value.open('../outside')).rejects.toMatchObject({
      code: 'x3.host/namespace-path-refused',
    })
    await lease.release()
  })

  it('fails closed when a listing exceeds its declared entry budget', async () => {
    const source = await openDirectoryArtifactSource(await fixture(), { maxEntries: 1 })
    const lease = await source.openNamespace()
    const consume = async () => {
      for await (const _entry of lease.value.list('')) void _entry
    }
    await expect(consume()).rejects.toMatchObject({
      code: 'x3.host/directory-entry-budget-exceeded',
    })
    await lease.release()
  })
})
