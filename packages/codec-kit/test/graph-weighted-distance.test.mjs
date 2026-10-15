import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weightedDistanceField, DistanceBudgetError } from '../dist/graph/weighted-distance.js'

const budgets = (n, a, s = 1) => ({
  queueEntries: s + a,
  pushes: s + a,
  pops: s + a,
  expansions: n,
  edges: a,
  comparisons: 4 * (s + a) * (Math.ceil(Math.log2(Math.max(1, s + a))) + 1),
  allocatedBytes: 8 * n + 20 * (s + a),
})
const graph = edges => (node, emit) => {
  for (const [to, cost] of edges[node] ?? []) emit(to, cost)
}

test('stable sources, stale entries and strict weighted improvements use one kernel', () => {
  const edges = [
    [
      [1, 9],
      [2, 1],
    ],
    [],
    [[1, 1]],
  ]
  const r = weightedDistanceField(3, [0], graph(edges), { budgets: budgets(3, 3) })
  assert.deepEqual([...r.distances], [0, 2, 1])
  assert.equal(r.counters.pushes, 4)
  assert.equal(r.counters.pops, 4)
  assert.equal(r.counters.expansions, 3)
  assert.equal(r.counters.edges, 3)
})
test('legacy source indices, duplicates, owner ties, callbacks and pop-only fringe survive', () => {
  const trace = [],
    owners = new Int32Array(3)
  const r = weightedDistanceField(3, [-1, 0, 0, 2], graph([[[1, 2]], [], [[1, 2]]]), {
    limit: 1,
    onSource: (node, index) => {
      trace.push(['s', node, index])
      owners[node] = index + 1
    },
    onImprove: (from, to) => {
      trace.push(['i', from, to])
      owners[to] = owners[from]
    },
  })
  assert.deepEqual([...r.distances], [0, 2, 0])
  assert.deepEqual([...owners], [3, 3, 4])
  assert.deepEqual(trace, [
    ['s', 0, 1],
    ['s', 0, 2],
    ['s', 2, 3],
    ['i', 0, 1],
  ])
  assert.equal(r.counters.expansions, 3)
})
test('fixed queue and every work cap refuse at one beyond the actual allowance', () => {
  const run = b =>
    weightedDistanceField(
      3,
      [0],
      graph([
        [
          [1, 1],
          [2, 1],
        ],
        [],
        [],
      ]),
      { budgets: b },
    )
  const good = budgets(3, 2)
  assert.deepEqual([...run(good).distances], [0, 1, 1])
  for (const [name, value] of [
    ['queueEntries', 1],
    ['pushes', 2],
    ['pops', 2],
    ['expansions', 2],
    ['edges', 1],
    ['comparisons', 0],
    ['allocatedBytes', 8 * 3 + 20 * 3 - 1],
  ])
    assert.throws(() => run({ ...good, [name]: value }), DistanceBudgetError, name)
})
test('budgets checked before allocation; zero edges accepted, invalid and overflowing costs refuse', () => {
  const b = budgets(2, 1)
  assert.equal(weightedDistanceField(2, [0], graph([[[1, 0]], []]), { budgets: b }).distances[1], 0)
  for (const cost of [-1, NaN, Infinity])
    assert.throws(
      () => weightedDistanceField(2, [0], graph([[[1, cost]], []]), { budgets: b }),
      DistanceBudgetError,
    )
  assert.throws(
    () =>
      weightedDistanceField(3, [0], graph([[[1, Number.MAX_VALUE]], [[2, Number.MAX_VALUE]], []]), {
        budgets: budgets(3, 2),
      }),
    DistanceBudgetError,
  )
  assert.throws(
    () =>
      weightedDistanceField(2, [0], graph([]), {
        budgets: { ...b, queueEntries: Number.MAX_SAFE_INTEGER },
      }),
    DistanceBudgetError,
  )
})
test('abort exposes no field and each invocation resets FIFO and counters', () => {
  const abort = new AbortController()
  abort.abort()
  assert.throws(
    () => weightedDistanceField(1, [0], graph([]), { signal: abort.signal }),
    DistanceBudgetError,
  )
  const a = weightedDistanceField(3, [0, 2], graph([[[1, 1]], [], [[1, 1]]]), {
    budgets: budgets(3, 2, 2),
  })
  const b = weightedDistanceField(3, [0, 2], graph([[[1, 1]], [], [[1, 1]]]), {
    budgets: budgets(3, 2, 2),
  })
  assert.deepEqual(a, b)
  const during = new AbortController()
  assert.throws(
    () =>
      weightedDistanceField(1, [0], () => during.abort(), {
        signal: during.signal,
        budgets: budgets(1, 0),
      }),
    DistanceBudgetError,
  )
})
