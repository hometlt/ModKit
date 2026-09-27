/** Cells per side of the overlap grid, at most. */
const GRID_MAX_SIDE = 512
/** An item covering more cells than this is compared with every earlier item instead. */
const LARGE_ITEM_CELLS = 1024

/**
 * Levels for depth-sorted transparent draws. The blending order changes the picture only where two
 * draws cover the same pixel, so an item may move past any earlier item it does not overlap on screen.
 * Each item lands one level above every earlier overlapping item of another batch and no lower than an
 * earlier overlapping item of its own batch. Inside one level no two batches overlap, so a batch's
 * items there draw as one run in the given order and the blended result is the sorted order's.
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
): Int32Array {
  const count = batches.length
  if (source.length !== count * 4)
    throw new TypeError('transparent order boxes must hold four bounds per item')
  if (!(epsilon >= 0)) throw new TypeError('transparent order epsilon must be nonnegative')
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
  const cells: (number[] | undefined)[] = new Array<number[] | undefined>(side * side)
  const large: number[] = []
  const visited = new Int32Array(count).fill(-1)
  let item = 0
  let x0 = 0
  let y0 = 0
  let x1 = 0
  let y1 = 0
  let batch = -1
  let level = 0
  const visit = (other: number) => {
    if (visited[other] === item) return
    visited[other] = item
    const offset = other * 4
    if (
      boxes[offset]! > x1 ||
      boxes[offset + 2]! < x0 ||
      boxes[offset + 1]! > y1 ||
      boxes[offset + 3]! < y0
    )
      return
    const required = levels[other]! + (batch >= 0 && batches[other] === batch ? 0 : 1)
    if (required > level) level = required
  }
  for (; item < count; item += 1) {
    const offset = item * 4
    x0 = boxes[offset]! - epsilon
    y0 = boxes[offset + 1]! - epsilon
    x1 = boxes[offset + 2]! + epsilon
    y1 = boxes[offset + 3]! + epsilon
    batch = batches[item]!
    level = 0
    if (x0 > x1 || y0 > y1) {
      // Empty: overlaps nothing, before or after.
      levels[item] = 0
      continue
    }
    for (const other of large) visit(other)
    const finite = Number.isFinite(x0 + y0 + x1 + y1)
    const cx0 = finite ? cellOf(x0, minimumX, cellWidth) : 0
    const cx1 = finite ? cellOf(x1, minimumX, cellWidth) : side - 1
    const cy0 = finite ? cellOf(y0, minimumY, cellHeight) : 0
    const cy1 = finite ? cellOf(y1, minimumY, cellHeight) : side - 1
    const oversized = !finite || (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > LARGE_ITEM_CELLS
    if (oversized) for (let other = 0; other < item; other += 1) visit(other)
    else
      for (let cy = cy0; cy <= cy1; cy += 1)
        for (let cx = cx0; cx <= cx1; cx += 1) {
          const members = cells[cy * side + cx]
          if (members !== undefined) for (const other of members) visit(other)
        }
    levels[item] = level
    if (oversized) large.push(item)
    else
      for (let cy = cy0; cy <= cy1; cy += 1)
        for (let cx = cx0; cx <= cx1; cx += 1) {
          const index = cy * side + cx
          const members = cells[index]
          if (members === undefined) cells[index] = [item]
          else members.push(item)
        }
  }
  return levels
}
