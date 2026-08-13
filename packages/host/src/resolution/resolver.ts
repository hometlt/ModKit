/**
 * Deterministic staged resolver v1 (owner: MK3/23 §9): explainable filters with reason
 * codes, deterministic preference tuple, `ambiguous` instead of discovery order, exact
 * pin, UTF-8 byte ordering everywhere. Executes only `primary` and compatible
 * `replacement` kinds; reserved kinds are rejected explicitly (23 §8).
 */

import { compareUtf8, parseSemver, parseVersionRange, satisfiesRange } from '@modkitx-x3/core'
import type {
  ProviderOffer,
  ProviderRequest,
  RejectedCandidate,
  ResolutionResult,
  ResolvedProvider,
} from '@modkitx-x3/sdk'

export const RESOLVER_VERSION = 1

/**
 * Runtime provenance of resolution results (R9, post-audit). Every result this resolver
 * produces is registered here, and the activation issuer refuses anything that is not a
 * member. A hand-built object of the same *shape* is therefore not a resolution — the
 * earlier design only branded the ticket, which let a fabricated `{state:'resolved'}` be
 * laundered through the public issuer into a genuine ticket.
 */
const resolverProducts = new WeakSet<object>()

/** Internal: true only for a result this resolver actually returned. */
export function isResolverProduct(result: object): boolean {
  return resolverProducts.has(result)
}

function remember<T extends object>(result: T): T {
  resolverProducts.add(result)
  return result
}

interface Candidate {
  readonly offer: ProviderOffer
  readonly contractOffer: { contract: string; version: string }
}

function candidateSortKey(candidate: Candidate): string {
  return `${candidate.offer.providerId}\u001f${candidate.offer.runtimeVariant}`
}

function isSubset(needed: readonly string[] | undefined, have: readonly string[]): boolean {
  return (needed ?? []).every(item => have.includes(item))
}

export function resolveProvider(
  request: ProviderRequest,
  offers: readonly ProviderOffer[],
): ResolutionResult {
  const rejected: RejectedCandidate[] = []
  const reject = (offer: ProviderOffer, reason: RejectedCandidate['reason'], detail?: string) =>
    rejected.push({
      providerId: offer.providerId,
      runtimeVariant: offer.runtimeVariant,
      reason,
      ...(detail === undefined ? {} : { detail }),
    })

  // Stage 1: offers of the required (contractId, major).
  const candidates: Candidate[] = []
  for (const offer of offers) {
    const match = offer.provides.find(p => {
      if (p.contract !== request.contract.contract) return false
      const version = parseSemver(p.version)
      return version !== undefined && version.major === request.contract.major
    })
    if (!match) {
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
    candidates.push({ offer, contractOffer: match })
  }
  if (candidates.length === 0) {
    return remember({ state: 'unresolved', reason: 'no-offer', rejected: sortRejected(rejected) })
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
      )
      return false
    }
    return true
  })
  if (versionOk.length === 0) {
    return remember({
      state: 'unresolved',
      reason: 'version-incompatible',
      rejected: sortRejected(rejected),
    })
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
      reject(candidate.offer, 'target-incompatible')
      return false
    }
    if (!isSubset(constraint.externalTools, [...(target.externalTools ?? [])])) {
      reject(candidate.offer, 'external-tool-required')
      sawToolReject = true
      return false
    }
    return true
  })
  if (targetOk.length === 0) {
    // The aggregate reason must name the actual cause: only when every rejection at this
    // stage was a missing external tool is `external-tool-required` the honest answer.
    const onlyToolRejects = sawToolReject && !rejected.some(r => r.reason === 'target-incompatible')
    return remember({
      state: 'unresolved',
      reason: onlyToolRejects ? 'external-tool-required' : 'target-incompatible',
      rejected: sortRejected(rejected),
    })
  }

  // Stage 4: granted permissions and required outputs.
  let sawPermissionReject = false
  const permitted = targetOk.filter(candidate => {
    if (!isSubset(candidate.offer.requiredPermissions, [...(target.grantedPermissions ?? [])])) {
      reject(candidate.offer, 'permission-required')
      sawPermissionReject = true
      return false
    }
    if (!isSubset(request.requiredOutputs, [...(candidate.offer.outputs ?? [])])) {
      reject(candidate.offer, 'output-missing')
      return false
    }
    return true
  })
  if (permitted.length === 0) {
    return remember({
      state: 'unresolved',
      reason: sawPermissionReject ? 'permission-required' : 'output-missing',
      rejected: sortRejected(rejected),
    })
  }

  // Stage 5: exact pin.
  let pool = permitted
  if (request.pin) {
    const pin = request.pin
    pool = permitted.filter(candidate => {
      const hit =
        candidate.offer.providerId === pin.providerId &&
        (pin.runtimeVariant === undefined || candidate.offer.runtimeVariant === pin.runtimeVariant)
      if (!hit) reject(candidate.offer, 'pin-unsatisfied')
      return hit
    })
    if (pool.length === 0) {
      return remember({
        state: 'unresolved',
        reason: 'pin-unsatisfied',
        rejected: sortRejected(rejected),
      })
    }
  }

  // Stage 6: deterministic preference tuple — no self-declared priority, no order.
  const score = (candidate: Candidate): readonly number[] => [
    request.operation !== undefined &&
    (candidate.offer.operations ?? []).includes(request.operation)
      ? 1
      : 0,
    (request.preferredOutputs ?? []).filter(o => (candidate.offer.outputs ?? []).includes(o))
      .length,
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
    for (const candidate of tied) reject(candidate.offer, 'ambiguous', 'preference tuple tie')
    return remember({ state: 'unresolved', reason: 'ambiguous', rejected: sortRejected(rejected) })
  }

  const toResolved = (candidate: Candidate): ResolvedProvider => ({
    offer: candidate.offer,
    resolvedContract: candidate.contractOffer,
  })
  return remember({
    state: 'resolved',
    selected: toResolved(best),
    alternatives: ranked.slice(1).map(toResolved),
    rejected: sortRejected(rejected),
  })
}

function sortRejected(rejected: RejectedCandidate[]): RejectedCandidate[] {
  return [...rejected].sort((a, b) =>
    compareUtf8(
      `${a.providerId}\u001f${a.runtimeVariant}\u001f${a.reason}`,
      `${b.providerId}\u001f${b.runtimeVariant}\u001f${b.reason}`,
    ),
  )
}
