import { expect, it } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import { createContentDependencyAssetOrigin } from '../src/content-dependencies.js'

const resolution: ContentDependencyResolution = {
  schemaVersion: 1,
  gameId: 'example/game',
  complete: true,
  mounts: [
    {
      dependencyId: 'assets',
      order: 0,
      sourceId: 'cdn',
      sourcePath: 'assets',
      displayName: 'Assets',
      kind: 'content-archive',
      fingerprint: 'content-hash.sha256:assets',
    },
  ],
  dependencies: [],
  diagnostics: [],
}

/** A source that fetches on demand: its listing names nothing it has not downloaded yet. */
function onDemand(lookups: string[]): ContentSources {
  return {
    async snapshot() {
      return { label: 'cdn', regions: [], connections: [], roots: [] }
    },
    async connect() {},
    async disconnect() {},
    async search() {
      return []
    },
    async add() {},
    async remove() {},
    async refresh() {},
    async list() {
      return []
    },
    async lookup(_sourceId, path) {
      lookups.push(path)
      return path === 'assets/mesh/123' ? { path, name: '123', directory: false } : undefined
    },
    async read(_sourceId, path) {
      if (path !== 'assets/mesh/123') throw new RangeError('missing')
      return new TextEncoder().encode('mesh')
    },
    dispose() {},
  }
}

it('opens an asset by its exact path before any listing names it', async () => {
  const lookups: string[] = []
  const origin = createContentDependencyAssetOrigin({
    contentSources: onDemand(lookups),
    resolution,
  })
  const lease = await origin!.open('mesh/123')
  if (lease.value.kind !== 'bytes') throw new Error('expected an asset byte source')
  expect(new TextDecoder().decode(await lease.value.read(0n, 4))).toBe('mesh')
  expect(lookups).toEqual(['assets/mesh/123'])
  await expect(origin!.open('mesh/404')).rejects.toThrow(/content dependency has no entry/)
})

it('retains atomic entry metadata when the content source supports it', async () => {
  const source = onDemand([])
  const origin = createContentDependencyAssetOrigin({
    contentSources: {
      ...source,
      async read() { throw new Error('must use the atomic read') },
      async readWithContext(_sourceId, path) {
        expect(path).toBe('assets/mesh/123')
        return { bytes: new Uint8Array([3]), context: { hash: 'resource-hash' } }
      },
    },
    resolution,
  })
  const lease = await origin!.open('mesh/123')
  expect(lease.value.containerContext).toEqual({ hash: 'resource-hash' })
  await lease.release()
})
