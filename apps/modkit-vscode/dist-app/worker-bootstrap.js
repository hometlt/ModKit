// packages/host/dist/node/worker-bootstrap.js
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { workerData } from "node:worker_threads";

// packages/core/dist/ids.js
var SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var QUALIFIED = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
function isSegment(value2) {
  return SEGMENT.test(value2);
}
function isQualifiedId(value2) {
  return QUALIFIED.test(value2);
}
function isErrorCode(value2) {
  return isQualifiedId(value2);
}
function contractId(value2) {
  if (!isQualifiedId(value2))
    throw new TypeError(`invalid contract id: ${value2}`);
  return value2;
}
function errorCode(value2) {
  if (!isErrorCode(value2))
    throw new TypeError(`invalid diagnostic/error code: ${value2}`);
  return value2;
}
var OPERATION_DOMAINS = Object.freeze([
  "archive",
  "model",
  "image",
  "audio",
  "video",
  "vector",
  "document",
  "game",
  "map",
  "mod",
  "data",
  "script",
  "layout",
  "localization",
  "replay",
  "save",
  "runtime"
]);
var CONTAINER_EXTRACT_OPERATION_ID = "container.extract";
var SHARED_OPERATION_IDS = Object.freeze([
  "view.render",
  "view.inspect",
  "view.thumbnail",
  "view.hex",
  "media.play",
  "media.play-pause",
  "media.seek",
  "media.set-rate",
  "media.select-track",
  "edit.content",
  "edit.structure",
  "edit.field",
  "edit.undo-redo",
  "source.save",
  "source.save-as",
  "export.raw",
  "export.convert",
  CONTAINER_EXTRACT_OPERATION_ID,
  "container.pack",
  "asset.search",
  "asset.validate",
  "asset.compare",
  "content.resolve-dependencies",
  "content.mount"
]);

// packages/core/dist/version.js
var SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
function parseSafeInteger(value2) {
  const parsed = Number(value2);
  return Number.isSafeInteger(parsed) ? parsed : void 0;
}
function parseSemver(value2) {
  const m = SEMVER.exec(value2);
  if (!m)
    return void 0;
  const major = parseSafeInteger(m[1] ?? "");
  const minor = parseSafeInteger(m[2] ?? "");
  const patch = parseSafeInteger(m[3] ?? "");
  if (major === void 0 || minor === void 0 || patch === void 0)
    return void 0;
  const prerelease = (m[4] ?? "").split(".").filter((part) => part.length > 0).map((part) => /^\d+$/.test(part) ? parseSafeInteger(part) : part);
  if (prerelease.some((part) => part === void 0))
    return void 0;
  const build = (m[5] ?? "").split(".").filter((part) => part.length > 0);
  return {
    major,
    minor,
    patch,
    prerelease,
    build
  };
}
function comparePrerelease(a, b) {
  const ap = a.prerelease;
  const bp = b.prerelease;
  if (ap.length === 0 && bp.length === 0)
    return 0;
  if (ap.length === 0)
    return 1;
  if (bp.length === 0)
    return -1;
  const length = Math.min(ap.length, bp.length);
  for (let i = 0; i < length; i += 1) {
    const x = ap[i];
    const y = bp[i];
    if (x === y)
      continue;
    if (typeof x === "number" && typeof y === "number")
      return x < y ? -1 : 1;
    if (typeof x === "number")
      return -1;
    if (typeof y === "number")
      return 1;
    return x < y ? -1 : 1;
  }
  return ap.length === bp.length ? 0 : ap.length < bp.length ? -1 : 1;
}
function compareSemver(a, b) {
  if (a.major !== b.major)
    return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor)
    return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch)
    return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a, b);
}
function formatSemver(version) {
  const prerelease = version.prerelease.length === 0 ? "" : `-${version.prerelease.map(String).join(".")}`;
  const build = version.build.length === 0 ? "" : `+${version.build.join(".")}`;
  return `${version.major}.${version.minor}.${version.patch}${prerelease}${build}`;
}
function canonicalComparatorConjunction(comparators) {
  const unique = /* @__PURE__ */ new Map();
  for (const comparator of comparators) {
    const rendered = `${comparator.op}${formatSemver(comparator.version)}`;
    unique.set(rendered, comparator);
  }
  const operatorOrder = {
    ">": 0,
    ">=": 1,
    "=": 2,
    "<=": 3,
    "<": 4
  };
  return [...unique.entries()].sort(([, a], [, b]) => {
    const byVersion = compareSemver(a.version, b.version);
    return byVersion === 0 ? operatorOrder[a.op] - operatorOrder[b.op] : byVersion;
  }).map(([rendered]) => rendered).join(" ");
}
function caretUpperBound(v) {
  if (v.major > 0) {
    return Number.isSafeInteger(v.major + 1) ? { major: v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] } : void 0;
  }
  if (v.minor > 0) {
    return Number.isSafeInteger(v.minor + 1) ? { major: 0, minor: v.minor + 1, patch: 0, prerelease: [], build: [] } : void 0;
  }
  return Number.isSafeInteger(v.patch + 1) ? { major: 0, minor: 0, patch: v.patch + 1, prerelease: [], build: [] } : void 0;
}
function parsePartial(value2) {
  const m = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|\*))?(?:\.(0|[1-9]\d*|x|\*))?$/.exec(value2);
  if (!m)
    return void 0;
  const major = parseSafeInteger(m[1] ?? "");
  if (major === void 0)
    return void 0;
  const minorRaw = m[2];
  const patchRaw = m[3];
  const wild = (s) => s === "x" || s === "*";
  if (minorRaw === void 0 || wild(minorRaw)) {
    if (wild(minorRaw) && patchRaw !== void 0)
      return void 0;
    return { v: { major, minor: 0, patch: 0, prerelease: [], build: [] }, precision: 1 };
  }
  if (patchRaw === void 0 || wild(patchRaw)) {
    const minor2 = parseSafeInteger(minorRaw);
    if (minor2 === void 0)
      return void 0;
    return {
      v: { major, minor: minor2, patch: 0, prerelease: [], build: [] },
      precision: 2
    };
  }
  const minor = parseSafeInteger(minorRaw);
  const patch = parseSafeInteger(patchRaw);
  if (minor === void 0 || patch === void 0)
    return void 0;
  return {
    v: { major, minor, patch, prerelease: [], build: [] },
    precision: 3
  };
}
function parseSingle(token) {
  const opMatch = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(token);
  if (!opMatch)
    return void 0;
  const op = opMatch[1];
  const rest = (opMatch[2] ?? "").trim();
  const hasWildcard = /(?:^|\.)(?:x|\*)(?:\.|$)/.test(rest);
  if (op === "^") {
    if (hasWildcard)
      return void 0;
    const partial2 = parsePartial(rest);
    if (!partial2 || partial2.precision === 1)
      return void 0;
    const upper = caretUpperBound(partial2.v);
    if (upper === void 0)
      return void 0;
    return [
      { op: ">=", version: partial2.v },
      { op: "<", version: upper }
    ];
  }
  const partial = parsePartial(rest);
  if (!partial)
    return void 0;
  if (hasWildcard && op !== void 0)
    return void 0;
  if (op === void 0 || op === "=") {
    if (!hasWildcard && partial.precision !== 3)
      return void 0;
    if (partial.precision === 3)
      return [{ op: "=", version: partial.v }];
    const next = partial.precision === 1 ? partial.v.major + 1 : partial.v.minor + 1;
    if (!Number.isSafeInteger(next))
      return void 0;
    const upper = partial.precision === 1 ? { major: partial.v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] } : {
      major: partial.v.major,
      minor: partial.v.minor + 1,
      patch: 0,
      prerelease: [],
      build: []
    };
    return [
      { op: ">=", version: partial.v },
      { op: "<", version: upper }
    ];
  }
  return [{ op, version: partial.v }];
}
function parseVersionRange(raw) {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "x") {
    return { raw, normalized: "*", comparators: [[]] };
  }
  const tokens = trimmed.split(/\s+/);
  const comparators = [];
  for (const token of tokens) {
    const parsed = parseSingle(token);
    if (!parsed)
      return void 0;
    comparators.push(...parsed);
  }
  return {
    raw,
    normalized: canonicalComparatorConjunction(comparators),
    comparators: [comparators]
  };
}
function versionRangeTargetsMajor(range, major) {
  if (!Number.isSafeInteger(major) || major < 0)
    return false;
  const start = { major, minor: 0, patch: 0, prerelease: [], build: [] };
  return range.comparators.every((conjunction) => {
    if (conjunction.length === 0)
      return true;
    const exact = conjunction.find((comparator) => comparator.op === "=");
    if (exact !== void 0) {
      return exact.version.major === major && conjunction.every((comparator) => matches(exact.version, comparator));
    }
    const nextMajor = major + 1;
    if (!Number.isSafeInteger(nextMajor))
      return false;
    const end = { major: nextMajor, minor: 0, patch: 0, prerelease: [], build: [] };
    const crossesUpperBoundary = conjunction.some((comparator) => {
      if (comparator.op !== "<" && comparator.op !== "<=")
        return false;
      const boundary = compareSemver(comparator.version, end);
      return boundary > 0 || boundary === 0 && comparator.op === "<=";
    });
    if (crossesUpperBoundary)
      return false;
    const lowers = [
      { op: ">=", version: start },
      ...conjunction.filter((comparator) => comparator.op === ">" || comparator.op === ">=")
    ];
    const uppers = [
      { op: "<", version: end },
      ...conjunction.filter((comparator) => comparator.op === "<" || comparator.op === "<=")
    ];
    const lower = lowers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version);
      if (comparison > 0 || comparison === 0 && candidate.op === ">")
        return candidate;
      return best;
    });
    const upper = uppers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version);
      if (comparison < 0 || comparison === 0 && candidate.op === "<")
        return candidate;
      return best;
    });
    const lowerInside = compareSemver(lower.version, start) >= 0;
    const upperVsEnd = compareSemver(upper.version, end);
    const upperInside = upperVsEnd < 0 || upperVsEnd === 0 && upper.op === "<";
    const boundsOrder = compareSemver(lower.version, upper.version);
    const nonEmpty = boundsOrder < 0 || boundsOrder === 0 && lower.op === ">=" && upper.op === "<=";
    return lowerInside && upperInside && nonEmpty;
  });
}
function matches(version, comparator) {
  const cmp = compareSemver(version, comparator.version);
  switch (comparator.op) {
    case "=":
      return cmp === 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
  }
}

// packages/core/dist/errors.js
var ModkitError = class extends Error {
  code;
  context;
  retryability;
  constructor(options) {
    super(options.message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "ModkitError";
    if (!isQualifiedId(options.code)) {
      throw new TypeError(`ModkitError code must be a qualified id, got \xAB${options.code}\xBB`);
    }
    this.code = options.code;
    if (options.context !== void 0)
      this.context = options.context;
    this.retryability = options.retryability ?? "never";
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryability: this.retryability,
      ...this.context === void 0 ? {} : { context: this.context }
    };
  }
};
function isModkitError(value2) {
  return value2 instanceof ModkitError;
}

// packages/core/dist/diagnostics.js
function diagnostic(severity, code, message, path, data2, range) {
  return {
    code: errorCode(code),
    severity,
    message,
    ...path === void 0 ? {} : { path },
    ...range === void 0 ? {} : { range },
    ...data2 === void 0 ? {} : { data: data2 }
  };
}

// packages/core/dist/immutability.js
function deepFreeze(value2) {
  const seen = /* @__PURE__ */ new WeakSet();
  const visit = (candidate) => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate))
      return;
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      visit(candidate[key]);
    }
    Object.freeze(candidate);
  };
  visit(value2);
  return value2;
}

// packages/core/dist/source-span.js
var UINT64_MAX_DECIMAL = "18446744073709551615";
function fixedWidthDecimalAtMost(maximum) {
  const alternatives = [maximum];
  for (let index = 1; index < maximum.length; index += 1) {
    const maximumDigit = Number(maximum[index]);
    if (maximumDigit === 0)
      continue;
    const prefix = maximum.slice(0, index);
    const lowerDigit = maximumDigit === 1 ? "0" : `[0-${maximumDigit - 1}]`;
    const remaining = maximum.length - index - 1;
    const suffix = remaining === 0 ? "" : `[0-9]{${remaining}}`;
    alternatives.push(`${prefix}${lowerDigit}${suffix}`);
  }
  return `(?:${alternatives.join("|")})`;
}
var UINT64_DECIMAL_PATTERN = `^(?:0|[1-9][0-9]{0,18}|${fixedWidthDecimalAtMost(UINT64_MAX_DECIMAL)})$`;
var byteCoordinateProperties = {
  byteOffset: { type: "string", pattern: UINT64_DECIMAL_PATTERN },
  byteLength: { type: "string", pattern: UINT64_DECIMAL_PATTERN }
};
var textCoordinateProperties = {
  utf16Offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  utf16Length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  line: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  column: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
};
var sourceSpanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/source-span.v1.schema.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["byteOffset", "byteLength"],
      properties: byteCoordinateProperties
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["utf16Offset", "utf16Length", "line", "column"],
      properties: textCoordinateProperties
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["byteOffset", "byteLength", "utf16Offset", "utf16Length", "line", "column"],
      properties: {
        ...byteCoordinateProperties,
        ...textCoordinateProperties
      }
    }
  ]
};
deepFreeze(sourceSpanSchema);
var uint64DecimalPattern = new RegExp(UINT64_DECIMAL_PATTERN);

// packages/core/dist/ordering.js
var encoder = new TextEncoder();

// packages/core/dist/cancellation.js
var CANCELLED_CODE = "x3.core/operation-cancelled";
var OperationCancelledError = class extends ModkitError {
  constructor(reason) {
    super({
      code: CANCELLED_CODE,
      message: "operation cancelled",
      retryability: "safe",
      ...reason === void 0 ? {} : { cause: reason }
    });
    this.name = "OperationCancelledError";
  }
};

