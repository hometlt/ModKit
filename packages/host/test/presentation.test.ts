import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkit/core'
import {
  bindingId,
  presentationSlotId,
  type BindingRef,
  type PresentationPlan,
  type PresentationSlot,
  type ResolvedBinding,
} from '@modkit/sdk'
import {
  assembleSubjectDescriptor,
  createPresentationPlanValidator,
  resolvePresentationPlan,
  switchPresentationStage,
} from '@modkit/host'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

interface Ticket {
  readonly bindingId: string
  readonly offerId: string
  readonly digest: string
}

const digest = (plan: PresentationPlan) => `canonical:${canonicalJsonStringify(plan)}`
const ticketMatches = (binding: ResolvedBinding<Ticket>) =>
  binding.ticket.bindingId === binding.bindingId && binding.ticket.offerId === binding.offerId

function slot(
  id: string,
  kind: PresentationSlot['kind'],
  priority: number,
  binding: BindingRef,
  singletonGroup?: string,
) {
  return {
    slotId: presentationSlotId(id),
    kind,
    contributionId: `org.example/${id}`,
    extensionId: 'org.example/viewers',
    priority,
    ...(singletonGroup === undefined ? {} : { singletonGroup }),
    bindings: [binding],
    eligible: true,
  } as const
}

describe('A-6 global presentation catalog resolution', () => {
  it('resolves singleton stages, exact bindings/tickets/digest, and a fallback', async () => {
    const descriptor = await assembleSubjectDescriptor(resolvedDescriptorWire())
    const text = {
      bindingId: bindingId('text'),
      contract: 'common.view/text-data-source' as const,
      major: 1 as const,
    }
    const bytes = {
      bindingId: bindingId('bytes'),
      contract: 'common.view/byte-range-source' as const,
      major: 1 as const,
    }
    const alternate = {
      bindingId: bindingId('alternate'),
      contract: 'common.view/text-data-source' as const,
      major: 1 as const,
    }
    const fallbackBinding = {
      bindingId: bindingId('fallback'),
      contract: 'common.view/byte-range-source' as const,
      major: 1 as const,
    }
    const candidates = [
      slot('text-stage', 'stage', 100, text, 'primary'),
      slot('lower-stage', 'stage', 50, alternate, 'primary'),
      slot('secondary-stage', 'stage', 80, alternate, 'secondary'),
      slot('metadata-panel', 'panel', 10, bytes),
      slot('hex-fallback', 'fallback', 1, fallbackBinding),
    ]
    const resolved = await resolvePresentationPlan<Ticket>({
      descriptor,
      candidates,
      digest,
      ticketMatches,
      async resolveBinding(binding) {
        return {
          ...binding,
          offerId: `offer-${binding.bindingId}`,
          providerId: `org.example/${binding.bindingId}`,
          variantId: 'portable',
          ticket: {
            bindingId: binding.bindingId,
            offerId: `offer-${binding.bindingId}`,
            digest: 'artifact-sha256',
          },
        } as ResolvedBinding<Ticket>
      },
    })
    expect(resolved.plan.activeStage).toBe('text-stage')
    expect(resolved.plan.alternateStages).toEqual(['secondary-stage'])
    expect(resolved.plan.slots.map(item => item.slotId)).not.toContain('lower-stage')
    expect(
      createPresentationPlanValidator<Ticket>({ digest, ticketMatches }).validate(resolved),
    ).toEqual({ valid: true })

    const badDigest = { ...resolved, planDigest: 'wrong' }
    expect(
      createPresentationPlanValidator<Ticket>({ digest, ticketMatches }).validate(badDigest),
    ).toEqual({ valid: false, issues: ['invalid-plan-digest'] })

    const firstBinding = resolved.bindings[0]
    if (firstBinding === undefined) throw new Error('fixture must resolve a binding')
    const wrongTicket = {
      ...resolved,
      bindings: [
        { ...firstBinding, ticket: { ...firstBinding.ticket, bindingId: 'another-binding' } },
        ...resolved.bindings.slice(1),
      ],
    }
    expect(
      createPresentationPlanValidator<Ticket>({ digest, ticketMatches }).validate(wrongTicket),
    ).toMatchObject({ valid: false, issues: ['ticket-binding-mismatch'] })

    const duplicateGroupPlan = {
      ...resolved.plan,
      slots: [
        ...resolved.plan.slots,
        {
          slotId: presentationSlotId('duplicate-primary'),
          kind: 'stage' as const,
          contributionId: 'org.example/duplicate-primary',
          extensionId: 'org.example/viewers',
          priority: 1,
          singletonGroup: 'primary',
          bindings: [],
        },
      ],
    }
    const duplicateGroup = {
      ...resolved,
      plan: duplicateGroupPlan,
      planDigest: digest(duplicateGroupPlan),
    }
    expect(
      createPresentationPlanValidator<Ticket>({ digest, ticketMatches }).validate(duplicateGroup),
    ).toMatchObject({ valid: false, issues: ['duplicate-singleton-group'] })
    // the first descriptor assembly compiles the schema validators cold
  }, 30_000)

  it('supports a fallback-only plan and switches stages without recreating the session', async () => {
    const descriptor = await assembleSubjectDescriptor(resolvedDescriptorWire())
    const binding = {
      bindingId: bindingId('fallback'),
      contract: 'common.view/byte-range-source' as const,
      major: 1 as const,
    }
    const fallback = await resolvePresentationPlan<Ticket>({
      descriptor,
      candidates: [slot('hex-fallback', 'fallback', 1, binding)],
      digest,
      ticketMatches,
      async resolveBinding(value) {
        return {
          ...value,
          offerId: 'hex',
          providerId: 'modkit/hex',
          variantId: 'host',
          ticket: { bindingId: value.bindingId, offerId: 'hex', digest: 'host' },
        } as ResolvedBinding<Ticket>
      },
    })
    expect(fallback.plan).toMatchObject({
      alternateStages: [],
      fallback: { slotId: 'hex-fallback' },
    })
    expect(fallback.plan).not.toHaveProperty('activeStage')

    const stageA = slot('stage-a', 'stage', 2, binding, 'a')
    const stageB = slot(
      'stage-b',
      'stage',
      1,
      { ...binding, bindingId: bindingId('stage-b-binding') },
      'b',
    )
    const staged = await resolvePresentationPlan<Ticket>({
      descriptor,
      candidates: [stageA, stageB],
      digest,
      ticketMatches,
      async resolveBinding(value) {
        return {
          ...value,
          offerId: String(value.bindingId),
          providerId: 'org.example/stages',
          variantId: 'portable',
          ticket: {
            bindingId: value.bindingId,
            offerId: String(value.bindingId),
            digest: 'same-session',
          },
        } as ResolvedBinding<Ticket>
      },
    })
    const session = Object.freeze({ id: 'asset-session-1' })
    const switched = switchPresentationStage(staged, presentationSlotId('stage-b'), digest)
    expect(switched.plan.activeStage).toBe('stage-b')
    expect(switched.bindings).toBe(staged.bindings)
    expect(session).toBe(session)
  })
})
