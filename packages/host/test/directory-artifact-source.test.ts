import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openDirectoryArtifactSource, openPathArtifactSource } from '@modkit/host/node'
import { fileSystemRevisionToken } from '@modkit/vfs/providers/file'

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
  it('binds editing files to physical identities and detects same-size external changes', async () => {
    const directory = await fixture()
    const source = await openDirectoryArtifactSource(directory, { fileUriPolicy: 'physical' })
    const namespace = await source.openNamespace()
    const opened = await namespace.value.open('Triggers')
    try {
      expect(opened.value.ref.uri).toBe(pathToFileURL(join(directory, 'Triggers')).href)
      if (opened.value.kind !== 'bytes') throw new TypeError('expected bytes')
      await writeFile(join(directory, 'Triggers'), 'changed bytes')
      await expect(opened.value.read(0n, 13)).rejects.toMatchObject({
        code: 'x3.host/source-revision-changed',
      })
    } finally {
      await opened.release()
      await namespace.release()
    }
  })
  it('uses the exact filesystem provider revision dialect for directory edits', async () => {
    const directory = await fixture()
    const source = await openDirectoryArtifactSource(directory)
    expect(source.revision).toBe(await fileSystemRevisionToken(directory))
  })

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

  it('propagates child file telemetry through directory and path sources', async () => {
    const directory = await fixture()
    const reads: unknown[] = []
    const streams: unknown[] = []
    const source = await openPathArtifactSource(directory, {
      maxEntries: 16,
      maxDepth: 8,
      onRead: event => {
        reads.push(event)
        throw new Error('read observer must be isolated')
      },
      onStream: event => {
        streams.push(event)
        throw new Error('stream observer must be isolated')
      },
    })
    if (source.kind !== 'namespace') throw new TypeError('expected a namespace source')

    const namespace = await source.openNamespace()
    const opened = await namespace.value.open('MapScript.galaxy')
    if (opened.value.kind !== 'bytes') throw new TypeError('expected bytes')
    expect(new TextDecoder().decode(await opened.value.read(7n, 5))).toBe('bytes')
    const chunks: Uint8Array[] = []
    for await (const chunk of opened.value.stream({ offset: 0n, length: 6n })) chunks.push(chunk)
    expect(new TextDecoder().decode(chunks[0])).toBe('galaxy')

    expect(streams).toEqual([
      {
        uri: opened.value.ref.uri,
        offset: '0',
        length: '6',
      },
    ])
    expect(reads).toEqual([
      {
        uri: opened.value.ref.uri,
        offset: '7',
        requestedBytes: 5,
        bytes: 5,
      },
      {
        uri: opened.value.ref.uri,
        offset: '0',
        requestedBytes: 6,
        bytes: 6,
      },
    ])
    await opened.release()
    await namespace.release()
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
