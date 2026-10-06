import assert from 'node:assert/strict'
import { it } from 'node:test'

import { transparentOrderLevels } from '../src/world/transparent-order.js'

const levelsOf = (items, epsilon = 0) =>
  Array.from(
    transparentOrderLevels(
      Float64Array.from(items.flatMap(item => item.box)),
      Int32Array.from(items.map(item => item.batch)),
      epsilon,
    ),
  )

// The O(n²) definition the grid accelerates.
function bruteForceLevels(boxes, batches, epsilon, commuting) {
  const levels = []
  for (let item = 0; item < batches.length; item += 1) {
    let level = 0
    const [x0, y0, x1, y1] = boxes.slice(item * 4, item * 4 + 4)
    for (let other = 0; other < item; other += 1) {
      const [a0, b0, a1, b1] = boxes.slice(other * 4, other * 4 + 4)
      if (a0 > x1 + epsilon || a1 < x0 - epsilon || b0 > y1 + epsilon || b1 < y0 - epsilon) continue
      if (commuting !== undefined && commuting[item] > 0 && commuting[other] === commuting[item])
        continue
      const same = batches[item] >= 0 && batches[other] === batches[item]
      level = Math.max(level, levels[other] + (same ? 0 : 1))
    }
    levels.push(level)
  }
  return levels
}

it('lets items of one batch share a level past other batches they do not overlap', () => {
  // Decals of two batches alternate in depth but lie apart on screen: one level, a draw per batch.
  assert.deepEqual(
    levelsOf([
      { box: [0, 0, 1, 1], batch: 0 },
      { box: [10, 0, 11, 1], batch: 1 },
      { box: [20, 0, 21, 1], batch: 0 },
      { box: [30, 0, 31, 1], batch: 1 },
    ]),
    [0, 0, 0, 0],
  )
})

it('keeps overlapping items of different batches in their depth order', () => {
  assert.deepEqual(
    levelsOf([
      { box: [0, 0, 1, 1], batch: 0 },
      { box: [0.5, 0, 1.5, 1], batch: 1 },
      { box: [1.2, 0, 2, 1], batch: 0 },
      // Same batch as the item it overlaps: stays on its level, drawn after it inside the run.
      { box: [1.4, 0, 2.2, 1], batch: 0 },
    ]),
    [0, 1, 2, 2],
  )
})

it('never merges items marked with a negative batch', () => {
  assert.deepEqual(
    levelsOf([
      { box: [0, 0, 1, 1], batch: -1 },
      { box: [0.5, 0, 1.5, 1], batch: -1 },
    ]),
    [0, 1],
  )
})

it('counts touching boxes, and boxes within epsilon, as overlapping', () => {
  assert.deepEqual(
    levelsOf([
      { box: [0, 0, 1, 1], batch: 0 },
      { box: [1, 0, 2, 1], batch: 1 },
    ]),
    [0, 1],
  )
  assert.deepEqual(
    levelsOf(
      [
        { box: [0, 0, 1, 1], batch: 0 },
        { box: [1.05, 0, 2, 1], batch: 1 },
      ],
      0.1,
    ),
    [0, 1],
  )
})

it('treats a non-finite box as covering everything and an empty box as covering nothing', () => {
  assert.deepEqual(
    levelsOf([
      { box: [0, 0, 1, 1], batch: 0 },
      { box: [Number.NaN, 0, 1, 1], batch: 1 },
      { box: [50, 50, 51, 51], batch: 0 },
      { box: [5, 5, 4, 4], batch: 2 },
    ]),
    [0, 1, 2, 0],
  )
})

it('matches the pairwise definition on random decal fields', () => {
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 2 ** 32
  }
  for (const [count, batchCount, span, size] of [
    [400, 3, 100, 4],
    [2000, 29, 200, 3],
    [300, 5, 20, 8],
  ]) {
    const boxes = []
    const batches = []
    for (let item = 0; item < count; item += 1) {
      const x = random() * span
      const y = random() * span
      // A few large items stand in for particle sprites and effect meshes.
      const extent = random() < 0.02 ? span / 2 : random() * size
      boxes.push(x, y, x + extent, y + random() * size)
      batches.push(random() < 0.05 ? -1 : Math.floor(random() * batchCount))
    }
    const levels = transparentOrderLevels(Float64Array.from(boxes), Int32Array.from(batches), 0.01)
    assert.deepEqual(Array.from(levels), bruteForceLevels(boxes, batches, 0.01))
  }
})

