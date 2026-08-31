/**
 * The evidence declaration harness itself (block 12 slice 12-5).
 *
 * `proves()` is the thing every other suite's evidence rests on, so its own failures have to be
 * loud rather than silent. A declaration that quietly did nothing would leave the registry field
 * `null` and look exactly like "this operation is not proven" — the one reading that must stay
 * trustworthy.
 *
 * The registry-side negatives (a declaration naming a row that does not exist; an operation whose
 * named test was deleted) live in `scripts/test/migration-registry.test.ts`, because they are
 * properties of the gate rather than of the helper.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { declaredEvidence, proves, resetDeclaredEvidence } from '@modkit/testkit'

describe('12-5 evidence declarations', () => {
  beforeEach(() => {
    resetDeclaredEvidence()
  })

  it('records the capability, the operation and the test that made the claim', () => {
    proves({ capabilityId: 'format/png/open-inspect', operation: 'inspect' })
    const declared = declaredEvidence()
    expect(declared).toHaveLength(1)
    expect(declared[0]).toMatchObject({
      capabilityId: 'format/png/open-inspect',
      operation: 'inspect',
    })
    // the test path is discovered from the call site, so a copied declaration cannot lie about it
    expect(declared[0]?.test).toBe('packages/testkit/test/evidence.test.ts')
  })

  it('is idempotent, so a parameterised suite may declare once per case', () => {
    for (let index = 0; index < 50; index += 1) {
      proves({ contributionId: 'modkit/png', operation: 'inspect' })
    }
    expect(declaredEvidence()).toHaveLength(1)
  })

  it('separates operations and subjects rather than collapsing them', () => {
    proves({ contributionId: 'modkit/png', operation: 'inspect' })
    proves({ contributionId: 'modkit/png', operation: 'read' })
    proves({ contributionId: 'modkit/bmp', operation: 'inspect' })
    expect(declaredEvidence()).toHaveLength(3)
  })

  it('refuses a declaration with no subject', () => {
    expect(() => proves({ operation: 'inspect' })).toThrow(/capabilityId or a contributionId/u)
  })

  it('refuses a declaration that names both a capability and a contribution', () => {
    /*
     * One subject, one name. Allowing both would make the generator choose, and a generator that
     * chooses between two truths is a place for evidence to drift.
     */
    expect(() =>
      proves({
        capabilityId: 'format/png/open-inspect',
        contributionId: 'modkit/png',
        operation: 'inspect',
      }),
    ).toThrow(/one subject, one name/u)
  })

  it('refuses an operation outside the four the registry carries', () => {
    expect(() => proves({ contributionId: 'modkit/png', operation: 'render' as never })).toThrow(
      /inspect \| validate \| read \| materialize/u,
    )
  })
})
