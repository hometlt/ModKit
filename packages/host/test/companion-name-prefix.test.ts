/**
 * A pattern narrows the listing past its directory: `anim/Zombie_*.ani` in a directory of 15 000
 * clips must not spend the resolver's entry budget (4 096) on names no pattern can match.
 */
import { describe, expect, it } from 'vitest'
import { revisionId, type NamespaceEntrySource } from '@modkit/sdk'
import { createCompanionInputResolver } from '../src/input-resolution.js'
import { createNamespaceCompanionOrigin } from '../src/namespace-origin.js'

const revision = revisionId('provider-token:name-prefix')
const names = [
  ...Array.from({ length: 5000 }, (_, index) => `anim/Skeleton_${String(index)}.ani`),
  'anim/Zombie_walk.ani',
  'anim/Zombie_attack.ani',
]

function namespace(): NamespaceEntrySource {
  return {
    async list(prefix, page) {
      const matching = names.filter(name => name.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const items = matching.slice(start, start + page.limit).map(path => ({
        id: path,
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        kind: 'file' as const,
        size: 1n,
        revision,
      }))
      return start + items.length < matching.length
        ? { items, nextCursor: String(start + items.length) }
        : { items }
    },
    async openEntry(entryId) {
      return {
        value: { id: entryId, uri: `test:${entryId}`, parentIds: ['archive'] },
        release: async () => undefined,
      }
    },
  } as unknown as NamespaceEntrySource
}

describe('companion listing narrowed by a name prefix', () => {
  it('drops names outside the pattern before the entry budget counts them', async () => {
    const origin = createNamespaceCompanionOrigin({
      namespace: namespace(),
      primaryLogicalId: 'actors/Zombie.acr',
      containerRevision: revision,
    } as never)
    const seen: string[] = []
    for await (const entry of origin.enumerate('current-mount', {
      prefix: 'anim/',
      namePrefix: 'Zombie_',
    }))
      seen.push(entry.logicalId)
    expect(seen.sort()).toEqual(['anim/Zombie_attack.ani', 'anim/Zombie_walk.ani'])
  })

  it('passes the pattern name start to the origin, so a large directory resolves', async () => {
    const origin = createNamespaceCompanionOrigin({
      namespace: namespace(),
      primaryLogicalId: 'actors/Zombie.acr',
      containerRevision: revision,
      extract: async () => Uint8Array.of(1),
    } as never)
    const resolve = createCompanionInputResolver(origin, {})
    const uri = 'memory://actors/Zombie.acr'
    const input = await resolve({
      source: {
        kind: 'bytes',
        ref: { id: uri, uri },
        revision,
        size: 1n,
        read: async () => Uint8Array.of(1),
      },
      plan: {
        originKind: 'bundle',
        candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
        requirements: [
          {
            id: 'clips',
            role: 'animation',
            ownership: 'companion',
            patterns: ['anim/Zombie_*.ani'],
            scopes: ['current-mount'],
            cardinality: 'zero-or-more',
            required: false,
          },
        ],
      },
      detection: { codecId: 'test', confidence: 1, evidence: [], requiredRanges: [] },
    } as never)
    if (input.originKind === 'derived') throw new Error('expected a physical input')
    expect(input.bindingsFor('clips')).toHaveLength(2)
  })
})