it('matches the pairwise definition on stacked decals, with boxes that cover all or nothing', () => {
  let seed = 777
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 2 ** 32
  }
  // Decals piled on a small area climb to high levels: an item's newest neighbours set its level.
  const boxes = []
  const batches = []
  for (let item = 0; item < 1500; item += 1) {
    const x = random() * 12
    const y = random() * 12
    const roll = random()
    if (roll < 0.01) boxes.push(-Infinity, 0, Infinity, 1)
    else if (roll < 0.02) boxes.push(5, 5, 4, 4)
    else boxes.push(x, y, x + 1 + random() * 3, y + 1 + random() * 3)
    batches.push(random() < 0.05 ? -1 : Math.floor(random() * 4))
  }
  const levels = transparentOrderLevels(Float64Array.from(boxes), Int32Array.from(batches), 0.01)
  // A box with a non-finite bound covers everything; an empty one covers nothing and stays at 0.
  const kept = []
  const covering = []
  batches.forEach((_, item) => {
    const box = boxes.slice(item * 4, item * 4 + 4)
    if (box.every(Number.isFinite) && (box[0] > box[2] || box[1] > box[3])) return
    kept.push(item)
    covering.push(...(box.every(Number.isFinite) ? box : [-Infinity, -Infinity, Infinity, Infinity]))
  })
  const expected = new Array(batches.length).fill(0)
  bruteForceLevels(
    covering,
    kept.map(item => batches[item]),
    0.01,
  ).forEach((level, index) => (expected[kept[index]] = level))
  assert.ok(Math.max(...levels) > 50)
  assert.deepEqual(Array.from(levels), expected)
})

it('lets blends of one commuting class pass each other where they overlap', () => {
  const items = [
    { box: [0, 0, 1, 1], batch: 0, blend: 1 },
    // Adds over the first, of another batch: sums alike before it, so it shares its level.
    { box: [0.5, 0, 1.5, 1], batch: 1, blend: 1 },
    // Blends over both: after them.
    { box: [0.2, 0, 1.2, 1], batch: 2, blend: 0 },
    // Adds over the blend: after it, whatever it adds with.
    { box: [0.4, 0, 1.4, 1], batch: 0, blend: 1 },
    // Multiplies over everything: never passes an add.
    { box: [0, 0, 2, 1], batch: 3, blend: 2 },
  ]
  const levels = transparentOrderLevels(
    Float64Array.from(items.flatMap(item => item.box)),
    Int32Array.from(items.map(item => item.batch)),
    0,
    Uint8Array.from(items.map(item => item.blend)),
  )
  assert.deepEqual(Array.from(levels), [0, 0, 1, 2, 3])
  assert.throws(
    () => transparentOrderLevels(new Float64Array(4), Int32Array.of(0), 0, new Uint8Array(2)),
    /one class per item/,
  )
})

it('matches the pairwise definition on random fields of commuting and ordered blends', () => {
  let seed = 4242
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 2 ** 32
  }
  const boxes = []
  const batches = []
  const commuting = []
  for (let item = 0; item < 1200; item += 1) {
    const x = random() * 40
    const y = random() * 40
    boxes.push(x, y, x + random() * 6, y + random() * 6)
    batches.push(random() < 0.05 ? -1 : Math.floor(random() * 6))
    commuting.push(random() < 0.5 ? 1 : random() < 0.3 ? 2 : 0)
  }
  const levels = transparentOrderLevels(
    Float64Array.from(boxes),
    Int32Array.from(batches),
    0.01,
    Uint8Array.from(commuting),
  )
  assert.deepEqual(Array.from(levels), bruteForceLevels(boxes, batches, 0.01, commuting))
})

it('matches the pairwise definition on piles of one batch among a few other draws', () => {
  // Draws of one batch piled on a small area, as a terrain decal's triangles are, with draws of other
  // batches, unbatched, commuting and large ones among them: a search stops early where only its own
  // batch stands at its level, and goes on where a draw of another batch stands there too. Large
  // draws cover one half or the other, so a newer one may stand below an older one.
  let seed = 9001
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 2 ** 32
  }
  for (const [count, span, share] of [
    [3000, 10, 0.95],
    [2500, 30, 0.8],
    [2400, 6, 0.99],
  ]) {
    const boxes = []
    const batches = []
    const commuting = []
    for (let item = 0; item < count; item += 1) {
      const x = random() * span
      const y = random() * span
      if (random() < 0.01)
        boxes.push(...(random() < 0.5 ? [0, 0, span * 0.48, span] : [span * 0.52, 0, span, span]))
      else boxes.push(x, y, x + 0.5 + random() * 2, y + 0.5 + random() * 2)
      const roll = random()
      batches.push(roll < share ? 0 : roll < (1 + share) / 2 ? -1 : 1 + Math.floor(random() * 3))
      commuting.push(random() < 0.1 ? 1 : 0)
    }
    const levels = transparentOrderLevels(
      Float64Array.from(boxes),
      Int32Array.from(batches),
      0.01,
      Uint8Array.from(commuting),
    )
    assert.ok(Math.max(...levels) > 10)
    assert.deepEqual(Array.from(levels), bruteForceLevels(boxes, batches, 0.01, commuting))
  }
})