// packages/host/dist/execution/protocol.js
var CAPABILITY_RPC_DOMAIN = "x3.host/rpc";
var CAPABILITY_RPC_VERSION = 1;
var HANDLE_MARKER = "@x3.handle";
var HANDLE_ID = /^[hw](?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u;
var SUBSCRIPTION_ID = /^[hw]s(?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u;
var METHOD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/u;
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var FRAME_TYPES = [
  "load",
  "ready",
  "call",
  "return",
  "throw",
  "cancel",
  "next",
  "done",
  "subscribe",
  "event",
  "unsubscribe",
  "progress",
  "release",
  "terminate"
];
var HANDLE_KINDS = ["lease", "iterator", "events"];
function isHandleId(value2) {
  return HANDLE_ID.test(value2);
}
function isSubscriptionId(value2) {
  return SUBSCRIPTION_ID.test(value2);
}
function isMethodName(value2) {
  return METHOD_NAME.test(value2);
}
var WIRE_TYPED_ARRAYS = Object.freeze({
  bytes: Uint8Array,
  i8: Int8Array,
  u8c: Uint8ClampedArray,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  i64: BigInt64Array,
  u64: BigUint64Array
});
function wireTypedArrayCode(view) {
  for (const [code, constructor] of Object.entries(WIRE_TYPED_ARRAYS)) {
    if (view.constructor === constructor)
      return code;
  }
  return void 0;
}
var MAX_OPTIONAL_METHODS = 64;
function handleRef(id, kind, contract, data2, has) {
  return Object.freeze({
    [HANDLE_MARKER]: Object.freeze({
      id,
      kind,
      ...contract === void 0 ? {} : { contract: contract.contract, major: contract.major },
      ...data2 === void 0 ? {} : { data: data2 },
      ...has === void 0 ? {} : { has: Object.freeze([...has]) }
    })
  });
}
function isPresentList(value2) {
  return Array.isArray(value2) && value2.length <= MAX_OPTIONAL_METHODS && value2.every((item) => typeof item === "string" && isMethodName(item)) && new Set(value2).size === value2.length;
}
function isHandleRef(value2) {
  if (!isPlainObject(value2))
    return false;
  const keys = Object.keys(value2);
  if (keys.length !== 1 || keys[0] !== HANDLE_MARKER)
    return false;
  const inner = value2[HANDLE_MARKER];
  if (!isPlainObject(inner))
    return false;
  const record = inner;
  const innerKeys = Object.keys(inner).filter((key) => key !== "data" && key !== "has").sort();
  const base = ["id", "kind"];
  const withContract = ["contract", "id", "kind", "major"];
  const shape = innerKeys.join(",") === base.join(",") || innerKeys.join(",") === withContract.join(",");
  if (!shape)
    return false;
  if (record["data"] !== void 0 && !isPlainObject(record["data"]))
    return false;
  if (record["has"] !== void 0 && !isPresentList(record["has"]))
    return false;
  if (typeof record["id"] !== "string" || !isHandleId(record["id"]))
    return false;
  if (typeof record["kind"] !== "string" || !HANDLE_KINDS.includes(record["kind"]))
    return false;
  if (innerKeys.length === 4) {
    if (typeof record["contract"] !== "string" || !isQualifiedId(record["contract"]))
      return false;
    if (!Number.isSafeInteger(record["major"]) || record["major"] < 0)
      return false;
  }
  return true;
}
function isPlainObject(value2) {
  if (typeof value2 !== "object" || value2 === null || Array.isArray(value2))
    return false;
  const proto = Object.getPrototypeOf(value2);
  return proto === Object.prototype || proto === null;
}
var DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 2e5,
  maxStringLength: 4 * 1024 * 1024,
  maxArrayLength: 1e5,
  maxObjectKeys: 1e4,
  maxTransferBytes: 64 * 1024 * 1024,
  maxArgs: 16,
  maxPendingCalls: 256,
  maxHandles: 4096,
  maxIterators: 256,
  maxSubscriptions: 64,
  maxQueuedEvents: 1024,
  defaultCallDeadlineMs: 3e4,
  iteratorBatchItems: 1
});
function protocolLimits(overrides = {}) {
  const merged = { ...DEFAULT_PROTOCOL_LIMITS, ...overrides };
  for (const [key, value2] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value2) || value2 < 0) {
      throw new ModkitError({
        code: "x3.host/rpc-invalid-limits",
        message: `protocol limit ${key} must be a non-negative safe integer`,
        context: { key }
      });
    }
  }
  if (merged.iteratorBatchItems < 1 || merged.iteratorBatchItems > merged.maxArrayLength) {
    throw new ModkitError({
      code: "x3.host/rpc-invalid-limits",
      message: "protocol limit iteratorBatchItems must be between 1 and maxArrayLength",
      context: { key: "iteratorBatchItems" }
    });
  }
  return Object.freeze(merged);
}
function violation(code, message, path) {
  return {
    ok: false,
    violation: Object.freeze({ code, message, ...path === void 0 ? {} : { path } })
  };
}
function protocolViolationError(item) {
  return new ModkitError({
    code: "x3.host/rpc-protocol-violation",
    message: `capability-rpc protocol violation: ${item.message}`,
    context: {
      violation: item.code,
      ...item.path === void 0 ? {} : { path: [...item.path] }
    }
  });
}
var SHARED = typeof SharedArrayBuffer === "function" ? SharedArrayBuffer : void 0;
function validateInner(value2, limits, measure, depth, path, handles) {
  measure.nodes += 1;
  if (measure.nodes > limits.maxNodes) {
    return { code: "nodes-exceeded", message: `value has more than ${limits.maxNodes} nodes` };
  }
  if (depth > limits.maxDepth) {
    return { code: "depth-exceeded", message: `value nests deeper than ${limits.maxDepth}`, path };
  }
  switch (typeof value2) {
    case "boolean":
    case "bigint":
      return void 0;
    case "undefined":
      return depth === 0 ? { code: "bad-value", message: "undefined is not a wire value", path } : void 0;
    case "number":
      return Number.isFinite(value2) ? void 0 : { code: "bad-value", message: "non-finite number", path };
    case "string":
      return value2.length <= limits.maxStringLength ? void 0 : { code: "string-too-long", message: `string longer than ${limits.maxStringLength}`, path };
    case "object":
      break;
    default:
      return { code: "bad-value", message: `${typeof value2} is not a wire value`, path };
  }
  if (value2 === null)
    return void 0;
  if (ArrayBuffer.isView(value2) && !(value2 instanceof DataView)) {
    const kind = value2.constructor.name;
    if (wireTypedArrayCode(value2) === void 0) {
      return { code: "bad-value", message: `${kind} is not a wire value`, path };
    }
    if (SHARED !== void 0 && value2.buffer instanceof SHARED) {
      return {
        code: "shared-buffer",
        message: "SharedArrayBuffer-backed bytes are not transferable",
        path
      };
    }
    if (value2.buffer.detached === true) {
      return {
        code: "bad-value",
        message: `a ${kind} over a detached buffer cannot cross (it was transferred already)`,
        path
      };
    }
    if (value2.byteOffset !== 0 || value2.byteLength !== value2.buffer.byteLength) {
      return {
        code: "partial-typed-array",
        message: `a ${kind} must own its whole buffer (slice() before sending)`,
        path
      };
    }
    measure.bytes += value2.byteLength;
    if (measure.bytes > limits.maxTransferBytes) {
      return {
        code: "transfer-too-large",
        message: `frame carries more than ${limits.maxTransferBytes} bytes`,
        path
      };
    }
    measure.buffers.push(value2.buffer);
    return void 0;
  }
  if (value2 instanceof DataView || value2 instanceof ArrayBuffer) {
    return {
      code: "bad-value",
      message: "binary payloads must be a typed array that names its element type",
      path
    };
  }
  if (Array.isArray(value2)) {
    if (value2.length > limits.maxArrayLength) {
      return { code: "array-too-long", message: `array longer than ${limits.maxArrayLength}`, path };
    }
    for (let index = 0; index < value2.length; index += 1) {
      const found = validateInner(value2[index], limits, measure, depth + 1, [...path, index], handles);
      if (found !== void 0)
        return found;
    }
    return void 0;
  }
  if (!isPlainObject(value2)) {
    return { code: "bad-value", message: "only plain data objects may cross the boundary", path };
  }
  if (Object.hasOwn(value2, HANDLE_MARKER)) {
    if (handles === "forbid") {
      return {
        code: "handle-not-allowed",
        message: "a handle ref is not allowed at this position",
        path
      };
    }
    if (!isHandleRef(value2))
      return { code: "bad-handle", message: "malformed handle ref", path };
    const data2 = value2[HANDLE_MARKER].data;
    return data2 === void 0 ? void 0 : validateInner(data2, limits, measure, depth + 1, [...path, HANDLE_MARKER, "data"], "forbid");
  }
  const keys = Object.keys(value2);
  if (keys.length > limits.maxObjectKeys) {
    return {
      code: "too-many-keys",
      message: `object has more than ${limits.maxObjectKeys} keys`,
      path
    };
  }
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { code: "forbidden-key", message: `key \xAB${key}\xBB is forbidden`, path: [...path, key] };
    }
    if (key.length > limits.maxStringLength) {
      return { code: "string-too-long", message: "object key too long", path: [...path, key] };
    }
    const found = validateInner(value2[key], limits, measure, depth + 1, [...path, key], handles);
    if (found !== void 0)
      return found;
  }
  return void 0;
}
function validateWireValue(value2, limits, handles = "forbid", path = []) {
  const measure = { nodes: 0, bytes: 0, buffers: [] };
  if (handles === "top" && isHandleRef(value2)) {
    const data2 = value2[HANDLE_MARKER].data;
    const found2 = data2 === void 0 ? void 0 : validateInner(data2, limits, measure, 1, [...path, HANDLE_MARKER, "data"], "forbid");
    if (found2 !== void 0)
      return { ok: false, violation: Object.freeze(found2) };
    return {
      ok: true,
      value: Object.freeze({
        nodes: measure.nodes + 1,
        transferBytes: measure.bytes,
        transferables: Object.freeze(measure.buffers)
      })
    };
  }
  const found = validateInner(value2, limits, measure, 0, [...path], handles === "nested" ? "allow" : "forbid");
  if (found !== void 0)
    return { ok: false, violation: Object.freeze(found) };
  return {
    ok: true,
    value: Object.freeze({
      nodes: measure.nodes,
      transferBytes: measure.bytes,
      transferables: Object.freeze(measure.buffers)
    })
  };
}
var RETRYABILITIES = ["never", "safe", "conditional"];
var MAX_ERROR_MESSAGE = 8 * 1024;
function toErrorDto(error, limits) {
  const clip = (text) => text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE)}\u2026` : text;
  if (error instanceof OperationCancelledError) {
    return Object.freeze({
      code: error.code,
      message: clip(error.message),
      retryability: error.retryability,
      cancelled: true
    });
  }
  if (isModkitError(error)) {
    let context;
    let dropped = false;
    if (error.context !== void 0) {
      const checked = validateWireValue(error.context, limits, "forbid");
      if (checked.ok && isPlainObject(error.context)) {
        context = error.context;
      } else {
        dropped = true;
      }
    }
    return Object.freeze({
      code: error.code,
      message: clip(error.message),
      retryability: error.retryability,
      ...context === void 0 ? {} : { context },
      ...dropped ? { contextDropped: true } : {}
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    code: "x3.host/rpc-foreign-error",
    message: clip(message.length === 0 ? "unknown error" : message),
    retryability: "never"
  });
}
function fromErrorDto(dto) {
  if (dto.cancelled === true)
    return new OperationCancelledError(dto.message);
  return new ModkitError({
    code: dto.code,
    message: dto.message,
    retryability: dto.retryability,
    ...dto.context === void 0 ? {} : { context: dto.context }
  });
}
function validateErrorDto(value2, limits, path = []) {
  if (!isPlainObject(value2))
    return violation("bad-error", "error must be an object", path);
  const record = value2;
  const keys = Object.keys(record);
  const allowed = /* @__PURE__ */ new Set([
    "code",
    "message",
    "retryability",
    "context",
    "cancelled",
    "contextDropped"
  ]);
  for (const key of keys) {
    if (!allowed.has(key))
      return violation("bad-error", `unknown error key \xAB${key}\xBB`, [...path, key]);
  }
  const code = record["code"];
  if (typeof code !== "string" || !isQualifiedId(code)) {
    return violation("bad-error", "error code must be a qualified id", [...path, "code"]);
  }
  const message = record["message"];
  if (typeof message !== "string" || message.length > MAX_ERROR_MESSAGE + 1) {
    return violation("bad-error", "error message must be a bounded string", [...path, "message"]);
  }
  const retryability = record["retryability"];
  if (typeof retryability !== "string" || !RETRYABILITIES.includes(retryability)) {
    return violation("bad-error", "error retryability is invalid", [...path, "retryability"]);
  }
  for (const flag of ["cancelled", "contextDropped"]) {
    if (record[flag] !== void 0 && record[flag] !== true) {
      return violation("bad-error", `error ${flag} must be true or absent`, [...path, flag]);
    }
  }
  if (record["context"] !== void 0) {
    if (!isPlainObject(record["context"])) {
      return violation("bad-error", "error context must be an object", [...path, "context"]);
    }
    const checked = validateWireValue(record["context"], limits, "forbid", [...path, "context"]);
    if (!checked.ok)
      return checked;
  }
  return { ok: true, value: Object.freeze({ ...record }) };
}
var ENVELOPE_KEYS = ["domain", "version", "session", "generation", "id", "t"];
var FRAME_KEYS = {
  load: {
    required: ["moduleUrl", "contributionId", "variantId", "artifactDigest"],
    optional: ["entrypointDigest"]
  },
  ready: { required: ["inReplyTo", "abiVersion", "exports", "root"], optional: [] },
  call: { required: ["handle", "method", "args"], optional: ["deadlineMs"] },
  return: { required: ["inReplyTo"], optional: ["value", "lease"] },
  throw: { required: ["inReplyTo", "error"], optional: [] },
  cancel: { required: ["target"], optional: [] },
  next: { required: ["handle"], optional: ["max"] },
  done: { required: ["handle"], optional: ["inReplyTo", "error"] },
  subscribe: { required: ["handle"], optional: [] },
  event: { required: ["subscription", "value"], optional: [] },
  unsubscribe: { required: ["subscription"], optional: [] },
  progress: { required: ["inReplyTo", "progress"], optional: [] },
  release: { required: ["handle"], optional: [] },
  terminate: { required: ["reason"], optional: [] }
};
function isMessageId(value2) {
  return Number.isSafeInteger(value2) && value2 >= 1;
}
function checkExactKeys(record, required, optional) {
  for (const key of required) {
    if (!Object.hasOwn(record, key))
      return { code: "missing-key", message: `missing key \xAB${key}\xBB`, path: [key] };
  }
  const allowed = /* @__PURE__ */ new Set([...ENVELOPE_KEYS, ...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key))
      return { code: "forbidden-key", message: `key \xAB${key}\xBB is forbidden`, path: [key] };
    if (!allowed.has(key))
      return { code: "unknown-key", message: `unknown key \xAB${key}\xBB`, path: [key] };
  }
  return void 0;
}
function validateFrame(input, limits, expect) {
  if (!isPlainObject(input))
    return violation("not-an-object", "frame must be a plain object");
  const record = input;
  if (record["domain"] !== CAPABILITY_RPC_DOMAIN || record["version"] !== CAPABILITY_RPC_VERSION) {
    return violation("bad-envelope", "frame domain/version mismatch");
  }
  if (record["session"] !== expect.session)
    return violation("bad-envelope", "frame session mismatch", ["session"]);
  if (record["generation"] !== expect.generation) {
    return violation("stale-generation", "frame generation does not match the live generation", [
      "generation"
    ]);
  }
  if (!isMessageId(record["id"]))
    return violation("bad-id", "frame id must be a positive safe integer", ["id"]);
  const type = record["t"];
  if (typeof type !== "string" || !FRAME_TYPES.includes(type)) {
    return violation("bad-type", "unknown frame type", ["t"]);
  }
  const t = type;
  const keys = FRAME_KEYS[t];
  const keyViolation = checkExactKeys(record, keys.required, keys.optional);
  if (keyViolation !== void 0)
    return { ok: false, violation: keyViolation };
  const str = (key, test, code = "bad-value") => typeof record[key] === "string" && record[key].length > 0 && (test?.(record[key]) ?? true) ? void 0 : violation(code, `\xAB${key}\xBB is malformed`, [key]);
  const replyId = (key) => isMessageId(record[key]) ? void 0 : violation("bad-id", `\xAB${key}\xBB must be a positive safe integer`, [key]);
  switch (t) {
    case "load": {
      for (const key of ["moduleUrl", "artifactDigest"]) {
        const bad2 = str(key, (value2) => value2.length <= limits.maxStringLength);
        if (bad2)
          return bad2;
      }
      if (record["entrypointDigest"] !== void 0) {
        const bad2 = str("entrypointDigest", (value2) => value2.length <= 256);
        if (bad2)
          return bad2;
      }
      const bad = str("contributionId", isQualifiedId) ?? str("variantId", isSegment);
      if (bad)
        return bad;
      break;
    }
    case "ready": {
      const bad = replyId("inReplyTo");
      if (bad)
        return bad;
      if (record["abiVersion"] !== 1)
        return violation("bad-value", "abiVersion must be 1", ["abiVersion"]);
      const exports = record["exports"];
      if (!Array.isArray(exports) || exports.length > limits.maxArrayLength || !exports.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256)) {
        return violation("bad-value", "exports must be an array of short strings", ["exports"]);
      }
      if (!isHandleRef(record["root"]))
        return violation("bad-handle", "root must be a handle ref", ["root"]);
      {
        const checked = validateWireValue(record["root"], limits, "top", ["root"]);
        if (!checked.ok)
          return checked;
      }
      break;
    }
    case "call": {
      const bad = str("handle", isHandleId, "bad-handle") ?? str("method", isMethodName, "bad-method");
      if (bad)
        return bad;
      const args = record["args"];
      if (!Array.isArray(args))
        return violation("bad-value", "args must be an array", ["args"]);
      if (args.length > limits.maxArgs)
        return violation("too-many-args", `more than ${limits.maxArgs} args`, ["args"]);
      const checked = validateWireValue(args, limits, "nested", ["args"]);
      if (!checked.ok)
        return checked;
      if (record["deadlineMs"] !== void 0 && (!Number.isSafeInteger(record["deadlineMs"]) || record["deadlineMs"] < 0)) {
        return violation("bad-value", "deadlineMs must be a non-negative safe integer", [
          "deadlineMs"
        ]);
      }
      break;
    }
    case "return": {
      const bad = replyId("inReplyTo");
      if (bad)
        return bad;
      if (record["value"] !== void 0) {
        const checked = validateWireValue(record["value"], limits, "top", ["value"]);
        if (!checked.ok)
          return checked;
      }
      if (record["lease"] !== void 0) {
        const lease = record["lease"];
        if (!isHandleRef(lease) || lease[HANDLE_MARKER].kind !== "lease") {
          return violation("bad-handle", "lease must be a lease handle ref", ["lease"]);
        }
        if (record["value"] !== void 0 && isHandleRef(record["value"])) {
          return violation("bad-value", "a leased value cannot itself be a handle", ["value"]);
        }
        const checked = validateWireValue(lease, limits, "top", ["lease"]);
        if (!checked.ok)
          return checked;
      }
      break;
    }
    case "throw": {
      const bad = replyId("inReplyTo");
      if (bad)
        return bad;
      const checked = validateErrorDto(record["error"], limits, ["error"]);
      if (!checked.ok)
        return checked;
      break;
    }
    case "cancel":
      {
        const bad = replyId("target");
        if (bad)
          return bad;
      }
      break;
    case "next": {
      const bad = str("handle", isHandleId, "bad-handle");
      if (bad)
        return bad;
      const max = record["max"];
      if (max !== void 0 && (!Number.isSafeInteger(max) || max < 1 || max > limits.maxArrayLength)) {
        return violation("bad-value", `next.max must be an integer in 1..${limits.maxArrayLength}`, ["max"]);
      }
      break;
    }
    case "subscribe":
    case "release": {
      const bad = str("handle", isHandleId, "bad-handle");
      if (bad)
        return bad;
      break;
    }
    case "done": {
      const bad = str("handle", isHandleId, "bad-handle");
      if (bad)
        return bad;
      if (record["inReplyTo"] !== void 0) {
        const badReply = replyId("inReplyTo");
        if (badReply)
          return badReply;
      }
      if (record["error"] !== void 0) {
        const checked = validateErrorDto(record["error"], limits, ["error"]);
        if (!checked.ok)
          return checked;
      }
      break;
    }
    case "event": {
      const bad = str("subscription", isSubscriptionId, "bad-subscription");
      if (bad)
        return bad;
      const checked = validateWireValue(record["value"], limits, "forbid", ["value"]);
      if (!checked.ok)
        return checked;
      break;
    }
    case "unsubscribe": {
      const bad = str("subscription", isSubscriptionId, "bad-subscription");
      if (bad)
        return bad;
      break;
    }
    case "progress": {
      const bad = replyId("inReplyTo");
      if (bad)
        return bad;
      const progress = record["progress"];
      if (!isPlainObject(progress))
        return violation("bad-progress", "progress must be an object", ["progress"]);
      const progressKeys = Object.keys(progress);
      if (progressKeys.some((key) => !["completed", "total", "message"].includes(key))) {
        return violation("bad-progress", "progress has unknown keys", ["progress"]);
      }
      if (typeof progress["completed"] !== "number" || !Number.isFinite(progress["completed"]) || progress["completed"] < 0) {
        return violation("bad-progress", "progress.completed must be a non-negative number", [
          "progress",
          "completed"
        ]);
      }
      if (progress["total"] !== void 0 && (typeof progress["total"] !== "number" || !Number.isFinite(progress["total"]) || progress["total"] < 0)) {
        return violation("bad-progress", "progress.total must be a non-negative number", [
          "progress",
          "total"
        ]);
      }
      if (progress["message"] !== void 0 && (typeof progress["message"] !== "string" || progress["message"].length > 1024)) {
        return violation("bad-progress", "progress.message must be a short string", [
          "progress",
          "message"
        ]);
      }
      break;
    }
    case "terminate": {
      const bad = str("reason", (value2) => value2.length <= 1024);
      if (bad)
        return bad;
      break;
    }
  }
  return { ok: true, value: record };
}

// packages/host/dist/execution/surface.js
function surfaceKey(contract, major) {
  return `${contract}@${major}`;
}
function isKeyRef(value2) {
  return typeof value2 === "object" && value2 !== null && Number.isSafeInteger(value2.arg) && value2.arg >= 0 && typeof value2.key === "string" && isMethodName(value2.key);
}
function isArgRef(value2) {
  return typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= 0 || isKeyRef(value2);
}
var argRefKey = (ref) => typeof ref === "number" ? `${ref}` : `${ref.arg}.${ref.key}`;
var freezeArgRef = (ref) => typeof ref === "number" ? ref : Object.freeze({ ...ref });
function readArgRef(args, ref) {
  if (typeof ref === "number")
    return args[ref];
  const holder = args[ref.arg];
  return typeof holder === "object" && holder !== null ? holder[ref.key] : void 0;
}
function invalidSurface(message, context) {
  throw new ModkitError({
    code: "x3.host/rpc-invalid-surface",
    message,
    ...context === void 0 ? {} : { context }
  });
}
function snapshotMethod(name, raw, surface) {
  if (raw === void 0 || typeof raw !== "object") {
    return invalidSurface(`method \xAB${name}\xBB has no declaration`, { surface });
  }
  const kind = raw.kind;
  const result = raw.result;
  const resultFromArgs = raw.resultFromArgs;
  const wrapper = raw.wrapper;
  const signal = raw.signal;
  const progress = raw.progress;
  const arity = raw.arity;
  const optional = raw.optional;
  const validateArgs = raw.validateArgs;
  const validateReturn = raw.validateReturn;
  if (kind !== "value" && kind !== "lease" && kind !== "leased-value" && kind !== "iterable" && kind !== "events") {
    return invalidSurface(`method \xAB${name}\xBB has an invalid kind`, { surface });
  }
  if (arity !== void 0 && (!Number.isSafeInteger(arity) || arity < 0 || arity > 16)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid arity`, { surface });
  }
  if (optional !== void 0 && typeof optional !== "boolean") {
    return invalidSurface(`method \xAB${name}\xBB has a non-boolean optional flag`, { surface });
  }
  if (resultFromArgs !== void 0 && (typeof resultFromArgs !== "object" || resultFromArgs === null || !isArgRef(resultFromArgs.contract) || !isArgRef(resultFromArgs.major) || argRefKey(resultFromArgs.contract) === argRefKey(resultFromArgs.major))) {
    return invalidSurface(`method \xAB${name}\xBB has invalid resultFromArgs positions`, { surface });
  }
  if (wrapper !== void 0 && wrapper !== "lease" && wrapper !== "bare") {
    return invalidSurface(`method \xAB${name}\xBB has an invalid wrapper`, { surface });
  }
  if (wrapper !== void 0 && kind !== "lease") {
    return invalidSurface(`only lease method \xAB${name}\xBB may declare a wrapper`, { surface });
  }
  if (signal !== void 0 && signal !== "last" && signal !== "none" && !isKeyRef(signal)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid signal placement`, { surface });
  }
  if (progress !== void 0 && !isKeyRef(progress)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid progress placement`, { surface });
  }
  if (isKeyRef(signal) && progress !== void 0 && signal.arg === progress.arg && signal.key === progress.key) {
    return invalidSurface(`method \xAB${name}\xBB places signal and progress on the same key`, {
      surface
    });
  }
  if (validateArgs !== void 0 && typeof validateArgs !== "function") {
    return invalidSurface(`method \xAB${name}\xBB has a non-function argument validator`, { surface });
  }
  if (validateReturn !== void 0 && typeof validateReturn !== "function") {
    return invalidSurface(`method \xAB${name}\xBB has a non-function return validator`, { surface });
  }
  if (kind === "lease") {
    if (result === void 0 === (resultFromArgs === void 0)) {
      return invalidSurface(`lease method \xAB${name}\xBB must name the surface of its result (result or resultFromArgs)`, { surface });
    }
    if (result !== void 0 && (!isQualifiedId(result.contract) || !Number.isSafeInteger(result.major) || result.major < 0)) {
      return invalidSurface(`lease method \xAB${name}\xBB must name the surface of its result`, {
        surface
      });
    }
  } else if (result !== void 0 || resultFromArgs !== void 0) {
    return invalidSurface(`${kind} method \xAB${name}\xBB must not declare a result surface`, {
      surface
    });
  }
  return Object.freeze({
    kind,
    ...result === void 0 ? {} : { result: Object.freeze({ contract: result.contract, major: result.major }) },
    ...resultFromArgs === void 0 ? {} : {
      resultFromArgs: Object.freeze({
        contract: freezeArgRef(resultFromArgs.contract),
        major: freezeArgRef(resultFromArgs.major)
      })
    },
    ...wrapper === void 0 ? {} : { wrapper },
    ...signal === void 0 ? {} : { signal: typeof signal === "string" ? signal : Object.freeze({ ...signal }) },
    ...progress === void 0 ? {} : { progress: Object.freeze({ ...progress }) },
    ...arity === void 0 ? {} : { arity },
    ...optional === void 0 ? {} : { optional },
    ...validateArgs === void 0 ? {} : { validateArgs },
    ...validateReturn === void 0 ? {} : { validateReturn }
  });
}
function assertSurface(surface) {
  if (!isQualifiedId(surface.contract) || !Number.isSafeInteger(surface.major) || surface.major < 0) {
    return invalidSurface(`surface contract must be a qualified id with a non-negative major: ${surface.contract}@${String(surface.major)}`);
  }
  const names = Object.keys(surface.methods);
  if (surface.releaseVia !== void 0 && surface.methods[surface.releaseVia]?.kind !== "value") {
    return invalidSurface(`releaseVia \xAB${surface.releaseVia}\xBB must name a declared value method`, {
      surface: surfaceKey(surface.contract, surface.major)
    });
  }
  if (names.length === 0) {
    return invalidSurface(`surface ${surfaceKey(surface.contract, surface.major)} declares no methods`);
  }
  for (const name of names) {
    const method = surface.methods[name];
    if (!isMethodName(name) || method === void 0) {
      return invalidSurface(`method name \xAB${name}\xBB is not lowerCamel or has no declaration`, {
        surface: surfaceKey(surface.contract, surface.major)
      });
    }
  }
  if (surface.fields !== void 0) {
    if (!Array.isArray(surface.fields) || surface.fields.length > 64) {
      return invalidSurface("fields must be an array of at most 64 names", {
        surface: surfaceKey(surface.contract, surface.major)
      });
    }
    const seen = /* @__PURE__ */ new Set();
    for (const field of surface.fields) {
      if (typeof field !== "string" || !isMethodName(field) || seen.has(field)) {
        return invalidSurface(`field name \xAB${String(field)}\xBB is not lowerCamel or repeats`, {
          surface: surfaceKey(surface.contract, surface.major)
        });
      }
      if (Object.hasOwn(surface.methods, field)) {
        return invalidSurface(`\xAB${field}\xBB cannot be both a field and a method`, {
          surface: surfaceKey(surface.contract, surface.major)
        });
      }
      seen.add(field);
    }
  }
}
function createSurfaceRegistry(surfaces) {
  const byKey = /* @__PURE__ */ new Map();
  for (const surface of surfaces) {
    assertSurface(surface);
    const key = surfaceKey(surface.contract, surface.major);
    if (byKey.has(key)) {
      throw new ModkitError({
        code: "x3.host/rpc-duplicate-surface",
        message: `surface ${key} is registered twice`
      });
    }
    const methods = {};
    for (const [name, method] of Object.entries(surface.methods)) {
      methods[name] = snapshotMethod(name, method, key);
    }
    const snapshot = Object.freeze({
      contract: surface.contract,
      major: surface.major,
      methods: Object.freeze(methods),
      ...surface.releaseVia === void 0 ? {} : { releaseVia: surface.releaseVia },
      ...surface.fields === void 0 ? {} : { fields: Object.freeze([...surface.fields]) }
    });
    byKey.set(key, snapshot);
  }
  for (const surface of byKey.values()) {
    for (const [name, method] of Object.entries(surface.methods)) {
      if (method.kind === "lease" && method.result !== void 0 && !byKey.has(surfaceKey(method.result.contract, method.result.major))) {
        throw new ModkitError({
          code: "x3.host/rpc-unknown-result-surface",
          message: `lease method \xAB${name}\xBB of ${surfaceKey(surface.contract, surface.major)} names unregistered surface ${surfaceKey(method.result.contract, method.result.major)}`
        });
      }
    }
  }
  return Object.freeze({
    surfaceFor(contract, major) {
      return byKey.get(surfaceKey(contract, major));
    }
  });
}

