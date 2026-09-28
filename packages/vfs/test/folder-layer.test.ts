import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createLayeredArchiveContentSources } from '../src/content-sources.js'
import { folderLayer } from '../src/content-sources-node.js'

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
