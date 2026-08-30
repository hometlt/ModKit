import { describe, expect, it } from 'vitest'

import { externalCompositionViolations } from '../check-external-composition.mjs'

describe('external composition boundary', () => {
  it('accepts generic workspace, lock and VFS terminology', () => {
    expect(
      externalCompositionViolations(['generic'], () => 'workspace lock local CDN memory VFS'),
    ).toEqual([])
  })

  it('rejects a concrete sibling or game default', () => {
    expect(externalCompositionViolations(['runtime'], () => 'fallback to modkit-warzone')).toEqual([
      'runtime',
    ])
  })
})
