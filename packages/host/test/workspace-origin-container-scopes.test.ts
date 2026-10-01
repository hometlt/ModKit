import { describe, expect, it } from 'vitest'
import { revisionId, type NamespaceEntrySource } from '@modkit/sdk'
import type { CompanionOriginEntry } from '../src/input-resolution.js'
import { createWorkspaceNamespaceCompanionOrigin } from '../src/namespace-origin.js'

// a Beyond All Reason map archive: the map and its tiles in maps/, mapinfo.lua at the root
const revision = revisionId('provider-token:avalanche')
const files: Record<string, string> = {
  'maps/avalanche.smf': 'heights',
  'maps/avalanche.smt': 'tiles',
  'mapinfo.lua': 'return {}',
}
const archive: NamespaceEntrySource = {
  async list(prefix) {
    return {
      items: Object.keys(files)
        .filter(path => path.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(path => ({
          id: path,
          path,
          name: path.split('/').at(-1)!,
          kind: 'file' as const,
          size: BigInt(files[path]!.length),
          revision,
        })),
    }
  },
  async openEntry(entryId) {
    return { value: { id: entryId, uri: `sd7:${entryId}` }, release: async () => {} }
  },
} as NamespaceEntrySource

const origin = (
  logicalRoots: readonly { rootId: string; pathPrefix: string; logicalPrefix?: string }[],
) =>
  createWorkspaceNamespaceCompanionOrigin({
    namespace: archive,
    primaryLogicalId: 'avalanche.smf',
    containerRevision: revision,
    logicalRoots,
    extract: async entryId => new TextEncoder().encode(files[entryId]),
  })

async function names(entries: AsyncIterable<CompanionOriginEntry>): Promise<string[]> {
  const out: string[] = []
  for await (const entry of entries) out.push(entry.logicalId)
  return out
}

describe('a resource opened out of a map workspace finds its companions in the mount', () => {
  // the roots the Spring map preview declares: the map folder, and the archive root by name
  const bar = origin([
    { rootId: 'map', pathPrefix: 'maps' },
    { rootId: 'archive', pathPrefix: '', logicalPrefix: 'archive' },
  ])

  it('serves the container scopes, naming each entry once although two roots see it', async () => {
    expect(bar.scopes).toEqual([
      'workspace-dependency-layer',
      'current-mount',
      'enclosing-container',
    ])
    for (const scope of ['current-mount', 'enclosing-container'] as const)
      expect(await names(bar.enumerate(scope, { prefix: '' }))).toEqual([
        'avalanche.smf',
        'avalanche.smt',
        'mapinfo.lua',
      ])
    const tiles = await bar.open('avalanche.smt')
    if (tiles.value.kind !== 'bytes') throw new Error('not bytes')
    expect(new TextDecoder().decode(await tiles.value.read(0n, 5))).toBe('tiles')
    await tiles.release()
  })

  it('sees nothing outside the workspace roots', async () => {
    const mapOnly = origin([{ rootId: 'map', pathPrefix: 'maps' }])
    expect(await names(mapOnly.enumerate('current-mount', { prefix: '' }))).toEqual([
      'avalanche.smf',
      'avalanche.smt',
    ])
  })
})
