/**
 * S6: the PWA product path proven in Node — the generated catalog composes the host, the real
 * bundled extension sources are "served" from disk by a fake fetch, a fake module Worker runs the
 * production worker entry over a real MessageChannel, WebCrypto digests, `data:` module URLs as
 * the blob store, and the module map points bare specifiers at file: URLs. `open` then runs the
 * real bundled PNG codec worker-brokered in the browser topology's worker realm.
 */
import { createHash, webcrypto } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkit/core'
import {
  commandRequest,
  COMMAND_PROTOCOL_SCHEMA_VERSION,
  CONTRIBUTION_DISABLED_CODE,
  EXTENSION_DISABLED_CODE,
} from '@modkit/host'
import { revisionId, type ArtifactByteSource } from '@modkit/sdk'
import {
  installBrowserWorkerEntry,
  type BrowserObjectUrlLike,
  type BrowserWorkerLike,
} from '@modkit/host/browser'
import { checkCommandFixture, COMMAND_FIXTURES } from '@modkit/testkit'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import {
  catalogToExtensionInputs,
  createWebSubjectServices,
  type WebExtensionCatalog,
} from '../src/subjects.js'
import { createSingleFileAccess } from '../src/files.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const dataRequire = createRequire(join(repositoryRoot, 'extensions', 'data', 'package.json'))
const ORIGIN = 'https://pwa.example/app/'
const catalog: WebExtensionCatalog = WEB_EXTENSION_CATALOG
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Serves `extensions/<name>/…` requests from the matching root under `extensions/` on disk. */
function diskOrigin() {
  const fetched: string[] = []
  return {
    fetched,
    fetch: async (url: string) => {
      fetched.push(url)
      const relative = url.startsWith(`${ORIGIN}extensions/`)
        ? url.slice(`${ORIGIN}extensions/`.length)
        : undefined
      const path = relative === undefined ? undefined : join(repositoryRoot, 'extensions', relative)
      const ok = path !== undefined && existsSync(path)
      return {
        ok,
        status: ok ? 200 : 404,
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          if (!ok || path === undefined) throw new Error(`404 ${url}`)
          const bytes = readFileSync(path)
          const copy = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(copy).set(bytes)
          return copy
        },
      }
    },
  }
}

class FakeBlob {
  readonly size: number
  readonly source: string
  constructor(parts: readonly string[], options: { readonly type: string }) {
    this.source = parts.join('')
    this.size = this.source.length
    void options
  }
}
const objectUrls: BrowserObjectUrlLike = {
  createObjectURL: blob =>
    `data:text/javascript;base64,${Buffer.from(
      blob instanceof FakeBlob ? blob.source : '',
      'utf8',
    ).toString('base64')}`,
  revokeObjectURL: () => undefined,
}

/** A fake DOM Worker whose script is the production entry over a fake worker scope. */
const spawned: string[] = []
class FakeWorker implements BrowserWorkerLike {
  private readonly listeners: ((event: { readonly data: unknown }) => void)[] = []
  private closed = false
  constructor(url: string, options: { readonly type: 'module'; readonly name?: string }) {
    spawned.push(`${options.name ?? '?'} ← ${url}`)
    installBrowserWorkerEntry({
      addEventListener: (_t, l) => void this.listeners.push(l),
      removeEventListener: (_t, l) => {
        const index = this.listeners.indexOf(l)
        if (index >= 0) this.listeners.splice(index, 1)
      },
      close: () => void (this.closed = true),
    })
  }
  postMessage(message: unknown, transfer: readonly unknown[]): void {
    void transfer
    if (this.closed) return
    for (const listener of [...this.listeners]) listener({ data: message })
  }
  terminate(): void {
    this.closed = true
  }
  addEventListener(): void {
    // the fake never raises worker errors
  }
}

