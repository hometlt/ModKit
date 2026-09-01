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
} from '@modkit/extension-manager'
import {
  createVsCodeExtensionManagerClient,
  extensionManagerCommandCompletion,
  ExtensionManagerController,
  installedManagerExtensionRoots,
  installedManagerExtensionState,
  type StaticExtensionPackage,
} from '../src/extension-manager.js'
import { extensionManagerSecurityOptions } from '../src/extension-manager-environment.js'

const catalog = Object.freeze({
  schemaVersion: 1,
  registryId: 'modkit/official',
  generatedAt: '2026-08-30T00:00:00Z',
  signature: { algorithm: 'Ed25519', keyId: 'test', value: 'AA==' },
  packages: Object.freeze([
    {
      id: 'org.example.alpha/alpha-pack',
      displayName: 'Example Game Alpha',
      publisher: 'Example Publisher A',
      summary: 'Example Game Alpha codecs',
      versions: Object.freeze([
        {
          version: '3.0.0',
          channel: 'stable' as const,
          extensions: Object.freeze(['org.example.alpha/gamealpha', 'org.example.alpha/galaxy']),
          source: {
            kind: 'bundle' as const,
            uri: 'memory:/alpha-pack',
            trust: { mode: 'local-user' as const },
          },
        },
      ]),
    },
    {
      id: 'org.example.beta/beta-pack',
      displayName: 'Example Game Beta',
      publisher: 'Example Publisher B',
      summary: 'ExampleGameBeta codecs',
      versions: Object.freeze([
        {
          version: '2.0.0',
          channel: 'stable' as const,
          extensions: Object.freeze(['org.example.beta/gamebeta']),
          source: {
            kind: 'bundle' as const,
            uri: 'memory:/beta-pack',
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
      presentation: {
        displayName: 'Example Game tools',
        vendor: { id: 'example', displayName: 'Example' },
        games: [{ id: 'example/game', displayName: 'Example Game' }],
      },
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

const alphaV2: InstalledExtensionRecord = Object.freeze({
  id: 'org.example.alpha/alpha-pack',
  displayName: 'Example Game Alpha',
  publisher: 'Example Publisher A',
  version: '2.0.0',
  source: 'memory:/alpha-pack-v2',
  trusted: true,
  roots: Object.freeze([
    { root: '/extensions/alpha-v2/gamealpha', expectedId: 'org.example.alpha/gamealpha' },
    { root: '/extensions/alpha-v2/galaxy', expectedId: 'org.example.alpha/galaxy' },
  ]),
})

const beta: InstalledExtensionRecord = Object.freeze({
  id: 'org.example.beta/beta-pack',
  displayName: 'Example Game Beta',
  publisher: 'Example Publisher B',
  version: '2.0.0',
  source: 'memory:/beta-pack',
  trusted: true,
  roots: Object.freeze([{ root: '/extensions/beta', expectedId: 'org.example.beta/gamebeta' }]),
})

function materialized(entry: ExtensionCatalogCandidate): InstalledExtensionRecord {
  const base =
    entry.id === 'org.example.alpha/alpha-pack'
      ? `/extensions/alpha-v${entry.version.split('.')[0]}`
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

function fixture(options: { readonly staticPackages?: readonly StaticExtensionPackage[] } = {}) {
  let packages: InstalledExtensionRecord[] = [alphaV2, beta]
  let enablement = [
    { id: alphaV2.id, enabled: false },
    { id: beta.id, enabled: true },
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
        id: 'modkit.common/images',
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
        presentation: {
          displayName: 'Local StarCraft II Data',
          vendor: { id: 'blizzard', displayName: 'Blizzard Entertainment' },
          games: [{ id: 'blizzard/starcraft-2', displayName: 'StarCraft II' }],
        },
      },
    },
    ...(options.staticPackages ?? []),
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
        root: '/extensions/alpha-v2/gamealpha',
        expectedId: 'org.example.alpha/gamealpha',
      }),
      Object.freeze({
        root: '/extensions/alpha-v2/galaxy',
        expectedId: 'org.example.alpha/galaxy',
      }),
    ])
    const manager = {
      installedRoots: async () => (enabled ? enabledRoots : []),
    }

    expect(await installedManagerExtensionRoots(manager)).toEqual([
      { root: '/extensions/alpha-v2/gamealpha', expectedId: 'org.example.alpha/gamealpha' },
      { root: '/extensions/alpha-v2/galaxy', expectedId: 'org.example.alpha/galaxy' },
    ])
    enabled = false
    expect(await installedManagerExtensionRoots(manager)).toEqual([])
  })

  it('keeps disabled package roots in inventory and returns their owning package', async () => {
    const state = await installedManagerExtensionState({
      artifactStore: {
        list: async () => [alphaV2, beta],
        async install() {
          throw new Error('not used')
        },
        remove: () => Promise.resolve(),
      },
      enablementStore: {
        list: async () => [
          { id: alphaV2.id, enabled: false },
          { id: beta.id, enabled: true },
        ],
        setEnabled: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
    })

    expect(state.roots).toHaveLength(3)
    expect(state.disabledExtensions).toEqual([
      'org.example.alpha/galaxy',
      'org.example.alpha/gamealpha',
    ])
    expect(state.packageByExtension.get('org.example.alpha/gamealpha')).toBe(alphaV2.id)
  })

  it('uses the shared package snapshot without refreshing or acquiring artifacts', async () => {
    const state = fixture()
    const snapshot = await state.controller.snapshot()

    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: alphaV2.id,
          installedVersion: '2.0.0',
          availableVersion: '3.0.0',
          enabled: false,
          updateAvailable: true,
        }),
        expect.objectContaining({ id: 'example/new-pack' }),
        expect.objectContaining({ id: 'modkit.common/images', source: 'bundled' }),
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
    expect(state.controller.pendingReloadIds()).toEqual(['example/new-pack'])
  })

  it('marks install, update and removal state as pending until the host reloads', async () => {
    const state = fixture()

    await state.controller.execute({ kind: 'install', id: 'example/new-pack' })
    await state.controller.execute({ kind: 'update', id: alphaV2.id })
    await state.controller.execute({ kind: 'remove', id: beta.id })
    await state.controller.execute({ kind: 'refresh' })

    expect(state.controller.pendingReloadIds()).toEqual(['example/new-pack', alphaV2.id, beta.id])
  })

  it('installs an explicit batch sequentially and refreshes the tree once', async () => {
    const state = fixture()
    const changed = vi.fn()
    state.controller.onDidChange(changed)

    const snapshot = await state.controller.executeBatch([
      { kind: 'install', id: 'example/new-pack' },
    ])

    expect(state.acquisitions()).toBe(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(snapshot.entries.find(entry => entry.id === 'example/new-pack')).toMatchObject({
      installedVersion: '1.0.0',
      enabled: true,
    })
  })

  it('previews and applies a metadata-driven game support batch', async () => {
    const state = fixture()
    const changed = vi.fn()
    state.controller.onDidChange(changed)

    const plan = await state.controller.planGameSupport('example/game')
    expect(plan.actions).toEqual([
      { kind: 'install', packageId: 'example/new-pack', version: '1.0.0', reversible: true },
    ])

    const result = await state.controller.applyGameSupport(plan)
    expect(result.status).toBe('applied')
    expect(state.packages().some(item => item.id === 'example/new-pack')).toBe(true)
    expect(state.controller.pendingReloadIds()).toEqual(['example/new-pack'])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('recognizes a locally supplied installed game without requiring a catalog package', async () => {
    const state = fixture()

    const plan = await state.controller.planGameSupport('blizzard/starcraft-2')

    expect(plan.targets).toEqual([
      expect.objectContaining({
        packageId: 'example/workspace-codec',
        installedVersion: 'local',
        enabled: true,
      }),
    ])
    expect(plan.actions).toEqual([])
    expect(plan.ready).toBe(true)
    await expect(state.controller.applyGameSupport(plan)).resolves.toMatchObject({
      status: 'applied',
      applied: [],
    })
  })

  it('updates manager state without writing configuration and preserves package enablement', async () => {
    const state = fixture()
    const snapshot = await state.controller.execute({ kind: 'update', id: alphaV2.id })

    expect(state.writes).toHaveLength(0)
    expect(state.packages().find(entry => entry.id === alphaV2.id)?.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: '/extensions/alpha-v3/gamealpha' }),
        expect.objectContaining({ root: '/extensions/alpha-v3/galaxy' }),
      ]),
    )
    expect(snapshot.entries.find(entry => entry.id === alphaV2.id)).toMatchObject({
      installedVersion: '3.0.0',
      enabled: false,
      updateAvailable: false,
    })
  })

  it('enables, disables and removes only in manager state with zero configuration writes', async () => {
    const state = fixture()
    const changed = vi.fn()
    state.controller.onDidChange(changed)

    await state.controller.execute({ kind: 'set-enabled', id: alphaV2.id, enabled: true })
    expect(state.writes).toHaveLength(0)
    expect(
      (await state.client.snapshot()).entries.find(entry => entry.id === alphaV2.id),
    ).toMatchObject({ enabled: true })

    await state.controller.execute({ kind: 'set-enabled', id: alphaV2.id, enabled: false })
    expect(state.writes).toHaveLength(0)
    expect(
      (await state.client.snapshot()).entries.find(entry => entry.id === alphaV2.id),
    ).toMatchObject({ enabled: false })

    await state.controller.execute({ kind: 'remove', id: alphaV2.id })
    expect(state.writes).toHaveLength(0)
    expect(state.packages().some(item => item.id === alphaV2.id)).toBe(false)
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('keeps bundled and workspace packages immutable', async () => {
    const state = fixture()
    await expect(state.client.remove('modkit.common/images')).rejects.toThrow(
      'cannot be changed here',
    )
    await expect(state.client.setEnabled('example/workspace-codec', false)).rejects.toThrow(
      'cannot be changed here',
    )
    expect(state.writes).toEqual([])
  })

  it('allows reinstall when a stale static row came from runtime managed package composition', async () => {
    const state = fixture({
      staticPackages: [
        {
          entry: {
            id: alphaV2.id,
            displayName: alphaV2.displayName,
            publisher: alphaV2.publisher,
            availableVersion: 'local',
            installedVersion: 'local',
            enabled: false,
            updateAvailable: false,
            source: `managed:${alphaV2.id}`,
            trusted: true,
          },
        },
      ],
    })

    await state.client.remove(alphaV2.id)
    expect(state.packages().some(item => item.id === alphaV2.id)).toBe(false)

    await state.client.install(alphaV2.id)
    expect(state.packages().find(item => item.id === alphaV2.id)).toMatchObject({
      id: alphaV2.id,
      version: '3.0.0',
    })
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

  it('pins built-in release trust while keeping compatible explicit dev-registry keys', () => {
    const builtIn = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString()
    const dev = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString()

    const options = extensionManagerSecurityOptions(
      { MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: JSON.stringify({ dev }) },
      { release: builtIn },
    )

    expect(Object.keys(options.trustedPublicKeys)).toEqual(['release', 'dev'])
    expect(
      (options.trustedPublicKeys as Readonly<Record<string, { asymmetricKeyType?: string }>>)
        .release?.asymmetricKeyType,
    ).toBe('ed25519')
    expect(
      (options.trustedPublicKeys as Readonly<Record<string, { asymmetricKeyType?: string }>>).dev
        ?.asymmetricKeyType,
    ).toBe('ed25519')
  })

  it('refuses environment trust that collides with a built-in release key id', () => {
    const builtIn = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString()
    const override = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString()

    expect(() =>
      extensionManagerSecurityOptions(
        { MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: JSON.stringify({ release: override }) },
        { release: builtIn },
      ),
    ).toThrow('cannot override built-in key release')
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
