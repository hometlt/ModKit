import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  isDottedId,
  isQualifiedId,
  isSegment,
  parseQualifiedId,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
} from '@modkitx-x3/core'

describe('id grammars (MK3/23 §3)', () => {
  it('accepts the spec examples', () => {
    for (const id of [
      'common.image/decoded',
      'common.table/view',
      'multiverse.rts/shield-state',
      'blizzard.sc2/shield-regeneration-system',
      'org.modkitx/permission-denied',
      'x3.demo/greeter',
    ]) {
      expect(isQualifiedId(id), id).toBe(true)
    }
  })

  it('rejects display forms, casing and malformed ids', () => {
    for (const id of [
      'common.image/decoded@1', // display-only major suffix
      'Common.image/decoded',
      'a//b',
      'a/',
      '/b',
      '-a/b',
      'a./b',
      'a b/c',
      'plain-dotted-only',
    ]) {
      expect(isQualifiedId(id), id).toBe(false)
    }
  })

  it('validates dotted trait/operation ids and segments', () => {
    expect(isDottedId('image.raster')).toBe(true)
    expect(isDottedId('model.render')).toBe(true)
    expect(isDottedId('detect')).toBe(true)
    expect(isDottedId('image..raster')).toBe(false)
    expect(isSegment('portable')).toBe(true)
    expect(isSegment('node-x64')).toBe(true)
    expect(isSegment('Node')).toBe(false)
  })

  it('parses qualified ids', () => {
    expect(parseQualifiedId('x3.demo/greeter')).toEqual({ namespace: 'x3.demo', name: 'greeter' })
    expect(parseQualifiedId('nope')).toBeUndefined()
  })
})

describe('semver subset (MK3/23 §4)', () => {
  it('parses and compares', () => {
    const a = parseSemver('1.2.3')
    const b = parseSemver('1.10.0')
    expect(a && b && compareSemver(a, b)).toBeLessThan(0)
    const pre = parseSemver('2.0.0-alpha.1')
    const rel = parseSemver('2.0.0')
    expect(pre && rel && compareSemver(pre, rel)).toBeLessThan(0)
    expect(parseSemver('01.0.0')).toBeUndefined()
    expect(parseSemver('1.0')).toBeUndefined()
  })

  it('supports the request range forms', () => {
    const v = (s: string) => {
      const parsed = parseSemver(s)
      if (!parsed) throw new Error(`unparseable version ${s}`)
      return parsed
    }
    const r = (s: string) => {
      const parsed = parseVersionRange(s)
      if (!parsed) throw new Error(`unparseable range ${s}`)
      return parsed
    }
    expect(satisfiesRange(v('1.4.2'), r('=1.4.2'))).toBe(true)
    expect(satisfiesRange(v('1.4.2'), r('1.4.2'))).toBe(true)
    expect(satisfiesRange(v('1.9.0'), r('^1.3'))).toBe(true)
    expect(satisfiesRange(v('2.0.0'), r('^1.3'))).toBe(false)
    expect(satisfiesRange(v('1.5.0'), r('>=1.2 <2'))).toBe(true)
    expect(satisfiesRange(v('2.0.0'), r('>=1.2 <2'))).toBe(false)
    expect(satisfiesRange(v('1.999.999'), r('1.x'))).toBe(true)
    expect(satisfiesRange(v('2.0.0'), r('1.x'))).toBe(false)
    expect(satisfiesRange(v('0.0.7'), r('*'))).toBe(true)
    expect(parseVersionRange('not a range')).toBeUndefined()
    expect(r('').normalized).toBe('*')
  })
})
