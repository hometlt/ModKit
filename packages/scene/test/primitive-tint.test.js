import assert from 'node:assert/strict'
import { it } from 'node:test'

import { primitiveTint } from '../src/render/tint.js'

it('keeps an HDR tint above one and refuses what no colour multiplier can be', () => {
  // Lockdown LE: TintColor="255,255,255 3" on PortCity_Trims.
  assert.deepEqual(primitiveTint({ tint: [3, 3, 3, 1] }), [3, 3, 3, 1])
  assert.deepEqual(primitiveTint({}), [1, 1, 1, 1])
  for (const tint of [[1, 1, 1, 1.5], [-0.1, 1, 1, 1], [1, Number.NaN, 1, 1], [1, 1, 1]])
    assert.throws(() => primitiveTint({ tint }), /primitive tint/)
})
