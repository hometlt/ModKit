// packages/codec-kit/src/table-source.ts
function createTableDataSource(options) {
  const header = Object.freeze([...options.header]);
  const rows = options.rows.map(
    (cells, index) => Object.freeze({ index, cells: Object.freeze(cells.map(String)) })
  );
  const startOf = (request) => {
    if (!Number.isSafeInteger(request.count) || request.count <= 0) {
      throw new TypeError("table page count must be a positive safe integer");
    }
    const start = request.kind === "range" ? request.from : Number(request.cursor ?? 0);
    if (!Number.isSafeInteger(start) || (start ?? -1) < 0) {
      throw new TypeError("table page start is invalid");
    }
    return start;
  };
  return Object.freeze({
    async shape() {
      return { rows: rows.length, columns: header.length, header: [...header] };
    },
    async rows(request, signal) {
      signal?.throwIfAborted();
      const start = startOf(request);
      const items = rows.slice(start, start + request.count);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < rows.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async cell(coord) {
      const value = rows[coord.row]?.cells[coord.column];
      if (value === void 0) throw new RangeError("table cell is outside the table");
      return Object.freeze({ value, ...options.cellFacts?.(coord, value) ?? {} });
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase();
      for (const row of rows) {
        for (let column = 0; column < row.cells.length; column += 1) {
          signal?.throwIfAborted();
          if (row.cells[column].toLocaleLowerCase().includes(needle)) {
            yield { row: row.index, column };
          }
        }
      }
    }
  });
}

export {
  createTableDataSource
};
