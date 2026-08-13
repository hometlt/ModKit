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

function sh(cmd: string, args: string[], cwd: string) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: true, timeout: 240_000 })
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
          ['pack', '--pack-destination', JSON.stringify(packDest)],
          join(repoRoot, 'packages', pkg),
        )
        expect(res.status, `pnpm pack ${pkg}: ${res.stderr}`).toBe(0)
      }
      const tarballs = readdirSync(packDest).filter(f => f.endsWith('.tgz'))
      expect(tarballs).toHaveLength(5)

      // 2. copy the example outside the workspace and install ONLY the artifacts
      const exampleDir = join(tmp, 'example')
      cpSync(exampleSrc, exampleDir, { recursive: true })
      const install = sh(
        'npm',
        [
          'install',
          '--no-audit',
          '--no-fund',
          '--install-links=false',
          ...tarballs.map(t => JSON.stringify(join(packDest, t))),
        ],
        exampleDir,
      )
      expect(install.status, install.stderr).toBe(0)

      // 3. hygiene: no workspace:/deep-dist imports in the example sources;
      //    installed packages came from artifacts, not links
      for (const file of ['src/greeter-plain.js', 'src/greeter-fancy.js', 'runner.mjs']) {
        const text = readFileSync(join(exampleDir, file), 'utf8')
        expect(text.includes('workspace:'), file).toBe(false)
        expect(/@modkitx-x3\/[a-z-]+\/dist\//.test(text), `${file} deep import`).toBe(false)
      }
      const installedPkg = JSON.parse(readFileSync(join(exampleDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
      }
      for (const [name, ref] of Object.entries(installedPkg.dependencies)) {
        expect(ref.includes('workspace:'), `${name} ${ref}`).toBe(false)
        if (ref.startsWith('file:'))
          expect(ref.endsWith('.tgz'), `${name} must point at a packed artifact, got ${ref}`).toBe(
            true,
          )
      }
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

      // 6. record the closure size (§6 report duty)
      const sizeMb = dirSizeBytes(join(exampleDir, 'node_modules')) / (1024 * 1024)
      // eslint-disable-next-line no-console
      console.log(`external example node_modules: ${sizeMb.toFixed(1)} MB`)
      expect(sizeMb).toBeGreaterThan(0)
    },
  )
})
