import { describe, expect, it } from 'vitest'
import { createModelLodSource } from '../src/model/sources.js'

describe('model LOD source', () => {
  it('pages levels most detailed first', async () => {
    const source = createModelLodSource({
      levels: [
        { id: 'far', order: 1, nodeIds: ['low'] },
        { id: 'near', order: 0, nodeIds: ['high', 'turret'] },
      ],
    })
    expect(await source.info()).toEqual({ levels: 2 })
    const page = await source.levels({ limit: 10 })
    expect(page.items.map(level => level.id)).toEqual(['near', 'far'])
  })
})
