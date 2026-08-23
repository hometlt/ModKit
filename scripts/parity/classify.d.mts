export interface ParityComparison {
  readonly classification: 'паритет' | 'X3 беднее' | 'X3 богаче' | 'нет в X3'
  readonly missing: readonly string[]
  readonly extra: readonly string[]
}

export function classifyParity(
  canonicalFeatures: readonly string[],
  x3Features: readonly string[],
  x3Available?: boolean,
): ParityComparison

export function comparableMetadataFeatures(summary: Readonly<Record<string, unknown>>): string[]
