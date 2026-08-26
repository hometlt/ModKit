import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Root entries imported by the core and bootstrap-closure benchmark scenarios. */
export const BUNDLED_ROOT_CLOSURE_ENTRIES = Object.freeze([
  'packages/core/dist/index.js',
  'packages/sdk/dist/index.js',
  'packages/vfs/dist/index.js',
  'packages/host/dist/index.js',
])

/** Every bundled artifact timed by scripts/bench.mjs. */
export const BENCH_BUNDLE_ENTRIES = Object.freeze([
  ...BUNDLED_ROOT_CLOSURE_ENTRIES,
  'apps/modkit-cli/dist/main.js',
])

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function readHashManifest(path) {
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    return {
      issue: {
        kind: 'manifest-unreadable',
        detail: error instanceof Error ? error.message : String(error),
      },
    }
  }

  try {
    const value = JSON.parse(source)
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
      return {
        issue: {
          kind: 'manifest-invalid',
          detail: 'expected a JSON object whose keys are bundled entry paths',
        },
      }
    }
    return { manifest: value }
  } catch (error) {
    return {
      issue: {
        kind: 'manifest-invalid',
        detail: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/**
 * Prove that every artifact the benchmark will time is the reviewed production bundle.
 *
 * A plain `tsc -b` recreates modular dist files at the same public paths. Importing those files
 * still works, but measures a different module graph. Matching the tracked SHA-256 manifest makes
 * missing, stale and modular dist fail closed before the first timer starts. This function only
 * reads the baseline; `scripts/bundle.mjs` remains the sole writer.
 */
export function checkBenchBundlePrecondition({
  root,
  manifestPath = join(root, 'scripts', 'bundle-hashes.json'),
  entries = BENCH_BUNDLE_ENTRIES,
}) {
  const loaded = readHashManifest(manifestPath)
  if (loaded.issue) return { ok: false, issues: [loaded.issue] }

  const issues = []
  for (const entry of entries) {
    const expected = loaded.manifest[entry]
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) {
      issues.push({
        kind: 'entry-unpinned',
        entry,
        detail: 'scripts/bundle-hashes.json has no valid SHA-256 for this benchmark target',
      })
      continue
    }

    let contents
    try {
      contents = readFileSync(join(root, entry))
    } catch (error) {
      issues.push({
        kind: 'entry-unreadable',
        entry,
        detail: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    const actual = sha256(contents)
    if (actual !== expected) {
      issues.push({
        kind: 'hash-mismatch',
        entry,
        expected,
        actual,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

export function formatBenchBundleIssues(issues) {
  return issues
    .map(issue => {
      if (issue.entry === undefined) return `${issue.kind}: ${issue.detail}`
      if (issue.kind === 'hash-mismatch') {
        return `${issue.entry}: SHA-256 differs from the tracked production bundle`
      }
      return `${issue.entry}: ${issue.detail}`
    })
    .join('\n  ')
}
