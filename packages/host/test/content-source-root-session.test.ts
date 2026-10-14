import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContentSourceEntry, ContentSources } from '@modkit/vfs/content-sources'
import { createModkit } from '../src/node/modkit.js'
import { createPathSubjectOpener } from '../src/node/subject-opener.js'
import type { SubjectServices } from '../src/subject-services.js'

const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

/** An installation the source reads from its own index: two folders, a hidden list file. */
function installation(storageOf: string, bulk: boolean): ContentSources {
  const files: Readonly<Record<string, string>> = {
    'base.wz': 'base archive',
    'mp.wz': 'multiplayer',
    'data/base/stats/templates.json': '{}',
    'data/mp/readme.txt': 'hi',
  }
  const hidden = new Set(['data/(listfile)'])
  const all = { ...files, 'data/(listfile)': 'names' }
  const childrenOf = (folder: string, includeHidden: boolean): ContentSourceEntry[] => {
    const prefix = folder === '' ? '' : `${folder}/`
    const seen = new Map<string, ContentSourceEntry>()
    for (const [path, value] of Object.entries(all)) {
      // installations fold case, as the sources over them do
      if (!path.startsWith(prefix.toLowerCase()) || (!includeHidden && hidden.has(path))) continue
      const rest = path.slice(prefix.length)
      const name = rest.split('/')[0]!
      const directory = rest.includes('/')
      seen.set(name, {
        // spelled as the installation stores it
        path: `${path.slice(0, prefix.length)}${name}`,
        name,
        directory,
        ...(directory ? {} : { size: value.length }),
      })
    }
    return [...seen.values()]
  }
  return {
    async snapshot() {
      return {
        label: 'Game',
        regions: [],
        connections: [],
        roots: [{ id: 'local:game', label: 'The Game', region: 'local', kind: 'local', storageOf }],
      }
    },
    async list(_sourceId: string, path: string, options?: Parameters<ContentSources['list']>[2]) {
      return childrenOf(path, options?.includeHidden === true)
    },
    async read(_sourceId: string, path: string, maxBytes: number) {
      const value = all[path as keyof typeof all]
      if (value === undefined) throw new RangeError(`no ${path}`)
      if (value.length > maxBytes) throw new RangeError(`${path} is too large`)
      return new TextEncoder().encode(value)
    },
    ...(bulk
      ? {
          async files(
            _sourceId: string,
            path: string,
            query: { readonly limit: number; readonly cursor?: string },
          ) {
            const under = Object.keys(files).filter(
              item => path === '' || item.startsWith(`${path}/`),
            )
            const start = query.cursor === undefined ? 0 : Number(query.cursor)
            const end = Math.min(under.length, start + query.limit)
            return {
              items: under
                .slice(start, end)
                .map(item => ({ path: item, size: files[item]!.length })),
              ...(end < under.length ? { nextCursor: String(end) } : {}),
            }
          },
        }
      : {}),
    async dispose() {},
  } as unknown as ContentSources
}

describe('an installation folder a content-source root reads (storageOf)', () => {
  for (const bulk of [false, true])
    it(`opens as that root: its tree, its files by path, read by the root${bulk ? ' paging its index' : ''}`, async () => {
      const folder = await mkdtemp(join(tmpdir(), 'modkit-storage-root-'))
      temporary.push(folder)
      const opener = createPathSubjectOpener({
        subjects: {} as SubjectServices,
        roots: [folder],
        contentSources: installation(folder.toUpperCase().replaceAll('\\', '/') + '/', bulk),
      })
      const opened = await opener(folder)
      expect(opened.snapshot.state).toBe('opened')
      const session = opened.session!
      const descriptor = await session.descriptor()
      expect(descriptor.subjectUri).toBe('content-source://local%3Agame/')
      expect(descriptor.operations.map(operation => operation.id)).toContain('container.extract')
      const lease = await session.dataSource('common.view/namespace-entry-source', 1)
      const namespace = lease.value
      // a folder's children, without the hidden list file
      expect(
        (await namespace.children!('data', { limit: 10 })).items.map(item => [
          item.path,
          item.kind,
        ]),
      ).toEqual([
        ['data/base', 'directory'],
        ['data/mp', 'directory'],
      ])
      // every file under a prefix, flat and paged
      const first = await namespace.list('data', { limit: 1 })
      expect(first.items).toHaveLength(1)
      const rest = await namespace.list('data', { limit: 10, cursor: first.nextCursor! })
      expect([...first.items, ...rest.items].map(item => item.path).sort()).toEqual([
        'data/base/stats/templates.json',
        'data/mp/readme.txt',
      ])
      // an exact path finds a hidden file too, without case
      expect((await namespace.lookup!('DATA/(listfile)'))?.path).toBe('data/(listfile)')
      expect(await namespace.lookup!('data/missing.txt')).toBeUndefined()
      const extracted = await session.operations().invoke('x3.host/content-source-root-extract', {
        entryId: 'data/mp/readme.txt',
      })
      expect(extracted.state).toBe('ok')
      if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') throw new Error('no bytes')
      expect(new TextDecoder().decode(extracted.output.value)).toBe('hi')
      await lease.release()
      await session.dispose()
    })

  it('opens through the library facade too, from the window content sources (MCP)', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'modkit-storage-root-'))
    temporary.push(folder)
    const baseModTargets: unknown[] = []
    const modkit = await createModkit({
      extensions: [],
      roots: [folder],
      subjectCatalog: {
        contentSources: async () => installation(folder, false),
        baseMods: target => {
          baseModTargets.push(target)
          return ['Mods/Liberty.SC2Mod']
        },
      },
    })
    try {
      const opened = await modkit.open(folder)
      expect(opened.snapshot.state).toBe('opened')
      if (opened.snapshot.state !== 'opened') return
      expect(opened.snapshot.selected.contributionId).toBe('x3.host/content-source-root')
      expect(baseModTargets).toEqual([folder])
      await opened.close()
    } finally {
      await modkit.close()
    }
  })
})
