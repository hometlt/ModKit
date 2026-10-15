import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadExtensionDirectory } from '../src/node/loader.js'

const reads = vi.hoisted(() => ({
  before: undefined as ((path: unknown, options: unknown) => Promise<void>) | undefined,
  after: undefined as ((path: unknown, options: unknown) => void) | undefined,
}))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await reads.before?.(args[0], args[1])
      const value = await actual.readFile(...args)
      reads.after?.(args[0], args[1])
      return value
    },
  }
})

const temporaries: string[] = []
afterEach(async () => {
  reads.before = undefined
  reads.after = undefined
  for (const directory of temporaries.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('an extension root loaded without holding the thread', () => {
  it('reads declared documents concurrently within the IO ceiling and retains their order and digests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'x3-loader-manifests-'))
    temporaries.push(root)
    await mkdir(join(root, 'contributions'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-manifests', version: '1.0.0', license: 'MIT', modkit: {
      schemaVersion: 1, publisher: 'fixture', id: 'manifests',
      contributionManifests: ['./contributions/*.json'],
    } }))
    const paths = Array.from({ length: 40 }, (_, i) => `contributions/${String(i).padStart(2, '0')}.json`)
    await Promise.all(paths.map((path, index) => writeFile(join(root, path), JSON.stringify({ index }))))
    let release = (): void => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let entered = (): void => undefined
    const started = new Promise<void>(resolve => { entered = resolve })
    const requested: string[] = []
    reads.before = async (path, options) => {
      if (options !== 'utf8' || !String(path).replaceAll('\\', '/').includes('/contributions/')) return
      requested.push(String(path))
      if (requested.length === 1) {
        entered()
        await gate
      }
    }
    const pending = loadExtensionDirectory(root)
    try {
      await started
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(requested).toHaveLength(32)
    } finally { release(); await pending }
    const loaded = await pending
    expect([...loaded.documents.keys()]).toEqual(paths)
    expect([...loaded.documentDigests!.keys()]).toEqual(paths)
    for (const [index, path] of paths.entries()) {
      expect(loaded.documents.get(path)).toEqual({ index })
      const digest = `sha256:${createHash('sha256').update(JSON.stringify({ index })).digest('hex')}`
      expect(loaded.documentDigests!.get(path)).toBe(digest)
      expect(loaded.artifact?.fileDigests?.[path]).toBe(digest)
    }
  }, 15_000)

  it('reports the first declared malformed document even if a later read finishes first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'x3-loader-manifest-errors-'))
    temporaries.push(root)
    await mkdir(join(root, 'contributions'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture-errors', version: '1.0.0', license: 'MIT', modkit: {
      schemaVersion: 1, publisher: 'fixture', id: 'errors',
      contributionManifests: ['./contributions/*.json'],
    } }))
    await writeFile(join(root, 'contributions', 'a.json'), 'FIRST_INVALID_JSON')
    await writeFile(join(root, 'contributions', 'b.json'), 'LATER_INVALID_JSON')
    let expected = ''
    try { JSON.parse('FIRST_INVALID_JSON') } catch (error) { expected = (error as Error).message }
    let release = (): void => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const completed: string[] = []
    reads.before = async (path, options) => {
      if (options === 'utf8' && String(path).endsWith('a.json')) await gate
    }
    reads.after = (path, options) => {
      if (options !== 'utf8' || !String(path).endsWith('.json') || String(path).endsWith('package.json')) return
      completed.push(String(path))
      // The later JSON is parsed before the next turn releases the first read.
      if (String(path).endsWith('b.json')) setImmediate(release)
    }
    const fallback = setTimeout(release, 2_000)
    try {
      await expect(loadExtensionDirectory(root)).rejects.toThrow(expected)
      expect(completed[0]).toBe(join(root, 'contributions', 'b.json'))
    }
    finally { clearTimeout(fallback); release() }
  })

  it('has the digest of its tree: paths sorted, each length-prefixed with its contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'x3-loader-digest-'))
    temporaries.push(root)
    const files: Record<string, string> = {
      'b.txt': 'second',
      'a/z.json': '{"z":1}',
      'a/b/c.js': 'export {}',
      'dist/codec.js': 'export const built = true',
    }
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), text)
    }
    // never part of the artifact
    await mkdir(join(root, 'node_modules', 'x'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'x', 'index.js'), 'ignored')

    const loaded = await loadExtensionDirectory(root)

    const ordered = ['a/b/c.js', 'a/z.json', 'b.txt', 'dist/codec.js']
    const reference = createHash('sha256')
    for (const path of ordered) {
      const pathBytes = Buffer.from(path, 'utf8')
      const contents = Buffer.from(files[path]!, 'utf8')
      reference.update(`${pathBytes.byteLength}\0`)
      reference.update(pathBytes)
      reference.update(`\0${contents.byteLength}\0`)
      reference.update(contents)
    }
    expect(loaded.artifact?.artifactDigest).toBe(`sha256:${reference.digest('hex')}`)
    expect(loaded.artifact?.fileDigests?.['b.txt']).toBe(
      `sha256:${createHash('sha256').update('second').digest('hex')}`,
    )
    // the inventory's listing leaves build output out; the artifact keeps it
    expect(loaded.files).toEqual(['a/b/c.js', 'a/z.json', 'b.txt'])
    // asynchronous verification of a codec open agrees with it
    expect(await loaded.artifact?.verifyArtifactDigest(loaded.artifact.artifactDigest)).toBe(true)
    await writeFile(join(root, 'b.txt'), 'changed')
    expect(await loaded.artifact?.verifyArtifactDigest(loaded.artifact.artifactDigest)).toBe(false)
  })
})
