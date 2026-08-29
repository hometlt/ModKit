/**
 * S12-web: a user's own extension folders in the browser, proven in Node against structural fakes.
 *
 * The fakes are only the File System Access surface — a directory handle over an in-memory tree
 * read from `extensions/**`, so the containers, the contribution manifests and the codec sources
 * are the real ones. Everything else is production code: the real loader, the real inventory, the
 * real gate, the real verified loader and the real browser worker entry.
 *
 * What is asserted here is the whole claim the feature makes: that a picked folder loads with the
 * right coordinate and the same digests Node computes, that a folder which is not an extension is
 * refused by name, that a conflict keeps the first claimant, that a file changed after it was
 * hashed cannot become the thing that runs, that the in-process flag is refused, that the read is
 * bounded, and that a lapsed grant stays visible instead of vanishing.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModkitError } from '@modkitx-x3/core'
import { commandRequest } from '@modkitx-x3/host'
import { loadVerifiedModuleGraph } from '@modkitx-x3/host/browser'
import { proves } from '@modkitx-x3/testkit'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import {
  EXTENSION_ROOT_FAILURE_CODES,
  loadUserExtensionRoots,
  USER_EXTENSION_ARTIFACT_ORIGIN,
  userExtensionArtifactRoot,
  type LoadedUserExtensionRoots,
  type UserExtensionRootRequest,
  type WebExtensionDirectoryHandle,
  type WebPermissionState,
} from '../src/extension-roots.js'
import { createDirectoryAccess, type WebFileHandleLike } from '../src/files.js'
import {
  catalogCoordinates,
  createWebSubjectServices,
  type WebExtensionCatalog,
} from '../src/subjects.js'
import {
  budget,
  diskOrigin,
  domGlobals,
  fileSource,
  identity,
  nodeModuleMap,
  ORIGIN,
  probe,
  repositoryRoot,
  spawned,
} from './browser-harness.js'

const subtle = webcrypto.subtle as never
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ---------------------------------------------------------------------------------------------
// a File System Access tree, backed by bytes this test can rewrite

/** Posix path relative to the granted folder → its current bytes. */
type FakeTree = Map<string, Uint8Array>

/** Reads a real extension directory into a tree, skipping exactly what the Node loader skips. */
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

interface GrantOptions {
  readonly permission?: WebPermissionState
  readonly onRequest?: () => WebPermissionState
}

/**
 * A directory handle over the tree. Children are yielded in map order — deliberately unsorted, so
 * the loader's own ordering is what the digest parity below actually proves.
 */
function directoryHandle(
  name: string,
  files: FakeTree,
  prefix = '',
  grant: GrantOptions = {},
): WebExtensionDirectoryHandle {
  const permission = grant.permission
  const scope = prefix === '' ? '' : `${prefix}/`
  const base: WebExtensionDirectoryHandle = {
    kind: 'directory',
    name,
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
        const child =
          slash === -1
            ? fileHandle(childName, childPath, files)
            : directoryHandle(childName, files, childPath, grant)
        yield [childName, child] as const
      }
    },
  }
  if (permission === undefined) return base
  return {
    ...base,
    queryPermission: async () => permission,
    requestPermission: async () => grant.onRequest?.() ?? permission,
  }
}

const imagesRoot = join(repositoryRoot, 'extensions', 'common', 'images')
const textIniRoot = join(repositoryRoot, 'extensions', 'common', 'text-ini')

const request = (
  id: string,
  handle: WebExtensionDirectoryHandle,
  expectedId?: string,
): UserExtensionRootRequest =>
  expectedId === undefined ? { id, handle } : { id, handle, expectedId }

const load = async (
  requests: readonly UserExtensionRootRequest[],
  extra: Partial<{ claimed: readonly string[]; maxFiles: number; maxTotalBytes: number }> = {},
): Promise<LoadedUserExtensionRoots> => loadUserExtensionRoots(requests, { subtle, ...extra })

