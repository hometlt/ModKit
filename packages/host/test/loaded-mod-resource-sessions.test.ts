import { describe, expect, it } from 'vitest'
import type { ContentSources, ModContext, ModContextTarget } from '@modkit/vfs/content-sources'
import { LoadedModResourceSessions } from '../src/mods/resource-sessions.js'

describe('loaded mod resources', () => {
  it('replaces a context from an older transport generation', async () => {
    let generation = 'connection-1'
    const released: string[] = []
    const source = { openModContext: async (): Promise<ModContext> => {
      const openedAt = generation
      return {
        schemaVersion: 1, gameId: 'test/game', contextId: 'same-chain-and-session', generation,
        layers: [{ id: 'primary', displayName: 'Mine', sourceId: 'host', sourcePath: 'C:/Mods/Mine',
          role: 'primary', provenance: 'opened', kind: 'package' }],
        unresolved: [], diagnostics: [], files: async () => ({ items: [] }), read: async () => new Uint8Array(),
        locate: async () => undefined, dispose: async () => { released.push(openedAt) },
      }
    } } satisfies Pick<ContentSources, 'openModContext'>
    const sessions = new LoadedModResourceSessions(source)
    await sessions.load('C:/Mods/Mine')
    generation = 'connection-2'
    expect(await sessions.load('C:/Mods/Mine')).toBe(true)
    expect(released).toEqual(['connection-1'])
    await sessions.dispose()
    expect(released).toEqual(['connection-1', 'connection-2'])
  })
  it('keeps one server session per package across editor targets and exposes its effective tree', async () => {
    let released = 0
    const context = (target: ModContextTarget): ModContext => ({
      schemaVersion: 1,
      gameId: 'blizzard/starcraft-2',
      contextId: String(typeof target === 'string' ? target : target.path).includes('Core') ? 'core' : 'liberty',
      layers: [
        ...(String(typeof target === 'string' ? target : target.path).includes('Liberty')
          ? [{ id: 'core', displayName: 'Core.SC2Mod', sourceId: 'local:casc',
              sourcePath: 'Mods/Core.SC2Mod', role: 'dependency' as const, provenance: 'implicit' as const, kind: 'package' as const }]
          : []),
        { id: 'primary', displayName: String(typeof target === 'string' ? target : target.path).includes('Core')
            ? 'Core.SC2Mod' : 'Liberty.SC2Mod', sourceId: 'local:casc',
          sourcePath: String(typeof target === 'string' ? target : target.path).includes('Core')
            ? 'Mods/Core.SC2Mod' : 'Mods/Liberty.SC2Mod', role: 'primary', provenance: 'opened', kind: 'package' },
      ],
      unresolved: [], diagnostics: [],
      files: async () => ({ items: [] }), read: async () => new Uint8Array(),
      locate: async () => undefined,
      query: async request => {
        const value = request as { action: string; node?: { id: string } }
        if (value.action === 'root') return { id: 'root', hasChildren: true }
        if (value.action === 'children') return { items: value.node?.id === 'root'
          ? [{ id: 'category/strings', hasChildren: false }] : [] }
        if (value.action === 'facts') return { kind: 'strings-category', label: 'Strings', value: 12 }
        return { items: [] }
      },
      dispose: async () => { released += 1 },
    })
    const source = { openModContext: async (request: { target: ModContextTarget }) => context(request.target) } satisfies Pick<ContentSources, 'openModContext'>
    const sessions = new LoadedModResourceSessions(source)
    expect(await sessions.load({ sourceId: 'local:casc', path: 'Mods/Liberty.SC2Mod/Base.SC2Data/GameData/UnitData.xml' })).toBe(true)
    expect(await sessions.load({ sourceId: 'local:casc', path: 'Mods/Liberty.SC2Mod/Base.SC2Data/TriggerLibs/Liberty.galaxy' })).toBe(false)
    expect(sessions.list()).toHaveLength(2)
    const tree = sessions.tree()
    const root = await tree.root()
    const mods = await tree.children(root, { limit: 10 })
    expect(mods.items).toHaveLength(2)
    expect((await sessions.tree(false).children(root, { limit: 10 })).items).toHaveLength(1)
    const sections = await tree.children(mods.items[1]!, { limit: 10 })
    expect(await tree.facts(sections.items[0]!)).toMatchObject({ label: 'Strings', value: 12 })
    expect(released).toBe(1) // Only the redundant Liberty context was released.
    await sessions.reloadAll()
    expect((await sessions.tree().children(root, { limit: 10 })).items).toHaveLength(2)
    expect(released).toBe(3) // Original Core and Liberty were replaced together.
    await sessions.dispose()
    expect(released).toBe(5)
  })

  it('opens a mod once when the editor and the tree ask for it at the same time', async () => {
    const opened: string[] = []
    const layer = (path: string, role: 'dependency' | 'primary') => ({ id: path, displayName: path, sourceId: 'local:casc',
      sourcePath: path, role, provenance: role === 'primary' ? 'opened' as const : 'implicit' as const, kind: 'package' as const })
    const source = { openModContext: async (request: { target: ModContextTarget }) => {
      const path = typeof request.target === 'string' ? request.target : request.target.path
      opened.push(path)
      await new Promise(resolve => setTimeout(resolve, 5))
      return { schemaVersion: 1, gameId: 'blizzard/starcraft-2', contextId: path,
        layers: path === 'Mods/Core.SC2Mod' ? [layer(path, 'primary')]
          : [layer('Mods/Core.SC2Mod', 'dependency'), layer('Mods/Liberty.SC2Mod', 'primary')],
        unresolved: [], diagnostics: [], files: async () => ({ items: [] }), read: async () => new Uint8Array(),
        locate: async () => undefined, dispose: async () => {} } satisfies ModContext
    } } satisfies Pick<ContentSources, 'openModContext'>
    const sessions = new LoadedModResourceSessions(source)
    const target = { sourceId: 'local:casc', path: 'Mods/Liberty.SC2Mod' }
    expect(await Promise.all([sessions.load(target), sessions.load({ ...target })])).toEqual([true, true])
    expect(opened).toEqual(['Mods/Liberty.SC2Mod', 'Mods/Core.SC2Mod'])
    expect(await sessions.load(target)).toBe(false)
    await sessions.dispose()
  })

  it('reopens only the mods whose chain holds a changed file', async () => {
    const opened: string[] = []
    const released: string[] = []
    const layer = (path: string, role: 'dependency' | 'primary') => ({ id: path, displayName: path, sourceId: 'host',
      sourcePath: path, role, provenance: role === 'primary' ? 'opened' as const : 'implicit' as const, kind: 'package' as const })
    let revision = 0
    const source = { openModContext: async (request: { target: ModContextTarget }) => {
      const path = typeof request.target === 'string' ? request.target : request.target.path
      opened.push(path)
      const id = `${path}#${revision}`
      return { schemaVersion: 1, gameId: 'blizzard/starcraft-2', contextId: id,
        layers: path === 'C:/Mods/Shared.SC2Mod' ? [layer(path, 'primary')]
          : [layer('C:/Mods/Shared.SC2Mod', 'dependency'), layer(path, 'primary')],
        unresolved: [], diagnostics: [], files: async () => ({ items: [] }), read: async () => new Uint8Array(),
        locate: async () => undefined, dispose: async () => { released.push(id) } } satisfies ModContext
    } } satisfies Pick<ContentSources, 'openModContext'>
    const sessions = new LoadedModResourceSessions(source)
    await sessions.load('C:/Mods/Alpha.SC2Mod')
    await sessions.load('C:/Mods/Beta.SC2Mod')
    opened.length = 0
    revision = 1
    // a string file of Alpha changes on disk: Beta and the shared dependency keep their contexts
    expect(await sessions.reloadHolding('host', 'C:\\Mods\\Alpha.SC2Mod\\enUS.SC2Data\\LocalizedData\\GameStrings.txt')).toBe(true)
    expect(opened).toEqual(['C:/Mods/Alpha.SC2Mod', 'C:/Mods/Shared.SC2Mod'])
    expect(released.sort()).toEqual(['C:/Mods/Alpha.SC2Mod#0', 'C:/Mods/Shared.SC2Mod#1'])
    expect(sessions.list().map(mod => mod.contextId).sort()).toEqual(
      ['C:/Mods/Alpha.SC2Mod#1', 'C:/Mods/Beta.SC2Mod#0', 'C:/Mods/Shared.SC2Mod#0'])
    // the shared dependency changes: every mod over it reopens
    opened.length = 0
    expect(await sessions.reloadHolding('host', 'c:/mods/shared.sc2mod/Base.SC2Data/GameData/UnitData.xml')).toBe(true)
    expect(opened.filter(path => !path.includes('Shared')).sort()).toEqual(['C:/Mods/Alpha.SC2Mod', 'C:/Mods/Beta.SC2Mod'])
    expect(await sessions.reloadHolding('host', 'C:/Elsewhere/readme.txt')).toBe(false)
    await sessions.dispose()
  })

  it('lists a mod without semantic resources without failing the tree, and unloads what only it loaded', async () => {
    const released: string[] = []
    const layer = (path: string, role: 'dependency' | 'primary') => ({ id: path, displayName: path, sourceId: 'local:beyond-all-reason',
      sourcePath: path, role, provenance: role === 'primary' ? 'opened' as const : 'implicit' as const, kind: 'package' as const })
    // a game and its dependencies: plain folder layers that answer no resource questions
    const chains: Record<string, readonly string[]> = {
      'games/bar.sdd': ['base/springbitmaps.sdz', 'base/springcontent.sdz', 'games/bar.sdd'],
      'maps/rosetta.sd7': ['base/springcontent.sdz', 'maps/rosetta.sd7'],
      'base/springbitmaps.sdz': ['base/springbitmaps.sdz'],
      'base/springcontent.sdz': ['base/springcontent.sdz'],
    }
    const source = { openModContext: async (request: { target: ModContextTarget }) => {
      const path = typeof request.target === 'string' ? request.target : request.target.path
      const chain = chains[path]!
      return { schemaVersion: 1, gameId: 'spring/beyond-all-reason', contextId: path,
        layers: chain.map((item, index) => layer(item, index === chain.length - 1 ? 'primary' : 'dependency')),
        unresolved: [], diagnostics: [], files: async () => ({ items: [] }), read: async () => new Uint8Array(),
        locate: async () => undefined,
        ...(path === 'games/bar.sdd' ? { query: async () => ({ items: [{ id: 'unit/armcom', hasChildren: false }] }) } : {}),
        dispose: async () => void released.push(path) } satisfies ModContext
    } } satisfies Pick<ContentSources, 'openModContext'>
    const sessions = new LoadedModResourceSessions(source)
    const target = (path: string) => ({ sourceId: 'local:beyond-all-reason', path })
    await sessions.load(target('games/bar.sdd'))
    await sessions.load(target('maps/rosetta.sd7'))
    const tree = sessions.tree()
    const mods = (await tree.children(await tree.root(), { limit: 10 })).items
    expect(mods).toHaveLength(4)
    // the folder layers have no children; search asks only the mod that answers
    const bitmaps = mods.find(item => item.id.includes('springbitmaps'))!
    expect(bitmaps.hasChildren).toBe(false)
    expect((await tree.children(bitmaps, { limit: 10 })).items).toEqual([])
    const found = []
    for await (const item of tree.search!({ pattern: 'armcom' })) found.push(item)
    expect(found).toHaveLength(1)
    // unloading the game unloads the dependency only it loaded, not the one the map stands on too
    await sessions.unload('spring/beyond-all-reason|local:beyond-all-reason|games/bar.sdd')
    expect(released.sort()).toEqual(['base/springbitmaps.sdz', 'games/bar.sdd'])
    expect(sessions.list().map(mod => mod.id.split('|')[2]).sort()).toEqual(['base/springcontent.sdz', 'maps/rosetta.sd7'])
    await sessions.dispose()
  })

  it('skips a mod whose context answers no resource questions, in its children and in search', async () => {
    const layer = (path: string) => ({ id: path, displayName: path, sourceId: 'local:game', sourcePath: path,
      role: 'primary' as const, provenance: 'opened' as const, kind: 'package' as const })
    const source = { openModContext: async (request: { target: ModContextTarget }) => {
      const path = typeof request.target === 'string' ? request.target : request.target.path
      return { schemaVersion: 1, gameId: path === 'westwood' ? 'ea/red-alert-2' : 'blizzard/starcraft-2', contextId: path,
        layers: [layer(path)], unresolved: [], diagnostics: [], files: async () => ({ items: [] }),
        read: async () => new Uint8Array(), locate: async () => undefined,
        // Westwood answers data.entities only, and refuses every other question
        query: async (question: unknown) => {
          if (path === 'westwood') throw new RangeError('a Westwood context answers { kind: "data.entities", refs } only')
          const action = (question as { action: string }).action
          if (action === 'root') return { id: 'root', hasChildren: true }
          return { items: [{ id: 'unit/marine', hasChildren: false }] }
        },
        dispose: async () => {} } satisfies ModContext
    } } satisfies Pick<ContentSources, 'openModContext'>
    const sessions = new LoadedModResourceSessions(source)
    await sessions.load({ sourceId: 'local:game', path: 'westwood' })
    await sessions.load({ sourceId: 'local:game', path: 'liberty' })
    const tree = sessions.tree()
    const mods = (await tree.children(await tree.root(), { limit: 10 })).items
    const westwood = mods.find(item => item.id.includes('westwood'))!
    expect((await tree.children(westwood, { limit: 10 })).items).toEqual([])
    const found = []
    for await (const item of tree.search!({ pattern: 'marine' })) found.push(item)
    expect(found).toHaveLength(1)
    await sessions.dispose()
  })
})