/** Node module map: bare specifiers → file: URLs of the real sources / built packages. */
const nodeModuleMap = {
  '@modkit/codec-kit': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'index.js'),
  ).href,
  '@modkit/codec-kit/crypto/blowfish': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'crypto', 'blowfish.js'),
  ).href,
  '@modkit/codec-kit/crypto/aes': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'crypto', 'aes.js'),
  ).href,
  '@modkit/codec-kit/crypto/digest': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'crypto', 'digest.js'),
  ).href,
  '@modkit/codec-kit/json-edit': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'json-edit.js'),
  ).href,
  '@modkit/codec-kit/checksum': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'checksum', 'index.js'),
  ).href,
  '@modkit/codec-kit/audio': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'audio', 'index.js'),
  ).href,
  '@modkit/codec-kit/compression/bounded': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'bounded.js'),
  ).href,
  '@modkit/codec-kit/compression/inflate': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'inflate.js'),
  ).href,
  '@modkit/codec-kit/compression/lz4': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'lz4.js'),
  ).href,
  '@modkit/codec-kit/compression/refpack': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'refpack.js'),
  ).href,
  '@modkit/codec-kit/compression/zstd': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'zstd.js'),
  ).href,
  '@modkit/codec-kit/model/draco': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'draco.js'),
  ).href,
  '@modkit/codec-kit/raster': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'raster', 'index.js'),
  ).href,
  '@modkit/codec-kit/raster/palette': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'raster', 'palette.js'),
  ).href,
  '@modkit/codec-kit/texture/bc': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'texture', 'bc.js'),
  ).href,
  '@modkit/codec-kit/json-snapshot': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'json-snapshot.js'),
  ).href,
  '@modkit/codec-kit/text': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'text', 'index.js'),
  ).href,
  '@modkit/codec-kit/tree/json': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'tree', 'json-tree.js'),
  ).href,
  '@modkit/core': pathToFileURL(join(repositoryRoot, 'packages', 'core', 'dist', 'index.js')).href,
  '@modkit/scene/uvm': pathToFileURL(
    join(repositoryRoot, 'packages', 'scene', 'dist', 'uvm', 'index.js'),
  ).href,
  '@modkit/scene/uvm/inspection': pathToFileURL(
    join(repositoryRoot, 'packages', 'scene', 'dist', 'uvm', 'inspection.js'),
  ).href,
  '@modkit/scene/uvm/render': pathToFileURL(
    join(repositoryRoot, 'packages', 'scene', 'dist', 'uvm', 'render.js'),
  ).href,
  '@modkit/sdk': pathToFileURL(join(repositoryRoot, 'packages', 'sdk', 'dist', 'index.js')).href,
  '@modkit/sdk/model-encoding': pathToFileURL(
    join(repositoryRoot, 'packages', 'sdk', 'dist', 'model-encoding.js'),
  ).href,
  '@modkit/uv/model/container': pathToFileURL(
    join(repositoryRoot, 'packages', 'uv', 'dist', 'model', 'container.js'),
  ).href,
  '@modkit/uv/model/validation': pathToFileURL(
    join(repositoryRoot, 'packages', 'uv', 'dist', 'model', 'validation', 'index.js'),
  ).href,
  '@rgrove/parse-xml': pathToFileURL(dataRequire.resolve('@rgrove/parse-xml')).href,
  'smol-toml': pathToFileURL(dataRequire.resolve('smol-toml')).href,
  yaml: pathToFileURL(dataRequire.resolve('yaml')).href,
}

function byteSource(name: string, bytes: Uint8Array): ArtifactByteSource {
  const owned = Uint8Array.from(bytes)
  return {
    kind: 'bytes',
    ref: { id: `memory://web/${name}`, uri: `memory://web/${name}` },
    revision: revisionId(`content-hash.sha256:${createHash('sha256').update(owned).digest('hex')}`),
    size: BigInt(owned.byteLength),
    async read(offset, length) {
      return owned.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield owned
    },
  }
}

function textSource(name: string, text: string): ArtifactByteSource {
  return byteSource(name, new TextEncoder().encode(text))
}

function fileSource(path: string, name: string): ArtifactByteSource {
  return byteSource(name, new Uint8Array(readFileSync(path)))
}

/** One actual FileSystemHandle-shaped authority over a disk snapshot for command tests. */
function pickedFile(path: string, name: string) {
  const bytes = new Uint8Array(readFileSync(path))
  const file = {
    name,
    size: bytes.byteLength,
    lastModified: 1,
    slice(start: number, end: number) {
      return {
        async arrayBuffer(): Promise<ArrayBuffer> {
          return bytes.slice(start, end).buffer
        },
      }
    },
  }
  const handle = { kind: 'file' as const, name, getFile: async () => file }
  return createSingleFileAccess(file, handle)
}