function authoredTree(
  packageName: string,
  id: string,
  exports: Readonly<Record<string, string>>,
  files: Readonly<Record<string, string>>,
): FakeTree {
  return new Map([
    [
      'package.json',
      encoder.encode(
        JSON.stringify({
          name: packageName,
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
    ],
    ...Object.entries(files).map(([path, source]) => [path, encoder.encode(source)] as const),
  ])
}

afterEach(() => {
  spawned.splice(0)
})

// ---------------------------------------------------------------------------------------------

describe('user extension folders — loading', () => {
  it('derives a multi-root module map and verifies a cross-root bare import', async () => {
    const dependency = authoredTree(
      'example-dependency',
      'dependency',
      { './value': './src/value.js' },
      { 'src/value.js': 'export const answer = 42' },
    )
    const consumer = authoredTree(
      'example-consumer',
      'consumer',
      { '.': './src/index.js' },
      {
        'src/index.js':
          "import { answer } from 'example-dependency/value'; export const result = answer + 1",
      },
    )
    const loaded = await load([
      request('dependency', directoryHandle('dependency', dependency)),
      request('consumer', directoryHandle('consumer', consumer)),
    ])

    expect(loaded.failures).toEqual([])
    expect(Object.keys(loaded.moduleMap).sort()).toEqual([
      'example-consumer',
      'example-dependency/value',
    ])
    const consumerInput = loaded.inputs[loaded.rootIds.indexOf('consumer')]
    if (consumerInput === undefined) throw new Error('consumer root did not load')
    if (consumerInput.artifact.fileDigests === undefined) {
      throw new Error('consumer root did not expose verified file digests')
    }
    const graph = await loadVerifiedModuleGraph('./src/index.js', {
      artifactRoot: consumerInput.artifact.artifactRoot.href,
      fileDigests: consumerInput.artifact.fileDigests,
      fetchBytes: async url => {
        const response = await loaded.serve(url)
        if (!response.ok) throw new Error(`404 ${url}`)
        return new Uint8Array(await response.arrayBuffer())
      },
      digest: async bytes => {
        const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))
        return `sha256:${Buffer.from(hash).toString('hex')}`
      },
      createModuleUrl: source =>
        `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`,
      resolveBare: specifier => loaded.moduleMap[specifier],
      resolvePinned: url =>
        loaded.verifiedModuleRoots.find(root => url.startsWith(root.artifactRoot)),
    })
    expect(graph.unverified).toEqual([])
    expect([...graph.verified].sort()).toEqual(['src/index.js', 'src/value.js'])
    expect(((await import(graph.url)) as { readonly result: number }).result).toBe(43)
  })

  it('refuses traversing exports and every claimant of a colliding package specifier', async () => {
    const traversal = authoredTree(
      'example-traversal',
      'traversal',
      { '.': '../escape.js' },
      { 'escape.js': 'export {}' },
    )
    const invalid = await load([request('traversal', directoryHandle('traversal', traversal))])
    expect(invalid.inputs).toEqual([])
    expect(invalid.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid)

    const first = authoredTree(
      'example-collision',
      'first',
      { '.': './index.js' },
      {
        'index.js': 'export const owner = 1',
      },
    )
    const second = authoredTree(
      'example-collision',
      'second',
      { '.': './index.js' },
      {
        'index.js': 'export const owner = 2',
      },
    )
    const collision = await load([
      request('first', directoryHandle('first', first)),
      request('second', directoryHandle('second', second)),
    ])
    expect(collision.inputs).toEqual([])
    expect(collision.moduleMap).toEqual({})
    expect(
      collision.failures.filter(
        failure => failure.code === EXTENSION_ROOT_FAILURE_CODES.moduleMapConflict,
      ),
    ).toHaveLength(2)
  })
  it('a real extension folder loads with the right coordinate, and with the digests Node computes', async () => {
    const { loadExtensionDirectory } = await import('@modkitx-x3/host/node')
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))])

    expect(loaded.failures).toEqual([])
    expect(loaded.coordinates).toEqual(['org.modkitx/images'])
    expect(loaded.rootIds).toEqual(['root-images'])
    const input = loaded.inputs[0]
    if (input === undefined) throw new Error('the folder must load')

    // worker-only, always, and not because the caller asked nicely
    expect(input.execution).toEqual({ origin: 'installed', allowTrustedInProcess: false })
    expect(input.artifact.artifactRoot.href).toBe(userExtensionArtifactRoot('root-images'))
    expect(input.artifact.artifactRoot.href.startsWith(USER_EXTENSION_ARTIFACT_ORIGIN)).toBe(true)

    // the page's own measurement agrees, byte for byte, with what the Node loader measures
    const node = await loadExtensionDirectory(imagesRoot)
    expect(input.artifact.artifactDigest).toBe(node.artifact.artifactDigest)
    expect(input.artifact.fileDigests).toEqual(node.artifact.fileDigests)
    expect(input.files).toEqual(node.files)
    expect([...input.documents.keys()].sort()).toEqual([...node.documents.keys()].sort())
    expect([...input.documentDigests.entries()].sort()).toEqual(
      [...node.documentDigests.entries()].sort(),
    )
    // and it is a claim about *these* bytes only: the check is an equality, not an attestation
    expect(input.artifact.verifyArtifactDigest(node.artifact.artifactDigest)).toBe(true)
    expect(input.artifact.verifyArtifactDigest('sha256:00')).toBe(false)
  })

  it('a folder with no authored container is not an extension, and is told so', async () => {
    const files: FakeTree = new Map([
      ['README.md', encoder.encode('# just some notes')],
      ['notes/todo.txt', encoder.encode('buy milk')],
    ])
    const loaded = await load([request('root-notes', directoryHandle('Documents', files))])

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.notAnExtension)
    expect(loaded.failures[0]?.root).toBe('Documents')
    expect(loaded.failures[0]?.rootId).toBe('root-notes')
    expect(loaded.failures[0]?.message).toContain('modkit.extension.json')
  })

  it('two folders claiming one coordinate conflict: the first wins, the second is reported', async () => {
    const first = treeFromDisk(imagesRoot)
    const second = treeFromDisk(imagesRoot)
    const loaded = await load([
      request('root-a', directoryHandle('images', first)),
      request('root-b', directoryHandle('images-copy', second)),
    ])

    expect(loaded.coordinates).toEqual(['org.modkitx/images'])
    expect(loaded.rootIds).toEqual(['root-a'])
    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.coordinateConflict)
    expect(loaded.failures[0]?.rootId).toBe('root-b')
  })

  it('a coordinate already claimed by the bundled catalog is reported, not loaded twice', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))], {
      claimed: catalogCoordinates(WEB_EXTENSION_CATALOG),
    })

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.coordinateConflict)
  })

  it('a folder that no longer declares the coordinate it was added under is a mismatch', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([
      request('root-images', directoryHandle('images', files), 'org.modkitx/text-ini'),
    ])

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.identityMismatch)
    expect(loaded.failures[0]?.message).toContain('org.modkitx/images')
  })

  it('one broken folder never takes out the others', async () => {
    const broken: FakeTree = new Map([['package.json', encoder.encode('{ not json')]])
    const loaded = await load([
      request('root-broken', directoryHandle('broken', broken)),
      request('root-images', directoryHandle('images', treeFromDisk(imagesRoot))),
      request('root-ini', directoryHandle('text-ini', treeFromDisk(textIniRoot))),
    ])

    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.unreadable)
    expect(loaded.failures[0]?.message).toContain('package.json is not valid JSON')
    expect(loaded.coordinates).toEqual(['org.modkitx/images', 'org.modkitx/text-ini'])
  })
})

