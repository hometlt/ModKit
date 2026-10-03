import { expect, it } from 'vitest'
import type { NamespaceEntry, NamespaceEntrySource, RevisionId } from '@modkit/sdk'
import { createCompositeWorkspaceNamespaceCompanionOrigin } from '../src/namespace-origin.js'

const revision = 'rev-1' as RevisionId

/** A flat listing over fixed paths, each file's bytes its own path. */
function namespace(paths: readonly string[]): NamespaceEntrySource {
  return {
    async list(prefix) {
      const items: NamespaceEntry[] = paths
        .filter(path => path.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(
          path => ({ id: path, path, name: path.split('/').at(-1)!, kind: 'file', size: BigInt(path.length), revision }),
        )
      return { items }
    },
    async openEntry(id: string) {
      return {
        value: { id: `fixture:${id}`, uri: `fixture:${id}` },
        release: async () => undefined,
      }
    },
  }
}

function origin(mapAssetRoots?: readonly string[]) {
  const map = namespace(['Assets/Textures/imported.dds', 'MapInfo'])
  const mod = namespace(['Mods/Liberty.SC2Mod/Base.SC2Assets/Assets/Textures/stock.dds'])
  return createCompositeWorkspaceNamespaceCompanionOrigin({
    primaryLogicalId: 'opened/map.sc2map/MapInfo',
    roots: [
      {
        rootId: 'map',
        pathPrefix: '',
        logicalPrefix: 'opened/map.sc2map',
        namespace: map,
        containerRevision: revision,
        extract: async id => new TextEncoder().encode(id),
        ...(mapAssetRoots === undefined ? {} : { assetRoots: mapAssetRoots }),
      },
      {
        rootId: 'liberty',
        pathPrefix: 'Mods/Liberty.SC2Mod',
        logicalPrefix: 'Mods/Liberty.SC2Mod',
        namespace: mod,
        containerRevision: revision,
        extract: async id => new TextEncoder().encode(id),
      },
    ],
  })
}

async function located(source: ReturnType<typeof origin>, logicalId: string) {
  const found: string[] = []
  for await (const entry of source.enumerate('workspace-dependency-layer', { prefix: logicalId }))
    found.push(`${entry.rootId}:${entry.logicalId}`)
  return found
}

it('finds a map-imported asset at the map root under its game-logical base.sc2assets name', async () => {
  const roots = ['Base.SC2Assets', '*.SC2Assets', '']
  const source = origin(roots)
  const wanted = 'base.sc2assets/Assets/Textures/imported.dds'
  expect(await located(source, wanted)).toEqual([`map:${wanted}`])
  // Opened by the same lookup: the bytes are the map root's file.
  const lease = await source.open(wanted)
  if (lease.value.kind !== 'bytes') throw new Error('expected an asset byte source')
  expect(new TextDecoder().decode(await lease.value.read(0n, 64))).toBe(
    'Assets/Textures/imported.dds',
  )
  await lease.release()
  // The installed game's copy is still found where a mod keeps it.
  expect(
    (await located(source, 'base.sc2assets/Assets/Textures/stock.dds')).map(id => id.toLowerCase()),
  ).toEqual(['liberty:base.sc2assets/assets/textures/stock.dds'])
  // Without the declared roots the map's own import stays out of reach, as before.
  expect(await located(origin(), wanted)).toEqual([])
})
