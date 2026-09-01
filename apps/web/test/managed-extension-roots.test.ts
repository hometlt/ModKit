import { webcrypto } from 'node:crypto'
import { createHostComposition, EXTENSION_DISABLED_CODE } from '@modkit/host'
import { describe, expect, it } from 'vitest'

import { createWebExtensionSubjectCatalog } from '../src/extension-subjects.js'
import { createWebTopology, WEB_MAIN_REALM } from '../src/index.js'
import {
  combineLoadedExtensionRoots,
  isCanonicalBase64,
  loadManagedExtensionRoots,
  MANAGED_EXTENSION_BUNDLE_FAILURE_CODES,
} from '../src/managed-extension-roots.js'
import { userExtensionArtifactRoot } from '../src/extension-roots.js'
import type {
  BrowserExtensionStorage,
  InstalledBrowserExtension,
} from '../src/managed-extension-storage.js'

const DIGEST = 'a'.repeat(64)
const subtle = webcrypto.subtle as never

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64')

function extensionPackageJson(id = 'codec'): string {
  return JSON.stringify({
    name: `modkit-extension-${id}`,
    version: '1.0.0',
    license: 'MIT',
    type: 'module',
    modkit: {
      schemaVersion: 1,
      publisher: 'org.example',
      id,
      contributionManifests: [],
    },
  })
}

function embeddedBundle(id = 'org.example/codec'): string {
  return JSON.stringify({
    schemaVersion: 1,
    extensions: [
      {
        id,
        files: { 'package.json': encode(extensionPackageJson(id.split('/')[1] ?? 'codec')) },
      },
    ],
  })
}

function embeddedBundleWithContribution(): string {
  const packageJson = JSON.parse(extensionPackageJson()) as Record<string, unknown>
  packageJson['modkit'] = {
    schemaVersion: 1,
    publisher: 'org.example',
    id: 'codec',
    contributionManifests: ['./contributions/*.json'],
  }
  return JSON.stringify({
    schemaVersion: 1,
    extensions: [
      {
        id: 'org.example/codec',
        files: {
          'package.json': encode(JSON.stringify(packageJson)),
          'contributions/fixture.json': encode(
            JSON.stringify({
              schemaVersion: 1,
              id: 'org.example/fixture-contribution',
              displayName: 'Fixture contribution',
              contract: { id: 'org.example/fixture-contract', major: 1 },
              spec: {},
            }),
          ),
        },
      },
    ],
  })
}

function embeddedMultiRootBundle(): string {
  const root = (
    id: string,
    name: string,
    exports: Readonly<Record<string, string>>,
    files: Readonly<Record<string, string>>,
  ) => ({
    id: `org.example/${id}`,
    files: {
      'package.json': encode(
        JSON.stringify({
          name,
          version: '1.0.0',
          type: 'module',
          exports,
          modkit: {
            schemaVersion: 1,
            publisher: 'org.example',
            id,
            contributionManifests: [],
          },
        }),
      ),
      ...Object.fromEntries(Object.entries(files).map(([path, source]) => [path, encode(source)])),
    },
  })
  return JSON.stringify({
    schemaVersion: 1,
    extensions: [
      root(
        'dependency',
        'example-dependency',
        { './value': './src/value.js' },
        {
          'src/value.js': 'export const answer = 42',
        },
      ),
      root(
        'consumer',
        'example-consumer',
        { '.': './src/index.js' },
        {
          'src/index.js': "import { answer } from 'example-dependency/value'",
        },
      ),
    ],
  })
}

const record = (overrides: Partial<InstalledBrowserExtension> = {}): InstalledBrowserExtension => ({
  id: 'org.example/codec',
  version: '1.0.0',
  digest: DIGEST,
  sourceUrl: 'https://cdn.example.invalid/codec.mkx',
  cacheKey: `https://extension-cache.modkit.invalid/org.example%2Fcodec/1.0.0/${DIGEST}`,
  installedAt: 1,
  enabled: true,
  settings: {},
  ...overrides,
})

class FakeManagedStorage implements BrowserExtensionStorage {
  readonly metadataLocation = 'fake IndexedDB'
  readonly responseLocation = 'fake Cache Storage'
  readonly openCalls: string[] = []

