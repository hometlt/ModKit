import type { WorldColorization } from '@modkit/sdk/maps'

const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Approximate SC2's undocumented LUT builder: levels, contrast/brightness, colourized HSL blend.
 * ponytail: LUT sampling/order is confirmed; replace this generator when native voxel math is recovered.
 */
export function colorizeWorldColor(color: readonly number[], settings: WorldColorization): number[] {
  const base = color.slice(0, 3).map(value => {
    const normalized = clamp((value - settings.inputLow) / Math.max(1e-6, settings.inputHigh - settings.inputLow))
    const level = settings.outputLow + Math.pow(normalized, 1 / Math.max(1e-6, settings.inputGamma)) * (settings.outputHigh - settings.outputLow)
    return clamp(((level - 0.5) * settings.contrast + 0.5) * settings.brightness)
  })
  const lightness = clamp((Math.max(...base) + Math.min(...base)) / 2 + settings.lightness)
  const saturation = clamp(settings.saturation)
  const hue = ((settings.hue % 1) + 1) % 1
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((hue * 6) % 2 - 1)), m = lightness - chroma / 2
  const segments = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]]
  const tint = segments[Math.floor(hue * 6)]!
  const blend = clamp(settings.blend)
  return base.map((value, channel) => value * (1 - blend) + (tint[channel]! + m) * blend)
}

/** X=red, Y=green, Z=blue, as sampler3D expects. */
export function createWorldColorLut(settings: WorldColorization, size = 16): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 2 || size > 64) throw new TypeError('colour LUT size must be 2..64')
  const result = new Uint8Array(size ** 3 * 4)
  for (let blue = 0; blue < size; blue++) for (let green = 0; green < size; green++) for (let red = 0; red < size; red++) {
    const color = colorizeWorldColor([red / (size - 1), green / (size - 1), blue / (size - 1)], settings)
    const offset = ((blue * size + green) * size + red) * 4
    for (let channel = 0; channel < 3; channel++) result[offset + channel] = Math.round(clamp(color[channel]!) * 255)
    result[offset + 3] = 255
  }
  return result
}
