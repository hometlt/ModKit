import { describe, expect, it, vi } from 'vitest'
import type { ContentSourceEntry, ContentSources } from '@modkit/vfs/content-sources'
import { createContentSourceCompanionOrigin } from '../src/content-source-companion.js'
import type { CompanionOrigin } from '../src/input-resolution.js'

const text = new TextEncoder()

/** A content source in memory: paths as an installation spells them, listed one folder at a time. */
function source(files: Readonly<Record<string, string>>): Pick<ContentSources, 'list' | 'read'> {
  const fold = (value: string) => value.toLowerCase()
  return {
    async list(sourceId, path) {
      if (sourceId !== 'local:game') throw new RangeError(sourceId)
      const prefix = path === '' ? '' : `${fold(path)}/`
      const seen = new Map<string, ContentSourceEntry>()
      for (const [file, value] of Object.entries(files)) {
        if (!fold(file).startsWith(prefix)) continue
        const rest = file.slice(prefix.length)
        const slash = rest.indexOf('/')
        const name = slash < 0 ? rest : rest.slice(0, slash)
        const full = file.slice(0, prefix.length) + name
        seen.set(fold(name), {
          path: full,
          name,
          directory: slash >= 0,
          ...(slash < 0 ? { size: text.encode(value).byteLength } : {}),
        })
      }
      if (seen.size === 0 && path !== '') throw new RangeError(`no folder ${path}`)
      return [...seen.values()]
    },
    async read(_sourceId, path, maxBytes) {
      const found = Object.entries(files).find(([file]) => fold(file) === fold(path))
      if (found === undefined) throw new RangeError(`no file ${path}`)
      const bytes = text.encode(found[1])
      if (bytes.byteLength > maxBytes) throw new RangeError('too large')
      return bytes
    },
  }
}

const files = {
  'Models/E_HERO_01.msh': 'mesh',
  'Models/E_HERO_01.skn': 'skin',
  'Models/E_HERO_01.mot': 'motion',
  'Models/Sub/inner.txt': 'inner',
  'Textures/E_BL_AC_08.dds': 'texture',
  'Mods/Foo.SC2Mod/Base.SC2Assets/Assets/Textures/marine.dds': 'marine texture',
  'Mods/Foo.SC2Mod/Base.SC2Assets/Assets/Units/marine.m3': 'marine',
  'Mods/Foo.SC2Mod/Assets/Textures/root.dds': 'root texture',
  'packs/P/pack.mcmeta': '{}',
  'packs/P/assets/models/block.json': 'block',
  'packs/P/assets/textures/stone.png': 'stone',
}

async function ids(
  origin: CompanionOrigin,
  scope: Parameters<CompanionOrigin['enumerate']>[0],
  prefix: string,
) {
  const found: string[] = []
  for await (const entry of origin.enumerate(scope, { prefix })) found.push(entry.logicalId)
  return found.sort()
}

async function read(origin: CompanionOrigin, logicalId: string) {
  const lease = await origin.open(logicalId)
  const value = lease.value
  if (value.kind !== 'bytes') throw new TypeError(value.kind)
  return new TextDecoder().decode(await value.read(0n, Number(value.size)))
}

