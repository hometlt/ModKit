/*
 * The identity-based debt ratchet in front of the capability registry gate (GA recovery, wave 2C).
 *
 * migration/registry-debt-baseline.json freezes today's problems by their exact message so the gate
 * can fail on anything *new* while the pre-existing debt stays visible, counted, and — because the
 * baseline stores identity rather than a count — unable to grow by trading one bad row for another.
 * These fixtures exercise the three outcomes the ratchet must produce, pointed at the gate itself
 * with small fixture registries rather than the real (500+ row) one, so a failure here names the
 * ratchet rule that broke and not a fixture that drifted.
 *
 * Every case below passes --baseline explicitly, which is what turns the ratchet on for a run that
 * does not use the real migration/capabilities.yaml (see useBaseline in check-registry.mjs). The
 * sibling suite, migration-registry-evidence.test.ts, never passes --baseline and so keeps exercising
 * the gate's pre-ratchet behaviour: every problem it finds there is still fatal, unconditionally.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const gate = join(scriptsDir, 'migration', 'check-registry.mjs')
const fixtures = join(scriptsDir, 'test', 'fixtures', 'migration-registry')

function runGate(registry: string, baseline: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [
      gate,
      '--inventory',
      join(fixtures, 'inventory.json'),
      '--registry',
      join(fixtures, registry),
      '--projections',
      join(fixtures, 'valid.projections.yaml'),
      '--artifacts',
      join(fixtures, 'artifacts'),
      '--baseline',
      join(fixtures, baseline),
    ],
    { encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

// The single problem no-owner.capabilities.yaml produces (verified directly against the gate): a
// blank owner on capability format/demo/open-inspect. Both fixture baselines below are written
// against this exact string.
const OWNER_PROBLEM = 'capability format/demo/open-inspect: owner is required'

describe('capability registry gate: debt ratchet', () => {
  it('accepts a clean registry against an empty baseline, so a failure below is the ratchet and nothing else', () => {
    const { status, output } = runGate('valid.capabilities.yaml', 'debt-baseline-empty.json')
    expect(output).toContain(
      'known debt 0 (must be empty by wave 6), new problems 0, stale baseline entries 0',
    )
    expect(status).toBe(0)
  })

  it('fails on a problem the baseline does not name', () => {
    const { status, output } = runGate('no-owner.capabilities.yaml', 'debt-baseline-empty.json')
    expect(output).toContain('1 NEW problem(s) — not in debt-baseline-empty.json')
    expect(output).toContain(OWNER_PROBLEM)
    expect(output).not.toContain('known debt problem(s)')
    expect(output).toContain(
      'known debt 0 (must be empty by wave 6), new problems 1, stale baseline entries 0',
    )
    expect(status).toBe(1)
  })

  it('does not fail on a problem the baseline already names as known debt', () => {
    const { status, output } = runGate(
      'no-owner.capabilities.yaml',
      'debt-baseline-with-no-owner.json',
    )
    expect(output).toContain('1 known debt problem(s) — frozen in debt-baseline-with-no-owner.json')
    expect(output).toContain(OWNER_PROBLEM)
    expect(output).not.toContain('NEW problem')
    expect(output).not.toContain('STALE baseline entry')
    expect(output).toContain(
      'known debt 1 (must be empty by wave 6), new problems 0, stale baseline entries 0',
    )
    expect(status).toBe(0)
  })

  it('fails when a baseline entry no longer reproduces, and says so', () => {
    const { status, output } = runGate(
      'valid.capabilities.yaml',
      'debt-baseline-with-no-owner.json',
    )
    expect(output).toContain('1 STALE baseline entry(ies)')
    expect(output).toContain('claims debt that no longer occurs')
    expect(output).toContain(OWNER_PROBLEM)
    expect(output).not.toContain('known debt problem(s)')
    expect(output).toContain(
      'known debt 0 (must be empty by wave 6), new problems 0, stale baseline entries 1',
    )
    expect(status).toBe(1)
  })
})
