import { describe, expect, it } from 'vitest'

import { externalCompositionViolations } from '../check-external-composition.mjs'

describe('external composition boundary', () => {
  it('accepts generic workspace, lock and VFS terminology', () => {
    expect(
      externalCompositionViolations(['generic'], () => 'workspace lock local CDN memory VFS'),
    ).toEqual([])
  })

  it.each([
    'fallback to modkit-warzone',
    "join(root, 'extensions', 'ea', 'models')",
    "join(root, 'extensions', 'mk2', 'legacy')",
    "productExtensionDirectory(root, ['publisher', 'codec'])",
    "externalRepositoryRoot(root, 'publisher')",
    "const gameId = 'starcraft-2'",
    "const publisher = 'blizzard'",
    "const gameId = 'warzone-2100'",
    "const engine = 'spring'",
    "const gameId = 'cnc3'",
  ])('rejects concrete sibling and legacy-loader knowledge: %s', source => {
    expect(externalCompositionViolations(['runtime'], () => source)).toEqual(['runtime'])
  })

  it('does not confuse CSS color names with a product token', () => {
    expect(externalCompositionViolations(['theme'], () => 'mediumspringgreen')).toEqual([])
  })
})
