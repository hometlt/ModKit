import type { SourceObservation } from './classify.mjs'

export function observeDataSource(
  contract: string,
  major: number,
  source: unknown,
): Promise<SourceObservation>
