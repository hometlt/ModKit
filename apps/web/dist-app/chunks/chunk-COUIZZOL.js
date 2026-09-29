// ../MODDING/modkit-core/packages/codec-kit/dist/raster/ops.js
var at = (pixels, index) => pixels[index];
function checked(image) {
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new TypeError(`image: expected ${image.width * image.height * 4} bytes, got ${image.pixels.length}`);
  }
  return image;
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

export {
  resizeRgba,
  combineNormalSpecular,
  applyRoundedAlpha,
  applyColorKeyTransparency
};
