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

  it('still ranks after when an optional facet binds a codec source: a PNG opens as its image', async () => {
    const RASTER = { contract: 'common.view/raster-image-source', major: 1 } as const
    const card = {
      ...stage('card', 390, FACTS),
      bindings: [
        { bindingId: bindingId('card'), ...FACTS },
        { bindingId: bindingId('card-optional-1'), ...RASTER },
      ],
      optionalBindingIds: ['card-optional-1'],
    }
    const image = {
      ...stage('image', 360, RASTER),
      bindings: [{ bindingId: bindingId('image'), ...RASTER }],
    }
    const resolved = await resolvePresentationPlan<string>({
      descriptor: {
        subjectUri: 'file:///icon.png',
        revision: 'r1',
        dataSources: [RASTER, FACTS],
        hostDataSources: [FACTS],
        operations: [],
        diagnostics: [],
      } as unknown as AnyDescriptor,
      candidates: [card, image] as never,
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
    expect(resolved.plan.activeStage).toBe('image')
  })

  it('keeps its priority when the codec publishes the facts itself', async () => {
    expect(await activeStage(descriptor())).toBe('card')
  })
})