// packages/host/dist/execution/handles.js
var HandleTable = class {
  owner;
  generation;
  limits;
  records = /* @__PURE__ */ new Map();
  sequence = 0;
  releasedTotal = 0;
  invalidated = false;
  constructor(owner, generation, limits) {
    this.owner = owner;
    this.generation = generation;
    this.limits = limits;
  }
  get isInvalidated() {
    return this.invalidated;
  }
  counts() {
    let leases = 0;
    let iterators = 0;
    let events = 0;
    for (const record of this.records.values()) {
      if (record.kind === "lease")
        leases += 1;
      else if (record.kind === "iterator")
        iterators += 1;
      else
        events += 1;
    }
    return Object.freeze({
      live: this.records.size,
      leases,
      iterators,
      events,
      allocated: this.sequence,
      releasedTotal: this.releasedTotal
    });
  }
  assertLimit(kind) {
    const counts = this.counts();
    const limit = (code, current, max) => {
      if (current >= max) {
        throw new ModkitError({
          code: "x3.host/rpc-limit-exceeded",
          message: `${code} limit ${max} reached for generation ${this.generation}`,
          context: { limit: code, max },
          retryability: "conditional"
        });
      }
    };
    limit("handles", counts.live, this.limits.maxHandles);
    if (kind === "iterator")
      limit("iterators", counts.iterators, this.limits.maxIterators);
    if (kind === "events")
      limit("events", counts.events, this.limits.maxSubscriptions);
  }
  allocate(input) {
    if (this.invalidated) {
      throw new ModkitError({
        code: "x3.host/rpc-generation-invalidated",
        message: `generation ${this.generation} is invalidated; no new handles`
      });
    }
    this.assertLimit(input.kind);
    if (input.parent !== void 0) {
      const parent = this.records.get(input.parent);
      if (parent === void 0) {
        throw new ModkitError({
          code: "x3.host/rpc-unknown-handle",
          message: `parent handle ${input.parent} is not live`
        });
      }
    }
    this.sequence += 1;
    const id = `${this.owner}${this.generation}-${this.sequence}`;
    const record = {
      id,
      kind: input.kind,
      ...input.contract === void 0 ? {} : { contract: input.contract },
      ...input.major === void 0 ? {} : { major: input.major },
      target: input.target,
      ...input.parent === void 0 ? {} : { parent: input.parent },
      children: /* @__PURE__ */ new Set(),
      release: input.release,
      released: false
    };
    this.records.set(id, record);
    if (input.parent !== void 0)
      this.records.get(input.parent)?.children.add(id);
    return record;
  }
  parseId(id) {
    const match = /^([hw])(\d+)-(\d+)$/u.exec(id);
    if (match === null)
      return void 0;
    return { owner: match[1], generation: Number(match[2]), sequence: Number(match[3]) };
  }
  /** True when the id was allocated by this side (owner prefix), whatever its generation. */
  owns(id) {
    return this.parseId(id)?.owner === this.owner;
  }
  lookup(id) {
    const live = this.records.get(id);
    if (live !== void 0)
      return { state: "live", record: live };
    const parsed = this.parseId(id);
    if (parsed === void 0 || parsed.owner !== this.owner || parsed.generation !== this.generation) {
      return { state: "foreign-generation" };
    }
    return parsed.sequence >= 1 && parsed.sequence <= this.sequence ? { state: "released" } : { state: "unknown" };
  }
  /**
   * Releases a handle and everything created through it (children first, reverse allocation
   * order). Idempotent: an already released or unknown-but-plausible id reports `false`.
   * Release failures are collected, never swallowed.
   */
  async release(id) {
    const record = this.records.get(id);
    if (record === void 0)
      return { released: false, failures: [] };
    const failures = [];
    await this.releaseRecord(record, failures);
    return { released: true, failures };
  }
  async releaseRecord(record, failures) {
    if (record.released)
      return;
    record.released = true;
    const children = [...record.children].reverse();
    for (const childId of children) {
      const child = this.records.get(childId);
      if (child !== void 0)
        await this.releaseRecord(child, failures);
    }
    this.records.delete(record.id);
    if (record.parent !== void 0)
      this.records.get(record.parent)?.children.delete(record.id);
    this.releasedTotal += 1;
    try {
      await record.release();
    } catch (error) {
      failures.push(error);
    }
  }
  /** Releases every live handle (reverse allocation order) and refuses future allocations. */
  async invalidate() {
    this.invalidated = true;
    const failures = [];
    const released = [];
    const ids = [...this.records.keys()].reverse();
    for (const id of ids) {
      const record = this.records.get(id);
      if (record === void 0)
        continue;
      released.push(id);
      await this.releaseRecord(record, failures);
    }
    return { released, failures };
  }
  liveIds() {
    return [...this.records.keys()];
  }
};
var PendingCalls = class {
  limits;
  calls = /* @__PURE__ */ new Map();
  lateAfterCancel = 0;
  /** Highest id ever opened; a reply above it never had a call, a reply at or below it did. */
  highestOpened = 0;
  constructor(limits) {
    this.limits = limits;
  }
  get size() {
    return this.calls.size;
  }
  get droppedLateReplies() {
    return this.lateAfterCancel;
  }
  open(call) {
    if (this.calls.size >= this.limits.maxPendingCalls) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `pending call limit ${this.limits.maxPendingCalls} reached`,
        context: { limit: "pendingCalls", max: this.limits.maxPendingCalls },
        retryability: "conditional"
      });
    }
    const entry = { ...call, cancelled: false, settled: false };
    this.calls.set(call.id, entry);
    if (call.id > this.highestOpened)
      this.highestOpened = call.id;
    return entry;
  }
  peek(id) {
    return this.calls.get(id);
  }
  /** Forgets a call that was never sent (send failure); the caller rejects it locally. */
  drop(id) {
    this.calls.delete(id);
  }
  /** Marks the call cancelled locally; the caller has already been rejected with cancellation. */
  cancel(id) {
    const entry = this.calls.get(id);
    if (entry === void 0 || entry.settled)
      return void 0;
    entry.cancelled = true;
    return entry;
  }
  progress(id, progress) {
    const entry = this.calls.get(id);
    if (entry === void 0)
      return id <= this.highestOpened ? "duplicate" : "unknown";
    if (entry.cancelled)
      return "late-after-cancel";
    entry.onProgress?.(progress);
    return "settled";
  }
  settle(id, outcome) {
    const entry = this.calls.get(id);
    if (entry === void 0)
      return id <= this.highestOpened ? "duplicate" : "unknown";
    this.calls.delete(id);
    if (entry.cancelled) {
      this.lateAfterCancel += 1;
      return "late-after-cancel";
    }
    if (entry.settled)
      return "duplicate";
    entry.settled = true;
    entry.resolve(outcome);
    return "settled";
  }
  /** Rejects every non-cancelled pending call (endpoint failure / peer exit). */
  failAll(error) {
    let rejected = 0;
    for (const entry of [...this.calls.values()]) {
      this.calls.delete(entry.id);
      if (entry.cancelled || entry.settled)
        continue;
      entry.settled = true;
      entry.reject(error);
      rejected += 1;
    }
    return rejected;
  }
};
var ActiveCalls = class {
  calls = /* @__PURE__ */ new Map();
  get size() {
    return this.calls.size;
  }
  begin(id) {
    const entry = { id, controller: new AbortController(), cancelled: false };
    this.calls.set(id, entry);
    return entry;
  }
  end(id) {
    this.calls.delete(id);
  }
  cancel(id) {
    const entry = this.calls.get(id);
    if (entry === void 0)
      return false;
    entry.cancelled = true;
    entry.controller.abort(new OperationCancelledError("cancelled by peer"));
    return true;
  }
  cancelAll() {
    for (const entry of this.calls.values()) {
      entry.cancelled = true;
      entry.controller.abort(new OperationCancelledError("endpoint closed"));
    }
    this.calls.clear();
  }
};
var Subscriptions = class {
  limits;
  records = /* @__PURE__ */ new Map();
  constructor(limits) {
    this.limits = limits;
  }
  /** Live (not yet closed) subscriptions. */
  get size() {
    let live = 0;
    for (const record of this.records.values())
      if (!record.closed)
        live += 1;
    return live;
  }
  register(id, handle) {
    if (this.records.has(id)) {
      throw new ModkitError({
        code: "x3.host/rpc-duplicate-subscription",
        message: `subscription ${id} is already registered`
      });
    }
    if (this.size >= this.limits.maxSubscriptions) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `subscription limit ${this.limits.maxSubscriptions} reached`,
        context: { limit: "subscriptions", max: this.limits.maxSubscriptions },
        retryability: "conditional"
      });
    }
    const record = {
      id,
      handle,
      queue: [],
      wake: void 0,
      closed: false,
      error: void 0
    };
    this.records.set(id, record);
    return record;
  }
  get(id) {
    return this.records.get(id);
  }
  entries() {
    return [...this.records.entries()];
  }
  /** Enqueues an event; `overflow` when the consumer is too slow (bounded queue). */
  push(id, value2) {
    const record = this.records.get(id);
    if (record === void 0 || record.closed)
      return "unknown";
    if (record.queue.length >= this.limits.maxQueuedEvents)
      return "overflow";
    record.queue.push(value2);
    record.wake?.();
    return "queued";
  }
  /** Marks the stream ended (optionally by failure) and wakes the consumer; keeps the queue. */
  close(id, error) {
    const record = this.records.get(id);
    if (record === void 0)
      return;
    record.closed = true;
    if (error !== void 0)
      record.error = error;
    record.wake?.();
  }
  /** The consumer is done with the record (drained or abandoned). */
  drop(id) {
    this.records.delete(id);
  }
  closeAll(error) {
    for (const id of [...this.records.keys()])
      this.close(id, error);
  }
};

