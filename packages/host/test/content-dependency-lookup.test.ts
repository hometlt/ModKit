import { expect, it, vi } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import { createContentDependencyAssetOrigin } from '../src/content-dependencies.js'
import type { CompanionOrigin } from '../src/input-resolution.js'

/** Enumerate a requested dependency file through the existing owner contract. */
async function exactIds(origin: CompanionOrigin, prefix: string, signal?: AbortSignal) {
  const ids: string[] = []
  for await (const entry of origin.enumerate('workspace-dependency-layer', { prefix, exactPath: true }, signal))
    ids.push(entry.logicalId)
  return ids
}

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

it('enumerates and opens a hidden FileDataID alias by exact lookup without listing', async () => {
  const lookup = vi.fn(async (_sourceId: string, path: string) => ({ path, name: '123', directory: false, hidden: true as const }))
  const list = vi.fn(async () => [])
  const read = vi.fn(async () => new Uint8Array([3]))
  const origin = createContentDependencyAssetOrigin({ contentSources: { ...onDemand([]), lookup, list, read }, resolution })!
  expect(await exactIds(origin, 'filedataid/123')).toEqual(['filedataid/123'])
  expect(lookup).toHaveBeenCalledWith('cdn', 'assets/filedataid/123')
  expect(list).not.toHaveBeenCalled()
  const lease = await origin.open('filedataid/123')
  try { expect(await (lease.value as import('@modkit/sdk').ArtifactByteSource).read(0n, 1)).toEqual(new Uint8Array([3])) }
  finally { await lease.release() }
  expect(read).toHaveBeenCalledWith('cdn', 'assets/filedataid/123', 64 * 1024 * 1024)
})

it('does not enumerate provider-specific row fields during exact lookup', async () => {
  const entry = Object.defineProperty({ path: 'assets/mesh/123', name: '123', directory: false }, 'unrelated', {
    enumerable: true, get() { throw new Error('Unknown provider fields must not be enumerated') },
  })
  const source = { ...onDemand([]), async lookup() { return entry } }
  const origin = createContentDependencyAssetOrigin({ contentSources: source, resolution })!
  expect(await exactIds(origin, 'mesh/123')).toEqual(['mesh/123'])
})

it.each(['absent', 'undefined', 'throw', 'directory'] as const)('preserves listing fallback for %s lookup', async mode => {
  const source = onDemand([])
  if (mode === 'absent') delete source.lookup
  else source.lookup = async (_sourceId, path) => {
    if (mode === 'throw') throw new Error('optional lookup unavailable')
    return mode === 'directory' ? { path, name: '123', directory: true } : undefined
  }
  const list = vi.fn(async () => [{ path: 'assets/mesh/123', name: '123', directory: false }])
  const origin = createContentDependencyAssetOrigin({ contentSources: { ...source, list }, resolution })!
  expect(await exactIds(origin, 'mesh/123')).toEqual(['mesh/123'])
  expect(list).toHaveBeenCalledTimes(1)
  const lease = await origin.open('mesh/123')
  try { expect(new TextDecoder().decode(await (lease.value as import('@modkit/sdk').ArtifactByteSource).read(0n, 4))).toBe('mesh') }
  finally { await lease.release() }
})

it.each(['x3.host/permission-missing', 'x3.vfs/source-revision-changed', 'EACCES', 'EPERM', 'AbortError', 'TimeoutError'])
('propagates %s without enumerating or reading a fallback', async code => {
  const error = code.endsWith('Error') ? new DOMException('refused', code) : Object.assign(new Error('refused'), { code })
  const list = vi.fn(async () => [{ path: 'assets/mesh/123', name: '123', directory: false }])
  const read = vi.fn(async () => new Uint8Array([1]))
  const lookup = vi.fn(async () => { throw error })
  const origin = createContentDependencyAssetOrigin({ contentSources: { ...onDemand([]), list, read, lookup }, resolution })!
  await expect(exactIds(origin, 'mesh/123')).rejects.toBe(error)
  await expect(origin.open('mesh/123')).rejects.toBe(error)
  expect(list).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})

it('preserves case spelling and rejects an exact lookup outside the requested alias', async () => {
  const list = vi.fn(async () => [])
  const source = { ...onDemand([]), list, lookup: vi.fn(async () => ({ path: 'Assets/Mesh/123', name: '123', directory: false })) }
  const origin = createContentDependencyAssetOrigin({ contentSources: source, resolution })!
  expect(await exactIds(origin, 'mesh/123')).toEqual(['Mesh/123'])
  source.lookup.mockImplementation(async () => ({ path: 'assets/other/123', name: '123', directory: false }))
  await expect(exactIds(origin, 'mesh/404')).rejects.toThrow(/outside the requested path/u)
  expect(list).not.toHaveBeenCalled()
})

it.each([true, false])('confines explicit mount enumeration and direct open (file present: %s)', async present => {
  const calls: string[] = []
  const source = { ...onDemand([]),
    async lookup(_sourceId: string, path: string) {
      calls.push(path)
      return present && path === 'assets/mesh/123' ? { path, name: '123', directory: false } : undefined
    },
    async list(_sourceId: string, path: string) {
      calls.push(path)
      return path === 'other/content-dependencies/0/mesh'
        ? [{ path: `${path}/123`, name: '123', directory: false }] : []
    },
  }
  const layered = { ...resolution, mounts: [...resolution.mounts, { ...resolution.mounts[0]!, dependencyId: 'other', order: 1, sourcePath: 'other' }] }
  const origin = createContentDependencyAssetOrigin({ contentSources: source, resolution: layered })!
  expect(await exactIds(origin, 'content-dependencies/0/mesh/123')).toEqual(present ? ['content-dependencies/0/mesh/123'] : [])
  const fresh = createContentDependencyAssetOrigin({ contentSources: source, resolution: layered })!
  if (present) { const lease = await fresh.open('content-dependencies/0/mesh/123'); await lease.release() }
  else await expect(fresh.open('content-dependencies/0/mesh/123')).rejects.toThrow(/no entry/u)
  expect(calls.every(path => path.startsWith('assets/'))).toBe(true)
})

it('keeps strongest-first precedence for unqualified exact lookups', async () => {
  const calls: string[] = []
  const source = { ...onDemand([]), async lookup(_sourceId: string, path: string) {
    calls.push(path)
    return { path, name: '123', directory: false }
  }, read: vi.fn(async () => new Uint8Array([2])) }
  const layered = { ...resolution, mounts: [...resolution.mounts, { ...resolution.mounts[0]!, dependencyId: 'other', order: 1, sourcePath: 'other' }] }
  const origin = createContentDependencyAssetOrigin({ contentSources: source, resolution: layered })!
  expect(await exactIds(origin, 'mesh/123')).toEqual(['mesh/123'])
  expect(calls).toEqual(['other/mesh/123', 'assets/mesh/123'])
  const lease = await origin.open('mesh/123'); await lease.release()
  expect(source.read).toHaveBeenCalledWith('cdn', 'other/mesh/123', 64 * 1024 * 1024)
})

it('propagates cancellation during an optional lookup before listing', async () => {
  const controller = new AbortController(), list = vi.fn(async () => [])
  const source = { ...onDemand([]), list, async lookup() { controller.abort(); return undefined } }
  const origin = createContentDependencyAssetOrigin({ contentSources: source, resolution })!
  await expect(exactIds(origin, 'mesh/123', controller.signal)).rejects.toMatchObject({ code: 'x3.core/operation-cancelled' })
  expect(list).not.toHaveBeenCalled()
})
