var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// packages/core/dist/index.js
var SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var DOTTED = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
var QUALIFIED = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
function isSegment(value) {
  return SEGMENT.test(value);
}
function isDottedId(value) {
  return DOTTED.test(value);
}
function isQualifiedId(value) {
  return QUALIFIED.test(value);
}
function isContractId(value) {
  return isQualifiedId(value);
}
function isErrorCode(value) {
  return isQualifiedId(value);
}
function isTraitId(value) {
  return value.includes(".") && isDottedId(value);
}
function contractId(value) {
  if (!isQualifiedId(value)) throw new TypeError(`invalid contract id: ${value}`);
  return value;
}
function errorCode(value) {
  if (!isErrorCode(value)) throw new TypeError(`invalid diagnostic/error code: ${value}`);
  return value;
}
function traitId(value) {
  if (!isTraitId(value)) throw new TypeError(`invalid trait id: ${value}`);
  return value;
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
  "container.extract",
  "container.pack",
  "asset.search",
  "asset.validate",
  "asset.compare",
  "content.resolve-dependencies",
  "content.mount"
]);
function operationId(value, owner) {
  if (!isQualifiedId(owner.contributionId)) {
    throw new TypeError(`invalid contribution id for operation ownership: ${owner.contributionId}`);
  }
  const codecPrefix = owner.contributionId;
  const localSuffix = value.startsWith(`${codecPrefix}.`) ? value.slice(codecPrefix.length + 1) : void 0;
  const canonicalDomain = OPERATION_DOMAINS.some((domain) => {
    const prefix = `${domain}.`;
    return value.startsWith(prefix) && isSegment(value.slice(prefix.length));
  });
  if (SHARED_OPERATION_IDS.includes(value) || canonicalDomain || localSuffix !== void 0 && isSegment(localSuffix)) {
    return value;
  }
  throw new TypeError(
    `operation id ${value} is outside shared, canonical domain, and ${codecPrefix} namespaces`
  );
}
function parseQualifiedId(value) {
  if (!isQualifiedId(value)) return void 0;
  const slash = value.indexOf("/");
  return { namespace: value.slice(0, slash), name: value.slice(slash + 1) };
}
var SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
function parseSafeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : void 0;
}
function parseSemver(value) {
  const m = SEMVER.exec(value);
  if (!m) return void 0;
  const major = parseSafeInteger(m[1] ?? "");
  const minor = parseSafeInteger(m[2] ?? "");
  const patch = parseSafeInteger(m[3] ?? "");
  if (major === void 0 || minor === void 0 || patch === void 0) return void 0;
  const prerelease = (m[4] ?? "").split(".").filter((part) => part.length > 0).map((part) => /^\d+$/.test(part) ? parseSafeInteger(part) : part);
  if (prerelease.some((part) => part === void 0)) return void 0;
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
  if (ap.length === 0 && bp.length === 0) return 0;
  if (ap.length === 0) return 1;
  if (bp.length === 0) return -1;
  const length = Math.min(ap.length, bp.length);
  for (let i = 0; i < length; i += 1) {
    const x = ap[i];
    const y = bp[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return ap.length === bp.length ? 0 : ap.length < bp.length ? -1 : 1;
}
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
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
function parsePartial(value) {
  const m = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|\*))?(?:\.(0|[1-9]\d*|x|\*))?$/.exec(value);
  if (!m) return void 0;
  const major = parseSafeInteger(m[1] ?? "");
  if (major === void 0) return void 0;
  const minorRaw = m[2];
  const patchRaw = m[3];
  const wild = (s) => s === "x" || s === "*";
  if (minorRaw === void 0 || wild(minorRaw)) {
    if (wild(minorRaw) && patchRaw !== void 0) return void 0;
    return { v: { major, minor: 0, patch: 0, prerelease: [], build: [] }, precision: 1 };
  }
  if (patchRaw === void 0 || wild(patchRaw)) {
    const minor2 = parseSafeInteger(minorRaw);
    if (minor2 === void 0) return void 0;
    return {
      v: { major, minor: minor2, patch: 0, prerelease: [], build: [] },
      precision: 2
    };
  }
  const minor = parseSafeInteger(minorRaw);
  const patch = parseSafeInteger(patchRaw);
  if (minor === void 0 || patch === void 0) return void 0;
  return {
    v: { major, minor, patch, prerelease: [], build: [] },
    precision: 3
  };
}
function parseSingle(token) {
  const opMatch = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(token);
  if (!opMatch) return void 0;
  const op = opMatch[1];
  const rest = (opMatch[2] ?? "").trim();
  const hasWildcard = /(?:^|\.)(?:x|\*)(?:\.|$)/.test(rest);
  if (op === "^") {
    if (hasWildcard) return void 0;
    const partial2 = parsePartial(rest);
    if (!partial2 || partial2.precision === 1) return void 0;
    const upper = caretUpperBound(partial2.v);
    if (upper === void 0) return void 0;
    return [
      { op: ">=", version: partial2.v },
      { op: "<", version: upper }
    ];
  }
  const partial = parsePartial(rest);
  if (!partial) return void 0;
  if (hasWildcard && op !== void 0) return void 0;
  if (op === void 0 || op === "=") {
    if (!hasWildcard && partial.precision !== 3) return void 0;
    if (partial.precision === 3) return [{ op: "=", version: partial.v }];
    const next = partial.precision === 1 ? partial.v.major + 1 : partial.v.minor + 1;
    if (!Number.isSafeInteger(next)) return void 0;
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
    if (!parsed) return void 0;
    comparators.push(...parsed);
  }
  return {
    raw,
    normalized: canonicalComparatorConjunction(comparators),
    comparators: [comparators]
  };
}
function versionRangeTargetsMajor(range, major) {
  if (!Number.isSafeInteger(major) || major < 0) return false;
  const start = { major, minor: 0, patch: 0, prerelease: [], build: [] };
  return range.comparators.every((conjunction) => {
    if (conjunction.length === 0) return true;
    const exact = conjunction.find((comparator) => comparator.op === "=");
    if (exact !== void 0) {
      return exact.version.major === major && conjunction.every((comparator) => matches(exact.version, comparator));
    }
    const nextMajor = major + 1;
    if (!Number.isSafeInteger(nextMajor)) return false;
    const end = { major: nextMajor, minor: 0, patch: 0, prerelease: [], build: [] };
    const crossesUpperBoundary = conjunction.some((comparator) => {
      if (comparator.op !== "<" && comparator.op !== "<=") return false;
      const boundary = compareSemver(comparator.version, end);
      return boundary > 0 || boundary === 0 && comparator.op === "<=";
    });
    if (crossesUpperBoundary) return false;
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
      if (comparison > 0 || comparison === 0 && candidate.op === ">") return candidate;
      return best;
    });
    const upper = uppers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version);
      if (comparison < 0 || comparison === 0 && candidate.op === "<") return candidate;
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
function satisfiesRange(version, range) {
  return range.comparators.some((conjunction) => conjunction.every((c) => matches(version, c)));
}
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
    if (options.context !== void 0) this.context = options.context;
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
function isModkitError(value) {
  return value instanceof ModkitError;
}
function diagnostic(severity, code, message, path, data, range) {
  return {
    code: errorCode(code),
    severity,
    message,
    ...path === void 0 ? {} : { path },
    ...range === void 0 ? {} : { range },
    ...data === void 0 ? {} : { data }
  };
}
function hasErrors(diagnostics) {
  return diagnostics.some((d) => d.severity === "error");
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const visit = (candidate) => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      visit(candidate[key]);
    }
    Object.freeze(candidate);
  };
  visit(value);
  return value;
}
var UINT64_MAX_DECIMAL = "18446744073709551615";
function fixedWidthDecimalAtMost(maximum) {
  const alternatives = [maximum];
  for (let index = 1; index < maximum.length; index += 1) {
    const maximumDigit = Number(maximum[index]);
    if (maximumDigit === 0) continue;
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
function isUInt64String(value) {
  return typeof value === "string" && uint64DecimalPattern.test(value);
}
function uint64(value) {
  const decimal = typeof value === "bigint" ? value.toString(10) : value;
  if (!isUInt64String(decimal)) {
    throw new RangeError(`expected canonical decimal u64, received: ${decimal}`);
  }
  return decimal;
}
var encoder = new TextEncoder();
function compareUtf8(a, b) {
  let ascii = true;
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i += 1) {
    if (a.charCodeAt(i) > 127 || b.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  }
  if (ascii && /^[\x00-\x7F]*$/.test(a) && /^[\x00-\x7F]*$/.test(b)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const length = Math.min(ab.length, bb.length);
  for (let i = 0; i < length; i += 1) {
    const x = ab[i];
    const y = bb[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  if (ab.length !== bb.length) return ab.length < bb.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
function sortedUtf8(values) {
  return [...values].sort(compareUtf8);
}
function uniqueSortedUtf8(values) {
  return sortedUtf8([...new Set(values)]);
}
function render(value, indent, depth, path) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new ModkitError({
          code: "x3.core/non-canonical-value",
          message: `non-finite number at ${path}`
        });
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new ModkitError({
        code: "x3.core/non-canonical-value",
        message: `${typeof value} is not canonical-JSON serializable at ${path}`
      });
  }
  const pad = indent.repeat(depth + 1);
  const closePad = indent.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item, i) => pad + render(item, indent, depth + 1, `${path}[${i}]`));
    return `[
${items.join(",\n")}
${closePad}]`;
  }
  const record = value;
  const keys = Object.keys(record).filter((key) => record[key] !== void 0).sort(compareUtf8);
  if (keys.length === 0) return "{}";
  const entries = keys.map(
    (key) => `${pad}${JSON.stringify(key)}: ${render(record[key], indent, depth + 1, `${path}.${key}`)}`
  );
  return `{
${entries.join(",\n")}
${closePad}}`;
}
function canonicalJsonStringify(value) {
  return `${render(value, "  ", 0, "$")}
`;
}
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
function throwIfAborted(signal) {
  if (signal?.aborted) throw new OperationCancelledError(signal.reason);
}
function isCancellation(value) {
  return value instanceof OperationCancelledError;
}
var DisposableStore = class {
  items = [];
  disposed = false;
  get isDisposed() {
    return this.disposed;
  }
  add(item) {
    if (this.disposed) {
      throw new ModkitError({
        code: "x3.core/store-disposed",
        message: "cannot add to a disposed DisposableStore"
      });
    }
    this.items.push(item);
    return item;
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const failures = [];
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      try {
        await this.items[i].dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    this.items.length = 0;
    if (failures.length > 0) {
      throw new ModkitError({
        code: "x3.core/dispose-failed",
        message: `${failures.length} disposable(s) failed to dispose`,
        context: { count: failures.length },
        cause: failures[0]
      });
    }
  }
};

export {
  __commonJS,
  __toESM,
  isSegment,
  isDottedId,
  isQualifiedId,
  isContractId,
  isErrorCode,
  isTraitId,
  contractId,
  errorCode,
  traitId,
  OPERATION_DOMAINS,
  SHARED_OPERATION_IDS,
  operationId,
  parseQualifiedId,
  parseSemver,
  compareSemver,
  parseVersionRange,
  versionRangeTargetsMajor,
  satisfiesRange,
  ModkitError,
  isModkitError,
  diagnostic,
  hasErrors,
  deepFreeze,
  UINT64_DECIMAL_PATTERN,
  sourceSpanSchema,
  isUInt64String,
  uint64,
  compareUtf8,
  sortedUtf8,
  uniqueSortedUtf8,
  canonicalJsonStringify,
  CANCELLED_CODE,
  OperationCancelledError,
  throwIfAborted,
  isCancellation,
  DisposableStore
};
