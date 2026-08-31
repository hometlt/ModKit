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

import {
  canonicalJsonStringify,
  diagnostic,
  ModkitError,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import { isResolverProduct, resolveProvider } from '../resolution/resolver.js'
import { inventoryBindingForOffer } from '../offers.js'
import { inventoryRecordFor, type InventoryContribution } from '../inventory.js'
import {
  grantValidity,
  narrowGrant,
  operationScopedPermissionClasses,
  type HostPolicy,
  type OperationPermissionDeclaration,
  type PermissionClass,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderRequest,
  type ResolutionResult,
  type RuntimeTarget,
  type RuntimeVariantDeclaration,
} from '@modkit/sdk'
import { resolveContainedEntrypoint } from './entrypoint.js'
import {
  activateExecutionBackend,
  DEFAULT_EXECUTION_BACKENDS,
  type ExecutionBackendRegistry,
} from '../execution/backend.js'

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
  readonly contributionContract: { readonly id: string; readonly major: number }
  readonly offeredContract: { readonly id: string; readonly version: string }
  readonly inventoryRecordId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly artifactRoot: URL
  readonly extensionId: string
  readonly contributionId: string
  /** Exact logical offer selected when one provider exposes several offers for one contract. */
  readonly offerId: string
  readonly offerFingerprint: string
  /** Contract-owned canonical non-secret selector; raw facets never enter an activation ticket. */
  readonly contractSelectionKey?: string
  readonly variantId: string
  readonly target: RuntimeTarget
  readonly operation?: string
}

const issuedTickets = new WeakSet<object>()
interface TicketBinding {
  readonly contribution: InventoryContribution
  readonly ticketFingerprint: string
}
const ticketBindings = new WeakMap<object, TicketBinding>()

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
  const binding = inventoryBindingForOffer(result.selected.offer)
  if (binding === undefined) return { result }
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
  const inventoryBinding = inventoryBindingForOffer(offer)
  if (inventoryBinding === undefined) {
    throw new ModkitError({
      code: 'x3.host/offer-not-in-inventory',
      message: 'activation tickets can only be issued for production inventory offers',
    })
  }
  const privateRecord = inventoryRecordFor(inventoryBinding.contribution)
  if (privateRecord === undefined || inventoryBinding.contribution.manifest === undefined) {
    throw new ModkitError({
      code: 'x3.host/inventory-record-unavailable',
      message: 'the selected provider no longer has an attested inventory record',
    })
  }
  const manifest = inventoryBinding.contribution.manifest
  const ticket = Object.freeze({
    contributionContract: Object.freeze({
      id: manifest.contract.id,
      major: manifest.contract.major,
    }),
    offeredContract: Object.freeze({
      id: result.selected.resolvedContract.contract,
      version: result.selected.resolvedContract.version,
    }),
    inventoryRecordId: privateRecord.publicRecord.inventoryRecordId,
    manifestDigest: privateRecord.publicRecord.manifestDigest,
    artifactDigest: privateRecord.publicRecord.artifactDigest,
    artifactRoot: new URL(privateRecord.publicRecord.artifactRoot),
    extensionId: offer.extensionId,
    contributionId: offer.providerId,
    offerId: result.selected.resolvedContract.offerId,
    offerFingerprint: inventoryBinding.offerFingerprint,
    ...(result.selected.contractSelectionKey === undefined
      ? {}
      : { contractSelectionKey: result.selected.contractSelectionKey }),
    variantId: offer.runtimeVariant,
    target: JSON.parse(canonicalJsonStringify(target)) as RuntimeTarget,
    ...(operation === undefined ? {} : { operation }),
  }) as unknown as ActivationTicket
  issuedTickets.add(ticket)
  ticketBindings.set(ticket, {
    contribution: inventoryBinding.contribution,
    ticketFingerprint: ticketFingerprint(ticket),
  })
  return ticket
}

function ticketFingerprint(ticket: ActivationTicket): string {
  return canonicalJsonStringify({
    contributionContract: ticket.contributionContract,
    offeredContract: ticket.offeredContract,
    inventoryRecordId: ticket.inventoryRecordId,
    manifestDigest: ticket.manifestDigest,
    artifactDigest: ticket.artifactDigest,
    artifactRoot: ticket.artifactRoot.href,
    extensionId: ticket.extensionId,
    contributionId: ticket.contributionId,
    offerId: ticket.offerId,
    offerFingerprint: ticket.offerFingerprint,
    ...(ticket.contractSelectionKey === undefined
      ? {}
      : { contractSelectionKey: ticket.contractSelectionKey }),
    variantId: ticket.variantId,
    target: ticket.target,
    ...(ticket.operation === undefined ? {} : { operation: ticket.operation }),
  })
}

