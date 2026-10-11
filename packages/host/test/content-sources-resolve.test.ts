import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { indexCacheEnabled } from '../../sdk/src/index-caches.js'
import { resolveContentSources } from '../src/node/content-sources.js'

const work = await mkdtemp(join(tmpdir(), 'modkit-content-sources-'))
afterAll(() => rm(work, { recursive: true, force: true }))

/** An extension root whose module answers one root named after the extension and echoes options. */
async function extension(name: string, contentSources: string | undefined): Promise<string> {
  const root = join(work, name)
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      modkit: {
        schemaVersion: 1,
        publisher: 'example',
        id: name,
        contributionManifests: [],
        ...(contentSources === undefined ? {} : { contentSources }),
      },
    }),
  )
  await writeFile(
    join(root, 'dist', 'sources.mjs'),
    `export async function createContentSources(options, context) {
  const noop = async () => {}
  return {
    snapshot: async () => ({ label: ${JSON.stringify(name)}, regions: [], connections: [],
      roots: [{ id: ${JSON.stringify(`${name}:root`)}, label: JSON.stringify(options.installationDirectory ?? null), region: 'local', kind: 'local',
        probes: context?.installationProbes?.name ?? typeof context?.installationProbes,
        credentials: context?.credentials?.name ?? null,
        names: context?.indexCaches?.s2?.names ?? null,
        languages: ['Base.SC2Data/MapScript.galaxy', 'Base.SC2Data/UI/Layout/Hud.SC2Layout', 'Readme.md']
          .map(path => context?.languageFiles?.(path) ?? null), options }] }),
    connect: noop, disconnect: noop, search: async () => [], add: noop, remove: noop, refresh: noop,
    list: async () => [], read: async () => new Uint8Array(), dispose: noop,
  }
}\n`,
  )
  return root
}

