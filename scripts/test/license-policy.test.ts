import { describe, expect, it } from 'vitest'

import { licensePolicyViolations } from '../check-license-policy.mjs'

describe('root license policy', () => {
  it('accepts the root store and justified generated, fixture and font-source notices', () => {
    expect(
      licensePolicyViolations([
        'licenses/MIT.txt',
        'scripts/release/generated/LICENSE-NOTICES.txt',
        'test/fixtures/pkg/LICENSE',
        'assets/fonts/saira/OFL.txt',
      ]),
    ).toEqual([])
  })

  it('rejects package-local and nested authored license copies', () => {
    expect(
      licensePolicyViolations([
        'packages/example/LICENSE',
        'packages/example/MIT.txt',
        'extensions/images/NOTICE.md',
      ]),
    ).toEqual([
      'extensions/images/NOTICE.md',
      'packages/example/LICENSE',
      'packages/example/MIT.txt',
    ])
  })
})
