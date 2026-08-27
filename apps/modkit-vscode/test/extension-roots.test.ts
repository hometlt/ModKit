/**
 * Extension roots: what is discovered, what is refused, and — the part that matters — that a root
 * which is not an extension is *reported* rather than swallowed or fatal.
 *
 * The discovery rules are pure over a probe, so they are asserted against a fake filesystem. The
 * reporting is asserted against the real loader and a real temporary directory, because "reported"
 * is a property of `loadExtensionRoots`' answer travelling all the way into the host's report.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
import {
  configuredExtensionRoots,
  dedupeRoots,
  discoverCatalogRoots,
  discoverWorkspaceRoots,
  looksLikeExtensionDirectory,
  resolveBundledCatalog,
  type DirectoryProbe,
} from '../src/extension-roots.js'

/** The real filesystem, as the probe shape — for the one assertion that reads the repository. */
const nodeProbe: DirectoryProbe = {
  readDirectory: path => {
    try {
      return readdirSync(path)
    } catch {
      return undefined
    }
  },
  isFile: path => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  readJson: path => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown
    } catch {
      return undefined
    }
  },
  join: (...parts) => join(...parts),
}
import { createVsCodeCommandOpener, createVsCodeSubjectHost } from '../src/host.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const scratches: string[] = []

function scratch(): string {
  const path = mkdtempSync(join(tmpdir(), 'modkit-vscode-roots-'))
  scratches.push(path)
  return path
}

afterAll(() => {
  for (const path of scratches) rmSync(path, { recursive: true, force: true })
})

/**
 * A filesystem described as data: directories map to their entry names, and `files` maps a path
 * either to `null` (it exists, contents irrelevant) or to the JSON it holds.
 */
function fakeProbe(
  tree: Readonly<Record<string, readonly string[]>>,
  files: Readonly<Record<string, unknown>>,
): DirectoryProbe {
  return {
    readDirectory: path => tree[path],
    isFile: path => Object.prototype.hasOwnProperty.call(files, path),
    readJson: path => files[path] ?? undefined,
    join: (...parts) => parts.join('/'),
  }
}

/** The shorthand every fixture below uses for "this directory declares an extension". */
const DECLARES = { modkit: { publisher: 'acme', id: 'thing' } }

describe('catalog discovery', () => {
  it('takes the first candidate that holds any extension and sorts what it finds', () => {
    const probe = fakeProbe(
      {
        '/pkg/extensions': ['images', 'text-json', 'notes'],
        '/repo/extensions/common': ['archives'],
      },
      {
        '/pkg/extensions/images/package.json': DECLARES,
        '/pkg/extensions/text-json/modkit.extension.json': null,
        // an ordinary package that declares nothing — never a candidate
        '/pkg/extensions/notes/package.json': { name: 'notes' },
      },
    )
    expect(discoverCatalogRoots(['/pkg/extensions', '/repo/extensions/common'], probe)).toEqual([
      '/pkg/extensions/images',
      '/pkg/extensions/text-json',
    ])
  })

  it('falls through a candidate that does not exist, and to one that holds nothing usable', () => {
    const probe = fakeProbe(
      { '/pkg/extensions': ['docs'], '/repo/extensions/common': ['archives'] },
      { '/repo/extensions/common/archives/package.json': DECLARES },
    )
    expect(
      discoverCatalogRoots(['/missing', '/pkg/extensions', '/repo/extensions/common'], probe),
    ).toEqual(['/repo/extensions/common/archives'])
  })

  it('answers with nothing rather than guessing when no candidate holds an extension', () => {
    expect(discoverCatalogRoots(['/nowhere'], fakeProbe({}, {}))).toEqual([])
  })

  it('recognises both authored containers, and no ordinary package', () => {
    const probe = fakeProbe(
      {},
      {
        '/a/package.json': DECLARES,
        '/b/modkit.extension.json': null,
        '/c/package.json': { name: 'an-ordinary-project', version: '1.0.0' },
        '/d/readme.md': null,
      },
    )
    expect(looksLikeExtensionDirectory('/a', probe)).toBe(true)
    expect(looksLikeExtensionDirectory('/b', probe)).toBe(true)
    // the rule that keeps every JavaScript workspace out of the extension report
    expect(looksLikeExtensionDirectory('/c', probe)).toBe(false)
    expect(looksLikeExtensionDirectory('/d', probe)).toBe(false)
  })
})

