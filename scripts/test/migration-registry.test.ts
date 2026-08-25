import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

  it('refuses a UVP plane that also claims an execute action', () => {
    const { status, stderr } = runGate('valid.capabilities.yaml', 'uvp-executes.projections.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('uvp-is-data-only')
  })

  it('refuses a dependsOn target the registry does not contain', () => {
    const { status, stderr } = runGate('unknown-dependency.capabilities.yaml')
    expect(status).toBe(1)
    expect(stderr).toContain('does not exist in the registry')
  })

  it('checks the committed registry and projection matrix against the real inventory', () => {
    const result = spawnSync(process.execPath, [gate], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('projection planes')
  })
})

const priorityGate = join(scriptsDir, 'migration', 'emit-priority-scope.mjs')
// Fixture runs never write into the repository: the closure output goes to a throwaway directory.
const scopeOut = mkdtempSync(join(tmpdir(), 'x3-priority-scope-'))

function runPriority(registry: string, extra: readonly string[] = []) {
  const result = spawnSync(
    process.execPath,
    [priorityGate, '--registry', join(fixtures, registry), '--out-dir', scopeOut, ...extra],
    { encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('phase-aware priority gate (plan §3.5, block 10 works 6–7)', () => {
  it('passes a phase in which nothing is due yet', () => {
    const { status, stdout, stderr } = runPriority('valid.capabilities.yaml', [
      '--phase',
      'block-10',
    ])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('phase block-10 clean')
  })

  it('fails on a priority unit whose planned block has passed while it is still unresolved', () => {
    const { status, stderr } = runPriority('overdue.capabilities.yaml', ['--phase', 'block-10'])
    expect(status).toBe(1)
    expect(stderr).toContain('overdue priority unit')
    expect(stderr).toContain('migrationState missing')
  })

  it('fails on a hidden skip: an overdue unit resting on a corpus published as unavailable', () => {
    const { status, stderr } = runPriority('hidden-skip.capabilities.yaml', [
      '--phase',
      'block-10',
      '--corpora',
      join(fixtures, 'unavailable-corpora.json'),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain('hidden skip, not a pass')
  })

  it('keeps the committed closures fresh and free of overdue units at the current phase', () => {
    const result = spawnSync(process.execPath, [priorityGate, '--check', '--phase', 'block-10'], {
      encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mk3-ga')
  })
})

describe('product profile gate (plan §4.2–4.3, block 10 work 8)', () => {
  it('accepts the committed composition lock', () => {
    const result = spawnSync(
      process.execPath,
      [join(scriptsDir, 'migration', 'check-profiles.mjs')],
      {
        encoding: 'utf8',
      },
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('bundle baseline')
  })

  it('refuses a preset that names an extension family the tree does not declare', () => {
    const broken = join(fixtures, 'broken-profiles.json')
    const result = spawnSync(
      process.execPath,
      [join(scriptsDir, 'migration', 'check-profiles.mjs'), '--profiles', broken],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not declared in scripts/app-extension-sets.mjs')
  })
})
