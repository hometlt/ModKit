import type { SourceObservation } from './classify.mjs'

export function observeDataSource(
  contract: string,
  major: number,
  source: unknown,
  options?: Readonly<{
    readNamespaceEntry?: (
      entry: Readonly<{ id: string; path: string }>,
    ) => Promise<Readonly<{ bytes: number; productReopenCompleted: boolean }>>
  }>,
): Promise<SourceObservation>
