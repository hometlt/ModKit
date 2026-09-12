import { mkdir, mkdtemp, open as openFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { isCancellation, isModkitError } from '@modkit/core'
import {
  collectStream,
  DEFAULT_VFS_LIMITS,
  VfsProviderRegistry,
  VirtualFileSystem,
  type VfsMount,
  type VfsNode,
  type VfsProvider,
} from '@modkit/vfs'
import { createFileVfsProvider, fileSystemRevisionToken } from '@modkit/vfs/providers/file'
import { createBrowserFileVfsProvider } from '@modkit/vfs/providers/browser-file'
import { createHttpVfsProvider, type HttpFetch } from '@modkit/vfs/providers/http'
import { createMemoryVfsProvider } from '@modkit/vfs/providers/memory'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function listed(source: AsyncIterable<VfsNode>): Promise<VfsNode[]> {
  const nodes: VfsNode[] = []
  for await (const node of source) nodes.push(node)
  return nodes
}

describe('provider-neutral VFS core', () => {
  it('requires explicit registration and accepts a custom protocol provider', async () => {
    const backing = createMemoryVfsProvider({
      authority: 'fixture',
      entries: { 'root/marker.bin': new Uint8Array([1, 2, 3]) },
    })
    const custom: VfsProvider = {
      id: 'org.example.site-api',
      scheme: 'site-api',
      open(_uri, context): Promise<VfsMount> {
        return backing.open('memory://fixture/root', context)
      },
    }
    const registry = new VfsProviderRegistry()
    await expect(registry.open('site-api://project')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/provider-not-registered',
    )
    registry.register(custom)
    const mount = await registry.open('site-api://project')
    const source = await mount.open('marker.bin')
    expect([...(await source.readAt(0, 3))]).toEqual([1, 2, 3])
    await mount.dispose()
  })

  it('resolves the longest explicit mount without leaking provider knowledge into the core', async () => {
    const provider = createMemoryVfsProvider({
      authority: 'fixture',
      entries: {
        'base/root.bin': new Uint8Array([1]),
        'nested/selected.bin': new Uint8Array([2]),
      },
    })
    const vfs = new VirtualFileSystem().registerProvider(provider)
    vfs.mount('subject', await vfs.openMount('memory://fixture/base'))
    vfs.mount('subject/nested', await vfs.openMount('memory://fixture/nested'))
    const source = await vfs.open('subject/nested/selected.bin')
    expect([...(await source.readAt(0, 1))]).toEqual([2])
    await vfs.dispose()
  })

  it('enforces memory provider entry and byte boundaries with named refusals', async () => {
    expect(() =>
      createMemoryVfsProvider({
        entries: { a: new Uint8Array([1]), b: new Uint8Array([2]) },
        limits: { maxEntries: 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'x3.vfs/memory-entry-budget-exceeded' }))
    expect(() =>
      createMemoryVfsProvider({
        entries: { a: new Uint8Array([1, 2]) },
        limits: { maxMaterializedBytes: 1n },
      }),
    ).toThrowError(expect.objectContaining({ code: 'x3.vfs/memory-byte-budget-exceeded' }))
  })
})

describe('file VFS provider', () => {
  it('uses one exact stable revision token for mounts and later conflict checks', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-vfs-revision-'))
    temporaryRoots.push(temporary)
    await writeFile(join(temporary, 'entry.bin'), new Uint8Array([1, 2, 3]))
    const provider = createFileVfsProvider()
    const mount = await provider.open(pathToFileURL(temporary).href, {
      limits: DEFAULT_VFS_LIMITS,
    })
    const first = await fileSystemRevisionToken(temporary)
    expect(first).toBe(mount.revision)
    expect(await fileSystemRevisionToken(temporary)).toBe(first)
    await mount.dispose()
  })

  it('opens a temporary directory through the product provider and refuses root escape', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-vfs-'))
    temporaryRoots.push(temporary)
    const root = join(temporary, 'root')
    await mkdir(root)
    await writeFile(join(root, 'marker.bin'), new Uint8Array([7, 8, 9]))
    await writeFile(join(temporary, 'outside.bin'), new Uint8Array([0]))

    const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    vfs.mount('subject', await vfs.openMount(pathToFileURL(root).href))
    expect((await listed(vfs.list('subject'))).map(node => node.path)).toEqual(['marker.bin'])
    const marker = await vfs.open('subject/marker.bin')
    expect([...(await marker.readAt(0, 3))]).toEqual([7, 8, 9])
    await expect(vfs.open('subject/../outside.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/path-escape-refused',
    )
    await vfs.dispose()
  })

  it('bounds directory enumeration before yielding entries', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-vfs-budget-'))
    temporaryRoots.push(temporary)
    await writeFile(join(temporary, 'a.bin'), new Uint8Array([1]))
    await writeFile(join(temporary, 'b.bin'), new Uint8Array([2]))
    const provider = createFileVfsProvider({ limits: { maxEntries: 1 } })
    const mount = await provider.open(pathToFileURL(temporary).href, {
      limits: { ...DEFAULT_VFS_LIMITS, maxEntries: 1, maxPathBytes: 256 },
    })
    await expect(listed(mount.list(''))).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/file-entry-budget-exceeded',
    )
    await mount.dispose()
  })

  it('opens a sparse file above 512 MiB and reads small ranges on both sides of that offset', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-vfs-large-'))
    temporaryRoots.push(temporary)
    const path = join(temporary, 'large.bin')
    const above512MiB = 512 * 1024 * 1024 + 4096
    const logicalSize = above512MiB + 4
    const handle = await openFile(path, 'w')
    try {
      await handle.write(Uint8Array.from([1, 2, 3, 4]), 0, 4, 64)
      await handle.write(Uint8Array.from([5, 6, 7, 8]), 0, 4, above512MiB)
    } finally {
      await handle.close()
    }

    const vfs = new VirtualFileSystem().registerProvider(
      createFileVfsProvider({
        limits: {
          maxFileBytes: 1024n * 1024n * 1024n,
          maxReadBytes: 16n,
          maxReadRangeBytes: 8,
          maxStreamBytes: 8n,
        },
      }),
    )
    vfs.mount('', await vfs.openMount(pathToFileURL(temporary).href))
    const source = await vfs.open('large.bin')
    expect(await source.size()).toBe(logicalSize)
    expect([...(await source.readAt(64, 4))]).toEqual([1, 2, 3, 4])
    expect([...(await source.readAt(above512MiB, 4))]).toEqual([5, 6, 7, 8])
    await vfs.dispose()
  }, 30_000)

  it('accounts repeated and parallel reads against one mount-wide actual-byte budget', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-vfs-reads-'))
    temporaryRoots.push(temporary)
    await writeFile(
      join(temporary, 'bytes.bin'),
      Uint8Array.from({ length: 16 }, (_, i) => i),
    )
    const vfs = new VirtualFileSystem().registerProvider(
      createFileVfsProvider({
        limits: { maxReadBytes: 8n, maxReadRangeBytes: 4, maxStreamBytes: 8n },
      }),
    )
    vfs.mount('', await vfs.openMount(pathToFileURL(temporary).href))
    const source = await vfs.open('bytes.bin')
    expect([...(await source.readAt(0, 4))]).toEqual([0, 1, 2, 3])

    const parallel = await Promise.allSettled([source.readAt(4, 3), source.readAt(7, 3)])
    expect(parallel.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(parallel.filter(result => result.status === 'rejected')).toHaveLength(1)
    const refusal = parallel.find(result => result.status === 'rejected')
    expect(refusal).toEqual(
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'x3.vfs/read-byte-budget-exceeded' }),
      }),
    )
    await expect(source.readAt(10, 1)).resolves.toHaveLength(1)
    await expect(source.readAt(11, 1)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/read-byte-budget-exceeded',
    )
    await vfs.dispose()
  })

  it('names logical file, range, and stream limits and honors AbortSignal', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-vfs-limits-'))
    temporaryRoots.push(temporary)
    await writeFile(
      join(temporary, 'bytes.bin'),
      Uint8Array.from({ length: 8 }, (_, i) => i),
    )

    const sizeProvider = createFileVfsProvider({ limits: { maxFileBytes: 4n } })
    const sizeMount = await sizeProvider.open(pathToFileURL(temporary).href, {
      limits: { ...DEFAULT_VFS_LIMITS, maxFileBytes: 4n },
    })
    await expect(sizeMount.open('bytes.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/file-size-limit-exceeded',
    )
    await sizeMount.dispose()

    const vfs = new VirtualFileSystem().registerProvider(
      createFileVfsProvider({
        limits: { maxReadBytes: 16n, maxReadRangeBytes: 2, maxStreamBytes: 4n },
      }),
    )
    vfs.mount('', await vfs.openMount(pathToFileURL(temporary).href))
    const source = await vfs.open('bytes.bin')
    await expect(source.readAt(0, 3)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/read-range-limit-exceeded',
    )
    expect(() => source.stream(0, 5)).toThrowError(
      expect.objectContaining({ code: 'x3.vfs/stream-byte-limit-exceeded' }),
    )

    const aborted = new AbortController()
    aborted.abort()
    await expect(source.readAt(0, 1, aborted.signal)).rejects.toSatisfy(isCancellation)
    await expect(collectStream(source.stream(0, 2, aborted.signal))).rejects.toSatisfy(
      isCancellation,
    )
    await vfs.dispose()
  })
})

