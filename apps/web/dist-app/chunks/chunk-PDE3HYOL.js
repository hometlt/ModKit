// packages/codec-kit/dist/texture/cdf97.js
var LOW_EVEN = [-0.057543526229, 1.11508705, -0.057543526229];
var LOW_ODD = [-0.091271763114, 0.591271763114, 0.591271763114, -0.091271763114];
var HIGH_EVEN = [0.016864118443, -0.266864118443, -0.266864118443, 0.016864118443];
var HIGH_ODD = [0.026748757411, -0.078223266529, 0.602949018236, -0.078223266529, 0.026748757411];
function pair(low, high, at, stride, oddLastOffset = 2) {
  let even = 0, odd = 0;
  for (let i = 0; i < LOW_EVEN.length; i++)
    even += low[at + (i - 1) * stride] * LOW_EVEN[i];
  for (let i = 0; i < HIGH_EVEN.length; i++)
    even += high[at + (i - 2) * stride] * HIGH_EVEN[i];
  for (let i = 0; i < LOW_ODD.length; i++)
    odd += low[at + (i - 1) * stride] * LOW_ODD[i];
  for (let i = 0; i < HIGH_ODD.length; i++)
    odd += high[at + (i === 4 ? oddLastOffset : i - 2) * stride] * HIGH_ODD[i];
  return [even, odd];
}
function synthesizeCdf97(bands, window, options) {
  options.signal?.throwIfAborted();
  for (const value of [
    bands.width,
    bands.height,
    window.x,
    window.y,
    window.width,
    window.height,
    options.maxElements
  ])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError("CDF97 dimensions/budget invalid");
  const inputSize = bands.width * bands.height, outputWidth = window.width * 2, outputHeight = window.height * 2;
  const outputSize = outputWidth * outputHeight, scratchSize = outputHeight * bands.width * 2;
  if (!window.width || !window.height || !Number.isSafeInteger(inputSize) || !Number.isSafeInteger(outputSize) || !Number.isSafeInteger(scratchSize) || inputSize * 4 + outputSize + scratchSize > options.maxElements)
    throw new RangeError("CDF97 exceeds element budget");
  if (window.x < 2 || window.y < 2 || window.x + window.width + 1 >= bands.width || window.y + window.height + 1 >= bands.height)
    throw new RangeError("CDF97 filter support exceeds band border");
  const oddLast = options.lhVerticalOddLastOffset ?? 2;
  if (oddLast !== 1 && oddLast !== 2)
    throw new TypeError("CDF97 profile offset unsupported");
  for (const band of [bands.ll, bands.lh, bands.hl, bands.hh]) {
    if (band.length !== inputSize)
      throw new RangeError("CDF97 band size disagrees");
    for (let i = 0; i < inputSize; i++) {
      if ((i & 4095) === 0)
        options.signal?.throwIfAborted();
      if (!Number.isFinite(band[i]))
        throw new TypeError("CDF97 coefficient is not finite");
    }
  }
  const low = new Float64Array(outputHeight * bands.width), high = new Float64Array(low.length);
  for (let y = 0; y < window.height; y++) {
    options.signal?.throwIfAborted();
    for (let x = 0; x < bands.width; x++) {
      const at = (window.y + y) * bands.width + x;
      const l = pair(bands.ll, bands.lh, at, bands.width, oddLast), h = pair(bands.hl, bands.hh, at, bands.width);
      low[2 * y * bands.width + x] = l[0];
      low[(2 * y + 1) * bands.width + x] = l[1];
      high[2 * y * bands.width + x] = h[0];
      high[(2 * y + 1) * bands.width + x] = h[1];
    }
  }
  const output = new Float64Array(outputSize);
  for (let y = 0; y < outputHeight; y++) {
    options.signal?.throwIfAborted();
    for (let x = 0; x < window.width; x++) {
      const p = pair(low, high, y * bands.width + window.x + x, 1);
      output[y * outputWidth + 2 * x] = p[0];
      output[y * outputWidth + 2 * x + 1] = p[1];
    }
  }
  if (!output.every(Number.isFinite))
    throw new RangeError("CDF97 synthesis overflow");
  return output;
}

export {
  synthesizeCdf97
};
