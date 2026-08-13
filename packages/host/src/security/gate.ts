/**
 * Deny-by-default permission gate + activation (MK3/24 minimum, SB-0 dispatch level;
 * BRIEF-12 §5 S3). The trust ladder: manifests are data; an entry point is imported
 * only AFTER resolution selected it and a grant covers every requested permission
 * class. An unavailable execution profile is a structured refusal, never a silent
 * downgrade (24 §6.1 rule 1). Scoped path/network grants (24 §4) are broker-level and
 * out of the S3 minimum; this gate enforces the class dimension.
 */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import type {
  ContributionManifestV1,
  PermissionClass,
  RuntimeVariantDeclaration,
} from '@modkitx-x3/sdk'

/** Host-side activation grant record (runtime, not the 24 §4 wire PermissionGrant). */
export interface ActivationGrant {
  readonly id: string
  readonly classes: readonly PermissionClass[]
  readonly expiresAt?: string
}

export interface ActivationRequest {
  readonly manifest: ContributionManifestV1
  readonly variantId: string
  /** Base URL/dir of the owning extension artifact; entrypoints resolve against it. */
  readonly baseUrl: URL
  readonly grant: ActivationGrant
  readonly signal?: AbortSignal
}

export interface Activation {
  readonly module: Record<string, unknown>
  readonly variant: RuntimeVariantDeclaration
}

const SUPPORTED_PROFILES = new Set(['trusted-in-process'])

export function checkGrant(
  requested: readonly PermissionClass[],
  grant: ActivationGrant,
): PermissionClass[] {
  if (grant.expiresAt !== undefined && Date.parse(grant.expiresAt) < Date.now()) {
    return [...requested]
  }
  return requested.filter(cls => !grant.classes.includes(cls))
}

/**
 * Resolution → grant → import → (caller executes). Denial happens BEFORE any import:
 * the S3 spy proof asserts a denied entry point was never even loaded.
 */
export async function activateContribution(request: ActivationRequest): Promise<Activation> {
  throwIfAborted(request.signal)
  const variant = (request.manifest.runtimeVariants ?? []).find(
    v => v.variantId === request.variantId,
  )
  if (!variant) {
    throw new ModkitError({
      code: 'x3.host/unknown-variant',
      message: `contribution «${request.manifest.id}» has no runtime variant «${request.variantId}»`,
    })
  }
  if (!SUPPORTED_PROFILES.has(variant.executionProfile)) {
    throw new ModkitError({
      code: 'x3.host/unsupported-execution-profile',
      message: `profile «${variant.executionProfile}» is not available in this host — refusing, never downgrading (24 §6.1)`,
      context: { profile: variant.executionProfile },
    })
  }
  const missing = checkGrant(variant.requestedPermissionClasses, request.grant)
  if (missing.length > 0) {
    throw new ModkitError({
      code: 'x3.host/permission-denied',
      message: `grant «${request.grant.id}» does not cover: ${missing.join(', ')}`,
      context: { missing },
    })
  }
  throwIfAborted(request.signal)
  const entryUrl = new URL(variant.entrypoint, request.baseUrl)
  const module = (await import(entryUrl.href)) as Record<string, unknown>
  return { module, variant }
}