describe('HTTP VFS provider', () => {
  it('mounts one allow-listed exact-range resource and enforces the mount read budget', async () => {
    const bytes = new TextEncoder().encode('0123456789')
    const fetcher: HttpFetch = async (_url, init) => {
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          status: 200,
          headers: {
            get: name =>
              name.toLowerCase() === 'content-length'
                ? String(bytes.length)
                : name.toLowerCase() === 'accept-ranges'
                  ? 'bytes'
                  : null,
          },
          async arrayBuffer() {
            return new ArrayBuffer(0)
          },
        }
      }
      const match = /^bytes=(\d+)-(\d+)$/u.exec(init?.headers?.['Range'] ?? '')
      if (match === null) throw new TypeError('missing HTTP range')
      const start = Number(match[1])
      const body = bytes.slice(start, Number(match[2]) + 1)
      return {
        ok: true,
        status: 206,
        headers: { get: () => null },
        async arrayBuffer() {
          return body.buffer
        },
      }
    }
    const vfs = new VirtualFileSystem().registerProvider(
      createHttpVfsProvider({
        fetch: fetcher,
        allowedOrigins: ['https://assets.example'],
        limits: { maxReadBytes: 6n },
      }),
    )
    await expect(vfs.openMount('https://other.example/asset.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/http-origin-refused',
    )
    vfs.mount('remote', await vfs.openMount('https://assets.example/asset.bin'))
    expect(await vfs.stat('remote')).toMatchObject({ name: 'asset.bin', size: 10n })
    const source = await vfs.open('remote')
    expect(new TextDecoder().decode(await source.readAt(2, 4))).toBe('2345')
    await expect(source.readAt(0, 3)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/read-byte-budget-exceeded',
    )
    await vfs.dispose()
  })

  it('checks a redirect target before requesting it and applies the same policy to range reads', async () => {
    const calls: string[] = []
    const fetcher: HttpFetch = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      expect(init?.redirect).toBe('manual')
      if (url === 'https://assets.example/head-redirect.bin') {
        return {
          ok: false,
          status: 302,
          headers: {
            get: name =>
              name.toLowerCase() === 'location' ? 'https://evil.example/asset.bin' : null,
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          status: 200,
          headers: {
            get: name =>
              name.toLowerCase() === 'content-length'
                ? '4'
                : name.toLowerCase() === 'accept-ranges'
                  ? 'bytes'
                  : null,
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      return {
        ok: false,
        status: 307,
        headers: {
          get: name =>
            name.toLowerCase() === 'location' ? 'https://evil.example/range.bin' : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    const provider = createHttpVfsProvider({
      fetch: fetcher,
      allowedOrigins: ['https://assets.example'],
    })

    await expect(
      provider.open('https://assets.example/head-redirect.bin', {
        limits: DEFAULT_VFS_LIMITS,
      }),
    ).rejects.toMatchObject({ code: 'x3.vfs/http-origin-refused' })
    expect(calls.filter(call => call.includes('evil.example'))).toEqual([])

    const mount = await provider.open('https://assets.example/range-redirect.bin', {
      limits: DEFAULT_VFS_LIMITS,
    })
    const source = await mount.open('')
    await expect(source.readAt(0, 4)).rejects.toMatchObject({
      code: 'x3.vfs/http-origin-refused',
    })
    expect(calls.filter(call => call.includes('evil.example'))).toEqual([])
    await mount.dispose()
  })

  it('bounds manual redirect loops', async () => {
    const calls: string[] = []
    const fetcher: HttpFetch = async (url, init) => {
      calls.push(url)
      expect(init?.redirect).toBe('manual')
      return {
        ok: false,
        status: 302,
        headers: {
          get: name => (name.toLowerCase() === 'location' ? '/loop.bin' : null),
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    const provider = createHttpVfsProvider({
      fetch: fetcher,
      allowedOrigins: ['https://assets.example'],
      maxRedirects: 2,
    })
    await expect(
      provider.open('https://assets.example/loop.bin', { limits: DEFAULT_VFS_LIMITS }),
    ).rejects.toMatchObject({
      code: 'x3.vfs/http-redirect-refused',
      message: expect.stringContaining('bounded hop limit'),
    })
    expect(calls).toHaveLength(3)
  })
})

describe('browser-file VFS provider', () => {
  it('mounts only an explicitly registered capability and detects a changed snapshot', async () => {
    const bytes = new TextEncoder().encode('modkit')
    let lastModified = 7
    const handle = {
      name: 'picked.bin',
      async getFile() {
        return {
          name: 'picked.bin',
          size: bytes.length,
          lastModified,
          slice(start: number, end: number) {
            return {
              async arrayBuffer() {
                return bytes.slice(start, end).buffer
              },
            }
          },
        }
      },
    }
    const provider = createBrowserFileVfsProvider()
    const unregister = provider.register('browser-file:fixture', handle)
    const vfs = new VirtualFileSystem().registerProvider(provider)
    vfs.mount('picked', await vfs.openMount('browser-file:fixture'))
    const source = await vfs.open('picked')
    expect(new TextDecoder().decode(await source.readAt(1, 3))).toBe('odk')
    lastModified = 8
    await expect(vfs.open('picked')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/browser-file-revision-changed',
    )
    await vfs.dispose()
    unregister()
    await expect(
      provider.open('browser-file:fixture', { limits: DEFAULT_VFS_LIMITS }),
    ).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/browser-file-unregistered',
    )
  })
})
