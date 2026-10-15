import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { createLayeredArchiveContentSources } from '../src/content-sources.js'
import { fileRangeSource, folderLayer, windowsHiddenPaths } from '../src/content-sources-node.js'

const root = await mkdtemp(join(tmpdir(), 'modkit-folder-layer-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe('a folder as a layer of an installation tree', () => {
  it('lists its files, reads a listed one within the limit and sits over the game', async () => {
    const maps = join(root, 'Maps')
    await mkdir(join(maps, 'Skirmish'), { recursive: true })
    await mkdir(join(maps, '.git'), { recursive: true })
    await writeFile(join(maps, 'Skirmish', 'Tournament.map'), 'user map')
    await writeFile(join(maps, 'readme.txt'), 'hello')
    await writeFile(join(maps, '.git', 'HEAD'), 'ref')
    const layer = await folderLayer(maps, { ignore: name => name === '.git' })
    expect(layer.entries.map(entry => entry.path)).toEqual([
      'Skirmish/Tournament.map',
      'readme.txt',
    ])
    expect(new TextDecoder().decode(await layer.read('readme.txt', 16))).toBe('hello')
    await expect(layer.read('readme.txt', 2)).rejects.toThrow(/exceeds/u)
    await expect(layer.read('.git/HEAD', 16)).rejects.toThrow(/has no/u)
    expect((await folderLayer(maps)).entries).toHaveLength(3)
    await expect(folderLayer(maps, { maxFiles: 1 })).rejects.toThrow(/more than 1 files/u)

    const game = {
      id: 'game.big',
      entries: [{ path: 'Skirmish/Tournament.map' }, { path: 'data/ini/object.ini' }],
      async read(path: string) {
        return new TextEncoder().encode(`game ${path}`)
      },
      close() {},
    }
    const sources = createLayeredArchiveContentSources('Game', [
      {
        root: { id: 'local:game', label: 'Game', region: 'local', kind: 'local' },
        open: async () => [layer, game],
      },
    ])
    const read = async (path: string) =>
      new TextDecoder().decode(await sources.read('local:game', path, 64))
    expect(await read('Skirmish/Tournament.map')).toBe('user map')
    expect(await read('data/ini/object.ini')).toBe('game data/ini/object.ini')
    await sources.dispose()
  })
})

describe('what Windows marks hidden on disk', () => {
  it.runIf(process.platform === 'win32')(
    'is listed marked hidden, a hidden folder with all under it; a dot name is not hidden',
    async () => {
      const mods = join(root, 'User mods')
      await mkdir(join(mods, 'AppData', 'deep'), { recursive: true })
      await mkdir(join(mods, '.minecraft'), { recursive: true })
      await writeFile(join(mods, 'AppData', 'deep', 'save.dat'), 's')
      await writeFile(join(mods, '.minecraft', 'options.txt'), 'o')
      await writeFile(join(mods, 'desktop.ini'), 'd')
      await writeFile(join(mods, 'mod.txt'), 'm')
      await writeFile(join(mods, '.minecraft', 'hidden.txt'), 'h')
      const attrib = promisify(execFile)
      await attrib('attrib', ['+h', join(mods, 'AppData')])
      await attrib('attrib', ['+h', join(mods, 'desktop.ini')])
      await attrib('attrib', ['+h', join(mods, '.minecraft', 'hidden.txt')])
      expect([...(await windowsHiddenPaths(mods))].sort()).toEqual(['.minecraft/hidden.txt', 'AppData', 'desktop.ini'])
      expect([...(await windowsHiddenPaths(mods, undefined, { recursive: false }))].sort())
        .toEqual(['AppData', 'desktop.ini'])
      const layer = await folderLayer(mods)
      expect(layer.entries).toEqual([
        { path: '.minecraft/hidden.txt', hidden: true },
        { path: '.minecraft/options.txt' },
        { path: 'AppData/deep/save.dat', hidden: true },
        { path: 'desktop.ini', hidden: true },
        { path: 'mod.txt' },
      ])
      // a hidden file is still read by its exact path
      expect(new TextDecoder().decode(await layer.read('desktop.ini', 4))).toBe('d')
    },
  )
})

describe('a game archive on disk read by ranges', () => {
  it('fills each read, comes back short at the end and releases its handle', async () => {
    const path = join(root, 'archive.mix')
    await writeFile(
      path,
      Uint8Array.from({ length: 300 }, (_, index) => index % 251),
    )
    const source = fileRangeSource(path)
    expect(await source.size()).toBe(300n)
    expect([...(await source.read(250n, 3))]).toEqual([250, 0, 1])
    expect((await source.read(290n, 20)).byteLength).toBe(10)
    await expect(source.read(-1n, 1)).rejects.toThrow(/non-negative/u)
    await source.close()
    // reopened on demand after close
    expect((await source.read(0n, 2)).byteLength).toBe(2)
    await source.close()
  })
})
