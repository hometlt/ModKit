// ../../MODDING/modkit-core/packages/codec-kit/dist/model-math/transform.js
function normalizeQuat(value) {
  const x = value[0] ?? 0;
  const y = value[1] ?? 0;
  const z = value[2] ?? 0;
  const w = value[3] ?? 1;
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}
function decomposeMatrix4(matrix) {
  const m = (at) => matrix[at] ?? (at % 5 === 0 ? 1 : 0);
  const determinant = m(0) * (m(5) * m(10) - m(9) * m(6)) - m(4) * (m(1) * m(10) - m(9) * m(2)) + m(8) * (m(1) * m(6) - m(5) * m(2));
  const sx = (determinant < 0 ? -1 : 1) * Math.hypot(m(0), m(1), m(2));
  const sy = Math.hypot(m(4), m(5), m(6));
  const sz = Math.hypot(m(8), m(9), m(10));
  const tiny = 1e-12 * Math.max(1, Math.abs(sx), sy, sz);
  const unit = (scale, at) => Math.abs(scale) <= tiny ? void 0 : [m(at) / scale, m(at + 1) / scale, m(at + 2) / scale];
  let x = unit(sx, 0);
  let y = unit(sy, 4);
  let z = unit(sz, 8);
  if (x === void 0 && y === void 0 && z === void 0)
    [x, y, z] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  if (x !== void 0 && y === void 0 && z === void 0)
    y = perpendicular(x);
  else if (y !== void 0 && z === void 0 && x === void 0)
    z = perpendicular(y);
  else if (z !== void 0 && x === void 0 && y === void 0)
    x = perpendicular(z);
  if (z === void 0)
    z = cross(x, y);
  if (x === void 0)
    x = cross(y, z);
  if (y === void 0)
    y = cross(z, x);
  return {
    translation: [m(12), m(13), m(14)],
    scaling: [sx, sy, sz],
    rotation: quaternionFromRotationMatrix([...x, ...y, ...z])
  };
}
function cross(a, b) {
  const c = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const length = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / length, c[1] / length, c[2] / length];
}
function perpendicular(v) {
  return cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
}
function quaternionFromRotationMatrix(matrix) {
  const m00 = matrix[0] ?? 1;
  const m01 = matrix[3] ?? 0;
  const m02 = matrix[6] ?? 0;
  const m10 = matrix[1] ?? 0;
  const m11 = matrix[4] ?? 1;
  const m12 = matrix[7] ?? 0;
  const m20 = matrix[2] ?? 0;
  const m21 = matrix[5] ?? 0;
  const m22 = matrix[8] ?? 1;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s2 = Math.sqrt(trace + 1) * 2;
    return normalizeQuat([(m21 - m12) / s2, (m02 - m20) / s2, (m10 - m01) / s2, 0.25 * s2]);
  }
  if (m00 > m11 && m00 > m22) {
    const s2 = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuat([0.25 * s2, (m01 + m10) / s2, (m02 + m20) / s2, (m21 - m12) / s2]);
  }
  if (m11 > m22) {
    const s2 = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuat([(m01 + m10) / s2, 0.25 * s2, (m12 + m21) / s2, (m02 - m20) / s2]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuat([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}
function invertAffine(matrix) {
  const value = (index) => {
    const one = matrix[index];
    return typeof one === "number" && Number.isFinite(one) ? one : 0;
  };
  const basis = [
    value(0),
    value(1),
    value(2),
    value(4),
    value(5),
    value(6),
    value(8),
    value(9),
    value(10)
  ];
  const determinant = basis[0] * (basis[4] * basis[8] - basis[5] * basis[7]) - basis[3] * (basis[1] * basis[8] - basis[2] * basis[7]) + basis[6] * (basis[1] * basis[5] - basis[2] * basis[4]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new RangeError("a bind matrix with no inverse cannot place a baked part");
  const inverse = [
    (basis[4] * basis[8] - basis[5] * basis[7]) / determinant,
    (basis[2] * basis[7] - basis[1] * basis[8]) / determinant,
    (basis[1] * basis[5] - basis[2] * basis[4]) / determinant,
    (basis[5] * basis[6] - basis[3] * basis[8]) / determinant,
    (basis[0] * basis[8] - basis[2] * basis[6]) / determinant,
    (basis[2] * basis[3] - basis[0] * basis[5]) / determinant,
    (basis[3] * basis[7] - basis[4] * basis[6]) / determinant,
    (basis[1] * basis[6] - basis[0] * basis[7]) / determinant,
    (basis[0] * basis[4] - basis[1] * basis[3]) / determinant
  ];
  const translation = [value(12), value(13), value(14)];
  const moved = [0, 1, 2].map((row) => -(inverse[row] * translation[0] + inverse[row + 3] * translation[1] + inverse[row + 6] * translation[2]));
  return [
    inverse[0],
    inverse[1],
    inverse[2],
    0,
    inverse[3],
    inverse[4],
    inverse[5],
    0,
    inverse[6],
    inverse[7],
    inverse[8],
    0,
    moved[0],
    moved[1],
    moved[2],
    1
  ];
}
function multiplyAffine(left, right) {
  const product = new Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++)
        sum += (left[k * 4 + row] ?? 0) * (right[column * 4 + k] ?? 0);
      product[column * 4 + row] = sum;
    }
  return product;
}

export {
  normalizeQuat,
  decomposeMatrix4,
  quaternionFromRotationMatrix,
  invertAffine,
  multiplyAffine
};
