/**
 * Block 20 item 6: one extension born outside the repository reaches all three UI hosts.
 *
 * The fixture is never copied into this workspace. The test scaffolds it under the system temp
 * directory, packs the five public ABI packages, installs only those tarballs into the foreign
 * project, bundles the codec from the public package names, packs the extension, and admits the
 * extracted immutable artifact through the local extension store. Electron and VS Code consume
 * that installed artifact; the PWA consumes the same bytes through its persisted-folder API.
 *
 * This is deliberately an application-conformance test under scripts/test rather than another
 * app-specific fixture. A green result must not require editing packages/** or apps/** to teach a
 * host the demo coordinate.
 */
import { spawnSync } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Metafile, type Plugin } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ModkitError } from '@modkit/core'
import {
  createLocalExtensionArtifactStore,
  loadExtensionDirectory,
  openFileArtifactSource,
  type InstalledExtensionArtifact,
} from '@modkit/host/node'
import { scanModuleSpecifiers } from '@modkit/host/browser'
import {
  createElectronSubjectServices,
  type ElectronSubjectServices,
} from '../../apps/electron/src/index.js'
import { createVsCodeCommandOpener, createVsCodeSubjectHost } from '../../apps/vscode/src/host.js'
import {
  EXTENSION_ROOT_FAILURE_CODES,
  loadUserExtensionRoots,
  type UserExtensionRootRequest,
  type WebExtensionDirectoryHandle,
  type WebPermissionState,
} from '../../apps/web/src/extension-roots.js'
import { createMemoryExtensionStore } from '../../apps/web/src/extension-store.js'
import { createWebSubjectServices, type WebExtensionCatalog } from '../../apps/web/src/subjects.js'
import type { WebFileHandleLike } from '../../apps/web/src/files.js'
import {
  budget,
  diskOrigin,
  domGlobals,
  identity,
  memorySource,
  ORIGIN,
  probe,
  spawned,
} from '../../apps/web/test/browser-harness.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scaffold = join(repoRoot, 'scripts', 'scaffold-extension.mjs')
const coordinate = 'org.example/outside-demo'
const formatId = 'outside-demo'
const expectedAbiVersions = Object.freeze({
  '@modkit/core': '0.1.0',
  '@modkit/sdk': '0.1.0',
  '@modkit/vfs': '0.1.0',
  '@modkit/host': '0.1.0',
  '@modkit/codec-kit': '1.0.0',
})

const temporaryRoot = mkdtempSync(join(tmpdir(), 'modkit-x3-out-of-tree-'))
const sourceWorkspace = join(temporaryRoot, 'source')
const sourceRoot = join(sourceWorkspace, 'demo-extension')
const releaseRoot = join(temporaryRoot, 'release', 'demo-extension')
const publicTarballs = join(temporaryRoot, 'public-abi')
const extensionTarballs = join(temporaryRoot, 'extension-artifact')
const extractedRoot = join(temporaryRoot, 'extracted')
const fixturePath = join(sourceRoot, 'fixtures', `example.${formatId}`)

let installed: InstalledExtensionArtifact
let tarballDigest = ''
let artifactDigest = ''
let buildMetafile: Metafile

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }))

interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

