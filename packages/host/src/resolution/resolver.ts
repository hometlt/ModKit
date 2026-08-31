/**
 * Deterministic staged resolver v1 (owner: MK3/23 §9): explainable filters with reason
 * codes, deterministic preference tuple, `ambiguous` instead of discovery order, exact
 * pin, UTF-8 byte ordering everywhere. Executes only `primary` and compatible
 * `replacement` kinds; reserved kinds are rejected explicitly (23 §8).
 */

import {
  canonicalJsonStringify,
  compareUtf8,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
} from '@modkit/core'
import type {
  ProviderOffer,
  ProviderRequest,
  ContractOffer,
  RejectedCandidate,
  ResolutionResult,
  ResolvedProvider,
  TraitDefinitionOffer,
  TraitDefinitionRequirement,
} from '@modkit/sdk'
import { isStandardTraitId } from '@modkit/sdk'

export const RESOLVER_VERSION = 1

/**
 * Runtime provenance of resolution results (R9, post-audit). Every result this resolver
 * produces is registered here, and the activation issuer refuses anything that is not a
 * member. A hand-built object of the same *shape* is therefore not a resolution — the
 * earlier design only branded the ticket, which let a fabricated `{state:'resolved'}` be
 * laundered through the public issuer into a genuine ticket.
 */
interface ResolutionProvenance {
  readonly requestKey: string
  readonly resultKey: string
}

const resolverProducts = new WeakMap<object, ResolutionProvenance>()

function requestProvenanceKey(request: ProviderRequest): string {
  return canonicalJsonStringify(request)
}

/** Internal: true only for a result this resolver actually returned. */
export function isResolverProduct(result: object): boolean {
  const provenance = resolverProducts.get(result)
  return provenance !== undefined && provenance.resultKey === canonicalJsonStringify(result)
}

/** True only when this resolver produced `result` for this exact request snapshot. */
export function isResolutionForRequest(result: object, request: ProviderRequest): boolean {
  const provenance = resolverProducts.get(result)
  return (
    provenance !== undefined &&
    provenance.requestKey === requestProvenanceKey(request) &&
    provenance.resultKey === canonicalJsonStringify(result)
  )
}

function remember<T extends object>(result: T, request: ProviderRequest): T {
  resolverProducts.set(result, {
    requestKey: requestProvenanceKey(request),
    resultKey: canonicalJsonStringify(result),
  })
  return result
}

interface Candidate {
  readonly offer: ProviderOffer
  readonly contractOffer: ContractOffer
  readonly contractSelectionKey?: string
}

export interface ResolutionPreparation {
  readonly accepts?: (offer: ProviderOffer, contractOffer: ContractOffer) => boolean
  readonly selectionKey?: (offer: ProviderOffer, contractOffer: ContractOffer) => string | undefined
}

function candidateSortKey(candidate: Candidate): string {
  return canonicalJsonStringify({
    providerId: candidate.offer.providerId,
    runtimeVariant: candidate.offer.runtimeVariant,
    offerId: candidate.contractOffer.offerId,
    version: candidate.contractOffer.version,
  })
}

function isSubset(needed: readonly string[] | undefined, have: readonly string[]): boolean {
  return (needed ?? []).every(item => have.includes(item))
}

function traitOfferMatches(
  requirement: TraitDefinitionRequirement,
  offer: TraitDefinitionOffer,
): boolean {
  if (requirement.id !== offer.id) return false
  if (isStandardTraitId(requirement.id)) {
    return requirement.definitionRange === undefined && offer.definitionVersion === undefined
  }
  if (requirement.definitionRange === undefined || offer.definitionVersion === undefined)
    return false
  const range = parseVersionRange(requirement.definitionRange)
  const version = parseSemver(offer.definitionVersion)
  return range !== undefined && version !== undefined && satisfiesRange(version, range)
}

function hasTraitOutputs(
  needed: readonly TraitDefinitionRequirement[] | undefined,
  offered: readonly TraitDefinitionOffer[],
): boolean {
  return (needed ?? []).every(requirement =>
    offered.some(offer => traitOfferMatches(requirement, offer)),
  )
}

function uniqueTraitRequirements(
  values: readonly TraitDefinitionRequirement[] | undefined,
): readonly TraitDefinitionRequirement[] {
  const unique = new Map<string, TraitDefinitionRequirement>()
  for (const value of values ?? []) {
    const range =
      value.definitionRange === undefined ? undefined : parseVersionRange(value.definitionRange)
    const normalized = {
      id: value.id,
      ...(value.definitionRange === undefined
        ? {}
        : { definitionRange: range?.normalized ?? value.definitionRange }),
    }
    unique.set(canonicalJsonStringify(normalized), normalized)
  }
  return [...unique.values()]
}

