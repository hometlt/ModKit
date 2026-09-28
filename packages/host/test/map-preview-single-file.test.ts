import { describe, expect, it } from 'vitest'
import type { AssetSession, NamespaceEntrySource } from '@modkit/sdk'
import { singleFileAsContainer } from '../src/maps/single-file-namespace.js'
import { createWorkspaceNamespaceCompanionOrigin } from '../src/namespace-origin.js'

const bytes = new TextEncoder().encode('[Basic]\nName=Tournament\n')

function session(dataSources: readonly string[]): AssetSession & { disposed: boolean } {
  const state = { disposed: false }
  return Object.assign(state, {
    revision: 'r1',
    state: () => 'live' as const,
    descriptor: async () =>
      ({
        interpretation: 'resolved',
        subjectUri: 'file:///C:/Maps/Tournament%20Arena.map',
        revision: 'r1',
        dataSources: dataSources.map(contract => ({ contract, major: 1 })),
        operations: [],
      }) as never,
    dataSource: async (contract: string) => {
      if (contract !== 'common.view/byte-range-source') throw new Error(`no ${contract}`)
      return {
        value: {
          size: async () => BigInt(bytes.byteLength),
          read: async (offset: bigint, length: number) =>
            bytes.slice(Number(offset), Number(offset) + length),
        },
        release: async () => undefined,
      }
    },
    operations: () => ({ invoke: async () => ({ state: 'rejected' }), dispose: async () => {} }),
    events: async function* () {},
    dispose: async () => {
      state.disposed = true
    },
  }) as unknown as AssetSession & { disposed: boolean }
}

describe('a single-file map on the preview route', () => {
  it('answers as a container of its one file, named by the subject', async () => {
    const original = session(['common.view/byte-range-source'])
    const adapted = await singleFileAsContainer(original, 1024n)
    const descriptor = await adapted.descriptor()
    expect(descriptor.dataSources.map(item => item.contract)).toContain(
      'common.view/namespace-entry-source',
    )
    const extract = descriptor.operations.find(item => item.id === 'container.extract')
    expect(extract?.state).toBe('available')
    const lease = await adapted.dataSource('common.view/namespace-entry-source', 1)
    const page = await (lease.value as NamespaceEntrySource).list('', { limit: 10 })
    expect(page.items.map(item => [item.id, item.path])).toEqual([
      ['subject', 'Tournament Arena.map'],
    ])
    const result = await adapted.operations().invoke(extract!.handlerId, { entryId: 'subject' })
    if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error('not extracted')
    expect(new TextDecoder().decode(result.output.value)).toBe('[Basic]\nName=Tournament\n')
    await expect(
      (await singleFileAsContainer(original, 4n))
        .operations()
        .invoke(extract!.handlerId, { entryId: 'subject' }),
    ).rejects.toThrow(/budget/u)
    await adapted.dispose()
    expect(original.disposed).toBe(true)
  })

  it('serves the map file through the workspace resource origin the preview reads with', async () => {
    const adapted = await singleFileAsContainer(session(['common.view/byte-range-source']), 1024n)
    const descriptor = await adapted.descriptor()
    const handlerId = descriptor.operations.find(item => item.id === 'container.extract')!.handlerId
    const lease = await adapted.dataSource('common.view/namespace-entry-source', 1)
    const origin = createWorkspaceNamespaceCompanionOrigin({
      namespace: lease.value as NamespaceEntrySource,
      primaryLogicalId: 'Tournament Arena.map',
      containerRevision: descriptor.revision,
      logicalRoots: [{ rootId: 'map', pathPrefix: '', logicalPrefix: '' }],
      extract: async entryId => {
        const result = await adapted.operations().invoke(handlerId, { entryId })
        if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error('no bytes')
        return result.output.value
      },
    })
    const opened = await origin.open('Tournament Arena.map')
    if (opened.value.kind !== 'bytes') throw new Error('not bytes')
    expect(opened.value.ref.uri).toBe('file:///C:/Maps/Tournament%20Arena.map')
    expect(new TextDecoder().decode(await opened.value.read(0n, 7))).toBe('[Basic]')
    await opened.release()
    await lease.release()
  })

  it('leaves a container, or a subject without bytes, as it is', async () => {
    const container = session([
      'common.view/byte-range-source',
      'common.view/namespace-entry-source',
    ])
    expect(await singleFileAsContainer(container, 1024n)).toBe(container)
    const opaque = session([])
    expect(await singleFileAsContainer(opaque, 1024n)).toBe(opaque)
  })
})