// packages/host/dist/execution/endpoint.js
var CAPABILITY_OF = /* @__PURE__ */ Symbol.for("x3.host/rpc/proxied-remote");
var RemoteCapabilityImpl = class {
  endpoint;
  ref;
  contract;
  major;
  data;
  constructor(endpoint, ref, contract, major, data2 = Object.freeze({})) {
    this.endpoint = endpoint;
    this.ref = ref;
    this.contract = contract;
    this.major = major;
    this.data = data2;
  }
  get id() {
    return this.ref[HANDLE_MARKER].id;
  }
  get has() {
    return this.ref[HANDLE_MARKER].has;
  }
  get isReleased() {
    return this.endpoint.remoteReleased(this.id);
  }
  call(method, args = [], options = {}) {
    return this.endpoint.callRemote(this, method, args, options);
  }
  release() {
    return this.endpoint.releaseRemote(this.id);
  }
};
var LocalCapabilityImpl = class {
  endpoint;
  ref;
  contract;
  major;
  constructor(endpoint, ref, contract, major) {
    this.endpoint = endpoint;
    this.ref = ref;
    this.contract = contract;
    this.major = major;
  }
  get isReleased() {
    return this.endpoint.localReleased(this.ref[HANDLE_MARKER].id);
  }
  async release() {
    await this.endpoint.releaseLocal(this.ref[HANDLE_MARKER].id);
  }
};
var noopRelease = () => void 0;
function normalizeProgress(value2) {
  if (typeof value2 !== "object" || value2 === null)
    return void 0;
  const record = value2;
  const completed = record["completed"];
  if (typeof completed !== "number" || !Number.isFinite(completed) || completed < 0)
    return void 0;
  const total = record["total"];
  const message = record["message"];
  return {
    completed,
    ...typeof total === "number" && Number.isFinite(total) && total >= 0 ? { total } : {},
    ...typeof message === "string" ? { message: message.slice(0, 1024) } : {}
  };
}
function lazyStream(start) {
  return {
    [Symbol.asyncIterator]() {
      let iterator;
      const open = async () => {
        if (iterator === void 0) {
          const stream = await start();
          iterator = stream[Symbol.asyncIterator]();
        }
        return iterator;
      };
      return {
        async next(...args) {
          return (await open()).next(...args);
        },
        async return(value2) {
          if (iterator === void 0)
            return { done: true, value: value2 };
          return await iterator.return?.(value2) ?? { done: true, value: value2 };
        },
        async throw(error) {
          if (iterator === void 0)
            throw error;
          const thrown = await iterator.throw?.(error);
          if (thrown === void 0)
            throw error;
          return thrown;
        }
      };
    }
  };
}
function isAbortSignal(value2) {
  return typeof AbortSignal !== "undefined" && value2 instanceof AbortSignal;
}
function isAsyncIterable(value2) {
  return typeof value2 === "object" && value2 !== null && typeof value2[Symbol.asyncIterator] === "function";
}
function isLeaseLike(value2) {
  return typeof value2 === "object" && value2 !== null && "value" in value2 && typeof value2.release === "function";
}
var EndpointImpl = class {
  role;
  session;
  generation;
  limits;
  state = "open";
  port;
  surfaces;
  loader;
  scheduler;
  onFailure;
  onDiagnostic;
  onTerminate;
  unsubscribePort;
  ownerPrefix;
  table;
  pending;
  active = new ActiveCalls();
  subscriptions;
  remote = /* @__PURE__ */ new Map();
  remoteProxies = /* @__PURE__ */ new Map();
  pumps = /* @__PURE__ */ new Map();
  pumpSequence = 0;
  outboundId = 0;
  lastInboundId = 0;
  droppedEvents = 0;
  violations = 0;
  inboundCount = 0;
  constructor(options) {
    this.role = options.role;
    this.session = options.session;
    this.generation = options.generation;
    this.limits = options.limits ?? DEFAULT_PROTOCOL_LIMITS;
    this.port = options.port;
    this.surfaces = options.surfaces;
    this.loader = options.loader;
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle)
    };
    this.onFailure = options.onFailure;
    this.onDiagnostic = options.onDiagnostic;
    this.onTerminate = options.onTerminate;
    this.ownerPrefix = options.role === "host" ? "h" : "w";
    this.table = new HandleTable(this.ownerPrefix, options.generation, this.limits);
    this.pending = new PendingCalls(this.limits);
    this.subscriptions = new Subscriptions(this.limits);
    this.unsubscribePort = options.port.onFrame((raw) => this.receive(raw));
  }
  // ------------------------------------------------------------------ public surface
  counters() {
    return Object.freeze({
      state: this.state,
      outbound: this.outboundId,
      inbound: this.inboundCount,
      pendingCalls: this.pending.size,
      activeCalls: this.active.size,
      localHandles: this.table.counts().live,
      remoteHandles: [...this.remote.values()].filter((item) => !item.released).length,
      subscriptions: this.subscriptions.size,
      droppedLateReplies: this.pending.droppedLateReplies,
      droppedEvents: this.droppedEvents,
      violations: this.violations
    });
  }
  expose(target, surface, release = noopRelease) {
    this.assertOpen();
    if (this.surfaces.surfaceFor(surface.contract, surface.major) === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-unknown-surface",
        message: `cannot expose a capability with unregistered surface ${surface.contract}@${surface.major}`
      });
    }
    const data2 = this.fieldData(target, surface);
    const has = this.presentOptional(target, surface);
    const record = this.table.allocate({
      kind: "lease",
      target,
      release,
      contract: surface.contract,
      major: surface.major
    });
    return new LocalCapabilityImpl(this, handleRef(record.id, "lease", surface, data2, has), surface.contract, surface.major);
  }
  async load(request, options = {}) {
    this.assertOpen();
    if (this.role !== "host") {
      throw new ModkitError({
        code: "x3.host/rpc-role-violation",
        message: "only the host endpoint loads modules"
      });
    }
    const outcome = await this.request({ t: "load", ...request }, "load", options);
    if (outcome.kind === "throw")
      throw fromErrorDto(outcome.error);
    if (outcome.kind !== "handle") {
      throw this.failWith({ code: "unexpected-frame", message: "load must be answered by ready" });
    }
    const ready = outcome.value;
    return Object.freeze({ abiVersion: 1, exports: ready.exports, root: this.proxy(ready.root) });
  }
  proxy(ref) {
    const inner = ref[HANDLE_MARKER];
    if (this.table.owns(inner.id)) {
      throw new ModkitError({
        code: "x3.host/rpc-not-remote",
        message: `handle ${inner.id} is local to this endpoint`
      });
    }
    if (inner.kind !== "lease" || inner.contract === void 0 || inner.major === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-bad-handle",
        message: `handle ${inner.id} is not a lease capability`
      });
    }
    if (this.surfaces.surfaceFor(inner.contract, inner.major) === void 0) {
      throw this.failWith({
        code: "unknown-surface",
        message: `peer offered unregistered surface ${inner.contract}@${inner.major}`
      });
    }
    const existing = this.remoteProxies.get(inner.id);
    if (existing !== void 0)
      return existing;
    if (!this.remote.has(inner.id))
      this.remote.set(inner.id, { ref, released: false, children: /* @__PURE__ */ new Set() });
    const capability = new RemoteCapabilityImpl(this, ref, inner.contract, inner.major, Object.freeze({ ...inner.data ?? {} }));
    this.remoteProxies.set(inner.id, capability);
    return capability;
  }
  materialize(remote) {
    const surface = this.requireSurface(remote.contract, remote.major);
    const object = {};
    for (const field of surface.fields ?? []) {
      if (Object.hasOwn(remote.data, field)) {
        Object.defineProperty(object, field, {
          value: remote.data[field],
          enumerable: true,
          writable: false
        });
      }
    }
    const present = remote.has;
    for (const [name, method] of Object.entries(surface.methods)) {
      if (method.optional === true && present !== void 0 && !present.includes(name))
        continue;
      const invoke = async (...rawArgs) => {
        const args = [...rawArgs];
        let signal;
        let onProgress;
        const last = args[args.length - 1];
        if (isAbortSignal(last)) {
          signal = last;
          args.pop();
        }
        const lift = (ref, expect) => {
          const holder = args[ref.arg];
          if (typeof holder !== "object" || holder === null || !Object.hasOwn(holder, ref.key))
            return void 0;
          const value2 = holder[ref.key];
          const matches2 = expect === "signal" ? isAbortSignal(value2) : typeof value2 === "function";
          if (!matches2 && value2 !== void 0)
            return void 0;
          args[ref.arg] = Object.fromEntries(Object.entries(holder).filter(([key]) => key !== ref.key));
          return value2;
        };
        if (typeof method.signal === "object") {
          const lifted = lift(method.signal, "signal");
          if (isAbortSignal(lifted))
            signal = lifted;
        }
        if (method.progress !== void 0) {
          const lifted = lift(method.progress, "function");
          if (typeof lifted === "function")
            onProgress = lifted;
        }
        const outcome = await remote.call(name, args, {
          ...signal === void 0 ? {} : { signal },
          ...onProgress === void 0 ? {} : { onProgress }
        });
        switch (outcome.kind) {
          case "value":
            return outcome.value;
          case "lease": {
            const materialized = this.materialize(outcome.remote);
            return method.wrapper === "lease" ? { value: materialized, release: () => outcome.remote.release() } : materialized;
          }
          case "leased-value":
            return { value: outcome.value, release: outcome.release };
          case "iterable":
            return outcome.iterable;
          case "events":
            return outcome.events;
        }
      };
      object[name] = method.kind === "iterable" || method.kind === "events" ? (...rawArgs) => lazyStream(() => invoke(...rawArgs)) : invoke;
    }
    if (surface.releaseVia !== void 0) {
      const inner = object[surface.releaseVia];
      object[surface.releaseVia] = async (...args) => {
        try {
          return await inner(...args);
        } finally {
          await remote.release();
        }
      };
    }
    Object.defineProperty(object, CAPABILITY_OF, { value: remote, enumerable: false });
    return object;
  }
  receive(raw) {
    if (this.state !== "open")
      return;
    const validated = validateFrame(raw, this.limits, {
      session: this.session,
      generation: this.generation
    });
    if (!validated.ok) {
      this.fail(validated.violation);
      return;
    }
    const frame = validated.value;
    if (frame.id <= this.lastInboundId) {
      this.fail({
        code: "non-monotonic-id",
        message: `frame id ${frame.id} is not greater than ${this.lastInboundId}`
      });
      return;
    }
    this.lastInboundId = frame.id;
    this.inboundCount += 1;
    void this.dispatch(frame).catch((error) => {
      this.fail({
        code: "unexpected-frame",
        message: `frame handler failed: ${error instanceof Error ? error.message : String(error)}`
      });
    });
  }
  async close(reason) {
    if (this.state !== "open")
      return;
    this.state = "closed";
    this.trySend({ t: "terminate", reason });
    await this.teardown(new ModkitError({
      code: "x3.host/rpc-endpoint-closed",
      message: `endpoint closed: ${reason}`,
      retryability: "conditional"
    }));
  }
  async peerClosed(reason) {
    if (this.state !== "open")
      return;
    this.state = "closed";
    await this.teardown(new ModkitError({
      code: "x3.host/rpc-peer-exited",
      message: `peer exited: ${reason}`,
      retryability: "conditional"
    }));
  }
  // ------------------------------------------------------------------ internal: lifecycle
  assertOpen() {
    if (this.state !== "open") {
      throw new ModkitError({
        code: "x3.host/rpc-endpoint-closed",
        message: `endpoint is ${this.state}`
      });
    }
  }
  failWith(item) {
    this.fail(item);
    return protocolViolationError(item);
  }
  fail(item) {
    if (this.state !== "open")
      return;
    this.violations += 1;
    this.state = "failed";
    this.trySend({ t: "terminate", reason: `protocol violation: ${item.code}` });
    void this.teardown(protocolViolationError(item));
    this.onFailure?.(item);
  }
  async teardown(error) {
    this.unsubscribePort();
    this.pending.failAll(error);
    this.active.cancelAll();
    this.subscriptions.closeAll(error);
    for (const pump of this.pumps.values()) {
      pump.stopped = true;
      void pump.iterator?.return?.();
    }
    this.pumps.clear();
    for (const state of this.remote.values())
      state.released = true;
    const { failures } = await this.table.invalidate();
    for (const failure of failures)
      this.report("x3.host/rpc-release-failed", `release failed during teardown: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  report(code, message) {
    this.onDiagnostic?.({ code, severity: "warning", message });
  }
  // ------------------------------------------------------------------ internal: sending
  nextId() {
    this.outboundId += 1;
    return this.outboundId;
  }
  buildFrame(body) {
    return {
      domain: CAPABILITY_RPC_DOMAIN,
      version: CAPABILITY_RPC_VERSION,
      session: this.session,
      generation: this.generation,
      id: this.nextId(),
      ...body
    };
  }
  /**
   * Sends a frame; outbound values are validated with our own limits before they leave.
   *
   * Transfer policy: **arguments are copied, results and events are transferred.** ABI code is
   * written for in-process calls and freely reuses a buffer it passed as an argument (a codec hands
   * the same `bytes` to `parse` and then to `dataSource`); transferring would detach it under the
   * caller's feet. Results are one-shot values the executor produced for this reply, so moving them
   * is safe and keeps large reads cheap.
   */
  send(body) {
    const frame = this.buildFrame(body);
    const transfer = [];
    const measure = (value2, handles, move) => {
      const checked = validateWireValue(value2, this.limits, handles);
      if (!checked.ok) {
        throw new ModkitError({
          code: "x3.host/rpc-outbound-value-invalid",
          message: `outbound value rejected: ${checked.violation.message}`,
          context: { violation: checked.violation.code }
        });
      }
      if (move)
        transfer.push(...checked.value.transferables);
    };
    if (frame.t === "call")
      measure(frame.args, "nested", false);
    else if (frame.t === "return" && frame.value !== void 0)
      measure(frame.value, "top", true);
    else if (frame.t === "event")
      measure(frame.value, "forbid", true);
    this.port.post(frame, transfer);
    return frame;
  }
  trySend(body) {
    try {
      this.port.post(this.buildFrame(body), []);
    } catch {
    }
  }
  request(body, kind, options) {
    this.assertOpen();
    if (options.signal?.aborted) {
      return Promise.reject(new OperationCancelledError(options.signal.reason));
    }
    return new Promise((resolve, reject) => {
      const id = this.outboundId + 1;
      let timer;
      let abortListener;
      const cleanup = () => {
        if (timer !== void 0)
          this.scheduler.clearTimeout(timer);
        if (abortListener !== void 0)
          options.signal?.removeEventListener("abort", abortListener);
      };
      const entry = this.pending.open({
        id,
        kind,
        resolve: (outcome) => {
          cleanup();
          resolve(outcome);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        ...options.onProgress === void 0 ? {} : { onProgress: options.onProgress }
      });
      const cancelWith = (error) => {
        if (entry.settled || entry.cancelled)
          return;
        this.pending.cancel(id);
        cleanup();
        this.trySend({ t: "cancel", target: id });
        reject(error);
      };
      const deadline = options.deadlineMs ?? this.limits.defaultCallDeadlineMs;
      if (deadline > 0 && kind !== "subscribe") {
        timer = this.scheduler.setTimeout(() => cancelWith(new ModkitError({
          code: "x3.host/rpc-deadline-exceeded",
          message: `${kind} #${id} exceeded its ${deadline} ms deadline`,
          context: { id, deadlineMs: deadline },
          retryability: "conditional"
        })), deadline);
      }
      if (options.signal !== void 0) {
        abortListener = () => cancelWith(new OperationCancelledError(options.signal?.reason));
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
      try {
        const frame = this.send(body);
        if (frame.id !== id) {
          throw new ModkitError({
            code: "x3.host/rpc-internal",
            message: "frame id allocation raced"
          });
        }
      } catch (error) {
        this.pending.drop(id);
        cleanup();
        reject(isModkitError(error) ? error : new ModkitError({ code: "x3.host/rpc-send-failed", message: String(error) }));
      }
    });
  }
  // ------------------------------------------------------------------ internal: remote side
  remoteReleased(id) {
    return this.remote.get(id)?.released ?? true;
  }
  localReleased(id) {
    return this.table.lookup(id).state !== "live";
  }
  requireSurface(contract, major) {
    const surface = this.surfaces.surfaceFor(contract, major);
    if (surface === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-unknown-surface",
        message: `no surface registered for ${contract}@${major}`
      });
    }
    return surface;
  }
  encodeArgs(args) {
    const encode = (value2, path) => {
      if (value2 instanceof RemoteCapabilityImpl || value2 instanceof LocalCapabilityImpl) {
        if (value2.isReleased) {
          throw new ModkitError({
            code: "x3.host/rpc-released-handle",
            message: `argument ${path} is a released capability`
          });
        }
        return value2.ref;
      }
      if (typeof value2 === "object" && value2 !== null && CAPABILITY_OF in value2) {
        return encode(value2[CAPABILITY_OF], path);
      }
      if (isHandleRef(value2))
        return value2;
      if (Array.isArray(value2))
        return value2.map((item, index) => encode(item, `${path}[${index}]`));
      if (isPlainObject(value2)) {
        const out = {};
        for (const [key, item] of Object.entries(value2))
          out[key] = encode(item, `${path}.${key}`);
        return out;
      }
      return value2;
    };
    return args.map((arg, index) => encode(arg, `args[${index}]`));
  }
  async callRemote(remote, method, args, options) {
    this.assertOpen();
    if (remote.isReleased) {
      throw new ModkitError({
        code: "x3.host/rpc-released-handle",
        message: `remote ${remote.id} was released`
      });
    }
    const surface = this.requireSurface(remote.contract, remote.major);
    const decl = surface.methods[method];
    if (decl === void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-unknown-method",
        message: `surface ${remote.contract}@${remote.major} has no method \xAB${method}\xBB`
      });
    }
    if (args.length > this.limits.maxArgs) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `more than ${this.limits.maxArgs} arguments`
      });
    }
    const encoded = this.encodeArgs(args);
    const argProblem = decl.validateArgs?.(encoded);
    if (argProblem !== void 0) {
      throw new ModkitError({
        code: "x3.host/rpc-bad-argument",
        message: `${method}: ${argProblem}`
      });
    }
    const outcome = await this.request({
      t: "call",
      handle: remote.id,
      method,
      args: encoded,
      ...options.deadlineMs === void 0 ? {} : { deadlineMs: options.deadlineMs }
    }, "call", options);
    if (outcome.kind === "throw")
      throw fromErrorDto(outcome.error);
    if (outcome.kind === "done")
      throw this.failWith({ code: "unexpected-frame", message: "call answered with done" });
    if (surface.releaseVia === method)
      this.markRemoteReleased(remote.id);
    if (decl.kind === "value") {
      if (outcome.kind !== "return")
        throw this.failWith({
          code: "bad-return",
          message: `value method \xAB${method}\xBB returned a handle`
        });
      const problem = decl.validateReturn?.(outcome.value);
      if (problem !== void 0)
        throw this.failWith({ code: "bad-return", message: `${method}: ${problem}` });
      return { kind: "value", value: outcome.value };
    }
    if (decl.kind === "leased-value") {
      if (outcome.kind !== "return" || outcome.lease === void 0) {
        throw this.failWith({
          code: "bad-return",
          message: `leased-value method \xAB${method}\xBB did not return a value with its lease`
        });
      }
      const problem = decl.validateReturn?.(outcome.value);
      if (problem !== void 0)
        throw this.failWith({ code: "bad-return", message: `${method}: ${problem}` });
      const leaseId = this.adoptRemoteHandle(outcome.lease, remote.id, "lease");
      return {
        kind: "leased-value",
        value: outcome.value,
        release: () => this.releaseRemote(leaseId)
      };
    }
    if (outcome.kind !== "handle") {
      throw this.failWith({
        code: "bad-return",
        message: `${decl.kind} method \xAB${method}\xBB returned a plain value`
      });
    }
    const ref = outcome.value;
    const inner = ref[HANDLE_MARKER];
    this.adoptRemoteHandle(ref, remote.id);
    switch (decl.kind) {
      case "lease": {
        const expected = decl.result;
        const dynamic = decl.resultFromArgs !== void 0;
        if (inner.kind !== "lease" || inner.contract === void 0 || inner.major === void 0 || !dynamic && (expected === void 0 || inner.contract !== expected.contract || inner.major !== expected.major)) {
          throw this.failWith({
            code: "bad-handle",
            message: `lease method \xAB${method}\xBB returned a handle of another kind/surface`
          });
        }
        if (dynamic && this.surfaces.surfaceFor(inner.contract, inner.major) === void 0) {
          throw this.failWith({
            code: "unknown-surface",
            message: `lease method \xAB${method}\xBB returned unregistered surface ${inner.contract}@${inner.major}`
          });
        }
        return { kind: "lease", remote: this.proxy(ref) };
      }
      case "iterable": {
        if (inner.kind !== "iterator")
          throw this.failWith({
            code: "bad-handle",
            message: `iterable method \xAB${method}\xBB did not return an iterator handle`
          });
        return { kind: "iterable", iterable: this.remoteIterable(inner.id, decl) };
      }
      case "events": {
        if (inner.kind !== "events")
          throw this.failWith({
            code: "bad-handle",
            message: `events method \xAB${method}\xBB did not return an events handle`
          });
        return { kind: "events", events: this.remoteEvents(inner.id, decl) };
      }
      default:
        throw this.failWith({ code: "bad-return", message: "unknown method kind" });
    }
  }
  /** Registers a handle the peer produced for us; refuses our own, reused or over-limit ids. */
  adoptRemoteHandle(ref, parent, expectKind) {
    const inner = ref[HANDLE_MARKER];
    if (this.table.owns(inner.id))
      throw this.failWith({ code: "bad-handle", message: "peer returned a handle this side owns" });
    if (this.remote.has(inner.id))
      throw this.failWith({ code: "bad-handle", message: `peer reused handle ${inner.id}` });
    if (expectKind !== void 0 && inner.kind !== expectKind)
      throw this.failWith({ code: "bad-handle", message: `expected a ${expectKind} handle` });
    if (this.remote.size >= this.limits.maxHandles) {
      throw new ModkitError({
        code: "x3.host/rpc-limit-exceeded",
        message: `remote handle limit ${this.limits.maxHandles} reached`
      });
    }
    this.remote.set(inner.id, { ref, released: false, children: /* @__PURE__ */ new Set(), parent });
    this.remote.get(parent)?.children.add(inner.id);
    return inner.id;
  }
  markRemoteReleased(id) {
    const state = this.remote.get(id);
    if (state === void 0 || state.released)
      return;
    state.released = true;
    for (const child of [...state.children].reverse())
      this.markRemoteReleased(child);
    if (state.parent !== void 0)
      this.remote.get(state.parent)?.children.delete(id);
  }
  async releaseRemote(id) {
    const state = this.remote.get(id);
    if (state === void 0 || state.released)
      return;
    this.markRemoteReleased(id);
    if (this.state !== "open")
      return;
    const outcome = await this.request({ t: "release", handle: id }, "release", {
      deadlineMs: this.limits.defaultCallDeadlineMs
    });
    if (outcome.kind === "throw")
      throw fromErrorDto(outcome.error);
  }
  remoteIterable(id, decl) {
    const batch = this.limits.iteratorBatchItems;
    return {
      [Symbol.asyncIterator]: () => {
        let finished = false;
        const buffered = [];
        return {
          next: async () => {
            if (buffered.length > 0)
              return { done: false, value: buffered.shift() };
            if (finished || this.remoteReleased(id))
              return { done: true, value: void 0 };
            const outcome = await this.request(batch > 1 ? { t: "next", handle: id, max: batch } : { t: "next", handle: id }, "next", {});
            if (outcome.kind === "done") {
              finished = true;
              this.markRemoteReleased(id);
              return { done: true, value: void 0 };
            }
            if (outcome.kind === "throw") {
              finished = true;
              this.markRemoteReleased(id);
              throw fromErrorDto(outcome.error);
            }
            if (outcome.kind !== "return") {
              throw this.failWith({
                code: "bad-return",
                message: "iterator item must be a plain value"
              });
            }
            if (batch > 1) {
              const items = outcome.value;
              if (!Array.isArray(items) || items.length === 0 || items.length > batch) {
                throw this.failWith({
                  code: "bad-return",
                  message: `iterator batch must be a non-empty array of at most ${batch} items`
                });
              }
              for (const item of items) {
                const problem2 = decl.validateReturn?.(item);
                if (problem2 !== void 0)
                  throw this.failWith({ code: "bad-return", message: problem2 });
              }
              buffered.push(...items);
              return { done: false, value: buffered.shift() };
            }
            const problem = decl.validateReturn?.(outcome.value);
            if (problem !== void 0)
              throw this.failWith({ code: "bad-return", message: problem });
            return { done: false, value: outcome.value };
          },
          return: async () => {
            if (!finished) {
              finished = true;
              await this.releaseRemote(id);
            }
            return { done: true, value: void 0 };
          }
        };
      }
    };
  }
  remoteEvents(id, decl) {
    return {
      [Symbol.asyncIterator]: () => {
        let subscription;
        let finished = false;
        const stop = async () => {
          if (finished)
            return;
          finished = true;
          if (subscription !== void 0) {
            this.subscriptions.close(subscription);
            this.subscriptions.drop(subscription);
            if (this.state === "open")
              this.trySend({ t: "unsubscribe", subscription });
          }
          await this.releaseRemote(id);
        };
        return {
          next: async () => {
            if (finished)
              return { done: true, value: void 0 };
            if (subscription === void 0) {
              const outcome = await this.request({ t: "subscribe", handle: id }, "subscribe", {});
              if (outcome.kind === "throw") {
                finished = true;
                throw fromErrorDto(outcome.error);
              }
              if (outcome.kind !== "return" || typeof outcome.value !== "string") {
                throw this.failWith({
                  code: "bad-return",
                  message: "subscribe must return a subscription id"
                });
              }
              subscription = outcome.value;
              this.subscriptions.register(subscription, id);
            }
            for (; ; ) {
              const record = this.subscriptions.get(subscription);
              if (record === void 0) {
                finished = true;
                return { done: true, value: void 0 };
              }
              const item = record.queue.shift();
              if (item !== void 0) {
                const problem = decl.validateReturn?.(item);
                if (problem !== void 0)
                  throw this.failWith({ code: "bad-return", message: problem });
                return { done: false, value: item };
              }
              if (record.closed) {
                finished = true;
                this.subscriptions.drop(subscription);
                if (record.error !== void 0)
                  throw record.error;
                return { done: true, value: void 0 };
              }
              await new Promise((resolve) => {
                record.wake = resolve;
              });
              record.wake = void 0;
            }
          },
          return: async () => {
            await stop();
            return { done: true, value: void 0 };
          }
        };
      }
    };
  }
  closeSubscription(id, error) {
    this.subscriptions.close(id, error);
  }
  // ------------------------------------------------------------------ internal: local side
  async releaseLocal(id) {
    const result = await this.table.release(id);
    for (const failure of result.failures) {
      this.report("x3.host/rpc-release-failed", `release of ${id} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
  decodeArgs(args) {
    const decode = (value2) => {
      if (isHandleRef(value2)) {
        const inner = value2[HANDLE_MARKER];
        if (this.table.owns(inner.id)) {
          const lookup = this.table.lookup(inner.id);
          if (lookup.state !== "live") {
            throw new ModkitError({
              code: "x3.host/rpc-released-handle",
              message: `argument references released local handle ${inner.id}`
            });
          }
          return lookup.record.target;
        }
        if (inner.kind !== "lease") {
          throw new ModkitError({
            code: "x3.host/rpc-bad-argument",
            message: "only lease capabilities may be passed as arguments"
          });
        }
        return this.materialize(this.proxy(value2));
      }
      if (Array.isArray(value2))
        return value2.map((item) => decode(item));
      if (isPlainObject(value2)) {
        const out = {};
        for (const [key, item] of Object.entries(value2))
          out[key] = decode(item);
        return out;
      }
      return value2;
    };
    return args.map((arg) => decode(arg));
  }
  reply(inReplyTo, outcome) {
    if (this.state !== "open")
      return;
    try {
      switch (outcome.kind) {
        case "return":
          this.send({
            t: "return",
            inReplyTo,
            ...outcome.value === void 0 ? {} : { value: outcome.value },
            ...outcome.lease === void 0 ? {} : { lease: outcome.lease }
          });
          break;
        case "handle":
          this.send({ t: "return", inReplyTo, value: outcome.value });
          break;
        case "throw":
          this.send({ t: "throw", inReplyTo, error: outcome.error });
          break;
        case "ready":
          this.send({
            t: "ready",
            inReplyTo,
            abiVersion: 1,
            exports: outcome.value.exports,
            root: outcome.value.root
          });
          break;
        case "done":
          break;
      }
    } catch (error) {
      this.trySend({ t: "throw", inReplyTo, error: toErrorDto(error, this.limits) });
    }
  }
  async dispatch(frame) {
    switch (frame.t) {
      case "load":
        return this.handleLoad(frame);
      case "ready":
        return this.handleReady(frame);
      case "call":
        return this.handleCall(frame);
      case "return":
        return this.handleSettle(frame.inReplyTo, isHandleRef(frame.value) ? { kind: "handle", value: frame.value } : {
          kind: "return",
          value: frame.value,
          ...frame.lease === void 0 ? {} : { lease: frame.lease }
        });
      case "throw":
        return this.handleSettle(frame.inReplyTo, { kind: "throw", error: frame.error });
      case "progress": {
        const result = this.pending.progress(frame.inReplyTo, frame.progress);
        if (result === "unknown")
          this.fail({
            code: "unknown-reply-target",
            message: `progress for unknown call ${frame.inReplyTo}`
          });
        return;
      }
      case "cancel":
        this.active.cancel(frame.target);
        return;
      case "next":
        return this.handleNext(frame);
      case "done":
        return this.handleDone(frame);
      case "subscribe":
        return this.handleSubscribe(frame);
      case "event":
        return this.handleEvent(frame);
      case "unsubscribe": {
        const pump = this.pumps.get(frame.subscription);
        if (pump !== void 0) {
          pump.stopped = true;
          this.pumps.delete(frame.subscription);
          await pump.iterator?.return?.();
        }
        return;
      }
      case "release":
        return this.handleRelease(frame);
      case "terminate":
        if (this.state !== "open")
          return;
        this.state = "closed";
        await this.teardown(new ModkitError({
          code: "x3.host/rpc-terminated",
          message: `peer terminated: ${frame.reason}`,
          retryability: "conditional"
        }));
        this.onTerminate?.(frame.reason);
        return;
    }
  }
  handleSettle(inReplyTo, outcome) {
    const result = this.pending.settle(inReplyTo, outcome);
    if (result === "unknown")
      this.fail({ code: "unknown-reply-target", message: `reply for unknown call ${inReplyTo}` });
    else if (result === "duplicate")
      this.fail({ code: "duplicate-reply", message: `duplicate reply for call ${inReplyTo}` });
    else if (result === "late-after-cancel")
      this.report("x3.host/rpc-late-reply-dropped", `dropped late reply for cancelled call ${inReplyTo}`);
    if (result === "late-after-cancel" && outcome.kind === "handle") {
      const ref = outcome.value;
      this.discardHandle(ref[HANDLE_MARKER].id);
    } else if (result === "late-after-cancel" && outcome.kind === "return" && outcome.lease) {
      this.discardHandle(outcome.lease[HANDLE_MARKER].id);
    }
  }
  /**
   * Releases a handle the peer produced for a request this side had already cancelled. The peer
   * answers every `release`, so this must be a real request with a pending entry — a
   * fire-and-forget frame would turn the peer's acknowledgement into an `unknown-reply-target`
   * violation (found by the transport conformance kit on real event-loop hops).
   */
  discardHandle(id) {
    if (this.state !== "open")
      return;
    const failed = (reason) => this.report("x3.host/rpc-release-failed", `discard of late handle ${id} failed: ${reason}`);
    void this.request({ t: "release", handle: id }, "release", {
      deadlineMs: this.limits.defaultCallDeadlineMs
    }).then((outcome) => {
      if (outcome.kind === "throw")
        failed(outcome.error.message);
    }, (error) => failed(error instanceof Error ? error.message : String(error)));
  }
  async handleLoad(frame) {
    if (this.role !== "worker") {
      this.fail({ code: "unexpected-frame", message: "load received by a host endpoint" });
      return;
    }
    if (this.loader === void 0) {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new ModkitError({
          code: "x3.host/rpc-no-loader",
          message: "this endpoint cannot load modules"
        }), this.limits)
      });
      return;
    }
    const active = this.active.begin(frame.id);
    try {
      const loaded = await this.loader({
        moduleUrl: frame.moduleUrl,
        contributionId: frame.contributionId,
        variantId: frame.variantId,
        artifactDigest: frame.artifactDigest,
        ...frame.entrypointDigest === void 0 ? {} : { entrypointDigest: frame.entrypointDigest }
      }, active.controller.signal);
      const capability = this.expose(loaded.module, loaded.surface, loaded.release ?? noopRelease);
      const exports = Object.keys(loaded.module).filter((key) => key.length <= 256).sort();
      this.reply(frame.id, {
        kind: "ready",
        value: { abiVersion: 1, exports, root: capability.ref }
      });
    } catch (error) {
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
    } finally {
      this.active.end(frame.id);
    }
  }
  handleReady(frame) {
    const entry = this.pending.peek(frame.inReplyTo);
    if (entry !== void 0 && entry.kind !== "load" && !entry.cancelled) {
      this.fail({ code: "unexpected-frame", message: "ready received for a non-load call" });
      return;
    }
    const result = this.pending.settle(frame.inReplyTo, {
      kind: "handle",
      value: { abiVersion: 1, exports: frame.exports, root: frame.root }
    });
    if (result === "unknown") {
      this.fail({
        code: "unknown-reply-target",
        message: `ready for unknown load ${frame.inReplyTo}`
      });
    } else if (result === "duplicate") {
      this.fail({ code: "duplicate-reply", message: `duplicate ready for load ${frame.inReplyTo}` });
    } else if (result === "late-after-cancel") {
      this.report("x3.host/rpc-late-reply-dropped", `dropped late ready for cancelled load ${frame.inReplyTo}`);
      this.discardHandle(frame.root[HANDLE_MARKER].id);
    }
  }
  async handleCall(frame) {
    if (!this.table.owns(frame.handle)) {
      this.fail({
        code: "unknown-handle",
        message: `call on handle ${frame.handle} this side does not own`
      });
      return;
    }
    const lookup = this.table.lookup(frame.handle);
    if (lookup.state === "unknown" || lookup.state === "foreign-generation") {
      this.fail({
        code: lookup.state === "unknown" ? "unknown-handle" : "stale-generation",
        message: `call on ${lookup.state} handle ${frame.handle}`
      });
      return;
    }
    if (lookup.state === "released") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new ModkitError({
          code: "x3.host/rpc-released-handle",
          message: `handle ${frame.handle} was released`
        }), this.limits)
      });
      return;
    }
    const record = lookup.record;
    if (record.kind !== "lease" || record.contract === void 0 || record.major === void 0) {
      this.fail({
        code: "wrong-handle-kind",
        message: `call on ${record.kind} handle ${frame.handle}`
      });
      return;
    }
    const surface = this.surfaces.surfaceFor(record.contract, record.major);
    const decl = surface?.methods[frame.method];
    if (surface === void 0 || decl === void 0) {
      this.fail({
        code: "unknown-method",
        message: `no method \xAB${frame.method}\xBB on ${record.contract}@${record.major}`
      });
      return;
    }
    let args;
    try {
      args = this.decodeArgs(frame.args);
      const problem = decl.validateArgs?.(frame.args);
      if (problem !== void 0)
        throw new ModkitError({
          code: "x3.host/rpc-bad-argument",
          message: `${frame.method}: ${problem}`
        });
    } catch (error) {
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
      return;
    }
    const target = record.target;
    const fn = target[frame.method];
    if (typeof fn !== "function") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new ModkitError({
          code: "x3.host/rpc-method-unavailable",
          message: `target has no method \xAB${frame.method}\xBB`
        }), this.limits)
      });
      return;
    }
    let dynamicResult;
    if (decl.kind === "lease" && decl.resultFromArgs !== void 0) {
      const contract = readArgRef(args, decl.resultFromArgs.contract);
      const major = readArgRef(args, decl.resultFromArgs.major);
      if (typeof contract !== "string" || typeof major !== "number" || this.surfaces.surfaceFor(contract, major) === void 0) {
        this.reply(frame.id, {
          kind: "throw",
          error: toErrorDto(new ModkitError({
            code: "x3.host/rpc-bad-argument",
            message: `${frame.method}: arguments do not name a registered surface`
          }), this.limits)
        });
        return;
      }
      dynamicResult = { contract, major };
    }
    const active = this.active.begin(frame.id);
    if (decl.arity !== void 0)
      while (args.length < decl.arity)
        args.push(void 0);
    if (decl.signal === "last")
      args.push(active.controller.signal);
    else if (typeof decl.signal === "object") {
      this.placeInArg(args, decl.signal, active.controller.signal);
    }
    if (decl.progress !== void 0) {
      const callId = frame.id;
      this.placeInArg(args, decl.progress, (progress) => {
        const dto = normalizeProgress(progress);
        if (dto !== void 0 && this.state === "open")
          this.trySend({ t: "progress", inReplyTo: callId, progress: dto });
      });
    }
    let result;
    try {
      result = await Reflect.apply(fn, target, args);
    } catch (error) {
      this.active.end(frame.id);
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
      return;
    }
    this.active.end(frame.id);
    if (active.cancelled) {
      if (isLeaseLike(result))
        await result.release();
      else if (decl.kind !== "value" && isAsyncIterable(result)) {
        await result[Symbol.asyncIterator]().return?.();
      }
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new OperationCancelledError("cancelled by peer"), this.limits)
      });
      return;
    }
    switch (decl.kind) {
      case "value": {
        const checked = result === void 0 ? { ok: true } : validateWireValue(result, this.limits, "forbid");
        const problem = checked.ok ? decl.validateReturn?.(result) : checked.violation.message;
        if (problem !== void 0) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `${frame.method}: ${problem}`
            }), this.limits)
          });
          return;
        }
        this.reply(frame.id, { kind: "return", value: result });
        if (surface.releaseVia === frame.method)
          await this.releaseLocal(record.id);
        return;
      }
      case "leased-value": {
        const lease = isLeaseLike(result) ? result : void 0;
        const checked = lease === void 0 ? void 0 : lease.value === void 0 ? { ok: true } : validateWireValue(lease.value, this.limits, "forbid");
        const problem = lease === void 0 ? "did not return a lease" : checked !== void 0 && !checked.ok ? checked.violation.message : decl.validateReturn?.(lease.value);
        if (lease === void 0 || problem !== void 0) {
          if (lease !== void 0)
            await lease.release();
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `${frame.method}: ${problem ?? "did not return a lease"}`
            }), this.limits)
          });
          return;
        }
        try {
          const child = this.table.allocate({
            kind: "lease",
            target: {},
            release: () => lease.release(),
            parent: record.id
          });
          this.reply(frame.id, {
            kind: "return",
            value: lease.value,
            lease: handleRef(child.id, "lease")
          });
        } catch (error) {
          await lease.release();
          this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
        }
        return;
      }
      case "lease": {
        const lease = isLeaseLike(result) ? result : void 0;
        const value2 = lease === void 0 ? result : lease.value;
        const resultSurface = dynamicResult ?? decl.result;
        if (typeof value2 !== "object" || value2 === null || resultSurface === void 0) {
          if (lease !== void 0)
            await lease.release();
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `${frame.method} did not return a capability`
            }), this.limits)
          });
          return;
        }
        try {
          const data2 = this.fieldData(value2, resultSurface);
          const has = this.presentOptional(value2, resultSurface);
          const child = this.table.allocate({
            kind: "lease",
            target: value2,
            release: lease === void 0 ? noopRelease : () => lease.release(),
            contract: resultSurface.contract,
            major: resultSurface.major,
            parent: record.id
          });
          this.reply(frame.id, {
            kind: "handle",
            value: handleRef(child.id, "lease", resultSurface, data2, has)
          });
        } catch (error) {
          if (lease !== void 0)
            await lease.release();
          this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
        }
        return;
      }
      case "iterable":
      case "events": {
        if (!isAsyncIterable(result)) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `${frame.method} did not return an async iterable`
            }), this.limits)
          });
          return;
        }
        try {
          if (decl.kind === "iterable") {
            const iteratorTarget = {
              iterator: result[Symbol.asyncIterator](),
              busy: false
            };
            const child = this.table.allocate({
              kind: "iterator",
              target: iteratorTarget,
              release: () => iteratorTarget.iterator.return?.().then(() => void 0),
              parent: record.id
            });
            this.reply(frame.id, { kind: "handle", value: handleRef(child.id, "iterator") });
          } else {
            const eventsTarget = { iterable: result, stopped: false };
            const child = this.table.allocate({
              kind: "events",
              target: eventsTarget,
              release: () => {
                eventsTarget.stopped = true;
                if (eventsTarget.subscription !== void 0) {
                  const pump = this.pumps.get(eventsTarget.subscription);
                  this.pumps.delete(eventsTarget.subscription);
                  if (pump !== void 0) {
                    pump.stopped = true;
                    return pump.iterator?.return?.().then(() => void 0);
                  }
                }
                return void 0;
              },
              parent: record.id
            });
            this.reply(frame.id, { kind: "handle", value: handleRef(child.id, "events") });
          }
        } catch (error) {
          await result[Symbol.asyncIterator]().return?.();
          this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
        }
        return;
      }
    }
  }
  async handleNext(frame) {
    const lookup = this.lookupOwned(frame.handle, "iterator");
    if (lookup === void 0)
      return;
    if (lookup.state === "released") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new ModkitError({
          code: "x3.host/rpc-released-handle",
          message: `iterator ${frame.handle} was released`
        }), this.limits)
      });
      return;
    }
    const target = lookup.record.target;
    if (target.busy) {
      this.fail({ code: "iterator-busy", message: `concurrent next on iterator ${frame.handle}` });
      return;
    }
    if (target.exhausted === true) {
      this.send({ t: "done", inReplyTo: frame.id, handle: frame.handle });
      await this.releaseLocal(frame.handle);
      return;
    }
    target.busy = true;
    const active = this.active.begin(frame.id);
    active.controller.signal.addEventListener("abort", () => void target.iterator.return?.(), {
      once: true
    });
    const max = frame.max ?? 1;
    try {
      const items = [];
      let ended = false;
      while (items.length < max) {
        const step = await target.iterator.next();
        if (active.cancelled) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new OperationCancelledError("cancelled by peer"), this.limits)
          });
          await this.releaseLocal(frame.handle);
          return;
        }
        if (step.done === true) {
          ended = true;
          break;
        }
        const checked = validateWireValue(step.value, this.limits, "forbid");
        if (!checked.ok) {
          this.reply(frame.id, {
            kind: "throw",
            error: toErrorDto(new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `iterator item rejected: ${checked.violation.message}`
            }), this.limits)
          });
          await this.releaseLocal(frame.handle);
          return;
        }
        items.push(step.value);
      }
      if (items.length === 0) {
        this.send({ t: "done", inReplyTo: frame.id, handle: frame.handle });
        await this.releaseLocal(frame.handle);
        return;
      }
      if (ended)
        target.exhausted = true;
      this.reply(frame.id, {
        kind: "return",
        value: frame.max === void 0 ? items[0] : items
      });
    } catch (error) {
      this.reply(frame.id, { kind: "throw", error: toErrorDto(error, this.limits) });
      await this.releaseLocal(frame.handle);
    } finally {
      target.busy = false;
      this.active.end(frame.id);
    }
  }
  lookupOwned(handle, kind) {
    if (!this.table.owns(handle)) {
      this.fail({
        code: "unknown-handle",
        message: `${kind} handle ${handle} is not owned by this side`
      });
      return void 0;
    }
    const lookup = this.table.lookup(handle);
    if (lookup.state === "unknown" || lookup.state === "foreign-generation") {
      this.fail({
        code: lookup.state === "unknown" ? "unknown-handle" : "stale-generation",
        message: `${kind} handle ${handle} is ${lookup.state}`
      });
      return void 0;
    }
    if (lookup.state === "released")
      return { state: "released" };
    if (lookup.record.kind !== kind) {
      this.fail({
        code: "wrong-handle-kind",
        message: `handle ${handle} is a ${lookup.record.kind}, expected ${kind}`
      });
      return void 0;
    }
    return { state: "live", record: lookup.record };
  }
  async handleSubscribe(frame) {
    const lookup = this.lookupOwned(frame.handle, "events");
    if (lookup === void 0)
      return;
    if (lookup.state === "released") {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new ModkitError({
          code: "x3.host/rpc-released-handle",
          message: `events ${frame.handle} was released`
        }), this.limits)
      });
      return;
    }
    const target = lookup.record.target;
    if (target.subscription !== void 0) {
      this.reply(frame.id, {
        kind: "throw",
        error: toErrorDto(new ModkitError({
          code: "x3.host/rpc-already-subscribed",
          message: `events ${frame.handle} already has a subscriber`
        }), this.limits)
      });
      return;
    }
    this.pumpSequence += 1;
    const subscription = `${this.ownerPrefix}s${this.generation}-${this.pumpSequence}`;
    target.subscription = subscription;
    const pump = { handle: frame.handle, stopped: false };
    this.pumps.set(subscription, pump);
    this.reply(frame.id, { kind: "return", value: subscription });
    void (async () => {
      try {
        pump.iterator = target.iterable[Symbol.asyncIterator]();
        for (; ; ) {
          const step = await pump.iterator.next();
          if (pump.stopped || this.state !== "open")
            return;
          if (step.done === true)
            break;
          const checked = validateWireValue(step.value, this.limits, "forbid");
          if (!checked.ok) {
            throw new ModkitError({
              code: "x3.host/rpc-bad-return",
              message: `event rejected: ${checked.violation.message}`
            });
          }
          this.send({ t: "event", subscription, value: step.value });
        }
        if (this.state === "open")
          this.send({ t: "done", handle: frame.handle });
      } catch (error) {
        if (!pump.stopped && this.state === "open") {
          this.trySend({ t: "done", handle: frame.handle, error: toErrorDto(error, this.limits) });
        }
      } finally {
        this.pumps.delete(subscription);
        await this.releaseLocal(frame.handle);
      }
    })();
  }
  handleEvent(frame) {
    const result = this.subscriptions.push(frame.subscription, frame.value);
    if (result === "queued")
      return;
    if (result === "unknown") {
      this.droppedEvents += 1;
      return;
    }
    this.trySend({ t: "unsubscribe", subscription: frame.subscription });
    this.closeSubscription(frame.subscription, new ModkitError({
      code: "x3.host/rpc-events-overflow",
      message: `event queue for ${frame.subscription} exceeded ${this.limits.maxQueuedEvents}`,
      retryability: "conditional"
    }));
  }
  handleDone(frame) {
    if (frame.inReplyTo !== void 0) {
      const entry = this.pending.peek(frame.inReplyTo);
      if (entry !== void 0 && entry.kind !== "next" && !entry.cancelled) {
        this.fail({ code: "unexpected-frame", message: "done received for a non-iterator call" });
        return;
      }
      this.handleSettle(frame.inReplyTo, { kind: "done" });
      this.markRemoteReleased(frame.handle);
      return;
    }
    const error = frame.error === void 0 ? void 0 : fromErrorDto(frame.error);
    for (const [id, record] of this.subscriptions.entries()) {
      if (record.handle === frame.handle)
        this.closeSubscription(id, error);
    }
    this.markRemoteReleased(frame.handle);
  }
  /** Puts a host-created value (signal, progress emitter) at a declared key of an object argument. */
  placeInArg(args, ref, value2) {
    while (args.length <= ref.arg)
      args.push(void 0);
    const holder = args[ref.arg];
    const base = typeof holder === "object" && holder !== null ? holder : {};
    args[ref.arg] = { ...base, [ref.key]: value2 };
  }
  /**
   * Copies the data properties a surface declares (`fields`) off a capability object; each must
   * be a bounded wire value without handles. Absent properties are skipped; an invalid one is a
   * bad return on the executing side (thrown as `x3.host/rpc-bad-return`).
   */
  /**
   * Protocol 1.1 `has`: which of the surface's optional methods the object implements. Undefined
   * when the surface declares none (nothing to say), so refs of such surfaces stay byte-identical
   * to protocol 1.0.
   */
  presentOptional(target, surface) {
    const methods = this.surfaces.surfaceFor(surface.contract, surface.major)?.methods;
    if (methods === void 0)
      return void 0;
    const optional = Object.entries(methods).filter(([, method]) => method.optional === true).map(([name]) => name);
    if (optional.length === 0)
      return void 0;
    if (typeof target !== "object" || target === null)
      return Object.freeze([]);
    return Object.freeze(optional.filter((name) => typeof target[name] === "function"));
  }
  fieldData(target, surface) {
    const fields = this.surfaces.surfaceFor(surface.contract, surface.major)?.fields;
    if (fields === void 0 || fields.length === 0)
      return void 0;
    if (typeof target !== "object" || target === null)
      return void 0;
    const data2 = {};
    for (const field of fields) {
      const value2 = target[field];
      if (value2 === void 0)
        continue;
      const checked = validateWireValue(value2, this.limits, "forbid");
      if (!checked.ok) {
        throw new ModkitError({
          code: "x3.host/rpc-bad-return",
          message: `field \xAB${field}\xBB of ${surface.contract}@${surface.major} is not a wire value: ${checked.violation.message}`
        });
      }
      data2[field] = value2;
    }
    return Object.keys(data2).length === 0 ? void 0 : Object.freeze(data2);
  }
  async handleRelease(frame) {
    if (!this.table.owns(frame.handle)) {
      this.fail({
        code: "unknown-handle",
        message: `release of handle ${frame.handle} this side does not own`
      });
      return;
    }
    const lookup = this.table.lookup(frame.handle);
    if (lookup.state === "unknown" || lookup.state === "foreign-generation") {
      this.fail({
        code: lookup.state === "unknown" ? "unknown-handle" : "stale-generation",
        message: `release of ${lookup.state} handle ${frame.handle}`
      });
      return;
    }
    const result = await this.table.release(frame.handle);
    for (const failure of result.failures) {
      this.report("x3.host/rpc-release-failed", `release of ${frame.handle} failed: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
    this.reply(frame.id, { kind: "return", value: { released: result.released } });
  }
};
function createEndpoint(options) {
  return new EndpointImpl(options);
}

// packages/host/dist/execution/frame-json.js
var LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// packages/host/dist/execution/abi-surfaces.js
var ABI_CODEC_MODULE = { contract: "x3.abi/codec-module", major: 1 };
var ABI_SERVICE_PROVIDER_MODULE = {
  contract: "x3.abi/service-provider-module",
  major: 1
};
var ABI_CODEC = { contract: "x3.abi/codec", major: 1 };
var ABI_ASSET_SESSION = { contract: "x3.abi/asset-session", major: 1 };
var ABI_OPERATION_SESSION = { contract: "x3.abi/operation-session", major: 1 };
var ABI_ARTIFACT_SOURCE = { contract: "x3.abi/artifact-source", major: 1 };
var ABI_ASSET_NAMESPACE = { contract: "x3.abi/asset-namespace", major: 1 };
var ABI_ASSET_INPUT = { contract: "x3.abi/asset-input", major: 1 };
var ABI_DIAGNOSTIC_SINK = { contract: "x3.abi/diagnostic-sink", major: 1 };
var ABI_CONTRACT_RESOLVER = { contract: "x3.abi/contract-resolver", major: 1 };
var sig = { signal: "last" };
var codecModuleSurface = {
  ...ABI_CODEC_MODULE,
  fields: ["abiVersion"],
  methods: {
    /** `createCodec(context)` — the backend marshals `context` (budgets copied, ports as refs). */
    createCodec: { kind: "lease", result: ABI_CODEC, wrapper: "bare" }
  }
};
var serviceProviderModuleSurface = {
  ...ABI_SERVICE_PROVIDER_MODULE,
  fields: ["abiVersion", "provides"],
  methods: {
    /**
     * `createProvider(selection, context)` — the leased provider's surface is the one the
     * selection names (its contract definition's `surface`); `context` is marshalled like
     * `createCodec`'s. Returns a `Lease`: releasing the handle releases the provider.
     */
    createProvider: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } }
    }
  }
};
var codecSurface = {
  ...ABI_CODEC,
  methods: {
    probe: { kind: "value", ...sig },
    planInput: { kind: "value", optional: true, ...sig },
    open: { kind: "lease", result: ABI_ASSET_SESSION, wrapper: "bare", ...sig }
  }
};
var assetSessionSurface = {
  ...ABI_ASSET_SESSION,
  fields: ["revision"],
  releaseVia: "dispose",
  methods: {
    state: { kind: "value" },
    descriptor: { kind: "value" },
    /** `dataSource(contract, major)` — the leased surface is named by the arguments. */
    dataSource: {
      kind: "lease",
      resultFromArgs: { contract: 0, major: 1 },
      wrapper: "lease"
    },
    operations: { kind: "lease", result: ABI_OPERATION_SESSION, wrapper: "bare" },
    events: { kind: "events", ...sig },
    dispose: { kind: "value" }
  }
};
var operationSessionSurface = {
  ...ABI_OPERATION_SESSION,
  releaseVia: "dispose",
  methods: {
    invoke: {
      kind: "value",
      signal: { arg: 2, key: "signal" },
      progress: { arg: 2, key: "onProgress" }
    },
    dispose: { kind: "value" }
  }
};
var artifactSourceSurface = {
  ...ABI_ARTIFACT_SOURCE,
  fields: ["ref", "revision", "kind", "size"],
  methods: {
    read: { kind: "value", optional: true, ...sig },
    stream: { kind: "iterable", optional: true, ...sig },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var assetNamespaceSurface = {
  ...ABI_ASSET_NAMESPACE,
  methods: {
    list: { kind: "iterable", ...sig },
    open: { kind: "lease", result: ABI_ARTIFACT_SOURCE, wrapper: "lease", ...sig }
  }
};
var assetInputSurface = {
  ...ABI_ASSET_INPUT,
  // topology data as fields: physical bindings, the namespace/derived discriminants, the derived
  // subject list and its optional materialized requirement/recipe
  fields: [
    "originKind",
    "root",
    "bindings",
    "revisions",
    "primaryBindingId",
    "subjects",
    "recipe",
    "materialized"
  ],
  methods: {
    openBinding: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    // derived inputs: open one input subject as a session, or the optional materialized artifact
    openSubject: {
      kind: "lease",
      result: ABI_ASSET_SESSION,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openMaterialized: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var contractResolverSurface = {
  ...ABI_CONTRACT_RESOLVER,
  methods: {
    resolve: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    },
    resolveUnknown: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    }
  }
};
var diagnosticSinkSurface = {
  ...ABI_DIAGNOSTIC_SINK,
  methods: {
    report: { kind: "value" }
  }
};
var RUNTIME_ABI_SURFACES = Object.freeze([
  codecModuleSurface,
  serviceProviderModuleSurface,
  codecSurface,
  assetSessionSurface,
  operationSessionSurface,
  artifactSourceSurface,
  assetNamespaceSurface,
  assetInputSurface,
  diagnosticSinkSurface,
  contractResolverSurface
]);

// packages/sdk/dist/schemas/patterns.js
var DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var NAMESPACED_DOTTED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var OPERATION_PATTERN = "^(?:[a-z0-9]+(?:-[a-z0-9]+)*\\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*|[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\.[a-z0-9]+(?:-[a-z0-9]+)*)$";
var QUALIFIED_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*\\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)*$";
var SEGMENT_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
var SEMVER_PATTERN = "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";
var RANGE_NUMBER = "(?:0|[1-9]\\d*)";
var RANGE_NUMERIC = `${RANGE_NUMBER}(?:\\.${RANGE_NUMBER}){0,2}`;
var RANGE_EXACT = `=?${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.${RANGE_NUMBER}`;
var RANGE_WILDCARD = `(?:${RANGE_NUMBER}\\.(?:x|\\*)|${RANGE_NUMBER}\\.${RANGE_NUMBER}\\.(?:x|\\*))`;
var RANGE_CARET = `\\^${RANGE_NUMBER}\\.${RANGE_NUMBER}(?:\\.${RANGE_NUMBER})?`;
var RANGE_COMPARATOR = `[<>]=?${RANGE_NUMERIC}`;
var RANGE_ATOM = `(?:${RANGE_EXACT}|${RANGE_WILDCARD}|${RANGE_CARET}|${RANGE_COMPARATOR})`;
var VERSION_RANGE_PATTERN = `^(?:\\*|x|${RANGE_ATOM}(?: ${RANGE_ATOM})*)$`;
var RELATIVE_ENTRYPOINT_PATTERN = "^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!/)(?!\\\\)(?:(?!\\.\\.(?:/|$))[^\\\\/\\u0000-\\u001f]+/)*(?!\\.\\.$)[^\\\\/\\u0000-\\u001f]+$";
var METHOD_NAME_PATTERN = "^[a-z][a-zA-Z0-9]{0,63}$";

// packages/sdk/dist/schemas/extension-manifest.js
var REQUIREMENT_SCOPE_KINDS = Object.freeze([
  "contribution",
  "offer",
  "operation",
  "intent",
  "variant",
  "profile",
  "projection",
  "slot"
]);
var requirementScopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id"],
  properties: {
    kind: { enum: REQUIREMENT_SCOPE_KINDS },
    id: { type: "string", minLength: 1 }
  }
};
var extensionRequirementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/extension-requirement.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["extension", "mode", "scope"],
  properties: {
    extension: { type: "string", pattern: QUALIFIED_PATTERN },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ["required", "default", "suggested", "integrates"] },
    scope: requirementScopeSchema
  }
};
var contributionManifestsSchema = {
  type: "array",
  items: { type: "string", minLength: 1 }
};
var extensionManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/extension-manifest.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "publisher", "id", "version", "license", "contributionManifests"],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: "string", pattern: DOTTED_PATTERN },
    id: { type: "string", pattern: DOTTED_PATTERN },
    version: { type: "string", pattern: SEMVER_PATTERN },
    license: { type: "string", minLength: 1 },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: "array", items: extensionRequirementSchema }
  }
};
var modkitBlockSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/extension-manifest-modkit-block.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "publisher", "id", "contributionManifests"],
  properties: {
    schemaVersion: { const: 1 },
    publisher: { type: "string", pattern: DOTTED_PATTERN },
    id: { type: "string", pattern: DOTTED_PATTERN },
    contributionManifests: contributionManifestsSchema,
    dependsOn: { type: "array", items: extensionRequirementSchema }
  }
};
deepFreeze(requirementScopeSchema);
deepFreeze(extensionRequirementSchema);
deepFreeze(extensionManifestSchema);
deepFreeze(modkitBlockSchema);

