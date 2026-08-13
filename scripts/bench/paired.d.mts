// Types for the paired-measurement module. The bench harness is plain JavaScript by design
// (it must run without a build step), so its testable pieces declare their shape here.

export interface PairedStats {
  readonly p50: number
  readonly p95: number
  readonly spread: number
  readonly n: number
  readonly rawP50: number
}

export function percentileOf(samples: readonly number[], p: number): number

export function pairedStats(options: {
  readonly timeOnce: (kind: 'bare' | 'target') => number
  readonly n: number
  readonly warmup?: number
}): PairedStats
