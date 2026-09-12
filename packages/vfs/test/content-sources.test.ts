import { describe, expect, it } from 'vitest'
import { callContentSources, type ContentSources } from '../src/content-sources.js'
import { loadContentSources } from '../src/content-sources-node.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
describe('desktop source IPC boundary', () => {
  const source = { read: async () => new Uint8Array([1]), snapshot: async () => ({ roots: [] }) } as unknown as ContentSources
  it('rejects arbitrary methods and oversized or malformed read requests', async () => {
    for (const method of ['constructor', '__proto__', 'dispose', 'execute']) {
      await expect(callContentSources(source, method, [])).rejects.toThrow('Unknown source operation')
    }
    await expect(callContentSources(source, 'publish', ['review'])).rejects.toThrow('not configured')
    await expect(callContentSources(source, 'deletePublication', ['review'])).rejects.toThrow('not configured')
    await expect(callContentSources(source, 'preparePublish', ['connection', 'archive', 'manifest'])).rejects.toThrow('not configured')
    await expect(callContentSources(source, 'resolveDependencies', [{ schemaVersion: 1, gameId: 'test', complete: true, dependencies: [] }])).rejects.toThrow('not configured')
    await expect(callContentSources(source, 'read', ['public:us', 'x', 64 * 1024 * 1024 + 1])).rejects.toThrow('limit')
    await expect(callContentSources(source, 'read', ['public:us', 'x\0', 1])).rejects.toThrow('identifier')
    expect(await callContentSources(source, 'read', ['public:us', 'x', 1])).toEqual(new Uint8Array([1]))
  })
  it('forwards a bounded dependency set only to an explicitly configured resolver', async () => {
    const request = { schemaVersion: 1 as const, gameId: 'example/game', complete: true, dependencies: [] }
    const configured = {
      ...source,
      async resolveDependencies(value: typeof request) {
        expect(value).toBe(request)
        return { schemaVersion: 1 as const, gameId: value.gameId, complete: true,
          mounts: [], dependencies: [], diagnostics: [] }
      },
    } as unknown as ContentSources
    await expect(callContentSources(configured, 'resolveDependencies', [request])).resolves.toMatchObject({
      schemaVersion: 1, gameId: 'example/game', complete: true,
    })
    await expect(callContentSources(configured, 'resolveDependencies', [
      { ...request, dependencies: new Array(257).fill({}) },
    ])).rejects.toThrow('Invalid content dependency request')
  })
  it('loads an existing read-only provider without optional mutation methods', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'modkit-source-contract-'))
    try {
      const module = join(directory, 'readonly.mjs'), config = join(directory, 'provider.json')
      await writeFile(module, 'export async function createContentSources() { return Object.fromEntries(' +
        JSON.stringify(['snapshot','connect','disconnect','search','add','remove','refresh','list','read','dispose']) +
        '.map(key => [key, async () => undefined])) }')
      await writeFile(config, JSON.stringify({ module }))
      const loaded = await loadContentSources(config, join(directory, 'storage'))
      expect(typeof loaded?.read).toBe('function')
      expect(loaded?.deletePublication).toBeUndefined()
      await loaded?.dispose()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