// packages/sdk/dist/schemas/contribution-manifest.js
var EXECUTION_PROFILES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var PERMISSION_CLASSES = Object.freeze([
  "read-source",
  "write-source",
  "filesystem-read",
  "filesystem-write",
  "network",
  "process-launch",
  "native-code",
  "credentials",
  "clipboard",
  "persistent-storage"
]);
var RUNTIME_ENVIRONMENTS = Object.freeze([
  "browser-main",
  "browser-worker",
  "node",
  "node-worker",
  "wasm",
  "native",
  "external-tool"
]);
var OPERATING_SYSTEMS = Object.freeze([
  "any",
  "windows",
  "linux",
  "darwin",
  "android",
  "ios"
]);
var ARCHITECTURES = Object.freeze([
  "any",
  "x86",
  "x64",
  "arm32",
  "arm64",
  "wasm32"
]);
var runtimeTargetConstraintSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    environments: { type: "array", items: { enum: RUNTIME_ENVIRONMENTS }, minItems: 1 },
    operatingSystems: { type: "array", items: { enum: OPERATING_SYSTEMS }, minItems: 1 },
    architectures: { type: "array", items: { enum: ARCHITECTURES }, minItems: 1 },
    requiredHostCapabilities: { type: "array", items: { type: "string", minLength: 1 } },
    requiredWebApis: { type: "array", items: { type: "string", minLength: 1 } },
    externalTools: { type: "array", items: { type: "string", minLength: 1 } }
  }
};
var runtimeVariantDeclarationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/runtime-variant-declaration.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["variantId", "entrypoint", "target", "executionProfile", "requestedPermissionClasses"],
  properties: {
    variantId: { type: "string", pattern: SEGMENT_PATTERN },
    // Containment is enforced twice: here (authoring gate) and again by the host before
    // any import (MK3/24 §8) — the host never trusts that someone validated the input.
    entrypoint: { type: "string", pattern: RELATIVE_ENTRYPOINT_PATTERN },
    target: runtimeTargetConstraintSchema,
    executionProfile: { enum: EXECUTION_PROFILES },
    requestedPermissionClasses: { type: "array", items: { enum: PERMISSION_CLASSES } }
  }
};
var scopedContractRequirementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/scoped-contract-requirement.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["contract", "major", "mode", "scope"],
  properties: {
    contract: { type: "string", pattern: QUALIFIED_PATTERN },
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN },
    mode: { enum: ["required", "default", "suggested", "integrates"] },
    scope: requirementScopeSchema
  }
};
var contributionManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/contribution-manifest.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "contract", "id", "displayName", "spec"],
  properties: {
    schemaVersion: { const: 1 },
    contract: {
      type: "object",
      additionalProperties: false,
      required: ["id", "major"],
      properties: {
        id: { type: "string", pattern: QUALIFIED_PATTERN },
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    id: { type: "string", pattern: QUALIFIED_PATTERN },
    displayName: { type: "string", minLength: 1 },
    status: { enum: ["supported", "partial", "unsupported", "experimental"] },
    runtimeVariants: { type: "array", items: runtimeVariantDeclarationSchema },
    dependsOn: { type: "array", items: scopedContractRequirementSchema },
    limitations: { type: "array", items: { type: "string", minLength: 1 } },
    spec: { title: "JsonValue" }
  }
};
deepFreeze(runtimeTargetConstraintSchema);
deepFreeze(runtimeVariantDeclarationSchema);
deepFreeze(scopedContractRequirementSchema);
deepFreeze(contributionManifestSchema);

// packages/sdk/dist/asset-capabilities/data-source-ids.js
var STANDARD_DATA_SOURCE_CONTRACTS = Object.freeze([
  "common.view/text-data-source",
  "common.view/byte-range-source",
  "common.view/tree-data-source",
  "common.view/table-data-source",
  "common.view/transport-source",
  "common.view/namespace-entry-source",
  "common.view/raster-image-source",
  "common.view/vector-scene-source",
  "common.view/audio-media-source",
  "common.view/video-media-source",
  "common.view/model-scene-source",
  // optional model facets beside the base scene source (block 11, slice 11C0, plan item 11)
  "common.view/model-resource-refs-source",
  "common.view/model-skeleton-source",
  "common.view/model-animation-source",
  "common.view/model-collision-source",
  "common.view/model-material-source",
  "common.view/relation-graph-source",
  "common.view/subject-facts-source",
  "common.view/slide-deck-source"
]);
var DATA_SOURCE_MATURITY = Object.freeze({
  "common.view/text-data-source": "admitted",
  "common.view/byte-range-source": "admitted",
  "common.view/tree-data-source": "admitted",
  "common.view/table-data-source": "admitted",
  "common.view/transport-source": "admitted",
  "common.view/namespace-entry-source": "admitted",
  "common.view/raster-image-source": "admitted",
  "common.view/vector-scene-source": "admitted",
  "common.view/audio-media-source": "admitted",
  "common.view/video-media-source": "admitted",
  "common.view/model-scene-source": "admitted",
  "common.view/model-resource-refs-source": "admitted",
  "common.view/model-skeleton-source": "publisher-candidate",
  "common.view/model-animation-source": "admitted",
  "common.view/model-collision-source": "admitted",
  "common.view/model-material-source": "admitted",
  "common.view/relation-graph-source": "admitted",
  "common.view/subject-facts-source": "admitted",
  "common.view/slide-deck-source": "publisher-candidate"
});
var ADMITTED_DATA_SOURCE_CONTRACTS = Object.freeze(STANDARD_DATA_SOURCE_CONTRACTS.filter((contract) => DATA_SOURCE_MATURITY[contract] === "admitted"));

// packages/sdk/dist/schemas/contribution-specs.js
var nonEmptyString = { type: "string", minLength: 1 };
var qualifiedId = { type: "string", pattern: QUALIFIED_PATTERN };
var namespacedDottedId = { type: "string", pattern: NAMESPACED_DOTTED_PATTERN };
var operationId2 = { type: "string", pattern: OPERATION_PATTERN };
var decimalU64 = { type: "string", pattern: UINT64_DECIMAL_PATTERN };
var jsonSchemaRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["$ref"],
  properties: { $ref: nonEmptyString }
};
var resourceBudgetWireSchema = {
  type: "object",
  additionalProperties: false,
  required: ["maxInputBytes", "maxDepth", "maxNodes", "maxScalarBytes", "maxDiagnostics"],
  properties: {
    maxInputBytes: decimalU64,
    maxDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxNodes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxScalarBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxDiagnostics: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    deadlineMs: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var dataSourceRefWireSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["contract", "major"],
      properties: {
        contract: { enum: STANDARD_DATA_SOURCE_CONTRACTS },
        major: { const: 1 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["contract", "major", "opaque"],
      properties: {
        contract: { ...qualifiedId, not: { enum: STANDARD_DATA_SOURCE_CONTRACTS } },
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        opaque: { const: true }
      }
    }
  ]
};
var contractRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major"],
  properties: {
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    range: { type: "string", pattern: VERSION_RANGE_PATTERN }
  }
};
var formatRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatId", "label"],
  properties: {
    formatId: nonEmptyString,
    label: nonEmptyString,
    mediaType: nonEmptyString
  }
};
var signatureRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "offset", "bytesHex"],
  properties: {
    from: { enum: ["start", "end"] },
    offset: { type: "integer", minimum: 0, maximum: 4096 },
    bytesHex: { type: "string", pattern: "^(?:[0-9a-f]{2}){1,64}$" },
    maskHex: { type: "string", pattern: "^(?:[0-9a-f]{2}){1,64}$" }
  }
};
var matchRulesSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extensions: { type: "array", items: nonEmptyString },
    mediaTypes: { type: "array", items: nonEmptyString },
    pathGlobs: { type: "array", items: nonEmptyString },
    signatures: { type: "array", items: signatureRuleSchema, maxItems: 8 }
  }
};
var probePlanSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "ranges", "maxBytes"],
      properties: {
        kind: { const: "bytes" },
        ranges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "length"],
            properties: {
              from: { enum: ["start", "end"] },
              length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
            }
          }
        },
        maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "markers", "maxEntries", "maxBytes", "maxDepth", "maxPathBytes"],
      properties: {
        kind: { const: "namespace" },
        markers: {
          type: "array",
          items: nonEmptyString,
          minItems: 1,
          maxItems: 256,
          uniqueItems: true
        },
        prefixes: { type: "array", items: nonEmptyString },
        maxEntries: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxPathBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "maxSubjects", "maxRelationDepth"],
      properties: {
        kind: { const: "derived" },
        maxSubjects: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maxRelationDepth: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
      }
    }
  ]
};
var traitDefinitionRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: namespacedDottedId,
    definitionRange: { type: "string", pattern: VERSION_RANGE_PATTERN }
  }
};
var traitQueryRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    ...traitDefinitionRequirementSchema.properties,
    states: {
      type: "array",
      items: { enum: ["available", "partial", "disabled", "dependency-required"] },
      minItems: 1,
      uniqueItems: true
    }
  }
};
var companionRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "required", "patterns", "searchScopes"],
  properties: {
    id: { type: "string", pattern: SEGMENT_PATTERN },
    role: nonEmptyString,
    required: { type: "boolean" },
    patterns: { type: "array", items: nonEmptyString, minItems: 1 },
    expected: {
      type: "object",
      additionalProperties: false,
      properties: {
        all: { type: "array", items: traitQueryRequirementSchema },
        any: { type: "array", items: traitQueryRequirementSchema },
        none: { type: "array", items: traitQueryRequirementSchema }
      }
    },
    searchScopes: {
      type: "array",
      minItems: 1,
      items: {
        enum: [
          "sibling-directory",
          "current-mount",
          "enclosing-container",
          "workspace-dependency-layer",
          "explicit-user-selection"
        ]
      }
    }
  }
};
var representationDeclSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "contract", "major", "stage", "lossy"],
  properties: {
    id: nonEmptyString,
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    stage: { enum: ["authored", "compiled", "runtime"] },
    lossy: { type: "boolean" }
  }
};
var operationDeclSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "handlerId", "mutatesSource"],
  properties: {
    id: operationId2,
    handlerId: nonEmptyString,
    mutatesSource: { type: "boolean" },
    requiredPermissions: { type: "array", items: { enum: PERMISSION_CLASSES } },
    requiresContract: contractRequirementSchema,
    inputSchema: jsonSchemaRefSchema,
    outputKinds: {
      type: "array",
      items: {
        enum: ["json", "bytes", "stream", "source", "artifact", "none", "edit-plan", "transaction"]
      }
    }
  }
};
var traitDeclarationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "representation", "presence"],
  properties: {
    id: namespacedDottedId,
    definitionVersion: { type: "string", pattern: SEMVER_PATTERN },
    representation: { enum: ["source", "compiled", "runtime"] },
    presence: { enum: ["may-expose", "will-expose"] },
    prerequisites: { type: "array", items: contractRequirementSchema },
    evidenceRefs: { type: "array", items: nonEmptyString, uniqueItems: true }
  }
};
var fidelityNotesSchema = { type: "array", items: nonEmptyString };
var fidelityClaimSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { const: "byte-identical" },
        preservesUnknownData: { const: true },
        notes: fidelityNotesSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { const: "semantic" },
        preservesUnknownData: { type: "boolean" },
        notes: fidelityNotesSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["roundTrip", "preservesUnknownData"],
      properties: {
        roundTrip: { enum: ["lossy", "none"] },
        preservesUnknownData: { const: false },
        notes: fidelityNotesSchema
      }
    }
  ]
};
var codecFidelityEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "formatId",
    "representationId",
    "claim",
    "evidenceId",
    "corpusId",
    "corpusDigest",
    "conformanceProfile",
    "optionsFingerprint",
    "inputClass",
    "provenAt"
  ],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    claim: fidelityClaimSchema,
    evidenceId: nonEmptyString,
    corpusId: nonEmptyString,
    corpusDigest: nonEmptyString,
    conformanceProfile: qualifiedId,
    optionsFingerprint: nonEmptyString,
    inputClass: nonEmptyString,
    provenAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$"
    }
  }
};
var codecContributionRequired = [
  "formatRefs",
  "roles",
  "sourceTopology",
  "artifactStages",
  "openIntents",
  "match",
  "probe",
  "representations",
  "publishesDataSources",
  "operations",
  "implementationTier",
  "budgets"
];
var codecContributionProperties = {
  formatRefs: { type: "array", items: formatRefSchema, minItems: 1 },
  roles: {
    type: "array",
    items: { enum: ["container", "media", "byte-transform", "semantic", "index", "sidecar"] },
    minItems: 1
  },
  artifactStages: {
    type: "array",
    items: { enum: ["authored", "compiled", "runtime"] },
    minItems: 1
  },
  openIntents: {
    type: "array",
    items: { enum: ["probe", "inspect", "thumbnail", "full", "stream", "export"] },
    minItems: 1
  },
  match: matchRulesSchema,
  companions: { type: "array", items: companionRuleSchema },
  representations: { type: "array", items: representationDeclSchema, minItems: 1 },
  publishesDataSources: { type: "array", items: dataSourceRefWireSchema },
  requires: { type: "array", items: contractRequirementSchema },
  operations: { type: "array", items: operationDeclSchema },
  traitDeclarations: { type: "array", items: traitDeclarationSchema },
  fidelityEvidence: { type: "array", items: codecFidelityEvidenceSchema },
  implementationTier: {
    type: "object",
    additionalProperties: false,
    required: ["claimed"],
    properties: { claimed: { enum: [1, 2, 3, 4, 5] } }
  },
  budgets: resourceBudgetWireSchema
};
var codecContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/codec-contribution-spec.v1.schema.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { enum: ["single", "bundle"] },
        probe: probePlanSchema.oneOf[0]
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: "namespace" },
        probe: probePlanSchema.oneOf[1]
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: codecContributionRequired,
      properties: {
        ...codecContributionProperties,
        sourceTopology: { const: "derived" },
        probe: probePlanSchema.oneOf[2]
      }
    }
  ]
};
var serviceContractOfferDeclarationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["offerId", "contract", "major", "version"],
  properties: {
    offerId: { type: "string", pattern: SEGMENT_PATTERN },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    version: { type: "string", pattern: SEMVER_PATTERN },
    facet: { title: "JsonValue" }
  }
};
var serviceProviderContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/service-provider-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["provides", "lifecycleScope"],
  properties: {
    provides: { type: "array", items: serviceContractOfferDeclarationSchema, minItems: 1 },
    requires: { type: "array", items: contractRequirementSchema },
    inputs: { type: "array", items: nonEmptyString },
    outputs: { type: "array", items: traitDeclarationSchema },
    protocolOperations: { type: "array", items: nonEmptyString },
    replacement: {
      type: "object",
      additionalProperties: false,
      required: ["target", "compatible"],
      properties: { target: contractRequirementSchema, compatible: { type: "boolean" } }
    },
    lifecycleScope: { enum: ["session", "operation", "process"] },
    applicableVariants: { type: "array", items: { type: "string", pattern: SEGMENT_PATTERN } }
  }
};
var traitRequirementSchema = traitQueryRequirementSchema;
var viewerApplicabilitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: { enum: ["none", "codec", "any"] },
    sourceBytes: {
      type: "object",
      additionalProperties: false,
      properties: { maximum: decimalU64 }
    },
    longestLineBytes: {
      type: "object",
      additionalProperties: false,
      required: ["maximum", "whenUnknown"],
      properties: {
        maximum: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        whenUnknown: { enum: ["eligible", "ineligible"] }
      }
    }
  }
};
var viewerContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/viewer-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["kind", "consumesDataSources", "priority"],
  properties: {
    kind: { enum: ["stage", "tree", "panel", "toolbar", "transport", "status", "fallback"] },
    requiresTraits: { type: "array", items: traitRequirementSchema },
    requiresOperations: { type: "array", items: operationId2 },
    consumesDataSources: { type: "array", items: dataSourceRefWireSchema },
    /*
     * Sources a viewer reads when the subject publishes them and does without when it does not.
     *
     * Kept apart from `consumesDataSources` because that list decides eligibility: a facet named
     * there would cost the stage every subject that publishes none of them, which is the opposite
     * of optional. Naming them separately is what lets one generic viewer consume the optional
     * model facets instead of splitting into a contribution per facet combination.
     */
    optionalDataSources: { type: "array", items: dataSourceRefWireSchema },
    applicability: viewerApplicabilitySchema,
    hosts: { type: "array", items: nonEmptyString },
    priority: { type: "number" },
    conflicts: { type: "array", items: nonEmptyString },
    singletonGroup: nonEmptyString
  }
};
var writerRequirementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatId", "representationId", "mutationMode", "minimumRoundTrip"],
  properties: {
    formatId: nonEmptyString,
    representationId: nonEmptyString,
    mutationMode: { enum: ["export-only", "mutate"] },
    minimumRoundTrip: { enum: ["byte-identical", "semantic", "lossy", "none"] }
  }
};
var writerRequirementV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/writer-requirement.v1.schema.json",
  ...writerRequirementSchema
};
var writerOfferV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/writer-offer.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [...writerRequirementSchema.required, "providerId", "fidelityEvidenceId"],
  properties: {
    ...writerRequirementSchema.properties,
    providerId: nonEmptyString,
    fidelityEvidenceId: nonEmptyString
  }
};
var editorContributionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/editor-contribution-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "sessionModel",
    "selectionKinds",
    "semanticLocationKinds",
    "requiresTransactions",
    "requiresOperations",
    "consumesDataSources",
    "writer",
    "priority"
  ],
  properties: {
    sessionModel: { enum: ["single-subject", "multi-subject", "workspace"] },
    selectionKinds: { type: "array", items: nonEmptyString, uniqueItems: true },
    semanticLocationKinds: { type: "array", items: nonEmptyString, uniqueItems: true },
    requiresTransactions: { type: "boolean" },
    requiresOperations: { type: "array", items: operationId2, uniqueItems: true },
    consumesDataSources: { type: "array", items: dataSourceRefWireSchema, uniqueItems: true },
    writer: writerRequirementSchema,
    hosts: { type: "array", items: nonEmptyString, uniqueItems: true },
    priority: { type: "number" },
    scaleLimits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maximumSubjects: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumRows: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        maximumSourceBytes: decimalU64
      }
    }
  }
};
var traitDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/trait-definition-spec.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "version", "scope", "parametersSchema", "transport"],
  properties: {
    schemaVersion: { const: 1 },
    id: namespacedDottedId,
    version: { type: "string", pattern: SEMVER_PATTERN },
    scope: {
      anyOf: [
        {
          enum: [
            "source",
            "asset",
            "subject",
            "workspace",
            "service",
            "operation",
            "view-session",
            "representation"
          ]
        },
        { type: "string", pattern: QUALIFIED_PATTERN }
      ]
    },
    parametersSchema: jsonSchemaRefSchema,
    transport: { enum: ["json", "structured-clone"] },
    documentation: nonEmptyString,
    imports: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "range"],
        properties: {
          id: namespacedDottedId,
          range: { type: "string", pattern: VERSION_RANGE_PATTERN }
        }
      }
    }
  }
};
var methodName = { type: "string", pattern: METHOD_NAME_PATTERN };
var dataSourceSurfaceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "major"],
  properties: {
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var dataSourceMethodLimitsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxPageItems: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    maxBytes: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    maxStringLength: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
  }
};
var argKeyRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["arg", "key"],
  properties: {
    arg: { type: "integer", minimum: 0, maximum: 16 },
    key: methodName
  }
};
var dataSourceMethodSurfaceCommon = {
  /**
   * Where the executing side places the `AbortSignal`: appended last, nowhere, or as a key of an
   * object argument (the consumer strips that key before sending, the executor re-creates it).
   */
  signal: { anyOf: [{ enum: ["last", "none"] }, argKeyRefSchema] },
  /** Where a progress callback lives inside an object argument (`invoke(…, { onProgress })`). */
  progress: argKeyRefSchema,
  /**
   * Positional argument count before the signal. The executing side pads omitted trailing
   * arguments with `undefined` up to `arity` before appending the signal, so
   * `encoded(trackId?, signal?)` called as `encoded()` still receives its signal last.
   */
  arity: { type: "integer", minimum: 0, maximum: 16 },
  /** The ABI declares the method with `?`; an implementation may lack it. */
  optional: { type: "boolean" },
  limits: dataSourceMethodLimitsSchema
};
var dataSourceMethodSurfaceV1Schema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "result"],
      properties: {
        kind: { const: "lease" },
        result: dataSourceSurfaceRefSchema,
        /** `'lease'` materializes `{ value, release }`; `'bare'` (default) the capability object itself. */
        wrapper: { enum: ["lease", "bare"] },
        ...dataSourceMethodSurfaceCommon
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { enum: ["value", "leased-value", "iterable", "events"] },
        ...dataSourceMethodSurfaceCommon
      }
    }
  ]
};
var dataSourceSurfaceV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["methods"],
  properties: {
    /** A `value` method whose completion also releases the capability (`dispose`-style ABIs). */
    releaseVia: methodName,
    /**
     * Data properties of the object copied to the consumer with its handle (`TextSyntaxProvider.contract`);
     * exposed as read-only properties next to the proxied methods.
     */
    fields: { type: "array", items: methodName, maxItems: 64, uniqueItems: true },
    methods: {
      type: "object",
      minProperties: 1,
      propertyNames: methodName,
      additionalProperties: dataSourceMethodSurfaceV1Schema
    }
  }
};
var serviceContractDefinitionSpecV1Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "kind",
    "contract",
    "major",
    "offerFacet",
    "requestFacet",
    "matching",
    "conformanceProfile"
  ],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "service" },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    offerFacet: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["presence"],
          properties: { presence: { const: "forbidden" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["presence", "schema"],
          properties: {
            presence: { enum: ["optional", "required"] },
            schema: jsonSchemaRefSchema
          }
        }
      ]
    },
    requestFacet: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["presence"],
          properties: { presence: { const: "forbidden" } }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["presence", "schema"],
          properties: {
            presence: { enum: ["optional", "required"] },
            schema: jsonSchemaRefSchema
          }
        }
      ]
    },
    matching: {
      type: "object",
      additionalProperties: false,
      required: ["profile", "major"],
      properties: {
        profile: qualifiedId,
        major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        configuration: { title: "JsonValue" }
      }
    },
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema
  }
};
var dataSourceContractDefinitionSpecV1Schema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "contract", "major", "schema", "conformanceProfile"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "data-source" },
    contract: qualifiedId,
    major: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    schema: jsonSchemaRefSchema,
    conformanceProfile: nonEmptyString,
    surface: dataSourceSurfaceV1Schema
  }
};
var contractDefinitionSpecV1Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/contract-definition-spec.v1.schema.json",
  oneOf: [serviceContractDefinitionSpecV1Schema, dataSourceContractDefinitionSpecV1Schema]
};
deepFreeze(jsonSchemaRefSchema);
deepFreeze(resourceBudgetWireSchema);
deepFreeze(dataSourceRefWireSchema);
deepFreeze(codecContributionSpecV1Schema);
deepFreeze(serviceProviderContributionSpecV1Schema);
deepFreeze(viewerContributionSpecV1Schema);
deepFreeze(editorContributionSpecV1Schema);
deepFreeze(traitDefinitionSpecV1Schema);
deepFreeze(serviceContractDefinitionSpecV1Schema);
deepFreeze(dataSourceMethodSurfaceV1Schema);
deepFreeze(dataSourceSurfaceV1Schema);
deepFreeze(dataSourceContractDefinitionSpecV1Schema);
deepFreeze(contractDefinitionSpecV1Schema);

