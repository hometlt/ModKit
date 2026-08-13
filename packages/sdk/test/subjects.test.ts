import { describe, expect, it } from 'vitest'
import {
  addInterpretation,
  createRootSubjectState,
  nestedSubject,
  parseSubjectRef,
  removeInterpretation,
  rootSubject,
  selectInterpretation,
  serializeSubjectRef,
  subjectRefEquals,
} from '@modkitx-x3/sdk/subjects'

describe('SubjectRef (MK3/25 §3)', () => {
  it('serializes the spec examples', () => {
    const dds = rootSubject({ id: 'file:///c:/mods/x.dds' })
    expect(serializeSubjectRef(dds)).toBe('file:///c:/mods/x.dds')

    const marine = nestedSubject(
      rootSubject({ id: 'modkit-vfs://ws/' }),
      'blizzard.sc2/unit',
      'Marine',
    )
    expect(serializeSubjectRef(marine)).toBe('modkit-vfs://ws/#blizzard.sc2%2Funit/Marine')

    const roundTrip = parseSubjectRef(serializeSubjectRef(marine))
    expect(subjectRefEquals(roundTrip, marine)).toBe(true)
  })

  it('equality ignores revision and compares workspace + source chain + identity', () => {
    const a = nestedSubject(rootSubject({ id: 's', parent: { id: 'p' } }, 'ws'), 'k.n/d', 'x')
    const same = nestedSubject(rootSubject({ id: 's', parent: { id: 'p' } }, 'ws'), 'k.n/d', 'x')
    const otherParent = nestedSubject(
      rootSubject({ id: 's', parent: { id: 'q' } }, 'ws'),
      'k.n/d',
      'x',
    )
    expect(subjectRefEquals(a, same)).toBe(true)
    expect(subjectRefEquals(a, otherParent)).toBe(false)
  })
})

describe('unknown root subject + interpretations (MK3/25 §20, PR-16)', () => {
  it('identity survives interpretation install/remove/reclassification', () => {
    const root = rootSubject({ id: 'file:///c:/mods/opaque.bin' })
    const serialized = serializeSubjectRef(root)

    let state = createRootSubjectState(root)
    expect(state.interpretations).toEqual([])

    state = addInterpretation(state, { id: 'org.example/relic-hod' })
    state = addInterpretation(state, { id: 'org.example/generic-archive' })
    expect(serializeSubjectRef(state.ref)).toBe(serialized) // identity untouched
    expect(state.interpretations.map(i => i.id)).toEqual([
      'org.example/generic-archive',
      'org.example/relic-hod',
    ])

    state = selectInterpretation(state, 'org.example/relic-hod')
    expect(state.selected).toBe('org.example/relic-hod')
    expect(serializeSubjectRef(state.ref)).toBe(serialized) // reclassification ≠ identity

    state = removeInterpretation(state, 'org.example/relic-hod')
    expect(state.selected).toBeUndefined() // degraded back to unknown, no re-guess
    expect(serializeSubjectRef(state.ref)).toBe(serialized)
    expect(subjectRefEquals(state.ref, root)).toBe(true)

    expect(() => selectInterpretation(state, 'org.example/relic-hod')).toThrow()
  })
})