function traitRequirementsAreValid(
  values: readonly TraitDefinitionRequirement[] | undefined,
): boolean {
  return (values ?? []).every(value =>
    isStandardTraitId(value.id)
      ? value.definitionRange === undefined
      : value.definitionRange !== undefined &&
        parseVersionRange(value.definitionRange) !== undefined,
  )
}

export function resolveProvider(
  request: ProviderRequest,
  offers: readonly ProviderOffer[],
  preparation?: ResolutionPreparation,
): ResolutionResult {
  if (
    !traitRequirementsAreValid(request.requiredOutputs) ||
    !traitRequirementsAreValid(request.preferredOutputs)
  ) {
    return remember({ state: 'unresolved', reason: 'output-missing', rejected: [] }, request)
  }
  const requiredOutputs = uniqueTraitRequirements(request.requiredOutputs)
  const preferredOutputs = uniqueTraitRequirements(request.preferredOutputs)
  const rejected: RejectedCandidate[] = []
  const reject = (
    offer: ProviderOffer,
    reason: RejectedCandidate['reason'],
    detail?: string,
    offerId?: string,
  ) =>
    rejected.push({
      providerId: offer.providerId,
      runtimeVariant: offer.runtimeVariant,
      ...(offerId === undefined ? {} : { offerId }),
      reason,
      ...(detail === undefined ? {} : { detail }),
    })

  // Stage 1: every logical offer of the required (contractId, major). Contract-specific
  // facet matching is an A-2 registry concern; this
  // compatibility resolver never guesses that request and offer facets share a shape. A provider may publish more
  // than one offer for one contract; using `find` here used to discard all but the first.
  const candidates: Candidate[] = []
  for (const offer of offers) {
    const contractMatches = offer.provides.filter(p => {
      if (p.contract !== request.contract.contract || p.major !== request.contract.major) {
        return false
      }
      const version = parseSemver(p.version)
      return (
        version !== undefined &&
        version.major === p.major &&
        (preparation?.accepts?.(offer, p) ?? true)
      )
    })
    if (contractMatches.length === 0) {
      reject(
        offer,
        'no-offer',
        `does not provide ${request.contract.contract}@${request.contract.major}`,
      )
      continue
    }
    if (offer.kind !== 'primary' && offer.kind !== 'replacement') {
      reject(
        offer,
        'unsupported-kind',
        `resolver v1 executes only primary/replacement, got ${offer.kind}`,
      )
      continue
    }
    for (const match of contractMatches) {
      const selectionKey = preparation?.selectionKey?.(offer, match)
      candidates.push({
        offer,
        contractOffer: match,
        ...(selectionKey === undefined ? {} : { contractSelectionKey: selectionKey }),
      })
    }
  }
  if (candidates.length === 0) {
    return remember(
      { state: 'unresolved', reason: 'no-offer', rejected: sortRejected(rejected) },
      request,
    )
  }

  // Stage 2: exact offer version against the request range (inside the major).
  const range = parseVersionRange(request.contract.range ?? '*')
  const versionOk = candidates.filter(candidate => {
    const version = parseSemver(candidate.contractOffer.version)
    if (version === undefined || range === undefined || !satisfiesRange(version, range)) {
      reject(
        candidate.offer,
        'version-incompatible',
        `${candidate.contractOffer.version} ∉ ${request.contract.range ?? '*'}`,
        candidate.contractOffer.offerId,
      )
      return false
    }
    return true
  })
  if (versionOk.length === 0) {
    return remember(
      {
        state: 'unresolved',
        reason: 'version-incompatible',
        rejected: sortRejected(rejected),
      },
      request,
    )
  }

  // Stage 3: concrete target vs target constraints (environment/OS/arch/webApis/caps).
  const target = request.target
  let sawToolReject = false
  const targetOk = versionOk.filter(candidate => {
    const constraint = candidate.offer.target
    const envOk =
      constraint.environments === undefined || constraint.environments.includes(target.environment)
    const osOk =
      constraint.operatingSystems === undefined ||
      constraint.operatingSystems.includes('any') ||
      constraint.operatingSystems.includes(target.operatingSystem)
    const archOk =
      constraint.architectures === undefined ||
      constraint.architectures.includes('any') ||
      constraint.architectures.includes(target.architecture)
    const capsOk = isSubset(constraint.requiredHostCapabilities, [
      ...(target.hostCapabilities ?? []),
    ])
    const apisOk = isSubset(constraint.requiredWebApis, [...(target.webApis ?? [])])
    if (!envOk || !osOk || !archOk || !capsOk || !apisOk) {
      reject(candidate.offer, 'target-incompatible', undefined, candidate.contractOffer.offerId)
      return false
    }
    if (!isSubset(constraint.externalTools, [...(target.externalTools ?? [])])) {
      reject(candidate.offer, 'external-tool-required', undefined, candidate.contractOffer.offerId)
      sawToolReject = true
      return false
    }
    return true
  })
  if (targetOk.length === 0) {
    // The aggregate reason must name the actual cause: only when every rejection at this
    // stage was a missing external tool is `external-tool-required` the honest answer.
    const onlyToolRejects = sawToolReject && !rejected.some(r => r.reason === 'target-incompatible')
    return remember(
      {
        state: 'unresolved',
        reason: onlyToolRejects ? 'external-tool-required' : 'target-incompatible',
        rejected: sortRejected(rejected),
      },
      request,
    )
  }

  // Stage 4: granted permissions and required outputs.
  let sawPermissionReject = false
  const permitted = targetOk.filter(candidate => {
    if (!isSubset(candidate.offer.requiredPermissions, [...(target.grantedPermissions ?? [])])) {
      reject(candidate.offer, 'permission-required', undefined, candidate.contractOffer.offerId)
      sawPermissionReject = true
      return false
    }
    if (!hasTraitOutputs(requiredOutputs, candidate.offer.outputs ?? [])) {
      reject(candidate.offer, 'output-missing', undefined, candidate.contractOffer.offerId)
      return false
    }
    return true
  })
  if (permitted.length === 0) {
    return remember(
      {
        state: 'unresolved',
        reason: sawPermissionReject ? 'permission-required' : 'output-missing',
        rejected: sortRejected(rejected),
      },
      request,
    )
  }

  // Stage 5: exact pin.
  let pool = permitted
  if (request.pin) {
    const pin = request.pin
    pool = permitted.filter(candidate => {
      const hit =
        candidate.offer.providerId === pin.providerId &&
        (pin.runtimeVariant === undefined ||
          candidate.offer.runtimeVariant === pin.runtimeVariant) &&
        (pin.offerId === undefined || candidate.contractOffer.offerId === pin.offerId)
      if (!hit) {
        reject(candidate.offer, 'pin-unsatisfied', undefined, candidate.contractOffer.offerId)
      }
      return hit
    })
    if (pool.length === 0) {
      return remember(
        {
          state: 'unresolved',
          reason: 'pin-unsatisfied',
          rejected: sortRejected(rejected),
        },
        request,
      )
    }
  }

  // Stage 6: deterministic preference tuple — no self-declared priority, no order.
  const score = (candidate: Candidate): readonly number[] => [
    request.operation !== undefined &&
    (candidate.offer.operations ?? []).includes(request.operation)
      ? 1
      : 0,
    preferredOutputs.filter(requirement =>
      (candidate.offer.outputs ?? []).some(offer => traitOfferMatches(requirement, offer)),
    ).length,
  ]
  const compareTuple = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < a.length; i += 1) {
      if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) < (b[i] as number) ? 1 : -1
    }
    return 0
  }
  const ranked = [...pool].sort(
    (a, b) =>
      compareTuple(score(a), score(b)) || compareUtf8(candidateSortKey(a), candidateSortKey(b)),
  )

  // Stages 7–8: one best candidate wins; an unresolvable tie is ambiguous, not order.
  const best = ranked[0] as Candidate
  const tied = ranked.filter(c => compareTuple(score(c), score(best)) === 0)
  if (tied.length > 1) {
    for (const candidate of tied) {
      reject(candidate.offer, 'ambiguous', 'preference tuple tie', candidate.contractOffer.offerId)
    }
    return remember(
      { state: 'unresolved', reason: 'ambiguous', rejected: sortRejected(rejected) },
      request,
    )
  }

  const toResolved = (candidate: Candidate): ResolvedProvider => ({
    offer: candidate.offer,
    resolvedContract: candidate.contractOffer,
    ...(candidate.contractSelectionKey === undefined
      ? {}
      : { contractSelectionKey: candidate.contractSelectionKey }),
  })
  return remember(
    {
      state: 'resolved',
      selected: toResolved(best),
      alternatives: ranked.slice(1).map(toResolved),
      rejected: sortRejected(rejected),
    },
    request,
  )
}

function sortRejected(rejected: RejectedCandidate[]): RejectedCandidate[] {
  return [...rejected].sort((a, b) =>
    compareUtf8(canonicalJsonStringify(a), canonicalJsonStringify(b)),
  )
}
