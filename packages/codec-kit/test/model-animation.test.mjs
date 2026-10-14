import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModelAnimationSource } from '../dist/index.js'
import { createModelAnimationSampler, snapshotModelAnimations } from '../dist/model/animation.js'

const channel = (kind, interpolation, values, extra = {}) => ({
  target: 'node-a',
  kind,
  firstFrame: 0,
  lastFrame: values.length - 1,
  interpolation,
  samples: values.map((value, frame) => ({ frame, timeSeconds: frame, value })),
  ...extra,
})
const clip = channels => ({
  id: 'walk',
  name: 'Walk',
  kind: 'animation',
  provenance: 'direct',
  frames: 3,
  durationSeconds: 2,
  looping: true,
  boundsSphere: { center: [1, 2, 3], radius: 4 },
  channels,
})

test('facet sampling retains step/linear/quaternion rules, endpoints and independent clocks', () => {
  const sampler = createModelAnimationSampler(
    clip([
      channel('translation', 'linear', [
        [0, 2, 4],
        [2, 4, 6],
        [4, 6, 8],
      ]),
      channel('visibility', 'step', [[0], [1], [0]]),
      channel('rotation', 'spherical-linear', [
        [0, 0, 0, 1],
        [0, 0, 1, 0],
      ]),
      channel('translation', 'linear', [[10], [20]], { concurrent: true, wrapSeconds: 1 }),
    ]),
  )
  assert.deepEqual(sampler.sample(-1)[0].value, [0, 2, 4])
  const half = sampler.sample(0.5)
  assert.deepEqual(half[0].value, [1, 3, 5])
  assert.deepEqual(half[1].value, [0])
  assert.ok(Math.abs(half[2].value[2] - Math.SQRT1_2) < 1e-12)
  assert.ok(Math.abs(half[2].value[3] - Math.SQRT1_2) < 1e-12)
  assert.deepEqual(sampler.sample(1)[1].value, [1])
  assert.deepEqual(sampler.sample(4)[0].value, [4, 6, 8]) // sequence looping is caller-owned
  assert.deepEqual(sampler.sample(2.5)[3].value, [15])
})

test('animation source and compiled sampler own nested values and bounds', async () => {
  const authored = clip([channel('translation', 'linear', [[0], [2]])])
  authored.repeatCount = 3
  authored.channels[0].concurrent = true
  authored.channels[0].wrapSeconds = 1
  authored.channels[0].repeatCount = 2
  const source = createModelAnimationSource({ clips: [authored] })
  const sampler = createModelAnimationSampler(authored)
  authored.boundsSphere.center[0] = 99
  authored.channels[0].samples[1].value[0] = 99
  const page = await source.clips({ limit: 1 })
  assert.deepEqual(page.items[0].boundsSphere.center, [1, 2, 3])
  assert.equal(page.items[0].repeatCount, 3)
  assert.equal(page.items[0].channels[0].repeatCount, 2)
  assert.deepEqual(sampler.sample(0.5)[0].value, [1])
  assert.throws(() => {
    page.items[0].channels[0].samples[0].value[0] = 3
  }, TypeError)
  assert.throws(() => {
    sampler.sample(0.5)[0].value[0] = 3
  }, TypeError)
})

test('invalid sampling declarations, budgets and cancellation fail without guessed values', () => {
  const valid = clip([channel('translation', 'linear', [[0], [1]])])
  const descriptive = structuredClone(valid)
  delete descriptive.channels[0].interpolation
  assert.equal(snapshotModelAnimations([descriptive]).length, 1)
  assert.throws(() => createModelAnimationSampler(descriptive), /no sampling semantics/)
  for (const mutate of [
    c => {
      c.channels[0].samples[0].timeSeconds = NaN
    },
    c => {
      c.channels[0].samples[1].timeSeconds = -1
    },
    c => {
      c.channels[0].samples[1].value = [1, 2]
    },
    c => {
      c.channels[0].interpolation = 'guessed'
    },
    c => {
      c.channels[0].interpolation = 'spherical-linear'
    },
    c => {
      c.channels[0].wrapSeconds = 0
    },
    c => {
      c.channels[0].repeatCount = 1
    },
    c => {
      c.repeatCount = -1
    },
  ]) {
    const corrupt = structuredClone(valid)
    mutate(corrupt)
    assert.throws(() => createModelAnimationSampler(corrupt), TypeError)
  }
  assert.throws(() => snapshotModelAnimations([valid, valid]), /unique id/)
  for (const budget of [
    { maxDepth: 1, maxNodes: 1000, maxBytes: 100000 },
    { maxDepth: 64, maxNodes: 1, maxBytes: 100000 },
    { maxDepth: 64, maxNodes: 1000, maxBytes: 1 },
  ])
    assert.throws(() => createModelAnimationSampler(valid, budget), RangeError)
  const signal = AbortSignal.abort()
  assert.throws(() => createModelAnimationSampler(valid, undefined, signal), { name: 'AbortError' })
  assert.throws(() => createModelAnimationSampler(valid).sample(0, signal), { name: 'AbortError' })
  assert.throws(() => createModelAnimationSampler(valid).sample(NaN), TypeError)
})

