import { generateKeyPairSync } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionManagerClient,
  type ArtifactStore,
  type EnablementStore,
  type ExtensionCatalogCandidate,
  type ExtensionRegistryCatalog,
  type InstalledExtensionRecord,
} from '@modkitx/extension-manager'
import {
  createVsCodeExtensionManagerClient,
  extensionManagerCommandCompletion,
  ExtensionManagerController,
  installedManagerExtensionRoots,
  type StaticExtensionPackage,
} from '../src/extension-manager.js'
import { extensionManagerSecurityOptions } from '../src/extension-manager-environment.js'

const catalog = Object.freeze({
  schemaVersion: 1,
  registryId: 'org.modkitx/official',
  generatedAt: '2026-08-30T00:00:00Z',
  signature: { algorithm: 'Ed25519', keyId: 'test', value: 'AA==' },
  packages: Object.freeze([
    {
      id: 'org.modkitx.blizzard/sc2-pack',
      displayName: 'StarCraft II',
      publisher: 'Blizzard',
      summary: 'StarCraft II codecs',
      versions: Object.freeze([
        {
          version: '3.0.0',
          channel: 'stable' as const,
          extensions: Object.freeze([
            'org.modkitx.blizzard/starcraft2',
            'org.modkitx.blizzard/galaxy',
          ]),
          source: {
            kind: 'bundle' as const,
            uri: 'memory:/sc2-pack',
            trust: { mode: 'local-user' as const },
          },
        },
      ]),
    },
    {
      id: 'org.modkitx.warzone/warzone-pack',
      displayName: 'Warzone 2100',
      publisher: 'Warzone 2100 Project',
      summary: 'Warzone codecs',
      versions: Object.freeze([
        {
          version: '2.0.0',
          channel: 'stable' as const,
          extensions: Object.freeze(['org.modkitx.warzone/warzone2100']),
          source: {
            kind: 'bundle' as const,
            uri: 'memory:/warzone-pack',
            trust: { mode: 'local-user' as const },
          },
        },
      ]),
    },
    {
      id: 'example/new-pack',
      displayName: 'New Format',
      publisher: 'Example',
      summary: 'Two extension roots in one package',
      versions: Object.freeze([
        {
          version: '1.0.0',
          channel: 'stable' as const,
          extensions: Object.freeze(['example/new-reader', 'example/new-writer']),
          source: {
            kind: 'bundle' as const,
            uri: 'memory:/new-pack',
            trust: { mode: 'local-user' as const },
          },
        },
      ]),
    },
    {
      id: 'example/unsigned-pack',
      displayName: 'Unsigned',
      publisher: 'Example',
      summary: 'Remote package without a verified catalog signature',
      versions: Object.freeze([
        {
          version: '1.0.0',
          channel: 'stable' as const,
          extensions: Object.freeze(['example/unsigned-reader']),
          source: {
            kind: 'bundle' as const,
            uri: 'https://cdn.example.invalid/unsigned.zip',
            integrity: `sha256:${'0'.repeat(64)}` as `sha256:${string}`,
            trust: { mode: 'signed' as const },
          },
        },
      ]),
    },
  ]),
} as const) satisfies ExtensionRegistryCatalog

const sc2V2: InstalledExtensionRecord = Object.freeze({
  id: 'org.modkitx.blizzard/sc2-pack',
  displayName: 'StarCraft II',
  publisher: 'Blizzard',
  version: '2.0.0',
  source: 'memory:/sc2-pack-v2',
  trusted: true,
  roots: Object.freeze([
    { root: '/extensions/sc2-v2/starcraft2', expectedId: 'org.modkitx.blizzard/starcraft2' },
    { root: '/extensions/sc2-v2/galaxy', expectedId: 'org.modkitx.blizzard/galaxy' },
  ]),
})

const warzone: InstalledExtensionRecord = Object.freeze({
  id: 'org.modkitx.warzone/warzone-pack',
  displayName: 'Warzone 2100',
  publisher: 'Warzone 2100 Project',
  version: '2.0.0',
  source: 'memory:/warzone-pack',
  trusted: true,
  roots: Object.freeze([
    { root: '/extensions/warzone', expectedId: 'org.modkitx.warzone/warzone2100' },
  ]),
})

function materialized(entry: ExtensionCatalogCandidate): InstalledExtensionRecord {
  const base =
    entry.id === 'org.modkitx.blizzard/sc2-pack'
      ? `/extensions/sc2-v${entry.version.split('.')[0]}`
      : `/extensions/${entry.id.replaceAll('/', '-')}`
  return Object.freeze({
    id: entry.id,
    displayName: entry.displayName,
    publisher: entry.publisher,
    version: entry.version,
    source: entry.source.uri,
    trusted: entry.trusted,
    roots: Object.freeze(
      entry.extensions.map(id =>
        Object.freeze({ root: `${base}/${id.slice(id.indexOf('/') + 1)}`, expectedId: id }),
      ),
    ),
  })
}

