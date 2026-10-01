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

describe('a companion the container stores uncompressed', () => {
  // C&C4 static.bin, stored in its BIG: the entry is bytes 4.. of the BIG
  const big = new TextEncoder().encode('BIGFstatic.bin stored as is, read in place')
  const storedRange = { offset: 4n, length: BigInt(big.byteLength - 4) }
  const stored = (released: string[]): NamespaceEntrySource =>
    ({
      async list() {
        const entry = {
          id: 'static.bin',
          path: 'static.bin',
          name: 'static.bin',
          kind: 'file' as const,
          size: storedRange.length,
          storedRange,
          revision,
        }
        return { items: [entry] }
      },
      async openEntry(entryId: string) {
        return {
          value: { id: `big:${entryId}`, uri: `big:StaticStream.big!/${entryId}` },
          release: async () => void released.push('ref'),
        }
      },
    }) as NamespaceEntrySource
  const openStoredSource = (released: string[]) => async () => ({
    value: {
      size: async () => BigInt(big.byteLength),
      read: async (offset: bigint, length: number) =>
        big.slice(Number(offset), Number(offset) + length),
    },
    release: async () => void released.push('source'),
  })

  it('is read in place from the parent’s bytes past the extraction budget', async () => {
    for (const make of ['single', 'workspace'] as const) {
      const released: string[] = []
      const origin =
        make === 'single'
          ? createNamespaceCompanionOrigin({
              namespace: stored(released),
              primaryLogicalId: 'static.manifest',
              containerRevision: revision,
              extract: refuseExtract,
              maxSourceBytes: 8n,
              openStoredSource: openStoredSource(released),
            })
          : createWorkspaceNamespaceCompanionOrigin({
              namespace: stored(released),
              primaryLogicalId: 'static.manifest',
              containerRevision: revision,
              logicalRoots: [{ rootId: 'stream', pathPrefix: '' }],
              extract: refuseExtract,
              openStoredSource: openStoredSource(released),
            })
      const lease = await origin.open('static.bin')
      if (lease.value.kind !== 'bytes') throw new Error('not bytes')
      expect(lease.value.size).toBe(storedRange.length)
      expect(new TextDecoder().decode(await lease.value.read(0n, 10))).toBe('static.bin')
      expect(new TextDecoder().decode(await lease.value.read(25n, 99))).toBe('read in place')
      await lease.release()
      expect(released).toEqual(['source', 'ref'])
    }
  })

  it('is extracted when the parent publishes no bytes to read it from', async () => {
    const origin = createNamespaceCompanionOrigin({
      namespace: stored([]),
      primaryLogicalId: 'static.manifest',
      containerRevision: revision,
      extract: async () => big.slice(4),
    })
    const lease = await origin.open('static.bin')
    if (lease.value.kind !== 'bytes') throw new Error('not bytes')
    expect(new TextDecoder().decode(await lease.value.read(25n, 99))).toBe('read in place')
    await lease.release()
  })
})
