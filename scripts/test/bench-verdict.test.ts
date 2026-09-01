import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { BENCH_BUNDLE_ENTRIES } from '../bench/bundle-precondition.mjs'

/**
 * Tests for what the bench harness decides (owner instruction, 2026-08-14). The harness is
 * now deliberately small — three scenarios, absolute budgets, no probes or normalisation —
 * so these tests are correspondingly small: informational runs never fail, a gated run
 * fails on a stable breach, and a noisy gated run is not reported as a pass.
 *
 * Measurements are injected through `--samples`; every rule under test runs the production
 * path.
 */

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'x3-bench-verdict-'))
const fixtureRoot = join(tmp, 'repository')

function installBenchHarness() {
  const fixtureScriptsDir = join(fixtureRoot, 'scripts')
  const fixtureBenchDir = join(fixtureScriptsDir, 'bench')
  mkdirSync(fixtureBenchDir, { recursive: true })
  copyFileSync(join(scriptsDir, 'bench.mjs'), join(fixtureScriptsDir, 'bench.mjs'))
  for (const file of ['bundle-precondition.mjs', 'paired.mjs']) {
    copyFileSync(join(scriptsDir, 'bench', file), join(fixtureBenchDir, file))
  }

  const hashes: Record<string, string> = {}
  for (const entry of BENCH_BUNDLE_ENTRIES) {
    const contents = `// isolated reviewed benchmark bundle: ${entry}\n`
    const path = join(fixtureRoot, entry)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents, 'utf8')
    hashes[entry] = createHash('sha256').update(contents).digest('hex')
  }
  writeFileSync(join(fixtureScriptsDir, 'bundle-hashes.json'), JSON.stringify(hashes), 'utf8')
  return join(fixtureScriptsDir, 'bench.mjs')
}

const bench = installBenchHarness()

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const stat = (p50: number, spread = 0.05) => ({ p50, p95: p50 * 1.2, spread, n: 15 })

function samplesFile(measurements: Record<string, unknown>, label: string) {
  const file = join(tmp, `${label}.json`)
  writeFileSync(file, JSON.stringify({ measurements }), 'utf8')
  return file
}

function run(measurements: Record<string, unknown>, label: string, ...flags: string[]) {
  const result = spawnSync(
    process.execPath,
    [bench, ...flags, '--samples', samplesFile(measurements, label)],
    { cwd: fixtureRoot, encoding: 'utf8' },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const inBudget = {
  'core-import': stat(9),
  'closure-import': stat(42),
  'cli-validate-net': stat(200),
}

describe('bench verdict', () => {
  it('an informational run never fails, even when a scenario is over budget', () => {
    const over = { ...inBudget, 'cli-validate-net': stat(400) }
    const { status, stdout } = run(over, 'informational')
    expect(status).toBe(0)
    expect(stdout).toContain('OVER-BUDGET')
    expect(stdout).toContain('informational run — not a gate')
  })

  it('a gated run passes when every scenario is inside its budget', () => {
    const { status, stdout } = run(inBudget, 'gate-pass', '--gate')
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('bench gate: passed')
  })

  it('a gated run fails on a stable breach and names the budget', () => {
    const over = { ...inBudget, 'core-import': stat(18) }
    const { status, stderr } = run(over, 'gate-fail', '--gate')
    expect(status).toBe(1)
    expect(stderr).toContain('bench gate: FAILED')
    expect(stderr).toContain('core-import')
    expect(stderr).toContain('15 ms budget')
  })

  it('a noisy gated scenario is inconclusive, never a pass', () => {
    const noisy = { ...inBudget, 'cli-validate-net': stat(200, 0.6) }
    const { status, stderr } = run(noisy, 'gate-noisy', '--gate')
    expect(status).toBe(2)
    expect(stderr).toContain('INCONCLUSIVE')
    expect(stderr).toContain('NOT a pass')
  })

  it('reports exactly the three scenarios the policy keeps', () => {
    const { stdout } = run(inBudget, 'json', '--json')
    const report = JSON.parse(stdout.slice(stdout.indexOf('{'))) as {
      scenarios: Record<string, unknown>
    }
    expect(Object.keys(report.scenarios).sort()).toEqual([
      'cli-validate-net',
      'closure-import',
      'core-import',
    ])
  })
})

describe('paired CLI measurement', () => {
  it('cancels a mid-run slowdown that a block-wise measurement would absorb', async () => {
    const { pairedStats } = await import('../bench/paired.mjs')
    // The machine slows steadily; the target always costs exactly 50 ms more than bare node
    // at that same moment.
    let call = 0
    const drifting = (kind: 'bare' | 'target') => {
      const ambient = 100 + call * 10
      call += kind === 'target' ? 1 : 0
      return kind === 'bare' ? ambient : ambient + 50
    }
    const paired = pairedStats({ timeOnce: drifting, n: 20, warmup: 3 })
    expect(paired.p50).toBeCloseTo(50, 5)
    expect(paired.n).toBe(20)

    // What the old block-wise design would have produced from the same timings.
    const bare: number[] = []
    const target: number[] = []
    let c = 0
    for (let i = 0; i < 23; i += 1) bare.push(100 + c++ * 10)
    for (let i = 0; i < 23; i += 1) target.push(100 + c++ * 10 + 50)
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
    expect(median(target.slice(3)) - median(bare.slice(3))).toBeGreaterThan(200)
  })
})
