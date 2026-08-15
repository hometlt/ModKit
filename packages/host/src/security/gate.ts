/**
 * Activation gate (MK3/24 §8 + §4; SB-0 dispatch level). The trust ladder this file
 * implements, in order, before a single byte of extension code is imported:
 *
 *   1. the caller must present an **ActivationTicket** issued by the resolver from a
 *      `resolved` ResolutionResult — a raw manifest is not an admission pass (24 §8:
 *      «нельзя исполнять произвольный extension code»);
 *   2. the ticket must still match the inventory: same extension, contribution, contract,
 *      variant — a manifest swapped after resolution is refused;
 *   3. the concrete runtime target must satisfy the variant's declared constraints;
 *   4. the execution profile must be one this host can actually honour — anything else is
 *      `unresolved`, never a silent downgrade (24 §6.1 rule 1);
 *   5. the grant must be live (fail-closed on malformed/expired) and cover every declared
 *      permission class, narrowed by `parent ∩ request ∩ policy ∩ operation` (24 §4);
 *   6. the entry point must resolve inside its own artifact (see ./entrypoint.ts).
 *
 * Only then is the module imported. `trusted-in-process` additionally emits an explicit
 * full-authority diagnostic: this boundary is audit/policy, not a sandbox (24 §5.1/§6).
 */

import { diagnostic, ModkitError, throwIfAborted, type Diagnostic } from '@modkitx-x3/core'
import { isResolverProduct, resolveProvider } from '../resolution/resolver.js'
import {
  grantValidity,
  narrowGrant,
  type ContributionManifestV1,
  type ExecutionProfile,
  type HostPolicy,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderRequest,
  type ResolutionResult,
  type RuntimeTarget,
  type RuntimeVariantDeclaration,
} from '@modkitx-x3/sdk'
import { resolveContainedEntrypoint } from './entrypoint.js'

/** Profiles this host can honestly enforce today (BRIEF-12 S0–S4 scope). */
export const SUPPORTED_EXECUTION_PROFILES: readonly ExecutionProfile[] = ['trusted-in-process']

declare const TICKET_BRAND: unique symbol

/**
 * Proof that *this host's* resolver selected this exact provider for this exact target.
 *
 * Two mechanisms, because the first alone was not enough (R9, second audit):
 *  - the type carries a phantom brand so TypeScript refuses object literals;
 *  - **membership in a private WeakSet is the actual runtime check**. A structural copy
 *    (`{ ...ticket, variantId: 'other' }`) is a different object and therefore not a
 *    ticket, and a fabricated `{ state: 'resolved' }` cannot be laundered into one
 *    because issuing requires a result the resolver itself produced.
 *
 * Issued tickets are frozen: what the gate verifies is what activation uses.
 */
export interface ActivationTicket {
  readonly [TICKET_BRAND]: true
  readonly extensionId: string
  readonly contributionId: string
  readonly contract: string
  readonly contractMajor: number
  /** Exact logical offer selected when one provider exposes several offers for one contract. */
  readonly offerId: string
  /** Contract-owned canonical non-secret selector; raw facets never enter an activation ticket. */
  readonly contractSelectionKey?: string
  readonly variantId: string
  readonly target: RuntimeTarget
  readonly operation?: string
}

const issuedTickets = new WeakSet<object>()

/**
 * Resolve and issue in one host-owned step. There is deliberately no public way to hand
 * an arbitrary `ResolutionResult` to a ticket issuer: provenance is checked against the
 * resolver's own registry, so only a real resolution can lead to an activation.
 */
export function resolveForActivation(
  request: ProviderRequest,
  offers: readonly ProviderOffer[],
  operation?: string,
): { readonly result: ResolutionResult; readonly ticket?: ActivationTicket } {
  const result = resolveProvider(request, offers)
  if (result.state !== 'resolved') return { result }
  return { result, ticket: issueActivationTicket(result, request.target, operation) }
}

