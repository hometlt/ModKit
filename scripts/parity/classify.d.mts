export type ParityClassification = 'паритет' | 'X3 беднее' | 'X3 богаче' | 'нет в X3'
export type ParityMeasurement = string | number | boolean

export interface SourceObservation {
  readonly contract: string
  readonly major: number
  readonly state: 'opened' | 'failed' | 'skipped'
  readonly features?: readonly string[]
  readonly measurements?: Readonly<Record<string, ParityMeasurement>>
  readonly detail?: string
}

export interface ParitySurface {
  readonly features?: readonly string[]
  readonly sources?: readonly SourceObservation[]
}

export interface ParityComparison {
  readonly classification: ParityClassification
  readonly missing: readonly string[]
  readonly extra: readonly string[]
}

export interface SourceParityComparison extends ParityComparison {
  readonly contract: string
}

export interface FormatParityComparison extends ParityComparison {
  readonly sources: readonly SourceParityComparison[]
}

export function classifyParity(
  canonicalFeatures: readonly string[],
  x3Features: readonly string[],
  x3Available?: boolean,
): ParityComparison

export function compareMeasurements(
  canonicalMeasurements: Readonly<Record<string, ParityMeasurement>>,
  x3Measurements: Readonly<Record<string, ParityMeasurement>>,
): ParityComparison

export function classifySourceParity(
  canonicalSource: SourceObservation,
  x3Source?: SourceObservation,
): SourceParityComparison

export function classifyFormatParity(
  canonical: ParitySurface,
  x3: ParitySurface,
  x3Available?: boolean,
): FormatParityComparison

export function comparableMetadataFeatures(summary: Readonly<Record<string, unknown>>): string[]