test('values sampled into kept arrays are those sample makes, in the order of channels', () => {
  const cubic = (value, tangent) => ({ value, inTangent: tangent, outTangent: tangent })
  const sampler = createModelAnimationSampler(
    clip([
      channel('translation', 'linear', [
        [0, 2, 4],
        [-0, 4, 6],
        [4, 6, 8],
      ]),
      channel('visibility', 'step', [[0], [1], [0]]),
      channel('rotation', 'spherical-linear', [
        [0, 0, 0, 1],
        [0, 0, 1, 0],
      ]),
      {
        ...channel('scale', 'cubic-spline', [[1], [2], [1]]),
        samples: [cubic([1], [0]), cubic([2], [1.5]), cubic([1], [-1])].map((key, frame) => ({
          frame,
          timeSeconds: frame,
          ...key,
        })),
      },
      channel('translation', 'linear', [[10], [20]], { concurrent: true, wrapSeconds: 1 }),
      channel('rotation', 'linear', [[0], [1]], { axis: 'x' }),
    ]),
  )
  assert.deepEqual(sampler.channels, [
    { target: 'node-a', kind: 'translation' },
    { target: 'node-a', kind: 'visibility' },
    { target: 'node-a', kind: 'rotation' },
    { target: 'node-a', kind: 'scale' },
    { target: 'node-a', kind: 'translation' },
    { target: 'node-a', kind: 'rotation', axis: 'x' },
  ])
  // a kept array of another length ends as a new one would
  const values = [[7, 7, 7, 7, 7, 7, 7]]
  for (const time of [-1, 0, 0.5, 1, 1.25, 1.5, 2, 2.5, 4]) {
    sampler.sampleInto(time, values)
    assert.deepEqual(
      values,
      sampler.sample(time).map(item => [...item.value]),
    )
  }
  assert.throws(() => sampler.sampleInto(NaN, values), TypeError)
  assert.throws(() => sampler.sampleInto(0, values, AbortSignal.abort()), { name: 'AbortError' })
})

test('cubic rotation normalizes interiors and retains authored tracks with conservative extents', () => {
  const values = [
    [1, 0, 0, 0],
    [-0.8, 0, 0, 0.6],
    [0, 0, -0.8, 0.6],
  ]
  const rotation = channel('rotation', 'cubic-spline', values, {
    samples: values.map((value, frame) => ({
      frame,
      timeSeconds: [0, 0.75, 2.5][frame],
      value,
      inTangent: [0, 0, 0, 0],
      outTangent: [0, 0, 0, 0],
    })),
  })
  const authored = clip([rotation])
  const before = structuredClone(authored)
  const sampler = createModelAnimationSampler(authored)
  const extent = sampler.extent(0)
  assert.equal(extent.between, 'hull')
  assert.deepEqual(extent.arcs, [])
  for (const value of values)
    assert.ok(extent.points.some(point => point.every((x, i) => x === value[i])))
  for (const time of [0.1, 0.375, 0.7, 0.8, 1.625, 2.49]) {
    const sampled = sampler.sample(time)[0].value
    const into = []
    sampler.sampleInto(time, into)
    assert.deepEqual(into[0], sampled)
    assert.ok(Math.abs(Math.hypot(...sampled) - 1) < 1e-12)
    for (let axis = 0; axis < 4; axis++) {
      assert.ok(sampled[axis] >= Math.min(...extent.points.map(point => point[axis])))
      assert.ok(sampled[axis] <= Math.max(...extent.points.map(point => point[axis])))
    }
  }
  assert.ok(Math.abs(sampler.sample(0.375)[0].value[0] - 1 / Math.sqrt(10)) < 1e-12)
  assert.ok(Math.abs(sampler.sample(0.375)[0].value[3] - 3 / Math.sqrt(10)) < 1e-12)
  assert.deepEqual(authored, before)
  assert.deepEqual(
    snapshotModelAnimations([authored])[0].channels[0].samples,
    before.channels[0].samples,
  )
})

