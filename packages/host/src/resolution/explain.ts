import { compareUtf8 } from '@modkitx-x3/core'
import type {
  ContractOffer,
  ProviderOffer,
  ProviderRequest,
  RejectedCandidate,
  ResolutionResult,
} from '@modkitx-x3/sdk'
import { resolveProvider } from './resolver.js'

export interface ExplainedCandidate {
  readonly providerId: string
  readonly runtimeVariant: string
  readonly offerId?: string
  readonly contract: string
  readonly major: number
  readonly version: string
  readonly outcome: 'selected' | 'alternative' | 'rejected' | 'not-applicable'
  readonly reason?: RejectedCandidate['reason']
  readonly detail?: string
}

export interface ProviderResolutionExplanation {
  readonly request: ProviderRequest
  readonly candidates: readonly ExplainedCandidate[]
  readonly result: ResolutionResult
}

function sameCandidate(
  item: { readonly providerId: string; readonly runtimeVariant: string; readonly offerId?: string },
  offer: ProviderOffer,
  contractOffer: ContractOffer,
): boolean {
  return (
    item.providerId === offer.providerId &&
    item.runtimeVariant === offer.runtimeVariant &&
    (item.offerId === undefined || item.offerId === contractOffer.offerId)
  )
}

function candidateKey(item: ExplainedCandidate): string {
  return `${item.providerId}\u0000${item.runtimeVariant}\u0000${item.offerId ?? ''}`
}

/** Deterministic data model shared by `modkit explain` and its executable assertions. */
export function explainProviderResolution(
  request: ProviderRequest,
  offers: readonly ProviderOffer[],
): ProviderResolutionExplanation {
  const result = resolveProvider(request, offers)
  const candidates = offers
    .flatMap(offer =>
      offer.provides.map(contractOffer => {
        const selected =
          result.state === 'resolved' &&
          result.selected.offer.providerId === offer.providerId &&
          result.selected.offer.runtimeVariant === offer.runtimeVariant &&
          result.selected.resolvedContract.offerId === contractOffer.offerId
        const alternative =
          result.state === 'resolved' &&
          result.alternatives.some(
            item =>
              item.offer.providerId === offer.providerId &&
              item.offer.runtimeVariant === offer.runtimeVariant &&
              item.resolvedContract.offerId === contractOffer.offerId,
          )
        const rejected = result.rejected.find(item => sameCandidate(item, offer, contractOffer))
        return {
          providerId: offer.providerId,
          runtimeVariant: offer.runtimeVariant,
          offerId: contractOffer.offerId,
          contract: contractOffer.contract,
          major: contractOffer.major,
          version: contractOffer.version,
          outcome: selected
            ? 'selected'
            : alternative
              ? 'alternative'
              : rejected === undefined
                ? 'not-applicable'
                : 'rejected',
          ...(rejected === undefined ? {} : { reason: rejected.reason }),
          ...(rejected?.detail === undefined ? {} : { detail: rejected.detail }),
        } satisfies ExplainedCandidate
      }),
    )
    .sort((left, right) => compareUtf8(candidateKey(left), candidateKey(right)))
  return Object.freeze({
    request,
    candidates: Object.freeze(candidates.map(item => Object.freeze(item))),
    result,
  })
}

export function renderProviderResolutionExplanation(
  explanation: ProviderResolutionExplanation,
  json = false,
): string {
  if (json) return `${JSON.stringify(explanation, null, 2)}\n`
  const lines = [
    `REQUEST ${explanation.request.contract.contract}@${explanation.request.contract.major} ${explanation.request.contract.range ?? '*'}`,
    ...explanation.candidates.map(
      item =>
        `CANDIDATE ${item.providerId}#${item.offerId ?? '-'} ${item.version}: ${item.outcome}${item.reason === undefined ? '' : ` (${item.reason})`}`,
    ),
  ]
  if (explanation.result.state === 'resolved') {
    lines.push(
      `SELECTED ${explanation.result.selected.offer.providerId}#${explanation.result.selected.resolvedContract.offerId}`,
    )
  } else {
    lines.push(`UNRESOLVED ${explanation.result.reason}`)
  }
  return `${lines.join('\n')}\n`
}
