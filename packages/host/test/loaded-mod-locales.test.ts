import { describe, expect, it } from 'vitest'
import type { ContentSources, ModContext, ModContextRequest } from '@modkit/vfs/content-sources'
import { LoadedModResourceSessions } from '../src/mods/resource-sessions.js'

const layer = (path: string, role: 'dependency' | 'primary') => ({
  id: path,
  displayName: path,
  sourceId: 'local:casc',
  sourcePath: path,
  role,
  provenance: role === 'primary' ? ('opened' as const) : ('implicit' as const),
  kind: 'package' as const,
})

describe('the locales loaded mods open with', () => {
  it('are read at every open, the dependencies and a reload included', async () => {
    const requests: ModContextRequest[] = []
    let chosen: readonly string[] = ['ruRU', 'enUS']
    const source = {
      openModContext: async (request: ModContextRequest) => {
        requests.push(request)
        const path = typeof request.target === 'string' ? request.target : request.target.path
        const layers = path.startsWith('Mods/Liberty')
          ? [layer('Mods/Core.SC2Mod', 'dependency'), layer('Mods/Liberty.SC2Mod', 'primary')]
          : [layer('Mods/Core.SC2Mod', 'primary')]
        return {
          schemaVersion: 1,
          gameId: 'blizzard/starcraft-2',
          contextId: `${path}|${(request.locales ?? []).join(',')}`,
          layers,
          unresolved: [],
          diagnostics: [],
          files: async () => ({ items: [] }),
          read: async () => new Uint8Array(),
          locate: async () => undefined,
          dispose: async () => {},
        } as unknown as ModContext
      },
    } as unknown as ContentSources
    const sessions = new LoadedModResourceSessions(source, { locales: () => chosen })
    await sessions.load({ sourceId: 'local:casc', path: 'Mods/Liberty.SC2Mod' })
    expect(requests.map(request => request.locales)).toEqual([
      ['ruRU', 'enUS'],
      ['ruRU', 'enUS'],
    ])
    chosen = ['deDE']
    await sessions.reloadAll()
    expect(requests.slice(2).map(request => request.locales)).toEqual([['deDE'], ['deDE']])
    await sessions.dispose()
  })
})
