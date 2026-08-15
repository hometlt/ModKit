/** Host-local compatibility seam from descriptor v2 to the legacy descriptor-v1 viewer plane. */

import type { AnyDescriptor, AssetDiagnostic, AssetOperationId, TraitInstance } from './types.js'

export const V1_PROJECTION_UNAVAILABLE_CODE =
  'org.modkitx/compat-v1-projection-unavailable' as const

export type V1ContributionKind =
  'stage' | 'tree' | 'panel' | 'toolbar' | 'transport' | 'status' | 'fallback'

/** The data-only v1 catalog projection. It never contains a plan, ticket, digest, or factory. */
export interface V1ViewerContributionDescriptor {
  readonly id: string
  readonly kind: V1ContributionKind
  readonly requiresTraits?: readonly {
    readonly id: string
    /**
     * Custom definition ranges were already evaluated against the bound subject/catalog snapshot.
     * The legacy v1 consumer must not re-evaluate this lossy compatibility projection.
     */
    readonly states?: readonly TraitInstance['state'][]
  }[]
  readonly requiresOperations?: readonly AssetOperationId[]
  readonly hosts?: readonly string[]
  readonly priority: number
  readonly conflicts?: readonly string[]
  readonly singletonGroup?: string
  readonly label?: string
}

/**
 * Proof that catalog evaluation completed for this exact catalog revision. An empty compatible
 * list therefore means a proven zero-match and may trigger the v1 host fallback.
 */
export interface V1ProjectionCatalogContext {
  readonly state: 'evaluated'
  /** Subject/revision against whose v2 facts compatibility was evaluated. */
  readonly subjectUri: string
  readonly revision: AnyDescriptor['revision']
  readonly catalogRevision: string
  readonly compatibleContributions: readonly V1ViewerContributionDescriptor[]
}

/**
 * The only v1 field whose value depends on the installed catalog. A-3's host adapter merges this
 * non-persistable patch into the host's complete v1 compatibility descriptor.
 */
export interface V1DescriptorProjection {
  readonly schemaVersion: 1
  readonly contributions: readonly V1ViewerContributionDescriptor[]
  /** Prevents reuse after the host catalog changes. */
  readonly catalogRevision: string
  readonly persistable: false
}

export interface V1ProjectionUnavailableDiagnostic extends AssetDiagnostic {
  readonly code: typeof V1_PROJECTION_UNAVAILABLE_CODE
  readonly category: 'dependency'
}

export type V1DescriptorProjectionResult =
  | { readonly state: 'projected'; readonly projection: V1DescriptorProjection }
  | {
      readonly state: 'unavailable'
      readonly diagnostics: readonly [V1ProjectionUnavailableDiagnostic, ...AssetDiagnostic[]]
    }

/**
 * A-1 contract only. The host-local implementation, catalog evaluation, and v1 descriptor
 * assembly belong to A-3.
 */
export interface V1DescriptorProjectionPort {
  project(
    descriptor: AnyDescriptor,
    catalog: V1ProjectionCatalogContext | undefined,
    signal?: AbortSignal,
  ): Promise<V1DescriptorProjectionResult>
}
