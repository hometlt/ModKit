/**
 * A real CommonJS consumer, bundled and executed — not imported.
 *
 * VS Code loads an extension entry point as CommonJS, so the published surface has to survive being
 * bundled to CJS and run by `node`. That is a different claim from "a test file imported it": under
 * `require(esm)` Node keeps ESM semantics and `import.meta.url` still resolves, so an import-only
 * check passes on exactly the configuration that was never in doubt. The failure this guards
 * against only appears once a bundler has flattened the graph into CommonJS and `import.meta` is
 * gone.
 *
 * Two runs, because both halves matter:
 *
 *  1. **With a bootstrap.** The host is told where its worker bootstrap lives, the way the VS Code
 *     build tells it, and a subject opens worker-brokered from a CommonJS bundle.
 *  2. **Without one.** The host refuses by name — `x3.host/worker-bootstrap-unresolved` — instead
 *     of dying inside `new URL(x, undefined)` with a `TypeError` that explains nothing. A named
 *     refusal that names the option is the whole reason this path is not a string rewrite.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const scratch = mkdtempSync(join(tmpdir(), 'x3-cjs-consumer-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** Bundles `source` exactly as an extension host would: one CommonJS file, Node built-ins external. */
async function bundleCjs(name: string, source: string): Promise<string> {
  const outfile = join(scratch, `${name}.cjs`)
  await build({
    stdin: { contents: source, resolveDir: repoRoot, loader: 'ts' },
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    absWorkingDir: repoRoot,
    logLevel: 'silent',
    // jsonc-parser is a legitimate host-native dependency. Keeping it as a package boundary also
    // preserves its own relative CommonJS requires instead of flattening them into this bundle.
    external: ['node:*', 'jsonc-parser'],
  })
  return outfile
}

/**
 * The worker bootstrap as its own ES module, mirroring `apps/vscode/scripts/build-extension`.
 *
 * A worker thread is its own entry point and the bootstrap verifies artifact bytes against the
 * inventory digests, so it is never reached through the consumer's bundle.
 */
async function bundleBootstrap(): Promise<string> {
  const entry = join(repoRoot, 'packages', 'host', 'dist', 'node', 'worker-bootstrap.js')
  if (!existsSync(entry)) throw new Error(`missing ${entry} — run the build before this suite`)
  const outfile = join(scratch, 'worker-bootstrap.js')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    absWorkingDir: repoRoot,
    logLevel: 'silent',
    external: ['jsonc-parser'],
  })
  return outfile
}

function runNode(file: string): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [file], {
    cwd: scratch,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_PATH: [
        join(repoRoot, 'packages', 'host', 'node_modules'),
        join(repoRoot, 'node_modules'),
      ]
        .filter(Boolean)
        .join(delimiter),
    },
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const CONSUMER = (withBootstrap: boolean) => `
const { createModkit } = require('@modkit/host/node')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const repo = ${JSON.stringify(repoRoot)}
const bootstrap = ${JSON.stringify(join(scratch, 'worker-bootstrap.js'))}

async function main() {
  const modkit = await createModkit({
    extensions: [path.join(repo, 'extensions', 'images')],
    roots: [path.join(repo, 'apps', 'web', 'public')],
    ${withBootstrap ? 'bootstrapUrl: pathToFileURL(bootstrap),' : ''}
  })
  try {
    const opened = await modkit.open(path.join(repo, 'apps', 'web', 'public', 'favicon-32.png'))
    const snapshot = opened.snapshot ?? opened
    console.log('STATE=' + snapshot.state)
    console.log('CODEC=' + (snapshot.selected && snapshot.selected.contributionId))
    console.log('VARIANT=' + (snapshot.selected && snapshot.selected.variantId))
  } finally {
    await modkit.close()
  }
}
main().then(
  () => console.log('DONE'),
  error => {
    console.log('CODE=' + (error && error.code))
    console.log('MESSAGE=' + (error && error.message))
    process.exit(3)
  },
)
`

describe('the published surface survives being bundled as CommonJS', () => {
  it('opens a subject from a CommonJS bundle when the host is told where its bootstrap is', async () => {
    await bundleBootstrap()
    const file = await bundleCjs('with-bootstrap', CONSUMER(true))
    const { status, output } = runNode(file)

    expect(output).toContain('STATE=opened')
    expect(output).toContain('CODEC=modkit/image-png')
    // worker-brokered, so the bundle really did reach a spawned worker rather than staying in-process
    expect(output).toContain('VARIANT=portable')
    expect(output).toContain('DONE')
    expect(status, output).toBe(0)
  }, 120_000)

  it('refuses by name when a CommonJS bundle names no bootstrap', async () => {
    const file = await bundleCjs('no-bootstrap', CONSUMER(false))
    const { status, output } = runNode(file)

    /*
     * The point of the whole arrangement: `import.meta` does not survive the bundler, so the host
     * cannot find the file beside itself — and says exactly that, naming the option that fixes it.
     */
    expect(output).toContain('CODE=x3.host/worker-bootstrap-unresolved')
    expect(output).toMatch(/bootstrapUrl/u)
    expect(output).not.toMatch(/Cannot read properties|Invalid URL|TypeError/u)
    expect(status).toBe(3)
  }, 120_000)
})

describe('the package advertises what a consumer needs to resolve', () => {
  it('resolves the Node subpath and its types from CommonJS', () => {
    const file = join(scratch, 'resolve.cjs')
    writeFileSync(
      file,
      `const p = require.resolve('@modkit/host/node')\n` +
        `console.log('RESOLVED=' + (typeof p === 'string' && p.length > 0))\n` +
        `const surface = require('@modkit/host/node')\n` +
        `console.log('CREATE_MODKIT=' + typeof surface.createModkit)\n` +
        `console.log('OPENER=' + typeof surface.createPathSubjectOpener)\n`,
      'utf8',
    )
    const { status, output } = runNode(file)
    expect(output, output).toContain('RESOLVED=true')
    expect(output).toContain('CREATE_MODKIT=function')
    expect(output).toContain('OPENER=function')
    expect(status).toBe(0)
  }, 60_000)

  it('ships type declarations beside every published entry it names', async () => {
    const manifest = (await import(join(repoRoot, 'packages', 'host', 'package.json'), {
      with: { type: 'json' },
    })) as { readonly default: { readonly exports: Record<string, { readonly types?: string }> } }
    const exportsMap = manifest.default.exports
    for (const [subpath, entry] of Object.entries(exportsMap)) {
      if (typeof entry !== 'object' || entry === null || entry.types === undefined) continue
      const types = join(repoRoot, 'packages', 'host', entry.types)
      expect(existsSync(types), `${subpath} names ${entry.types}, which does not exist`).toBe(true)
    }
  })
})
