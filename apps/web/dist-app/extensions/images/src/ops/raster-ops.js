/**
 * The raster authoring operations the legacy MK2 image codec shipped beside its DDS decoder.
 *
 * Ported verbatim in behaviour from
 * `references/modkitmk2/extensions/common/images/codecs/dds/src/ops.ts`: `resizeRgba`,
 * `convertNormalMapToSc2`, `combineNormalSpecular`, `applyRoundedAlpha`, `prepareSc2ButtonIcon`
 * and `applyColorKeyTransparency`. Every one takes and returns `{ width, height, pixels }` with
 * `pixels` in top-left-first RGBA8 order, and none of them mutates its input.
 *
 * Two of these encode StarCraft II's texture conventions rather than anything general — the
 * channel layout SC2 expects from a normal map, and the framed, rounded button icon its UI uses.
 * They are here because the port carries everything MK2 had; which extension should own a
 * game-specific authoring operation is a placement question for phase B, not a reason to leave the
 * capability behind.
 */

function checked(image) {
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
export function resizeRgba(image, width, height) {
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
        const p00 = image.pixels[(y0 * image.width + x0) * 4 + channel]
        const p10 = image.pixels[(y0 * image.width + x1) * 4 + channel]
        const p01 = image.pixels[(y1 * image.width + x0) * 4 + channel]
        const p11 = image.pixels[(y1 * image.width + x1) * 4 + channel]
        out[target + channel] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy,
        )
      }
    }
  }
  return { width, height, pixels: out }
}

/**
 * Rearrange a conventional tangent-space normal map into the channel layout SC2 samples.
 *
 * Source `(x, y, z)` becomes `(z, 1 - y, 0, x)`: the X component moves into alpha, Y is flipped
 * for SC2's handedness, Z takes the red channel and blue is cleared — the shader reconstructs the
 * third component, so storing it would waste a channel that DXT5 compresses badly anyway.
 */
export function convertNormalMapToSc2(image) {
  checked(image)
  const out = new Uint8Array(image.pixels.length)
  for (let index = 0; index < image.pixels.length; index += 4) {
    out[index] = image.pixels[index + 2]
    out[index + 1] = 255 - image.pixels[index + 1]
    out[index + 2] = 0
    out[index + 3] = image.pixels[index]
  }
  return { width: image.width, height: image.height, pixels: out }
}

/**
 * Put a specular map into the blue channel a converted SC2 normal map leaves empty.
 *
 * The specular image is resampled to the normal map's size when they differ; only its blue channel
 * is read, which is what the legacy pipeline did with greyscale specular art.
 */
export function combineNormalSpecular(normal, specular) {
  checked(normal)
  checked(specular)
  const scaled =
    specular.width === normal.width && specular.height === normal.height
      ? specular
      : resizeRgba(specular, normal.width, normal.height)
  const out = normal.pixels.slice()
  for (let index = 0; index < out.length; index += 4) out[index + 2] = scaled.pixels[index + 2]
  return { width: normal.width, height: normal.height, pixels: out }
}

/** Coverage of one pixel by a rounded rectangle: 1 inside, 0 outside, antialiased on the edge. */
function roundedRectCoverage(x, y, width, height, radius) {
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
export function applyRoundedAlpha(image, radius) {
  checked(image)
  const out = image.pixels.slice()
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const coverage = roundedRectCoverage(x, y, image.width, image.height, radius)
      const alpha = (y * image.width + x) * 4 + 3
      out[alpha] = Math.round(out[alpha] * coverage)
    }
  }
  return { width: image.width, height: image.height, pixels: out }
}

/**
 * Turn arbitrary art into an SC2 button icon: rounded, inset inside a transparent frame.
 *
 * The defaults are the proportions SC2's UI uses — a frame of 5/128 of the icon on each edge and a
 * corner radius of 16/118 of the inner art — so `prepareSc2ButtonIcon(image)` on a 128×128 source
 * reproduces the stock geometry. Every derived number can be overridden; `finalSize` and
 * `innerSize` are the square shorthands legacy kept for its older callers.
 */
export function prepareSc2ButtonIcon(image, options = {}) {
  checked(image)
  const finalWidth = options.finalWidth ?? options.finalSize ?? image.width
  const finalHeight = options.finalHeight ?? options.finalSize ?? image.height
  const framePercent = options.framePercent ?? 5 / 128
  const innerWidth =
    options.innerWidth ??
    options.innerSize ??
    Math.max(1, Math.round(finalWidth * (1 - framePercent * 2)))
  const innerHeight =
    options.innerHeight ??
    options.innerSize ??
    Math.max(1, Math.round(finalHeight * (1 - framePercent * 2)))
  const radius =
    options.radius ?? Math.max(1, Math.round(Math.min(innerWidth, innerHeight) * (16 / 118)))
  const borderX = Math.floor((finalWidth - innerWidth) / 2)
  const borderY = Math.floor((finalHeight - innerHeight) / 2)
  const rounded = applyRoundedAlpha(resizeRgba(image, innerWidth, innerHeight), radius)
  const out = new Uint8Array(finalWidth * finalHeight * 4)
  for (let y = 0; y < innerHeight; y += 1) {
    const target = ((y + borderY) * finalWidth + borderX) * 4
    out.set(rounded.pixels.subarray(y * innerWidth * 4, (y + 1) * innerWidth * 4), target)
  }
  return { width: finalWidth, height: finalHeight, pixels: out }
}

/**
 * Replace every pixel within `tolerance` of a target colour, channel by channel.
 *
 * The match is on RGB only — alpha does not take part — and the replacement writes all four
 * channels, defaulting to fully transparent black. This is the "the artist used magenta as the
 * background" case.
 */
export function applyColorKeyTransparency(image, options) {
  checked(image)
  const tolerance = options.tolerance ?? 0
  const replacement = options.replacement ?? { r: 0, g: 0, b: 0, a: 0 }
  const out = image.pixels.slice()
  for (let index = 0; index < out.length; index += 4) {
    const close =
      Math.abs(out[index] - options.target.r) <= tolerance &&
      Math.abs(out[index + 1] - options.target.g) <= tolerance &&
      Math.abs(out[index + 2] - options.target.b) <= tolerance
    if (close) {
      out[index] = replacement.r
      out[index + 1] = replacement.g
      out[index + 2] = replacement.b
      out[index + 3] = replacement.a
    }
  }
  return { width: image.width, height: image.height, pixels: out }
}
