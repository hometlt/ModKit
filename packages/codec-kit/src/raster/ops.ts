/**
 * The raster authoring operations MK2 shipped beside its DDS codec, shared by every image codec.
 *
 * Ported verbatim in behaviour from `references/modkitmk2/extensions/common/images/codecs/dds/src/ops.ts`
 * (`resizeRgba`, `combineNormalSpecular`, `applyRoundedAlpha`, `applyColorKeyTransparency`), by
 * way of MK3's `extensions/images/src/ops/raster-ops.js`. Every one takes and returns
 * `{ width, height, pixels }` in top-left-first RGBA8 order, and none of them mutates its input.
 */
import type { RgbaImage } from '../texture/types.js'

const at = (pixels: Uint8Array, index: number): number => pixels[index] as number

function checked(image: RgbaImage): RgbaImage {
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new TypeError(
      `image: expected ${image.width * image.height * 4} bytes, got ${image.pixels.length}`,
    )
  }
  return image
}

/**
 * Bilinear resample to an exact size.
 *
 * Sampling is at pixel centres (`(i + 0.5) * scale - 0.5`) with edge clamping, so a 1:1 resize is
 * the identity and an upscale does not shift the image by half a texel. Resizing to the same
 * dimensions short-circuits to a copy.
 */
export function resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  checked(image)
  if (width === image.width && height === image.height) {
    return { width, height, pixels: image.pixels.slice() }
  }
  const out = new Uint8Array(width * height * 4)
  const xScale = image.width / width
  const yScale = image.height / height
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, (y + 0.5) * yScale - 0.5)
    const y0 = Math.max(0, Math.floor(sourceY))
    const y1 = Math.min(image.height - 1, y0 + 1)
    const fy = sourceY - y0
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, (x + 0.5) * xScale - 0.5)
      const x0 = Math.max(0, Math.floor(sourceX))
      const x1 = Math.min(image.width - 1, x0 + 1)
      const fx = sourceX - x0
      const target = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = at(image.pixels, (y0 * image.width + x0) * 4 + channel)
        const p10 = at(image.pixels, (y0 * image.width + x1) * 4 + channel)
        const p01 = at(image.pixels, (y1 * image.width + x0) * 4 + channel)
        const p11 = at(image.pixels, (y1 * image.width + x1) * 4 + channel)
        out[target + channel] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy,
        )
      }
    }
  }
  return { width, height, pixels: out }
}

/**
 * Put a specular map into the blue channel a converted SC2 normal map leaves empty.
 *
 * The specular image is resampled to the normal map's size when they differ; only its blue channel
 * is read, which is what the legacy pipeline did with greyscale specular art.
 */
export function combineNormalSpecular(normal: RgbaImage, specular: RgbaImage): RgbaImage {
  checked(normal)
  checked(specular)
  const scaled =
    specular.width === normal.width && specular.height === normal.height
      ? specular
      : resizeRgba(specular, normal.width, normal.height)
  const out = normal.pixels.slice()
  for (let index = 0; index < out.length; index += 4) {
    out[index + 2] = at(scaled.pixels, index + 2)
  }
  return { width: normal.width, height: normal.height, pixels: out }
}

/** Coverage of one pixel by a rounded rectangle: 1 inside, 0 outside, antialiased on the edge. */
function roundedRectCoverage(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): number {
  const px = x + 0.5
  const py = y + 0.5
  const cx = px < radius ? radius : px > width - radius ? width - radius : px
  const cy = py < radius ? radius : py > height - radius ? height - radius : py
  const dx = px - cx
  const dy = py - cy
  const distance = Math.sqrt(dx * dx + dy * dy)
  if (distance <= radius - 0.5) return 1
  if (distance >= radius + 0.5) return 0
  return radius + 0.5 - distance
}

/** Multiply alpha by a rounded-rectangle mask, leaving colour untouched. */
export function applyRoundedAlpha(image: RgbaImage, radius: number): RgbaImage {
  checked(image)
  const out = image.pixels.slice()
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const coverage = roundedRectCoverage(x, y, image.width, image.height, radius)
      const alpha = (y * image.width + x) * 4 + 3
      out[alpha] = Math.round(at(out, alpha) * coverage)
    }
  }
  return { width: image.width, height: image.height, pixels: out }
}

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export interface ColorKeyOptions {
  readonly target: { readonly r: number; readonly g: number; readonly b: number }
  readonly tolerance?: number
  readonly replacement?: Rgba
}

/** Every pixel within `tolerance` of the target colour becomes `replacement` (transparent black). */
export function applyColorKeyTransparency(image: RgbaImage, options: ColorKeyOptions): RgbaImage {
  checked(image)
  const tolerance = options.tolerance ?? 0
  const replacement = options.replacement ?? { r: 0, g: 0, b: 0, a: 0 }
  const out = image.pixels.slice()
  for (let index = 0; index < out.length; index += 4) {
    const close =
      Math.abs(at(out, index) - options.target.r) <= tolerance &&
      Math.abs(at(out, index + 1) - options.target.g) <= tolerance &&
      Math.abs(at(out, index + 2) - options.target.b) <= tolerance
    if (close) {
      out[index] = replacement.r
      out[index + 1] = replacement.g
      out[index + 2] = replacement.b
      out[index + 3] = replacement.a
    }
  }
  return { width: image.width, height: image.height, pixels: out }
}

/**
 * An sRGB-encoded channel in 0..1 as linear light, and back (IEC 61966-2-1): what a colour picked
 * in a game's editor (Roblox `Color3`, a BAR shader's `SRGBtoLINEAR`) is before it is lit.
 */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** {@link srgbToLinear} inverted. */
export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

/**
 * RGB in 0..1 as hue (turns, 0..1), saturation and value (0..1), and back: the colour model a
 * game's player colours are authored in (Westwood `[Colors]` H, S, V — scaled to 0..1 by the
 * caller). Grey has hue 0.
 */
export function rgbToHsv(
  rgb: readonly [number, number, number],
): readonly [number, number, number] {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return [0, 0, max]

  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue /= 6
  if (hue < 0) hue += 1
  return [hue, max === 0 ? 0 : delta / max, max]
}

/** {@link rgbToHsv} inverted; a hue outside 0..1 wraps. */
export function hsvToRgb(
  hue: number,
  saturation: number,
  value: number,
): readonly [number, number, number] {
  const chroma = value * saturation
  const sector = (((hue % 1) + 1) % 1) * 6
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1))
  let rgb: readonly [number, number, number]
  if (sector < 1) rgb = [chroma, secondary, 0]
  else if (sector < 2) rgb = [secondary, chroma, 0]
  else if (sector < 3) rgb = [0, chroma, secondary]
  else if (sector < 4) rgb = [0, secondary, chroma]
  else if (sector < 5) rgb = [secondary, 0, chroma]
  else rgb = [chroma, 0, secondary]
  const match = value - chroma
  return [rgb[0] + match, rgb[1] + match, rgb[2] + match]
}
