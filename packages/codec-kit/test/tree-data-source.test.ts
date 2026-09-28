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

  it('builds lazy children only when a client opens the node, and searches through them', async () => {
    let built = 0
    const leaf = (label: string) => ({ kind: 'property', label })
    const source = createTreeDataSource({
      kind: 'root',
      label: 'Place',
      children: [
        {
          kind: 'instance',
          label: 'Workspace',
          hasChildren: true,
          children: () => {
            built += 1
            return [
              leaf('Gravity'),
              { kind: 'instance', label: 'Part', children: () => [leaf('Anchored')] },
            ]
          },
        },
        { kind: 'instance', label: 'Empty', hasChildren: false, children: () => [] },
      ],
    })
    const root = await source.root()
    const [workspace, empty] = (await source.children(root, { limit: 10 })).items
    expect([workspace?.hasChildren, empty?.hasChildren, built]).toEqual([true, false, 0])
    const inside = (await source.children(workspace!, { limit: 10 })).items
    expect(await Promise.all(inside.map(async node => (await source.facts(node)).label))).toEqual([
      'Gravity',
      'Part',
    ])
    await source.children(workspace!, { limit: 10 })
    expect(built).toBe(1)
    const found = []
    for await (const node of source.search({ pattern: 'anchored' })) found.push(node)
    expect(await source.facts(found[0]!)).toMatchObject({ label: 'Anchored' })
    expect(built).toBe(1)
  })
})