/**
 * Internal issuer — exported for the security suite only, never from the package index.
 * Refuses any result the resolver did not produce.
 */
export function issueActivationTicket(
  result: ResolutionResult,
  target: RuntimeTarget,
  operation?: string,
): ActivationTicket {
  if (!isResolverProduct(result)) {
    throw new ModkitError({
      code: 'x3.host/foreign-resolution-result',
      message:
        'this object was not produced by the host resolver — a ticket can only be issued for a real resolution',
    })
  }
  if (result.state !== 'resolved') {
    throw new ModkitError({
      code: 'x3.host/no-ticket-for-unresolved',
      message: `cannot issue an activation ticket for an unresolved result (${result.reason})`,
      context: { reason: result.reason },
    })
  }
  const offer = result.selected.offer
  const major = result.selected.resolvedContract.major
  const ticket = Object.freeze({
    extensionId: offer.extensionId,
    contributionId: offer.providerId,
    contract: result.selected.resolvedContract.contract,
    contractMajor: major,
    offerId: result.selected.resolvedContract.offerId,
    ...(result.selected.contractSelectionKey === undefined
      ? {}
      : { contractSelectionKey: result.selected.contractSelectionKey }),
    variantId: offer.runtimeVariant,
    target: Object.freeze({ ...target }),
    ...(operation === undefined ? {} : { operation }),
  }) as unknown as ActivationTicket
  issuedTickets.add(ticket)
  return ticket
}

export interface ActivationRequest {
  readonly ticket: ActivationTicket
  /** The manifest as the inventory holds it — cross-checked against the ticket. */
  readonly manifest: ContributionManifestV1
  /** Coordinate of the extension the inventory read this manifest from. */
  readonly extensionId: string
  /** Root of the owning artifact; the entry point must resolve inside it. */
  readonly baseUrl: URL
  readonly grant: PermissionGrant
  readonly policy?: HostPolicy
  readonly signal?: AbortSignal
}

export interface Activation {
  readonly module: Record<string, unknown>
  readonly variant: RuntimeVariantDeclaration
  /** The narrowed grant the contribution actually runs under (never wider than input). */
  readonly effectiveGrant: PermissionGrant
  /** Honest statements about what this boundary does and does not enforce. */
  readonly diagnostics: readonly Diagnostic[]
}

function deny(code: string, message: string, context?: Record<string, unknown>): ModkitError {
  return new ModkitError({
    code,
    message,
    ...(context === undefined ? {} : { context }),
  })
}

function targetSatisfies(variant: RuntimeVariantDeclaration, target: RuntimeTarget): string[] {
  const c = variant.target
  const problems: string[] = []
  const has = (list: readonly string[] | undefined, value: string, anyAllowed = false) =>
    list === undefined || (anyAllowed && list.includes('any')) || list.includes(value)
  if (!has(c.environments, target.environment)) problems.push(`environment ${target.environment}`)
  if (!has(c.operatingSystems, target.operatingSystem, true)) {
    problems.push(`operatingSystem ${target.operatingSystem}`)
  }
  if (!has(c.architectures, target.architecture, true)) {
    problems.push(`architecture ${target.architecture}`)
  }
  for (const cap of c.requiredHostCapabilities ?? []) {
    if (!(target.hostCapabilities ?? []).includes(cap)) problems.push(`hostCapability ${cap}`)
  }
  for (const api of c.requiredWebApis ?? []) {
    if (!(target.webApis ?? []).includes(api)) problems.push(`webApi ${api}`)
  }
  for (const tool of c.externalTools ?? []) {
    if (!(target.externalTools ?? []).includes(tool)) problems.push(`externalTool ${tool}`)
  }
  return problems
}

