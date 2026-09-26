/**
 * Owner decision 26.09: what the codec publishes is shown first. The card the host feeds from its
 * fallback facts must not outrank a table, an image or a model the codec itself publishes; a card
 * over the codec's own facts keeps its rank.
 */
import { describe, expect, it } from 'vitest'
import {
  bindingId,
  presentationSlotId,
  type AnyDescriptor,
  type ResolvedBinding,
} from '@modkit/sdk'
import { resolvePresentationPlan } from '../src/presentation.js'

const FACTS = { contract: 'common.view/subject-facts-source', major: 1 } as const
const TABLE = { contract: 'common.view/table-data-source', major: 1 } as const

const stage = (id: string, priority: number, source: { contract: string; major: number }) =>
  ({
    slotId: presentationSlotId(id),
    kind: 'stage',
    contributionId: `org.example/${id}`,
    extensionId: 'org.example/viewers',
    priority,
    singletonGroup: 'center-stage',
    bindings: [{ bindingId: bindingId(id), ...source }],
    eligible: true,
  }) as const

const activeStage = async (descriptor: AnyDescriptor) =>
  (
    await resolvePresentationPlan<string>({
      descriptor,
      candidates: [stage('card', 390, FACTS), stage('table', 320, TABLE)] as never,
      digest: () => 'digest',
      ticketMatches: () => true,
      async resolveBinding(binding) {
        return {
          ...binding,
          offerId: 'offer',
          providerId: 'provider',
          variantId: 'portable',
          ticket: 'ticket',
        } as ResolvedBinding<string>
      },
    })
  ).plan.activeStage

const descriptor = (hostDataSources?: readonly (typeof FACTS)[]) =>
  ({
    subjectUri: 'file:///data.csv',
    revision: 'r1',
    dataSources: [TABLE, FACTS],
    ...(hostDataSources === undefined ? {} : { hostDataSources }),
    operations: [],
    diagnostics: [],
  }) as unknown as AnyDescriptor

describe('a stage fed only by what the host added', () => {
  it('ranks after the stages the codec feeds: a CSV opens as its table', async () => {
    expect(await activeStage(descriptor([FACTS]))).toBe('table')
  })

  it('keeps its priority when the codec publishes the facts itself', async () => {
    expect(await activeStage(descriptor())).toBe('card')
  })
})
