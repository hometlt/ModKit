import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(scriptsDir, '..')
const gate = join(scriptsDir, 'check-app-imports.mjs')
const fixturesRoot = join(scriptsDir, 'test', 'fixtures', 'app-import-gate')

function runGate(extra: readonly string[] = []) {
  const result = spawnSync(process.execPath, [gate, ...extra], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('extension-implementation import gate (MK3/27 §7/§11/§12.5)', () => {
  it('flags relative imports into extensions/ and bare extension-package imports', () => {
    const { status, stderr } = runGate(['--root', join(fixturesRoot, 'violations')])
    expect(status).toBe(1)
    const lines = stderr.split('\n')
    expect(
      lines.some(
        l => l.includes('apps/desktop/src/codecs.js:1') && l.includes('[extension-path-import]'),
      ),
    ).toBe(true)
    // dynamic import() counts too
    expect(
      lines.some(
        l => l.includes('apps/desktop/src/codecs.js:2') && l.includes('[extension-path-import]'),
      ),
    ).toBe(true)
    expect(
      lines.some(
        l => l.includes('packages/ui/src/index.ts:1') && l.includes('[extension-package-import]'),
      ),
    ).toBe(true)
    expect(
      lines.some(
        l => l.includes('packages/ui/src/index.ts:2') && l.includes('modkit-extension-foo'),
      ),
    ).toBe(true)
    // a commented-out import is not an edge
    expect(lines.some(l => l.includes('packages/ui/src/index.ts:3'))).toBe(false)
    expect(
      lines.some(
        l =>
          l.includes('apps/desktop/generated/handwritten-catalog.js:1') &&
          l.includes('[extension-path-import]'),
      ),
    ).toBe(true)
  })

  it('passes a clean tree and exempts scope-local generated loaders', () => {
    const { status, stdout, stderr } = runGate(['--root', join(fixturesRoot, 'clean')])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    // generated/bundled-catalog.js has a generator authority marker and is not counted
    expect(stdout).toMatch(/app-import gate: clean \(\d+ file\(s\) scanned\)/)
  })

  it('known debt is a ratchet: tracked files pass, others still fail, stale entries fail', () => {
    const tracked = runGate([
      '--root',
      join(fixturesRoot, 'violations'),
      '--debt-file',
      join(fixturesRoot, 'matching-debt.json'),
    ])
    expect(tracked.status).toBe(1)
    expect(tracked.stderr).not.toContain('apps/desktop/src/codecs.js:1')
    expect(tracked.stderr).toContain('packages/ui/src/index.ts:1')

    const stale = runGate([
      '--root',
      join(fixturesRoot, 'clean'),
      '--debt-file',
      join(fixturesRoot, 'stale-debt.json'),
    ])
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain('[stale-known-debt]')
    expect(stale.stderr).toContain('apps/desktop/src/index.ts')
  })

  it('keeps the real repository green (tracked debt or none) and scans real sources', () => {
    const { status, stdout, stderr } = runGate()
    expect(repoRoot.length).toBeGreaterThan(0)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const match = /clean \((\d+) file\(s\) scanned/.exec(stdout)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThan(0)
  })
})