describe('companions of a file in a content source', () => {
  it.each(['x3.host/permission-missing', 'x3.vfs/source-revision-changed', 'EACCES', 'EPERM', 'AbortError', 'TimeoutError'])
  ('does not turn %s from exact lookup into a listed permission', async code => {
    const error = code.endsWith('Error') ? new DOMException('refused', code) : Object.assign(new Error('refused'), { code })
    const backing = source(files), list = vi.fn(backing.list)
    const origin = createContentSourceCompanionOrigin({
      contentSources: { ...backing, list, async lookup() { throw error } },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const enumerate = async () => {
      for await (const _ of origin.enumerate('current-mount', { prefix: 'Textures/E_BL_AC_08.dds', exactPath: true })) {}
    }
    await expect(enumerate()).rejects.toBe(error)
    expect(list).not.toHaveBeenCalled()
  })
  it('uses exact lookup for a hidden qualified path without listing its folder', async () => {
    const backing = source(files)
    let lookups = 0
    const origin = createContentSourceCompanionOrigin({
      contentSources: {
        ...backing,
        async list() {
          throw new Error('listing unavailable')
        },
        async lookup(_sourceId, path) {
          lookups++
          expect(path).toBe('Textures/e_bl_ac_08.DDS')
          return {
            path: 'Textures/E_BL_AC_08.dds',
            name: 'E_BL_AC_08.dds',
            directory: false,
            size: 7,
          }
        },
      },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const found: string[] = []
    for await (const entry of origin.enumerate('current-mount', {
      prefix: 'Textures/e_bl_ac_08.DDS',
      exactPath: true,
    }))
      found.push(entry.logicalId)
    expect(found).toEqual(['Textures/E_BL_AC_08.dds'])
    expect(lookups).toBe(1)
    expect(await read(origin, found[0]!)).toBe('texture')
  })

  it('keeps listing as the fallback for absent lookup and for partial prefixes', async () => {
    const backing = source(files)
    let lookups = 0
    const origin = createContentSourceCompanionOrigin({
      contentSources: {
        ...backing,
        async lookup() {
          lookups++
          return undefined
        },
      },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const exact: string[] = []
    for await (const entry of origin.enumerate('current-mount', {
      prefix: 'Textures/E_BL_AC_08.dds',
      exactPath: true,
    }))
      exact.push(entry.logicalId)
    expect(exact).toEqual(['Textures/E_BL_AC_08.dds'])
    expect(lookups).toBe(1)
    expect(await ids(origin, 'sibling-directory', 'E_HERO_01.m')).toEqual([
      'E_HERO_01.mot',
      'E_HERO_01.msh',
    ])
    expect(lookups).toBe(1)
  })

  it('keeps primary exclusion and the first container asset root on exact lookup', async () => {
    const layered = {
      ...files,
      'Mods/Foo.SC2Mod/Assets/Textures/marine.dds': 'later duplicate',
    }
    const backing = source(layered)
    const origin = createContentSourceCompanionOrigin({
      contentSources: {
        ...backing,
        async lookup(_sourceId, path) {
          const found = Object.entries(layered).find(
            ([name]) => name.toLowerCase() === path.toLowerCase(),
          )
          return found === undefined
            ? undefined
            : {
                path: found[0],
                name: found[0].split('/').at(-1)!,
                directory: false,
                size: text.encode(found[1]).byteLength,
              }
        },
      },
      target: {
        sourceId: 'local:game',
        path: 'Mods/Foo.SC2Mod/Base.SC2Assets/Assets/Units/marine.m3',
      },
      containerExtensions: ['sc2mod'],
      containerAssetRoots: { sc2mod: ['*.SC2Assets', ''] },
    })
    const found: string[] = []
    for await (const entry of origin.enumerate('enclosing-container', {
      prefix: 'Assets/Textures/marine.dds',
      exactPath: true,
    }))
      found.push(entry.logicalId)
    expect(found).toEqual(['Assets/Textures/marine.dds'])
    expect(await read(origin, found[0]!)).toBe('marine texture')

    const primary = createContentSourceCompanionOrigin({
      contentSources: {
        ...source(files),
        async lookup(_sourceId, path) {
          return { path, name: 'E_HERO_01.msh', directory: false }
        },
      },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const excluded: string[] = []
    for await (const entry of primary.enumerate('current-mount', {
      prefix: 'Models/E_HERO_01.msh',
      exactPath: true,
    }))
      excluded.push(entry.logicalId)
    expect(excluded).toEqual([])
  })

  it('rejects foreign lookup entries and respects cancellation after lookup', async () => {
    const backing = source(files)
    const foreign = createContentSourceCompanionOrigin({
      contentSources: {
        ...backing,
        async lookup() {
          return { path: 'Other/skin.dds', name: 'skin.dds', directory: false }
        },
      },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const foreignRead = async () => {
      for await (const _ of foreign.enumerate('current-mount', {
        prefix: 'Textures/E_BL_AC_08.dds',
        exactPath: true,
      }))
        void _
    }
    await expect(foreignRead()).rejects.toThrow(/outside the requested path/u)

    const failed = createContentSourceCompanionOrigin({
      contentSources: {
        ...backing,
        async lookup() {
          throw new Error('lookup failed')
        },
      },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const recovered: string[] = []
    for await (const entry of failed.enumerate('current-mount', {
      prefix: 'Textures/E_BL_AC_08.dds',
      exactPath: true,
    }))
      recovered.push(entry.logicalId)
    expect(recovered).toEqual(['Textures/E_BL_AC_08.dds'])

    const controller = new AbortController()
    const cancelled = createContentSourceCompanionOrigin({
      contentSources: {
        ...backing,
        async lookup() {
          controller.abort()
          throw new Error('lookup interrupted')
        },
      },
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    const cancelledRead = async () => {
      for await (const _ of cancelled.enumerate(
        'current-mount',
        {
          prefix: 'Textures/E_BL_AC_08.dds',
          exactPath: true,
        },
        controller.signal,
      ))
        void _
    }
    await expect(cancelledRead()).rejects.toMatchObject({ name: 'OperationCancelledError' })
  })

  it('finds what lies next to the file and under the source root', async () => {
    const origin = createContentSourceCompanionOrigin({
      contentSources: source(files),
      target: { sourceId: 'local:game', path: 'Models/E_HERO_01.msh' },
    })
    expect(origin.primaryLogicalId).toBe('E_HERO_01.msh')
    expect(origin.scopes).toEqual(['sibling-directory', 'current-mount'])
    expect(await ids(origin, 'sibling-directory', '')).toEqual([
      'E_HERO_01.mot',
      'E_HERO_01.msh',
      'E_HERO_01.skn',
    ])
    expect(await ids(origin, 'sibling-directory', 'e_hero_01.s')).toEqual(['E_HERO_01.skn'])
    expect(await ids(origin, 'sibling-directory', 'Sub/')).toEqual(['Sub/inner.txt'])
    expect(await read(origin, 'E_HERO_01.skn')).toBe('skin')
    // the root's ids are paths from the root; the primary is not its own companion
    expect(await ids(origin, 'current-mount', 'Textures/')).toEqual(['Textures/E_BL_AC_08.dds'])
    expect(await ids(origin, 'current-mount', 'Models/E_HERO_01.m')).toEqual([
      'Models/E_HERO_01.mot',
    ])
    expect(await read(origin, 'Textures/E_BL_AC_08.dds')).toBe('texture')
    expect(await ids(origin, 'sibling-directory', 'Missing/')).toEqual([])
    expect(await ids(origin, 'workspace-dependency-layer', '')).toEqual([])
  })

  it('reads the asset folders of the container folder the file sits in', async () => {
    const origin = createContentSourceCompanionOrigin({
      contentSources: source(files),
      target: {
        sourceId: 'local:game',
        path: 'Mods/Foo.SC2Mod/Base.SC2Assets/Assets/Units/marine.m3',
      },
      containerExtensions: ['sc2mod'],
      containerAssetRoots: { sc2mod: ['*.SC2Assets', ''] },
    })
    expect(origin.scopes).toContain('enclosing-container')
    expect(await ids(origin, 'enclosing-container', 'Assets/Textures/')).toEqual([
      'Assets/Textures/marine.dds',
      'Assets/Textures/root.dds',
    ])
    expect(await read(origin, 'Assets/Textures/marine.dds')).toBe('marine texture')
    expect(await read(origin, 'Assets/Textures/root.dds')).toBe('root texture')
  })

  it('takes a folder holding a marker file as the container', async () => {
    const origin = createContentSourceCompanionOrigin({
      contentSources: source(files),
      target: { sourceId: 'local:game', path: 'packs/P/assets/models/block.json' },
      containerMarkers: { 'pack.mcmeta': ['assets'] },
    })
    expect(await ids(origin, 'enclosing-container', 'textures/')).toEqual(['textures/stone.png'])
    expect(await read(origin, 'textures/stone.png')).toBe('stone')
  })
})
