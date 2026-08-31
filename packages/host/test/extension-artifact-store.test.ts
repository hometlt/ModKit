import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createLocalExtensionArtifactStore,
  loadExtensionDirectory,
  type LocalExtensionCatalogEntry,
} from '@modkit/host/node'

const scratch = mkdtempSync(join(tmpdir(), 'x3-extension-artifact-store-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const extensionId = 'org.example/lifecycle-fixture'

function testRoot(name: string): string {
  const root = join(scratch, name)
  mkdirSync(root)
  return root
}

async function fixture(
  parent: string,
  name: string,
  version: string,
  marker: string,
  manifestExtensionId = extensionId,
): Promise<LocalExtensionCatalogEntry> {
  const root = join(parent, name)
  const [publisher, id] = manifestExtensionId.split('/') as [string, string]
  mkdirSync(root)
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({
      name: `fixture-${name}`,
      version,
      license: 'MIT',
      type: 'module',
      modkit: {
        schemaVersion: 1,
        publisher,
        id,
        contributionManifests: [],
      },
    })}\n`,
  )
  writeFileSync(join(root, 'entry.mjs'), `export default ${JSON.stringify(marker)}\n`)
  const input = await loadExtensionDirectory(root)
  return Object.freeze({
    extensionId,
    version,
    artifactRoot: root,
    artifactDigest: input.artifact.artifactDigest,
  })
}

function markerOf(artifactRoot: string): string {
  return readFileSync(join(artifactRoot, 'entry.mjs'), 'utf8')
}

describe('local extension artifact lifecycle', () => {
  it('atomically installs, updates, uninstalls and rolls back immutable local artifacts', async () => {
    const root = testRoot('lifecycle')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    const v2 = await fixture(sources, 'v2', '2.0.0', 'two')
    const storeRoot = join(root, 'store')
    const store = createLocalExtensionArtifactStore({ root: storeRoot, catalog: [v1, v2] })

    const installed = await store.install(extensionId, '1.0.0')
    expect(installed).toMatchObject({
      extensionId,
      version: '1.0.0',
      artifactDigest: v1.artifactDigest,
    })
    expect(markerOf(installed.artifactRoot)).toContain('one')
    expect(installed.artifactRoot).not.toBe(v1.artifactRoot)

    const updated = await store.update(extensionId, '2.0.0')
    expect(updated.version).toBe('2.0.0')
    expect(markerOf(updated.artifactRoot)).toContain('two')
    expect(markerOf(installed.artifactRoot)).toContain('one')

    const rolledBack = await store.rollback(extensionId)
    expect(rolledBack.version).toBe('1.0.0')
    expect(await store.listInstalled()).toEqual([rolledBack])

    const removed = await store.uninstall(extensionId)
    expect(removed.version).toBe('1.0.0')
    expect(await store.listInstalled()).toEqual([])
    expect(existsSync(removed.artifactRoot)).toBe(true)

    const restored = await store.rollback(extensionId)
    expect(restored.version).toBe('1.0.0')
    expect(markerOf(restored.artifactRoot)).toContain('one')

    const reopened = createLocalExtensionArtifactStore({ root: storeRoot, catalog: [v1, v2] })
    expect(await reopened.listInstalled()).toEqual([restored])
  })

  it('quarantines a digest mismatch and leaves the previous version byte-for-byte active', async () => {
    const root = testRoot('digest-failure')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'known-good')
    const v2 = await fixture(sources, 'v2', '2.0.0', 'before-tamper')
    const store = createLocalExtensionArtifactStore({
      root: join(root, 'store'),
      catalog: [v1, v2],
    })
    const before = await store.install(extensionId, '1.0.0')
    const beforeBytes = markerOf(before.artifactRoot)

    writeFileSync(join(v2.artifactRoot, 'entry.mjs'), 'export default "tampered"\n')
    await expect(store.update(extensionId, '2.0.0')).rejects.toMatchObject({
      code: 'x3.host/extension-artifact-digest-mismatch',
    })

    expect(await store.listInstalled()).toEqual([before])
    expect(markerOf(before.artifactRoot)).toBe(beforeBytes)
    const quarantined = store.listQuarantine()
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]).toMatchObject({
      extensionId,
      version: '2.0.0',
      expectedDigest: v2.artifactDigest,
      reason: 'digest-mismatch',
    })
    expect(isAbsolute(quarantined[0]?.artifactRoot ?? '')).toBe(true)
  })

  it('quarantines a tampered active artifact and atomically restores the last valid version', async () => {
    const root = testRoot('tampered-active-with-history')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    const v2 = await fixture(sources, 'v2', '2.0.0', 'two')
    const store = createLocalExtensionArtifactStore({
      root: join(root, 'store'),
      catalog: [v1, v2],
    })
    const prior = await store.install(extensionId, '1.0.0')
    const active = await store.update(extensionId, '2.0.0')
    writeFileSync(
      join(active.artifactRoot, 'entry.mjs'),
      'export default "changed-after-install"\n',
    )

    const recovery = await store.recover()
    expect(recovery).toMatchObject({
      quarantinedInstalled: 1,
      restoredActive: 1,
      deactivatedActive: 0,
    })
    expect(await store.listInstalled()).toEqual([prior])
    expect(markerOf(prior.artifactRoot)).toContain('one')
    expect(existsSync(active.artifactRoot)).toBe(false)
    expect(store.listQuarantine()).toContainEqual(
      expect.objectContaining({
        extensionId,
        version: '2.0.0',
        reason: 'installed-artifact-corrupt',
      }),
    )
  })

  it('deactivates a tampered active artifact when no valid rollback exists', async () => {
    const root = testRoot('tampered-active-no-history')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    const store = createLocalExtensionArtifactStore({
      root: join(root, 'store'),
      catalog: [v1],
    })
    const active = await store.install(extensionId, '1.0.0')
    writeFileSync(join(active.artifactRoot, 'entry.mjs'), 'export default "corrupt"\n')

    const recovery = await store.recover()
    expect(recovery).toMatchObject({
      quarantinedInstalled: 1,
      restoredActive: 0,
      deactivatedActive: 1,
    })
    expect(await store.listInstalled()).toEqual([])
    expect(store.listQuarantine()).toContainEqual(
      expect.objectContaining({
        extensionId,
        expectedDigest: v1.artifactDigest,
        reason: 'installed-artifact-corrupt',
      }),
    )
  })

  it('quarantines a failed product load gate, preserves v1 and can update after reopening', async () => {
    const root = testRoot('load-failure')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    const v2 = await fixture(sources, 'v2', '2.0.0', 'two')
    const storeRoot = join(root, 'store')
    const rejecting = createLocalExtensionArtifactStore({
      root: storeRoot,
      catalog: [v1, v2],
      verifyLoaded: (_input, entry) => {
        if (entry.version === '2.0.0') throw new Error('activation probe refused v2')
      },
    })
    const before = await rejecting.install(extensionId, '1.0.0')

    await expect(rejecting.update(extensionId, '2.0.0')).rejects.toMatchObject({
      code: 'x3.host/extension-artifact-load-verification-failed',
    })
    expect(await rejecting.listInstalled()).toEqual([before])
    expect(rejecting.listQuarantine()[0]).toMatchObject({
      reason: 'load-verification-failed',
      message: 'activation probe refused v2',
    })

    const reopened = createLocalExtensionArtifactStore({ root: storeRoot, catalog: [v1, v2] })
    const updated = await reopened.update(extensionId, '2.0.0')
    expect(updated.version).toBe('2.0.0')
    expect(markerOf(updated.artifactRoot)).toContain('two')
  })

  it('holds one install lock across asynchronous verification and releases it afterwards', async () => {
    const root = testRoot('concurrent-lock')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => {
      enter = resolve
    })
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    const store = createLocalExtensionArtifactStore({
      root: join(root, 'store'),
      catalog: [v1],
      verifyLoaded: async () => {
        enter()
        await barrier
      },
    })

    const first = store.install(extensionId, '1.0.0')
    await entered
    const recovery = await store.recover()
    expect(recovery).toMatchObject({
      quarantinedStaging: 0,
      removedStateTemps: 0,
      quarantinedInstalled: 0,
    })
    expect(recovery.heldLocks).toHaveLength(1)
    expect(store.listQuarantine()).toEqual([])
    await expect(store.install(extensionId, '1.0.0')).rejects.toMatchObject({
      code: 'x3.host/extension-install-locked',
    })
    release()
    await expect(first).resolves.toMatchObject({ version: '1.0.0' })

    await expect(store.uninstall(extensionId)).resolves.toMatchObject({ version: '1.0.0' })
  })

  it('cancels without quarantining a valid candidate or changing the installed version', async () => {
    const root = testRoot('cancelled-update')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    const v2 = await fixture(sources, 'v2', '2.0.0', 'two')
    const store = createLocalExtensionArtifactStore({
      root: join(root, 'store'),
      catalog: [v1, v2],
    })
    const installed = await store.install(extensionId, '1.0.0')
    const controller = new AbortController()
    controller.abort('owner cancelled update')

    await expect(store.update(extensionId, '2.0.0', controller.signal)).rejects.toMatchObject({
      code: 'x3.core/operation-cancelled',
    })
    expect(await store.listInstalled()).toEqual([installed])
    expect(store.listQuarantine()).toEqual([])
    await expect(store.update(extensionId, '2.0.0')).resolves.toMatchObject({ version: '2.0.0' })
  })

  it('confines identities and quarantined artifacts to the private store', async () => {
    const root = testRoot('confinement')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const mismatched = await fixture(
      sources,
      'wrong-id',
      '1.0.0',
      'wrong',
      'org.example/different-extension',
    )
    const outside = join(root, 'escaped')

    expect(() =>
      createLocalExtensionArtifactStore({
        root: join(root, 'invalid-store'),
        catalog: [{ ...mismatched, extensionId: '../../escaped' }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'x3.host/invalid-local-extension-catalog' }))
    expect(existsSync(outside)).toBe(false)

    const store = createLocalExtensionArtifactStore({
      root: join(root, 'store'),
      catalog: [mismatched],
    })
    await expect(store.install(extensionId, '1.0.0')).rejects.toMatchObject({
      code: 'x3.host/extension-artifact-load-verification-failed',
    })
    const quarantineRoot = store.listQuarantine()[0]?.artifactRoot
    expect(quarantineRoot).toBeDefined()
    expect(relative(store.root, quarantineRoot as string)).not.toMatch(/^\.\.(?:[\\/]|$)/)
    expect(await store.listInstalled()).toEqual([])
  })

  it('refuses a catalog source that overlaps the store instead of recursively copying it', async () => {
    const root = testRoot('overlapping-source')
    const storeRoot = join(root, 'store')
    mkdirSync(storeRoot)
    const source = await fixture(storeRoot, 'catalog-source', '1.0.0', 'inside-store')
    const store = createLocalExtensionArtifactStore({ root: storeRoot, catalog: [source] })

    await expect(store.install(extensionId, '1.0.0')).rejects.toMatchObject({
      code: 'x3.host/extension-artifact-store-overlap',
    })
    expect(markerOf(source.artifactRoot)).toContain('inside-store')
    expect(await store.listInstalled()).toEqual([])
    expect(store.listQuarantine()).toEqual([])
  })

  it('recovers abandoned staging, state temps and stale locks without changing active state', async () => {
    const root = testRoot('recovery')
    const sources = join(root, 'sources')
    mkdirSync(sources)
    const v1 = await fixture(sources, 'v1', '1.0.0', 'one')
    const storeRoot = join(root, 'store')
    const store = createLocalExtensionArtifactStore({ root: storeRoot, catalog: [v1] })
    const installed = await store.install(extensionId, '1.0.0')

    const abandoned = join(storeRoot, 'staging', 'abandoned')
    mkdirSync(abandoned)
    writeFileSync(join(abandoned, 'partial.bin'), 'partial')
    writeFileSync(join(storeRoot, 'states', '.interrupted.tmp'), 'partial state')
    writeFileSync(join(storeRoot, 'locks', 'stale.lock'), 'not-json')

    const recovery = await store.recover()
    expect(recovery).toEqual({
      quarantinedStaging: 1,
      quarantinedInstalled: 0,
      removedStateTemps: 1,
      removedStaleLocks: 1,
      restoredActive: 0,
      deactivatedActive: 0,
      heldLocks: [],
    })
    expect(await store.listInstalled()).toEqual([installed])
    expect(store.listQuarantine()).toContainEqual(
      expect.objectContaining({ reason: 'interrupted-install' }),
    )
    expect(existsSync(abandoned)).toBe(false)
  })
})
