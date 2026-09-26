import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
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
        probes: context?.installationProbes?.name ?? typeof context?.installationProbes }] }),
    connect: noop, disconnect: noop, search: async () => [], add: noop, remove: noop, refresh: noop,
    list: async () => [], read: async () => new Uint8Array(), dispose: noop,
  }
}\n`,
  )
  return root
}

describe('the content sources extensions declare', () => {
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
    })
    const snapshot = await sources?.snapshot()
    expect(
      snapshot?.roots.map(root => [root.id, root.label, (root as { probes?: unknown }).probes]),
    ).toEqual([
      ['sc2:root', '"C:/Games/SC2"', 'fixture-probes'],
      ['roblox:root', 'null', 'fixture-probes'],
    ])
    await sources?.dispose()
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
})