/**
 * R5 (NXT-101): the detection probe is its own operation. An activation whose ticket carries
 * `operation: PROBE_OPERATION` runs under a probe-scoped child grant: the variant's requested
 * classes are clamped to `PROBE_PERMISSION_CLASSES` before narrowing, and the same set is applied
 * as an operation ceiling even when the caller supplied no policy — a probe can read the source
 * it is probing and nothing else, whatever the variant would request for a real open. The child
 * grant id is suffixed `#probe` so probe and open grants of one contribution stay distinct.
 */
/** Emitted when operation-scoped classes were requested but not granted (ADR-HOST-002 §2). */
export const PERMISSION_DEGRADED_DIAGNOSTIC = 'x3.host/permission-degraded'

export function permissionDegradedDiagnostic(
  contributionId: string,
  degraded: readonly PermissionClass[],
): Diagnostic {
  return diagnostic(
    'information',
    PERMISSION_DEGRADED_DIAGNOSTIC,
    `«${contributionId}» runs without ${degraded.join(', ')}: the grant does not cover these classes, so the operations that need them are disabled (ADR-HOST-002 §2)`,
    [contributionId],
    { degraded },
  )
}

/**
 * Classes a contribution's *operations* need (the SDK rule `operationScopedPermissionClasses`):
 * only these may be degraded at activation; a contribution without operation declarations
 * degrades nothing.
 */
export function operationScopedClasses(manifest: {
  readonly spec?: unknown
}): ReadonlySet<PermissionClass> {
  const spec = manifest.spec as
    { readonly operations?: readonly OperationPermissionDeclaration[] } | undefined
  return operationScopedPermissionClasses(spec?.operations)
}

export const PROBE_OPERATION = 'probe'
export const PROBE_PERMISSION_CLASSES: readonly PermissionClass[] = Object.freeze(['read-source'])

export interface ActivationRequest {
  readonly ticket: ActivationTicket
  readonly grant: PermissionGrant
  readonly policy?: HostPolicy
  readonly executionBackends?: ExecutionBackendRegistry
  readonly signal?: AbortSignal
}

export interface Activation {
  readonly module: Record<string, unknown>
  readonly variant: RuntimeVariantDeclaration
  /** The narrowed grant the contribution actually runs under (never wider than input). */
  readonly effectiveGrant: PermissionGrant
  /** Honest statements about what this boundary does and does not enforce. */
  readonly diagnostics: readonly Diagnostic[]
  /** Releases the selected execution realm; idempotent for every backend. */
  release(): Promise<void>
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
  const { ticket } = request

