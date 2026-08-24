export interface ParityResult {
  readonly format: string
  readonly state: 'compared' | 'failed' | 'skipped'
  readonly classification?: 'паритет' | 'X3 беднее' | 'X3 богаче' | 'нет в X3'
  readonly allowPoorerReason?: string
  readonly [key: string]: unknown
}

export interface ParityReportOptions {
  readonly corpus: string
  readonly canonical: Readonly<{ root: string; sha: string }>
  readonly x3: Readonly<{ root: string; sha: string }>
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
  schemaVersion: 2
  corpus: string
  canonical: Readonly<{ root: string; sha: string }>
  x3: Readonly<{ root: string; sha: string }>
  summary: readonly unknown[]
  poorer: readonly unknown[]
  results: readonly ParityResult[]
}>

export function blockingParityResults(results: readonly ParityResult[]): readonly ParityResult[]