describe('the content sources extensions declare', () => {
  it("hands every module the host's language classifier over the inventory's routes", async () => {
    const sc2 = await extension('classified', 'dist/sources.mjs')
    const routes = [
      { languageId: 'galaxy', extension: 'galaxy' },
      { languageId: 'sc2-layout', extension: 'sc2layout' },
    ]
    const sources = await resolveContentSources({ extensionRoots: [sc2], storage: join(work, 'storage'), languageRoutes: routes })
    const root = (await sources?.snapshot())?.roots[0] as { languages?: unknown }
    expect(root.languages).toEqual([
      { languageId: 'galaxy', candidates: ['galaxy'] },
      { languageId: 'sc2-layout', candidates: ['sc2-layout'] },
      { candidates: [] },
    ])
    await sources?.dispose()
    // Without routes a module gets no classifier.
    const plain = await resolveContentSources({ extensionRoots: [sc2], storage: join(work, 'storage') })
    expect(((await plain?.snapshot())?.roots[0] as { languages?: unknown }).languages).toEqual([null, null, null])
    await plain?.dispose()
  })

  it('loads every declared module and composes them, with the options the host gives each', async () => {
    const sc2 = await extension('sc2', 'dist/sources.mjs')
    const roblox = await extension('roblox', './dist/sources.mjs')
    const none = await extension('none', undefined)
    const sources = await resolveContentSources({
      extensionRoots: [sc2, none, roblox],
      storage: join(work, 'storage'),
      moduleOptions: extension =>
        extension === 'example/sc2' ? { installationDirectory: 'C:/Games/SC2' } : undefined,
      // every module gets the host's platform probes beside its options
      installationProbes: { name: 'fixture-probes' } as never,
      // and the credential port of its own extension only
      credentials: extension =>
        extension === 'example/roblox' ? ({ name: 'roblox-port' } as never) : undefined,
      // and the user's index cache switches
      indexCaches: { s2: { names: false } },
    })
    const snapshot = await sources?.snapshot()
    expect(
      snapshot?.roots.map(root => {
        const extra = root as { probes?: unknown; credentials?: unknown; names?: unknown }
        return [root.id, root.label, extra.probes, extra.credentials, extra.names]
      }),
    ).toEqual([
      ['sc2:root', '"C:/Games/SC2"', 'fixture-probes', null, false],
      ['roblox:root', 'null', 'fixture-probes', 'roblox-port', false],
    ])
    await sources?.dispose()
  })

  it('composes one module per extension when two roots carry the same one', async () => {
    const live = await extension('twin', 'dist/sources.mjs')
    const snapshot = join(work, 'snapshot')
    await mkdir(snapshot, { recursive: true })
    const copy = join(snapshot, 'twin')
    await mkdir(join(copy, 'dist'), { recursive: true })
    for (const file of ['package.json', 'dist/sources.mjs'])
      await writeFile(join(copy, file), await readFile(join(live, file)))
    const sources = await resolveContentSources({
      extensionRoots: [live, copy],
      storage: join(work, 'storage'),
    })
    expect((await sources?.snapshot())?.roots.map(root => root.id)).toEqual(['twin:root'])
    await sources?.dispose()
  })

  it('reads index cache switches: an absent product or kind is enabled', () => {
    const switches = { s2: { names: false } }
    expect(indexCacheEnabled(switches, 's2', 'names')).toBe(false)
    expect(indexCacheEnabled(switches, 's2', 'content')).toBe(true)
    expect(indexCacheEnabled(switches, 'd3', 'names')).toBe(true)
    expect(indexCacheEnabled(undefined, 's2', 'names')).toBe(true)
  })

  it('has none when no extension declares a module, and refuses one outside its root', async () => {
    expect(
      await resolveContentSources({
        extensionRoots: [await extension('plain', undefined)],
        storage: join(work, 'storage'),
      }),
    ).toBeUndefined()
    const escaping = await extension('escaping', '../sc2/dist/sources.mjs')
    await expect(
      resolveContentSources({ extensionRoots: [escaping], storage: join(work, 'storage') }),
    ).rejects.toThrow(/inside the extension root/)
  })

  it('lets a configuration stand in for one extension while the others still compose', async () => {
    const configured = await extension('scoped-config', undefined)
    const declared = await extension('scoped', 'dist/sources.mjs')
    const other = await extension('scoped-other', 'dist/sources.mjs')
    const configPath = join(work, 'scoped-provider.json')
    await writeFile(
      configPath,
      JSON.stringify({
        module: join(configured, 'dist', 'sources.mjs'),
        options: {},
        extension: 'example/scoped',
      }),
    )
    const sources = await resolveContentSources({
      extensionRoots: [declared, other],
      configPath,
      storage: join(work, 'storage'),
    })
    expect((await sources?.snapshot())?.roots.map(root => root.id)).toEqual([
      'scoped-config:root',
      'scoped-other:root',
    ])
    await sources?.dispose()
  })

  it('uses only the configured module when a configuration is given', async () => {
    const configured = await extension('configured', undefined)
    const configPath = join(work, 'provider.json')
    await writeFile(
      configPath,
      JSON.stringify({ module: join(configured, 'dist', 'sources.mjs'), options: {} }),
    )
    const sources = await resolveContentSources({
      extensionRoots: [await extension('declared', 'dist/sources.mjs')],
      configPath,
      storage: join(work, 'storage'),
    })
    expect((await sources?.snapshot())?.roots.map(root => root.id)).toEqual(['configured:root'])
    await sources?.dispose()
  })

  it('passes a newly selected installation to a configured extension without losing its defaults', async () => {
    const configured = await extension('selected-config', undefined)
    const configPath = join(work, 'selected-provider.json')
    await writeFile(
      configPath,
      JSON.stringify({
        module: join(configured, 'dist', 'sources.mjs'),
        extension: 'example/selected',
        options: { installationDirectory: 'C:/old-game', locale: 'ruRU' },
      }),
    )
    for (const installationDirectory of ['F:/Games/game-one', 'F:/Games/game-two']) {
      const sources = await resolveContentSources({
        extensionRoots: [],
        configPath,
        storage: join(work, 'storage'),
        moduleOptions: extension =>
          extension === 'example/selected'
            ? { installationDirectory }
            : { installationDirectory: 'wrong extension' },
      })
      try {
        expect((await sources?.snapshot())?.roots[0]).toMatchObject({
          label: JSON.stringify(installationDirectory),
          options: { installationDirectory, locale: 'ruRU' },
        })
      } finally {
        await sources?.dispose()
      }
    }
  })
})