describe('workspace and setting roots', () => {
  it('finds an extension the workspace ships, one level down, and the folder itself', () => {
    const probe = fakeProbe(
      { '/work': ['codecs', 'src'], '/work/codecs': [], '/work/src': [] },
      { '/work/package.json': DECLARES, '/work/codecs/modkit.extension.json': null },
    )
    expect(discoverWorkspaceRoots(['/work'], probe)).toEqual([
      { root: '/work' },
      { root: '/work/codecs' },
    ])
  })

  it('leaves an ordinary project alone, so opening one reports no failed extension at all', () => {
    const probe = fakeProbe(
      { '/work': ['packages', 'src'], '/work/packages': [], '/work/src': [] },
      {
        '/work/package.json': { name: 'someones-app', devDependencies: {} },
        '/work/packages/package.json': { name: 'someones-lib' },
      },
    )
    expect(discoverWorkspaceRoots(['/work'], probe)).toEqual([])
  })

  it('reads the setting in both forms, keeps the expected identity, skips a disabled entry', () => {
    const { roots, problems } = configuredExtensionRoots(
      [
        '/one',
        { path: '/two', id: 'acme/two' },
        { path: '/three', enabled: false },
        { id: 'acme/four' },
        42,
      ],
      path => path,
    )
    expect(roots).toEqual([{ root: '/one' }, { root: '/two', expectedId: 'acme/two' }])
    expect(problems).toEqual([
      'modkit.extensions[3] has no «path»',
      'modkit.extensions[4] is neither a path nor an entry object',
    ])
  })

  it('says so when the setting is not a list at all', () => {
    expect(configuredExtensionRoots({ path: '/one' }, path => path).problems).toEqual([
      'modkit.extensions must be a list of paths or entries',
    ])
  })

  it('keeps the first request when a folder is both scanned and configured', () => {
    expect(dedupeRoots([{ root: '/a', expectedId: 'x/y' }, { root: '/a' }])).toEqual([
      { root: '/a', expectedId: 'x/y' },
    ])
  })
})

describe('a root that is not an extension', () => {
  it('is reported with its reason, and the host still composes', async () => {
    const workspace = scratch()
    const notAnExtension = join(workspace, 'assets')
    mkdirSync(notAnExtension)
    writeFileSync(join(notAnExtension, 'readme.md'), '# just files\n')

    const host = await createVsCodeSubjectHost({
      catalogCandidates: [],
      configuredExtensions: [notAnExtension, join(workspace, 'does-not-exist')],
    })

    const codes = host.extensions.failures.map(failure => failure.code)
    expect(codes).toContain('x3.host/extension-not-an-extension')
    const reported = host.extensions.failures.find(
      failure => failure.code === 'x3.host/extension-not-an-extension',
    )
    expect(reported?.root).toBe(notAnExtension)
    expect(reported?.message).toContain('modkit.extension.json')

    // the unreadable one is reported too, separately, and neither stopped composition
    expect(host.extensions.failures.length).toBe(2)
    expect(host.extensions.bundled).toEqual([])
    expect(host.extensions.installed).toEqual([])
    expect(host.services.host.profile.realmId).toBe('org.modkitx.app.vscode/desktop-extension')
    expect(host.services.workers.profile.target.environment).toBe('node-worker')
  }, 60_000)

  it('reports a directory whose declared identity is not the one the setting expected', async () => {
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [],
      configuredExtensions: [
        {
          path: join(repositoryRoot, 'extensions', 'common', 'text-json'),
          id: 'acme/not-this-one',
        },
      ],
    })
    const failure = host.extensions.failures[0]
    expect(failure?.code).toBe('x3.host/extension-identity-mismatch')
    expect(failure?.message).toContain('acme/not-this-one')
    expect(host.extensions.installed).toEqual([])
  }, 60_000)
})

