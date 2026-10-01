import { describe, expect, it } from 'vitest'
import { wikiKinds } from '../src/card/wiki.js'

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
})
