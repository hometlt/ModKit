import { describe, expect, it } from 'vitest'
import { revisionId, type NamespaceEntrySource } from '@modkit/sdk'
import {
  createNamespaceCompanionOrigin,
  createWorkspaceNamespaceCompanionOrigin,
} from '../src/namespace-origin.js'

const stream = new TextEncoder().encode('static_common decoded stream, read by range')
const revision = revisionId('provider-token:stream-big')

function namespace(released: string[]): NamespaceEntrySource {
  const entry = {
    id: 'static_common.bin',
    path: 'static_common.bin',
    name: 'static_common.bin',
    kind: 'file' as const,
    size: BigInt(stream.byteLength),
    rangeAccess: true as const,
    revision,
  }
  return {
    async list() {
      return { items: [entry] }
    },
    async openEntry(entryId) {
      return {
        value: { id: `big:${entryId}`, uri: `big:StaticStream.big!/${entryId}` },
        release: async () => {
          released.push('ref')
        },
      }
    },
    async openEntrySource() {
      return {
        value: {
          size: async () => BigInt(stream.byteLength),
          read: async (offset: bigint, length: number) =>
            stream.slice(Number(offset), Number(offset) + length),
        },
        release: async () => {
          released.push('source')
        },
      }
    },
  } as NamespaceEntrySource
}

const refuseExtract = async (): Promise<Uint8Array> => {
  throw new Error('a range entry must not be extracted')
}

describe('a companion the container reads by range', () => {
  it('opens by range past the extraction budget, from one namespace or a workspace', async () => {
    for (const make of ['single', 'workspace'] as const) {
      const released: string[] = []
      const origin =
        make === 'single'
          ? createNamespaceCompanionOrigin({
              namespace: namespace(released),
              primaryLogicalId: 'w3dcontainer.bin',
              containerRevision: revision,
              extract: refuseExtract,
              maxSourceBytes: 8n,
            })
          : createWorkspaceNamespaceCompanionOrigin({
              namespace: namespace(released),
              primaryLogicalId: 'w3dcontainer.bin',
              containerRevision: revision,
              logicalRoots: [{ rootId: 'stream', pathPrefix: '' }],
              extract: refuseExtract,
            })
      const lease = await origin.open('static_common.bin')
      if (lease.value.kind !== 'bytes') throw new Error('not bytes')
      expect(lease.value.size).toBe(BigInt(stream.byteLength))
      expect(new TextDecoder().decode(await lease.value.read(30n, 13))).toBe('read by range')
      await lease.release()
      expect(released).toEqual(['source', 'ref'])
    }
  })
})
