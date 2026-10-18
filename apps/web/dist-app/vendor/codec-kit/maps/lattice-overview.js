import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/maps/lattice-overview.js
function encodeLatticeRunRows(columns, rows, sample) {
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns <= 0 || rows <= 0 || columns * rows > 4194304)
    throw new RangeError("Lattice overview sample budget exceeded");
  return Array.from({ length: rows }, (_, y) => {
    const runs = [];
    for (let x = 0; x < columns; x++) {
      const value = sample(x, y);
      if (!Number.isFinite(value))
        throw new TypeError("Nonfinite lattice sample");
      const last = runs[runs.length - 1];
      if (last?.[1] === value)
        last[0]++;
      else
        runs.push([1, value]);
    }
    return runs;
  });
}
export {
  encodeLatticeRunRows
};
