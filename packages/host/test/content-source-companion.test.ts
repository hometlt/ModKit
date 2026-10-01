import { describe, expect, it } from 'vitest'
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