test('cubic quaternion dispatch does not change linear, step, nonrotation or axis channels', () => {
  const values = [
    [1, 0, 0, 0],
    [-0.8, 0, 0, 0.6],
  ]
  const cubic = channel('rotation', 'cubic-spline', values, {
    samples: values.map((value, frame) => ({
      frame,
      timeSeconds: frame,
      value,
      inTangent: [0, 0, 0, 0],
      outTangent: [0, 0, 0, 0],
    })),
  })
  const controls = [
    channel('rotation', 'linear', values),
    { ...cubic, kind: 'scale' },
    { ...cubic, kind: 'node.rotation' },
    { ...cubic, kind: 'bone.rotation' },
    { ...cubic, axis: 'x' },
  ]
  for (const control of controls) {
    const sampler = createModelAnimationSampler(clip([control]))
    const value = sampler.sample(0.5)[0].value
    assert.ok(Math.abs(value[0] - 0.1) < 1e-12)
    assert.ok(Math.abs(value[3] - 0.3) < 1e-12)
    assert.ok(Math.hypot(...value) < 0.32)
    assert.ok(sampler.extent(0).points.length < 16)
  }
  assert.deepEqual(
    createModelAnimationSampler(clip([channel('rotation', 'step', values)])).sample(0.5)[0].value,
    values[0],
  )
  const spherical = createModelAnimationSampler(
    clip([channel('rotation', 'spherical-linear', values)]),
  )
  assert.ok(Math.abs(Math.hypot(...spherical.sample(0.5)[0].value) - 1) < 1e-12)
  assert.ok(spherical.sample(0.5)[0].value[3] < 0)
  assert.equal(spherical.extent(0).between, 'arc')
})

test('cubic rotation preserves zero and nonunit boundary samples and raw tangent extents', () => {
  const values = [
    [0, 0, 0, 2],
    [0, 0, 0, -2],
  ]
  const rotation = channel('rotation', 'cubic-spline', values, {
    samples: values.map((value, frame) => ({
      frame,
      timeSeconds: frame,
      value,
      inTangent: [0, 0, 0, 0],
      outTangent: [0, 0, 0, 0],
    })),
  })
  const sampler = createModelAnimationSampler(clip([rotation]))
  assert.deepEqual(sampler.sample(0.5)[0].value, [0, 0, 0, 0])
  assert.deepEqual(sampler.sample(-1)[0].value, values[0])
  assert.deepEqual(sampler.sample(1)[0].value, values[1])
  const single = { ...rotation, samples: rotation.samples.slice(0, 1) }
  assert.deepEqual(createModelAnimationSampler(clip([single])).sample(0.5)[0].value, values[0])
  const overshoot = structuredClone(rotation)
  overshoot.samples[0].outTangent = [12, 0, 0, 0]
  const extent = createModelAnimationSampler(clip([overshoot])).extent(0)
  assert.ok(extent.points.some(point => point[0] === 4 && point[3] === 2))
  assert.ok(extent.points.some(point => point[3] === -2))
})

