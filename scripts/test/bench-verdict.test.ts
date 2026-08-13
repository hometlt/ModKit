import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Tests for the bench harness's *verdict* logic (owner instruction 5, 2026-08-14): until
 * now `pnpm check` proved the product but never the thing that decides whether a budget is
 * met. Real timings would make these tests slow and flaky, so measurements are injected
 * through `--samples` while every rule under test — exit codes, probe blocking, drift,
 * normalisation scope — runs exactly the production path.
 */

const scriptsDir = fileURLToPath(new URL('..', import.meta.url))
const bench = join(scriptsDir, 'bench.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'x3-bench-verdict-'))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const stat = (p50: number, spread = 0.05) => ({ p50, p95: p50 * 1.2, spread, n: 15 })

/** A session that is comfortably inside every gate, with calibration at baseline. */
function healthy() {
  return {
    baselines: {
      probes: {
        'probe1-existing-module': stat(1.5),
        'probe9-existing-graph': stat(22),
      },
      scenarios: {
        'core-import': stat(10),
        'closure-import': stat(40),
        'inventory-100-synthetic': stat(1),
        'resolve-explain-per-contract': stat(0.01),
        'cli-validate-net': stat(200),
      },
    },
    measurements: {
      'probe1-existing-module': stat(1.5),
      'probe9-existing-graph': stat(22),
      'core-import': stat(10),
      'closure-import': stat(40),
      'inventory-100-synthetic': stat(1),
      'resolve-explain-per-contract': stat(0.01),
      'cli-validate-net': stat(200),
    },
  }
}

function runGate(samples: unknown, label: string) {
  const file = join(tmp, `${label}.json`)
  writeFileSync(file, JSON.stringify(samples), 'utf8')
  const result = spawnSync(process.execPath, [bench, '--gate', '--samples', file], {
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('bench verdict logic', () => {
  it('exit 0 when calibration is comparable and every scenario is inside its gate', () => {
    const { status, stdout } = runGate(healthy(), 'pass')
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('bench gate: passed')
  })

  it('exit 1 on a stable breach, naming the scenario and its gate', () => {
    const s = healthy()
    s.measurements['core-import'] = stat(18)
    const { status, stderr } = runGate(s, 'breach')
    expect(status).toBe(1)
    expect(stderr).toContain('bench gate: FAILED')
    expect(stderr).toContain('core-import')
    expect(stderr).toContain('15 ms gate')
  })

  it('exit 1 on a stable regression even while inside the gate', () => {
    const s = healthy()
    s.measurements['closure-import'] = stat(49) // under the 50 ms gate, but 40 -> 49 is >20%
    const { status, stderr } = runGate(s, 'regression')
    expect(status).toBe(1)
    expect(stderr).toContain('regressed past')
  })

  it('exit 2 when the blocking calibrator probe9 drifted', () => {
    const s = healthy()
    s.measurements['probe9-existing-graph'] = stat(40) // ×1.8 of baseline
    const { status, stderr } = runGate(s, 'probe9-drift')
    expect(status).toBe(2)
    expect(stderr).toContain('INCONCLUSIVE')
    expect(stderr).toContain('probe9-existing-graph')
  })

  it('exit 2 when probe9 is noisy', () => {
    const s = healthy()
    s.measurements['probe9-existing-graph'] = stat(22, 0.6)
    const { status, stderr } = runGate(s, 'probe9-noise')
    expect(status).toBe(2)
    expect(stderr).toContain('INCONCLUSIVE')
  })

  it('probe1 never blocks — neither its noise nor its drift changes the verdict', () => {
    const noisy = healthy()
    noisy.measurements['probe1-existing-module'] = stat(1.5, 0.9)
    expect(runGate(noisy, 'probe1-noise').status).toBe(0)

    const drifted = healthy()
    drifted.measurements['probe1-existing-module'] = stat(0.6) // ×0.4 of baseline
    const result = runGate(drifted, 'probe1-drift')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('informational, never gates')
  })

  it('a blocking calibration failure outranks a scenario breach', () => {
    const s = healthy()
    s.measurements['core-import'] = stat(18) // would be exit 1 on its own
    s.measurements['probe9-existing-graph'] = stat(40) // but the machine is not comparable
    const { status, stderr } = runGate(s, 'calibration-outranks')
    expect(status).toBe(2)
    expect(stderr).toContain('calibration probes are not comparable')
  })

  it('normalisation is shown for cold-import scenarios only', () => {
    const s = healthy()
    s.measurements['probe9-existing-graph'] = stat(26) // ×1.18: drift without blocking
    const { stdout } = runGate(s, 'normalized-scope')
    const line = (id: string) => stdout.split('\n').find(l => l.startsWith(id)) ?? ''
    expect(line('core-import')).toContain('normalized')
    expect(line('closure-import')).toContain('normalized')
    expect(line('inventory-100-synthetic')).not.toContain('normalized')
    expect(line('resolve-explain-per-contract')).not.toContain('normalized')
    expect(line('cli-validate-net')).not.toContain('normalized')
  })

  it('a noisy scenario near its gate is inconclusive, not a pass', () => {
    const s = healthy()
    s.measurements['cli-validate-net'] = stat(200, 0.5)
    const { status, stderr } = runGate(s, 'scenario-noise')
    expect(status).toBe(2)
    expect(stderr).toContain('NOT a pass')
  })
})

describe('paired CLI measurement', () => {
  it('cancels a mid-run slowdown that a block-wise measurement would absorb', async () => {
    const { pairedStats } = await import('../bench/paired.mjs')
    // The machine gets steadily slower during the session; the target always costs exactly
    // 50 ms more than bare node at that same moment.
    let call = 0
    const drifting = (kind: string) => {
      const ambient = 100 + call * 10
      call += kind === 'target' ? 1 : 0
      return kind === 'bare' ? ambient : ambient + 50
    }
    const paired = pairedStats({ timeOnce: drifting, n: 20, warmup: 3 })
    expect(paired.p50).toBeCloseTo(50, 5)
    expect(paired.n).toBe(20)

    // What the old block-wise design would have produced from the same timings: all bare
    // runs first, then all target runs, so the drift lands in the difference.
    const bare: number[] = []
    const target: number[] = []
    let c = 0
    for (let i = 0; i < 23; i += 1) bare.push(100 + c++ * 10)
    for (let i = 0; i < 23; i += 1) target.push(100 + c++ * 10 + 50)
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
    const blockwise = median(target.slice(3)) - median(bare.slice(3))
    expect(blockwise).toBeGreaterThan(200) // the bias the pairing removes
  })
})
