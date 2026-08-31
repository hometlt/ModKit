/**
 * Permission grants (owner: MK3/24 §3.1 + §4). A grant is created for an operation or a
 * session, never as an unbounded global boolean, and a nested call may only narrow:
 *
 *     parent grant ∩ callee manifest request ∩ host policy ∩ operation scope = child grant
 *
 * Invariants enforced here (24 §15): missing permission means deny; a child never widens
 * its parent; an unparseable or expired validity window is a denial, not a default-allow.
 */

import { ModkitError, uniqueSortedUtf8 } from '@modkit/core'
import type { PermissionClass } from '../manifest/contribution-types.js'

export interface GrantedPathScope {
  /** Source ref id (24 §3.1: a SourceRef, never an ambient absolute-path string). */
  readonly root: string
  readonly access: 'read' | 'write' | 'read-write'
  readonly recursive: boolean
}

export interface GrantedNetworkScope {
  /** Normalized URL origins; wildcards are host policy, never implicit string matching. */
  readonly origins: readonly string[]
  readonly methods?: readonly string[]
  readonly allowCredentials?: boolean
}

export interface CredentialGrantRef {
  readonly id: string
  readonly class: string
  readonly scope: string
  readonly audience?: string
}

export interface PermissionGrant {
  readonly id: string
  readonly classes: readonly PermissionClass[]
  readonly subjectScope?: readonly string[]
  readonly sourceScope?: readonly string[]
  readonly filesystem?: readonly GrantedPathScope[]
  readonly network?: readonly GrantedNetworkScope[]
  readonly credentials?: readonly CredentialGrantRef[]
  /** ISO-8601 instant; anything unparseable is treated as already expired (fail-closed). */
  readonly expiresAt?: string
  readonly parentGrant?: string
}

export interface HostPolicy {
  /** Upper bound the host is willing to grant at all; undefined = no extra narrowing. */
  readonly allowedClasses?: readonly PermissionClass[]
  /** Operation-scoped ceiling, applied on top of `allowedClasses`. */
  readonly operationClasses?: Readonly<Record<string, readonly PermissionClass[]>>
}

export type GrantValidity =
  | { readonly state: 'valid' }
  | { readonly state: 'expired'; readonly at: string }
  | { readonly state: 'malformed'; readonly value: string }

/** Fail-closed: only a parseable instant strictly in the future keeps a grant usable. */
export function grantValidity(grant: PermissionGrant, now = Date.now()): GrantValidity {
  if (grant.expiresAt === undefined) return { state: 'valid' }
  const parsed = Date.parse(grant.expiresAt)
  if (Number.isNaN(parsed)) return { state: 'malformed', value: grant.expiresAt }
  return parsed > now ? { state: 'valid' } : { state: 'expired', at: grant.expiresAt }
}

function intersectClasses(
  a: readonly PermissionClass[],
  b: readonly PermissionClass[],
): PermissionClass[] {
  return uniqueSortedUtf8(a.filter(cls => b.includes(cls))) as PermissionClass[]
}

function intersectStrings(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] | undefined {
  if (a === undefined) return b === undefined ? undefined : [...b]
  if (b === undefined) return [...a]
  return uniqueSortedUtf8(a.filter(item => b.includes(item)))
}

function narrowPaths(
  parent: readonly GrantedPathScope[] | undefined,
  requestedRoots: readonly string[] | undefined,
): GrantedPathScope[] | undefined {
  if (parent === undefined) return undefined
  if (requestedRoots === undefined) return [...parent]
  return parent.filter(scope => requestedRoots.includes(scope.root))
}

function narrowNetwork(
  parent: readonly GrantedNetworkScope[] | undefined,
  requestedOrigins: readonly string[] | undefined,
): GrantedNetworkScope[] | undefined {
  if (parent === undefined) return undefined
  if (requestedOrigins === undefined) return [...parent]
  return parent
    .map(scope => ({
      ...scope,
      origins: scope.origins.filter(origin => requestedOrigins.includes(origin)),
    }))
    .filter(scope => scope.origins.length > 0)
}

export interface NarrowRequest {
  /** What the callee's runtime variant declares it needs (24 §3, the authored source). */
  readonly requestedClasses: readonly PermissionClass[]
  readonly requestedSourceRoots?: readonly string[]
  readonly requestedOrigins?: readonly string[]
  readonly operation?: string
  readonly policy?: HostPolicy
  readonly childId: string
}

/**
 * `parent ∩ callee request ∩ host policy ∩ operation scope`. Returns the child grant plus
 * the classes that were asked for and could not be granted — the caller decides whether a
 * non-empty `missing` is a hard denial (activation) or a degraded capability (broker).
 */
export function narrowGrant(
  parent: PermissionGrant,
  request: NarrowRequest,
): { readonly child: PermissionGrant; readonly missing: readonly PermissionClass[] } {
  const validity = grantValidity(parent)
  if (validity.state !== 'valid') {
    // A dead parent cannot produce a live child.
    return {
      child: { id: request.childId, classes: [], parentGrant: parent.id },
      missing: uniqueSortedUtf8(request.requestedClasses) as PermissionClass[],
    }
  }
  let allowed = intersectClasses(request.requestedClasses, parent.classes)
  const policy = request.policy
  if (policy?.allowedClasses !== undefined) {
    allowed = intersectClasses(allowed, policy.allowedClasses)
  }
  if (request.operation !== undefined && policy?.operationClasses !== undefined) {
    const ceiling = policy.operationClasses[request.operation]
    if (ceiling !== undefined) allowed = intersectClasses(allowed, ceiling)
  }
  const missing = uniqueSortedUtf8(
    request.requestedClasses.filter(cls => !allowed.includes(cls)),
  ) as PermissionClass[]

  const sourceScope = intersectStrings(parent.sourceScope, request.requestedSourceRoots)
  const filesystem = narrowPaths(parent.filesystem, request.requestedSourceRoots)
  const network = narrowNetwork(parent.network, request.requestedOrigins)

  const child: PermissionGrant = {
    id: request.childId,
    classes: allowed,
    parentGrant: parent.id,
    ...(parent.subjectScope === undefined ? {} : { subjectScope: [...parent.subjectScope] }),
    ...(sourceScope === undefined ? {} : { sourceScope }),
    ...(filesystem === undefined ? {} : { filesystem }),
    ...(network === undefined ? {} : { network }),
    ...(parent.credentials === undefined ? {} : { credentials: [...parent.credentials] }),
    ...(parent.expiresAt === undefined ? {} : { expiresAt: parent.expiresAt }),
  }
  return { child, missing }
}

/** Structural check that a child never widens its parent (24 §15.4) — used by tests/gates. */
export function assertNotWider(parent: PermissionGrant, child: PermissionGrant): void {
  const widened = child.classes.filter(cls => !parent.classes.includes(cls))
  if (widened.length > 0) {
    throw new ModkitError({
      code: 'x3.sdk/grant-widened',
      message: `child grant «${child.id}» adds classes its parent «${parent.id}» does not hold: ${widened.join(', ')}`,
      context: { widened },
    })
  }
}
