import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const gate = join(scriptsDir, 'check-extension-inventory.mjs')
const fixturesRoot = join(scriptsDir, 'test', 'fixtures', 'extension-inventory-gate')

function runGate(extra: readonly string[] = []) {
  const result = spawnSync(process.execPath, [gate, ...extra], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('extension inventory gate (MK3/27 §0.2/§5.1, 24 §8 data-only read)', () => {
  it('accepts a bundled extension whose contribution validates against the production registry', () => {
    const { status, stdout, stderr } = runGate(['--root', join(fixturesRoot, 'valid')])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('1 extension director(y/ies) checked')
  })

  it('fails a bundled extension whose contributionManifests pattern matches nothing', () => {
    const { status, stderr } = runGate(['--root', join(fixturesRoot, 'broken')])
    expect(status).toBe(1)
    expect(stderr).toContain('extensions/common/broken')
    expect(stderr).toContain('x3.sdk/pattern-without-matches')
    // an example with a demo contract only warns (unknown-contract) and is not listed
    expect(stderr).not.toContain('examples/demo')
  })

  it('known debt is a ratchet: tracked directories pass, stale entries fail', () => {
    const tracked = runGate([
      '--root',
      join(fixturesRoot, 'broken'),
      '--debt-file',
      join(fixturesRoot, 'matching-debt.json'),
    ])
    expect(tracked.stderr).toBe('')
    expect(tracked.status).toBe(0)
    expect(tracked.stdout).toContain('known-debt director(y/ies) still invalid')

    const stale = runGate([
      '--root',
      join(fixturesRoot, 'valid'),
      '--debt-file',
      join(fixturesRoot, 'stale-debt.json'),
    ])
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain('[stale-known-debt]')
  })

  it('keeps the real repository green and checks every authored extension container', () => {
    const { status, stdout, stderr } = runGate()
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const match = /clean \((\d+) extension director/.exec(stdout)
    expect(match).not.toBeNull()
    // bundled common family + examples; a regression to zero would mean the scan is broken
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(15)
  })
})
