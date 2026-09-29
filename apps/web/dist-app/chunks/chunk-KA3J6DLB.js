import {
  snapshotJson
} from "./chunk-ZSDVUSRM.js";

// ../MODDING/modkit-core/packages/codec-kit/dist/tree/json-tree.js
function required(value) {
  if (value === void 0)
    throw new TypeError("unknown JSON tree node");
  return value;
}
function createJsonTreeSource(input, options) {
  const budget = Object.freeze({ ...options.budget });
  const lifetimeSignal = options.signal;
  const label = options.label ?? "Document";
  const write = options.write === void 0 ? void 0 : snapshotJson(options.write, budget, lifetimeSignal);
  const document = snapshotJson(input, budget, lifetimeSignal);
  const keys = /* @__PURE__ */ new WeakMap();
  const check = (signal) => {
    if (signal?.aborted || lifetimeSignal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
  };
  const objectKeys = (value) => {
    let result = keys.get(value);
    if (!result) {
      result = Object.freeze(Object.keys(value));
      keys.set(value, result);
    }
    return result;
  };
  const childCount = (value) => Array.isArray(value) ? value.length : value !== null && typeof value === "object" ? objectKeys(value).length : 0;
  const ref = (id, value) => Object.freeze({ id, hasChildren: childCount(value) > 0 });
  const childId = (id, key) => `${id}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
  const resolve = (id) => {
    if (id !== "json:" && !id.startsWith("json:/"))
      throw new TypeError("unknown JSON tree node");
    const path = id === "json:" ? [] : id.slice(6).split("/", budget.maxDepth + 1).map((key) => {
      if (/~(?:[^01]|$)/u.test(key))
        throw new TypeError("invalid JSON tree pointer");
      return key.replace(/~1/gu, "/").replace(/~0/gu, "~");
    });
    if (path.length > budget.maxDepth)
      throw new RangeError("JSON tree pointer exceeds maxDepth");
    let value = document;
    for (const key of path) {
      if (Array.isArray(value)) {
        if (!/^(0|[1-9][0-9]*)$/u.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= value.length)
          throw new TypeError("unknown JSON tree array node");
        value = required(value[Number(key)]);
      } else {
        if (value === null || typeof value !== "object" || !Object.hasOwn(value, key))
          throw new TypeError("unknown JSON tree node");
        value = required(value[key]);
      }
    }
    return { value, path: Object.freeze(path) };
  };
  const labelOf = (path) => path.at(-1) ?? label;
  const preview = (value) => value === null ? "null" : typeof value === "object" ? `${Array.isArray(value) ? "Array" : "Object"} (${childCount(value)})` : String(value).slice(0, 512);
  return Object.freeze({
    async root() {
      check();
      return ref("json:", document);
    },
    async children(node, page, signal) {
      check(signal);
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0 || page.limit > 4096)
        throw new RangeError("JSON tree page limit must be between 1 and 4096");
      if (page.cursor !== void 0 && !/^(0|[1-9][0-9]*)$/u.test(page.cursor))
        throw new TypeError("invalid JSON tree cursor");
      const start = Number(page.cursor ?? 0);
      if (!Number.isSafeInteger(start))
        throw new TypeError("invalid JSON tree cursor");
      const { value } = resolve(node.id);
      const count = childCount(value);
      if (start > count)
        throw new RangeError("JSON tree cursor exceeds child count");
      const items = [];
      for (let index = start; index < Math.min(count, start + page.limit); index++) {
        const key = Array.isArray(value) ? String(index) : required(objectKeys(value)[index]);
        const child = Array.isArray(value) ? required(value[index]) : required(value[key]);
        items.push(ref(childId(node.id, key), child));
      }
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < count ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async facts(node) {
      check();
      const { value, path } = resolve(node.id);
      const scalar = value === null || typeof value !== "object";
      return Object.freeze({
        kind: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
        label: labelOf(path),
        preview: preview(value),
        semanticPath: path,
        ...scalar ? {
          value,
          type: typeof value === "string" ? { kind: "text" } : typeof value === "boolean" ? { kind: "boolean" } : typeof value === "number" ? { kind: "number" } : { kind: "json" },
          ...write === void 0 || path.length === 0 ? {} : { editable: { write } }
        } : {}
      });
    },
    async *search(query, signal) {
      check(signal);
      if (query.pattern.length > 4096)
        throw new RangeError("JSON tree query exceeds limit");
      const needle = query.pattern.toLowerCase();
      const stack = [{ id: "json:", value: document, path: [], next: -1 }];
      while (stack.length) {
        check(signal);
        const item = required(stack.at(-1));
        if (item.next === -1 && `${labelOf(item.path)}
${typeof item.value === "object" ? preview(item.value) : String(item.value)}`.toLowerCase().includes(needle))
          yield ref(item.id, item.value);
        const index = Math.max(0, item.next);
        item.next = index + 1;
        if (index >= childCount(item.value)) {
          stack.pop();
          continue;
        }
        const key = Array.isArray(item.value) ? String(index) : required(objectKeys(item.value)[index]);
        const value = Array.isArray(item.value) ? required(item.value[index]) : required(item.value[key]);
        stack.push({ id: childId(item.id, key), value, path: [...item.path, key], next: -1 });
      }
    }
  });
}

export {
  createJsonTreeSource
};
