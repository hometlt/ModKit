import { expect, it, vi } from 'vitest'
import { revisionId, type AssetSession } from '@modkit/sdk'
import { createContainerNamespaceComposition } from '../src/container-composition.js'
import { createResourceSession } from '../src/resource-session.js'

it('reuses the retained namespace origin lazily with opaque extraction ids and bounded reads', async () => {
  const revision = revisionId('provider-token:own-namespace-test')
  const entryRelease = vi.fn(async () => undefined)
  const namespaceRelease = vi.fn(async () => undefined)
  const parentDispose = vi.fn(async () => undefined)
  const entry = {
    id: 'opaque-texture-17',
    path: 'Sources/texture.bin',
    name: 'texture.bin',
    kind: 'file' as const,
    size: 3n,
    revision,
  }
  const list = vi.fn(async () => ({ items: [entry] }))
  const extract = vi.fn(async (handlerId: string, request: { entryId: string }) => {
    expect(handlerId).toBe('native-extract')
    expect(request.entryId).toBe('opaque-texture-17')
    return { state: 'ok', output: { kind: 'bytes', value: new Uint8Array([1, 2, 3]) } }
  })
  const parent = {
    revision,
    state: () => 'live',
    descriptor: async () => ({
      operations: [
        {
          id: 'container.extract',
          handlerId: 'native-extract',
          state: 'available',
          mutatesSource: false,
        },
      ],
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
    }),
    dataSource: async () => ({
      release: namespaceRelease,
      value: {
        list,
        openEntry: async (id: string) => {
          expect(id).toBe('opaque-texture-17')
          return {
            value: { id: 'memory://own/texture', uri: 'memory://own/texture' },
            release: entryRelease,
          }
        },
      },
    }),
    operations: () => ({ invoke: extract }),
    dispose: parentDispose,
  } as unknown as AssetSession
  const composition = await createContainerNamespaceComposition({
    parent,
    root: { id: 'memory://own/model', uri: 'memory://own/model' },
    revision,
    budget: {
      maxInputBytes: 1024n,
      maxDepth: 8,
      maxNodes: 32,
      maxScalarBytes: 1024,
      maxDiagnostics: 8,
    },
  })
  const origin = composition.resourceOrigin(3n)
  expect(list).not.toHaveBeenCalled()
  expect(extract).not.toHaveBeenCalled()
  const resources = createResourceSession({ origin, revision, limits: { maxBytes: 3n } })
  try {
    const result = await resources.resolve({
      id: 'texture',
      logicalId: 'Sources/texture.bin',
      role: 'texture',
      scopes: ['current-mount'],
    })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved' || result.lease.value.kind !== 'bytes')
      throw new Error('texture missing')
    expect(await result.lease.value.read(0n, 3)).toEqual(new Uint8Array([1, 2, 3]))
    expect(extract).toHaveBeenCalledTimes(1)
    const tooSmall = createResourceSession({ origin: composition.resourceOrigin(2n), revision })
    try {
      const refused = await tooSmall.resolve({
        id: 'small',
        logicalId: 'Sources/texture.bin',
        role: 'texture',
        scopes: ['current-mount'],
      })
      expect(refused.state).toBe('unresolved')
      if (refused.state !== 'unresolved') throw new Error('oversized source admitted')
      expect(refused.reason).toBe('budget-exceeded')
      expect(extract).toHaveBeenCalledTimes(1)
    } finally {
      await tooSmall.dispose()
    }
  } finally {
    await resources.dispose()
    await composition.dispose()
  }
  expect(entryRelease).toHaveBeenCalledTimes(1)
  expect(namespaceRelease).toHaveBeenCalledTimes(1)
  expect(parentDispose).not.toHaveBeenCalled()
})
