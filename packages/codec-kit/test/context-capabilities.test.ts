import { describe, expect, it } from 'vitest'
import type { ContributionContext } from '@modkit/sdk'
import { createInspectionCodec } from '../src/index.js'

const revision = 'provider-token:context-capabilities'
const bytes = new TextEncoder().encode('CAPS')
const source = {
  kind: 'bytes' as const,
  ref: { id: 'caps', uri: 'memory:caps' },
  revision,
  size: BigInt(bytes.length),
  read: async (offset: bigint, length: number) =>
    bytes.slice(Number(offset), Number(offset) + length),
  async *stream() {
    yield bytes.slice()
  },
}
const input = {
  originKind: 'single',
  primaryBindingId: 'content',
  revisions: { topology: 'single', revision },
  bindings: [
    {
      bindingId: 'content',
      role: 'content',
      source: source.ref,
      sourceKind: 'candidate',
      ownership: 'owned',
      revision,
    },
  ],
  openBinding: async () => ({ value: source, release: async () => undefined }),
}
const budget = {
  maxInputBytes: 1024n,
  maxScalarBytes: 1024,
  maxDepth: 8,
  maxNodes: 8,
  maxDiagnostics: 8,
}

describe('host capabilities reach the inspection context', () => {
  it('hands inspect the credential, video and subject catalog ports of the contribution context', async () => {
    const credentials = {
      status: async () => 'available',
    } as unknown as ContributionContext['credentials']
    const videoFrames = {
      decodeFrame: async () => undefined,
    } as unknown as ContributionContext['videoFrames']
    const seen: unknown[] = []
    const catalog = { entities: async () => [] } as NonNullable<ContributionContext['catalog']>
    const codec = createInspectionCodec(
      {
        id: 'example/caps',
        format: { id: 'example/caps', label: 'Caps' },
        detect: async () => ({ confidence: 1, kind: 'magic' }),
        async inspect(_bytes, context) {
          seen.push(context.credentials, context.videoFrames, context.catalog)
          return { summary: {}, metadata: [], traits: [] }
        },
      },
      {
        contracts: {} as ContributionContext['contracts'],
        credentials,
        videoFrames,
        catalog,
      } as ContributionContext,
    )
    const session = await codec.open(input as never, 'full', budget)
    await session.operations().dispose()
    expect(seen).toEqual([credentials, videoFrames, catalog])
  }, 30_000)
})
