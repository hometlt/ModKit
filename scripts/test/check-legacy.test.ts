import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = join(scriptsDir, '..')
const gate = join(scriptsDir, 'check-legacy.mjs')
const fixturesRoot = join(scriptsDir, 'test', 'fixtures', 'legacy-gate')

function runGate(root?: string) {
  const args = root === undefined ? [gate] : [gate, '--root', root]
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('legacy gate (BRIEF-12 §3.5)', () => {
  it('flags every seeded violation class in the violations tree', () => {
    const { status, stderr } = runGate(join(fixturesRoot, 'violations'))
    expect(status).toBe(1)
    for (const rule of [
      'package-name',
      'package-name-scope',
      'exports-path',
      'asset-plugin',
      'capability-runtime-type',
      'capability-key',
      'authored-extension-json',
      'legacy-codec-root',
      'marker-outside-fixtures',
    ]) {
      expect(stderr, `expected rule ${rule} to fire`).toContain(`[${rule}]`)
    }
  })

  it('still scans a file that abuses the marker outside fixtures/', () => {
    const { stderr } = runGate(join(fixturesRoot, 'violations'))
    const markerAbuse = stderr
      .split('\n')
      .filter(line => line.includes('marker-abuse.ts'))
    expect(markerAbuse.some(line => line.includes('[marker-outside-fixtures]'))).toBe(true)
    expect(markerAbuse.some(line => line.includes('[asset-plugin]'))).toBe(true)
  })

  it('passes the clean tree and actually scans files', () => {
    const { status, stdout } = runGate(join(fixturesRoot, 'clean'))
    expect(status).toBe(0)
    const match = /clean \((\d+) file\(s\) scanned\)/.exec(stdout)
    expect(match, 'expected a scanned-file count').not.toBeNull()
    // package.json + ok.ts are scanned; fixtures/legacy and marked fixtures are excluded.
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2)
  })

  it('excludes fixtures/legacy paths and marked files under fixtures/', () => {
    const { status, stderr } = runGate(join(fixturesRoot, 'clean'))
    expect(status).toBe(0)
    expect(stderr).not.toContain('old-manifest.json')
    expect(stderr).not.toContain('marked-input.ts')
  })

  it('keeps the real repository green', () => {
    const { status, stdout, stderr } = runGate(repoRoot)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('legacy gate: clean')
  })
})
