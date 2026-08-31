import { describe, expect, it } from 'vitest'
import {
  createContributionContractRegistry,
  LOCALIZATION_CONTRIBUTION_CONTRACT,
} from '@modkitx-x3/sdk'
import {
  buildInventory,
  createHostContributionContractRegistry,
  loadLocalizationCatalogs,
  type ExtensionInput,
} from '@modkitx-x3/host'
import { parseUiCatalogDocument } from '@modkitx-x3/ui/localization'
import { VirtualFileSystem, type VfsMount } from '@modkitx-x3/vfs'
import { createMemoryVfsProvider } from '@modkitx-x3/vfs/providers/memory'

const encoder = new TextEncoder()

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const value = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy.buffer))
  return `sha256:${[...value].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function catalog(
  locale = 'de',
  namespace = 'org.example.pack',
  messages: Readonly<Record<string, string>> = { 'pack.title': 'Titel' },
) {
  return { schema: 'org.modkitx/ui-message-catalog@1', locale, namespace, messages }
}

function manifest(path: string, messagePrefixes: readonly string[] = ['pack.'], locale = 'de') {
  return {
    schemaVersion: 1,
    contract: { id: LOCALIZATION_CONTRIBUTION_CONTRACT, major: 1 },
    id: 'org.example/localization',
    displayName: 'Example localization',
    spec: { catalogs: [{ locale, path, messagePrefixes }] },
  }
}

async function fixture(
  catalogPath: string,
  bytes: Uint8Array,
  options: {
    readonly resourcePath?: string
    readonly prefixes?: readonly string[]
    readonly locale?: string
    readonly disabled?: boolean
    readonly permissiveContract?: boolean
  } = {},
) {
  const resourcePath = options.resourcePath ?? catalogPath
  const contributionPath = 'contributions/localization.json'
  const document = manifest(resourcePath, options.prefixes, options.locale)
  const input: ExtensionInput = {
    source: 'memory-fixture',
    containers: {
      standalone: {
        schemaVersion: 1,
        publisher: 'org.example',
        id: 'language-pack',
        version: '1.0.0',
        license: 'MIT',
        contributionManifests: [contributionPath],
      },
    },
    files: [contributionPath, catalogPath],
    documents: new Map([[contributionPath, document]]),
    documentDigests: new Map([[contributionPath, 'sha256:manifest']]),
    artifact: {
      inventoryRecordId: 'artifact:language-pack',
      artifactDigest: 'sha256:artifact',
      artifactRoot: new URL('memory://fixture/pack/'),
      fileDigests: { [catalogPath]: await digest(bytes) },
      verifyArtifactDigest: expected => expected === 'sha256:artifact',
    },
  }
  const permissiveRegistry = createContributionContractRegistry([
    {
      contract: { id: LOCALIZATION_CONTRIBUTION_CONTRACT, major: 1 },
      schema: { type: 'object' },
      validator: () => true,
      mode: 'data-only',
      project: () => [],
      validateSemantics: () => [],
      conformanceProfile: 'org.example/unsafe-localization-test-v1',
    },
  ])
  const inventory = await buildInventory(
    [input],
    options.permissiveContract ? permissiveRegistry : createHostContributionContractRegistry(),
    options.disabled ? { disabledContributions: ['org.example/localization'] } : {},
  )
  const provider = createMemoryVfsProvider({
    authority: 'fixture',
    entries: { [`pack/${catalogPath}`]: bytes },
  })
  return { inventory, provider }
}

function parserOptions(vfs: { openMount(uri: string, options?: object): Promise<VfsMount> }) {
  return { vfs, parseCatalog: parseUiCatalogDocument }
}

describe('localization contributions through the host VFS boundary', () => {
  it('loads a valid enabled data-only catalog and never needs an executable variant', async () => {
    const bytes = encoder.encode(JSON.stringify(catalog()))
    const { inventory, provider } = await fixture('locales/de.json', bytes)
    const vfs = new VirtualFileSystem().registerProvider(provider)
    const result = await loadLocalizationCatalogs(inventory, parserOptions(vfs))

    expect(result.diagnostics).toEqual([])
    expect(result.catalogs).toEqual([
      expect.objectContaining({ locale: 'de', namespace: 'org.example.pack' }),
    ])
    await vfs.dispose()
  })

  it('refuses traversal before asking VFS to open a resource', async () => {
    const bytes = encoder.encode(JSON.stringify(catalog()))
    const { inventory, provider } = await fixture('locales/de.json', bytes, {
      resourcePath: '../outside.json',
      permissiveContract: true,
    })
    let opens = 0
    const vfs = {
      async openMount(uri: string, options?: object) {
        opens += 1
        return provider.open(uri, options as never)
      },
    }
    const result = await loadLocalizationCatalogs(inventory, parserOptions(vfs))

    expect(opens).toBe(0)
    expect(result.catalogs).toEqual([])
    expect(result.diagnostics[0]?.code).toBe('x3.host/localization-catalog-refused')
    expect(result.diagnostics[0]?.data).toEqual(
      expect.objectContaining({ reason: expect.stringContaining('escape') }),
    )
  })

  it('checks the raw byte limit before decoding JSON', async () => {
    const bytes = encoder.encode(
      JSON.stringify(
        catalog('de', 'org.example.pack', {
          'pack.title': 'x'.repeat(256),
        }),
      ),
    )
    const { inventory, provider } = await fixture('locales/de.json', bytes)
    const vfs = new VirtualFileSystem().registerProvider(provider)
    const result = await loadLocalizationCatalogs(inventory, {
      ...parserOptions(vfs),
      maxJsonBytes: 64,
    })

    expect(result.catalogs).toEqual([])
    expect(result.diagnostics[0]?.data).toEqual(
      expect.objectContaining({ reason: expect.stringContaining('64-byte raw limit') }),
    )
    await vfs.dispose()
  })

  it('reports malformed JSON and leaves fallback selection to the application', async () => {
    const bytes = encoder.encode('{not-json')
    const { inventory, provider } = await fixture('locales/de.json', bytes)
    const vfs = new VirtualFileSystem().registerProvider(provider)
    const result = await loadLocalizationCatalogs(inventory, parserOptions(vfs))

    expect(result.catalogs).toEqual([])
    expect(result.diagnostics[0]?.data).toEqual(
      expect.objectContaining({ reason: expect.stringContaining('valid UTF-8 JSON') }),
    )
    await vfs.dispose()
  })

  it('reports a decoded document that fails the UI catalog contract', async () => {
    const bytes = encoder.encode(
      JSON.stringify({ ...catalog(), schema: 'org.example/not-a-ui-catalog@1' }),
    )
    const { inventory, provider } = await fixture('locales/de.json', bytes)
    const vfs = new VirtualFileSystem().registerProvider(provider)
    const result = await loadLocalizationCatalogs(inventory, parserOptions(vfs))

    expect(result.catalogs).toEqual([])
    expect(result.diagnostics[0]?.data).toEqual(
      expect.objectContaining({ reason: expect.stringContaining('UI catalog schema') }),
    )
    await vfs.dispose()
  })

  it('treats requested prefixes as untrusted and grants broader keys only through host policy', async () => {
    const bytes = encoder.encode(
      JSON.stringify(catalog('de', 'org.example.pack', { 'app.title': 'Modkit auf Deutsch' })),
    )
    const { inventory, provider } = await fixture('locales/de.json', bytes, {
      prefixes: ['app.'],
    })
    const deniedVfs = new VirtualFileSystem().registerProvider(provider)
    const denied = await loadLocalizationCatalogs(inventory, parserOptions(deniedVfs))
    expect(denied.catalogs).toEqual([])
    expect(denied.diagnostics[0]?.data).toEqual(
      expect.objectContaining({
        reason: expect.stringContaining('no requested message-key prefix'),
      }),
    )
    await deniedVfs.dispose()

    const allowedVfs = new VirtualFileSystem().registerProvider(
      createMemoryVfsProvider({
        authority: 'fixture',
        entries: { 'pack/locales/de.json': bytes },
      }),
    )
    const allowed = await loadLocalizationCatalogs(inventory, {
      ...parserOptions(allowedVfs),
      authorizeMessagePrefixes: request => {
        expect(request.catalogNamespace).toBe('org.example.pack')
        return request.requestedMessagePrefixes
      },
    })
    expect(allowed.diagnostics).toEqual([])
    expect(allowed.catalogs).toHaveLength(1)
    await allowedVfs.dispose()
  })

  it('does not open VFS for a disabled localization contribution', async () => {
    const bytes = encoder.encode(JSON.stringify(catalog()))
    const { inventory } = await fixture('locales/de.json', bytes, { disabled: true })
    let opens = 0
    const result = await loadLocalizationCatalogs(inventory, {
      ...parserOptions({
        async openMount(): Promise<VfsMount> {
          opens += 1
          throw new Error('must not open')
        },
      }),
    })

    expect(opens).toBe(0)
    expect(result).toEqual({ catalogs: [], diagnostics: [] })
  })

  it('refuses bytes that do not match the artifact attestation', async () => {
    const attested = encoder.encode(JSON.stringify(catalog()))
    const served = encoder.encode(
      JSON.stringify(
        catalog('de', 'org.example.pack', {
          'pack.title': 'tampered',
        }),
      ),
    )
    const { inventory } = await fixture('locales/de.json', attested)
    const vfs = new VirtualFileSystem().registerProvider(
      createMemoryVfsProvider({
        authority: 'fixture',
        entries: { 'pack/locales/de.json': served },
      }),
    )
    const result = await loadLocalizationCatalogs(inventory, parserOptions(vfs))

    expect(result.catalogs).toEqual([])
    expect(result.diagnostics[0]?.data).toEqual(
      expect.objectContaining({ reason: expect.stringContaining('attested SHA-256') }),
    )
    await vfs.dispose()
  })
})
