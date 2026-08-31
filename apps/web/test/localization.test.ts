import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { LOCALIZATION_CONTRIBUTION_CONTRACT } from '@modkit/sdk'
import {
  buildInventory,
  createHostContributionContractRegistry,
  type ExtensionInput,
  type Inventory,
} from '@modkit/host'
import { parseUiCatalogDocument } from '@modkit/ui/localization'

import {
  createWebLocalizer,
  createWebLocalizerFromCatalogLoader,
  loadWebLocalizationCatalogs,
  WEB_LOCALIZATION_TRANSLATABLE_PREFIXES,
  WEB_UI_CATALOGS,
} from '../src/localization.js'
import {
  NO_USER_EXTENSION_ROOTS,
  userExtensionArtifactRoot,
  type LoadedUserExtensionRoots,
} from '../src/extension-roots.js'

const encoder = new TextEncoder()

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))
  return `sha256:${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

async function localizationInventory(
  artifactRoot: string,
  catalogBytes: Uint8Array,
  options: { readonly disabled?: boolean } = {},
): Promise<Inventory> {
  const contributionPath = 'contributions/localization.json'
  const catalogPath = 'locales/de.json'
  const input: ExtensionInput = {
    source: 'web-language-pack-fixture',
    containers: {
      standalone: {
        schemaVersion: 1,
        publisher: 'org.example',
        id: 'german-language-pack',
        version: '1.0.0',
        license: 'MIT',
        contributionManifests: [contributionPath],
      },
    },
    files: [contributionPath, catalogPath],
    documents: new Map([
      [
        contributionPath,
        {
          schemaVersion: 1,
          contract: { id: LOCALIZATION_CONTRIBUTION_CONTRACT, major: 1 },
          id: 'org.example/german-localization',
          displayName: 'German localization',
          spec: {
            catalogs: [
              {
                locale: 'de',
                path: catalogPath,
                messagePrefixes: ['app.', 'pack.'],
              },
            ],
          },
        },
      ],
    ]),
    documentDigests: new Map([[contributionPath, 'sha256:manifest']]),
    artifact: {
      inventoryRecordId: 'artifact:web-language-pack',
      artifactDigest: 'sha256:artifact',
      artifactRoot: new URL(artifactRoot),
      fileDigests: { [catalogPath]: await sha256(catalogBytes) },
      verifyArtifactDigest: expected => expected === 'sha256:artifact',
    },
    execution: { origin: 'installed', allowTrustedInProcess: false },
  }
  return buildInventory([input], createHostContributionContractRegistry(), {
    ...(options.disabled ? { disabledContributions: ['org.example/german-localization'] } : {}),
  })
}

function languageCatalog(): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      schema: 'modkit/ui-message-catalog@1',
      locale: 'de',
      namespace: 'org.example.pack',
      messages: {
        'app.title': 'Modkit auf Deutsch',
        'pack.title': 'Eigenes Paket',
      },
    }),
  )
}

function syntheticRoots(serve: LoadedUserExtensionRoots['serve']): LoadedUserExtensionRoots {
  return Object.freeze({ ...NO_USER_EXTENSION_ROOTS, serve })
}

function headers(values: Readonly<Record<string, string>>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null
    },
  }
}

function rangedFetch(bytes: Uint8Array, requested: string[]) {
  return async (
    url: string,
    init?: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> },
  ) => {
    requested.push(`${init?.method ?? 'GET'} ${url}`)
    const common = {
      ok: true,
      url,
      headers: headers({ 'accept-ranges': 'bytes', 'content-length': String(bytes.byteLength) }),
    }
    if (init?.method === 'HEAD') {
      return { ...common, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const range = init?.headers?.['Range']
    const match = range?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match !== undefined && match !== null) {
      const selected = bytes.slice(Number(match[1]), Number(match[2]) + 1)
      return { ...common, status: 206, arrayBuffer: async () => selected.slice().buffer }
    }
    return { ...common, status: 200, arrayBuffer: async () => bytes.slice().buffer }
  }
}

describe('Web UI localization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the English and Russian application catalogs in exact key parity', () => {
    const [english, russian] = WEB_UI_CATALOGS
    expect(english?.locale).toBe('en')
    expect(russian?.locale).toBe('ru')
    expect(Object.keys(russian?.messages ?? {}).sort()).toEqual(
      Object.keys(english?.messages ?? {}).sort(),
    )
  })

  it('keeps interpolation placeholders in English and Russian messages aligned', () => {
    const [english, russian] = WEB_UI_CATALOGS
    const placeholders = (message: string): readonly string[] =>
      [...message.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu)].map(match => match[1] as string).sort()
    for (const [key, message] of Object.entries(english?.messages ?? {})) {
      expect(placeholders(russian?.messages[key] ?? ''), key).toEqual(placeholders(message))
    }
  })

  it('falls back by BCP-47 language and retains the shared catalog underneath', () => {
    const russian = createWebLocalizer('ru-RU')
    expect(russian.locale).toBe('ru')
    expect(russian.text('web.embed.view')).toBe('Режим просмотра')
    expect(russian.text('extensions.group.available')).toBe('Доступные')
    expect(createWebLocalizer('de-DE').text('app.title')).toBe('Modkit MK3')
  })

  it('resolves auto through browser language preferences', () => {
    vi.stubGlobal('navigator', { languages: ['ru-RU', 'en-US'] })
    expect(createWebLocalizer('auto').locale).toBe('ru')
  })

  it('interpolates user data without treating it as a translation key', () => {
    expect(
      createWebLocalizer('ru').text('web.status.noCodec', {
        name: 'mission.SC2Map',
        reason: 'unknown-format',
      }),
    ).toBe('mission.SC2Map — кодек не найден (unknown-format); показаны исходные байты.')
  })

  it('loads a data-only third language through the Extension Manager/VFS boundary', async () => {
    const english = WEB_UI_CATALOGS[0]
    if (english === undefined) throw new Error('missing English Web catalog')
    const french = parseUiCatalogDocument(
      {
        schema: 'modkit/ui-message-catalog@1',
        locale: 'fr',
        namespace: 'org.example/web-language-pack',
        messages: {
          'web.extensions.cardFailed': 'Impossible d’ouvrir la fiche d’extension : {reason}',
        },
      },
      {
        authorizedMessagePrefixes: ['web.'],
        fallbackCatalog: english.messages,
      },
    )
    const loadCatalogs = vi.fn(async () => ({ catalogs: [french] }))
    const localizer = await createWebLocalizerFromCatalogLoader('fr-FR', loadCatalogs)
    expect(loadCatalogs).toHaveBeenCalledOnce()
    expect(localizer.locale).toBe('fr')
    expect(localizer.text('web.extensions.cardFailed', { reason: 'fixture' })).toBe(
      'Impossible d’ouvrir la fiche d’extension : fixture',
    )
    expect(localizer.text('web.extensions.trusted')).toBe('Trusted')
  })

  it('routes a user-extension catalog through the composed synthetic root, never page fetch', async () => {
    const bytes = languageCatalog()
    const rootId = 'language-root'
    const root = userExtensionArtifactRoot(rootId)
    const inventory = await localizationInventory(root, bytes)
    const served: string[] = []
    const pageFetch = vi.fn(() => Promise.reject(new Error('synthetic URL reached page fetch')))
    const loaded = await loadWebLocalizationCatalogs({
      inventory,
      baseUrl: 'https://pwa.example/app/',
      loadedExtensionRoots: syntheticRoots(async url => {
        served.push(url)
        const ok = url === `${root}locales/de.json`
        return {
          ok,
          status: ok ? 200 : 404,
          arrayBuffer: async () => {
            if (!ok) throw new Error(`404 ${url}`)
            return bytes.slice().buffer
          },
        }
      }),
      fetch: pageFetch,
    })

    expect(loaded.diagnostics).toEqual([])
    expect(loaded.catalogs).toHaveLength(1)
    expect(served).toEqual([`${root}locales/de.json`])
    expect(pageFetch).not.toHaveBeenCalled()
    expect(createWebLocalizer('de-DE', loaded.catalogs).text('app.title')).toBe(
      'Modkit auf Deutsch',
    )
  })

  it('routes a bundled catalog through page fetch and grants only product or owned prefixes', async () => {
    const bytes = languageCatalog()
    const requested: string[] = []
    const inventory = await localizationInventory('https://pwa.example/app/extensions/lang/', bytes)
    const syntheticServe = vi.fn(NO_USER_EXTENSION_ROOTS.serve)
    const loaded = await loadWebLocalizationCatalogs({
      inventory,
      baseUrl: 'https://pwa.example/app/',
      loadedExtensionRoots: syntheticRoots(syntheticServe),
      fetch: rangedFetch(bytes, requested),
    })

    expect(WEB_LOCALIZATION_TRANSLATABLE_PREFIXES).toContain('app.')
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.catalogs[0]?.messages).toMatchObject({
      'app.title': 'Modkit auf Deutsch',
      'pack.title': 'Eigenes Paket',
    })
    expect(requested).toContain('HEAD https://pwa.example/app/extensions/lang/locales/de.json')
    expect(requested.some(value => value.startsWith('GET '))).toBe(true)
    expect(syntheticServe).not.toHaveBeenCalled()
  })

  it('refuses an unconfigured artifact origin before page fetch and keeps built-in fallback', async () => {
    const bytes = languageCatalog()
    const inventory = await localizationInventory('https://evil.example/extensions/lang/', bytes)
    const pageFetch = vi.fn(rangedFetch(bytes, []))
    const loaded = await loadWebLocalizationCatalogs({
      inventory,
      baseUrl: 'https://pwa.example/app/',
      fetch: pageFetch,
    })

    expect(loaded.catalogs).toEqual([])
    expect(loaded.diagnostics[0]?.data).toEqual(
      expect.objectContaining({ reason: expect.stringContaining('refuses origin') }),
    )
    expect(pageFetch).not.toHaveBeenCalled()
    expect(createWebLocalizer('de-DE', loaded.catalogs).text('app.title')).toBe('Modkit MK3')
  })

  it('does not read a disabled localization contribution', async () => {
    const bytes = languageCatalog()
    const inventory = await localizationInventory(
      'https://pwa.example/app/extensions/lang/',
      bytes,
      { disabled: true },
    )
    const pageFetch = vi.fn(rangedFetch(bytes, []))
    const loaded = await loadWebLocalizationCatalogs({
      inventory,
      baseUrl: 'https://pwa.example/app/',
      fetch: pageFetch,
    })

    expect(loaded).toEqual({ catalogs: [], diagnostics: [] })
    expect(pageFetch).not.toHaveBeenCalled()
  })
})
