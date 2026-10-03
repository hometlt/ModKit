// ../../MODDING/modkit-core/packages/codec-kit/dist/model/bounds.js
function boundsOf(positions, stride = 3) {
  if (!Number.isSafeInteger(stride) || stride < 3)
    throw new RangeError("bounds stride must be at least 3");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset + 2 < positions.length; offset += stride) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis];
      if (value < min[axis])
        min[axis] = value;
      if (value > max[axis])
        max[axis] = value;
    }
  }
  return { min, max };
}

export {
  boundsOf
};
