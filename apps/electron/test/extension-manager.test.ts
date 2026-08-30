import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  createElectronExtensionManagerBackend,
  readElectronManagedExtensionState,
} from '../src/extension-manager-main.js'
import {
  composeElectronExtensionRoots,
  ELECTRON_MANAGED_COORDINATE_CONFLICT,
  ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT,
} from '../src/extension-root-composition.js'
import { groupManagedExtensions, type ExtensionManagerSnapshot } from '../src/extensions-page.js'

const fixtureBuilderRoot = join(import.meta.dirname, 'fixtures')

function replaceIn(path: string, from: string, to: string): void {
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll(from, to), 'utf8')
}

function createRepository(root: string): { registry: string; store: string; cache: string } {
  const generated = join(root, 'generated')
  const output = join(generated, 'folders')
  mkdirSync(generated, { recursive: true })
  // Reuse the real Electron extension fixture rather than inventing a second manifest shape.
  execFileSync(process.execPath, [join(fixtureBuilderRoot, 'build-extension-folders.mjs'), output])

  const repository = join(root, 'repository')
  const first = join(repository, 'first')
  const second = join(repository, 'second')
  cpSync(join(output, 'ok'), first, { recursive: true })
  cpSync(join(output, 'ok'), second, { recursive: true })
  replaceIn(join(second, 'package.json'), 'fixture-thirdparty', 'fixture-secondary')
  replaceIn(
    join(second, 'contributions', 'codec-fixture.json'),
    'fixture-thirdparty',
    'fixture-secondary',
  )
  replaceIn(join(second, 'src', 'codec.js'), 'fixture-thirdparty', 'fixture-secondary')
  writeFileSync(
    join(repository, 'modkit.repository.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        extensions: [
          { id: 'org.example/fixture-thirdparty', path: 'first' },
          { id: 'org.example/fixture-secondary', path: 'second' },
        ],
      },
      null,
      2,
    )}\n`,
  )

  const catalogDirectory = join(root, 'catalog')
  mkdirSync(catalogDirectory, { recursive: true })
  const registry = join(catalogDirectory, 'development.json')
  writeFileSync(
    registry,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        registryId: 'org.example/development',
        generatedAt: '2026-08-30T00:00:00.000Z',
        packages: [
          {
            id: 'org.example/fixture-suite',
            publisher: 'org.example',
            displayName: 'Fixture suite',
            summary: 'Two extension roots in one distribution package.',
            versions: [
              {
                version: '1.0.0',
                channel: 'development',
                source: {
                  kind: 'repository',
                  uri: '../repository',
                  trust: { mode: 'local-user' },
                },
                extensions: ['org.example/fixture-thirdparty', 'org.example/fixture-secondary'],
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  return { registry, store: join(root, 'store'), cache: join(root, 'cache') }
}

describe('Electron distribution package manager', () => {
  it('keeps a package with two extension roots as one package row and a read-only snapshot', async () => {
    const fixture = createRepository(mkdtempSync(join(tmpdir(), 'modkit-electron-manager-')))
    const manager = createElectronExtensionManagerBackend({
      registry: fixture.registry,
      storeRoot: fixture.store,
    })

    expect(existsSync(fixture.store)).toBe(false)
    expect(existsSync(fixture.cache)).toBe(false)
    expect((await manager.snapshot()).entries).toEqual([])
    expect(existsSync(fixture.store)).toBe(false)
    await manager.refresh()
    const before = await manager.snapshot()
    expect(before.entries).toHaveLength(1)
    expect(before.entries[0]).toMatchObject({
      id: 'org.example/fixture-suite',
      trusted: true,
    })
    expect(before.entries[0]?.installedVersion).toBeUndefined()
    // Merely opening/re-reading the page does not refresh the catalog or mutate package state.
    await manager.snapshot()
    expect(existsSync(fixture.cache)).toBe(false)

    await manager.install('org.example/fixture-suite', '1.0.0')
    const installed = (await manager.artifactStore.list()).find(
      item => item.id === 'org.example/fixture-suite',
    )
    expect(installed?.roots).toHaveLength(2)
    const after = await manager.snapshot()
    expect(after.entries[0]).toMatchObject({
      installedVersion: '1.0.0',
      enabled: true,
      updateAvailable: false,
    })

    await manager.remove('org.example/fixture-suite')
    expect((await manager.snapshot()).entries[0]?.installedVersion).toBeUndefined()
    await manager.dispose()
  }, 30_000)

  it('catalogues but rejects an unsigned remote package', async () => {
    const root = mkdtempSync(join(tmpdir(), 'modkit-electron-unsigned-'))
    const registry = join(root, 'registry.json')
    writeFileSync(
      registry,
      JSON.stringify({
        schemaVersion: 1,
        registryId: 'org.example/development',
        generatedAt: '2026-08-30T00:00:00.000Z',
        signature: { algorithm: 'Ed25519', keyId: 'test', value: 'AA==' },
        packages: [
          {
            id: 'org.example/remote-suite',
            publisher: 'org.example',
            displayName: 'Remote suite',
            summary: 'Unsigned remote test.',
            versions: [
              {
                version: '1.0.0',
                channel: 'development',
                source: {
                  kind: 'repository',
                  uri: 'https://example.invalid/repository.json',
                  integrity: `sha256:${'0'.repeat(64)}`,
                  trust: { mode: 'signed' },
                },
                extensions: ['org.example/remote-root'],
              },
            ],
          },
        ],
      }),
    )
    const manager = createElectronExtensionManagerBackend({
      registry,
      storeRoot: join(root, 'store'),
    })
    await manager.refresh()
    expect((await manager.snapshot()).entries[0]).toMatchObject({
      id: 'org.example/remote-suite',
      trusted: false,
    })
    await expect(manager.install('org.example/remote-suite')).rejects.toMatchObject({
      code: 'extension-manager/artifact-untrusted',
    })
    await manager.dispose()
  })
})

describe('Electron extension root composition', () => {
  it('adds all managed roots on activation and every reload, and removes disabled roots', async () => {
    const fixture = createRepository(mkdtempSync(join(tmpdir(), 'modkit-electron-roots-')))
    const manager = createElectronExtensionManagerBackend({
      registry: fixture.registry,
      storeRoot: fixture.store,
    })
    await manager.refresh()
    await manager.install('org.example/fixture-suite', '1.0.0')

    const compose = async () =>
      composeElectronExtensionRoots({
        manualRoots: [],
        managedRoots: await manager.installedRoots(),
        probeManual: async root => ({ state: 'extension', root, id: 'unused' }),
      })
    // Startup and a later reload independently read the manager store; neither needs a settings
    // projection and the distribution package still contributes both extension roots.
    expect((await compose()).roots).toHaveLength(2)
    expect((await compose()).roots).toHaveLength(2)
    await manager.setEnabled('org.example/fixture-suite', false)
    expect((await manager.snapshot()).entries[0]?.enabled).toBe(false)
    expect((await compose()).roots).toEqual([])
    const disabled = await readElectronManagedExtensionState(manager)
    expect(disabled.roots).toHaveLength(2)
    expect(disabled.disabledExtensions).toEqual([
      'org.example/fixture-secondary',
      'org.example/fixture-thirdparty',
    ])
    await manager.setEnabled('org.example/fixture-suite', true)
    expect((await manager.snapshot()).entries[0]?.enabled).toBe(true)
    expect((await compose()).roots).toHaveLength(2)
    await manager.dispose()
  }, 30_000)

  it('refuses manager duplicates and manual roots that would shadow a managed coordinate', async () => {
    const result = await composeElectronExtensionRoots({
      managedRoots: [
        { root: 'managed-a', expectedId: 'org.example/duplicate' },
        { root: 'managed-b', expectedId: 'org.example/duplicate' },
        { root: 'managed-owner', expectedId: 'org.example/owner' },
      ],
      manualRoots: [
        { root: 'manual-explicit', id: 'org.example/owner', enabled: true },
        { root: 'manual-unlabelled', enabled: true },
        { root: 'manual-safe', id: 'org.example/safe', enabled: true },
      ],
      probeManual: async (root, claimed) =>
        root === 'manual-unlabelled' && claimed.includes('org.example/owner')
          ? {
              state: 'refused',
              root,
              code: 'x3.host/extension-coordinate-conflict',
              message: 'coordinate is already claimed',
            }
          : { state: 'extension', root, id: 'org.example/unlabelled' },
    })

    expect(result.roots).toEqual([
      { root: 'managed-owner', expectedId: 'org.example/owner' },
      { root: 'manual-safe', expectedId: 'org.example/safe' },
    ])
    expect(result.conflicts.map(item => item.code)).toEqual([
      ELECTRON_MANAGED_COORDINATE_CONFLICT,
      ELECTRON_MANAGED_COORDINATE_CONFLICT,
      ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT,
      ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT,
    ])
  })

  it('keeps a disabled manual root in composition and names it for host-side activation refusal', async () => {
    const result = await composeElectronExtensionRoots({
      managedRoots: [],
      manualRoots: [{ root: 'C:/extensions/fixture', id: 'org.example/fixture', enabled: false }],
      probeManual: async () => {
        throw new Error('a disabled row with a coordinate does not need probing')
      },
    })
    expect(result.roots).toEqual([
      { root: 'C:/extensions/fixture', expectedId: 'org.example/fixture' },
    ])
    expect(result.disabledExtensions).toEqual(['org.example/fixture'])
    expect(result.conflicts).toEqual([])
  })

  it('keeps every managed mutation out of the manual settings store', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'electron', 'main.cjs'), 'utf8')
    const managerBlock = source.slice(
      source.indexOf("ipcMain.handle('modkit.extensions.manager.snapshot'"),
      source.indexOf('/*\n   * Picking an extension folder.'),
    )
    for (const command of ['refresh', 'install', 'update', 'remove', 'set-enabled']) {
      expect(managerBlock).toContain(`modkit.extensions.manager.${command}`)
    }
    expect(managerBlock).not.toMatch(
      /writeSettings|writeManagedSettings|activateManagedRoots|removeManagedRoots|readSettings/u,
    )

    const page = readFileSync(join(import.meta.dirname, '..', 'src', 'extensions-page.ts'), 'utf8')
    const lifecycle = page.slice(
      page.indexOf('const manage = async'),
      page.indexOf(
        '// ------------------------------------------------------------------ extensions group',
      ),
    )
    expect(lifecycle).toContain('if (recompose) report = await options.apply()')
    expect(page).toContain(
      "manage(copy.operation('refresh', copy.extensions), () => manager.refresh(), false)",
    )
  })
})

describe('extension manager page groups', () => {
  it('separates Available, Installed, Enabled, Updates and Problems without losing roots', () => {
    const snapshot: ExtensionManagerSnapshot = {
      entries: [
        {
          id: 'org.example/available',
          displayName: 'Available',
          publisher: 'org.example',
          source: 'catalog',
          trusted: true,
          availableVersion: '1.0.0',
          enabled: false,
          updateAvailable: false,
        },
        {
          id: 'org.example/installed',
          displayName: 'Installed',
          publisher: 'org.example',
          source: 'catalog',
          trusted: true,
          availableVersion: '2.0.0',
          installedVersion: '1.0.0',
          enabled: true,
          updateAvailable: true,
        },
      ],
    }
    const groups = groupManagedExtensions(snapshot, ['broken catalog entry'])
    expect(groups.available.map(item => item.id)).toEqual(['org.example/available'])
    expect(groups.installed.map(item => item.id)).toEqual(['org.example/installed'])
    expect(groups.enabled.map(item => item.id)).toEqual(['org.example/installed'])
    expect(groups.updates.map(item => item.id)).toEqual(['org.example/installed'])
    expect(groups.problems).toEqual(['broken catalog entry'])
  })
})
