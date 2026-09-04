/*
 * GA recovery wave 2C §3 (F12): the parity matrix must be generated from migration/capabilities.yaml
 * and migration/generated/vscode-workflow-ledger.json, and this test is the thing that catches a
 * hand edit or a stale commit — the same job migration-registry-debt-baseline.test.ts and
 * vscode-workflow-ledger.test.ts's "checks drift without rewriting a stale artifact" case do for
 * their own generated artifacts. Regenerate in memory, diff against the committed file, and on
 * mismatch fail loudly without touching the committed copy — a --check run must never silently
 * rewrite a stale artifact into looking current.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const emitter = join(repoRoot, 'scripts', 'migration', 'emit-parity-matrix.mjs')
const registryPath = join(repoRoot, 'migration', 'capabilities.yaml')
const ledgerPath = join(repoRoot, 'migration', 'generated', 'vscode-workflow-ledger.json')
const committedMatrix = join(repoRoot, 'migration', 'generated', 'parity-matrix.md')

function run(args: readonly string[]) {
  return spawnSync(process.execPath, [emitter, ...args], { encoding: 'utf8' })
}

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'modkit-parity-matrix-')), name)
}

describe('generated parity matrix (F12)', () => {
  it('is up to date with capabilities.yaml and the workflow ledger', () => {
    const result = run(['--check'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('up to date')
  })

  it('reflects every ledger disposition basket and every registry family', () => {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    const matrix = readFileSync(committedMatrix, 'utf8')
    for (const disposition of ['already-equivalent', 'release-candidate', 'post-release']) {
      expect(matrix).toContain(`\`${disposition}\``)
      expect(matrix).toContain(String(ledger.counts.byDisposition[disposition]))
    }
    for (const workflow of ledger.workflows as { workflowId: string }[]) {
      expect(matrix).toContain(`\`${workflow.workflowId}\``)
    }
    expect(matrix).toContain(String(ledger.counts.total))
  })

  it('points readers at the retired manual matrix instead of reproducing its prose', () => {
    const matrix = readFileSync(committedMatrix, 'utf8')
    expect(matrix).toContain(
      'references/modkit-docs/MK3/archive/MK3_COMPONENT_TEST_MATRIX_2026-08-31.md',
    )
    // The retired document is hand-written tester prose (Scenario/Input/Expected/Actual columns,
    // ✅/🟡/❌ status emoji); this generated matrix must not try to reproduce that table shape.
    expect(matrix).not.toContain('| Scenario | Input | Expected | Actual |')
    expect(matrix).not.toMatch(/[✅🟡❌⚠️⛔📋]/u)
  })

  it('fails loudly on a registry row mutated after generation, without rewriting the committed file', () => {
    const registry = readFileSync(registryPath, 'utf8')
    // Flip one evidenceLevel so the regenerated matrix disagrees with the committed one, the same
    // shape of drift the real registry could carry if a hand edit slipped past emit-parity-matrix.
    const mutated = registry.replace("evidenceLevel: 'E2'", "evidenceLevel: 'E3'")
    expect(mutated).not.toBe(registry)
    const mutatedRegistryPath = tempPath('capabilities.yaml')
    writeFileSync(mutatedRegistryPath, mutated)

    const output = tempPath('parity-matrix.md')
    writeFileSync(output, readFileSync(committedMatrix, 'utf8'))
    const before = readFileSync(output, 'utf8')

    const result = run(['--check', '--registry', mutatedRegistryPath, '--output', output])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is stale')
    expect(readFileSync(output, 'utf8')).toBe(before)
  })

  it('checks drift without rewriting a stale artifact', () => {
    const output = tempPath('parity-matrix.md')
    writeFileSync(output, '# stale\n')
    const before = readFileSync(output, 'utf8')

    const result = run(['--check', '--output', output])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is stale')
    expect(readFileSync(output, 'utf8')).toBe(before)
  })

  it('refuses a missing registry input instead of silently emitting an incomplete matrix', () => {
    const result = run(['--registry', tempPath('missing.yaml'), '--output', tempPath('out.md')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing registry input')
  })

  it('refuses a missing ledger input instead of silently emitting an incomplete matrix', () => {
    const result = run(['--ledger', tempPath('missing.json'), '--output', tempPath('out.md')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing ledger input')
  })
})
