import { describe, expect, it } from 'vitest'

import { createTreeDataSource } from '../src/index.js'

describe('createTreeDataSource', () => {
  it('preserves a stable subject navigation target in node facts', async () => {
    const source = createTreeDataSource({
      kind: 'root',
      label: 'Resources',
      children: [
        {
          kind: 'entity',
          label: 'Marine',
          subjectId: 'modkit-subject://blizzard%2Fsc2-data/Unit/Marine',
        },
      ],
    })
    const root = await source.root()
    const child = (await source.children(root, { limit: 10 })).items[0]
    expect(child).toBeDefined()
    await expect(source.facts(child!)).resolves.toMatchObject({
      label: 'Marine',
      subjectId: 'modkit-subject://blizzard%2Fsc2-data/Unit/Marine',
    })
  })
})
