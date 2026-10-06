import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { LanguageWorkspaceSemanticInput } from '@modkit/sdk/language'
import { listIndexCaches } from '../src/node/index-caches.js'
import { createResolvedDataContextStore } from '../src/node/resolved-data-cache.js'

const work = await mkdtemp(join(tmpdir(), 'modkit-resolved-data-cache-'))
afterAll(() => rm(work, { recursive: true, force: true }))
let directories = 0
const freshDirectory = () => join(work, `cache-${String((directories += 1))}`)

const context = (revision: string, entities = 3): LanguageWorkspaceSemanticInput => ({
  kind: 'resolved-data-authoring-index',
  id: 'blizzard/starcraft-2',
  revision,
  payload: {
    revision,
    entities: Array.from({ length: entities }, (_, index) => ({
      entityId: `Unit${String(index)}`,
      fields: [{ fieldId: 'Name', value: `Юнит ${String(index)} ${'x'.repeat(64)}` }],
    })),
  },
})

const save = (
  store: ReturnType<typeof createResolvedDataContextStore>,
  key: string,
  slot: string,
  input = context(key),
) => store.save({ key, slot, gameId: 'blizzard/starcraft-2', label: `chain ${slot}`, input })

/** The one kept context file of a slot folder (`resolved-data-…/context-….mkrd`). */
async function contextFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const folder of await readdir(directory)) {
    for (const name of await readdir(join(directory, folder))) {
      if (name.endsWith('.mkrd')) files.push(join(directory, folder, name))
    }
  }
  return files.sort()
}

/** The single kept context file of a directory with one slot. */
async function onlyContextFile(directory: string): Promise<string> {
  const [file, ...others] = await contextFiles(directory)
  if (file === undefined || others.length > 0) throw new Error('expected one kept context file')
  return file
}

describe('kept resolved Data contexts', () => {
  it('load back by their exact key and list with the other index caches', async () => {
    const directory = freshDirectory()
    const store = createResolvedDataContextStore({ directory, maxBytes: 1_000_000 })
    await save(store, 'key-a', 'slot-liberty')
    expect(await store.load({ key: 'key-a' })).toEqual(context('key-a'))
    expect(await store.load({ key: 'key-b' })).toBeUndefined()
    const caches = await listIndexCaches(directory)
    expect(caches).toHaveLength(1)
    expect(caches[0]?.manifest).toEqual({
      game: 'blizzard/starcraft-2',
      kind: 'resolved-data',
      installation: 'chain slot-liberty',
    })
    // the payload is stored compressed
    const file = await onlyContextFile(directory)
    expect((await stat(file)).size).toBeLessThan(
      Buffer.byteLength(JSON.stringify(context('key-a').payload)),
    )
  })

  it('replace the previous context of their slot and leave other slots alone', async () => {
    const directory = freshDirectory()
    const store = createResolvedDataContextStore({ directory, maxBytes: 1_000_000 })
    await save(store, 'key-a', 'slot-liberty')
    await save(store, 'key-v', 'slot-void')
    await save(store, 'key-b', 'slot-liberty')
    expect(await store.load({ key: 'key-a' })).toBeUndefined()
    expect(await store.load({ key: 'key-b' })).toEqual(context('key-b'))
    expect(await store.load({ key: 'key-v' })).toEqual(context('key-v'))
    expect(await contextFiles(directory)).toHaveLength(2)
  })

  it('miss a damaged, inflated or foreign file', async () => {
    const directory = freshDirectory()
    const store = createResolvedDataContextStore({ directory, maxBytes: 1_000_000 })
    await save(store, 'key-a', 'slot-a')
    const file = await onlyContextFile(directory)
    const original = await readFile(file)
    const newline = original.indexOf(0x0a)

    // a changed byte of the compressed payload
    const damaged = Buffer.from(original)
    damaged[damaged.length - 12] = ((damaged.at(-12) ?? 0) + 1) % 256
    await writeFile(file, damaged)
    expect(await store.load({ key: 'key-a' })).toBeUndefined()

    // a header claiming fewer bytes than the payload inflates to
    const header = JSON.parse(original.subarray(0, newline).toString('utf8')) as {
      payloadBytes: number
    }
    const lying = Buffer.concat([
      Buffer.from(`${JSON.stringify({ ...header, payloadBytes: 16 })}\n`),
      original.subarray(newline + 1),
    ])
    await writeFile(file, lying)
    expect(await store.load({ key: 'key-a' })).toBeUndefined()

    // another format, or no header at all
    await writeFile(file, Buffer.from(`{"format":"other"}\n`))
    expect(await store.load({ key: 'key-a' })).toBeUndefined()
    await writeFile(file, Buffer.from('not a kept context'))
    expect(await store.load({ key: 'key-a' })).toBeUndefined()

    await writeFile(file, original)
    expect(await store.load({ key: 'key-a' })).toEqual(context('key-a'))
  })

  it('stay within the byte budget, least recently used first', async () => {
    const directory = freshDirectory()
    const sizing = createResolvedDataContextStore({ directory, maxBytes: 1_000_000 })
    await save(sizing, 'probe', 'probe-slot')
    const one = (await stat(await onlyContextFile(directory))).size + 256
    await rm(directory, { recursive: true, force: true })

    const store = createResolvedDataContextStore({ directory, maxBytes: 2 * one })
    await save(store, 'key-a', 'slot-a')
    await save(store, 'key-b', 'slot-b')
    // both used long ago; loading touches a context file and makes its slot the recent one
    const past = new Date(Date.now() - 3_600_000)
    for (const file of await contextFiles(directory)) await utimes(file, past, past)
    expect(await store.load({ key: 'key-a' })).toEqual(context('key-a'))
    await save(store, 'key-c', 'slot-c')
    expect(await store.load({ key: 'key-c' })).toEqual(context('key-c'))
    expect(await store.load({ key: 'key-a' })).toEqual(context('key-a'))
    expect(await store.load({ key: 'key-b' })).toBeUndefined()
  })

  it('keep nothing larger than the whole budget, and nothing at all without one', async () => {
    const tight = freshDirectory()
    await save(createResolvedDataContextStore({ directory: tight, maxBytes: 64 }), 'key', 'slot')
    expect(await listIndexCaches(tight)).toEqual([])

    const off = freshDirectory()
    const store = createResolvedDataContextStore({ directory: off, maxBytes: 0 })
    await save(store, 'key', 'slot')
    expect(await store.load({ key: 'key' })).toBeUndefined()
    expect(await listIndexCaches(off)).toEqual([])
  })

  it('propagate an aborted load', async () => {
    const directory = freshDirectory()
    const store = createResolvedDataContextStore({ directory, maxBytes: 1_000_000 })
    await save(store, 'key-a', 'slot-a')
    const controller = new AbortController()
    controller.abort('stop')
    await expect(store.load({ key: 'key-a', signal: controller.signal })).rejects.toBe('stop')
  })
})
