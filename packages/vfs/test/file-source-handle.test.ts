import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { isModkitError } from '@modkit/core'
import { createFileVfsProvider } from '../src/providers/file/index.js'
import { DEFAULT_VFS_LIMITS } from '../src/vfs.js'

const root = await mkdtemp(join(tmpdir(), 'modkit-file-handle-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe('a file source keeps one descriptor', () => {
  it('reads many ranges, still refuses a file written in place, and lets it go on dispose', async () => {
    const path = join(root, 'archive.jar')
    await writeFile(path, Uint8Array.from({ length: 64 }, (_, index) => index))
    const mount = await createFileVfsProvider().open(pathToFileURL(root).href, {
      limits: DEFAULT_VFS_LIMITS,
    })
    const source = await mount.open('archive.jar')
    for (let offset = 0; offset < 64; offset += 8)
      expect([...(await source.readAt(offset, 2))]).toEqual([offset, offset + 1])
    await writeFile(path, new Uint8Array(65))
    await expect(source.readAt(0, 1)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/file-revision-changed',
    )
    await mount.dispose()
    // the descriptor is closed when dispose resolves: the file can go at once
    await rm(path)
  })
})
