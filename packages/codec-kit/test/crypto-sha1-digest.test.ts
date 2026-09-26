import { describe, expect, it } from 'vitest'
import { sha1Digest } from '../src/crypto/sha1-digest.js'

describe('SHA-1 of bytes', () => {
  it('matches the FIPS 180 vector for "abc"', async () => {
    const digest = await sha1Digest(new TextEncoder().encode('abc'))
    expect(Buffer.from(digest).toString('hex')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })
})