export async function activateContribution(request: ActivationRequest): Promise<Activation> {
  throwIfAborted(request.signal)
  const { ticket, manifest } = request

  // 1–2. the ticket must be one this host issued (identity, not shape: a spread copy or a
  // hand-built look-alike is not a member) and must still describe this manifest
  if (!issuedTickets.has(ticket)) {
    throw deny(
      'x3.host/invalid-ticket',
      'activation requires a ticket issued by this host from a real resolution',
    )
  }
  const mismatches: string[] = []
  if (ticket.extensionId !== request.extensionId) mismatches.push('extension')
  if (ticket.contributionId !== manifest.id) mismatches.push('contribution')
  if (ticket.contract !== manifest.contract.id) mismatches.push('contract')
  if (ticket.contractMajor !== manifest.contract.major) mismatches.push('contract major')
  if (mismatches.length > 0) {
    throw deny(
      'x3.host/ticket-manifest-mismatch',
      `the ticket does not describe this contribution (${mismatches.join(', ')})`,
      { mismatches, ticketContribution: ticket.contributionId, manifestId: manifest.id },
    )
  }
  const variant = (manifest.runtimeVariants ?? []).find(v => v.variantId === ticket.variantId)
  if (!variant) {
    throw deny(
      'x3.host/unknown-variant',
      `contribution «${manifest.id}» has no runtime variant «${ticket.variantId}»`,
    )
  }

  // 3. concrete target vs declared constraints
  const targetProblems = targetSatisfies(variant, ticket.target)
  if (targetProblems.length > 0) {
    throw deny(
      'x3.host/target-incompatible',
      `variant «${variant.variantId}» does not support this target: ${targetProblems.join(', ')}`,
      { problems: targetProblems },
    )
  }

  // 4. execution profile — refuse, never downgrade
  if (!SUPPORTED_EXECUTION_PROFILES.includes(variant.executionProfile)) {
    throw deny(
      'x3.host/unsupported-execution-profile',
      `profile «${variant.executionProfile}» cannot be honoured by this host — refusing rather than running under a weaker boundary (24 §6.1 rule 1)`,
      { profile: variant.executionProfile },
    )
  }

  // 5. grant: fail-closed validity, then narrowing intersection
  const validity = grantValidity(request.grant)
  if (validity.state !== 'valid') {
    throw deny(
      'x3.host/grant-not-live',
      validity.state === 'malformed'
        ? `grant «${request.grant.id}» has an unparseable expiresAt («${validity.value}») — treated as expired`
        : `grant «${request.grant.id}» expired at ${validity.at}`,
      { grant: request.grant.id, validity: validity.state },
    )
  }
  const { child, missing } = narrowGrant(request.grant, {
    requestedClasses: variant.requestedPermissionClasses,
    childId: `${request.grant.id}/${manifest.id}#${variant.variantId}`,
    ...(ticket.operation === undefined ? {} : { operation: ticket.operation }),
    ...(request.policy === undefined ? {} : { policy: request.policy }),
  })
  if (missing.length > 0) {
    throw deny(
      'x3.host/permission-denied',
      `grant «${request.grant.id}» does not cover: ${missing.join(', ')}`,
      { missing },
    )
  }

  // 6. entry point contained inside its own artifact
  const entryUrl = resolveContainedEntrypoint(request.baseUrl, variant.entrypoint)

  throwIfAborted(request.signal)
  const module = (await import(entryUrl.href)) as Record<string, unknown>

  const diagnostics: Diagnostic[] = []
  if (variant.executionProfile === 'trusted-in-process') {
    diagnostics.push(
      diagnostic(
        'warning',
        'x3.host/full-process-authority',
        `«${manifest.id}» runs as trusted-in-process: the host checks grants at dispatch and brokers what it owns, but it cannot technically prevent this code from reaching node:fs/node:net or the process itself. This is an audit/policy boundary, not a sandbox (24 §5.1).`,
        [manifest.id],
        { grant: child.id, classes: child.classes },
      ),
    )
  }
  return { module, variant, effectiveGrant: child, diagnostics }
}
