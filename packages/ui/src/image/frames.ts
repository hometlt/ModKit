/**
 * Sprite-sheet frames over a raster: the codec's own atlas regions, or a grid the reader lays over
 * the image. Regions are in pixels of mip 0 (`RasterAtlasRegion`); a smaller shown mip scales them.
 */
import type { RasterAtlasRegion } from '@modkit/sdk'

/** Most frames a grid lays out, so a mistyped 10 000 × 10 000 cannot freeze the page. */
export const MAX_GRID_FRAMES = 4_096

/** `columns × rows` equal cells over the whole image, row by row; a remainder stays outside. */
export function gridFrames(
  width: number,
  height: number,
  columns: number,
  rows: number,
): readonly RasterAtlasRegion[] {
  const across = Math.max(1, Math.floor(columns))
  const down = Math.max(1, Math.floor(rows))
  const cellWidth = Math.floor(width / across)
  const cellHeight = Math.floor(height / down)
  if (cellWidth < 1 || cellHeight < 1 || across * down > MAX_GRID_FRAMES) return []
  const frames: RasterAtlasRegion[] = []
  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      frames.push({
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
        name: String(frames.length),
      })
    }
  }
  return frames
}

/** A mip-0 region in the pixels of an image shown at `shownWidth × shownHeight`, never empty. */
export function shownRegion(
  region: RasterAtlasRegion,
  base: { readonly width: number; readonly height: number },
  shownWidth: number,
  shownHeight: number,
): RasterAtlasRegion {
  const kx = shownWidth / Math.max(1, base.width)
  const ky = shownHeight / Math.max(1, base.height)
  const x = Math.min(shownWidth - 1, Math.max(0, Math.floor(region.x * kx)))
  const y = Math.min(shownHeight - 1, Math.max(0, Math.floor(region.y * ky)))
  return {
    x,
    y,
    width: Math.max(1, Math.min(shownWidth - x, Math.round(region.width * kx))),
    height: Math.max(1, Math.min(shownHeight - y, Math.round(region.height * ky))),
    ...(region.name === undefined ? {} : { name: region.name }),
  }
}

/** `<base>_frame_007.png`, or with the format's own name when it has one: `<base>_frame_007_idle.png`. */
export function frameFileName(base: string, index: number, count: number, name?: string): string {
  const number = String(index).padStart(Math.max(3, String(count - 1).length), '0')
  const label = name === undefined || name === String(index) ? '' : name.replace(/[^\w.-]+/gu, '_')
  return `${base}_frame_${number}${label === '' ? '' : `_${label}`}.png`
}