  constructor(
    private readonly records: readonly InstalledBrowserExtension[],
    private readonly bodies: ReadonlyMap<string, string | Uint8Array>,
  ) {}

  async list(): Promise<readonly InstalledBrowserExtension[]> {
    return this.records
  }

  async open(id: string): Promise<Response | undefined> {
    this.openCalls.push(id)
    const body = this.bodies.get(id)
    if (body === undefined) return undefined
    if (typeof body === 'string') return new Response(body)
    const copy = new Uint8Array(body.byteLength)
    copy.set(body)
    return new Response(copy)
  }

  openInstalled(id: string): Promise<Response | undefined> {
    return this.open(id)
  }

  async install(): Promise<InstalledBrowserExtension> {
    throw new Error('not used by this bridge test')
  }

  async installVerified(): Promise<InstalledBrowserExtension> {
    throw new Error('not used by this bridge test')
  }

  async remove(): Promise<void> {
    throw new Error('not used by this bridge test')
  }

  async enable(): Promise<InstalledBrowserExtension> {
    throw new Error('not used by this bridge test')
  }

  async updateSettings(): Promise<InstalledBrowserExtension> {
    throw new Error('not used by this bridge test')
  }
}

describe('downloaded browser extension roots', () => {
  it('validates release-sized base64 without a recursive regular expression', () => {
    const encoded = 'AAAA'.repeat(1_000_000)
    expect(isCanonicalBase64(encoded)).toBe(true)
    expect(isCanonicalBase64(`${encoded.slice(0, -1)}!`)).toBe(false)
    expect(isCanonicalBase64('YQ==')).toBe(true)
    expect(isCanonicalBase64('A===')).toBe(false)
  })

  it('derives one cross-root module map from a multi-root distribution package', async () => {
    const storage = new FakeManagedStorage(
      [record({ id: 'org.example/toolkit' })],
      new Map([['org.example/toolkit', embeddedMultiRootBundle()]]),
    )
    const loaded = await loadManagedExtensionRoots(storage, { subtle })

    expect(loaded.failures).toEqual([])
    expect(loaded.coordinates).toEqual(['org.example/dependency', 'org.example/consumer'])
    expect(loaded.packageByCoordinate).toEqual({
      'org.example/consumer': 'org.example/toolkit',
      'org.example/dependency': 'org.example/toolkit',
    })
    expect(Object.keys(loaded.moduleMap).sort()).toEqual([
      'example-consumer',
      'example-dependency/value',
    ])
    expect(loaded.verifiedModuleRoots).toHaveLength(2)
  })

  it('opens an enabled digest-verified package as a worker-only ExtensionInput', async () => {
    const storage = new FakeManagedStorage(
      [record()],
      new Map([['org.example/codec', embeddedBundle()]]),
    )
    const loaded = await loadManagedExtensionRoots(storage, { subtle })

    expect(storage.openCalls).toEqual(['org.example/codec'])
    expect(loaded.failures).toEqual([])
    expect(loaded.coordinates).toEqual(['org.example/codec'])
    expect(loaded.inputs).toHaveLength(1)
    expect(loaded.inputs[0]).toMatchObject({
      source: 'managed-package/org.example/codec@1.0.0',
      execution: { origin: 'installed', allowTrustedInProcess: false },
    })
    // The bridge returns inventory + bytes only. It does not import or execute the package on the
    // page; evaluation remains a later worker-backend concern.
    expect(loaded.inputs[0]?.files).toEqual(['package.json'])

    const rootId = loaded.rootIds[0]
    expect(rootId).toBeDefined()
    const response = await loaded.serve(`${userExtensionArtifactRoot(rootId ?? '')}package.json`)
    expect(response.ok).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(await response.arrayBuffer()))).toMatchObject({
      modkit: { publisher: 'org.example', id: 'codec' },
    })
  })

  it('keeps disabled package roots in inventory while naming every inactive coordinate', async () => {
    const storage = new FakeManagedStorage(
      [record({ enabled: false })],
      new Map([['org.example/codec', embeddedBundleWithContribution()]]),
    )
    const loaded = await loadManagedExtensionRoots(storage, { subtle })

    expect(storage.openCalls).toEqual(['org.example/codec'])
    expect(loaded.inputs).toHaveLength(1)
    expect(loaded.coordinates).toEqual(['org.example/codec'])
    expect(loaded.packageByCoordinate).toEqual({
      'org.example/codec': 'org.example/codec',
    })
    expect(loaded.disabledExtensionCoordinates).toEqual(['org.example/codec'])
    expect(loaded.failures).toEqual([])

    const topology = createWebTopology(
      { operatingSystem: 'linux', architecture: 'x64' },
      { main: [], worker: [], sharedMemory: false },
    )
    const composition = await createHostComposition({
      topology,
      realmId: WEB_MAIN_REALM,
      extensions: loaded.inputs,
      disabledExtensions: loaded.disabledExtensionCoordinates,
    })
    const extension = composition.inventory.extensions.find(
      item => `${item.manifest.publisher}/${item.manifest.id}` === 'org.example/codec',
    )
    expect(extension).toBeDefined()
    expect(extension?.contributions[0]?.diagnostics.map(item => item.code)).toContain(
      EXTENSION_DISABLED_CODE,
    )
    expect(extension?.contributions[0]?.activationEligible).toBe(false)

    const cards = createWebExtensionSubjectCatalog(composition.inventory, {
      disabledExtensions: loaded.disabledExtensionCoordinates,
      managedPackageByExtension: loaded.packageByCoordinate,
      managedPackageEnablement: { 'org.example/codec': false },
    })
    const card = cards.extension('org.example/codec')
    expect(card?.projection.extension.enabled).toBe(false)
    expect(card?.projection.contributions[0]?.effectiveEnabled).toBe(false)
  })

  it('diagnoses invalid JSON and path-only repository entries instead of resolving paths', async () => {
    const invalid = record({ id: 'org.example/invalid' })
    const pathOnly = record({ id: 'org.example/path-only' })
    const storage = new FakeManagedStorage(
      [invalid, pathOnly],
      new Map([
        [invalid.id, '{not json'],
        [
          pathOnly.id,
          JSON.stringify({
            schemaVersion: 1,
            extensions: [{ id: 'org.example/path-only', path: '../extension' }],
          }),
        ],
      ]),
    )
    const loaded = await loadManagedExtensionRoots(storage, { subtle })

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures.map(failure => failure.code)).toEqual([
      MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.invalid,
      MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.pathOnly,
    ])
    expect(loaded.failures[1]?.message).toContain('must embed extensions[].files as base64')
  })

  it('rejects invalid UTF-8 instead of parsing replacement characters', async () => {
    const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])
    const storage = new FakeManagedStorage(
      [record()],
      new Map<string, string | Uint8Array>([['org.example/codec', invalidUtf8]]),
    )

    const loaded = await loadManagedExtensionRoots(storage, { subtle })
    expect(loaded.inputs).toEqual([])
    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0]?.code).toBe(MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.invalid)
    expect(loaded.failures[0]?.message).toContain('UTF-8 JSON')
  })

  it('combines managed and user roots behind one synthetic fetch in priority order', async () => {
    const storage = new FakeManagedStorage(
      [record()],
      new Map([['org.example/codec', embeddedBundle()]]),
    )
    const managed = await loadManagedExtensionRoots(storage, { subtle })
    let userFetches = 0
    const combined = combineLoadedExtensionRoots(managed, {
      inputs: [],
      failures: [],
      coordinates: [],
      rootIds: [],
      moduleMap: {},
      moduleMapOwners: {},
      verifiedModuleRoots: [],
      serve: async url => {
        userFetches += 1
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode(`user:${url}`).buffer,
        }
      },
    })

    const rootId = managed.rootIds[0]
    const managedResponse = await combined.serve(
      `${userExtensionArtifactRoot(rootId ?? '')}package.json`,
    )
    expect(managedResponse.ok).toBe(true)
    expect(userFetches).toBe(0)

    const userResponse = await combined.serve('https://user-extension.invalid/user/package.json')
    expect(userResponse.ok).toBe(true)
    expect(userFetches).toBe(1)
  })
})
