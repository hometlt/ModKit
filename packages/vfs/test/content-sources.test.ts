import { describe, expect, it } from 'vitest'
import { callContentSources, type ContentSources } from '../src/content-sources.js'
import { loadContentSources } from '../src/content-sources-node.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
describe('desktop source IPC boundary', () => {
  const source = {
    read: async () => new Uint8Array([1]),
    snapshot: async () => ({ roots: [] }),
  } as unknown as ContentSources
  it('rejects arbitrary methods and oversized or malformed read requests', async () => {
    for (const method of ['constructor', '__proto__', 'dispose', 'execute']) {
      await expect(callContentSources(source, method, [])).rejects.toThrow(
        'Unknown source operation',
      )
    }
    await expect(callContentSources(source, 'publish', ['review'])).rejects.toThrow(
      'not configured',
    )
    await expect(callContentSources(source, 'deletePublication', ['review'])).rejects.toThrow(
      'not configured',
    )
    await expect(
      callContentSources(source, 'preparePublish', ['connection', 'archive', 'manifest']),
    ).rejects.toThrow('not configured')
    // Dependencies are no IPC call: a game opens mod contexts in the host process.
    for (const method of ['resolveDependencies', 'languageMounts', 'openModContext']) {
      await expect(callContentSources(source, method, [])).rejects.toThrow('Unknown source operation')
    }
    await expect(
      callContentSources(source, 'read', ['public:us', 'x', 64 * 1024 * 1024 + 1]),
    ).rejects.toThrow('limit')
    await expect(callContentSources(source, 'read', ['public:us', 'x\0', 1])).rejects.toThrow(
      'identifier',
    )
    expect(await callContentSources(source, 'read', ['public:us', 'x', 1])).toEqual(
      new Uint8Array([1]),
    )
  })
  it('forwards a well-formed bulk file query, and none to a source that cannot list in bulk', async () => {
    const asked: unknown[] = []
    const indexed = {
      ...source,
      files: async (...args: unknown[]) => {
        asked.push(args)
        return { items: [{ path: 'Mods/a.xml', size: 1 }] }
      },
    } as unknown as ContentSources
    const query = {
      pattern: 'unitdata',
      extensions: ['xml', ''],
      cursor: '42',
      limit: 100,
      includeHidden: true,
    }
    expect(await callContentSources(indexed, 'files', ['local:casc', 'Mods', query])).toEqual({
      items: [{ path: 'Mods/a.xml', size: 1 }],
    })
    expect(asked).toEqual([['local:casc', 'Mods', query]])
    for (const malformed of [
      { limit: 0 },
      { limit: 10_001 },
      { limit: 1, extensions: ['.xml'] },
      { limit: 1, pattern: 'x'.repeat(513) },
      { limit: 1, script: 'unexpected' },
      { limit: 1, includeHidden: 'yes' },
    ]) {
      await expect(callContentSources(indexed, 'files', ['local:casc', '', malformed])).rejects.toThrow(
        'Invalid source file query',
      )
    }
    expect(await callContentSources(source, 'files', ['local:casc', '', { limit: 1 }])).toBeUndefined()
  })

  it('forwards list options that ask for hidden entries, and refuses any other', async () => {
    const asked: unknown[] = []
    const listing = {
      ...source,
      list: async (...args: unknown[]) => {
        asked.push(args)
        return []
      },
    } as unknown as ContentSources
    await callContentSources(listing, 'list', ['local:casc', ''])
    await callContentSources(listing, 'list', ['local:casc', 'Mods', { includeHidden: true }])
    expect(asked).toEqual([
      ['local:casc', '', undefined],
      ['local:casc', 'Mods', { includeHidden: true }],
    ])
    for (const malformed of [{ includeHidden: 1 }, { recursive: true }, 'hidden', null]) {
      await expect(callContentSources(listing, 'list', ['local:casc', '', malformed])).rejects.toThrow(
        'Invalid source list options',
      )
    }
  })

  it('forwards only a well-formed provider-owned local reveal target', async () => {
    const configured = {
      ...source,
      async resolveLocalPath(sourceId: string, path: string) {
        expect([sourceId, path]).toEqual(['local:cache', 'Map.SC2Map'])
        return { path: 'C:\\Cache\\Map.SC2Map', kind: 'directory' as const }
      },
    } as unknown as ContentSources
    await expect(
      callContentSources(configured, 'resolveLocalPath', ['local:cache', 'Map.SC2Map']),
    ).resolves.toEqual({ path: 'C:\\Cache\\Map.SC2Map', kind: 'directory' })
    await expect(
      callContentSources(source, 'resolveLocalPath', ['local:cache', '']),
    ).rejects.toThrow('not configured')
    const malformed = {
      ...configured,
      resolveLocalPath: async () => ({ path: '', kind: 'file' }),
    } as unknown as ContentSources
    await expect(
      callContentSources(malformed, 'resolveLocalPath', ['local:cache', '']),
    ).rejects.toThrow('Invalid local source path')
  })
  it('loads an existing read-only provider without optional mutation methods', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'modkit-source-contract-'))
    try {
      const module = join(directory, 'readonly.mjs'),
        config = join(directory, 'provider.json')
      await writeFile(
        module,
        'export async function createContentSources() { return Object.fromEntries(' +
          JSON.stringify([
            'snapshot',
            'connect',
            'disconnect',
            'search',
            'add',
            'remove',
            'refresh',
            'list',
            'read',
            'dispose',
          ]) +
          '.map(key => [key, async () => undefined])) }',
      )
      await writeFile(config, JSON.stringify({ module }))
      const loaded = await loadContentSources(config, join(directory, 'storage'))
      expect(typeof loaded?.read).toBe('function')
      expect(loaded?.deletePublication).toBeUndefined()
      await loaded?.dispose()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('what a host may hand a provider', () => {
  it('passes no secret to connect and checks the options of a revision', async () => {
    const calls: unknown[][] = []
    const source = {
      connect: async (...args: unknown[]) => {
        calls.push(args)
      },
      prepareRevision: async (...args: unknown[]) => {
        calls.push(args)
        return { id: 'review' }
      },
    } as unknown as ContentSources

    // A ticket a caller still sends is dropped: keys reach the module only through its broker port.
    await callContentSources(source, 'connect', ['eu', 'account-1', 'ST-kept'])
    await callContentSources(source, 'connect', ['eu'])
    expect(calls).toEqual([
      ['eu', 'account-1'],
      ['eu', undefined],
    ])

    calls.length = 0
    await callContentSources(source, 'prepareRevision', [
      'mine:1',
      'Mod.SC2Mod',
      { visibility: 'private', locked: true, protectHeader: true, majorRevision: true },
    ])
    expect(calls[0]).toEqual([
      'mine:1',
      'Mod.SC2Mod',
      { visibility: 'private', locked: true, protectHeader: true, majorRevision: true },
    ])
    for (const options of [{ visibility: 'secret' }, { locked: 'yes' }, { archivePath: '' }, null]) {
      await expect(
        callContentSources(source, 'prepareRevision', ['mine:1', 'Mod.SC2Mod', options]),
      ).rejects.toThrow(/publication option|Invalid publication options/u)
    }
    // A field this boundary does not know is refused, never dropped on the way through.
    await expect(
      callContentSources(source, 'prepareRevision', ['mine:1', 'Mod.SC2Mod', { previews: [] }]),
    ).rejects.toThrow('Unknown publication option: previews')
  })

  it('requires an archive and a name for a first publication', async () => {
    const calls: unknown[][] = []
    const source = {
      prepareFirstPublication: async (...args: unknown[]) => {
        calls.push(args)
        return { id: 'review' }
      },
      storage: async (...args: unknown[]) => {
        calls.push(args)
        return { used: 1 }
      },
    } as unknown as ContentSources

    await callContentSources(source, 'prepareFirstPublication', [
      'connection-1',
      { archivePath: 'C:/mods/Test.SC2Mod', name: 'Test', protectHeader: true },
    ])
    expect(calls[0]).toEqual([
      'connection-1',
      { archivePath: 'C:/mods/Test.SC2Mod', name: 'Test', protectHeader: true },
    ])
    expect(await callContentSources(source, 'storage', ['connection-1'])).toEqual({ used: 1 })
    for (const options of [{ name: 'Test' }, { archivePath: 'C:/mods/Test.SC2Mod' }]) {
      await expect(
        callContentSources(source, 'prepareFirstPublication', ['connection-1', options]),
      ).rejects.toThrow(/Missing publication option/u)
    }
  })
})
