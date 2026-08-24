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

export type ParityPlane =
  | 'subject-recognition'
  | 'structural-metadata'
  | 'geometry-counts'
  | 'hierarchy'
  | 'materials-textures'
  | 'animation'
  | 'collision'
  | 'palette-voxel-transforms'
  | 'payload-access'
  | 'protected-tail-preservation'
  | 'diagnostics-on-malformed-input'

export type PlaneState = 'compared' | 'canonical-only' | 'x3-only' | 'not-observed'
export type PlaneVerdict = 'richer' | 'equal' | 'poorer' | 'not-observed'
export type ParityVerdict = 'richer' | 'equal' | 'poorer' | 'incomparable'

export interface PlaneComparison {
  readonly plane: ParityPlane
  readonly state: PlaneState
  readonly verdict: PlaneVerdict
}

export const PARITY_PLANES: readonly ParityPlane[]

export function comparisonPlanes(
  canonical: ParitySurface | undefined,
  x3: ParitySurface | undefined,
  comparison: Readonly<{ sources?: readonly SourceParityComparison[] }> | undefined,
  x3Available?: boolean,
): PlaneComparison[]

export function parityVerdict(
  classification: ParityClassification | undefined,
  planes: readonly PlaneComparison[],
): ParityVerdict | undefined