describe('user extension folders — bounds', () => {
  it('a folder over the file ceiling is refused, and the bound is named', async () => {
    const loaded = await load(
      [request('root-images', directoryHandle('images', treeFromDisk(imagesRoot)))],
      { maxFiles: 3 },
    )

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.tooLarge)
    expect(loaded.failures[0]?.message).toContain('maxFiles=3')
  })

  it('a folder over the byte ceiling is refused, and the bound is named', async () => {
    const loaded = await load(
      [request('root-images', directoryHandle('images', treeFromDisk(imagesRoot)))],
      { maxTotalBytes: 64 },
    )

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.tooLarge)
    expect(loaded.failures[0]?.message).toContain('maxTotalBytes=64')
  })
})

describe('user extension folders — grants', () => {
  it('a handle whose grant lapsed reports "needs permission" and stays in the list', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([
      request('root-images', directoryHandle('images', files, '', { permission: 'prompt' })),
    ])

    expect(loaded.inputs).toEqual([])
    expect(loaded.failures).toHaveLength(1)
    expect(loaded.failures[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.permissionRequired)
    expect(loaded.failures[0]?.rootId).toBe('root-images')
    expect(loaded.failures[0]?.message).toContain('grant it again')
  })

  it('loading never prompts; only an explicit request does', async () => {
    let prompted = 0
    const handle = directoryHandle('images', treeFromDisk(imagesRoot), '', {
      permission: 'prompt',
      onRequest: () => {
        prompted += 1
        return 'granted'
      },
    })
    await load([request('root-images', handle)])
    expect(prompted).toBe(0)

    const { requestUserExtensionPermission } = await import('../src/extension-roots.js')
    expect(await requestUserExtensionPermission(handle)).toBe('granted')
    expect(prompted).toBe(1)
  })

  it('a granted handle loads', async () => {
    const loaded = await load([
      request(
        'root-images',
        directoryHandle('images', treeFromDisk(imagesRoot), '', { permission: 'granted' }),
      ),
    ])
    expect(loaded.coordinates).toEqual(['org.modkitx/images'])
  })
})

