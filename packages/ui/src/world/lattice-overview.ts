/** Shared semantic overview drawing. Accepts only the neutral lattice contract; game rules and
 * native document parsing remain at the publisher. Raster allocation is bounded by validation.
 */
import type { LatticePoint, LatticeRunRows, MapLatticeOverview } from '@modkit/sdk/maps'
import { validateLatticeOverview } from '@modkit/sdk/maps'

/** Expand semantic scalar/mask rows into display pixels; no encoded image or native flags enter. */
export function latticeOverviewPixels(value: MapLatticeOverview): Uint8ClampedArray {
  const overview = validateLatticeOverview(value)
  const { columns, rows, elevation, palette } = overview.raster
  const pixels = new Uint8ClampedArray(columns * rows * 4)
  for (let y = 0; y < rows; y++) {
    let x = 0
    for (const [length, sample] of elevation[y]!) {
      const last = palette[palette.length - 1]!
      const level = Math.max(palette[0]!.value, Math.min(last.value, sample))
      let hi = 1
      while (hi < palette.length - 1 && level > palette[hi]!.value) hi++
      const a = palette[hi - 1]!,
        b = palette[hi]!,
        t = (level - a.value) / (b.value - a.value)
      const color = a.color.map((channel, i) => Math.round(channel + (b.color[i]! - channel) * t))
      for (let n = 0; n < length; n++, x++) {
        const at = (y * columns + x) * 4
        pixels[at] = color[0]!
        pixels[at + 1] = color[1]!
        pixels[at + 2] = color[2]!
        pixels[at + 3] = 255
      }
    }
  }
  const mask = (data: LatticeRunRows | undefined, apply: (at: number) => void) => {
    if (data === undefined) return
    for (let y = 0; y < rows; y++) {
      let x = 0
      for (const [length, sample] of data[y]!) {
        if (sample === 1) for (let n = 0; n < length; n++) apply((y * columns + x + n) * 4)
        x += length
      }
    }
  }
  const shade = (at: number, alpha: number) => {
    for (let k = 0; k < 3; k++) pixels[at + k] = Math.round(pixels[at + k]! * (1 - alpha))
  }
  // No-build is weaker than blocked: apply it first, then let blocked use the original colour.
  const before =
    overview.raster.blocked !== undefined && overview.raster.noBuild !== undefined
      ? pixels.slice()
      : undefined
  mask(overview.raster.noBuild, at => shade(at, 0.2))
  mask(overview.raster.blocked, at => {
    if (before) for (let k = 0; k < 3; k++) pixels[at + k] = before[at + k]!
    shade(at, 0.45)
  })
  mask(overview.raster.vision, at => {
    for (const [k, color] of [255, 215, 0].entries())
      pixels[at + k] = Math.round(pixels[at + k]! * 0.45 + color * 0.55)
  })
  return pixels
}

/** Draw a validated canonical overview in the same world-to-screen frame as the ordinary lattice. */
export function drawLatticeOverview(
  canvas: HTMLCanvasElement,
  value: MapLatticeOverview,
  screen: (point: LatticePoint) => LatticePoint,
  cells: readonly { readonly vertices: readonly { readonly point: LatticePoint }[] }[] = [],
): void {
  const overview = validateLatticeOverview(value)
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2D lattice canvas is unavailable')
  const raster = overview.raster
  const offscreen = new OffscreenCanvas(raster.columns, raster.rows)
  const buffer = offscreen.getContext('2d')
  if (buffer === null) throw new TypeError('2D lattice raster canvas is unavailable')
  const image = buffer.createImageData(raster.columns, raster.rows)
  image.data.set(latticeOverviewPixels(overview))
  buffer.putImageData(image, 0, 0)
  const p = screen(raster.origin)
  const x = screen([
    raster.origin[0] + raster.columnStep[0],
    raster.origin[1] + raster.columnStep[1],
  ])
  const y = screen([raster.origin[0] + raster.rowStep[0], raster.origin[1] + raster.rowStep[1]])
  context.save()
  context.imageSmoothingEnabled = false
  context.transform(x[0] - p[0], x[1] - p[1], y[0] - p[0], y[1] - p[1], p[0], p[1])
  context.drawImage(offscreen, 0, 0)
  context.restore()
  context.strokeStyle = 'rgba(255,255,255,0.08)'
  context.lineWidth = 0.35
  for (const cell of cells) {
    context.beginPath()
    context.moveTo(...screen(cell.vertices[0]!.point))
    for (const vertex of cell.vertices.slice(1)) context.lineTo(...screen(vertex.point))
    context.closePath()
    context.stroke()
  }
  const polygon = (points: readonly LatticePoint[], closed: boolean) => {
    context.beginPath()
    context.moveTo(...screen(points[0]!))
    for (const point of points.slice(1)) context.lineTo(...screen(point))
    if (closed) context.closePath()
  }
  for (const line of overview.lines) {
    context.strokeStyle = line.role === 'cliff' ? '#fff' : 'rgba(255,255,255,0.3)'
    context.lineWidth = line.role === 'cliff' ? 1.4 : 0.8
    polygon(line.points, line.closed)
    context.stroke()
  }
  for (const marker of overview.markers) {
    const color = `rgb(${marker.color.join(' ')})`
    context.save()
    context.globalAlpha = marker.opacity
    polygon(marker.outline, true)
    context.fillStyle = color
    context.strokeStyle = marker.role === 'start' ? color : '#111'
    context.lineWidth = marker.role === 'start' ? 2 : 1
    if (marker.role !== 'start') context.fill()
    context.stroke()
    if (marker.role === 'start') {
      context.beginPath()
      context.arc(...screen(marker.point), 4, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }
  if (overview.playableArea !== undefined) {
    context.beginPath()
    context.rect(0, 0, canvas.width, canvas.height)
    context.moveTo(...screen(overview.playableArea[0]!))
    for (const point of overview.playableArea.slice(1)) context.lineTo(...screen(point))
    context.closePath()
    context.fillStyle = 'rgba(0,0,0,0.6)'
    context.fill('evenodd')
  }
}