function fixture() {
  let packages: InstalledExtensionRecord[] = [sc2V2, warzone]
  let enablement = [
    { id: sc2V2.id, enabled: false },
    { id: warzone.id, enabled: true },
  ]
  const writes: unknown[][] = []
  let cachedReads = 0
  let refreshes = 0
  let acquisitions = 0

  const artifactStore: ArtifactStore = {
    list: async () => packages,
    async install(request) {
      const installed = materialized(request.entry)
      packages = [...packages.filter(item => item.id !== installed.id), installed]
      return installed
    },
    async remove(id) {
      packages = packages.filter(item => item.id !== id)
    },
  }
  const enablementStore: EnablementStore = {
    list: async () => enablement,
    async setEnabled(id, enabled) {
      enablement = [...enablement.filter(item => item.id !== id), { id, enabled }]
    },
    async remove(id) {
      enablement = enablement.filter(item => item.id !== id)
    },
  }
  const shared = createExtensionManagerClient({
    catalogSource: {
      cached: async () => {
        cachedReads += 1
        return { catalog, source: 'memory:/catalog.json', signatureVerified: false }
      },
      refresh: async () => {
        refreshes += 1
        return { catalog, source: 'memory:/catalog.json', signatureVerified: false }
      },
    },
    artifactAcquirer: {
      async acquire(entry) {
        acquisitions += 1
        return { artifact: { id: entry.id } }
      },
    },
    artifactStore,
    enablementStore,
  })
  const staticPackages: readonly StaticExtensionPackage[] = Object.freeze([
    {
      entry: {
        id: 'org.modkitx.common/images',
        displayName: 'Images',
        publisher: 'Modkit',
        availableVersion: 'bundled',
        installedVersion: 'bundled',
        enabled: true,
        updateAvailable: false,
        source: 'bundled',
        trusted: true,
      },
    },
    {
      entry: {
        id: 'example/workspace-codec',
        displayName: 'Workspace codec',
        publisher: 'Example',
        availableVersion: 'local',
        installedVersion: 'local',
        enabled: true,
        updateAvailable: false,
        source: 'workspace',
        trusted: false,
      },
    },
  ])
  const client = createVsCodeExtensionManagerClient({
    client: shared,
    staticPackages: () => staticPackages,
  })
  return {
    client,
    controller: new ExtensionManagerController(client),
    packages: () => packages,
    writes,
    cachedReads: () => cachedReads,
    refreshes: () => refreshes,
    acquisitions: () => acquisitions,
  }
}

