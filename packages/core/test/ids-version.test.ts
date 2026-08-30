import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  contractId,
  isDottedId,
  isQualifiedId,
  isSegment,
  operationId,
  parseQualifiedId,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
  versionRangeTargetsMajor,
  traitId,
} from '@modkitx-x3/core'

describe('id grammars (MK3/23 §3)', () => {
  it('constructs branded contract, trait, and owner-scoped operation IDs', () => {
    expect(contractId('org.modkitx/codec')).toBe('org.modkitx/codec')
    expect(traitId('content.binary')).toBe('content.binary')
    expect(operationId('view.inspect', { contributionId: 'org.modkitx/plain-text' })).toBe(
      'view.inspect',
    )
    expect(operationId('document.parse', { contributionId: 'org.modkitx/plain-text' })).toBe(
      'document.parse',
    )
    expect(
      operationId('org.modkitx/plain-text.decode', {
        contributionId: 'org.modkitx/plain-text',
      }),
    ).toBe('org.modkitx/plain-text.decode')
  })

  it('rejects malformed runtime values and operation namespace theft', () => {
    expect(() => contractId('Bad/contract' as never)).toThrow(TypeError)
    expect(() => traitId('Content' as never)).toThrow(TypeError)
    expect(() =>
      operationId('foreign-codec.decode' as never, {
        contributionId: 'org.modkitx/plain-text',
      }),
    ).toThrow(TypeError)
    expect(operationId('image.decode', { contributionId: 'org.modkitx/plain-text' })).toBe(
      'image.decode',
    )
    expect(() => operationId('a/b.c.d' as never, { contributionId: 'a/b' })).toThrow(TypeError)
    expect(operationId('a/b.c', { contributionId: 'a/b' })).toBe('a/b.c')
    expect(operationId('a/b.c.d', { contributionId: 'a/b.c' })).toBe('a/b.c.d')
  })

  it('accepts the spec examples', () => {
    for (const id of [
      'common.image/decoded',
      'common.table/view',
      'multiverse.rts/shield-state',
      'publisher-alpha.alpha/shield-regeneration-system',
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
    expect(parseSemver('9007199254740992.0.0')).toBeUndefined()
    expect(parseSemver('1.0.0-9007199254740992')).toBeUndefined()
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
    expect(parseVersionRange('1')).toBeUndefined()
    expect(parseVersionRange('1.2')).toBeUndefined()
    expect(parseVersionRange('=1')).toBeUndefined()
    expect(parseVersionRange('=1.2')).toBeUndefined()
    expect(parseVersionRange('1.x.3')).toBeUndefined()
    expect(parseVersionRange('1.*.999')).toBeUndefined()
    expect(parseVersionRange('>=1.x')).toBeUndefined()
    expect(parseVersionRange('=1.x')).toBeUndefined()
    expect(parseVersionRange('^1.x')).toBeUndefined()
    expect(parseVersionRange('^1')).toBeUndefined()
    expect(parseVersionRange('>=01.2')).toBeUndefined()
    expect(parseVersionRange('9007199254740992.x')).toBeUndefined()
    expect(r('').normalized).toBe('*')
    expect(versionRangeTargetsMajor(r('*'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('>=1.2 <2'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('^2.0'), 1)).toBe(false)
    expect(versionRangeTargetsMajor(r('>=1 <2.0.0'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('>=1 <=2.0.0'), 1)).toBe(false)
    expect(versionRangeTargetsMajor(r('>=1.2'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('>1.2'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('<1.5'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('<=1.9'), 1)).toBe(true)
    expect(versionRangeTargetsMajor(r('>=2'), 1)).toBe(false)
    expect(versionRangeTargetsMajor(r('<1'), 1)).toBe(false)
    expect(r('>=1.2 <2').normalized).toBe(r('<2 >=1.2').normalized)
    expect(r('>=1.2 >=1.2 <2').normalized).toBe(r('<2 >=1.2').normalized)
    expect(versionRangeTargetsMajor(r('*'), Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(
      versionRangeTargetsMajor(r(`=${Number.MAX_SAFE_INTEGER}.0.0`), Number.MAX_SAFE_INTEGER),
    ).toBe(true)
  })
})
