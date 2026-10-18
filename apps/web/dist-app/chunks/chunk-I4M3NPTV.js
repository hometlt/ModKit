// packages/codec-kit/dist/raster/ops.js
var at = (pixels, index) => pixels[index];
function checked(image) {
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new TypeError(`image: expected ${image.width * image.height * 4} bytes, got ${image.pixels.length}`);
  }
  return image;
}
function pasteRgba(canvas, image, x, y, mode = "over") {
  checked(canvas);
  checked(image);
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new TypeError("paste position must be integral");
  const target = canvas.pixels;
  const source = image.pixels;
  const x0 = Math.max(0, x);
  const x1 = Math.min(canvas.width, x + image.width);
  for (let row = Math.max(0, y); row < Math.min(canvas.height, y + image.height); row += 1) {
    for (let column = x0; column < x1; column += 1) {
      const s = ((row - y) * image.width + (column - x)) * 4;
      const d = (row * canvas.width + column) * 4;
      if (mode === "opaque") {
        target[d] = at(source, s);
        target[d + 1] = at(source, s + 1);
        target[d + 2] = at(source, s + 2);
        target[d + 3] = 255;
        continue;
      }
      const alpha = at(source, s + 3);
      if (alpha === 0)
        continue;
      const keep = 255 - alpha;
      target[d] = Math.round((at(source, s) * alpha + at(target, d) * keep) / 255);
      target[d + 1] = Math.round((at(source, s + 1) * alpha + at(target, d + 1) * keep) / 255);
      target[d + 2] = Math.round((at(source, s + 2) * alpha + at(target, d + 2) * keep) / 255);
      target[d + 3] = Math.max(at(target, d + 3), alpha);
    }
  }
}
function resizeRgba(image, width, height) {
  checked(image);
  if (width === image.width && height === image.height) {
    return { width, height, pixels: image.pixels.slice() };
  }
  const out = new Uint8Array(width * height * 4);
  const xScale = image.width / width;
  const yScale = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, (y + 0.5) * yScale - 0.5);
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, (x + 0.5) * xScale - 0.5);
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = at(image.pixels, (y0 * image.width + x0) * 4 + channel);
        const p10 = at(image.pixels, (y0 * image.width + x1) * 4 + channel);
        const p01 = at(image.pixels, (y1 * image.width + x0) * 4 + channel);
        const p11 = at(image.pixels, (y1 * image.width + x1) * 4 + channel);
        out[target + channel] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy);
      }
    }
  }
  return { width, height, pixels: out };
}
function combineNormalSpecular(normal, specular) {
  checked(normal);
  checked(specular);
  const scaled = specular.width === normal.width && specular.height === normal.height ? specular : resizeRgba(specular, normal.width, normal.height);
  const out = normal.pixels.slice();
  for (let index = 0; index < out.length; index += 4) {
    out[index + 2] = at(scaled.pixels, index + 2);
  }
  return { width: normal.width, height: normal.height, pixels: out };
}
function roundedRectCoverage(x, y, width, height, radius) {
  const px = x + 0.5;
  const py = y + 0.5;
  const cx = px < radius ? radius : px > width - radius ? width - radius : px;
  const cy = py < radius ? radius : py > height - radius ? height - radius : py;
  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= radius - 0.5)
    return 1;
  if (distance >= radius + 0.5)
    return 0;
  return radius + 0.5 - distance;
}
function applyRoundedAlpha(image, radius) {
  checked(image);
  const out = image.pixels.slice();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const coverage = roundedRectCoverage(x, y, image.width, image.height, radius);
      const alpha = (y * image.width + x) * 4 + 3;
      out[alpha] = Math.round(at(out, alpha) * coverage);
    }
  }
  return { width: image.width, height: image.height, pixels: out };
}
function applyColorKeyTransparency(image, options) {
  checked(image);
  const tolerance = options.tolerance ?? 0;
  const replacement = options.replacement ?? { r: 0, g: 0, b: 0, a: 0 };
  const out = image.pixels.slice();
  for (let index = 0; index < out.length; index += 4) {
    const close = Math.abs(at(out, index) - options.target.r) <= tolerance && Math.abs(at(out, index + 1) - options.target.g) <= tolerance && Math.abs(at(out, index + 2) - options.target.b) <= tolerance;
    if (close) {
      out[index] = replacement.r;
      out[index + 1] = replacement.g;
      out[index + 2] = replacement.b;
      out[index + 3] = replacement.a;
    }
  }
  return { width: image.width, height: image.height, pixels: out };
}
function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(value) {
  return value <= 31308e-7 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}
function rgbToHsv(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0)
    return [0, 0, max];
  let hue;
  if (max === r)
    hue = (g - b) / delta % 6;
  else if (max === g)
    hue = (b - r) / delta + 2;
  else
    hue = (r - g) / delta + 4;
  hue /= 6;
  if (hue < 0)
    hue += 1;
  return [hue, max === 0 ? 0 : delta / max, max];
}
function hsvToRgb(hue, saturation, value) {
  const chroma = value * saturation;
  const sector = (hue % 1 + 1) % 1 * 6;
  const secondary = chroma * (1 - Math.abs(sector % 2 - 1));
  let rgb;
  if (sector < 1)
    rgb = [chroma, secondary, 0];
  else if (sector < 2)
    rgb = [secondary, chroma, 0];
  else if (sector < 3)
    rgb = [0, chroma, secondary];
  else if (sector < 4)
    rgb = [0, secondary, chroma];
  else if (sector < 5)
    rgb = [secondary, 0, chroma];
  else
    rgb = [chroma, 0, secondary];
  const match = value - chroma;
  return [rgb[0] + match, rgb[1] + match, rgb[2] + match];
}

export {
  pasteRgba,
  resizeRgba,
  combineNormalSpecular,
  applyRoundedAlpha,
  applyColorKeyTransparency,
  srgbToLinear,
  linearToSrgb,
  rgbToHsv,
  hsvToRgb
};