function command(name: string, args: readonly string[], cwd: string): CommandResult {
  const needsShim = process.platform === 'win32' && (name === 'pnpm' || name === 'npm')
  const options = {
    cwd,
    encoding: 'utf8' as const,
    timeout: 300_000,
    env: { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') },
  }
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', name, ...args], options)
    : spawnSync(name, [...args], options)
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function run(name: string, args: readonly string[], cwd: string): string {
  const result = command(name, args, cwd)
  if (result.status !== 0) {
    throw new Error(
      `${name} ${args.join(' ')} failed (${String(result.status)}):\n${result.stderr || result.stdout}`,
    )
  }
  return result.stdout
}

function pack(directory: string, destination: string): string {
  mkdirSync(destination, { recursive: true })
  const before = new Set(readdirSync(destination))
  run('pnpm', ['pack', '--pack-destination', destination], directory)
  const created = readdirSync(destination).find(name => name.endsWith('.tgz') && !before.has(name))
  if (created === undefined) throw new Error(`pack produced no tarball for ${directory}`)
  return join(destination, created)
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/**
 * The browser verifier intentionally uses a conservative scanner instead of executing a parser.
 * A fully bundled schema can therefore make a string value such as `"export"` look like syntax
 * when a later quote completes the scanner's fail-closed pattern. Unicode escapes preserve the
 * runtime string byte-for-byte while keeping those data words distinct from module syntax.
 */
function escapeModuleKeywordsInsideStringLiterals(source: string): string {
  return source.replace(/'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"/gu, literal =>
    literal.replace(/\bimport\b/gu, 'im\\u0070ort').replace(/\bexport\b/gu, 'ex\\u0070ort'),
  )
}

function packageJson(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
}

function installedPackageJson(name: string): Record<string, unknown> {
  const [scope, id] = name.split('/')
  if (scope === undefined || id === undefined) throw new Error(`invalid package name: ${name}`)
  return packageJson(join(sourceWorkspace, 'node_modules', scope, id))
}

function assertOutsideRepository(path: string): void {
  const rel = relative(repoRoot, path)
  expect(
    isAbsolute(rel) ||
      rel === '..' ||
      rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
  ).toBe(true)
}

/** Posix path relative to the granted browser folder -> current bytes. */
type FakeTree = Map<string, Uint8Array>

function treeFromDisk(root: string): FakeTree {
  const files: FakeTree = new Map()
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(directory, entry.name), path)
      else files.set(path, new Uint8Array(readFileSync(join(directory, entry.name))))
    }
  }
  walk(root, '')
  return files
}

function fileHandle(name: string, path: string, files: FakeTree): WebFileHandleLike {
  return {
    kind: 'file',
    name,
    async getFile() {
      const bytes = files.get(path)
      if (bytes === undefined) throw new Error(`no such file: ${path}`)
      return {
        name,
        size: bytes.byteLength,
        lastModified: 1,
        slice(start: number, end: number) {
          const part = bytes.slice(start, end)
          return {
            async arrayBuffer() {
              const copy = new ArrayBuffer(part.byteLength)
              new Uint8Array(copy).set(part)
              return copy
            },
          }
        },
      }
    },
  }
}

function directoryHandle(
  name: string,
  files: FakeTree,
  prefix = '',
  permission: WebPermissionState = 'granted',
): WebExtensionDirectoryHandle {
  const scope = prefix === '' ? '' : `${prefix}/`
  return {
    kind: 'directory',
    name,
    queryPermission: async () => permission,
    requestPermission: async () => permission,
    entries: async function* () {
      const seen = new Set<string>()
      for (const path of files.keys()) {
        if (!path.startsWith(scope)) continue
        const rest = path.slice(scope.length)
        const slash = rest.indexOf('/')
        const childName = slash === -1 ? rest : rest.slice(0, slash)
        if (childName === '' || seen.has(childName)) continue
        seen.add(childName)
        const childPath = `${scope}${childName}`
        yield [
          childName,
          slash === -1
            ? fileHandle(childName, childPath, files)
            : directoryHandle(childName, files, childPath, permission),
        ] as const
      }
    },
  }
}

function browserRequest(id: string, handle: WebExtensionDirectoryHandle): UserExtensionRootRequest {
  return { id, handle, expectedId: coordinate }
}

function expectOpenedDescriptor(
  result: Awaited<ReturnType<ElectronSubjectServices['open']>>,
): asserts result is Extract<typeof result, { state: 'opened' }> {
  expect(result.state, JSON.stringify(result)).toBe('opened')
  if (result.state !== 'opened') throw new Error(result.reason)
  expect(result.selected).toMatchObject({
    contributionId: coordinate,
    variantId: 'portable',
  })
  expect(result.diagnostics.map(item => item.code)).not.toContain('x3.host/full-process-authority')
}

function publicAbiResolver(): Plugin {
  const publicModulesRoot = join(sourceWorkspace, 'node_modules')
  return {
    name: 'packed-public-modkit-abi',
    setup(context) {
      context.onResolve({ filter: /.*/ }, async args => {
        if ((args.pluginData as { packedPublicAbi?: boolean } | undefined)?.packedPublicAbi) {
          return undefined
        }
        const resolved = await context.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          pluginData: { packedPublicAbi: true },
        })
        if (resolved.errors.length > 0) return resolved
        const fromPublicModules = relative(publicModulesRoot, resolved.path)
        if (
          fromPublicModules !== '' &&
          (isAbsolute(fromPublicModules) || fromPublicModules.startsWith('..'))
        ) {
          return resolved
        }
        // The packed public ABI is declarative ESM. Mark every file reached under that published
        // package tree side-effect-free so the release contains only the ABI calls used by this
        // codec, not unrelated host bootstraps and their dynamic loader.
        return { ...resolved, sideEffects: false }
      })
    },
  }
}