test('the extent of a channel holds every value it takes, whatever the time', () => {
  const cubic = (value, inTangent, outTangent) => ({ value, inTangent, outTangent })
  const sampler = createModelAnimationSampler(
    clip([
      channel('translation', 'linear', [
        [0, 2, -4],
        [2, 4, 6],
        [-4, 6, 8],
      ]),
      channel('scale', 'step', [
        [1, 1, 1],
        [2, 0.5, 1],
        [1, 3, 1],
      ]),
      channel('rotation', 'spherical-linear', [
        [0, 0, 0, 0.5],
        [0, 0, 1, 0],
        [0, 0.6, -0.8, 0],
      ]),
      {
        ...channel('translation', 'cubic-spline', [[0], [1], [0]]),
        samples: [cubic([0], [0], [6]), cubic([1], [-5], [4]), cubic([0], [3], [0])].map(
          (key, frame) => ({ frame, timeSeconds: frame, ...key }),
        ),
      },
      channel('translation', 'linear', [[10], [-20]], { concurrent: true, wrapSeconds: 0.75 }),
    ]),
  )
  const extents = sampler.channels.map((_, index) => sampler.extent(index))
  assert.deepEqual(
    extents.map(({ width, between }) => [width, between]),
    [
      [3, 'hull'],
      [3, 'step'],
      [4, 'arc'],
      [1, 'hull'],
      [1, 'hull'],
    ],
  )
  // the cubic's inner control points: 0 + 6/3, 1 + 5/3, 1 + 4/3, 0 − 3/3
  assert.deepEqual(extents[3].points, [[0], [2], [1 + 5 / 3], [1], [1 + 4 / 3], [-1], [0]])
  // slerp's shorter way: the third key turned to the second's side
  assert.deepEqual(extents[2].arcs, [
    [
      [0, 0, 0, 0.5],
      [0, 0, 1, 0],
    ],
    [
      [0, 0, 1, 0],
      [-0, -0.6, 0.8, -0],
    ],
  ])
  const length = vector => Math.hypot(...vector)
  const distance = (a, b) => Math.hypot(...a.map((x, axis) => x - b[axis]))
  const unit = vector => vector.map(x => x / length(vector))
  let spread = 0
  for (let step = -10; step <= 310; step++) {
    const time = step / 100
    for (const [index, { value }] of sampler.sample(time).entries()) {
      const { between, points, arcs } = extents[index]
      const key = points.some(point => distance(point, value) === 0)
      if (between === 'step') assert.ok(key, `${index} at ${time}: not a key`)
      if (between === 'arc' && !key) {
        // a unit quaternion no farther from either end of its arc than the ends from each other
        assert.ok(Math.abs(length(value) - 1) < 1e-12)
        assert.ok(
          arcs.some(([from, to]) => {
            const span = distance(unit(from), unit(to)) + 1e-12
            return distance(value, unit(from)) <= span && distance(value, unit(to)) <= span
          }),
          `${index} at ${time}: off its arcs`,
        )
        continue
      }
      // within the box and the length of the points
      for (const [axis, x] of value.entries()) {
        const low = Math.min(...points.map(point => point[axis]))
        const high = Math.max(...points.map(point => point[axis]))
        assert.ok(x >= low - 1e-12 && x <= high + 1e-12, `${index} at ${time}: ${x}`)
      }
      const longest = Math.max(...points.map(length))
      spread = Math.max(spread, length(value) / longest)
      assert.ok(length(value) <= longest * (1 + 1e-12), `${index} at ${time}: ${value}`)
    }
  }
  assert.ok(spread > 0.99)
  assert.equal(sampler.extent(0), extents[0])
  assert.throws(() => sampler.extent(5), RangeError)
})

test('explicit global time separates concurrent channels and preserves local sampling', () => {
  const source = clip([
    channel('translation', 'linear', [
      [0, 0, 0],
      [4, 0, 0],
    ]),
    channel(
      'scale',
      'linear',
      [
        [0, 0, 0],
        [4, 0, 0],
      ],
      { concurrent: true, wrapSeconds: 1 },
    ),
    channel('visibility', 'linear', [[0], [4]], { concurrent: true, wrapSeconds: 0.5 }),
  ])
  const sampler = createModelAnimationSampler(source)
  const values = []
  const sampled = sampler.sample(0.25, undefined, 0.75)
  assert.deepEqual(
    sampled.map(item => item.value[0]),
    [1, 3, 1],
  )
  sampler.sampleInto(0.25, values, undefined, 0.75)
  assert.deepEqual(
    values,
    sampled.map(item => item.value),
  )
  assert.deepEqual(
    sampler.sample(0.25).map(item => item.value[0]),
    [1, 1, 1],
  )
  assert.deepEqual(
    sampler.sample(0.25, undefined, 0).map(item => item.value[0]),
    [1, 0, 0],
  )
  assert.deepEqual(
    sampler.sample(1, undefined, 0.75).map(item => item.value[0]),
    [4, 3, 1],
  )
  assert.deepEqual(
    sampler.sample(-0.25).map(item => item.value[0]),
    [0, 0, 0],
  )
  assert.deepEqual(
    sampler.sample(-0.25, undefined, 0.75).map(item => item.value[0]),
    [0, 3, 1],
  )
  assert.deepEqual(
    sampler.sample(0.25, undefined, 1).map(item => item.value[0]),
    [1, 0, 0],
  )
})

test('global time validates even empty clips, with owned output and cancellation intact', () => {
  for (const source of [
    clip([]),
    clip([
      channel(
        'translation',
        'linear',
        [
          [0, 0, 0],
          [4, 0, 0],
        ],
        { concurrent: true },
      ),
    ]),
  ]) {
    const sampler = createModelAnimationSampler(source)
    for (const invalid of [-1, NaN, Infinity, -Infinity, null, '0']) {
      assert.throws(() => sampler.sample(0.25, undefined, invalid), /global time/)
      assert.throws(() => sampler.sampleInto(0.25, [], undefined, invalid), /global time/)
    }
    assert.throws(() => sampler.sample(0.25, AbortSignal.abort(), 0.75), { name: 'AbortError' })
    assert.throws(() => sampler.sampleInto(0.25, [], AbortSignal.abort(), 0.75), {
      name: 'AbortError',
    })
    assert.deepEqual(sampler.sample(0.25, undefined, 0), sampler.sample(0))
  }
})
