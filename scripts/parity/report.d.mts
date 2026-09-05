export interface ParityResult {
  readonly id?: string
  readonly kind?: 'synthetic' | 'real'
  readonly contributionId?: string
  readonly repositories?: readonly string[]
  readonly format: string
  readonly state: 'compared' | 'failed' | 'skipped'
  readonly classification?: 'паритет' | 'X3 беднее' | 'X3 богаче' | 'нет в X3'
  readonly baseline?: 'паритет' | 'X3 беднее' | 'X3 богаче' | 'нет в X3'
  readonly allowPoorerReason?: string
  readonly [key: string]: unknown
}

export interface ParityCounts {
  readonly total: number
  readonly real: number
  readonly synthetic: number
  readonly compared: number
  readonly skipped: number
  readonly failed: number
  readonly comparedReal: number
  readonly comparedSynthetic: number
  readonly richer: number
  readonly equal: number
  readonly poorer: number
  readonly incomparable: number
}

export interface ParityReportOptions {
  readonly corpus: string
  readonly canonical: Readonly<{ repository: string; commit: string }>
  readonly x3: Readonly<{
    repositories: readonly Readonly<{ id: string; repository: string; commit: string }>[]
  }>
  readonly results: readonly ParityResult[]
}

export function gitSha(
  root: string,
  run?: (
    command: string,
    arguments_: readonly string[],
    options: Readonly<{ encoding: string; windowsHide: boolean }>,
  ) => Readonly<{ status: number | null; stdout: string; stderr: string }>,
): string

export function buildParityReport(options: ParityReportOptions): Readonly<{
  schemaVersion: 4
  corpus: string
  canonical: Readonly<{ repository: string; commit: string }>
  x3: Readonly<{
    repositories: readonly Readonly<{ id: string; repository: string; commit: string }>[]
  }>
  counts: ParityCounts
  summary: readonly unknown[]
  poorer: readonly unknown[]
  incomparable: readonly unknown[]
  skipped: readonly unknown[]
  results: readonly ParityResult[]
}>

export function regressedParityResult(result: ParityResult): string | undefined

export function blockingParityResults(results: readonly ParityResult[]): readonly ParityResult[]
