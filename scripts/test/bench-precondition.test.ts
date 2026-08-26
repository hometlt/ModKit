import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BENCH_BUNDLE_ENTRIES,
  checkBenchBundlePrecondition,
} from '../bench/bundle-precondition.mjs'

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
const scratchRoots: string[] = []

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sha256(contents: string) {
  return createHash('sha256').update(contents).digest('hex')
}

function createBundledFixture(label: string) {
  const root = mkdtempSync(join(tmpdir(), `x3-bench-precondition-${label}-`))
  scratchRoots.push(root)

  const contents = Object.fromEntries(
    BENCH_BUNDLE_ENTRIES.map(entry => [entry, `// reviewed production bundle: ${entry}\n`]),
  )
  for (const [entry, source] of Object.entries(contents)) {
    const path = join(root, entry)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source, 'utf8')
  }

  const manifestPath = join(root, 'scripts', 'bundle-hashes.json')
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      Object.fromEntries(
        Object.entries(contents).map(([entry, source]) => [entry, sha256(source)]),
      ),
      null,
      2,
    )}\n`,
    'utf8',
  )
  return { root, manifestPath }
}

const injectedMeasurements = {
  'core-import': { p50: 9, p95: 10, spread: 0.05, n: 15 },
  'closure-import': { p50: 42, p95: 45, spread: 0.05, n: 15 },
  'cli-validate-net': { p50: 200, p95: 210, spread: 0.05, n: 20 },
}

function installBenchHarness(root: string) {
  const scripts = join(root, 'scripts')
  const benchDir = join(scripts, 'bench')
  mkdirSync(benchDir, { recursive: true })
  copyFileSync(join(sourceRoot, 'scripts', 'bench.mjs'), join(scripts, 'bench.mjs'))
  for (const file of ['bundle-precondition.mjs', 'paired.mjs']) {
    copyFileSync(join(sourceRoot, 'scripts', 'bench', file), join(benchDir, file))
  }
  const samples = join(root, 'samples.json')
  writeFileSync(samples, JSON.stringify({ measurements: injectedMeasurements }), 'utf8')
  return { bench: join(scripts, 'bench.mjs'), samples }
}

async function runBench(root: string, ...flags: string[]) {
  const { spawnSync } = await import('node:child_process')
  const { bench, samples } = installBenchHarness(root)
  const result = spawnSync(process.execPath, [bench, ...flags, '--samples', samples], {
    cwd: root,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('benchmark production-bundle precondition', () => {
  it('accepts all five byte-identical pinned benchmark artifacts', () => {
    const { root } = createBundledFixture('valid')
    expect(checkBenchBundlePrecondition({ root })).toEqual({ ok: true, issues: [] })
  })

  it.each([
    ['stale', 'packages/core/dist/index.js', '// stale output\n'],
    ['modular', 'packages/sdk/dist/index.js', "export * from './internal.js'\n"],
  ])('rejects %s dist bytes', (_label, entry, replacement) => {
    const { root } = createBundledFixture(String(_label))
    writeFileSync(join(root, entry), replacement, 'utf8')

    const result = checkBenchBundlePrecondition({ root })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({ kind: 'hash-mismatch', entry }))
  })

  it('rejects a missing dist entry before any scenario can run', () => {
    const { root } = createBundledFixture('missing')
    const entry = 'packages/vfs/dist/index.js'
    rmSync(join(root, entry))

    const result = checkBenchBundlePrecondition({ root })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: 'entry-unreadable', entry }),
    )
  })

  it('treats an unpinned CLI target as a configuration error', () => {
    const { root, manifestPath } = createBundledFixture('unpinned-cli')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>
    delete manifest['apps/modkit-cli/dist/main.js']
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')

    const result = checkBenchBundlePrecondition({ root })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        kind: 'entry-unpinned',
        entry: 'apps/modkit-cli/dist/main.js',
      }),
    )
  })

  it('prints no timings and exits 0 when an informational run is inconclusive', async () => {
    const { root } = createBundledFixture('informational')
    writeFileSync(join(root, 'packages/host/dist/index.js'), '// stale output\n', 'utf8')

    const { status, stdout, stderr } = await runBench(root)
    expect(status).toBe(0)
    expect(stdout).toContain('INCONCLUSIVE')
    expect(stdout).toContain('no timings were collected')
    expect(stdout).not.toMatch(/\bp(?:50|95)\b/)
    expect(stderr).toBe('')
  })

  it('prints no timings and exits 2 when a gated run is inconclusive', async () => {
    const { root } = createBundledFixture('gate')
    rmSync(join(root, 'apps/modkit-cli/dist/main.js'))

    const { status, stdout, stderr } = await runBench(root, '--gate')
    expect(status).toBe(2)
    expect(stderr).toContain('INCONCLUSIVE')
    expect(stderr).toContain('no timings were collected')
    expect(stderr).not.toMatch(/\bp(?:50|95)\b/)
    expect(stdout).toBe('')
  })

  it('continues to the verdict logic only when the precondition passes', async () => {
    const { root } = createBundledFixture('pass')
    const { status, stdout, stderr } = await runBench(root, '--gate')
    expect(status, stderr).toBe(0)
    expect(stdout).toContain('core-import')
    expect(stdout).toContain('bench gate: passed')
  })
})
