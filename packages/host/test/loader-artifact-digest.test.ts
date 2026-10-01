import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadExtensionDirectory } from '../src/node/loader.js'

const temporaries: string[] = []
afterEach(async () => {
  for (const directory of temporaries.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('an extension root loaded without holding the thread', () => {
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
    // the synchronous verification of a codec open agrees with it
    expect(loaded.artifact?.verifyArtifactDigest(loaded.artifact.artifactDigest)).toBe(true)
    await writeFile(join(root, 'b.txt'), 'changed')
    expect(loaded.artifact?.verifyArtifactDigest(loaded.artifact.artifactDigest)).toBe(false)
  })
})