// packages/sdk/dist/editing.js
var WRITER_CONTRACT_ID = "common.edit/writer";
var writerSurface = {
  fields: ["identity", "offer"],
  methods: {
    validate: { kind: "value", signal: "last", arity: 1 },
    plan: { kind: "value", signal: "last", arity: 1 }
  }
};
var WRITER_SURFACE = deepFreeze(writerSurface);
var STANDARD_EDITING_SURFACES = deepFreeze({ [WRITER_CONTRACT_ID]: WRITER_SURFACE });
var ROUND_TRIP_RANK = Object.freeze({
  "byte-identical": 3,
  semantic: 2,
  lossy: 1,
  none: 0
});

// packages/sdk/dist/subjects/refs.js
var REVISION_KINDS = Object.freeze([
  "content-hash",
  "git-object",
  "etag",
  "database-version",
  "provider-token",
  "overlay-generation"
]);
var REVISION_KIND_PATTERN = REVISION_KINDS.join("|");
var REVISION_ALGORITHM_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";
var REVISION_VALUE_PATTERN = "(?:[A-Za-z0-9_.!~*'()\\-]|%[0-9A-F]{2})+";
var REVISION_ID_PATTERN = `^(?:${REVISION_KIND_PATTERN})(?:\\.${REVISION_ALGORITHM_PATTERN})?:${REVISION_VALUE_PATTERN}$`;
var REVISION_ID = new RegExp(REVISION_ID_PATTERN);

