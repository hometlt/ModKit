import { describe, expect, it } from 'vitest'
import { SubjectNavigationHistory } from '../src/card/index.js'

describe('subject-card navigation history', () => {
  it('supports reset, back, forward, branch replacement and breadcrumb jumps', () => {
    const history = new SubjectNavigationHistory()
    history.reset('unit:Marine')
    history.open('weapon:GaussRifle')
    history.open('effect:GaussDamage')

    expect(history.breadcrumbs).toEqual(['unit:Marine', 'weapon:GaussRifle', 'effect:GaussDamage'])
    expect(history.back()).toBe('weapon:GaussRifle')
    expect(history.back()).toBe('unit:Marine')
    expect(history.canBack).toBe(false)
    expect(history.canForward).toBe(true)
    expect(history.forward()).toBe('weapon:GaussRifle')

    history.open('upgrade:InfantryWeapons')
    expect(history.current).toBe('upgrade:InfantryWeapons')
    expect(history.canForward).toBe(false)
    expect(history.jump('unit:Marine')).toBe('unit:Marine')
    expect(history.forward()).toBe('weapon:GaussRifle')
    expect(history.forward()).toBe('upgrade:InfantryWeapons')
  })

  it('does not duplicate the current subject or move past either end', () => {
    const history = new SubjectNavigationHistory()
    history.reset('unit:Marine')
    history.open('unit:Marine')
    expect(history.back()).toBeUndefined()
    expect(history.forward()).toBeUndefined()
    expect(history.breadcrumbs).toEqual(['unit:Marine'])
  })
})
