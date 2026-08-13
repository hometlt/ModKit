// Machine-floor calibration probe (C3/L17): cold-imports one trivial generated ESM file.
// Its cost is pure environment — file open + parse + evaluate of ~20 bytes — so it moves
// when the machine is busy and does NOT move when Modkit code changes. Comparing it against
// the floor recorded with the baseline is how a session tells «the machine is slow» from
// «the code got slower»; the spread heuristic alone cannot, because a uniformly loaded box
// produces slow samples with a perfectly tight spread.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'x3-floor-'))
try {
  const samples = []
  for (let i = 0; i < 13; i += 1) {
    const file = join(dir, `probe-${i}.mjs`)
    writeFileSync(file, 'export const x = 1\n')
    const t0 = performance.now()
    await import(pathToFileURL(file).href)
    const ms = performance.now() - t0
    if (i >= 3) samples.push(ms)
  }
  samples.sort((a, b) => a - b)
  const at = p =>
    samples[Math.max(0, Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1))]
  console.log(JSON.stringify({ p50: at(50), p95: at(95), n: samples.length }))
} finally {
  rmSync(dir, { recursive: true, force: true })
}
