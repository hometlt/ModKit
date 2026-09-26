import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'
import { isCancellation, isModkitError } from '@modkit/core'
import { DEFAULT_VFS_LIMITS, VirtualFileSystem, type VfsNode } from '@modkit/vfs'
import { createRapidVfsProvider } from '@modkit/vfs/providers/rapid'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

interface FixtureRecord {
  readonly path: string
  readonly bytes: Uint8Array
  readonly corrupt?: boolean
}

function manifestRecord(record: FixtureRecord): Uint8Array {
  const path = new TextEncoder().encode(record.path)
  const md5 = createHash('md5').update(record.bytes).digest()
  const out = new Uint8Array(1 + path.byteLength + 24)
  const view = new DataView(out.buffer)
  out[0] = path.byteLength
  out.set(path, 1)
  out.set(md5, 1 + path.byteLength)
  view.setUint32(1 + path.byteLength + 16, 0x12345678, false)
  view.setUint32(1 + path.byteLength + 20, record.bytes.byteLength, false)
  return out
}

async function rapidFixture(records: readonly FixtureRecord[]) {
  const root = await mkdtemp(join(tmpdir(), 'modkit-x3-rapid-'))
  temporaryRoots.push(root)
  const manifestPath = join(root, 'data', 'packages', 'fixture.sdp')
  await mkdir(dirname(manifestPath), { recursive: true })
  const chunks = records.map(manifestRecord)
  const manifest = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    manifest.set(chunk, offset)
    offset += chunk.byteLength
  }
  await writeFile(manifestPath, gzipSync(manifest))
  for (const record of records) {
    const md5 = createHash('md5').update(record.bytes).digest('hex')
    const poolPath = join(root, 'data', 'pool', md5.slice(0, 2), `${md5.slice(2)}.gz`)
    await mkdir(dirname(poolPath), { recursive: true })
    await writeFile(
      poolPath,
      gzipSync(record.corrupt ? Uint8Array.from([...record.bytes, 0xff]) : record.bytes),
    )
  }
  return { manifestPath, uri: `rapid+${pathToFileURL(manifestPath).href}` }
}

async function listed(nodes: AsyncIterable<VfsNode>): Promise<readonly VfsNode[]> {
  const out: VfsNode[] = []
  for await (const node of nodes) out.push(node)
  return out
}

describe('Rapid rapid VFS provider', () => {
  it('mounts manifest records case-insensitively and verifies pool bytes before exposing them', async () => {
    const unit = new TextEncoder().encode('return { objectName = "Units/Test.s3o" }')
    const model = Uint8Array.from([1, 2, 3, 4])
    const fixture = await rapidFixture([
      { path: 'units/test.lua', bytes: unit },
      { path: 'objects3d/units/test.s3o', bytes: model },
    ])
    const vfs = new VirtualFileSystem().registerProvider(createRapidVfsProvider())
    const mount = await vfs.openMount(fixture.uri)
    vfs.mount('', mount)
    expect((await listed(vfs.list(''))).map(node => node.path)).toEqual(['objects3d', 'units'])
    expect(await vfs.stat('Objects3D/Units/TEST.s3o')).toMatchObject({
      path: 'objects3d/units/test.s3o',
      kind: 'file',
      size: 4n,
    })
    const source = await vfs.open('Objects3D/Units/TEST.s3o')
    expect([...(await source.readAt(0, 4))]).toEqual([1, 2, 3, 4])
    await source.dispose()
    await vfs.dispose()
  })

  it('names entry, integrity, read and cancellation boundaries', async () => {
    const many = await rapidFixture([
      { path: 'a.bin', bytes: Uint8Array.from([1]) },
      { path: 'b.bin', bytes: Uint8Array.from([2]) },
    ])
    const provider = createRapidVfsProvider({ limits: { maxEntries: 1 } })
    await expect(
      provider.open(many.uri, { limits: { ...DEFAULT_VFS_LIMITS, maxEntries: 1 } }),
    ).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-entry-budget-exceeded',
    )

    const corrupt = await rapidFixture([
      { path: 'broken.bin', bytes: Uint8Array.from([1, 2]), corrupt: true },
    ])
    const vfs = new VirtualFileSystem().registerProvider(
      createRapidVfsProvider({ limits: { maxReadBytes: 1n, maxReadRangeBytes: 1 } }),
    )
    const corruptMount = await vfs.openMount(corrupt.uri)
    await expect(corruptMount.open('broken.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-pool-integrity-mismatch',
    )
    await corruptMount.dispose()

    const valid = await rapidFixture([{ path: 'bytes.bin', bytes: Uint8Array.from([3, 4]) }])
    const validMount = await vfs.openMount(valid.uri)
    const source = await validMount.open('bytes.bin')
    expect([...(await source.readAt(0, 1))]).toEqual([3])
    await expect(source.readAt(1, 1)).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/read-byte-budget-exceeded',
    )
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.readAt(0, 1, aborted.signal)).rejects.toSatisfy(isCancellation)
    await validMount.dispose()
    await vfs.dispose()
  })

  it('reserves materialized bytes across concurrent opens and releases capacity exactly once', async () => {
    const bytes = new Uint8Array(80).fill(0x5a)
    const fixture = await rapidFixture([
      { path: 'valid.bin', bytes },
      { path: 'corrupt.bin', bytes: new Uint8Array(80).fill(0xa5), corrupt: true },
    ])
    const limits = { ...DEFAULT_VFS_LIMITS, maxMaterializedBytes: 128n }
    const provider = createRapidVfsProvider({ limits })
    const mount = await provider.open(fixture.uri, { limits })

    await expect(mount.open('corrupt.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-pool-integrity-mismatch',
    )

    const firstOpen = mount.open('valid.bin')
    await expect(Promise.all([firstOpen, mount.open('corrupt.bin')])).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-materialized-budget-exceeded',
    )
    const first = await firstOpen
    await first.dispose()
    await first.dispose()

    const restoredOpen = mount.open('valid.bin')
    await expect(Promise.all([restoredOpen, mount.open('corrupt.bin')])).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-materialized-budget-exceeded',
    )
    const restored = await restoredOpen
    await restored.dispose()
    await mount.dispose()
  })

  it('refuses a pool blob that is not gzip or is missing, and releases its reservation', async () => {
    const bytes = new Uint8Array(64).fill(7)
    const fixture = await rapidFixture([{ path: 'blob.bin', bytes }])
    const md5 = createHash('md5').update(bytes).digest('hex')
    const poolPath = join(
      dirname(fixture.manifestPath),
      '..',
      'pool',
      md5.slice(0, 2),
      `${md5.slice(2)}.gz`,
    )
    const limits = { ...DEFAULT_VFS_LIMITS, maxMaterializedBytes: 64n }
    const mount = await createRapidVfsProvider({ limits }).open(fixture.uri, { limits })
    await writeFile(poolPath, bytes)
    await expect(mount.open('blob.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-pool-blob-invalid',
    )
    await rm(poolPath)
    await expect(mount.open('blob.bin')).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.vfs/rapid-pool-blob-unavailable',
    )
    // Both refusals gave back the whole 64-byte reservation.
    await writeFile(poolPath, gzipSync(bytes))
    const source = await mount.open('blob.bin')
    expect([...(await source.readAt(0, 4))]).toEqual([7, 7, 7, 7])
    await mount.dispose()
  })
})
