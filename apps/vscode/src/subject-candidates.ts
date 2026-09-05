/** URI/workspace routing for language completions backed by live served subjects. */
import type { Lease, SubjectCandidateProvider } from '@modkit/sdk'

export const SUBJECT_SELECTOR_SOURCE = Object.freeze({
  contract: 'common.view/subject-selector-source',
  major: 1,
} as const)

interface DataSourceAdvertisement {
  readonly dataSources: readonly Readonly<{ contract: string; major: number }>[]
}

/** Require the exact admitted source contract and major; similarly named sources stay closed. */
export function advertisesSubjectCandidates(descriptor: DataSourceAdvertisement): boolean {
  return descriptor.dataSources.some(
    source =>
      source.contract === SUBJECT_SELECTOR_SOURCE.contract &&
      source.major === SUBJECT_SELECTOR_SOURCE.major,
  )
}

export interface VsCodeSubjectCandidateScope {
  readonly uri: string
  readonly workspaceUri?: string
  readonly containerUri?: string
}

export interface VsCodeScopedSubjectCandidates extends VsCodeSubjectCandidateScope {
  readonly available: boolean
  open(signal?: AbortSignal): Promise<Lease<SubjectCandidateProvider> | undefined>
}

const uniqueAvailable = (
  entries: readonly VsCodeScopedSubjectCandidates[],
): VsCodeScopedSubjectCandidates | undefined => {
  const available = entries.filter(entry => entry.available)
  return available.length === 1 ? available[0] : undefined
}

/** Prefer an exact subject, then its container, then one unambiguous subject in the workspace. */
export function selectScopedSubjectCandidates(
  scope: VsCodeSubjectCandidateScope,
  entries: readonly VsCodeScopedSubjectCandidates[],
): VsCodeScopedSubjectCandidates | undefined {
  const exact = entries.filter(entry => entry.uri === scope.uri)
  if (exact.length > 0) return uniqueAvailable(exact)

  if (scope.containerUri !== undefined) {
    const container = entries.filter(
      entry => entry.uri === scope.containerUri || entry.containerUri === scope.containerUri,
    )
    if (container.length > 0) return uniqueAvailable(container)
  }

  if (scope.workspaceUri !== undefined) {
    const workspace = entries.filter(entry => entry.workspaceUri === scope.workspaceUri)
    if (workspace.length > 0) return uniqueAvailable(workspace)
  }
  return undefined
}
