/**
 * A resource of an origin opened as a subject of its own (a map's `.smf` texture) finds its own
 * companions (the `.smt` tiles) in the same origin, with itself as the primary.
 */
import { describe, expect, it } from 'vitest'
import { revisionId } from '@modkit/sdk'
import { createCompanionInputResolver, type CompanionOrigin } from '../src/input-resolution.js'

const revision = revisionId('provider-token:for-resource')
const files = ['maps/level.smd', 'maps/level.smf', 'maps/level.smt']

function source(id: string) {
  return {
    kind: 'bytes' as const,
    ref: { id, uri: `test:${id}` },
    revision,
    size: 1n,
    read: async () => Uint8Array.of(1),
    async *stream() {
      yield Uint8Array.of(1)
    },
  }
}

const origin: CompanionOrigin = {
  primaryLogicalId: 'maps/level.smd',
  caseSensitivity: 'insensitive',
  scopes: ['current-mount'],
  async *enumerate(_scope, options) {
    for (const logicalId of files) if (logicalId.startsWith(options.prefix)) yield { logicalId }
  },
  async open(logicalId) {
    return { value: source(logicalId), release: async () => undefined }
  },
}

describe('companions of a resource opened as its own subject', () => {
  it('resolve beside the resource, excluding the resource itself', async () => {
    const resolver = createCompanionInputResolver(origin, {})
    const nested = resolver.forResource?.('maps/level.smf')
    if (nested === undefined) throw new Error('the resolver has no forResource')
    const input = await nested({
      source: source('maps/level.smf'),
      plan: {
        originKind: 'bundle',
        candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
        requirements: [
          {
            id: 'tiles',
            role: 'tiles',
            ownership: 'companion',
            patterns: ['maps/*.sm?'],
            scopes: ['current-mount'],
            cardinality: 'zero-or-more',
            required: false,
          },
        ],
      },
      detection: { codecId: 'test', confidence: 1, evidence: [], requiredRanges: [] },
    } as never)
    if (input.originKind === 'derived') throw new Error('expected a physical input')
    const bound = input
      .bindingsFor('tiles')
      .map(binding => binding.source.id)
      .sort()
    expect(bound).toEqual(['maps/level.smd', 'maps/level.smt'])
  })
})
