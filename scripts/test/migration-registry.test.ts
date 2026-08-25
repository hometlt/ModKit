import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const gate = join(scriptsDir, 'migration', 'check-registry.mjs')
const fixtures = join(scriptsDir, 'test', 'fixtures', 'migration-registry')

function runGate(registry: string, projections = 'valid.projections.yaml') {
  const result = spawnSync(
    process.execPath,
    [
      gate,
      '--inventory',
      join(fixtures, 'inventory.json'),
      '--registry',
      join(fixtures, registry),
      '--projections',
      join(fixtures, projections),
    ],
    { encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('capability registry gate (plan §3.3–3.4, block 10 works 4–6 and 10–11)', () => {
  it('accepts a registry whose rows are complete and whose inventory is fully accounted for', () => {
    const { status, stdout, stderr } = runGate('valid.capabilities.yaml')
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('1 mapped + 1 unmapped = 2 source units')
  })

  it('refuses a capability row with no owner', () => {
    const { status, stderr } = runGate('no-owner.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('owner is required')
  })

  it('refuses a source inventory ID the inventory does not contain', () => {
    const { status, stderr } = runGate('unknown-source-unit.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('does not exist in the source inventory')
  })

  it('refuses a lost source unit: neither mapped to a capability nor declared unmapped', () => {
    const { status, stderr } = runGate('lost-unit.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('neither mapped to a capability nor listed as unmapped')
    expect(stderr).toContain('legacy/script/demo.ts')
  })

  it('refuses a document plane that claims the UVD portable profile', () => {
    const { status, stderr } = runGate(
      'valid.capabilities.yaml',
      'uvd-as-document.projections.yaml',
    )
    expect(status).toBe(1)
    expect(stderr).toContain('uvd-is-not-a-document')
  })

  it('checks the committed registry and projection matrix against the real inventory', () => {
    const result = spawnSync(process.execPath, [gate], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('projection planes')
  })
})
