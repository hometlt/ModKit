import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Properties of the single-file production dist (owner authorisation 2026-08-14).
 *
 * These assert the *shape* the authorisation specified, not just that a build ran:
 * one file per published entry, cross-package boundaries preserved as real imports, the
 * exports map untouched, testkit unbundled, and two builds byte-identical.
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const stagedDist = mkdtempSync(join(tmpdir(), 'x3-bundle-conformance-'))
const stagedManifest = join(stagedDist, 'bundle-hashes.json')
const bundlePath = (...parts: string[]) => {
  const staged = join(stagedDist, ...parts)
  return existsSync(staged) ? staged : join(root, ...parts)
}

beforeAll(() => {
  const repositoryBefore = repositoryDistHashes()
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'bundle.mjs'), '--artifact-root', stagedDist, '--out', stagedManifest],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`isolated bundle staging failed:\n${result.stderr || result.stdout}`)
  }
  expect(repositoryDistHashes()).toEqual(repositoryBefore)
  // Native package self-references must resolve against this staged publication, not live dist.
  const host = join(stagedDist, 'packages', 'host')
  copyFileSync(join(root, 'packages', 'host', 'package.json'), join(host, 'package.json'))
  symlinkSync(
    join(root, 'packages', 'host', 'node_modules'),
    join(host, 'node_modules'),
    'junction',
  )
})

afterAll(() => rmSync(stagedDist, { recursive: true, force: true }))

/**
 * Every `.js` target of the bundled packages' exports maps, which bundle.mjs reads too: each must
 * build into one self-contained file, and the bundle must build nothing else. A hand-kept copy of
 * this list fell behind each new subpath.
 */
const PUBLISHED_ENTRIES = ['core', 'sdk', 'vfs', 'host', 'ui'].flatMap(pkg => {
  const manifest = JSON.parse(
    readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8'),
  ) as { exports: unknown }
  const targets = new Set<string>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.endsWith('.js')) targets.add(value)
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item)
    }
  }
  walk(manifest.exports)
  return [...targets].map(target => `packages/${pkg}/${target.replace(/^\.\//u, '')}`)
})

const repositoryDistHashes = () =>
  Object.fromEntries(
    [...PUBLISHED_ENTRIES, 'apps/cli/dist/main.js'].map(entry => [
      entry,
      createHash('sha256')
        .update(readFileSync(join(root, entry)))
        .digest('hex'),
    ]),
  )

/**
 * Every module specifier the file still depends on. Matches `from '…'` (import and export
 * statements alike, including multi-line ones) and dynamic `import('…')` — in generated ESM
 * these forms are the only way a specifier appears.
 */
function importSpecifiers(source: string): string[] {
  const statik = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(m => m[1] as string)
  const dynamic = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    m => m[1] as string,
  )
  return [...statik, ...dynamic]
}

