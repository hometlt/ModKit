import { describe, expect, it, vi } from 'vitest'
import type { ContentSources } from '@modkit/vfs/content-sources'

import { createContainerDependencyContentSources } from '../src/container-content-sources.js'

const baseSources = (resolveDependencies = vi.fn()): ContentSources => ({
  async snapshot() {
    return { label: 'test', regions: [], connections: [], roots: [] }
  },
  async connect() {},
  async disconnect() {},
  async search() {
    return []
  },
  async add() {},
  async remove() {},
  async refresh() {},
  async list() {
    return []
  },
  async read() {
    return new Uint8Array()
  },
  resolveDependencies,
  dispose() {},
})

describe('container dependency content sources', () => {
  it('mounts installed mods from the current CASC container and exposes their files', async () => {
    const resolveDependencies = vi.fn()
    const read = vi.fn(async () => new TextEncoder().encode('<Catalog/>'))
    const containers = {
      async stat(_container: string, path: string) {
        return path.endsWith('.xml')
          ? { name: 'UnitData.xml', kind: 'file' as const, size: 10 }
          : { name: path.split('/').at(-1) ?? '', kind: 'directory' as const }
      },
      async list(_container: string, path: string) {
        if (/\.(?:SC2Mod|SC2Campaign)$/u.test(path)) {
          return [{ name: 'Base.SC2Data', kind: 'directory' as const }]
        }
        return path.endsWith('GameData')
          ? [{ name: 'UnitData.xml', kind: 'file' as const, size: 10 }]
          : [{ name: 'GameData', kind: 'directory' as const }]
      },
      async walk(_container: string, path: string) {
        return [
          {
            id: `${path}/Base.SC2Data/GameData/UnitData.xml`,
            path: `${path}/GameData/UnitData.xml`,
            name: 'UnitData.xml',
            kind: 'file' as const,
            size: 10n,
            revision: 'provider-token:test-entry' as never,
          },
        ]
      },
      read,
    }
    const sources = createContainerDependencyContentSources(
      baseSources(resolveDependencies),
      containers,
      'C:\\Games\\StarCraft II',
    )
    const resolution = await sources.resolveDependencies!({
      schemaVersion: 1,
      gameId: 'blizzard/starcraft-2',
      complete: true,
      dependencies: [
        {
          id: 'installation:mods/core.sc2mod',
          kind: 'installation-mod',
          required: false,
          order: 0,
          state: 'unresolved',
          path: 'Mods/Core.SC2Mod',
        },
        {
          id: 'installation:mods/liberty.sc2mod',
          kind: 'installation-mod',
          required: false,
          order: 1,
          state: 'unresolved',
          path: 'Mods/Liberty.SC2Mod',
        },
        {
          id: 'installation:campaigns/voidstory.sc2campaign',
          kind: 'installation-mod',
          required: false,
          order: 2,
          state: 'unresolved',
          path: 'Campaigns/VoidStory.SC2Campaign',
        },
      ],
    })

    expect(resolveDependencies).not.toHaveBeenCalled()
    expect(resolution.complete).toBe(true)
    expect(resolution.mounts.map(mount => mount.sourcePath)).toEqual([
      'Mods/Core.SC2Mod',
      'Mods/Liberty.SC2Mod',
      'Campaigns/VoidStory.SC2Campaign',
    ])
    expect(resolution.mounts.every(mount => mount.fingerprint?.startsWith('provider-token:'))).toBe(
      true,
    )
    const mount = resolution.mounts[0]!
    expect(await sources.list(mount.sourceId, mount.sourcePath)).toEqual([
      {
        path: 'Mods/Core.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
        name: 'UnitData.xml',
        directory: false,
        size: 10,
      },
    ])
    expect(await sources.list(mount.sourceId, `${mount.sourcePath}/Base.SC2Data`)).toEqual([
      {
        path: 'Mods/Core.SC2Mod/Base.SC2Data/GameData',
        name: 'GameData',
        directory: true,
      },
    ])
    expect(
      new TextDecoder().decode(
        await sources.read(
          mount.sourceId,
          `${mount.sourcePath}/Base.SC2Data/GameData/UnitData.xml`,
          100,
        ),
      ),
    ).toBe('<Catalog/>')
    expect(read).toHaveBeenCalledWith(
      'C:\\Games\\StarCraft II',
      'Mods/Core.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
    )
  })

  it('delegates dependencies that do not exist in the current container', async () => {
    const resolveDependencies = vi.fn(async request => ({
      schemaVersion: 1 as const,
      gameId: request.gameId,
      complete: false,
      mounts: [],
      dependencies: request.dependencies,
      diagnostics: [],
    }))
    const sources = createContainerDependencyContentSources(
      baseSources(resolveDependencies),
      {
        async stat() {
          throw new RangeError('missing')
        },
        async list() {
          return []
        },
        async walk() {
          return []
        },
        async read() {
          return new Uint8Array()
        },
      },
      'archive.SC2Map',
    )
    const dependency = {
      id: 'installation:mods/core.sc2mod',
      kind: 'installation-mod',
      required: true,
      order: 0,
      state: 'unresolved',
      path: 'Mods/Core.SC2Mod',
    }
    const resolution = await sources.resolveDependencies!({
      schemaVersion: 1,
      gameId: 'blizzard/starcraft-2',
      complete: true,
      dependencies: [dependency],
    })
    expect(resolveDependencies).toHaveBeenCalledWith(
      expect.objectContaining({ dependencies: [dependency] }),
    )
    expect(resolution.complete).toBe(false)
  })
})