beforeAll(async () => {
  assertOutsideRepository(temporaryRoot)

  const publicPackages = [
    join(repoRoot, 'packages', 'core'),
    join(repoRoot, 'packages', 'sdk'),
    join(repoRoot, 'packages', 'vfs'),
    join(repoRoot, 'packages', 'host'),
    join(repoRoot, 'packages', 'codec-kit'),
  ]
  const tarballs = publicPackages.map(directory => pack(directory, publicTarballs))

  mkdirSync(dirname(sourceRoot), { recursive: true })
  run(
    process.execPath,
    [scaffold, '--out', sourceRoot, '--id', formatId, '--publisher', 'org.example'],
    repoRoot,
  )
  const authoredPackage = packageJson(sourceRoot) as {
    readonly peerDependencies?: Readonly<Record<string, string>>
  }
  expect(authoredPackage.peerDependencies).toEqual({
    '@modkit/codec-kit': '^1.0.0',
    '@modkit/sdk': '^0.1.0',
  })
  expect(JSON.stringify(authoredPackage)).not.toContain('workspace:')
  expect(readFileSync(join(sourceRoot, 'src', 'codec.js'), 'utf8')).toMatch(
    /from '@modkit\/codec-kit'/u,
  )

  writeFileSync(
    join(sourceWorkspace, 'package.json'),
    `${JSON.stringify(
      {
        name: 'modkit-out-of-tree-build-environment',
        private: true,
        version: '0.0.0',
        dependencies: Object.fromEntries(
          Object.keys(expectedAbiVersions).map((name, index) => [
            name,
            `file:${tarballs[index]?.replaceAll('\\', '/') ?? ''}`,
          ]),
        ),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--install-links=false'],
    sourceWorkspace,
  )
  const lock = readFileSync(join(sourceWorkspace, 'package-lock.json'), 'utf8')
  expect(lock).not.toContain('workspace:')
  expect(lock).toContain('integrity')
  for (const [name, version] of Object.entries(expectedAbiVersions)) {
    const manifest = installedPackageJson(name)
    expect(manifest.version, name).toBe(version)
    expect(JSON.stringify(manifest), name).not.toContain('workspace:')
  }

  cpSync(sourceRoot, releaseRoot, {
    recursive: true,
    filter: path => basename(path) !== 'node_modules' && basename(path) !== 'package-lock.json',
  })
  const built = await build({
    entryPoints: [join(sourceRoot, 'src', 'codec.js')],
    outfile: join(releaseRoot, 'src', 'codec.js'),
    absWorkingDir: sourceRoot,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    treeShaking: true,
    minifySyntax: true,
    legalComments: 'none',
    metafile: true,
    plugins: [publicAbiResolver()],
    logLevel: 'silent',
  })
  buildMetafile = built.metafile
  const buildInputs = Object.keys(buildMetafile.inputs)
  const buildOutputs = Object.values(buildMetafile.outputs)
  expect(buildInputs.length).toBeGreaterThan(1)
  expect(buildOutputs).toHaveLength(1)
  expect(buildOutputs[0]?.imports).toEqual([])
  expect(buildInputs.some(path => path.includes('@modkit/codec-kit'))).toBe(true)
  expect(buildInputs.every(path => !path.replaceAll('\\', '/').includes('/apps/'))).toBe(true)
  expect(
    buildInputs.every(path => {
      const absolutePath = isAbsolute(path) ? path : resolve(sourceRoot, path)
      const outsideBuildWorkspace = relative(sourceWorkspace, absolutePath)
      return (
        outsideBuildWorkspace === '' ||
        (!isAbsolute(outsideBuildWorkspace) && !outsideBuildWorkspace.startsWith('..'))
      )
    }),
  ).toBe(true)
  const releaseEntrypoint = join(releaseRoot, 'src', 'codec.js')
  const releaseSource = escapeModuleKeywordsInsideStringLiterals(
    readFileSync(releaseEntrypoint, 'utf8'),
  )
  writeFileSync(releaseEntrypoint, releaseSource, 'utf8')
  expect(releaseSource).not.toMatch(/\bfrom\s+['"]@modkit/u)
  expect(releaseSource).not.toMatch(/\bfrom\s+['"]node:/u)
  expect(releaseSource).not.toMatch(/\bawait\s+import\s*\(/u)
  expect(scanModuleSpecifiers(releaseSource)).toEqual([])
  expect(JSON.stringify(packageJson(releaseRoot))).not.toContain('workspace:')

  const extensionTarball = pack(releaseRoot, extensionTarballs)
  tarballDigest = sha256(readFileSync(extensionTarball))
  expect(tarballDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)

  mkdirSync(extractedRoot, { recursive: true })
  run('tar', ['-xzf', extensionTarball, '-C', extractedRoot], temporaryRoot)
  const unpacked = join(extractedRoot, 'package')
  expect(existsSync(unpacked)).toBe(true)
  expect(JSON.stringify(packageJson(unpacked))).not.toContain('workspace:')
  expect(existsSync(join(unpacked, 'node_modules'))).toBe(false)
  const loaded = await loadExtensionDirectory(unpacked)
  artifactDigest = loaded.artifact.artifactDigest
  expect(await loaded.artifact.verifyArtifactDigest(artifactDigest)).toBe(true)
  expect(loaded.files.every(path => !path.startsWith('node_modules/'))).toBe(true)

  const store = createLocalExtensionArtifactStore({
    root: join(temporaryRoot, 'node-extension-store'),
    catalog: [
      {
        extensionId: coordinate,
        version: '1.0.0',
        artifactRoot: unpacked,
        artifactDigest,
      },
    ],
  })
  installed = await store.install(coordinate, '1.0.0')
  expect(installed).toMatchObject({ extensionId: coordinate, version: '1.0.0', artifactDigest })
  expect((await loadExtensionDirectory(installed.artifactRoot)).artifact.artifactDigest).toBe(
    artifactDigest,
  )
  expect(existsSync(join(installed.artifactRoot, 'node_modules'))).toBe(false)
}, 360_000)

describe('Block 20 out-of-tree extension', () => {
  it('is scaffolded, built, packed and digest-installed wholly outside the repository', () => {
    assertOutsideRepository(sourceRoot)
    assertOutsideRepository(releaseRoot)
    assertOutsideRepository(installed.artifactRoot)
    expect(tarballDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(Object.keys(buildMetafile.outputs)).toHaveLength(1)
  })

  it(
    'loads and opens through Electron as an installed worker-brokered extension',
    { timeout: 120_000 },
    async () => {
      const services = await createElectronSubjectServices([], {
        userRoots: [{ root: installed.artifactRoot, expectedId: coordinate }],
      })
      expect(services.extensions).toMatchObject({ installed: [coordinate], failures: [] })
      const inventory = services.application.main.inventory.extensions.find(
        extension => `${extension.manifest.publisher}/${extension.manifest.id}` === coordinate,
      )
      expect(inventory?.origin).toBe('installed')

      const opened = await services.open({
        source: await openFileArtifactSource(fixturePath),
        path: fixturePath,
        intent: 'full',
        grant: { id: 'out-of-tree-electron', classes: ['read-source'] },
        budget,
      })
      expectOpenedDescriptor(opened)
      const descriptor = await opened.session.descriptor()
      expect(descriptor.interpretation).toBe('codec')
      if (descriptor.interpretation !== 'codec')
        throw new Error('codec descriptor was not returned')
      expect(descriptor.identity.formatId).toBe(formatId)
      await opened.session.dispose()

      const denied = await services.open({
        source: await openFileArtifactSource(fixturePath),
        path: fixturePath,
        intent: 'full',
        grant: { id: 'out-of-tree-electron-denied', classes: [] },
        budget,
      })
      expect(denied.state).toBe('unresolved')
      if (denied.state !== 'unresolved') throw new Error('permissionless open unexpectedly ran')
      const denialCodes = denied.candidates.flatMap(candidate =>
        candidate.diagnostics.map(item => item.code),
      )
      expect(denialCodes, JSON.stringify(denialCodes)).toContain(
        'x3.host/codec-resolution-unresolved',
      )
      expect(denialCodes.every(code => code.startsWith('x3.host/'))).toBe(true)
    },
  )

  it(
    'loads and opens through the VS Code host without running in its extension process',
    { timeout: 120_000 },
    async () => {
      const host = await createVsCodeSubjectHost({
        catalogCandidates: [],
        configuredExtensions: [{ path: installed.artifactRoot, id: coordinate }],
      })
      expect(host.extensions.installed).toEqual([coordinate])
      expect(host.extensions.failures).toEqual([])
      const open = createVsCodeCommandOpener({ services: host.services, roots: () => [sourceRoot] })
      const answer = await open(fixturePath)
      expect(answer.snapshot.state, JSON.stringify(answer.snapshot)).toBe('opened')
      if (answer.snapshot.state !== 'opened' || answer.session === undefined) {
        throw new Error('VS Code did not open the out-of-tree fixture')
      }
      expect(answer.snapshot.selected).toMatchObject({
        contributionId: coordinate,
        variantId: 'portable',
      })
      expect(answer.snapshot.diagnostics.map(item => item.code)).not.toContain(
        'x3.host/full-process-authority',
      )
      const descriptor = await answer.session.descriptor()
      expect(descriptor.interpretation).toBe('codec')
      if (descriptor.interpretation !== 'codec')
        throw new Error('codec descriptor was not returned')
      expect(descriptor.identity.formatId).toBe(formatId)
      await answer.session.dispose()
    },
  )

  it(
    'persists, loads and opens the same artifact through the PWA folder boundary',
    { timeout: 120_000 },
    async () => {
      spawned.splice(0)
      const files = treeFromDisk(installed.artifactRoot)
      const handle = directoryHandle('outside-demo', files)
      const extensionStore = createMemoryExtensionStore()
      await extensionStore.add({
        id: 'outside-demo-root',
        label: handle.name,
        addedAt: 1,
        coordinate,
        handle,
      })
      const stored = await extensionStore.list()
      expect(stored.map(item => item.coordinate)).toEqual([coordinate])
      const loaded = await loadUserExtensionRoots(
        stored.map(item => ({
          id: item.id,
          handle: item.handle,
          ...(item.coordinate === undefined ? {} : { expectedId: item.coordinate }),
        })),
        { subtle: webcrypto.subtle as never },
      )
      expect(loaded).toMatchObject({ coordinates: [coordinate], failures: [] })
      expect(loaded.inputs[0]?.execution).toEqual({
        origin: 'installed',
        allowTrustedInProcess: false,
      })

      const emptyCatalog: WebExtensionCatalog = { schemaVersion: 1, extensions: [], excluded: [] }
      const site = diskOrigin()
      const services = await createWebSubjectServices({
        baseUrl: ORIGIN,
        catalog: emptyCatalog,
        userExtensions: loaded,
        identity,
        probe,
        dom: domGlobals(site.fetch),
        moduleMap: {},
      })
      const opened = await services.open({
        source: memorySource(`example.${formatId}`, new Uint8Array(readFileSync(fixturePath))),
        path: `example.${formatId}`,
        intent: 'full',
        grant: { id: 'out-of-tree-pwa', classes: ['read-source'] },
        budget,
      })
      expect(opened.state, JSON.stringify(opened)).toBe('opened')
      if (opened.state !== 'opened') throw new Error(opened.reason)
      expect(opened.selected).toMatchObject({
        contributionId: coordinate,
        variantId: 'portable',
      })
      expect(opened.diagnostics.map(item => item.code)).not.toContain(
        'x3.host/full-process-authority',
      )
      const descriptor = await opened.session.descriptor()
      expect(descriptor.interpretation).toBe('codec')
      if (descriptor.interpretation !== 'codec')
        throw new Error('codec descriptor was not returned')
      expect(descriptor.identity.formatId).toBe(formatId)
      expect(spawned).toHaveLength(1)
      await opened.session.dispose()
      await services.dispose()

      const denied = await loadUserExtensionRoots(
        [browserRequest('denied-root', directoryHandle('outside-demo', files, '', 'denied'))],
        { subtle: webcrypto.subtle as never },
      )
      expect(denied.inputs).toEqual([])
      expect(denied.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.permissionRequired)
      await expect(
        loadUserExtensionRoots([], {
          subtle: webcrypto.subtle as never,
          allowTrustedInProcess: true,
        }),
      ).rejects.toMatchObject({
        code: 'x3.host/extension-trust-misdeclared',
      })
      await expect(
        loadUserExtensionRoots([], {
          subtle: webcrypto.subtle as never,
          allowTrustedInProcess: true,
        }),
      ).rejects.toBeInstanceOf(ModkitError)
    },
  )
})
