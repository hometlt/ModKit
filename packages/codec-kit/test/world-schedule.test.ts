import { describe, expect, it } from 'vitest'
import {
  executeLinkedWorldSchedule,
  linkWorldSchedule,
  WorldScheduleError,
  type SystemDeclaration,
  type WorldTickContext,
} from '../src/legacy/world/index.js'

interface TestContext extends WorldTickContext {
  readonly trace: string[]
}

const system = (
  id: string,
  options: Partial<Omit<SystemDeclaration<TestContext>, 'id' | 'run'>> = {},
): SystemDeclaration<TestContext> => ({
  id,
  phase: 'simulation',
  cadence: { everyTicks: 1 },
  reads: [],
  writes: [],
  run: context => context.trace.push(id),
  ...options,
})

const diagnosticCodes = (action: () => unknown): readonly string[] => {
  try {
    action()
    return []
  } catch (cause) {
    expect(cause).toBeInstanceOf(WorldScheduleError)
    return (cause as WorldScheduleError).diagnostics.map(diagnostic => diagnostic.code)
  }
}

describe('world schedule', () => {
  it('links independently of registration order and applies cadence while executing', () => {
    const declarations = [
      system('later', { after: ['first'] }),
      system('first', { cadence: { everyTicks: 2 } }),
    ]
    const forward = linkWorldSchedule(declarations)
    const reverse = linkWorldSchedule([...declarations].reverse())
    expect(forward.systems.map(entry => entry.declaration.id)).toEqual(['first', 'later'])
    expect(reverse.systems.map(entry => entry.declaration.id)).toEqual(['first', 'later'])

    const trace: string[] = []
    expect(executeLinkedWorldSchedule(forward, { tick: 1, deltaSeconds: 1, trace })).toEqual([
      'later',
    ])
    expect(trace).toEqual(['later'])
  })

  it('fails closed for missing dependencies, cycles and unordered access conflicts', () => {
    expect(diagnosticCodes(() => linkWorldSchedule([system('a', { after: ['missing'] })]))).toContain(
      'multiverse.world/missing-dependency',
    )
    expect(
      diagnosticCodes(() =>
        linkWorldSchedule([system('a', { after: ['b'] }), system('b', { after: ['a'] })]),
      ),
    ).toContain('multiverse.world/dependency-cycle')
    expect(
      diagnosticCodes(() =>
        linkWorldSchedule([
          system('reader', { reads: ['units'] }),
          system('writer', { writes: ['units'] }),
        ]),
      ),
    ).toContain('multiverse.world/unordered-access-conflict')
  })

  it('selects exactly one provider for every exclusive slot', () => {
    const provider = (providerId: string): SystemDeclaration<TestContext> =>
      system('regeneration', {
        exclusive: { slotId: 'game/vitals-regeneration', providerId },
      })
    expect(diagnosticCodes(() => linkWorldSchedule([provider('a'), provider('b')]))).toContain(
      'multiverse.world/missing-exclusive-selection',
    )

    const linked = linkWorldSchedule([provider('a'), provider('b')], {
      exclusiveSlots: { 'game/vitals-regeneration': 'b' },
    })
    expect(linked.systems).toHaveLength(1)
    expect(linked.systems[0]?.declaration.exclusive?.providerId).toBe('b')
  })
})
