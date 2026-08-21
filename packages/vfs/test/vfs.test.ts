import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { isModkitError } from '@modkitx-x3/core'
import {
  VfsProviderRegistry,
  VirtualFileSystem,
  type VfsMount,
  type VfsNode,
  type VfsProvider,
} from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { createMemoryVfsProvider } from '@modkitx-x3/vfs/providers/memory'

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
        limits: { maxBytes: 1n },
      }),
    ).toThrowError(expect.objectContaining({ code: 'x3.vfs/memory-byte-budget-exceeded' }))
  })
})

describe('file VFS provider', () => {
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
      limits: { maxEntries: 1, maxBytes: 1024n, maxPathBytes: 256 },
    })
    await expect(listed(mount.list(''))).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/file-entry-budget-exceeded',
    )
    await mount.dispose()
  })
})
