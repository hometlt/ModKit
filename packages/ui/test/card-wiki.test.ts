import { describe, expect, it } from 'vitest'
import { cardRefLabel } from '../src/card/index.js'
import { wikiKinds, wikiSubjectId } from '../src/card/wiki.js'

describe('the wiki of a mod', () => {
  it('lists the kinds the selector counts, and one entry for all when it names none', () => {
    expect(
      wikiKinds({
        snapshotId: 's',
        totalSubjects: 9,
        completeness: 'complete',
        kinds: [
          { kind: 'Unit', count: 7 },
          { kind: 'Empty', count: 0 },
          { kind: 'Weapon', count: 2 },
        ],
      }),
    ).toEqual([
      { kind: 'Unit', count: 7 },
      { kind: 'Weapon', count: 2 },
    ])
    expect(wikiKinds({ snapshotId: 's', totalSubjects: 9, completeness: 'complete' })).toEqual([
      { count: 9 },
    ])
  })

  it('shows an entity by its own id and a source by its file, the whole address in the tooltip', () => {
    expect(wikiSubjectId('modkit-subject://blizzard%2Fsc2-data/Unit/Marine')).toBe('Marine')
    expect(wikiSubjectId('Marine')).toBe('Marine')
    expect(
      cardRefLabel({
        label: 'file:///c:/Mods/IBE_COMMON.SC2Mod',
        location: { uri: 'file:///c:/Mods/IBE_COMMON.SC2Mod', line: 41 },
      }),
    ).toBe('IBE_COMMON.SC2Mod:42')
    expect(cardRefLabel({ label: 'core:Core.SC2Mod' })).toBe('core:Core.SC2Mod')
  })
})
