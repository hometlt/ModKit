import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unpackGrannyCurve } from '../dist/model/granny.js'
const limits = { maxBytes: 1 << 20, maxNodes: 100000 }
const names = [
  'DaKeyframes32f',
  'DaK32fC32f',
  'DaIdentity',
  'DaConstant32f',
  'D3Constant32f',
  'D4Constant32f',
  'DaK16uC16u',
  'DaK8uC8u',
  'D4nK16uC15u',
  'D4nK8uC7u',
  'D3K16uC16u',
  'D3K8uC8u',
  'D9I1K16uC16u',
  'D9I3K16uC16u',
  'D9I1K8uC8u',
  'D9I3K8uC8u',
  'D3I1K32fC32f',
  'D3I1K16uC16u',
  'D3I1K8uC8u',
]
const native = (format, fields, degree = 0) => ({
  ['CurveDataHeader_' + names[format]]: { Format: format, Degree: degree },
  ...fields,
})
const vector = dimension => ({ kind: 'vector', dimension })
const unpack = (input, domain = vector(3), budget = limits) =>
  unpackGrannyCurve(input, domain, budget)
test('identity and constants retain declared domain, and keyframes retain sample-index units', () => {
  for (const [kind, dimension, expected] of [
    ['vector', 3, [0, 0, 0]],
    ['quaternion', 4, [0, 0, 0, 1]],
    ['matrix3', 9, [1, 0, 0, 0, 1, 0, 0, 0, 1]],
  ]) {
    assert.deepEqual(
      unpack(native(2, { Dimension: dimension }), {
        kind,
        ...(kind === 'vector' ? { dimension } : {}),
      }).controls,
      expected,
    )
  }
  for (const [format, dimension] of [
    [3, 9],
    [4, 3],
    [5, 4],
  ]) {
    const controls = Array.from({ length: dimension }, (_, i) => i + 1)
    assert.deepEqual(
      unpack(native(format, { Controls: controls }), vector(dimension)).controls,
      controls,
    )
  }
  const keyframes = unpack(native(0, { Dimension: 2, Controls: [1, 2, 3, 4] }), vector(2))
  assert.deepEqual(keyframes.knots, [0, 1])
  assert.equal(keyframes.knotDomain, 'sample-index')
  const explicit = unpack(native(1, { Knots: [0, 0.5], Controls: [1, 2, 3, 4] }, 1), vector(2))
  assert.deepEqual(explicit.knots, [0, 0.5])
  assert.equal(explicit.degree, 1)
  assert.equal(explicit.knotDomain, 'native-knots')
})
test('unsigned encodings use upper float32 scale words and dimensional scale/offsets', () => {
  for (const format of [6, 7]) {
    const result = unpack(
      native(format, {
        OneOverKnotScaleTrunc: 0x4000,
        ControlScaleOffsets: [2, 3, 1, -1],
        KnotsControls: [0, 2, 1, 2, 3, 4],
      }),
      vector(2),
    )
    assert.deepEqual(result.knots, [0, 1])
    assert.deepEqual(result.controls, [3, 5, 7, 11])
  }
  for (const format of [10, 11]) {
    const result = unpack(
      native(format, {
        OneOverKnotScaleTrunc: 0x4000,
        ControlScales: [2, 3, 4],
        ControlOffsets: [1, -1, 0.5],
        KnotsControls: [0, 2, 1, 2, 3, 4, 5, 6],
      }),
    )
    assert.deepEqual(result.knots, [0, 1])
    assert.deepEqual(result.controls, [3, 5, 12.5, 9, 14, 24.5])
  }
  const u16 = unpack(
    native(10, {
      OneOverKnotScaleTrunc: 0x3f80,
      ControlScales: [1, 1, 1],
      ControlOffsets: [0, 0, 0],
      KnotsControls: [0, 256, 257, 258],
    }),
  )
  assert.deepEqual(u16.controls, [256, 257, 258])
})
test('shared 3D controls and diagonal matrices expand in their native placement', () => {
  for (const format of [16, 17, 18]) {
    const result = unpack(
      native(format, {
        OneOverKnotScaleTrunc: 0x4000,
        ControlScales: [1, 2, 3],
        ControlOffsets: [1, 0, -1],
        KnotsControls: [0, 2, 2, 4],
      }),
    )
    assert.deepEqual(result.knots, format === 16 ? [0, 2] : [0, 1])
    assert.deepEqual(result.controls, [3, 4, 5, 5, 8, 11])
  }
  for (const format of [13, 15]) {
    const result = unpack(
      native(format, {
        OneOverKnotScaleTrunc: 0x3f80,
        ControlScales: [1, 1, 1],
        ControlOffsets: [0, 0, 0],
        KnotsControls: [0, 2, 3, 4],
      }),
      { kind: 'matrix3' },
    )
    assert.deepEqual(result.controls, [2, 0, 0, 0, 3, 0, 0, 0, 4])
  }
  for (const format of [12, 14])
    assert.throws(() => unpack(native(format, {}), { kind: 'matrix3' }), /not qualified/)
})
test('normalized quaternion high bits select each missing component and its sign', () => {
  for (const format of [8, 9])
    for (let missing = 0; missing < 4; missing++)
      for (const negative of [false, true]) {
        const high = format === 8 ? 0x8000 : 0x80
        const encoded = [0, negative ? high : 0, missing & 2 ? high : 0, missing & 1 ? high : 0]
        const result = unpack(
          native(format, {
            ScaleOffsetTableEntries: 0x7777,
            OneOverKnotScale: 1,
            KnotsControls: encoded,
          }),
          { kind: 'quaternion' },
        )
        const expected = [0, 0, 0, 0]
        expected[missing] = negative ? -1 : 1
        assert.deepEqual(result.controls, expected)
      }
  assert.throws(
    () =>
      unpack(
        native(9, {
          ScaleOffsetTableEntries: 0,
          OneOverKnotScale: 1,
          KnotsControls: [0, 127, 127, 127],
        }),
        { kind: 'quaternion' },
      ),
    /unit sphere/,
  )
})
test('malformed values, holes, declarations, ranges, output budgets and cancellation refuse', () => {
  const valid = native(4, { Controls: [1, 2, 3] })
  for (const controls of [[1, NaN, 3], [1, Infinity, 3], [1, 1e300, 3], new Array(3), [1, 2]])
    assert.throws(() => unpack(native(4, { Controls: controls })))
  for (const budget of [
    { ...limits, maxBytes: 1 },
    { ...limits, maxNodes: 1 },
  ])
    assert.throws(() => unpack(valid, vector(3), budget), /budget/)
  assert.throws(() => unpack(native(2, { Dimension: 3 }), { kind: 'quaternion' }), /dimension/)
  assert.throws(
    () => unpack(native(1, { Knots: [1, 0], Controls: [1, 2, 3, 4] }), vector(2)),
    /values/,
  )
  assert.deepEqual(unpack(native(1, { Knots: [-1], Controls: [1, 2, 3] })).knots, [-1])
  assert.deepEqual(
    unpack(
      native(16, {
        ControlScales: [1, 1, 1],
        ControlOffsets: [0, 0, 0],
        KnotsControls: [-2, 0, 1, 2],
      }),
    ).knots,
    [-2, 0],
  )
  assert.throws(() => unpack(native(4, { Controls: [1, 2, 3] }, 4)), /degree/)
  assert.throws(
    () =>
      unpack({
        ...valid,
        CurveDataHeader_DaIdentity: { Format: 2, Degree: 0 },
      }),
    /one known/,
  )
  const badHeader = native(4, { Controls: [1, 2, 3] })
  badHeader.CurveDataHeader_D3Constant32f.Format = 5
  assert.throws(() => unpack(badHeader), /mismatch/)
  const quant = scale =>
    native(11, {
      OneOverKnotScaleTrunc: scale,
      ControlScales: [1, 1, 1],
      ControlOffsets: [0, 0, 0],
      KnotsControls: [0, 1, 2, 3],
    })
  for (const scale of [0, 0x7f80, 0xbf80]) assert.throws(() => unpack(quant(scale)), /knot scale/)
  const bad = quant(0x3f80)
  bad.KnotsControls[1] = 256
  assert.throws(() => unpack(bad))
  bad.KnotsControls = [0, { UInt16: 1 }, 2, 3]
  assert.throws(() => unpack(bad), /wrapper/)
  bad.KnotsControls = [0, 1, 2]
  assert.throws(() => unpack(bad), /extent/)
  assert.throws(() => unpackGrannyCurve(valid, vector(3), limits, AbortSignal.abort()), {
    name: 'AbortError',
  })
  const result = unpack(valid)
  valid.Controls.fill(99)
  assert.deepEqual(result.controls, [1, 2, 3])
})