describe('VS Code extension manager state', () => {
  it.each([
    { kind: 'install', id: 'example/package' },
    { kind: 'update', id: 'example/package' },
    { kind: 'remove', id: 'example/package' },
    { kind: 'set-enabled', id: 'example/package', enabled: true },
    { kind: 'set-enabled', id: 'example/package', enabled: false },
  ] as const)('prompts for reload after manager mutation $kind', command => {
    expect(extensionManagerCommandCompletion(command, 'changed')).toEqual({
      message: 'Modkit: changed. Reload the window for it to take effect.',
      reload: true,
    })
  })

  it('does not prompt for reload after a catalog-only refresh', () => {
    expect(extensionManagerCommandCompletion({ kind: 'refresh' }, 'catalog refreshed')).toEqual({
      message: 'Modkit: catalog refreshed',
      reload: false,
    })
  })

  it('excludes disabled managed roots when reload reads manager state again', async () => {
    let enabled = true
    const enabledRoots = Object.freeze([
      Object.freeze({
        root: '/extensions/sc2-v2/starcraft2',
        expectedId: 'org.modkitx.blizzard/starcraft2',
      }),
      Object.freeze({
        root: '/extensions/sc2-v2/galaxy',
        expectedId: 'org.modkitx.blizzard/galaxy',
      }),
    ])
    const manager = {
      installedRoots: async () => (enabled ? enabledRoots : []),
    }

    expect(await installedManagerExtensionRoots(manager)).toEqual([
      { root: '/extensions/sc2-v2/starcraft2', expectedId: 'org.modkitx.blizzard/starcraft2' },
      { root: '/extensions/sc2-v2/galaxy', expectedId: 'org.modkitx.blizzard/galaxy' },
    ])
    enabled = false
    expect(await installedManagerExtensionRoots(manager)).toEqual([])
  })

  it('uses the shared package snapshot without refreshing or acquiring artifacts', async () => {
    const state = fixture()
    const snapshot = await state.controller.snapshot()

    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sc2V2.id,
          installedVersion: '2.0.0',
          availableVersion: '3.0.0',
          enabled: false,
          updateAvailable: true,
        }),
        expect.objectContaining({ id: 'example/new-pack' }),
        expect.objectContaining({ id: 'org.modkitx.common/images', source: 'bundled' }),
        expect.objectContaining({ id: 'example/workspace-codec', source: 'workspace' }),
      ]),
    )
    expect(
      snapshot.entries.find(entry => entry.id === 'example/new-pack')?.installedVersion,
    ).toBeUndefined()
    expect(state.cachedReads()).toBe(1)
    expect(state.refreshes()).toBe(0)
    expect(state.acquisitions()).toBe(0)
  })

  it('refreshes and installs only through explicit commands without writing configuration', async () => {
    const state = fixture()
    await state.controller.snapshot()
    await state.controller.execute({ kind: 'refresh' })
    expect(state.refreshes()).toBe(1)
    expect(state.acquisitions()).toBe(0)

    const snapshot = await state.controller.execute({ kind: 'install', id: 'example/new-pack' })
    expect(state.acquisitions()).toBe(1)
    expect(state.writes).toHaveLength(0)
    expect(state.packages().find(entry => entry.id === 'example/new-pack')?.roots).toHaveLength(2)
    expect(snapshot.entries.find(entry => entry.id === 'example/new-pack')).toMatchObject({
      installedVersion: '1.0.0',
      enabled: true,
    })
  })

  it('updates manager state without writing configuration and preserves package enablement', async () => {
    const state = fixture()
    const snapshot = await state.controller.execute({ kind: 'update', id: sc2V2.id })

    expect(state.writes).toHaveLength(0)
    expect(state.packages().find(entry => entry.id === sc2V2.id)?.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: '/extensions/sc2-v3/starcraft2' }),
        expect.objectContaining({ root: '/extensions/sc2-v3/galaxy' }),
      ]),
    )
    expect(snapshot.entries.find(entry => entry.id === sc2V2.id)).toMatchObject({
      installedVersion: '3.0.0',
      enabled: false,
      updateAvailable: false,
    })
  })

  it('enables, disables and removes only in manager state with zero configuration writes', async () => {
    const state = fixture()
    const changed = vi.fn()
    state.controller.onDidChange(changed)

    await state.controller.execute({ kind: 'set-enabled', id: sc2V2.id, enabled: true })
    expect(state.writes).toHaveLength(0)
    expect(
      (await state.client.snapshot()).entries.find(entry => entry.id === sc2V2.id),
    ).toMatchObject({ enabled: true })

    await state.controller.execute({ kind: 'set-enabled', id: sc2V2.id, enabled: false })
    expect(state.writes).toHaveLength(0)
    expect(
      (await state.client.snapshot()).entries.find(entry => entry.id === sc2V2.id),
    ).toMatchObject({ enabled: false })

    await state.controller.execute({ kind: 'remove', id: sc2V2.id })
    expect(state.writes).toHaveLength(0)
    expect(state.packages().some(item => item.id === sc2V2.id)).toBe(false)
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('keeps bundled and workspace packages immutable', async () => {
    const state = fixture()
    await expect(state.client.remove('org.modkitx.common/images')).rejects.toThrow(
      'cannot be changed here',
    )
    await expect(state.client.setEnabled('example/workspace-codec', false)).rejects.toThrow(
      'cannot be changed here',
    )
    expect(state.writes).toEqual([])
  })

  it('delegates remote trust refusal to the shared manager before acquisition', async () => {
    const state = fixture()
    await expect(state.client.install('example/unsigned-pack')).rejects.toThrow(
      'not signed by a trusted catalog',
    )
    expect(state.acquisitions()).toBe(0)
    expect(state.writes).toEqual([])
  })
})

describe('VS Code extension manager environment', () => {
  it('injects bounded Ed25519 trust, normalized origins and an optional rapid pool', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const rapidPool = resolve('testdata', 'rapid-pool')

    const options = extensionManagerSecurityOptions({
      MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: JSON.stringify({ release: pem }),
      MODKIT_EXTENSION_ALLOWED_ORIGINS: 'https://cdn.example.invalid/, http://localhost:8080',
      MODKIT_EXTENSION_RAPID_POOL_ROOT: rapidPool,
    })

    expect(Object.keys(options.trustedPublicKeys)).toEqual(['release'])
    expect(
      (options.trustedPublicKeys as Readonly<Record<string, { asymmetricKeyType?: string }>>)
        .release?.asymmetricKeyType,
    ).toBe('ed25519')
    expect(options.vfsOptions).toEqual({
      allowedOrigins: ['https://cdn.example.invalid', 'http://localhost:8080'],
      rapidPoolRoot: rapidPool,
    })
  })

  it('defaults to empty trust and origin allowlists so remote access stays fail-closed', () => {
    const options = extensionManagerSecurityOptions({})

    expect(Object.keys(options.trustedPublicKeys)).toEqual([])
    expect(options.vfsOptions).toEqual({ allowedOrigins: [] })
  })

  it.each([
    [{ MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: '{' }, 'must be a JSON object'],
    [
      { MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: JSON.stringify({ release: 'not a public key' }) },
      'invalid public key material',
    ],
    [
      { MODKIT_EXTENSION_ALLOWED_ORIGINS: 'https://cdn.example.invalid/packages' },
      'must contain only HTTP(S) origins',
    ],
    [
      { MODKIT_EXTENSION_ALLOWED_ORIGINS: 'ftp://cdn.example.invalid' },
      'must contain only HTTP(S)',
    ],
    [{ MODKIT_EXTENSION_RAPID_POOL_ROOT: 'relative/pool' }, 'must be a bounded absolute'],
  ] as const)('refuses an invalid security environment', (environment, message) => {
    expect(() => extensionManagerSecurityOptions(environment)).toThrow(message)
  })
})
