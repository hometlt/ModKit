/**
 * Block 12 slice 12-3 item 2 — the host owns *which stages apply*, optional facets included.
 *
 * Most of plan item 9 already existed before this slice: `evaluateViewerContribution` decides a
 * stage's eligibility from the descriptor (traits with their declared states, operations, consumed
 * data sources, applicability rules) and `resolvePresentationPlan` turns evaluated candidates into
 * one immutable plan with an active stage, alternates, a fallback and an `unsatisfied` list. What
 * was *not* host-owned was the newest half of the question: which of a stage's **optional** data
 * sources to bind for this subject.
 *
 * That half had drifted into the applications. Web bound the model facets by hand in `views.ts`;
 * slice 12-2 gave Electron the same ability separately. Two applications answering one question
 * about one descriptor is precisely what this stage exists to prevent, so the answer now comes
 * from the same call that decides eligibility — and, unlike the app-side predicates, it honours
 * the trait *states* a manifest declares rather than mere trait presence.
 *
 * The cases below are the ones the slice named: a subject that publishes facets, one that
 * publishes none, and a subject nothing can render, which must reach a fallback rather than an
 * empty screen.
 */
import { describe, expect, it } from 'vitest'
import { assembleSubjectDescriptor, evaluateViewerContribution } from '@modkit/host'
import type { AnyDescriptor, ViewerContributionSpecV1 } from '@modkit/sdk'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

const SCENE = 'common.view/model-scene-source'
const REFS = 'common.view/model-resource-refs-source'
const SKELETON = 'common.view/model-skeleton-source'
const ANIMATION = 'common.view/model-animation-source'

/** The shipped model stage's shape: one required scene source, several optional facets. */
const modelStage = {
  kind: 'stage',
  requiresTraits: [{ id: 'model.geometry', states: ['available'] }],
  consumesDataSources: [{ contract: SCENE, major: 1 }],
  optionalDataSources: [
    { contract: REFS, major: 1 },
    { contract: SKELETON, major: 1 },
    { contract: ANIMATION, major: 1 },
  ],
  priority: 350,
  singletonGroup: 'center-stage',
} as unknown as ViewerContributionSpecV1

const facts = { interpretation: 'codec' as const, sourceBytes: 1024n }

async function descriptorWith(options: {
  readonly contracts: readonly string[]
  readonly traitState?: 'available' | 'disabled'
}): Promise<AnyDescriptor> {
  const wire = resolvedDescriptorWire()
  return assembleSubjectDescriptor({
    ...wire,
    traits: [
      options.traitState === 'disabled'
        ? {
            id: 'model.geometry',
            descriptorVersion: 1,
            state: 'disabled',
            diagnosticIds: ['x3.test/geometry-disabled'],
          }
        : { id: 'model.geometry', descriptorVersion: 1, state: 'available' },
    ],
    dataSources: options.contracts.map(contract => ({ contract, major: 1 })),
    ...(options.traitState === 'disabled'
      ? {
          diagnostics: [
            {
              id: 'x3.test/geometry-disabled',
              code: 'x3.test/geometry-disabled',
              category: 'structure',
              severity: 'warning',
              message: 'the fixture disables its geometry trait on purpose',
            },
          ],
        }
      : {}),
  } as never)
}

describe('12-3 the host decides which optional facets a stage binds', () => {
  it('binds exactly the optional facets the subject publishes, and no others', async () => {
    const descriptor = await descriptorWith({ contracts: [SCENE, REFS, ANIMATION] })
    const eligibility = evaluateViewerContribution(modelStage, descriptor, facts)

    expect(eligibility.eligible).toBe(true)
    expect(eligibility.missing).toEqual([])
    // published: refs and animation. Declared but absent: skeleton — bound facets are observed,
    // never assumed, which is the whole reason the facet contracts were introduced
    expect(eligibility.optionalBound).toEqual([ANIMATION, REFS])
  })

  it('stays eligible for a subject that publishes no facet at all', async () => {
    /*
     * The case that decides where this list may live. A facet named in `consumesDataSources` would
     * cost the stage every subject like this one; optional means the stage renders and simply has
     * less to show.
     */
    const eligibility = evaluateViewerContribution(
      modelStage,
      await descriptorWith({ contracts: [SCENE] }),
      facts,
    )
    expect(eligibility.eligible).toBe(true)
    expect(eligibility.optionalBound).toEqual([])
  })

  it('refuses the stage when the required source is absent, and names what is missing', async () => {
    const eligibility = evaluateViewerContribution(
      modelStage,
      await descriptorWith({ contracts: [REFS] }),
      facts,
    )
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.missing).toEqual([`data-source:${SCENE}@1`])
    // and it still reports what *could* be bound, so a diagnostic can say more than "no"
    expect(eligibility.optionalBound).toEqual([REFS])
  })

  it('honours the trait state a manifest declares, not merely the trait id', async () => {
    /*
     * The app-side predicates this stage replaces asked only whether the trait id was present. A
     * subject whose geometry trait is `disabled` would have been offered a model stage that cannot
     * render it — the manifest says `states: ['available']`, and that is now what decides.
     */
    const eligibility = evaluateViewerContribution(
      modelStage,
      await descriptorWith({ contracts: [SCENE], traitState: 'disabled' }),
      facts,
    )
    expect(eligibility.eligible).toBe(false)
    expect(eligibility.missing).toEqual(['trait:model.geometry'])
  })
})