const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const identity = { operatingSystem: 'windows' as const, architecture: 'x64' as const }
const probe = { main: [], worker: [], sharedMemory: false } as const

afterEach(() => {
  spawned.splice(0)
})

describe('PWA product path — catalog → composition → worker-brokered open', () => {
  it('the generated catalog is the loader attestation: same digests as loading the directories now', async () => {
    const { loadExtensionDirectory } = await import('@modkit/host/node')
    expect(catalog.extensions.length).toBeGreaterThan(0)
    for (const entry of catalog.extensions) {
      const fresh = await loadExtensionDirectory(join(repositoryRoot, entry.source))
      expect(fresh.artifact.artifactDigest, entry.name).toBe(entry.artifact.artifactDigest)
      expect(fresh.artifact.fileDigests, entry.name).toEqual(entry.artifact.fileDigests)
    }
    // exclusions are named with reasons, never silent
    for (const excluded of catalog.excluded) expect(excluded.reason).toMatch(/not vendored/u)
    const inputs = catalogToExtensionInputs(catalog, ORIGIN)
    expect(inputs.every(input => input.execution?.allowTrustedInProcess === false)).toBe(true)
    expect(inputs[0]?.artifact.artifactRoot.href.startsWith(`${ORIGIN}extensions/`)).toBe(true)
    expect(catalogToExtensionInputs(catalog, ORIGIN, 'installed')[0]?.execution?.origin).toBe(
      'installed',
    )
    // Hashes every bundled root from disk; ten roots take over the default five seconds.
  }, 60_000)

  it('keeps a contribution card-addressable while its portable setting prevents activation', async () => {
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog,
      identity,
      probe,
      disabledExtensions: ['modkit/images'],
      disabledContributions: ['modkit/image-png'],
      dom: {
        fetch: diskOrigin().fetch,
        subtle: webcrypto.subtle as never,
        Blob: FakeBlob as never,
        objectUrls,
        Worker: FakeWorker,
        MessageChannel: MessageChannel as never,
      },
      moduleMap: nodeModuleMap,
    })
    const contribution = services.main.inventory.extensions
      .flatMap(extension => extension.contributions)
      .find(item => item.manifest?.id === 'modkit/image-png')
    expect(contribution).toBeDefined()
    expect(contribution?.activationEligible).toBe(false)
    expect(contribution?.diagnostics.map(item => item.code)).toContain(CONTRIBUTION_DISABLED_CODE)
    expect(contribution?.diagnostics.map(item => item.code)).toContain(EXTENSION_DISABLED_CODE)
    await services.dispose()
  })

  it('opens a real PNG through the browser topology: portable variant, worker-brokered in the worker realm, tree data source answers over the RPC', async () => {
    const site = diskOrigin()
    const diagnostics: Diagnostic[] = []
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog,
      identity,
      probe,
      dom: {
        fetch: site.fetch,
        subtle: webcrypto.subtle as never,
        Blob: FakeBlob as never,
        objectUrls,
        Worker: FakeWorker,
        MessageChannel: MessageChannel as never,
      },
      moduleMap: nodeModuleMap,
      onDiagnostic: diagnostic => void diagnostics.push(diagnostic),
    })
    expect(services.executionProfiles).toEqual(['trusted-in-process', 'worker-brokered'])
    expect(services.supportedExtensions).toContain('png')
    expect(services.worker.target.environment).toBe('browser-worker')
    expect(services.main.inventory.diagnostics.filter(d => d.severity === 'error')).toEqual([])

    const png = join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png')
    const result = await services.open({
      source: fileSource(png, 'favicon-32.png'),
      path: 'favicon-32.png',
      intent: 'full',
      grant: { id: 'pwa-open', classes: ['read-source'] },
      budget,
    })
    expect(result.state, JSON.stringify(result)).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'modkit/image-png',
      variantId: 'portable',
    })
    // the honest boundary statements: the gate's profile notice + the browser backend's origin notice
    expect(result.diagnostics.map(d => d.code)).toContain('x3.host/worker-shared-process')
    expect(diagnostics.some(d => d.code === 'x3.host/worker-shared-origin')).toBe(true)
    expect(result.diagnostics.map(d => d.code)).not.toContain('x3.host/full-process-authority')
    // one module worker per activation, spawned from the served entry
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toContain(`${ORIGIN}worker-entry.js`)
    // artifact files were fetched from the app origin, each exactly once
    const codecFetches = site.fetched.filter(url => url.includes('/extensions/images/'))
    expect(new Set(codecFetches).size).toBe(codecFetches.length)
    expect(codecFetches.length).toBeGreaterThan(0)

    const tree = await result.session.dataSource('common.view/tree-data-source', 1)
    const root = await (tree.value as { root(): Promise<{ id: string }> }).root()
    expect(typeof root.id).toBe('string')
    await tree.release()
    await result.session.dispose()

    /*
     * Block 14C: use the exact shared fixture rows this repository runs through CLI, Electron,
     * automation and VS Code. The current PWA artifact catalog honestly carries the PNG vertical
     * but not the game-specific BIG extension (14D packaging is owner-gated), so only the four PNG
     * rows can be claimed here; the two archive rows remain named rather than fabricated.
     */
    const picked = pickedFile(png, 'favicon-32.png')
    const authority = services.commands.authorize({
      access: picked.access,
      entry: picked.entry,
      request: {
        intent: 'full',
        grant: { id: 'pwa-command-fixtures', classes: ['read-source'] },
        budget,
      },
    })
    expect(services.commands.catalog).toMatchObject({
      schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
      commands: expect.arrayContaining([
        expect.objectContaining({ id: 'subject.open', callers: expect.arrayContaining(['pwa']) }),
      ]),
    })
    const pwaFixtures = COMMAND_FIXTURES.filter(fixture => fixture.subject === 'png')
    expect(pwaFixtures).toHaveLength(4)
    for (const fixture of pwaFixtures) {
      const receipt = await services.commands.execute(
        commandRequest(fixture.command, { subject: authority.ref }),
        { runId: `pwa-fixture:${fixture.id}` },
      )
      const verdict = checkCommandFixture(fixture, receipt.result)
      expect(verdict, `${fixture.id}: ${fixture.proves} — ${verdict.note ?? ''}`).toMatchObject({
        passed: true,
      })
    }
    expect(authority.revoke()).toBe(true)
    const refused = await services.commands.execute(
      commandRequest('subject.open', { subject: authority.ref }),
    )
    expect(refused.result).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/not authorized/u),
    })
  }, 30_000)

  it('opens all six codecs from the combined data extension in the browser worker topology', async () => {
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog,
      identity,
      probe,
      dom: {
        fetch: diskOrigin().fetch,
        subtle: webcrypto.subtle as never,
        Blob: FakeBlob as never,
        objectUrls,
        Worker: FakeWorker,
        MessageChannel: MessageChannel as never,
      },
      moduleMap: nodeModuleMap,
    })
    const samples = [
      ['sample.csv', 'x,y\n1,2\n', 'modkit/text-csv'],
      ['sample.tsv', 'x\ty\n1\t2\n', 'modkit/text-tsv'],
      ['sample.ini', '[x]\ny=1\n', 'modkit/text-ini'],
      ['sample.toml', 'x = 1\n', 'modkit/text-toml'],
      ['sample.xml', '<x value="1"/>', 'modkit/text-xml'],
      ['sample.yaml', 'x: 1\n', 'modkit/text-yaml'],
    ] as const
    for (const [path, text, codecId] of samples) {
      const result = await services.open({
        source: textSource(path, text),
        path,
        intent: 'full',
        grant: { id: 'pwa-data-open', classes: ['read-source'] },
        budget,
      })
      expect(result.state, `${path}: ${JSON.stringify(result)}`).toBe('opened')
      if (result.state !== 'opened') throw new Error(`${path}: ${result.reason}`)
      expect(result.selected.contributionId).toBe(codecId)
      expect(await result.session.operations().invoke('parse', {})).toMatchObject({ state: 'ok' })
      await result.session.dispose()
    }
    await services.dispose()
  }, 60_000)

  it('ships and opens the common UVM model extension with its UV and Scene worker dependencies', async () => {
    expect(catalog.extensions.some(entry => entry.name === 'models')).toBe(true)
    expect(catalog.excluded.some(entry => entry.name === 'models')).toBe(false)
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog,
      identity,
      probe,
      dom: {
        fetch: diskOrigin().fetch,
        subtle: webcrypto.subtle as never,
        Blob: FakeBlob as never,
        objectUrls,
        Worker: FakeWorker,
        MessageChannel: MessageChannel as never,
      },
      moduleMap: nodeModuleMap,
    })
    const fixture = Buffer.from(
      readFileSync(
        join(
          repositoryRoot,
          'packages',
          'testkit',
          'test',
          'fixtures',
          'uvm',
          'm3-triangle.uvm.glb.b64',
        ),
        'utf8',
      ).trim(),
      'base64',
    )
    const result = await services.open({
      source: byteSource('triangle.uvm', fixture),
      path: 'triangle.uvm',
      intent: 'full',
      grant: { id: 'pwa-model-open', classes: ['read-source'] },
      budget,
    })
    expect(result.state, JSON.stringify(result)).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'modkit/model-uvm',
      variantId: 'portable',
    })
    expect(result.descriptor.dataSources).toContainEqual({
      contract: 'common.view/model-scene-source',
      major: 1,
    })
    const scene = await result.session.dataSource('common.view/model-scene-source', 1)
    expect(await (scene.value as { info(): Promise<{ primitives: number }> }).info()).toMatchObject(
      {
        primitives: 1,
      },
    )
    await scene.release()
    await result.session.dispose()
    await services.dispose()
  }, 30_000)

  it('a served artifact that drifted from the attestation is refused at load, not silently run', async () => {
    const site = diskOrigin()
    const tampered = {
      ...catalog,
      extensions: catalog.extensions.map(entry =>
        entry.name === 'images'
          ? {
              ...entry,
              artifact: {
                ...entry.artifact,
                fileDigests: Object.fromEntries(
                  Object.entries(entry.artifact.fileDigests).map(([path, digest]) => [
                    path,
                    path.endsWith('codec.js') ? sha256(new Uint8Array([1, 2, 3])) : digest,
                  ]),
                ),
              },
            }
          : entry,
      ),
    } as WebExtensionCatalog
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog: { schemaVersion: 1, extensions: [], excluded: [] },
      additionalCatalogs: [{ catalog: tampered, baseUrl: ORIGIN }],
      identity,
      probe,
      dom: {
        fetch: site.fetch,
        subtle: webcrypto.subtle as never,
        Blob: FakeBlob as never,
        objectUrls,
        Worker: FakeWorker,
        MessageChannel: MessageChannel as never,
      },
      moduleMap: nodeModuleMap,
    })
    const native = services.main.inventory.extensions.filter(
      extension => extension.source === 'native:core/text',
    )
    const builtins = services.main.inventory.extensions.filter(extension =>
      extension.source.startsWith('builtin:'),
    )
    const supplied = services.main.inventory.extensions.filter(
      extension =>
        extension.source !== 'native:core/text' && !extension.source.startsWith('builtin:'),
    )
    expect(native).toHaveLength(1)
    expect(native[0]?.origin).toBe('bundled')
    expect(builtins.map(extension => extension.source).sort()).toEqual([
      'builtin:modkit/code',
      'builtin:modkit/scene',
      'builtin:modkit/uv',
    ])
    expect(builtins.every(extension => extension.origin === 'bundled')).toBe(true)
    expect(supplied.length).toBeGreaterThan(0)
    expect(supplied.every(extension => extension.origin === 'installed')).toBe(true)
    const result = await services.open({
      source: fileSource(join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'), 'x.png'),
      path: 'x.png',
      intent: 'full',
      grant: { id: 'pwa-tamper', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('tampered artifact must not open')
    const png = result.candidates.find(
      item => item.contributionId === 'modkit/image-png' && item.variantId === 'portable',
    )
    expect(png?.state).toBe('rejected')
    expect(png?.diagnostics.map(item => item.code)).toContain('x3.host/artifact-digest-mismatch')
    // and the trusted-node variant is refused for the honest reason: no in-page boundary here
    const trusted = result.candidates.find(
      item => item.contributionId === 'modkit/image-png' && item.variantId === 'trusted-node',
    )
    expect(trusted?.diagnostics.map(item => item.code)).toContain(
      'x3.host/codec-execution-unavailable',
    )
    // no worker ever evaluated the drifted bytes
    expect(spawned).toHaveLength(0)
  }, 30_000)
})