describe('single-file production dist', () => {
  it('keeps 3D rendering in the built-in scene package, outside extension sets', async () => {
    const { APP_EXTENSION_SETS } = (await import('../app-extension-sets.mjs')) as {
      APP_EXTENSION_SETS: Readonly<Record<string, readonly string[]>>
    }
    expect(APP_EXTENSION_SETS['models-and-archives']).not.toContain('rendering-3d')
    expect(APP_EXTENSION_SETS['full-codecs']).not.toContain('rendering-3d')

    const manifest = JSON.parse(
      readFileSync(bundlePath('packages/scene/package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const declared = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }
    expect(declared).toHaveProperty('three')
    for (const entry of ['browser.ts', 'headless.ts']) {
      const source = readFileSync(bundlePath('packages/scene/src/render', entry), 'utf8')
      expect(importSpecifiers(source)).not.toContain('three')
    }
  })

  it('publishes the entries designed to stand alone', () => {
    expect(PUBLISHED_ENTRIES).toEqual(
      expect.arrayContaining([
        // the AJV validator table (2.6 MB) loads on first use, not with every import of the SDK
        'packages/sdk/dist/manifest/validators.generated.js',
        // the capability-RPC core, without inventory, resolution or gate code
        'packages/host/dist/execution/index.js',
        // worker entries a Worker finds by URL
        'packages/host/dist/node/worker-bootstrap.js',
        'packages/host/dist/browser/worker-entry.js',
      ]),
    )
  })

  it.each(PUBLISHED_ENTRIES)('%s is one self-contained file', entry => {
    const source = readFileSync(bundlePath(entry), 'utf8')
    const relative = importSpecifiers(source).filter(s => s.startsWith('.'))
    expect(relative, `${entry} still imports its own modules`).toEqual([])
  })

  it('keeps cross-package and third-party imports external', () => {
    const sdk = readFileSync(bundlePath('packages/sdk/dist/index.js'), 'utf8')
    // sdk uses core at runtime: that must remain a real package import, never inlined —
    // inlining would duplicate a sibling package's module state.
    expect(importSpecifiers(sdk)).toContain('@modkit/core')
    // JSON Schema validators are emitted at build time. Runtime compilation would violate the
    // production viewer CSP and break every codec.open() in browser hosts.
    expect(sdk).not.toContain('ajv/dist/2020.js')
    expect(sdk).not.toContain('new Function')
    expect(sdk).not.toContain('unsafe-eval')

    // AJV's standalone emitter references tiny runtime helpers. The validator entry must inline
    // that complete closure: published SDK consumers are not required to install the compiler or
    // rely on the build workspace's node_modules layout merely to validate a manifest.
    const validators = readFileSync(
      bundlePath('packages/sdk/dist/manifest/validators.generated.js'),
      'utf8',
    )
    expect(validators).not.toMatch(/^\s*import\b/mu)
    expect(validators).not.toMatch(/^\s*export\s+.*\s+from\b/mu)
    expect(validators).not.toMatch(/\bimport\s*\(/u)
    expect(validators).not.toMatch(/\bfrom\s*["']ajv\/dist\/runtime\//u)

    const host = readFileSync(bundlePath('packages/host/dist/index.js'), 'utf8')
    const hostImports = importSpecifiers(host)
    expect(hostImports).toContain('@modkit/core')
    expect(hostImports).toContain('@modkit/sdk')

    const ui = readFileSync(bundlePath('packages/ui/dist/index.js'), 'utf8')
    // a node: module specifier, not the text: `{ node: root }` is an ordinary object key
    expect(ui).not.toMatch(/(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])node:/u)
  })

  it('does not bundle the dev-only testkit', () => {
    const testkit = readFileSync(bundlePath('packages/testkit/dist/index.js'), 'utf8')
    // testkit stays modular: its entry still re-exports its own files.
    expect(importSpecifiers(testkit).some(s => s.startsWith('.'))).toBe(true)
  })

  it('imports the shared build policy without executing the bundle command', () => {
    const before = repositoryDistHashes()
    const baseline = readFileSync(join(root, 'scripts', 'bundle-hashes.json'), 'utf8')
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { externalPlugin } from ${JSON.stringify(pathToFileURL(join(root, 'scripts', 'bundle.mjs')).href)};
       if (typeof externalPlugin !== 'function') throw new Error('missing shared policy');`,
        '--',
        '--manifest-only',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(repositoryDistHashes()).toEqual(before)
    expect(readFileSync(join(root, 'scripts', 'bundle-hashes.json'), 'utf8')).toBe(baseline)
  })

  it('runs the bundle command through a checkout junction', () => {
    const alias = join(stagedDist, 'source-junction')
    const manifest = join(stagedDist, 'junction-hashes.json')
    symlinkSync(root, alias, 'junction')
    const result = spawnSync(
      process.execPath,
      [join(alias, 'scripts', 'bundle.mjs'), '--manifest-only', '--out', manifest],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(existsSync(manifest), 'the junction invocation must execute the command').toBe(true)
    expect(readFileSync(manifest, 'utf8')).toBe(readFileSync(stagedManifest, 'utf8'))
  })

  it('shares captured language context across native published Host entrypoints', () => {
    const hostUrl = pathToFileURL(bundlePath('packages/host/dist/index.js')).href
    const languageUrl = pathToFileURL(bundlePath('packages/host/dist/language/index.js')).href
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
        import assert from 'node:assert/strict'
        import * as host from ${JSON.stringify(hostUrl)}
        import * as language from ${JSON.stringify(languageUrl)}
        const caller = {kind: 'catalog', id: 'fixture', revision: '1', payload: {value: 45}}
        const source = host.composeLanguageDocumentSources([
          {snapshot: async () => ({documents: [], isComplete: true, workspaceContext: {
            id: 'fixture', revision: '1', semanticComplete: true,
            documentOrigins: [], semanticInputs: [caller],
          }})},
          {snapshot: async () => ({documents: [], isComplete: true})},
        ])
        const document = {uri: 'fixture:doc', languageId: 'fixture', version: 1, text: '<Catalog/>'}
        const snapshot = await source.snapshot({document, workspaceDocuments: [],
          workspaceDocumentOrigins: [], workspaceLanguageIds: ['fixture'], maxDocuments: 2,
          signal: new AbortController().signal})
        const captured = snapshot.workspaceContext.semanticInputs[0]
        assert.notStrictEqual(captured, caller)
        assert(Object.isFrozen(captured.payload))
        assert.strictEqual(language.validatedLanguageWorkspaceSemanticInputs([captured])[0],
          captured, 'the language entry must reuse the root entry owner capture')
        const capturedDocument = host.languageDocumentSnapshot(document)
        assert.strictEqual(language.languageDocumentSnapshot(capturedDocument), capturedDocument)
        assert.equal(host.languageDocumentTextToken(capturedDocument),
          language.languageDocumentTextToken(capturedDocument))
        const token = language.languageWorkspaceContextToken(captured)
        assert.equal(host.languageWorkspaceContextToken(captured), token)
        caller.payload.value = 50
        assert.equal(captured.payload.value, 45)
        const callerFrozen = Object.freeze({...caller, payload: {value: 45}})
        const first = host.validatedLanguageWorkspaceSemanticInputs([callerFrozen])[0]
        assert.notStrictEqual(first, callerFrozen)
        callerFrozen.payload.value = 50
        const second = language.validatedLanguageWorkspaceSemanticInputs([callerFrozen])[0]
        assert.equal(first.payload.value, 45)
        assert.equal(second.payload.value, 50)
        assert.notEqual(host.languageWorkspaceContextToken(first),
          language.languageWorkspaceContextToken(second))
        let getterCalls = 0
        const invalid = Object.freeze({...caller, payload: Object.freeze({
          get value() {getterCalls++; return 45},
        })})
        assert.throws(() => host.validatedLanguageWorkspaceSemanticInputs([invalid]), /strict JSON/)
        assert.equal(getterCalls, 0)
      `,
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })

  it('leaves the exports map and the .d.ts API in place', () => {
    for (const pkg of ['core', 'sdk', 'vfs', 'host', 'ui']) {
      const manifest = JSON.parse(
        readFileSync(bundlePath('packages', pkg, 'package.json'), 'utf8'),
      ) as { exports: Record<string, string | { types: string; default: string }> }
      for (const entry of Object.values(manifest.exports).filter(
        (value): value is { types: string; default: string } => typeof value !== 'string',
      )) {
        expect(entry.types.endsWith('.d.ts')).toBe(true)
        // The declaration files come from tsc and are NOT bundled: the type API is unchanged.
        const declaration = readFileSync(bundlePath('packages', pkg, entry.types.slice(2)), 'utf8')
        expect(declaration.length).toBeGreaterThan(0)
      }
      if (pkg === 'core' || pkg === 'sdk') {
        expect(manifest.exports['./schemas/*.schema.json']).toBe('./schemas/*.schema.json')
      }
    }
  })

  it('produces byte-identical output on two consecutive builds', () => {
    /*
     * Two builds, compared against each other in a scratch directory — never against the tracked
     * baseline.
     *
     * This suite used to run the generator's default write mode twice and diff
     * `scripts/bundle-hashes.json`, which meant an ordinary `pnpm test` rewrote reviewed output as
     * a side effect of asking whether the build is deterministic. `--manifest-only` builds every
     * entry in memory and sends only its hashes to scratch. This also keeps other Vitest workers
     * from observing a half-pruned dist while this suite runs.
     */
    const baseline = join(root, 'scripts', 'bundle-hashes.json')
    const before = existsSync(baseline) ? readFileSync(baseline, 'utf8') : undefined
    const distEntries = [...PUBLISHED_ENTRIES, 'apps/cli/dist/main.js']
    const distBefore = repositoryDistHashes()
    const scratch = mkdtempSync(join(tmpdir(), 'x3-bundle-determinism-'))
    const run = (attempt: string) => {
      const out = join(scratch, `${attempt}.json`)
      const result = spawnSync(
        process.execPath,
        [join(root, 'scripts', 'bundle.mjs'), '--manifest-only', '--out', out],
        { cwd: root, encoding: 'utf8' },
      )
      expect(result.status, result.stderr).toBe(0)
      return readFileSync(out, 'utf8')
    }
    let first: string
    let second: string
    try {
      first = run('first')
      second = run('second')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
    expect(second).toBe(first)
    // and the baseline this suite exists to protect is exactly as it was found
    expect(existsSync(baseline) ? readFileSync(baseline, 'utf8') : undefined).toBe(before)
    expect(repositoryDistHashes()).toEqual(distBefore)
    const hashes = JSON.parse(first) as Record<string, string>
    expect(Object.keys(hashes).sort()).toEqual(distEntries.sort())
  })
})
