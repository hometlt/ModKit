export const BUNDLED_ROOT_CLOSURE_ENTRIES: readonly string[]
export const BENCH_BUNDLE_ENTRIES: readonly string[]

export interface BenchBundleIssue {
  readonly kind:
    | 'manifest-unreadable'
    | 'manifest-invalid'
    | 'entry-unpinned'
    | 'entry-unreadable'
    | 'hash-mismatch'
  readonly entry?: string
  readonly detail?: string
  readonly expected?: string
  readonly actual?: string
}

export interface BenchBundlePreconditionOptions {
  readonly root: string
  readonly manifestPath?: string
  readonly entries?: readonly string[]
}

export function checkBenchBundlePrecondition(options: BenchBundlePreconditionOptions): {
  readonly ok: boolean
  readonly issues: readonly BenchBundleIssue[]
}

export function formatBenchBundleIssues(issues: readonly BenchBundleIssue[]): string