  // 1–2. the ticket must be one this host issued (identity, not shape: a spread copy or a
  // hand-built look-alike is not a member) and must still describe this manifest
  const ticketBinding = ticketBindings.get(ticket)
  if (
    !issuedTickets.has(ticket) ||
    ticketBinding === undefined ||
    ticketBinding.ticketFingerprint !== ticketFingerprint(ticket)
  ) {
    throw deny(
      'x3.host/invalid-ticket',
      'activation requires a ticket issued by this host from a real resolution',
    )
  }
  const privateRecord = inventoryRecordFor(ticketBinding.contribution)
  const manifest = ticketBinding.contribution.manifest
  if (privateRecord === undefined || manifest === undefined) {
    throw deny('x3.host/inventory-record-unavailable', 'the ticket inventory record is unavailable')
  }
  const mismatches: string[] = []
  if (ticket.inventoryRecordId !== privateRecord.publicRecord.inventoryRecordId)
    mismatches.push('inventory record')
  if (ticket.manifestDigest !== privateRecord.publicRecord.manifestDigest)
    mismatches.push('manifest digest')
  if (ticket.artifactDigest !== privateRecord.publicRecord.artifactDigest)
    mismatches.push('artifact digest')
  if (ticket.artifactRoot.href !== privateRecord.publicRecord.artifactRoot)
    mismatches.push('artifact root')
  if (ticket.contributionId !== manifest.id) mismatches.push('contribution')
  if (ticket.contributionContract.id !== manifest.contract.id) mismatches.push('contract')
  if (ticket.contributionContract.major !== manifest.contract.major)
    mismatches.push('contract major')
  if (mismatches.length > 0) {
    throw deny(
      'x3.host/ticket-manifest-mismatch',
      `the ticket does not describe this contribution (${mismatches.join(', ')})`,
      { mismatches, ticketContribution: ticket.contributionId, manifestId: manifest.id },
    )
  }
  if (!(await privateRecord.verifyArtifactDigest(ticket.artifactDigest))) {
    throw deny(
      'x3.host/artifact-digest-mismatch',
      'the selected artifact changed after inventory and will not be imported',
      { inventoryRecordId: ticket.inventoryRecordId },
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

  // 4. execution profile — concrete composition availability, never a global claim or downgrade
  const executionBackends = request.executionBackends ?? DEFAULT_EXECUTION_BACKENDS
  if (!executionBackends.supports(variant.executionProfile, ticket.target, variant)) {
    throw deny(
      'x3.host/execution-backend-unavailable',
      `profile «${variant.executionProfile}» has no backend for ${ticket.target.environment} — refusing rather than running under a weaker boundary (24 §6.1 rule 1)`,
      { profile: variant.executionProfile, environment: ticket.target.environment },
    )
  }

  // `trusted-in-process` is never inferred from a contribution manifest or publisher string.
  // The host loader must explicitly attach an execution decision to this exact attested artifact.
  if (
    variant.executionProfile === 'trusted-in-process' &&
    privateRecord.execution.allowTrustedInProcess !== true
  ) {
    throw deny(
      'x3.host/trusted-in-process-not-authorized',
      `extension «${ticket.extensionId}» came from ${privateRecord.execution.origin} inventory without an explicit host decision allowing full process authority`,
      { extensionId: ticket.extensionId, origin: privateRecord.execution.origin },
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
  const probeScoped = ticket.operation === PROBE_OPERATION
  const requestedClasses = probeScoped
    ? variant.requestedPermissionClasses.filter(item =>
        (PROBE_PERMISSION_CLASSES as readonly string[]).includes(item),
      )
    : variant.requestedPermissionClasses
  // the probe ceiling holds even without a caller policy, and a caller policy can only narrow it
  const callerProbeCeiling = request.policy?.operationClasses?.[PROBE_OPERATION]
  const policy = probeScoped
    ? {
        ...request.policy,
        operationClasses: {
          ...request.policy?.operationClasses,
          [PROBE_OPERATION]:
            callerProbeCeiling === undefined
              ? PROBE_PERMISSION_CLASSES
              : callerProbeCeiling.filter(item =>
                  (PROBE_PERMISSION_CLASSES as readonly string[]).includes(item),
                ),
        },
      }
    : request.policy
  const { child, missing } = narrowGrant(request.grant, {
    requestedClasses,
    childId: `${request.grant.id}/${manifest.id}#${variant.variantId}${probeScoped ? '#probe' : ''}`,
    ...(ticket.operation === undefined ? {} : { operation: ticket.operation }),
    ...(policy === undefined ? {} : { policy }),
  })
  // ADR-HOST-002 §2: classes that only operations need (each operation's requiredPermissions and
  // `write-source` for a mutating one) are degradable — the child grant simply lacks them and the
  // host disables those operations at dispatch; everything else the variant asked for and the
  // grant lacks stays a hard denial (read-source always, anything needed to load or open).
  const operationScoped = operationScopedClasses(manifest)
  const hardMissing = missing.filter(item => !operationScoped.has(item))
  if (hardMissing.length > 0) {
    throw deny(
      'x3.host/permission-denied',
      `grant «${request.grant.id}» does not cover: ${hardMissing.join(', ')}`,
      { missing: hardMissing },
    )
  }
  const degraded = missing.filter(item => operationScoped.has(item))

  // 6. entry point contained inside its own artifact
  const entryUrl = resolveContainedEntrypoint(privateRecord.artifactRoot, variant.entrypoint)

  throwIfAborted(request.signal)
  const backendLease = await activateExecutionBackend(executionBackends, {
    ticket,
    entrypoint: entryUrl,
    artifactRoot: privateRecord.artifactRoot,
    ...(privateRecord.fileDigests === undefined ? {} : { fileDigests: privateRecord.fileDigests }),
    variant,
    target: ticket.target,
    grant: child,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })

  const diagnostics: Diagnostic[] = []
  if (degraded.length > 0) diagnostics.push(permissionDegradedDiagnostic(manifest.id, degraded))
  if (variant.executionProfile === 'worker-brokered') {
    diagnostics.push(
      diagnostic(
        'information',
        'x3.host/worker-shared-process',
        `«${manifest.id}» runs worker-brokered: a crash, hang or protocol violation of this code is isolated from the host, but the worker shares the process — it is not a security sandbox (24 §6.1 SB-1).`,
        [manifest.id],
        { grant: child.id, classes: child.classes },
      ),
    )
  }
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
  return {
    module: backendLease.module,
    variant,
    effectiveGrant: child,
    diagnostics,
    release: backendLease.release,
  }
}
