/** Cells per side of the overlap grid, at most. */
const GRID_MAX_SIDE = 512
/** An item covering more cells than this is compared with every earlier item instead. */
const LARGE_ITEM_CELLS = 1024

const EMPTY = 0
const IN_CELLS = 1
const LARGE = 2
const EVERYWHERE = 3

/** The item whose level is being found, as the earlier items' checks read it (see requiredLevel). */
interface LevelSearch {
  item: number
  batch: number
  blend: number
  x0: number
  y0: number
  x1: number
  y1: number
  level: number
}

/**
 * Raises `search.level` to what the earlier item `other` requires of it: one above `other`'s level, or
 * that level itself in the same batch, where `other` overlaps it on screen. An item placed at or below
 * the level less one, seen already (`visited`) or commuting with it cannot raise it.
 */
function requiredLevel(
  search: LevelSearch,
  other: number,
  levels: Int32Array,
  visited: Int32Array,
  boxes: Float64Array,
  batches: Int32Array,
  commuting: Uint8Array | undefined,
): void {
  const placedAt = levels[other]!
  if (placedAt + 1 <= search.level || visited[other] === search.item) return
  visited[other] = search.item
  if (search.blend !== 0 && commuting![other] === search.blend) return
  const at = other * 4
  if (
    boxes[at]! > search.x1 ||
    boxes[at + 2]! < search.x0 ||
    boxes[at + 1]! > search.y1 ||
    boxes[at + 3]! < search.y0
  )
    return
  const value = placedAt + (search.batch >= 0 && batches[other] === search.batch ? 0 : 1)
  if (value > search.level) search.level = value
}

/**
 * Levels for depth-sorted transparent draws. The blending order changes the picture only where two
 * draws cover the same pixel, so an item may move past any earlier item it does not overlap on screen.
 * Each item lands one level above every earlier overlapping item of another batch and no lower than an
 * earlier overlapping item of its own batch. Inside one level no two batches overlap, so a batch's
 * items there draw as one run in the given order and the blended result is the sorted order's.
 * Blends of one commuting class (`commuting[i] > 0`: additions to the target, say) give one sum in
 * any order, so such items do not order each other at all, whatever their batch.
 *
 * `boxes` holds [minX, minY, maxX, maxY] per item, in the given order, in any fixed orthonormal basis of
 * the view plane: under an orthographic view, overlap on screen is overlap of these projections. A box
 * with a non-finite bound overlaps everything; an empty box (min above max) overlaps nothing.
 * `batches[i] < 0` marks an item that never shares a draw. Boxes within `epsilon` count as overlapping.
 */
