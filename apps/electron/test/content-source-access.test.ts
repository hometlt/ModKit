import { expect, it } from 'vitest'
import type { NamespaceEntrySource } from '@modkit/sdk'
import { namespaceFileAccess } from '../src/content-source-access.js'
it('renders a flat CASC namespace as lazy folders without extracting during listing', async () => {
  let reads = 0
  const files = ['mods/core/base/a.txt', 'mods/core/base/b.txt', 'versions/build.txt']
  const source = { list: async (prefix: string, page: { cursor?: string }) => {
    const matching = files.filter(path => path.startsWith(prefix))
    const start = Number(page.cursor ?? 0)
    return { items: matching.slice(start, start + 1).map(path => ({ id: path, path, name: path.split('/').at(-1), kind: 'file', size: 3 })),
      ...(start + 1 < matching.length ? { nextCursor: String(start + 1) } : {}) }
  } } as unknown as NamespaceEntrySource
  const access = namespaceFileAccess({ label: 'SC2', parentSessionId: 'session', source,
    read: async () => { reads++; return new Uint8Array([1, 2, 3]) } })
  const root = await access.list(undefined)
  expect(root.map(item => item.name)).toEqual(['mods', 'versions'])
  const mods = await access.list(root[0]!.id)
  const core = await access.list(mods[0]!.id)
  const base = await access.list(core[0]!.id)
  expect(base.map(item => item.name)).toEqual(['a.txt', 'b.txt'])
  expect(reads).toBe(0)
  await expect(access.read(base[0]!.id, 2)).rejects.toThrow('limit')
  expect(reads).toBe(0)
  expect(await access.read(base[0]!.id, 3)).toEqual(new Uint8Array([1, 2, 3]))
  expect(reads).toBe(1)
})
