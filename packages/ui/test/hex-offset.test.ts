import { describe, expect, it } from 'vitest'

import { parseByteOffset } from '../src/hex/index.js'

describe('hex byte offset field', () => {
  it('reads 0x-prefixed and bare hex as hexadecimal and plain digits as decimal', () => {
    expect(parseByteOffset('0x1F')).toBe(31n)
    // `BigInt('ff')` throws; the field used to pass it through and fail
    expect(parseByteOffset(' ff ')).toBe(255n)
    expect(parseByteOffset('255')).toBe(255n)
    expect(parseByteOffset('zz')).toBeUndefined()
    expect(parseByteOffset('')).toBeUndefined()
  })
})
