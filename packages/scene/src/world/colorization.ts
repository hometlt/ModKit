import type { WorldColorization } from '@modkit/sdk/maps'

const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** RGB to hue, saturation, lightness, each 0..1 (the editor's colour helpers). */
function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const high = Math.max(red, green, blue),
    low = Math.min(red, green, blue)
  const lightness = (high + low) / 2
  const range = high - low
  if (range === 0) return [0, 0, lightness]
  const saturation = range / (lightness >= 0.5 ? 2 - high - low : high + low)
  let hue =
    red === high
      ? (green - blue) / range
      : green === high
        ? (blue - red) / range + 2
        : (red - green) / range + 4
  hue /= 6
  while (hue < 0) hue += 1
  while (hue > 1) hue -= 1
  return [hue, saturation, lightness]
}

function hueChannel(p: number, q: number, t: number): number {
  const hue = t - Math.floor(t)
  if (hue < 1 / 6) return p + (q - p) * 6 * hue
  if (hue < 1 / 2) return q
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6
  return p
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  if (saturation === 0) return [lightness, lightness, lightness]
  const q =
    lightness >= 0.5
      ? saturation + lightness - saturation * lightness
      : (saturation + 1) * lightness
  const p = lightness * 2 - q
  return [hueChannel(p, q, hue + 1 / 3), hueChannel(p, q, hue), hueChannel(p, q, hue - 1 / 3)]
}

/**
 * One colour through SC2's colorization, as the editor builds its colour map (decompiled LUT builder,
 * `SC2Editor1 ... batch_058726_116452.c` ~2286501). Levels act on HSL lightness only, so hue and
 * saturation survive them: input levels, an input gamma mapped `g < 1 ? (1 - g)·9 + 1 : 1 - (g - 1)/9`
 * (the editor's slider is a log-like control, not an exponent), output levels, then brightness and
 * contrast as a power. Colorize then blends a tint of the authored hue and saturation at the new
 * lightness plus the lightness offset. The provider publishes colorization only for maps that set
 * `Colorize`, so this is the colorize mode.
 * ponytail: the shift mode (hue, saturation, lightness added to the colour's own) and the per-hue-range
 * adjustments need fields the SDK does not carry yet.
 */
export function colorizeWorldColor(color: readonly number[], settings: WorldColorization): number[] {
  const [hue, saturation, lightness] = rgbToHsl(clamp(color[0]!), clamp(color[1]!), clamp(color[2]!))
  const gamma = settings.inputGamma
  const exponent = gamma < 1 ? (1 - gamma) * 9 + 1 : gamma > 1 ? 1 - (gamma - 1) / 9 : 1
  const levelled = Math.pow(
    clamp((lightness - settings.inputLow) / (settings.inputHigh - settings.inputLow || 1e-6)),
    exponent,
  )
  const graded = clamp(
    Math.pow(
      Math.max(
        0,
        (levelled * (settings.outputHigh - settings.outputLow) + settings.outputLow) * settings.brightness,
      ),
      settings.contrast,
    ),
  )
  const base = hslToRgb(hue, clamp(saturation), graded)
  const tintLightness = clamp(graded + settings.lightness)
  const tint =
    settings.saturation === 0
      ? [tintLightness, tintLightness, tintLightness]
      : hslToRgb(settings.hue, settings.saturation, tintLightness)
  const blend = settings.blend
  return base.map((value, channel) => tint[channel]! * blend + value * (1 - blend))
}

/**
 * X=red, Y=green, Z=blue, as sampler3D expects. Texel `k` holds the colour `k / size`: SC2 samples its
 * map at `saturate(C + 0.5 / size)` (HDR.fx), so a channel at k/size reads texel k exactly and values
 * above (size - 1)/size clamp to the last texel.
 */
export function createWorldColorLut(settings: WorldColorization, size = 16): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 2 || size > 64) throw new TypeError('colour LUT size must be 2..64')
  const result = new Uint8Array(size ** 3 * 4)
  for (let blue = 0; blue < size; blue++) for (let green = 0; green < size; green++) for (let red = 0; red < size; red++) {
    const color = colorizeWorldColor([red / size, green / size, blue / size], settings)
    const offset = ((blue * size + green) * size + red) * 4
    for (let channel = 0; channel < 3; channel++) result[offset + channel] = Math.round(clamp(color[channel]!) * 255)
    result[offset + 3] = 255
  }
  return result
}
