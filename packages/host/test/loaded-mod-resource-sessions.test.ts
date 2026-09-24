import { describe, expect, it } from 'vitest'
import type { ContentSources, ModContext, ModContextTarget } from '@modkit/vfs/content-sources'
import { LoadedModResourceSessions } from '../src/mods/resource-sessions.js'

describe('loaded mod resources', () => {
  it('keeps one server session per package across editor targets and exposes its effective tree', async () => {
    let released = 0
    const context = (target: ModContextTarget): ModContext => ({
      schemaVersion: 1,
      gameId: 'blizzard/starcraft-2',
      contextId: String(typeof target === 'string' ? target : target.path).includes('Core') ? 'core' : 'liberty',
      layers: [
        ...(String(typeof target === 'string' ? target : target.path).includes('Liberty')
          ? [{ id: 'core', displayName: 'Core.SC2Mod', sourceId: 'local:casc',
              sourcePath: 'Mods/Core.SC2Mod', role: 'dependency' as const, provenance: 'implicit' as const }]
          : []),
        { id: 'primary', displayName: String(typeof target === 'string' ? target : target.path).includes('Core')
            ? 'Core.SC2Mod' : 'Liberty.SC2Mod', sourceId: 'local:casc',
          sourcePath: String(typeof target === 'string' ? target : target.path).includes('Core')
            ? 'Mods/Core.SC2Mod' : 'Mods/Liberty.SC2Mod', role: 'primary', provenance: 'opened' },
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
    const source = { openModContext: async (request: { target: ModContextTarget }) => context(request.target) } as ContentSources
    const sessions = new LoadedModResourceSessions(source, path => /\.sc2mod$/iu.test(path))
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
})
