import { describe, expect, it } from 'vitest'
import { contentSourceOpener, contentSourceTarget } from '../src/content-source-open.js'

describe('a content-source subject', () => {
  it('names its source and path, decoded, for the mod context the file belongs to', () => {
    expect(
      contentSourceTarget(
        'modkit-source://battlenet/local%3Acasc/mods/liberty.sc2mod/base.sc2data/GameData/UnitData.xml',
      ),
    ).toEqual({
      sourceId: 'local:casc',
      path: 'mods/liberty.sc2mod/base.sc2data/GameData/UnitData.xml',
    })
    expect(
      contentSourceTarget('modkit-source://battlenet/roblox%3Aplace/Work%20space/a.rbxm'),
    ).toEqual({
      sourceId: 'roblox:place',
      path: 'Work space/a.rbxm',
    })
    expect(contentSourceTarget('not a uri')).toBeUndefined()
  })

  // v84/v85: BAR's armcom.s3o drew 0 / 2 textures — the opener dropped the port they are read by
  it('keeps the raster port its open gave, through which a model reads its textures', async () => {
    const rasterResources = { read: async () => ({ state: 'unresolved', diagnostics: [] }) }
    const open = contentSourceOpener(
      {
        open: async () => ({
          state: 'opened',
          descriptor: {
            identity: { formatId: 'example-model' },
            dataSources: [],
            traits: [],
            operations: [],
          },
          selected: { contributionId: 'org.example/model', variantId: 'node' },
          diagnostics: [],
          session: { dispose: async () => undefined },
          rasterResources,
        }),
      } as never,
      async () => new Uint8Array([1, 2, 3]),
      {
        maxInputBytes: 1024n,
        maxDepth: 8,
        maxNodes: 8,
        maxScalarBytes: 1024,
        maxDiagnostics: 8,
        deadlineMs: 1000,
      },
    )
    const answer = await open('modkit-source://battlenet/local%3Aexample/units/unit.s3o')
    expect(answer.snapshot.state).toBe('opened')
    expect(answer.rasterResources).toBe(rasterResources)
  })
})
