import { describe, expect, it } from 'vitest'
import {
  diagnostic,
  isUInt64String,
  sourceSpanSchema,
  uint64,
  UINT64_DECIMAL_PATTERN,
  type SourceSpan,
} from '@modkit/core'

describe('wire-safe SourceSpan', () => {
  it('accepts exactly canonical decimal u64 values', () => {
    const accepted = ['0', '1', '9999999999999999999', '18446744073709551615']
    const rejected = ['', '-1', '+1', '01', '1.0', '18446744073709551616', '99999999999999999999']

    for (const value of accepted) expect(isUInt64String(value), value).toBe(true)
    for (const value of rejected) expect(isUInt64String(value), value).toBe(false)
    expect(uint64(18_446_744_073_709_551_615n)).toBe('18446744073709551615')
    expect(() => uint64(18_446_744_073_709_551_616n)).toThrow(RangeError)
  })

  it('uses the same bounded decimal pattern in both byte fields', () => {
    expect(new RegExp(UINT64_DECIMAL_PATTERN).test('18446744073709551615')).toBe(true)
    expect(new RegExp(UINT64_DECIMAL_PATTERN).test('18446744073709551616')).toBe(false)

    for (const branch of [sourceSpanSchema.oneOf[0], sourceSpanSchema.oneOf[2]]) {
      expect(branch.properties.byteOffset.pattern).toBe(UINT64_DECIMAL_PATTERN)
      expect(branch.properties.byteLength.pattern).toBe(UINT64_DECIMAL_PATTERN)
    }
  })

  it('publishes three strict, complete coordinate branches', () => {
    expect(sourceSpanSchema.oneOf).toHaveLength(3)
    expect(sourceSpanSchema.oneOf.map(branch => branch.additionalProperties)).toEqual([
      false,
      false,
      false,
    ])
    expect(sourceSpanSchema.oneOf.map(branch => branch.required)).toEqual([
      ['byteOffset', 'byteLength'],
      ['utf16Offset', 'utf16Length', 'line', 'column'],
      ['byteOffset', 'byteLength', 'utf16Offset', 'utf16Length', 'line', 'column'],
    ])
  })

  it('keeps diagnostic ranges JSON-safe', () => {
    const range: SourceSpan = {
      byteOffset: uint64('9007199254740993'),
      byteLength: uint64('4'),
      utf16Offset: 7,
      utf16Length: 2,
      line: 1,
      column: 3,
    }
    const result = diagnostic('warning', 'x3.demo/range', 'range', undefined, undefined, range)

    expect(JSON.parse(JSON.stringify(result))).toEqual({
      code: 'x3.demo/range',
      severity: 'warning',
      message: 'range',
      range: {
        byteOffset: '9007199254740993',
        byteLength: '4',
        utf16Offset: 7,
        utf16Length: 2,
        line: 1,
        column: 3,
      },
    })
  })
})
