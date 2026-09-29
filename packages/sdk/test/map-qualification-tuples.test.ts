import { expect, it } from 'vitest'
import { mapQualificationTupleBytes } from '../src/maps/index.js'

it('encodes qualification tuples as little-endian binary64 triples, in order', () => {
  const bytes = mapQualificationTupleBytes([
    [1, 2, 3.5],
    [-0.1, 0, 1e300],
  ])
  expect(bytes.byteLength).toBe(48)
  const view = new DataView(bytes.buffer)
  expect([0, 8, 16, 24, 32, 40].map(at => view.getFloat64(at, true))).toEqual([
    1, 2, 3.5, -0.1, 0, 1e300,
  ])
  // byte order is fixed: 1.0 is 00 00 00 00 00 00 f0 3f
  expect([...bytes.subarray(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0xf0, 0x3f])
  expect(mapQualificationTupleBytes([]).byteLength).toBe(0)
})
