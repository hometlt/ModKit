/**
 * Extension roots: what is discovered, what is refused, and — the part that matters — that a root
 * which is not an extension is *reported* rather than swallowed or fatal.
 *
 * The discovery rules are pure over a probe, so they are asserted against a fake filesystem. The
 * reporting is asserted against the real loader and a real temporary directory, because "reported"
 * is a property of `loadExtensionRoots`' answer travelling all the way into the host's report.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  configuredExtensionRoots,
  dedupeRoots,
  discoverCatalogRoots,
  discoverWorkspaceRoots,
  looksLikeExtensionDirectory,
  type DirectoryProbe,
} from '../src/extension-roots.js'
import { createVsCodeSubjectHost } from '../src/host.js'

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
