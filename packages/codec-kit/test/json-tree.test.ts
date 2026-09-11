import { expect, it } from 'vitest'
import { operationId } from '@modkit/core'
import { createJsonTreeSource } from '../src/tree/json-tree.js'

const budget = { maxBytes: 2_000_000, maxNodes: 10_000, maxDepth: 128 }
it('exposes every native metadata field with stable escaped paths and owned values', async () => {
  const input = {
    extras: {
      BlizzardM3: {
        sections: Array.from({ length: 503 }, (_, i) => ({
          name: `section-${i}`,
          'a/b~c': i,
        })),
      },
    },
  }
  const tree = createJsonTreeSource(input, {
    budget,
    write: { operation: operationId('edit.field', { contributionId: 'modkit/model-uvm' }) },
  })
  const last = input.extras.BlizzardM3.sections[502]
  if (last === undefined) throw new Error('fixture section missing')
  last.name = 'changed outside'
  const node = { id: 'json:/extras/BlizzardM3/sections', hasChildren: true }
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const page = await tree.children(node, {
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    })
    ids.push(...page.items.map(item => item.id))
    cursor = page.nextCursor
  } while (cursor !== undefined)
  expect(ids).toHaveLength(503)
  expect(new Set(ids).size).toBe(503)
  expect(await tree.facts({ id: `${ids[502]}/a~1b~0c`, hasChildren: false })).toMatchObject({
    label: 'a/b~c',
    value: 502,
    semanticPath: ['extras', 'BlizzardM3', 'sections', '502', 'a/b~c'],
    editable: { write: { operation: 'edit.field' } },
  })
  const matches = []
  for await (const match of tree.search({ pattern: 'section-502' })) matches.push(match.id)
  expect(matches).toEqual([`${ids[502]}/name`])
})

it('resolves empty and prototype-like own keys without accepting malformed identities', async () => {
  const tree = createJsonTreeSource(JSON.parse('{"":{"__proto__":9},"a":[1]}'), { budget })
  expect(await tree.facts({ id: 'json://__proto__', hasChildren: false })).toMatchObject({
    value: 9,
    semanticPath: ['', '__proto__'],
  })
  for (const id of [
    'root',
    'json:/a/01',
    'json:/a/-1',
    'json:/a/1',
    'json:/constructor',
    'json:/a~2',
  ])
    await expect(tree.facts({ id, hasChildren: false })).rejects.toThrow()
  expect(await tree.facts({ id: 'json:/a/0', hasChildren: false })).not.toHaveProperty('editable')
  for (const cursor of ['-1', '1e0', '01', '9007199254740992', '99'])
    await expect(tree.children(await tree.root(), { limit: 1, cursor })).rejects.toThrow()
  await expect(tree.children(await tree.root(), { limit: 4097 })).rejects.toThrow()
})

it('bounds deep input, observes cancellation and searches complete scalar text beyond the preview', async () => {
  const controller = new AbortController()
  const tree = createJsonTreeSource(
    { text: 'x'.repeat(600) + 'needle' },
    { budget, signal: controller.signal },
  )
  expect((await tree.facts({ id: 'json:/text', hasChildren: false })).preview).not.toContain(
    'needle',
  )
  const found = []
  for await (const node of tree.search({ pattern: 'needle' })) found.push(node.id)
  expect(found).toEqual(['json:/text'])
  await expect(tree.children(await tree.root(), { limit: 1 }, AbortSignal.abort())).rejects.toThrow(
    'cancelled',
  )
  controller.abort()
  await expect(tree.root()).rejects.toThrow('cancelled')
  expect(() =>
    createJsonTreeSource({ a: { b: 2 } }, { budget: { ...budget, maxDepth: 1 } }),
  ).toThrow()
})
