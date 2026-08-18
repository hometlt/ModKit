/**
 * S5: the browser verified loader, unit-tested in Node with real evaluation — `createModuleUrl`
 * mints `data:` URLs, so the rewritten graph is imported for real and the security rules are
 * exercised, not narrated: per-file digests, unlisted files, escapes, cycles, bare-map refusals,
 * dynamic-import refusal, entrypoint-only verification without a map, and the ceilings.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  loadVerifiedModuleGraph,
  scanModuleSpecifiers,
  type VerifiedLoaderOptions,
} from '../src/browser/verified-loader.js'

const sha256 = (text: string) =>
  `sha256:${createHash('sha256').update(new TextEncoder().encode(text)).digest('hex')}`

const ROOT = 'https://app.example/ext/demo/'

function artifact(files: Record<string, string>) {
  const encoder = new TextEncoder()
  const fetched: string[] = []
  const digests = Object.fromEntries(
    Object.entries(files).map(([path, text]) => [path, sha256(text)]),
  )
  const options = (overrides: Partial<VerifiedLoaderOptions> = {}): VerifiedLoaderOptions => ({
    artifactRoot: ROOT,
    fileDigests: digests,
    fetchBytes: async url => {
      fetched.push(url)
      const path = url.slice(ROOT.length)
      const text = files[path]
      if (text === undefined) throw new Error(`404 ${url}`)
      return encoder.encode(text)
    },
    digest: async bytes => sha256(new TextDecoder().decode(bytes)),
    createModuleUrl: source =>
      `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`,
    ...overrides,
  })
  return { options, fetched, digests }
}

describe('browser verified loader — fetch, verify, rewrite, really evaluate', () => {
  it('builds a multi-file graph children-first, verifies every file once, and the evaluated module works', async () => {
    const { options, fetched } = artifact({
      'codec.mjs': `import { helper } from './lib/helper.mjs'\nexport const abiVersion = 1\nexport const answer = helper() * 2\n`,
      'lib/helper.mjs': `export const helper = () => 21\n`,
    })
    const graph = await loadVerifiedModuleGraph('codec.mjs', options())
    expect(graph.verified).toEqual(['lib/helper.mjs', 'codec.mjs']) // children first
    expect(graph.unverified).toEqual([])
    expect(fetched).toHaveLength(2) // each file fetched exactly once
    const module = (await import(graph.url)) as { abiVersion: number; answer: number }
    expect(module.abiVersion).toBe(1)
    expect(module.answer).toBe(42) // the rewritten relative import really resolved
  })

  it('a tampered helper is refused with a digest mismatch; an unlisted file is refused; an escape is refused', async () => {
    const files = {
      'codec.mjs': `import './lib/helper.mjs'\nexport const abiVersion = 1\n`,
      'lib/helper.mjs': `export const x = 1\n`,
    }
    const { options, digests } = artifact(files)
    // tamper: the digest map still records the old bytes
    files['lib/helper.mjs'] = `export const x = 666\n`
    await expect(loadVerifiedModuleGraph('codec.mjs', options())).rejects.toMatchObject({
      code: 'x3.host/artifact-digest-mismatch',
    })
    // unlisted: the file exists but the inventory never recorded it
    files['lib/helper.mjs'] = `export const x = 1\n`
    delete (digests as Record<string, string>)['lib/helper.mjs']
    await expect(loadVerifiedModuleGraph('codec.mjs', options())).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
      message: expect.stringContaining('not part of the inventoried artifact'),
    })
    // escape: a relative import above the artifact root never reaches fetch
    const escape = artifact({ 'codec.mjs': `import '../outside.mjs'\nexport const a = 1\n` })
    await expect(loadVerifiedModuleGraph('codec.mjs', escape.options())).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
      message: expect.stringContaining('escapes the artifact root'),
    })
    expect(escape.fetched.filter(url => url.includes('outside'))).toEqual([])
  })

  it('bare specifiers go through the module map (reported unverified); outside the map they are refused', async () => {
    const files = {
      'codec.mjs': `import { dep } from '@vendor/kit'\nexport const viaDep = dep + 1\n`,
    }
    const depUrl = `data:text/javascript;base64,${Buffer.from('export const dep = 41\n').toString('base64')}`
    const { options } = artifact(files)
    const graph = await loadVerifiedModuleGraph(
      'codec.mjs',
      options({ resolveBare: specifier => (specifier === '@vendor/kit' ? depUrl : undefined) }),
    )
    expect(graph.unverified).toEqual(['@vendor/kit'])
    const module = (await import(graph.url)) as { viaDep: number }
    expect(module.viaDep).toBe(42)
    await expect(loadVerifiedModuleGraph('codec.mjs', options())).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
      message: expect.stringContaining('not in the host module map'),
    })
  })

  it('without a digest map only the entrypoint is verified and its imports are artifact-not-pinned', async () => {
    const entry = `export const abiVersion = 1\n`
    const { options } = artifact({ 'solo.mjs': entry })
    const { fileDigests: _dropSolo, ...soloBase } = options()
    void _dropSolo
    const graph = await loadVerifiedModuleGraph('solo.mjs', {
      ...soloBase,
      entrypointDigest: sha256(entry),
    })
    expect(graph.verified).toEqual(['solo.mjs'])
    expect(((await import(graph.url)) as { abiVersion: number }).abiVersion).toBe(1)

    const multi = artifact({
      'codec.mjs': `import './lib.mjs'\nexport const a = 1\n`,
      'lib.mjs': `export const b = 2\n`,
    })
    const { fileDigests: _dropMulti, ...multiBase } = multi.options()
    void _dropMulti
    await expect(
      loadVerifiedModuleGraph('codec.mjs', {
        ...multiBase,
        entrypointDigest: sha256(`import './lib.mjs'\nexport const a = 1\n`),
      }),
    ).rejects.toMatchObject({ code: 'x3.host/artifact-not-pinned' })
  })

  it('cycles, non-literal dynamic imports and the ceilings are refused before any evaluation', async () => {
    const cyclic = artifact({
      'a.mjs': `import './b.mjs'\nexport const a = 1\n`,
      'b.mjs': `import './a.mjs'\nexport const b = 2\n`,
    })
    await expect(loadVerifiedModuleGraph('a.mjs', cyclic.options())).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
      message: expect.stringContaining('cycle'),
    })
    const dynamic = artifact({
      'codec.mjs': `export const load = name => import(name)\n`,
    })
    await expect(loadVerifiedModuleGraph('codec.mjs', dynamic.options())).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
      message: expect.stringContaining('dynamic import'),
    })
    const big = artifact({
      'codec.mjs': `export const blob = '${'x'.repeat(64)}'\n`,
    })
    await expect(
      loadVerifiedModuleGraph('codec.mjs', big.options({ maxTotalBytes: 16 })),
    ).rejects.toMatchObject({
      code: 'x3.host/execution-load-rejected',
      message: expect.stringContaining('ceiling'),
    })
  })

  it('literal dynamic imports are rewritten like static ones; comments do not hide specifiers from the scan', () => {
    expect(
      scanModuleSpecifiers(
        `// import './ghost.mjs'\n/* import './ghost2.mjs' */\nimport { a } from './real.mjs'\nexport * from "./again.mjs"\nconst lazy = () => import('./lazy.mjs')\n`,
      ),
    ).toEqual(['./real.mjs', './again.mjs', './lazy.mjs'])
    expect(() => scanModuleSpecifiers(`const f = name => import(name)`)).toThrow(/dynamic import/u)
  })
})
