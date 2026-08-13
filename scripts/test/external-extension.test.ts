import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// S4 acceptance (BRIEF-12 §5): the external example installs the packed tarballs of the
// public packages into a clean temp dir, contains no file:-to-source/workspace:/deep
// imports, and runs the full route from its own cwd.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const exampleSrc = join(repoRoot, 'examples', 'modkit-extension-x3-greeter')
const tmp = mkdtempSync(join(tmpdir(), 'x3-external-'))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

// No `shell: true` (Node DEP0190, and it forces manual quoting of every path). Windows
// package managers are .cmd shims, so they are invoked through cmd.exe explicitly.
function sh(cmd: string, args: string[], cwd: string) {
  const isWindows = process.platform === 'win32'
  const needsShim = isWindows && (cmd === 'pnpm' || cmd === 'npm')
  const result = needsShim
    ? spawnSync(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', cmd, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 240_000,
        windowsVerbatimArguments: false,
      })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 240_000 })
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
      // 1. pack every public package + testkit as artifacts
      const packDest = join(tmp, 'tarballs')
      for (const pkg of ['core', 'sdk', 'vfs', 'host', 'testkit']) {
        const res = sh(
          'pnpm',
          ['pack', '--pack-destination', packDest],
          join(repoRoot, 'packages', pkg),
        )
        expect(res.status, `pnpm pack ${pkg}: ${res.stderr}`).toBe(0)
      }
      const tarballs = readdirSync(packDest).filter(f => f.endsWith('.tgz'))
      expect(tarballs).toHaveLength(5)

      // 2. copy the example outside the workspace and install ONLY the artifacts.
      //    testkit is the dev-only closure (canon §6.1): it goes in as a devDependency so
      //    the extension's production closure stays core+sdk+vfs+host.
      const exampleDir = join(tmp, 'example')
      cpSync(exampleSrc, exampleDir, { recursive: true })
      const tarballOf = (pkg: string) => {
        const hit = tarballs.find(t => t.startsWith(`modkitx-x3-${pkg}-`))
        if (!hit) throw new Error(`no tarball for ${pkg} in ${tarballs.join(', ')}`)
        return join(packDest, hit)
      }
      const npmFlags = ['--no-audit', '--no-fund', '--install-links=false']
      const installProd = sh(
        'npm',
        ['install', '--save-prod', ...npmFlags, ...['core', 'sdk', 'vfs', 'host'].map(tarballOf)],
        exampleDir,
      )
      expect(installProd.status, installProd.stderr).toBe(0)
      const installDev = sh(
        'npm',
        ['install', '--save-dev', ...npmFlags, tarballOf('testkit')],
        exampleDir,
      )
      expect(installDev.status, installDev.stderr).toBe(0)

      // 3. hygiene: no workspace:/deep-dist imports in the example sources;
      //    installed packages came from artifacts, not links
      for (const file of ['src/greeter-plain.js', 'src/greeter-fancy.js', 'runner.mjs']) {
        const text = readFileSync(join(exampleDir, file), 'utf8')
        expect(text.includes('workspace:'), file).toBe(false)
        expect(/@modkitx-x3\/[a-z-]+\/dist\//.test(text), `${file} deep import`).toBe(false)
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
        '@modkitx-x3/host',
        '@modkitx-x3/sdk',
        '@modkitx-x3/vfs',
      ])
      expect(Object.keys(installedPkg.devDependencies ?? {})).toEqual(['@modkitx-x3/testkit'])
      for (const pkg of ['core', 'sdk', 'vfs', 'host', 'testkit']) {
        const stat = statSync(join(exampleDir, 'node_modules', '@modkitx-x3', pkg))
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
      const testkitMb = dirSizeBytes(join(nodeModules, '@modkitx-x3', 'testkit')) / (1024 * 1024)
      console.log(
        `external example node_modules: ${totalMb.toFixed(2)} MB total, ` +
          `${(totalMb - testkitMb).toFixed(2)} MB production closure (testkit ${testkitMb.toFixed(2)} MB, dev-only)`,
      )
      expect(totalMb).toBeGreaterThan(0)
    },
  )
})