// packages/sdk/dist/schemas/subject-descriptor.js
var sourceSpanValueSchema = { oneOf: sourceSpanSchema.oneOf };
var nonEmptyString2 = { type: "string", minLength: 1 };
var nonWhitespaceString = { type: "string", pattern: "\\S" };
var revisionString = { type: "string", pattern: REVISION_ID_PATTERN };
var namespacedDottedId2 = { type: "string", pattern: NAMESPACED_DOTTED_PATTERN };
var operationId3 = { type: "string", pattern: OPERATION_PATTERN };
var stringArray = { type: "array", items: { type: "string" } };
var jsonValueRef = { $ref: "#/$defs/jsonValue" };
var jsonValueSchema = {
  title: "JsonValue",
  oneOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array", items: jsonValueRef },
    { type: "object", additionalProperties: jsonValueRef }
  ]
};
var assetSourceRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "uri"],
  properties: {
    id: nonWhitespaceString,
    uri: nonWhitespaceString,
    parentIds: { type: "array", items: nonWhitespaceString, minItems: 1 }
  }
};
var sourceBindingDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "role", "source", "required", "ownership", "revision"],
  properties: {
    id: nonEmptyString2,
    role: nonEmptyString2,
    source: assetSourceRefSchema,
    required: { type: "boolean" },
    ownership: { enum: ["owned", "companion", "external"] },
    revision: revisionString,
    mediaType: nonEmptyString2
  }
};
var subjectSnapshotRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bindingId", "role", "subjectUri", "revision", "compositionFingerprint"],
  properties: {
    bindingId: nonEmptyString2,
    role: nonEmptyString2,
    subjectUri: nonEmptyString2,
    revision: revisionString,
    compositionFingerprint: nonEmptyString2
  }
};
var derivationRecipeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["extensionId", "extensionVersion", "contributionId", "operation"],
  properties: {
    extensionId: { type: "string", pattern: QUALIFIED_PATTERN },
    extensionVersion: { type: "string", pattern: SEMVER_PATTERN },
    contributionId: { type: "string", pattern: QUALIFIED_PATTERN },
    operation: operationId3,
    parameters: jsonValueRef
  }
};
var materializedAssetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "revision"],
  properties: {
    source: assetSourceRefSchema,
    revision: revisionString,
    mediaType: nonEmptyString2
  }
};
var assetOriginDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "binding"],
      properties: {
        kind: { const: "single" },
        binding: sourceBindingDescriptorSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "bindings"],
      properties: {
        kind: { const: "bundle" },
        bindings: { type: "array", items: sourceBindingDescriptorSchema, minItems: 1 },
        primary: nonEmptyString2
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "root", "revision"],
      properties: {
        kind: { const: "namespace" },
        root: assetSourceRefSchema,
        revision: revisionString
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "inputs"],
      properties: {
        kind: { const: "derived" },
        inputs: { type: "array", items: subjectSnapshotRefSchema, minItems: 1 },
        recipe: derivationRecipeSchema,
        materialization: materializedAssetSchema
      }
    }
  ]
};
var diagnosticSourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extensionId: { type: "string", pattern: QUALIFIED_PATTERN },
    contributionId: { type: "string", pattern: QUALIFIED_PATTERN }
  }
};
var assetDiagnosticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "code", "category", "severity", "message"],
  properties: {
    id: nonEmptyString2,
    code: { type: "string", pattern: QUALIFIED_PATTERN },
    category: {
      enum: [
        "syntax",
        "structure",
        "fidelity",
        "dependency",
        "security",
        "performance",
        "operation",
        "io",
        "unknown"
      ]
    },
    severity: { enum: ["error", "warning", "information", "hint"] },
    message: { type: "string" },
    source: diagnosticSourceSchema,
    path: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
        ]
      }
    },
    range: sourceSpanValueSchema,
    data: jsonValueRef,
    relatedIds: stringArray
  }
};
var traitProperties = {
  id: namespacedDottedId2,
  descriptorVersion: { const: 1 },
  definitionVersion: { type: "string", pattern: SEMVER_PATTERN },
  parameters: jsonValueRef
};
var traitInstanceSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "descriptorVersion", "state"],
      properties: { ...traitProperties, state: { const: "available" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "descriptorVersion", "state", "diagnosticIds"],
      properties: {
        ...traitProperties,
        state: { enum: ["partial", "disabled", "dependency-required"] },
        diagnosticIds: { ...stringArray, minItems: 1 }
      }
    }
  ]
};
var jsonSchemaRefSchema2 = {
  type: "object",
  additionalProperties: false,
  required: ["$ref"],
  properties: { $ref: nonEmptyString2 }
};
var operationProperties = {
  id: operationId3,
  handlerId: nonEmptyString2,
  mutatesSource: { type: "boolean" },
  inputSchema: jsonSchemaRefSchema2
};
var assetOperationDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "handlerId", "state", "mutatesSource"],
      properties: { ...operationProperties, state: { const: "available" } }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "handlerId", "state", "mutatesSource", "reason"],
      properties: {
        ...operationProperties,
        state: { enum: ["disabled", "dependency-required"] },
        reason: nonEmptyString2
      }
    }
  ]
};
var assetConstraintsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["readOnly", "seekable", "randomAccess", "trusted"],
  properties: {
    readOnly: { type: "boolean" },
    seekable: { type: "boolean" },
    randomAccess: { type: "boolean" },
    trusted: { type: "boolean" },
    maxDecodedBytes: { type: "string", pattern: UINT64_DECIMAL_PATTERN },
    unsupportedFeatures: stringArray
  }
};
var metadataEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value"],
  properties: {
    key: nonEmptyString2,
    value: jsonValueRef
  }
};
var metadataGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "entries"],
  properties: {
    id: nonEmptyString2,
    label: { type: "string" },
    entries: { type: "array", items: metadataEntrySchema }
  }
};
var companionBaseProperties = {
  id: nonEmptyString2,
  role: nonEmptyString2,
  required: { type: "boolean" },
  cardinality: { enum: ["one", "zero-or-one", "one-or-more", "many"] },
  state: { enum: ["resolved", "missing", "ambiguous"] }
};
var requiredCompanionProperties = {
  ...companionBaseProperties,
  required: { const: true },
  cardinality: { enum: ["one", "one-or-more"] }
};
var optionalCompanionProperties = {
  ...companionBaseProperties,
  required: { const: false },
  cardinality: { enum: ["zero-or-one", "many"] }
};
var companionCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "revision"],
  properties: { source: assetSourceRefSchema, revision: revisionString }
};
var companionBindingIdsSchema = {
  type: "array",
  items: nonEmptyString2,
  minItems: 1,
  uniqueItems: true
};
var singleCompanionBindingIdSchema = {
  ...companionBindingIdsSchema,
  maxItems: 1
};
var companionDiagnosticIdsSchema = {
  type: "array",
  items: nonEmptyString2,
  minItems: 1,
  uniqueItems: true
};
var companionDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one" },
        state: { const: "resolved" },
        bindingIds: singleCompanionBindingIdSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one-or-more" },
        state: { const: "resolved" },
        bindingIds: companionBindingIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "zero-or-one" },
        state: { const: "resolved" },
        bindingIds: singleCompanionBindingIdSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "bindingIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "many" },
        state: { const: "resolved" },
        bindingIds: companionBindingIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "diagnosticIds"],
      properties: {
        ...requiredCompanionProperties,
        state: { const: "missing" },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state"],
      properties: {
        ...optionalCompanionProperties,
        state: { const: "missing" },
        diagnosticIds: { type: "array", items: nonEmptyString2, uniqueItems: true }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "candidates", "diagnosticIds"],
      properties: {
        ...requiredCompanionProperties,
        cardinality: { const: "one" },
        state: { const: "ambiguous" },
        candidates: {
          type: "array",
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true
        },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "role", "required", "cardinality", "state", "candidates", "diagnosticIds"],
      properties: {
        ...optionalCompanionProperties,
        cardinality: { const: "zero-or-one" },
        state: { const: "ambiguous" },
        candidates: {
          type: "array",
          items: companionCandidateSchema,
          minItems: 2,
          uniqueItems: true
        },
        diagnosticIds: companionDiagnosticIdsSchema
      }
    }
  ]
};
var detectionEvidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "weight"],
  properties: {
    kind: { enum: ["magic", "structure", "companion", "context", "extension", "user-override"] },
    weight: { type: "number" },
    note: { type: "string" }
  }
};
var detectionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["codecId", "confidence", "evidence", "requiredRanges"],
  properties: {
    codecId: { type: "string", pattern: QUALIFIED_PATTERN },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "array", items: detectionEvidenceSchema },
    requiredRanges: { type: "array", items: sourceSpanValueSchema },
    diagnostics: { type: "array", items: assetDiagnosticSchema }
  }
};
var resolvedIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["codecId", "codecVersion", "formatId", "formatLabel", "confidence", "detection"],
  properties: {
    codecId: { type: "string", pattern: QUALIFIED_PATTERN },
    codecVersion: { type: "string", pattern: SEMVER_PATTERN },
    formatId: nonEmptyString2,
    formatLabel: nonEmptyString2,
    mediaType: nonEmptyString2,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    detection: { type: "array", items: detectionEvidenceSchema }
  }
};
var subjectRequired = [
  "schemaVersion",
  "subjectUri",
  "origin",
  "traits",
  "operations",
  "constraints",
  "dataSources",
  "diagnostics",
  "revision"
];
var subjectProperties = {
  schemaVersion: { const: 2 },
  subjectUri: nonWhitespaceString,
  origin: assetOriginDescriptorSchema,
  traits: { type: "array", items: traitInstanceSchema },
  operations: { type: "array", items: assetOperationDescriptorSchema },
  constraints: assetConstraintsSchema,
  dataSources: { type: "array", items: dataSourceRefWireSchema },
  diagnostics: { type: "array", items: assetDiagnosticSchema },
  revision: revisionString
};
var unresolvedSourceDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [...subjectRequired, "interpretation", "candidates"],
  properties: {
    ...subjectProperties,
    interpretation: { const: "none" },
    candidates: { type: "array", items: detectionResultSchema }
  }
};
var resolvedAssetDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [...subjectRequired, "interpretation", "identity", "metadata"],
  properties: {
    ...subjectProperties,
    interpretation: { const: "codec" },
    identity: resolvedIdentitySchema,
    metadata: { type: "array", items: metadataGroupSchema },
    companions: { type: "array", items: companionDescriptorSchema }
  }
};
var subjectDescriptorV2Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkitx.org/x3/subject-descriptor.v2.schema.json",
  $defs: { jsonValue: jsonValueSchema },
  oneOf: [unresolvedSourceDescriptorSchema, resolvedAssetDescriptorSchema]
};
var subjectDescriptorV2InferenceSchema = {
  ...subjectDescriptorV2Schema,
  $defs: {
    ...subjectDescriptorV2Schema.$defs,
    jsonValue: { title: "JsonValue" }
  }
};
deepFreeze(subjectDescriptorV2Schema);
deepFreeze(subjectDescriptorV2InferenceSchema);

// packages/sdk/dist/host-facilities.generated.js
var STANDARD_HOST_FACILITY_IDS = Object.freeze([
  "clipboard.write",
  "credential.broker",
  "dialog.file-picker",
  "directory.watch",
  "editor.host-native",
  "extension.catalog.read",
  "extension.install.mutate",
  "extension.install.plan",
  "filesystem.atomic-replace",
  "filesystem.read-random",
  "gpu.webgl2",
  "gpu.webgpu",
  "native-process.rpc",
  "native.load",
  "network.range-fetch",
  "notification.system",
  "process.launch",
  "product.inventory.native-bridge",
  "product.inventory.read",
  "storage.durable-handles",
  "storage.opfs",
  "storage.quota",
  "update.service-worker",
  "wasm.simd",
  "wasm.threads",
  "window.custom-chrome",
  "worker.module",
  "worker.shared"
]);
var LEGACY_HOST_FACILITY_ALIASES = Object.freeze([
  "editor.monaco"
]);

// packages/sdk/dist/host-profile.js
var HOST_TRANSPORT_KINDS = Object.freeze([
  "in-process",
  "structured-clone",
  "rpc-handle",
  "stream",
  "transferable-buffer",
  "shared-memory-view",
  "native-process-rpc"
]);
var standardFacilities = new Set(STANDARD_HOST_FACILITY_IDS);
var legacyFacilities = new Set(LEGACY_HOST_FACILITY_ALIASES);
var transportKinds = new Set(HOST_TRANSPORT_KINDS);

// packages/sdk/dist/asset-capabilities/standard-traits.js
var TRAIT_IDS = Object.freeze([
  "content.metadata",
  "content.binary",
  "content.text",
  "content.images",
  "content.fonts",
  "content.styles",
  "content.scripts",
  "content.thumbnails",
  "image.raster",
  "image.channels",
  "image.mipmaps",
  "image.subresources",
  "image.compressed-blocks",
  "image.frames",
  "image.palette",
  "image.color-profile",
  "vector.scene",
  "vector.paths",
  "vector.shapes",
  "vector.text",
  "vector.gradients",
  "document.flow",
  "document.pages",
  "document.outline",
  "document.annotations",
  "table.sheets",
  "table.cells",
  "table.formulas",
  "presentation.slides",
  "presentation.masters",
  "design.components",
  "design.constraints",
  "structure.hierarchy",
  "structure.layers",
  "structure.nodes",
  "structure.timeline",
  "project.editable",
  "project.companions",
  "model.geometry",
  "model.materials",
  "model.textures",
  "model.skeleton",
  "model.animations",
  "model.lods",
  "scene.objects",
  "scene.cameras",
  "scene.lights",
  "scene.effects",
  "audio.streams",
  "audio.waveform",
  "audio.loop-points",
  "video.streams",
  "video.tracks",
  "media.duration",
  "media.frames",
  "media.seekable",
  "media.interactive-runtime",
  "container.entries",
  "container.directories",
  "container.nested",
  "container.compression",
  "container.encryption",
  "container.overlay",
  "source.dependencies",
  "font.glyphs",
  "font.metrics",
  "font.character-map",
  "code.source",
  "code.shader",
  "code.node-graph",
  "game.map",
  "game.replay",
  "game.layout",
  "game.localization",
  "game.catalog"
]);
var STANDARD_TRAIT_SET = new Set(TRAIT_IDS);
function isStandardTraitId(value2) {
  return STANDARD_TRAIT_SET.has(value2);
}

// packages/sdk/dist/manifest/contribution-contract-registry.js
var CODEC_CONTRIBUTION_CONTRACT = contractId("org.modkitx/codec-contribution");
var SERVICE_PROVIDER_CONTRIBUTION_CONTRACT = contractId("org.modkitx/service-provider-contribution");
var VIEWER_CONTRIBUTION_CONTRACT = contractId("org.modkitx/viewer-contribution");
var EDITOR_CONTRIBUTION_CONTRACT = contractId("org.modkitx/editor-contribution");
var TRAIT_DEFINITION_CONTRIBUTION_CONTRACT = contractId("org.modkitx/trait-definition");
var CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT = contractId("org.modkitx/contract-definition");
var TRAIT_DEFINITION_FACT = contractId("org.modkitx.inventory/trait-definition");
var CONTRACT_DEFINITION_FACT = contractId("org.modkitx.inventory/contract-definition");
var EDITOR_CONTRIBUTION_FACT = contractId("org.modkitx.inventory/editor-contribution");
function duplicateFieldDiagnostics(values, path, label) {
  const first = /* @__PURE__ */ new Map();
  const diagnostics = [];
  values.forEach((value2, index) => {
    const previous = first.get(value2);
    if (previous === void 0)
      first.set(value2, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/duplicate-semantic-id", `${label} ${value2} duplicates index ${previous}`, [...path, index]));
    }
  });
  return diagnostics;
}
function requirementRangeDiagnostics(requirement, path) {
  const parsed = requirement.range === void 0 ? void 0 : parseVersionRange(requirement.range);
  return requirement.range !== void 0 && (parsed === void 0 || !versionRangeTargetsMajor(parsed, requirement.major)) ? [
    diagnostic("error", "x3.sdk/invalid-contract-range", `contract range ${requirement.range} cannot be evaluated safely`, [...path, "range"])
  ] : [];
}
function traitDefinitionRangeDiagnostics(id, range, path) {
  if (isStandardTraitId(id)) {
    return range === void 0 ? [] : [
      diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${id} does not use an extension definition range`, [...path, "definitionRange"])
    ];
  }
  if (range === void 0 || parseVersionRange(range) === void 0) {
    return [
      diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${id} must declare a safe definition range`, [...path, "definitionRange"])
    ];
  }
  return [];
}
function traitDefinitionOfferDiagnostics(id, version, path) {
  if (isStandardTraitId(id)) {
    return version === void 0 ? [] : [
      diagnostic("error", "x3.sdk/standard-trait-versioned", `standard trait ${id} does not use an extension definition version`, [...path, "definitionVersion"])
    ];
  }
  if (version === void 0 || parseSemver(version) === void 0) {
    return [
      diagnostic("error", "x3.sdk/custom-trait-definition-unbound", `custom trait ${id} must declare one exact safe definition version`, [...path, "definitionVersion"])
    ];
  }
  return [];
}
var validateCodecContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const localCodecPrefix = manifest.id;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.formatRefs.map((format) => format.formatId), ["spec", "formatRefs"], "format ID"),
    ...duplicateFieldDiagnostics(spec.representations.map((representation) => representation.id), ["spec", "representations"], "representation ID"),
    ...duplicateFieldDiagnostics(spec.companions?.map((companion) => companion.id) ?? [], ["spec", "companions"], "companion rule ID"),
    ...duplicateFieldDiagnostics(spec.traitDeclarations?.map((declaration) => `${declaration.id}\0${declaration.representation}`) ?? [], ["spec", "traitDeclarations"], "trait declaration coordinate"),
    ...duplicateFieldDiagnostics(spec.operations.map((operation) => operation.id), ["spec", "operations"], "operation ID"),
    ...duplicateFieldDiagnostics(spec.operations.map((operation) => operation.handlerId), ["spec", "operations"], "operation handler ID"),
    ...duplicateFieldDiagnostics(spec.fidelityEvidence?.map((item) => item.evidenceId) ?? [], ["spec", "fidelityEvidence"], "fidelity evidence ID")
  ];
  const formatIds = new Set(spec.formatRefs.map((format) => format.formatId));
  const representationIds = new Set(spec.representations.map((representation) => representation.id));
  spec.fidelityEvidence?.forEach((item, index) => {
    if (!formatIds.has(item.formatId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/fidelity-evidence-format-unknown", `fidelity evidence ${item.evidenceId} names undeclared format ${item.formatId}`, ["spec", "fidelityEvidence", index, "formatId"]));
    }
    if (!representationIds.has(item.representationId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/fidelity-evidence-representation-unknown", `fidelity evidence ${item.evidenceId} names undeclared representation ${item.representationId}`, ["spec", "fidelityEvidence", index, "representationId"]));
    }
  });
  const expectedProbeKind = spec.sourceTopology === "namespace" ? "namespace" : spec.sourceTopology === "derived" ? "derived" : "bytes";
  if (spec.probe.kind !== expectedProbeKind) {
    diagnostics.push(diagnostic("error", "x3.sdk/probe-topology-mismatch", `topology ${spec.sourceTopology} requires a ${expectedProbeKind} probe policy`, ["spec", "probe", "kind"]));
  }
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ["spec", "requires", index]));
  });
  spec.traitDeclarations?.forEach((claim, index) => {
    diagnostics.push(...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
      "spec",
      "traitDeclarations",
      index
    ]));
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(...requirementRangeDiagnostics(requirement, [
        "spec",
        "traitDeclarations",
        index,
        "prerequisites",
        requirementIndex
      ]));
    });
  });
  spec.companions?.forEach((companion, companionIndex) => {
    for (const selector of ["all", "any", "none"]) {
      companion.expected?.[selector]?.forEach((requirement, requirementIndex) => {
        diagnostics.push(...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
          "spec",
          "companions",
          companionIndex,
          "expected",
          selector,
          requirementIndex
        ]));
      });
    }
  });
  spec.operations.forEach((operation, index) => {
    if (operation.requiresContract !== void 0) {
      diagnostics.push(...requirementRangeDiagnostics(operation.requiresContract, [
        "spec",
        "operations",
        index,
        "requiresContract"
      ]));
    }
    const shared = SHARED_OPERATION_IDS.includes(operation.id);
    const canonicalDomain = OPERATION_DOMAINS.some((domain) => {
      const prefix = `${domain}.`;
      return operation.id.startsWith(prefix) && isSegment(operation.id.slice(prefix.length));
    });
    const localSuffix = operation.id.startsWith(`${localCodecPrefix}.`) ? operation.id.slice(localCodecPrefix.length + 1) : void 0;
    const codecLocal = localSuffix !== void 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(localSuffix);
    if (!shared && !canonicalDomain && !codecLocal) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-operation-namespace", `operation ${operation.id} is not shared, canonical-domain, or local to ${manifest.id}`, ["spec", "operations", index, "id"]));
    }
  });
  const requiredPermissions = /* @__PURE__ */ new Set(["read-source"]);
  spec.operations.forEach((operation) => {
    if (operation.mutatesSource)
      requiredPermissions.add("write-source");
    operation.requiredPermissions?.forEach((permission) => requiredPermissions.add(permission));
  });
  manifest.runtimeVariants?.forEach((variant, variantIndex) => {
    const requested = new Set(variant.requestedPermissionClasses);
    for (const permission of requiredPermissions) {
      if (!requested.has(permission)) {
        diagnostics.push(diagnostic("error", "x3.sdk/variant-permission-underdeclared", `runtime variant ${variant.variantId} does not request ${permission}`, ["runtimeVariants", variantIndex, "requestedPermissionClasses"]));
      }
    }
  });
  return diagnostics;
};
function isPortableOperationReference(id) {
  if (SHARED_OPERATION_IDS.includes(id))
    return true;
  if (OPERATION_DOMAINS.some((domain) => {
    const prefix = `${domain}.`;
    return id.startsWith(prefix) && isSegment(id.slice(prefix.length));
  })) {
    return true;
  }
  const separator = id.lastIndexOf(".");
  return separator > 0 && isQualifiedId(id.slice(0, separator)) && isSegment(id.slice(separator + 1));
}
var validateViewerContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.requiresTraits?.map((requirement) => requirement.id) ?? [], ["spec", "requiresTraits"], "trait requirement"),
    ...duplicateFieldDiagnostics(spec.requiresOperations ?? [], ["spec", "requiresOperations"], "operation requirement")
  ];
  spec.requiresOperations?.forEach((id, index) => {
    if (!isPortableOperationReference(id)) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-operation-namespace", `viewer operation requirement ${id} is not shared, canonical-domain, or qualified-local`, ["spec", "requiresOperations", index]));
    }
  });
  spec.requiresTraits?.forEach((requirement, index) => {
    diagnostics.push(...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
      "spec",
      "requiresTraits",
      index
    ]));
  });
  return diagnostics;
};
var EDITING_OPERATION_IDS = Object.freeze([
  "edit.content",
  "edit.structure",
  "edit.field",
  "edit.undo-redo",
  "source.save",
  "source.save-as"
]);
var validateEditorContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.requiresOperations, ["spec", "requiresOperations"], "operation"),
    ...duplicateFieldDiagnostics(spec.consumesDataSources.map((source) => `${source.contract}@${source.major}`), ["spec", "consumesDataSources"], "data-source requirement")
  ];
  spec.requiresOperations.forEach((id, index) => {
    if (!EDITING_OPERATION_IDS.includes(id)) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-editor-operation", `editor operation ${id} is not one of the shared editing operations`, ["spec", "requiresOperations", index]));
    }
  });
  if (!spec.requiresOperations.some((id) => id.startsWith("edit."))) {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-edit-operation-missing", "an editor contribution requires an explicit edit operation", ["spec", "requiresOperations"]));
  }
  if (spec.requiresTransactions && !spec.requiresOperations.some((id) => id === "source.save" || id === "source.save-as")) {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-save-operation-missing", "a transactional editor requires source.save or source.save-as", ["spec", "requiresOperations"]));
  }
  if (spec.requiresTransactions && spec.writer.mutationMode !== "mutate") {
    diagnostics.push(diagnostic("error", "x3.sdk/editor-writer-mode-mismatch", "a transactional editor requires a mutating writer", ["spec", "writer", "mutationMode"]));
  }
  return diagnostics;
};
var validateTraitDefinitionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [];
  if (parseSemver(spec.version) === void 0) {
    diagnostics.push(diagnostic("error", "x3.sdk/invalid-definition-version", `trait definition version ${spec.version} cannot be evaluated safely`, ["spec", "version"]));
  }
  const seen = /* @__PURE__ */ new Map();
  spec.imports?.forEach((dependency, index) => {
    if (dependency.id === spec.id) {
      diagnostics.push(diagnostic("error", "x3.sdk/self-definition-import", `trait definition ${spec.id} cannot import itself`, ["spec", "imports", index, "id"]));
    }
    const previous = seen.get(dependency.id);
    if (previous === void 0)
      seen.set(dependency.id, index);
    else {
      diagnostics.push(diagnostic("error", "x3.sdk/duplicate-definition-import", `trait import ${dependency.id} duplicates index ${previous}`, ["spec", "imports", index, "id"]));
    }
    if (parseVersionRange(dependency.range) === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/invalid-definition-range", `trait import range ${dependency.range} cannot be evaluated safely`, ["spec", "imports", index, "range"]));
    }
  });
  return diagnostics;
};
var validateContractDefinitionSemantics = (manifest) => {
  const spec = manifest.spec;
  if (!Number.isSafeInteger(spec.major) || spec.major < 0) {
    return [
      diagnostic("error", "x3.sdk/invalid-contract-major", `contract definition major ${spec.major} is not a safe non-negative integer`, ["spec", "major"])
    ];
  }
  if (spec.surface !== void 0) {
    return dataSourceSurfaceDiagnostics(spec.surface, ["spec", "surface"]);
  }
  return [];
};
function dataSourceSurfaceDiagnostics(surface, path) {
  const diagnostics = [];
  if (surface.releaseVia !== void 0) {
    const target = surface.methods[surface.releaseVia];
    if (target === void 0) {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-release-via-unknown", `releaseVia \xAB${surface.releaseVia}\xBB does not name a declared method`, [...path, "releaseVia"]));
    } else if (target.kind !== "value") {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-release-via-kind", `releaseVia \xAB${surface.releaseVia}\xBB must name a value method, found ${target.kind}`, [...path, "releaseVia"]));
    }
  }
  for (const field of surface.fields ?? []) {
    if (Object.hasOwn(surface.methods, field)) {
      diagnostics.push(diagnostic("error", "x3.sdk/surface-field-is-method", `\xAB${field}\xBB cannot be both a field and a method`, [...path, "fields"]));
    }
  }
  return diagnostics;
}
var validateServiceProviderContributionSemantics = (manifest) => {
  const spec = manifest.spec;
  const diagnostics = [
    ...duplicateFieldDiagnostics(spec.provides.map((offer) => offer.offerId), ["spec", "provides"], "offer ID"),
    ...duplicateFieldDiagnostics(spec.outputs?.map((output) => `${output.id}\0${output.representation}`) ?? [], ["spec", "outputs"], "trait declaration coordinate")
  ];
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ["spec", "requires", index]));
  });
  spec.outputs?.forEach((claim, index) => {
    diagnostics.push(...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
      "spec",
      "outputs",
      index
    ]));
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(...requirementRangeDiagnostics(requirement, [
        "spec",
        "outputs",
        index,
        "prerequisites",
        requirementIndex
      ]));
    });
  });
  if (spec.replacement !== void 0) {
    diagnostics.push(...requirementRangeDiagnostics(spec.replacement.target, ["spec", "replacement", "target"]));
  }
  const variants = new Set((manifest.runtimeVariants ?? []).map((variant) => variant.variantId));
  spec.provides.forEach((offer, index) => {
    const version = parseSemver(offer.version);
    if (version === void 0 || version.major !== offer.major) {
      diagnostics.push(diagnostic("error", "x3.sdk/offer-major-mismatch", `offer ${offer.offerId} version ${offer.version} does not match major ${offer.major}`, ["spec", "provides", index, "version"]));
    }
  });
  spec.applicableVariants?.forEach((variantId, index) => {
    if (!variants.has(variantId)) {
      diagnostics.push(diagnostic("error", "x3.sdk/unknown-applicable-variant", `applicable variant ${variantId} is not declared by the envelope`, ["spec", "applicableVariants", index]));
    }
  });
  return diagnostics;
};
function dataOnlyProjector(factContract) {
  return (manifest, context) => Object.freeze([
    Object.freeze({
      contract: Object.freeze({ id: factContract, major: 1 }),
      value: manifest.spec,
      provenance: Object.freeze({ ...context })
    })
  ]);
}
var A1_SPEC_SCHEMA_ENTRIES = [
  {
    contract: CODEC_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: codecContributionSpecV1Schema,
    validateSemantics: validateCodecContributionSemantics
  },
  {
    contract: SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: serviceProviderContributionSpecV1Schema,
    validateSemantics: validateServiceProviderContributionSemantics
  },
  {
    contract: VIEWER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: viewerContributionSpecV1Schema,
    validateSemantics: validateViewerContributionSemantics
  },
  {
    contract: EDITOR_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: editorContributionSpecV1Schema,
    validateSemantics: validateEditorContributionSemantics
  },
  {
    contract: TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: traitDefinitionSpecV1Schema,
    validateSemantics: validateTraitDefinitionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(TRAIT_DEFINITION_FACT),
      conformanceProfile: "org.modkitx/trait-definition-v1"
    }
  },
  {
    contract: CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: contractDefinitionSpecV1Schema,
    validateSemantics: validateContractDefinitionSemantics,
    registration: {
      mode: "data-only",
      project: dataOnlyProjector(CONTRACT_DEFINITION_FACT),
      conformanceProfile: "org.modkitx/contract-definition-v1"
    }
  }
];

