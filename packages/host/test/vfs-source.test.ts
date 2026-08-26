import { mkdtemp, open as openFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { isCancellation } from '@modkitx-x3/core'
import { artifactNamespaceSourceFromVfsMount, createVfsCompanionOrigin } from '@modkitx-x3/host'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { createMemoryVfsProvider } from '@modkitx-x3/vfs/providers/memory'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('public VFS to Host namespace bridge', () => {
  it('resolves exact companion paths without exposing the mount to a codec', async () => {
    const vfs = new VirtualFileSystem().registerProvider(
      createMemoryVfsProvider({
        authority: 'spring-fixture',
        entries: {
          'units/test.lua': new TextEncoder().encode('unit'),
          'objects3d/units/test.s3o': Uint8Array.from([1, 2, 3]),
        },
      }),
    )
    const mount = await vfs.openMount('memory://spring-fixture')
    const origin = createVfsCompanionOrigin({
      mount,
      primaryLogicalId: 'units/test.lua',
      caseSensitivity: 'insensitive',
    })
    const entries = []
    for await (const entry of origin.enumerate('current-mount', {
      prefix: 'objects3d/units/test.s3o',
    })) {
      entries.push(entry)
    }
    expect(entries).toEqual([{ logicalId: 'objects3d/units/test.s3o', size: 3n }])
    const lease = await origin.open('objects3d/units/test.s3o')
    try {
      expect(lease.value.kind).toBe('bytes')
      if (lease.value.kind !== 'bytes') throw new Error('expected byte companion source')
      expect([...(await lease.value.read(0n, 3))]).toEqual([1, 2, 3])
    } finally {
      await lease.release()
      await mount.dispose()
      await vfs.dispose()
    }
  })

  it('opens small ranges above 512 MiB without materializing the file', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'modkit-x3-host-vfs-'))
    temporaryRoots.push(temporary)
    const path = join(temporary, 'large.bin')
    const highOffset = 512 * 1024 * 1024 + 4096
    const handle = await openFile(path, 'w')
    try {
      await handle.write(Uint8Array.from([1, 2, 3, 4]), 0, 4, 32)
      await handle.write(Uint8Array.from([5, 6, 7, 8]), 0, 4, highOffset)
    } finally {
      await handle.close()
    }

    const vfs = new VirtualFileSystem().registerProvider(
      createFileVfsProvider({
        limits: {
          maxFileBytes: 1024n * 1024n * 1024n,
          maxReadBytes: 32n,
          maxReadRangeBytes: 8,
          maxStreamBytes: 8n,
        },
      }),
    )
    const mount = await vfs.openMount(pathToFileURL(temporary).href)
    vfs.mount('', mount)
    const rootLease = await artifactNamespaceSourceFromVfsMount(mount).openNamespace()
    try {
      const entryLease = await rootLease.value.open('large.bin')
      try {
        expect(entryLease.value.kind).toBe('bytes')
        if (entryLease.value.kind !== 'bytes') throw new Error('expected a byte source')
        expect(entryLease.value.size).toBe(BigInt(highOffset + 4))
        expect([...(await entryLease.value.read(32n, 4))]).toEqual([1, 2, 3, 4])
        expect([...(await entryLease.value.read(BigInt(highOffset), 4))]).toEqual([5, 6, 7, 8])

        const aborted = new AbortController()
        aborted.abort()
        await expect(entryLease.value.read(0n, 1, aborted.signal)).rejects.toSatisfy(isCancellation)
        const iterator = entryLease.value
          .stream({ offset: 0n, length: 1n }, aborted.signal)
          [Symbol.asyncIterator]()
        await expect(iterator.next()).rejects.toSatisfy(isCancellation)
      } finally {
        await entryLease.release?.()
      }
    } finally {
      await rootLease.release?.()
      await vfs.dispose()
    }
  }, 15_000)
})
