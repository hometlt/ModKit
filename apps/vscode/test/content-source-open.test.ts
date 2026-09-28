import { describe, expect, it } from 'vitest'
import { contentSourceTarget } from '../src/content-source-open.js'

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
})