export function transparentOrderLevels(
  source: Float64Array,
  batches: Int32Array,
  epsilon: number,
  commuting?: Uint8Array,
): Int32Array {
  const count = batches.length
  if (source.length !== count * 4)
    throw new TypeError('transparent order boxes must hold four bounds per item')
  if (!(epsilon >= 0)) throw new TypeError('transparent order epsilon must be nonnegative')
  if (commuting !== undefined && commuting.length !== count)
    throw new TypeError('transparent order classes must hold one class per item')
  const levels = new Int32Array(count)
  const boxes = Float64Array.from(source)
  let minimumX = Infinity
  let minimumY = Infinity
  let maximumX = -Infinity
  let maximumY = -Infinity
  for (let offset = 0; offset < boxes.length; offset += 4) {
    const x0 = boxes[offset]!
    const y0 = boxes[offset + 1]!
    const x1 = boxes[offset + 2]!
    const y1 = boxes[offset + 3]!
    if (!Number.isFinite(x0 + y0 + x1 + y1)) {
      boxes.set([-Infinity, -Infinity, Infinity, Infinity], offset)
      continue
    }
    if (x0 > x1 || y0 > y1) continue
    if (x0 < minimumX) minimumX = x0
    if (y0 < minimumY) minimumY = y0
    if (x1 > maximumX) maximumX = x1
    if (y1 > maximumY) maximumY = y1
  }
  const side = Math.max(1, Math.min(GRID_MAX_SIDE, Math.ceil(Math.sqrt(count))))
  const cellWidth = maximumX > minimumX ? (maximumX - minimumX) / side : 1
  const cellHeight = maximumY > minimumY ? (maximumY - minimumY) / side : 1
  const cellOf = (value: number, minimum: number, size: number) =>
    Math.min(side - 1, Math.max(0, Math.floor((value - minimum) / size)))
  // Each item's cells (with epsilon), then every cell's items in ascending order: an item compares
  // with the earlier items of the cells it covers, so each cell's list is read up to the item itself.
  const kinds = new Uint8Array(count)
  const ranges = new Int32Array(count * 4)
  const starts = new Int32Array(side * side + 1)
  for (let item = 0; item < count; item += 1) {
    const offset = item * 4
    const x0 = boxes[offset]! - epsilon
    const y0 = boxes[offset + 1]! - epsilon
    const x1 = boxes[offset + 2]! + epsilon
    const y1 = boxes[offset + 3]! + epsilon
    if (x0 > x1 || y0 > y1) continue // Empty: overlaps nothing, before or after.
    if (!Number.isFinite(x0 + y0 + x1 + y1)) {
      kinds[item] = EVERYWHERE
      continue
    }
    const cx0 = cellOf(x0, minimumX, cellWidth)
    const cx1 = cellOf(x1, minimumX, cellWidth)
    const cy0 = cellOf(y0, minimumY, cellHeight)
    const cy1 = cellOf(y1, minimumY, cellHeight)
    ranges[offset] = cx0
    ranges[offset + 1] = cx1
    ranges[offset + 2] = cy0
    ranges[offset + 3] = cy1
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > LARGE_ITEM_CELLS) {
      kinds[item] = LARGE
      continue
    }
    kinds[item] = IN_CELLS
    for (let cy = cy0; cy <= cy1; cy += 1)
      for (let cx = cx0; cx <= cx1; cx += 1) starts[cy * side + cx + 1]! += 1
  }
  for (let cell = 0; cell < side * side; cell += 1) starts[cell + 1]! += starts[cell]!
  const members = new Int32Array(starts[side * side]!)
  const fill = starts.slice(0, side * side)
  for (let item = 0; item < count; item += 1) {
    if (kinds[item] !== IN_CELLS) continue
    const offset = item * 4
    for (let cy = ranges[offset + 2]!; cy <= ranges[offset + 3]!; cy += 1)
      for (let cx = ranges[offset]!; cx <= ranges[offset + 1]!; cx += 1)
        members[fill[cy * side + cx]!++] = item
  }
  // Per cell, one above the highest level among its members up to each one (members are placed in
  // order): read from the newest earlier member back, a cell's rest cannot raise the level being
  // found once its ceiling there does not exceed it. `placed` counts each cell's placed members.
  const ceilings = new Int32Array(members.length)
  const placed = starts.slice(0, side * side)
  const large: number[] = []
  let largeCeiling = 0
  const visited = new Int32Array(count).fill(-1)
  // One search object for every item: no closure or object is made per item.
  const search: LevelSearch = { item: 0, batch: 0, blend: 0, x0: 0, y0: 0, x1: 0, y1: 0, level: 0 }
  for (let item = 0; item < count; item += 1) {
    const kind = kinds[item]!
    if (kind === EMPTY) continue
    const offset = item * 4
    search.item = item
    search.x0 = boxes[offset]! - epsilon
    search.y0 = boxes[offset + 1]! - epsilon
    search.x1 = boxes[offset + 2]! + epsilon
    search.y1 = boxes[offset + 3]! + epsilon
    search.batch = batches[item]!
    search.blend = commuting?.[item] ?? 0
    search.level = 0
    if (kind === EVERYWHERE)
      for (let other = 0; other < item; other += 1)
        requiredLevel(search, other, levels, visited, boxes, batches, commuting)
    else {
      // Every earlier item the box overlaps is a large one or in a cell the box covers.
      for (let cy = ranges[offset + 2]!; cy <= ranges[offset + 3]!; cy += 1)
        for (let cx = ranges[offset]!; cx <= ranges[offset + 1]!; cx += 1) {
          const cell = cy * side + cx
          for (let at = placed[cell]! - 1, first = starts[cell]!; at >= first; at -= 1) {
            if (ceilings[at]! <= search.level) break
            requiredLevel(search, members[at]!, levels, visited, boxes, batches, commuting)
          }
        }
      if (largeCeiling > search.level)
        for (const other of large)
          requiredLevel(search, other, levels, visited, boxes, batches, commuting)
    }
    const level = search.level
    levels[item] = level
    if (kind !== IN_CELLS) {
      large.push(item)
      if (level + 1 > largeCeiling) largeCeiling = level + 1
    } else
      for (let cy = ranges[offset + 2]!; cy <= ranges[offset + 3]!; cy += 1)
        for (let cx = ranges[offset]!; cx <= ranges[offset + 1]!; cx += 1) {
          const cell = cy * side + cx
          const at = placed[cell]!++
          ceilings[at] = at > starts[cell]! ? Math.max(ceilings[at - 1]!, level + 1) : level + 1
        }
  }
  return levels
}
