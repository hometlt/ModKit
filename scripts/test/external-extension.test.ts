import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// S4 acceptance (BRIEF-12 §5): the external example installs the packed tarballs of the
// public packages into a clean temp dir, contains no file:-to-source/workspace:/deep
// imports, and runs the full route from its own cwd.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const exampleSrc = join(repoRoot, 'examples', 'modkit-extension-greeter')
/** testkit's own workspace dependencies beyond the public four (its package.json). */
const TESTKIT_DEPENDENCIES = ['codec-kit', 'uv'] as const
const PACKED = ['core', 'sdk', 'vfs', 'host', 'testkit', ...TESTKIT_DEPENDENCIES] as const
const tmp = mkdtempSync(join(tmpdir(), 'x3-external-'))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

// No `shell: true` (Node DEP0190, and it forces manual quoting of every path). Windows
// package managers are .cmd shims, so they are invoked through cmd.exe explicitly.
function sh(cmd: string, args: string[], cwd: string) {
  const isWindows = process.platform === 'win32'
  const needsShim = isWindows && (cmd === 'pnpm' || cmd === 'npm')
  const env = { ...process.env, npm_config_cache: join(tmp, 'npm-cache') }
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', cmd, ...args], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 240_000,
        windowsVerbatimArguments: false,
      })
    : spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 240_000 })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function dirSizeBytes(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? dirSizeBytes(path) : statSync(path).size
  }
  return total
}

describe('external packed-tarball extension (S4/PR-23 shape)', () => {
  it(
    'clean temp install of pnpm-pack tarballs runs the full route from its own cwd',
    { timeout: 300_000 },
    () => {
      // 1. pack every public package + testkit and the packages testkit needs (codec-kit, uv)
      const packDest = join(tmp, 'tarballs')
      for (const pkg of PACKED) {
        const res = sh(
          'pnpm',
          ['pack', '--pack-destination', packDest],
          join(repoRoot, 'packages', pkg),
        )
        expect(res.status, `pnpm pack ${pkg}: ${res.stderr}`).toBe(0)
      }
      const tarballs = readdirSync(packDest).filter(f => f.endsWith('.tgz'))
      expect(tarballs).toHaveLength(PACKED.length)

      // 2. copy the example outside the workspace and install ONLY the artifacts.
      //    testkit is the dev-only closure (canon §6.1): it goes in as a devDependency so
      //    the extension's production closure stays core+sdk+vfs+host.
      const exampleDir = join(tmp, 'example')
      cpSync(exampleSrc, exampleDir, { recursive: true })
      // The lab publishes nothing, so testkit's own dependencies come from their artifacts too;
      // declared beside testkit they stay in the dev closure.
      const exampleManifestPath = join(exampleDir, 'package.json')
      const exampleManifest = JSON.parse(readFileSync(exampleManifestPath, 'utf8')) as {
        devDependencies: Record<string, string>
      }
      for (const pkg of TESTKIT_DEPENDENCIES)
        exampleManifest.devDependencies[`@modkit/${pkg}`] = '*'
      writeFileSync(exampleManifestPath, JSON.stringify(exampleManifest, null, 2))
      const tarballOf = (pkg: string) => {
        const hit = tarballs.find(t => t.startsWith(`modkit-${pkg}-`))
        if (!hit) throw new Error(`no tarball for ${pkg} in ${tarballs.join(', ')}`)
        return join(packDest, hit)
      }
      // One install with every artifact: npm rewrites each declared spec in the section it
      // already lives in, so the prod/dev split authored by the extension is preserved
      // (installing them in two passes would make npm try to fetch the not-yet-supplied
      // half from the registry, and the lab publishes nothing).
      const npmFlags = ['--no-audit', '--no-fund', '--install-links=false']
      const install = sh('npm', ['install', ...npmFlags, ...PACKED.map(tarballOf)], exampleDir)
      expect(install.status, install.stderr).toBe(0)
      const resolveFromExample = createRequire(join(exampleDir, 'package.json')).resolve
      expect(resolveFromExample('@modkit/core/schemas/source-span.v1.schema.json')).toContain(
        'source-span.v1.schema.json',
      )
      expect(resolveFromExample('@modkit/sdk/schemas/subject-descriptor.v2.schema.json')).toContain(
        'subject-descriptor.v2.schema.json',
      )

      // 3. hygiene: no workspace:/deep-dist imports in the example sources;
      //    installed packages came from artifacts, not links
      for (const file of ['src/greeter-plain.js', 'src/greeter-fancy.js', 'runner.mjs']) {
        const text = readFileSync(join(exampleDir, file), 'utf8')
        expect(text.includes('workspace:'), file).toBe(false)
        expect(/@modkit\/[a-z-]+\/dist\//.test(text), `${file} deep import`).toBe(false)
      }
      const installedPkg = JSON.parse(readFileSync(join(exampleDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        devDependencies?: Record<string, string>
      }
      for (const [name, ref] of Object.entries({
        ...installedPkg.dependencies,
        ...(installedPkg.devDependencies ?? {}),
      })) {
        expect(ref.includes('workspace:'), `${name} ${ref}`).toBe(false)
        if (ref.startsWith('file:'))
          expect(ref.endsWith('.tgz'), `${name} must point at a packed artifact, got ${ref}`).toBe(
            true,
          )
      }
      // canon §6.1: testkit is dev-only and must never sit in the production closure
      expect(Object.keys(installedPkg.dependencies).sort()).toEqual([
        '@modkit/core',
        '@modkit/host',
        '@modkit/sdk',
        '@modkit/vfs',
      ])
      expect(Object.keys(installedPkg.devDependencies ?? {}).sort()).toEqual([
        '@modkit/codec-kit',
        '@modkit/testkit',
        '@modkit/uv',
      ])
      for (const pkg of PACKED) {
        const stat = statSync(join(exampleDir, 'node_modules', '@modkit', pkg))
        expect(stat.isDirectory()).toBe(true)
      }

      // 4. run the route from the example's own cwd
      const run = sh('node', ['runner.mjs'], exampleDir)
      expect(run.status, run.stderr).toBe(0)
      const output = JSON.parse(run.stdout) as {
        selected: string
        alternatives: string[]
        greeting: string
        fancy: string
      }
      expect(output.selected).toBe('org.example/x3-greeter-fancy')
      expect(output.alternatives).toEqual(['org.example/x3-greeter-plain'])
      expect(output.greeting).toBe('Salute, MK3!')
      expect(output.fancy).toContain('Salute via vfs, MK3!')
      expect(output.fancy).toContain('mem://greeting')

      // 5. deny-by-default from the same cwd (pinned ungranted provider is refused)
      const denied = sh('node', ['runner.mjs', '--deny'], exampleDir)
      expect(denied.status).toBe(3)
      expect(denied.stderr).toContain('permission-required')

      // 6. record the closure size (§6 report duty) — production closure separately from
      //    the dev-only testkit, since the earlier single number silently included it.
      const nodeModules = join(exampleDir, 'node_modules')
      const totalMb = dirSizeBytes(nodeModules) / (1024 * 1024)
      const testkitMb = dirSizeBytes(join(nodeModules, '@modkit', 'testkit')) / (1024 * 1024)
      console.log(
        `external example node_modules: ${totalMb.toFixed(2)} MB total, ` +
          `${(totalMb - testkitMb).toFixed(2)} MB production closure (testkit ${testkitMb.toFixed(2)} MB, dev-only)`,
      )
      expect(totalMb).toBeGreaterThan(0)
    },
  )
})