describe('the VS Code product open path with a configured extension', () => {
  it('opens the pinned SC2Map through configured and workspace roots', async () => {
    const fixtureRoot = join(
      repositoryRoot,
      'packages',
      'testkit',
      'test',
      'fixtures',
      'mk2-synthetic',
    )
    const sc2Map = join(fixtureRoot, 'minimal.SC2Map')
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [],
      configuredExtensions: [join(repositoryRoot, 'extensions', 'blizzard', 'starcraft2')],
    })
    expect(host.extensions.failures).toEqual([])
    expect(host.extensions.installed).toEqual(['org.modkitx.blizzard/starcraft2'])

    const open = createVsCodeCommandOpener({
      services: host.services,
      roots: () => [fixtureRoot],
    })
    const answer = await open(sc2Map)
    expect(answer.snapshot.state).toBe('opened')
    if (answer.snapshot.state !== 'opened' || answer.session === undefined) {
      throw new Error(`the VS Code SC2Map open failed: ${JSON.stringify(answer.snapshot)}`)
    }
    expect(answer.snapshot.selected).toMatchObject({
      contributionId: 'org.modkitx/sc2-map',
      variantId: 'portable',
    })
    const descriptor = answer.snapshot.descriptor as {
      readonly identity: { readonly formatId: string }
      readonly traits: readonly {
        readonly id: string
        readonly parameters?: Readonly<Record<string, unknown>>
      }[]
      readonly dataSources: readonly { readonly contract: string; readonly major: number }[]
    }
    expect(descriptor.identity.formatId).toBe('sc2-map')
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'game.map', parameters: { packed: true, documents: 3 } }),
        expect.objectContaining({ id: 'container.entries', parameters: { count: 5 } }),
        expect.objectContaining({ id: 'content.scripts', parameters: { files: 1 } }),
      ]),
    )
    expect(descriptor.dataSources.map(item => `${item.contract}@${item.major}`).sort()).toEqual([
      'common.view/byte-range-source@1',
      'common.view/namespace-entry-source@1',
      'common.view/tree-data-source@1',
    ])
    proves({
      capabilityId: 'format/sc2-map/open-inspect',
      operation: 'read',
      note: 'VS Code opens the pinned packed SC2Map through configured-extension and workspace roots',
    })
    await answer.session.dispose()
  }, 60_000)
})

describe('the generated catalog decides what this build ships', () => {
  /*
   * Discovery asked the disk what the product contains; the catalog asks the product. The cases
   * below are the two the old scan got wrong: a packaged build whose roots were never copied said
   * nothing at all and composed empty, and a root appearing under `extensions/common` joined the
   * product with no diff anywhere near it.
   */
  const catalog = [
    { name: 'images', directory: 'common/images', declared: true },
    { name: 'models', directory: 'common/models', declared: true },
  ]

  const probeFor = (present: readonly string[]): DirectoryProbe => ({
    readDirectory: () => undefined,
    isFile: path => present.some(item => path === `${item}/package.json`),
    readJson: path =>
      present.some(item => path === `${item}/package.json`) ? { modkit: {} } : undefined,
    join: (...parts) => parts.join('/'),
  })

  it('resolves the named roots under the first candidate that holds any of them', () => {
    const resolution = resolveBundledCatalog(
      catalog,
      ['/packaged/dist-app/extensions', '/checkout/extensions'],
      probeFor(['/checkout/extensions/common/images', '/checkout/extensions/common/models']),
    )
    expect(resolution.roots).toEqual([
      '/checkout/extensions/common/images',
      '/checkout/extensions/common/models',
    ])
    expect(resolution.missing).toEqual([])
    expect(resolution.base).toBe('/checkout/extensions')
  })

  it('names a root the catalog claims and the build does not contain', () => {
    const resolution = resolveBundledCatalog(
      catalog,
      ['/packaged/dist-app/extensions'],
      probeFor(['/packaged/dist-app/extensions/common/images']),
    )
    expect(resolution.roots).toEqual(['/packaged/dist-app/extensions/common/images'])
    // The half that block-9's sixth defect was missing: the absence is reported, not skipped.
    expect(resolution.missing).toEqual(['models'])
  })

  it('reports every root as missing rather than composing an empty catalog in silence', () => {
    const resolution = resolveBundledCatalog(
      catalog,
      ['/packaged/dist-app/extensions'],
      probeFor([]),
    )
    expect(resolution.roots).toEqual([])
    expect(resolution.missing).toEqual(['images', 'models'])
    expect(resolution.base).toBeUndefined()
  })

  it('ships exactly what activation would have discovered — the emitted catalog is not narrower', () => {
    const emitted = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'generated', 'bundled-catalog.json'), 'utf8'),
    ) as { readonly roots: readonly { name: string; declared: boolean }[] }
    const common = join(import.meta.dirname, '..', '..', '..', 'extensions', 'common')
    const onDisk = readdirSync(common)
      .filter(name => looksLikeExtensionDirectory(join(common, name), nodeProbe))
      .sort()
    expect(emitted.roots.map(root => root.name)).toEqual(onDisk)
    /*
     * Every shipped root is now known to the conformance matrix. `uv-materializer` was the one that
     * was not — slice 13C found it and carried it as `declared: false`, and the owner's answer was
     * that the table was behind the fact rather than the catalog being wrong. An undeclared root
     * reappearing here means the same drift has happened again to something else.
     */
    expect(emitted.roots.filter(root => !root.declared).map(root => root.name)).toEqual([])
  })
})
