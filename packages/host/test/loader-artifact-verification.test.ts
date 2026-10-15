import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { loadExtensionDirectory } from '../src/node/loader.js'

const io = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  beforeList: undefined as ((root: string) => Promise<void>) | undefined,
  listings: 0,
  noWatch: false,
}))

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  watch: (root: string, _options: unknown, listener: () => void) => {
    if (io.noWatch) throw new Error('watch unavailable')
    io.listeners.set(root, listener)
    return Object.assign(new EventEmitter(), { close: () => io.listeners.delete(root) })
  },
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      io.listings++
      await io.beforeList?.(String(args[0]))
      return actual.readdir(...args)
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  io.beforeList = undefined
  io.noWatch = false
  io.listings = 0
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
    io.listeners.get(root)?.()
    io.listeners.delete(root)
  }
})

/** Small real tree with deterministic watcher events and controllable asynchronous reads. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'x3-verification-'))
  roots.push(root)
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'codec.js'), 'export const value = 1')
  const loaded = await loadExtensionDirectory(root)
  if (!loaded.artifact) throw new Error('missing artifact')
  io.listings = 0
  return { root, artifact: loaded.artifact }
}

it('coalesces asynchronous verification before cache admission and compares each expected digest', async () => {
  const { root, artifact } = await fixture()
  let release = (): void => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  io.beforeList = async path => { if (path === root) await gate }
  const first = artifact.verifyArtifactDigest(artifact.artifactDigest)
  try {
    expect(first).toBeInstanceOf(Promise)
    const wrong = artifact.verifyArtifactDigest('sha256:wrong')
    const again = artifact.verifyArtifactDigest(artifact.artifactDigest)
    expect(io.listings).toBe(1)
    release()
    expect(await Promise.all([first, wrong, again])).toEqual([true, false, true])
    expect(io.listings).toBe(2) // root and dist, one shared scan
    expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
    expect(io.listings).toBe(2)
  } finally { release(); await first }
})

it('invalidates a verified root when its built code changes', async () => {
  const { root, artifact } = await fixture()
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
  await writeFile(join(root, 'dist', 'codec.js'), 'export const value = 200')
  io.listeners.get(root)?.()
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(false)
})

it('uses a fresh listing after files are added or removed', async () => {
  const { root, artifact } = await fixture()
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
  const added = join(root, 'dist', 'added.js')
  await writeFile(added, 'export const added = true')
  io.listeners.get(root)?.()
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(false)
  await unlink(added)
  io.listeners.get(root)?.()
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
})

it('retries a scan invalidated by a watcher without publishing the old digest', async () => {
  const { root, artifact } = await fixture()
  let changes = 0
  io.beforeList = async path => {
    if (path !== root || changes++ > 0) return
    await writeFile(join(root, 'dist', 'codec.js'), 'export const value = 200')
    io.listeners.get(root)?.()
  }
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(false)
  expect(changes).toBe(2)
  expect(io.listings).toBe(4)
})

it('fails boundedly under continuous changes and permits a fresh retry', async () => {
  const { root, artifact } = await fixture()
  io.beforeList = async path => { if (path === root) io.listeners.get(root)?.() }
  await expect(artifact.verifyArtifactDigest(artifact.artifactDigest)).rejects.toThrow(/changed/)
  expect(io.listings).toBe(4)
  io.beforeList = undefined
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
  expect(io.listings).toBe(6)
})

it('does not mark a failed verification unchanged', async () => {
  const { artifact } = await fixture()
  io.beforeList = async () => { throw new Error('read denied') }
  await expect(artifact.verifyArtifactDigest(artifact.artifactDigest)).rejects.toThrow('read denied')
  io.beforeList = undefined
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
  expect(io.listings).toBe(3)
})

it('scans on each verification when recursive watching is unavailable', async () => {
  io.noWatch = true
  const { artifact } = await fixture()
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
  expect(await artifact.verifyArtifactDigest(artifact.artifactDigest)).toBe(true)
  expect(io.listings).toBe(4)
})