describe('user extension folders — trust', () => {
  it('allowTrustedInProcess is refused for a user root, here and not at the gate', async () => {
    await expect(
      loadUserExtensionRoots([], { subtle, allowTrustedInProcess: true }),
    ).rejects.toMatchObject({ code: 'x3.host/extension-trust-misdeclared' })
    await expect(
      loadUserExtensionRoots([], { subtle, allowTrustedInProcess: true }),
    ).rejects.toBeInstanceOf(ModkitError)
  })

  it('allowTrustedInProcess: false is what a well-behaved caller passes, and it loads', async () => {
    const loaded = await loadUserExtensionRoots(
      [request('root-images', directoryHandle('images', treeFromDisk(imagesRoot)))],
      { subtle, allowTrustedInProcess: false },
    )
    expect(loaded.inputs[0]?.execution?.allowTrustedInProcess).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// the whole path: a granted folder, composed, opened worker-brokered

/** The attested catalog minus one extension, so a user folder can supply it instead. */
function catalogWithout(name: string): WebExtensionCatalog {
  return {
    ...WEB_EXTENSION_CATALOG,
    extensions: WEB_EXTENSION_CATALOG.extensions.filter(entry => entry.name !== name),
  }
}

async function servicesOverUserFolder(
  loaded: LoadedUserExtensionRoots,
  extra: {
    readonly loaderLimits?: { readonly maxFiles?: number; readonly maxTotalBytes?: number }
  } = {},
  catalog: WebExtensionCatalog = catalogWithout('images'),
) {
  const site = diskOrigin()
  return createWebSubjectServices({
    baseUrl: ORIGIN,
    catalog,
    userExtensions: loaded,
    identity,
    probe,
    dom: domGlobals(site.fetch),
    moduleMap: nodeModuleMap,
    ...extra,
  })
}

describe('user extension folders — the whole path', () => {
  it('protects bundled platform specifiers by refusing the exporting external root', async () => {
    const spoofed = authoredTree(
      '@modkitx-x3/core',
      'platform-spoof',
      { '.': './index.js' },
      {
        'index.js': 'export const spoofed = true',
      },
    )
    const loaded = await load([request('platform-spoof', directoryHandle('spoof', spoofed))])
    expect(loaded.inputs).toHaveLength(1)
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog: { schemaVersion: 1, extensions: [], excluded: [] },
      userExtensions: loaded,
      identity,
      probe,
      dom: domGlobals(diskOrigin().fetch),
      moduleMap: nodeModuleMap,
      serviceDefinitions: false,
    })
    expect(services.supportedExtensions).toEqual([])
    expect(services.userExtensionConflicts).toEqual([
      expect.objectContaining({
        rootId: 'platform-spoof',
        code: EXTENSION_ROOT_FAILURE_CODES.moduleMapConflict,
      }),
    ])
    await services.dispose()
  })

  it('a granted folder supplies a real codec: worker-brokered, from bytes verified against the digests this page took', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))])
    const services = await servicesOverUserFolder(loaded)

    expect(services.userExtensionConflicts).toEqual([])
    expect(services.executionProfiles).toEqual(['worker-brokered'])
    expect(services.supportedExtensions).toContain('png')

    const result = await services.open({
      source: fileSource(join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'), 'i.png'),
      path: 'i.png',
      intent: 'full',
      grant: { id: 'user-root-open', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    // it really ran in a worker, and the page thread never got the option
    expect(spawned).toHaveLength(1)
    expect(result.diagnostics.map(item => item.code)).not.toContain(
      'x3.host/full-process-authority',
    )
    await result.session.dispose()
  }, 30_000)

  it('opens the pinned SC2Map from a selected content folder through a user extension folder', async () => {
    const starcraft2Root = join(repositoryRoot, '..', 'modkit-blizzard', 'starcraft2')
    const mpqRoot = join(repositoryRoot, '..', 'modkit-blizzard', 'mpq')
    const loaded = await load([
      request('root-mpq', directoryHandle('mpq', treeFromDisk(mpqRoot))),
      request('root-starcraft2', directoryHandle('starcraft2', treeFromDisk(starcraft2Root))),
    ])
    expect(loaded.failures).toEqual([])
    expect(loaded.coordinates).toEqual([
      'org.modkitx.blizzard/mpq',
      'org.modkitx.blizzard/starcraft2',
    ])
    const services = await servicesOverUserFolder(loaded, {}, WEB_EXTENSION_CATALOG)

    const content: FakeTree = new Map([
      [
        'minimal.SC2Map',
        new Uint8Array(
          readFileSync(
            join(
              repositoryRoot,
              'packages',
              'testkit',
              'test',
              'fixtures',
              'mk2-synthetic',
              'minimal.SC2Map',
            ),
          ),
        ),
      ],
    ])
    const access = createDirectoryAccess(directoryHandle('selected-maps', content))
    const entries = await access.list(undefined)
    expect(entries.map(entry => entry.id)).toEqual(['minimal.SC2Map'])
    const entry = entries[0]
    if (entry === undefined) throw new Error('the selected folder lost its SC2Map')
    const authority = services.commands.authorize({
      access,
      entry,
      request: {
        intent: 'full',
        grant: { id: 'pwa-sc2-selected-folder', classes: ['read-source'] },
        budget,
      },
    })
    const receipt = await services.commands.execute(
      commandRequest('subject.open', { subject: authority.ref }),
      { runId: 'pwa-sc2-selected-folder' },
    )
    expect(receipt.result).toMatchObject({
      state: 'ok',
      command: 'subject.open',
      data: {
        state: 'opened',
        selected: {
          contributionId: 'org.modkitx/sc2-map',
          variantId: 'portable',
        },
        formatId: 'sc2-map',
      },
    })
    expect(spawned.length).toBeGreaterThan(0)
    expect(spawned.every(worker => worker.includes(`${ORIGIN}worker-entry.js`))).toBe(true)
    proves({
      capabilityId: 'format/sc2-map/open-inspect',
      operation: 'read',
      note: 'the PWA opens the pinned packed SC2Map through selected-folder authority and a user extension root',
    })
    expect(authority.revoke()).toBe(true)
    await services.commands.dispose()
  }, 30_000)

  it('selects the semantic SC2Campaign codec from selected content and extension folders', async () => {
    const starcraft2Root = join(repositoryRoot, '..', 'modkit-blizzard', 'starcraft2')
    const loaded = await load([
      request('root-starcraft2', directoryHandle('starcraft2', treeFromDisk(starcraft2Root))),
    ])
    const services = await servicesOverUserFolder(loaded, {}, WEB_EXTENSION_CATALOG)
    const name = 'minimal.SC2Campaign'
    const content: FakeTree = new Map([
      [
        name,
        new Uint8Array(
          readFileSync(
            join(repositoryRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic', name),
          ),
        ),
      ],
    ])
    const access = createDirectoryAccess(directoryHandle('selected-campaigns', content))
    const entries = await access.list(undefined)
    const entry = entries[0]
    if (entry === undefined) throw new Error('the selected folder lost its SC2Campaign')
    const authority = services.commands.authorize({
      access,
      entry,
      request: {
        intent: 'full',
        grant: { id: 'pwa-sc2-campaign-selected-folder', classes: ['read-source'] },
        budget,
      },
    })
    const receipt = await services.commands.execute(
      commandRequest('subject.open', { subject: authority.ref }),
      { runId: 'pwa-sc2-campaign-selected-folder' },
    )
    expect(receipt.result).toMatchObject({
      state: 'ok',
      command: 'subject.open',
      data: {
        state: 'opened',
        selected: {
          contributionId: 'org.modkitx/sc2-campaign',
          variantId: 'portable',
        },
        formatId: 'sc2-campaign',
      },
    })
    expect(authority.revoke()).toBe(true)
    await services.commands.dispose()
  }, 30_000)

  it('a file changed after its digest was taken is refused at load, not evaluated', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))])

    // the user (or something else) edits the codec after the page hashed the folder
    const codecPath = 'src/formats/png/codec.js'
    const original = files.get(codecPath)
    if (original === undefined) throw new Error('fixture moved')
    files.set(codecPath, encoder.encode(`${decoder.decode(original)}\n// edited\n`))

    const services = await servicesOverUserFolder(loaded)
    const result = await services.open({
      source: fileSource(join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'), 'i.png'),
      path: 'i.png',
      intent: 'full',
      grant: { id: 'user-root-tamper', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('changed bytes must not open')
    const png = result.candidates.find(
      item => item.contributionId === 'org.modkitx/image-png' && item.variantId === 'portable',
    )
    expect(png?.state).toBe('rejected')
    expect(png?.diagnostics.map(item => item.code)).toContain('x3.host/artifact-digest-mismatch')
    expect(spawned).toHaveLength(0)
  }, 30_000)

  it('a bare specifier outside the host module map is refused with the specifier named', async () => {
    const files = treeFromDisk(imagesRoot)
    const codecPath = 'src/formats/png/codec.js'
    const original = files.get(codecPath)
    if (original === undefined) throw new Error('fixture moved')
    /*
     * The `… from '…'` form on purpose. The bare side-effect form (`import 'left-pad'`) is
     * swallowed by `scanModuleSpecifiers` whenever a later `from` clause exists, so it degrades
     * to a worker-side module-resolution error instead of a named host refusal — fail-closed,
     * but the reason is lost. That is a defect in packages/host/src/browser/verified-loader.ts
     * and is reported there, not papered over here.
     */
    files.set(
      codecPath,
      encoder.encode(`${decoder.decode(original)}\nimport leftPad from 'left-pad'\n`),
    )
    const loaded = await load([request('root-images', directoryHandle('images', files))])

    const services = await servicesOverUserFolder(loaded)
    const result = await services.open({
      source: fileSource(join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'), 'i.png'),
      path: 'i.png',
      intent: 'full',
      grant: { id: 'user-root-bare', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('an unmapped import must not open')
    const png = result.candidates.find(
      item => item.contributionId === 'org.modkitx/image-png' && item.variantId === 'portable',
    )
    expect(png?.diagnostics.map(item => item.code)).toContain('x3.host/execution-load-rejected')
    expect(png?.diagnostics.map(item => item.message).join(' ')).toContain('left-pad')
    expect(spawned).toHaveLength(0)
  }, 30_000)

  it('the verified loader ceilings are reachable from the composition, and refuse by name', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))])
    const services = await servicesOverUserFolder(loaded, {
      loaderLimits: { maxTotalBytes: 64 },
    })

    const result = await services.open({
      source: fileSource(join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png'), 'i.png'),
      path: 'i.png',
      intent: 'full',
      grant: { id: 'user-root-ceiling', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('the ceiling must refuse')
    const png = result.candidates.find(
      item => item.contributionId === 'org.modkitx/image-png' && item.variantId === 'portable',
    )
    expect(png?.diagnostics.map(item => item.message).join(' ')).toContain('ceiling of 64 bytes')
  }, 30_000)

  it('a user folder claiming a bundled coordinate is dropped by the composition and reported', async () => {
    const files = treeFromDisk(imagesRoot)
    // loaded without `claimed`, i.e. by a caller that forgot: the composition still refuses to
    // hold two claimants for one coordinate
    const loaded = await load([request('root-images', directoryHandle('images', files))])
    const site = diskOrigin()
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog: WEB_EXTENSION_CATALOG,
      userExtensions: loaded,
      identity,
      probe,
      dom: domGlobals(site.fetch),
      moduleMap: nodeModuleMap,
    })
    expect(services.userExtensionConflicts).toHaveLength(1)
    expect(services.userExtensionConflicts[0]?.code).toBe('x3.host/extension-coordinate-conflict')
    expect(
      services.main.inventory.extensions.filter(
        extension =>
          `${extension.manifest.publisher}/${extension.manifest.id}` === 'org.modkitx/images',
      ),
    ).toHaveLength(1)
  })
})

describe('user extension folders — the synthetic byte source', () => {
  it('serves only the folders that loaded, and only their own files', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))])
    const root = userExtensionArtifactRoot('root-images')

    const served = await loaded.serve(`${root}package.json`)
    expect(served.ok).toBe(true)
    expect(JSON.parse(decoder.decode(new Uint8Array(await served.arrayBuffer())))).toMatchObject({
      modkit: { publisher: 'org.modkitx', id: 'images' },
    })

    expect((await loaded.serve(`${root}nope.js`)).status).toBe(404)
    expect((await loaded.serve(`${userExtensionArtifactRoot('other')}package.json`)).status).toBe(
      404,
    )
    expect((await loaded.serve('https://pwa.example/app/main.js')).status).toBe(404)
  })

  it('re-reads through the handle, so what the loader hashes is what the folder holds now', async () => {
    const files = treeFromDisk(imagesRoot)
    const loaded = await load([request('root-images', directoryHandle('images', files))])
    const root = userExtensionArtifactRoot('root-images')

    files.set('README.md', encoder.encode('changed'))
    const served = await loaded.serve(`${root}README.md`)
    expect(decoder.decode(new Uint8Array(await served.arrayBuffer()))).toBe('changed')
  })
})
