import { describe, expect, it } from 'vitest'
import type { DataWorkspacePlan, DataWorkspacePlanRequest } from '@modkit/sdk/data'
import type { ModWorkspaceLock } from '@modkit/sdk'
import type { ModContext } from '@modkit/vfs/content-sources'
import { planDataWorkspace } from '../src/data/index.js'
import { createModContextDataWorkspaceInputs } from '../src/mod-context-data-workspace.js'

const workspace = {
  workspaceId: 'w',
  gameId: 'game',
  loadOrder: [{ rootId: 'core' }, { rootId: 'mod' }],
} as unknown as ModWorkspaceLock

function planner() {
  const seen: DataWorkspacePlanRequest[] = []
  return {
    seen,
    async plan(request: DataWorkspacePlanRequest): Promise<DataWorkspacePlan> {
      seen.push(request)
      const listed = request.listings?.flatMap(listing => listing.paths) ?? ['fixed.xml']
      return {
        schemaVersion: 1,
        workspaceId: 'w',
        gameId: 'game',
        analyzerId: 'a',
        requirements: listed.map(path => ({
          requirementId: path,
          rootId: 'mod',
          path,
          kind: 'catalog' as const,
        })),
        diagnostics: [],
        complete: true,
        ...(request.listings === undefined
          ? { listingQueries: [{ rootId: 'mod', prefix: 'Base.SC2Data/GameData' }] }
          : {}),
      }
    },
  }
}

describe('a data plan may ask the host to list a root', () => {
  it('plans again with the listing when the caller can list, and keeps the first plan when not', async () => {
    const withLister = planner()
    const plan = await planDataWorkspace(
      withLister,
      { workspace, locales: [], maxRequirements: 10 },
      async (rootId, prefix) => ({ paths: [`${rootId}:${prefix}/UnitData.xml`], complete: true }),
    )
    expect(plan.requirements.map(item => item.path)).toEqual([
      'mod:Base.SC2Data/GameData/UnitData.xml',
    ])
    expect(withLister.seen[1]?.listings).toEqual([
      {
        rootId: 'mod',
        prefix: 'Base.SC2Data/GameData',
        paths: ['mod:Base.SC2Data/GameData/UnitData.xml'],
        complete: true,
      },
    ])

    const without = planner()
    const fixed = await planDataWorkspace(without, { workspace, locales: [], maxRequirements: 10 })
    expect(fixed.requirements.map(item => item.path)).toEqual(['fixed.xml'])
    expect(without.seen).toHaveLength(1)
  })

  it('refuses a listing of a root the workspace does not hold', async () => {
    const bad = {
      async plan(): Promise<DataWorkspacePlan> {
        return {
          schemaVersion: 1,
          workspaceId: 'w',
          gameId: 'game',
          analyzerId: 'a',
          requirements: [],
          diagnostics: [],
          complete: true,
          listingQueries: [{ rootId: 'elsewhere', prefix: '' }],
        }
      },
    }
    await expect(
      planDataWorkspace(bad, { workspace, locales: [], maxRequirements: 10 }, async () => ({
        paths: [],
        complete: true,
      })),
    ).rejects.toThrow(/unknown root elsewhere/u)
  })

  it('a mod context lists one layer under a prefix, relative to the layer', async () => {
    // ModContext's prefix search also matches sibling names, as installed CASC does.
    const files = ['Base.SC2Data/GameData.xml', 'Base.SC2Data/GameData/UnitData.xml',
      'Base.SC2Data/GameDataBackup/Other.xml', 'Base.SC2Data/GameData/Abil/AbilData.xml',
      'Base.SC2Data/GameData.xml.backup']
    const context = {
      schemaVersion: 1,
      gameId: 'game',
      contextId: 'ctx',
      layers: [
        {
          id: 'mod',
          displayName: 'Mod',
          sourceId: 'src',
          sourcePath: 'Mods/Mod.SC2Mod',
          role: 'primary',
          provenance: 'opened',
        },
      ],
      unresolved: [],
      diagnostics: [],
      async files(_layer: string, query: { prefix?: string }) {
        const prefix = (query.prefix ?? '').toLowerCase()
        return { items: files.filter(path => path.toLowerCase().startsWith(prefix)) }
      },
      read: async () => new Uint8Array(),
      locate: async () => undefined,
      dispose: async () => {},
    } as unknown as ModContext
    const inputs = createModContextDataWorkspaceInputs(context)
    expect(await inputs.listFiles('mod', 'base.sc2data/gamedata', 10)).toEqual({
      paths: [files[1], files[3]],
      complete: true,
    })
    expect(await inputs.listFiles('mod', 'base.sc2data/gamedata', 1)).toEqual({
      paths: [files[1]],
      complete: false,
    })
    expect(await inputs.listFiles('mod', 'base.sc2data/gamedata.xml', 1)).toEqual({
      paths: [files[0]], complete: true,
    })
    expect(await inputs.listFiles('mod', '', 10)).toEqual({ paths: files, complete: true })
    await inputs.resources.dispose()
  })
})
