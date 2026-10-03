// ../../MODDING/modkit-core/packages/codec-kit/dist/json-snapshot.js
function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 128)
      bytes++;
    else if (code < 2048)
      bytes += 2;
    else if (code >= 55296 && code <= 56319 && text.charCodeAt(index + 1) >= 56320 && text.charCodeAt(index + 1) <= 57343) {
      bytes += 4;
      index++;
    } else
      bytes += 3;
  }
  return bytes;
}
function snapshotJson(value, budget, signal) {
  for (const limit of [budget?.maxDepth, budget?.maxNodes, budget?.maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError("invalid JSON snapshot budget");
  }
  const ancestors = /* @__PURE__ */ new Set();
  let nodes = 0;
  let bytes = 0;
  const charge = (count) => {
    bytes += count;
    if (bytes > budget.maxBytes)
      throw new RangeError("JSON snapshot exceeds maxBytes");
  };
  const copy = (entry, depth) => {
    if (signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    if (depth > budget.maxDepth)
      throw new RangeError("JSON snapshot exceeds maxDepth");
    if (++nodes > budget.maxNodes)
      throw new RangeError("JSON snapshot exceeds maxNodes");
    if (entry === null || typeof entry === "boolean") {
      charge(entry === false ? 5 : 4);
      return entry;
    }
    if (typeof entry === "string") {
      charge(utf8ByteLength(JSON.stringify(entry)));
      return entry;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      charge(JSON.stringify(entry).length);
      return entry;
    }
    if (typeof entry !== "object" || entry === null)
      throw new TypeError("non-JSON snapshot value");
    const prototype = Object.getPrototypeOf(entry);
    if (!Array.isArray(entry) && prototype !== null && prototype !== Object.prototype) {
      throw new TypeError("JSON snapshot requires plain objects");
    }
    if (ancestors.has(entry))
      throw new TypeError("cyclic JSON snapshot");
    ancestors.add(entry);
    try {
      charge(2);
      if (Array.isArray(entry)) {
        const result2 = [];
        for (let index = 0; index < entry.length; index++) {
          if (index > 0)
            charge(1);
          result2.push(copy(entry[index], depth + 1));
        }
        return Object.freeze(result2);
      }
      const result = [];
      const entries = Object.entries(entry);
      if (budget.sortKeys)
        entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      for (const [key, item] of entries) {
        if (item === void 0)
          continue;
        charge(utf8ByteLength(JSON.stringify(key)) + 1 + (result.length > 0 ? 1 : 0));
        result.push([key, copy(item, depth + 1)]);
      }
      return Object.freeze(Object.fromEntries(result));
    } finally {
      ancestors.delete(entry);
    }
  };
  return copy(value, 0);
}

export {
  snapshotJson
};