// packages/sdk/dist/runtime/index.js
var RUNTIME_SESSION_V2_MEMBERS = Object.freeze([
  "offers",
  "identity",
  "step",
  "events",
  "snapshot",
  "restore",
  "stateHash"
]);

// packages/sdk/dist/asset-capabilities/model-facet-sources.js
var RESERVED_MODEL_FACET_SOURCES = Object.freeze([
  Object.freeze({
    contract: "common.view/model-socket-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { sockets }",
      "sockets(page): { id, nodeId, role, orientation? }"
    ]),
    blockedBy: "no codec publishes attachment points today: the UVM schema defines UV_game_socket, but the X3 UVM reader does not surface them and no native model codec extracts them"
  }),
  Object.freeze({
    contract: "common.view/model-lod-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { levels }",
      "levels(page): { id, nodeIds, order, selection? }"
    ]),
    blockedBy: "no codec publishes discrete LOD levels today: MSFT_lod topology is readable in principle, and nothing reads it"
  }),
  Object.freeze({
    contract: "common.view/model-variant-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { variants }",
      "variants(page): { id, name, kind, targets }"
    ]),
    blockedBy: "no codec publishes named variants today: UV_game_variants exists in the schema and no reader surfaces it"
  }),
  Object.freeze({
    contract: "common.view/model-effect-source",
    major: 1,
    minimalShape: Object.freeze([
      "info(): { effects, byKind, profile? }",
      "effects(page): { id, kind, nodeId?, materialId? }"
    ]),
    blockedBy: "the UVM reader publishes effect *counts* by kind, which fills info() and nothing else; per-emitter records have no publisher, and a page method no publisher can fill is not a contract"
  })
]);

// packages/sdk/dist/asset-capabilities/data-source-surfaces.js
var ENCODED_MEDIA_SURFACE_ID = "common.view/encoded-media";
var ENCODED_MEDIA = Object.freeze({
  contract: contractId(ENCODED_MEDIA_SURFACE_ID),
  major: 1
});
var sig2 = { signal: "last" };
var value = { kind: "value" };
var cancellableValue = { kind: "value", ...sig2 };
var iterable = { kind: "iterable", ...sig2 };
var encodedMediaSurface = {
  methods: {
    descriptor: value,
    read: cancellableValue
  }
};
var textDataSourceSurface = {
  methods: {
    info: value,
    slice: cancellableValue,
    search: iterable
  }
};
var byteRangeSourceSurface = {
  methods: {
    size: value,
    read: cancellableValue
  }
};
var treeDataSourceSurface = {
  methods: {
    root: value,
    children: cancellableValue,
    facts: value,
    search: iterable
  }
};
var tableDataSourceSurface = {
  methods: {
    shape: value,
    rows: cancellableValue,
    cell: value,
    search: iterable
  }
};
var transportSourceSurface = {
  methods: {
    snapshot: cancellableValue,
    /** A live stream, not a finite listing: `subscribe` → `event…` → `done`. */
    events: { kind: "events", ...sig2 }
  }
};
var namespaceEntrySourceSurface = {
  methods: {
    list: cancellableValue,
    /** `Lease<AssetSourceRef>`: the ref crosses by copy, the lease is a release-only handle. */
    openEntry: { kind: "leased-value", ...sig2 }
  }
};
var rasterImageSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig2 },
    readRegion: { kind: "value", optional: true, ...sig2 }
  }
};
var vectorSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    document: cancellableValue
  }
};
var audioMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    /** `encoded(trackId?, signal?)`: `arity: 1` keeps the signal last when the track is omitted. */
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", arity: 1, ...sig2 },
    readPcm: { kind: "value", optional: true, ...sig2 }
  }
};
var videoMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: "lease", result: ENCODED_MEDIA, wrapper: "bare", ...sig2 },
    readFrame: { kind: "value", optional: true, ...sig2 }
  }
};
var modelSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    nodes: cancellableValue,
    meshes: cancellableValue,
    primitive: { kind: "value", optional: true, ...sig2 }
  }
};
var modelResourceRefsSourceSurface = {
  methods: {
    info: cancellableValue,
    references: cancellableValue
  }
};
var modelSkeletonSourceSurface = {
  methods: {
    info: cancellableValue,
    bindings: cancellableValue
  }
};
var modelAnimationSourceSurface = {
  methods: {
    info: cancellableValue,
    clips: cancellableValue
  }
};
var modelCollisionSourceSurface = {
  methods: {
    info: cancellableValue,
    volumes: cancellableValue
  }
};
var modelMaterialSourceSurface = {
  methods: {
    info: cancellableValue,
    materials: cancellableValue
  }
};
var relationGraphSourceSurface = {
  methods: {
    summary: cancellableValue,
    nodes: cancellableValue,
    edges: cancellableValue
  }
};
var slideDeckSourceSurface = {
  methods: {
    info: cancellableValue,
    slides: cancellableValue
  }
};
var subjectFactsSourceSurface = {
  methods: {
    summary: cancellableValue,
    groups: cancellableValue,
    facts: cancellableValue,
    relations: cancellableValue
  }
};
var STANDARD_DATA_SOURCE_SURFACES = deepFreeze({
  "common.view/text-data-source": textDataSourceSurface,
  "common.view/byte-range-source": byteRangeSourceSurface,
  "common.view/tree-data-source": treeDataSourceSurface,
  "common.view/table-data-source": tableDataSourceSurface,
  "common.view/transport-source": transportSourceSurface,
  "common.view/namespace-entry-source": namespaceEntrySourceSurface,
  "common.view/raster-image-source": rasterImageSourceSurface,
  "common.view/vector-scene-source": vectorSceneSourceSurface,
  "common.view/audio-media-source": audioMediaSourceSurface,
  "common.view/video-media-source": videoMediaSourceSurface,
  "common.view/model-scene-source": modelSceneSourceSurface,
  "common.view/model-resource-refs-source": modelResourceRefsSourceSurface,
  "common.view/model-skeleton-source": modelSkeletonSourceSurface,
  "common.view/model-animation-source": modelAnimationSourceSurface,
  "common.view/model-collision-source": modelCollisionSourceSurface,
  "common.view/model-material-source": modelMaterialSourceSurface,
  "common.view/relation-graph-source": relationGraphSourceSurface,
  "common.view/subject-facts-source": subjectFactsSourceSurface,
  "common.view/slide-deck-source": slideDeckSourceSurface
});
var AUXILIARY_DATA_SOURCE_SURFACES = deepFreeze({
  [ENCODED_MEDIA_SURFACE_ID]: encodedMediaSurface
});
var ENCODED_MEDIA_SURFACE_CONTRACT = contractId(ENCODED_MEDIA_SURFACE_ID);

// packages/host/dist/execution/surface-adapter.js
function walkStrings(value2, max) {
  if (typeof value2 === "string") {
    return value2.length > max ? `a string is longer than ${max}` : void 0;
  }
  if (Array.isArray(value2)) {
    for (const item of value2) {
      const problem = walkStrings(item, max);
      if (problem !== void 0)
        return problem;
    }
    return void 0;
  }
  if (typeof value2 === "object" && value2 !== null && !(value2 instanceof Uint8Array)) {
    for (const [key, item] of Object.entries(value2)) {
      if (key.length > max)
        return `a key is longer than ${max}`;
      const problem = walkStrings(item, max);
      if (problem !== void 0)
        return problem;
    }
  }
  return void 0;
}
function countBytes(value2) {
  if (value2 instanceof Uint8Array)
    return value2.byteLength;
  if (Array.isArray(value2))
    return value2.reduce((sum, item) => sum + countBytes(item), 0);
  if (typeof value2 === "object" && value2 !== null) {
    return Object.values(value2).reduce((sum, item) => sum + countBytes(item), 0);
  }
  return 0;
}
function limitValidators(limits) {
  const { maxStringLength, maxBytes, maxPageItems } = limits;
  const validateArgs = maxStringLength === void 0 ? void 0 : (args) => walkStrings(args, maxStringLength);
  const validateReturn = maxStringLength === void 0 && maxBytes === void 0 && maxPageItems === void 0 ? void 0 : (value2) => {
    if (maxStringLength !== void 0) {
      const problem = walkStrings(value2, maxStringLength);
      if (problem !== void 0)
        return problem;
    }
    if (maxBytes !== void 0 && countBytes(value2) > maxBytes) {
      return `result carries more than ${maxBytes} bytes`;
    }
    if (maxPageItems !== void 0 && typeof value2 === "object" && value2 !== null && !Array.isArray(value2) && Array.isArray(value2.items) && value2.items.length > maxPageItems) {
      return `page carries more than ${maxPageItems} items`;
    }
    return void 0;
  };
  return {
    ...validateArgs === void 0 ? {} : { validateArgs },
    ...validateReturn === void 0 ? {} : { validateReturn }
  };
}
function methodSurfaceFrom(method) {
  return {
    kind: method.kind,
    ...method.kind === "lease" ? {
      result: { contract: method.result.contract, major: method.result.major },
      ...method.wrapper === void 0 ? {} : { wrapper: method.wrapper }
    } : {},
    ...method.signal === void 0 ? {} : { signal: method.signal },
    ...method.progress === void 0 ? {} : { progress: method.progress },
    ...method.arity === void 0 ? {} : { arity: method.arity },
    ...method.optional === void 0 ? {} : { optional: method.optional },
    ...method.limits === void 0 ? {} : limitValidators(method.limits)
  };
}
function capabilitySurfaceFromDataSource(contract, major, surface) {
  const methods = {};
  for (const [name, method] of Object.entries(surface.methods)) {
    methods[name] = methodSurfaceFrom(method);
  }
  return {
    contract,
    major,
    methods,
    ...surface.releaseVia === void 0 ? {} : { releaseVia: surface.releaseVia },
    ...surface.fields === void 0 ? {} : { fields: [...surface.fields] }
  };
}
function standardDataSourceCapabilitySurfaces() {
  const out = [];
  for (const table of [
    STANDARD_DATA_SOURCE_SURFACES,
    AUXILIARY_DATA_SOURCE_SURFACES,
    STANDARD_EDITING_SURFACES
  ]) {
    for (const [contract, surface] of Object.entries(table)) {
      out.push(capabilitySurfaceFromDataSource(contract, 1, surface));
    }
  }
  return out;
}
function createStandardSurfaceRegistry(options = {}) {
  const byKey = /* @__PURE__ */ new Map();
  const add = (surface, override) => {
    const key = `${surface.contract}@${surface.major}`;
    if (!override && byKey.has(key))
      return;
    byKey.set(key, surface);
  };
  for (const surface of standardDataSourceCapabilitySurfaces())
    add(surface, true);
  for (const surface of RUNTIME_ABI_SURFACES)
    add(surface, true);
  for (const definition of options.definitions ?? []) {
    if (definition.surface === void 0)
      continue;
    add(capabilitySurfaceFromDataSource(definition.contract, definition.major, definition.surface), false);
  }
  for (const surface of options.surfaces ?? [])
    add(surface, false);
  return createSurfaceRegistry([...byKey.values()]);
}

// packages/host/dist/execution/module-reassembly.js
var unavailableResolver = {
  resolve: () => Promise.reject(new ModkitError({
    code: "x3.host/execution-backend-unavailable",
    message: "the host did not hand this worker a contract resolver"
  })),
  resolveUnknown: () => Promise.reject(new ModkitError({
    code: "x3.host/execution-backend-unavailable",
    message: "the host did not hand this worker a contract resolver"
  }))
};
function contributionContext(wire) {
  const sink = wire.diagnostics;
  return {
    budgets: wire.budgets,
    diagnostics: {
      report(diagnostic2) {
        if (sink !== void 0)
          void sink.report(diagnostic2).catch(() => void 0);
      }
    },
    contracts: wire.contracts ?? unavailableResolver
  };
}
function assetInput(wire) {
  const bindings = wire.bindings ?? [];
  const subjects = wire.subjects ?? [];
  return Object.assign(/* @__PURE__ */ Object.create(null), wire, {
    bindingsFor: (requirementId) => bindings.filter((binding) => binding.sourceKind === "requirement" && binding.requirementId === requirementId),
    subjectsFor: (requirementId) => subjects.filter((subject) => subject.requirementId === requirementId)
  });
}
function wrapServiceModule(module) {
  const createProvider = module["createProvider"];
  return {
    abiVersion: module["abiVersion"],
    provides: module["provides"],
    createProvider: (selection, wire) => createProvider.call(module, selection, contributionContext(wire))
  };
}
function wrapCodecModule(module) {
  const createCodec = module["createCodec"];
  return {
    abiVersion: module["abiVersion"],
    createCodec: typeof createCodec !== "function" ? void 0 : (wire) => {
      const codec = createCodec(contributionContext(wire));
      const open = codec["open"];
      return {
        ...codec,
        ...typeof open !== "function" ? {} : {
          open: (input, ...rest) => open.call(codec, assetInput(input), ...rest)
        }
      };
    }
  };
}
function wrapLoadedModule(module) {
  const isServiceModule = typeof module["createProvider"] === "function" && typeof module["createCodec"] !== "function";
  return {
    module: isServiceModule ? wrapServiceModule(module) : wrapCodecModule(module),
    surface: isServiceModule ? ABI_SERVICE_PROVIDER_MODULE : ABI_CODEC_MODULE
  };
}

// packages/host/dist/node/worker-bootstrap.js
var data = workerData;
function framePort(port) {
  return {
    post: (frame, transfer) => port.postMessage(frame, [...transfer]),
    onFrame: (handler) => {
      const listener = (payload) => handler(payload);
      port.on("message", listener);
      return () => port.off("message", listener);
    }
  };
}
var sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
var rootPath = fileURLToPath(new URL(data.artifactRoot));
var rootReal;
var rootRealPath = async () => {
  rootReal ??= await realpath(rootPath);
  return rootReal;
};
var rootHref = (real) => pathToFileURL(real.endsWith("/") || real.endsWith("\\") ? real : `${real}/`).href;
async function containedRealPath(moduleUrl) {
  const url = new URL(moduleUrl);
  if (url.protocol !== "file:") {
    throw new ModkitError({
      code: "x3.host/execution-load-rejected",
      message: `worker loads file: modules only, received ${url.protocol}`
    });
  }
  const modulePath = await realpath(fileURLToPath(url));
  if (!pathToFileURL(modulePath).href.startsWith(rootHref(await rootRealPath()))) {
    throw new ModkitError({
      code: "x3.host/execution-load-rejected",
      message: "module real path escapes the artifact root"
    });
  }
  return modulePath;
}
function artifactRelativePath(url) {
  if (!url.startsWith("file:"))
    return void 0;
  const rootUrl = rootHref(rootPath);
  const realRoot = rootReal === void 0 ? void 0 : rootHref(rootReal);
  const base = url.startsWith(rootUrl) ? rootUrl : realRoot !== void 0 && url.startsWith(realRoot) ? realRoot : void 0;
  if (base === void 0)
    return void 0;
  const relative = decodeURIComponent(url.slice(base.length));
  if (relative.split("/").includes("node_modules"))
    return void 0;
  return relative;
}
function isPathSpecifier(specifier) {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/") || specifier.startsWith("file:") || /^[a-zA-Z]:[\\/]/.test(specifier);
}
var verified = /* @__PURE__ */ new Set();
var hooksInstalled = false;
var entrypointRelative;
function installHooks() {
  if (hooksInstalled)
    return;
  hooksInstalled = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      const url = resolved.url;
      if (url.startsWith("node:") || url.startsWith("data:"))
        return resolved;
      if (!url.startsWith("file:")) {
        throw new ModkitError({
          code: "x3.host/execution-load-rejected",
          message: `worker refuses ${url.split(":")[0] ?? "?"}: imports`
        });
      }
      const relative = artifactRelativePath(url);
      if (relative === void 0) {
        const bare = !isPathSpecifier(specifier);
        const parentInside = context.parentURL !== void 0 && artifactRelativePath(context.parentURL) !== void 0;
        if (parentInside && !bare) {
          throw new ModkitError({
            code: "x3.host/execution-load-rejected",
            message: "import escapes the artifact root and is not a declared dependency",
            context: { specifier }
          });
        }
        return resolved;
      }
      if (data.fileDigests === void 0 && relative !== entrypointRelative) {
        throw new ModkitError({
          code: "x3.host/artifact-not-pinned",
          message: "the entrypoint imports other artifact files but the inventory recorded no per-file digests",
          context: { specifier }
        });
      }
      return resolved;
    },
    load(url, context, nextLoad) {
      const relative = artifactRelativePath(url);
      if (relative === void 0)
        return nextLoad(url, context);
      const bytes = readFileSync(fileURLToPath(url));
      const expected = data.fileDigests?.[relative];
      if (data.fileDigests !== void 0) {
        if (expected === void 0) {
          throw new ModkitError({
            code: "x3.host/execution-load-rejected",
            message: `${relative} is not part of the inventoried artifact`
          });
        }
        if (sha256(bytes) !== expected) {
          throw new ModkitError({
            code: "x3.host/artifact-digest-mismatch",
            message: `${relative} changed after the inventory recorded it and will not be evaluated`
          });
        }
      }
      verified.add(relative);
      return { format: "module", shortCircuit: true, source: bytes };
    }
  });
}
var loads = 0;
async function loader(request) {
  loads += 1;
  if (loads > 1) {
    throw new ModkitError({
      code: "x3.host/execution-load-rejected",
      message: "a worker serves exactly one load"
    });
  }
  const modulePath = await containedRealPath(request.moduleUrl);
  const moduleUrl = pathToFileURL(modulePath).href;
  entrypointRelative = artifactRelativePath(moduleUrl);
  const bytes = await readFile(modulePath);
  if (request.entrypointDigest !== void 0 && sha256(bytes) !== request.entrypointDigest) {
    throw new ModkitError({
      code: "x3.host/artifact-digest-mismatch",
      message: "the entrypoint changed after the host verified it and will not be evaluated"
    });
  }
  installHooks();
  const module = await import(moduleUrl);
  const wrapped = wrapLoadedModule(module);
  return { ...wrapped, release: () => void 0 };
}
createEndpoint({
  role: "worker",
  port: framePort(data.port),
  session: data.session,
  generation: data.generation,
  surfaces: createStandardSurfaceRegistry({ definitions: data.foreignSurfaces }),
  limits: protocolLimits(data.limits),
  loader,
  onTerminate: () => process.exit(0),
  onFailure: () => process.exit(2)
});
