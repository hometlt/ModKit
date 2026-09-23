import { describe, expect, it } from 'vitest'

import { formatPublicationVersion, nextPublicationVersion } from '../src/publication-revision.js'

describe('publication versions', () => {
  it('reads the packed version as major.minor', () => {
    expect(formatPublicationVersion(65536)).toBe('1.0')
    expect(formatPublicationVersion(65538)).toBe('1.2')
    expect(formatPublicationVersion(0)).toBe('0.0')
  })

  it('expects the next version the way the service allocates it', () => {
    // 1.2 -> minor 1.3, major 2.0: the live check that settled this published 1.2 as 2.0.
    expect(nextPublicationVersion(65538, false)).toBe('1.3')
    expect(nextPublicationVersion(65538, true)).toBe('2.0')
    // A document the server has not versioned yet reads as 0.0, and a major revision is what a
    // first publication asks for — otherwise the server allocates 0.1.
    expect(nextPublicationVersion(0, true)).toBe('1.0')
  })
})
