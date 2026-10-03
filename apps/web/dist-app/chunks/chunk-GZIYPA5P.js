import {
  AUXILIARY_DATA_SOURCE_SURFACES,
  STANDARD_DATA_SOURCE_SURFACES,
  STANDARD_EDITING_SURFACES
} from "./chunk-GXIKMRRL.js";
import {
  ModkitError,
  OperationCancelledError,
  isModkitError,
  isQualifiedId,
  isSegment
} from "./chunk-LX6GSJ3D.js";

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
  "revoke",
  "terminate"
];
var HANDLE_KINDS = ["lease", "iterator", "events"];
function isHandleId(value) {
  return HANDLE_ID.test(value);
}
function isSubscriptionId(value) {
  return SUBSCRIPTION_ID.test(value);
}
function isMethodName(value) {
  return METHOD_NAME.test(value);
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
function handleRef(id, kind, contract, data, has) {
  return Object.freeze({
    [HANDLE_MARKER]: Object.freeze({
      id,
      kind,
      ...contract === void 0 ? {} : { contract: contract.contract, major: contract.major },
      ...data === void 0 ? {} : { data },
      ...has === void 0 ? {} : { has: Object.freeze([...has]) }
    })
  });
}
function isPresentList(value) {
  return Array.isArray(value) && value.length <= MAX_OPTIONAL_METHODS && value.every((item) => typeof item === "string" && isMethodName(item)) && new Set(value).size === value.length;
}
function isHandleRef(value) {
  if (!isPlainObject(value))
    return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== HANDLE_MARKER)
    return false;
  const inner = value[HANDLE_MARKER];
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
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
var DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  maxDepth: 32,
  // Resolved game catalogs legitimately carry tens of thousands of definitions and field nodes
  // in one pinned snapshot. The byte, array, object-key, deadline and worker-memory ceilings still
  // bound the frame; this node ceiling prevents valid schemas from being rejected first.
  maxNodes: 4e6,
  // As large as a frame: a pixel operation carries its image as base64 in its JSON input (a 1024²
  // RGBA image is 5.6 M characters). ponytail: an image past ~3500² needs bytes in operation input.
  maxStringLength: 64 * 1024 * 1024,
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
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 0) {
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
function validateInner(value, limits, measure, depth, path, handles) {
  measure.nodes += 1;
  if (measure.nodes > limits.maxNodes) {
    return { code: "nodes-exceeded", message: `value has more than ${limits.maxNodes} nodes` };
  }
  if (depth > limits.maxDepth) {
    return { code: "depth-exceeded", message: `value nests deeper than ${limits.maxDepth}`, path };
  }
  switch (typeof value) {
    case "boolean":
    case "bigint":
      return void 0;
    case "undefined":
      return depth === 0 ? { code: "bad-value", message: "undefined is not a wire value", path } : void 0;
    case "number":
      return Number.isFinite(value) ? void 0 : { code: "bad-value", message: "non-finite number", path };
    case "string":
      return value.length <= limits.maxStringLength ? void 0 : { code: "string-too-long", message: `string longer than ${limits.maxStringLength}`, path };
    case "object":
      break;
    default:
      return { code: "bad-value", message: `${typeof value} is not a wire value`, path };
  }
  if (value === null)
    return void 0;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const kind = value.constructor.name;
    if (wireTypedArrayCode(value) === void 0) {
      return { code: "bad-value", message: `${kind} is not a wire value`, path };
    }
    if (SHARED !== void 0 && value.buffer instanceof SHARED) {
      return {
        code: "shared-buffer",
        message: "SharedArrayBuffer-backed bytes are not transferable",
        path
      };
    }
    if (value.buffer.detached === true) {
      return {
        code: "bad-value",
        message: `a ${kind} over a detached buffer cannot cross (it was transferred already)`,
        path
      };
    }
    if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
      return {
        code: "partial-typed-array",
        message: `a ${kind} must own its whole buffer (slice() before sending)`,
        path
      };
    }
    measure.bytes += value.byteLength;
    if (measure.bytes > limits.maxTransferBytes) {
      return {
        code: "transfer-too-large",
        message: `frame carries more than ${limits.maxTransferBytes} bytes`,
        path
      };
    }
    measure.buffers.push(value.buffer);
    return void 0;
  }
  if (value instanceof DataView || value instanceof ArrayBuffer) {
    return {
      code: "bad-value",
      message: "binary payloads must be a typed array that names its element type",
      path
    };
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      return { code: "array-too-long", message: `array longer than ${limits.maxArrayLength}`, path };
    }
    for (let index = 0; index < value.length; index += 1) {
      const found = validateInner(value[index], limits, measure, depth + 1, [...path, index], handles);
      if (found !== void 0)
        return found;
    }
    return void 0;
  }
  if (!isPlainObject(value)) {
    return { code: "bad-value", message: "only plain data objects may cross the boundary", path };
  }
  if (Object.hasOwn(value, HANDLE_MARKER)) {
    if (handles === "forbid") {
      return {
        code: "handle-not-allowed",
        message: "a handle ref is not allowed at this position",
        path
      };
    }
    if (!isHandleRef(value))
      return { code: "bad-handle", message: "malformed handle ref", path };
    const data = value[HANDLE_MARKER].data;
    return data === void 0 ? void 0 : validateInner(data, limits, measure, depth + 1, [...path, HANDLE_MARKER, "data"], "forbid");
  }
  const keys = Object.keys(value);
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
    const found = validateInner(value[key], limits, measure, depth + 1, [...path, key], handles);
    if (found !== void 0)
      return found;
  }
  return void 0;
}
function validateWireValue(value, limits, handles = "forbid", path = []) {
  const measure = { nodes: 0, bytes: 0, buffers: [] };
  if (handles === "top" && isHandleRef(value)) {
    const data = value[HANDLE_MARKER].data;
    const found2 = data === void 0 ? void 0 : validateInner(data, limits, measure, 1, [...path, HANDLE_MARKER, "data"], "forbid");
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
  const found = validateInner(value, limits, measure, 0, [...path], handles === "nested" ? "allow" : "forbid");
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
function validateErrorDto(value, limits, path = []) {
  if (!isPlainObject(value))
    return violation("bad-error", "error must be an object", path);
  const record = value;
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
  revoke: { required: ["handle"], optional: [] },
  terminate: { required: ["reason"], optional: [] }
};
function isMessageId(value) {
  return Number.isSafeInteger(value) && value >= 1;
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
        const bad2 = str(key, (value) => value.length <= limits.maxStringLength);
        if (bad2)
          return bad2;
      }
      if (record["entrypointDigest"] !== void 0) {
        const bad2 = str("entrypointDigest", (value) => value.length <= 256);
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
    case "release":
    case "revoke": {
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
      const bad = str("reason", (value) => value.length <= 1024);
      if (bad)
        return bad;
      break;
    }
  }
  return { ok: true, value: record };
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
  push(id, value) {
    const record = this.records.get(id);
    if (record === void 0 || record.closed)
      return "unknown";
    if (record.queue.length >= this.limits.maxQueuedEvents)
      return "overflow";
    record.queue.push(value);
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

// packages/host/dist/execution/surface.js
function surfaceKey(contract, major) {
  return `${contract}@${major}`;
}
function isKeyRef(value) {
  return typeof value === "object" && value !== null && Number.isSafeInteger(value.arg) && value.arg >= 0 && typeof value.key === "string" && isMethodName(value.key);
}
function isArgRef(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 || isKeyRef(value);
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
  const batchItems = raw.batchItems;
  const deadlineMs = raw.deadlineMs;
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
  if (batchItems !== void 0 && (kind !== "iterable" || !Number.isSafeInteger(batchItems) || batchItems < 1)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid batchItems`, { surface });
  }
  if (deadlineMs !== void 0 && (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0)) {
    return invalidSurface(`method \xAB${name}\xBB has an invalid deadline`, { surface });
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
    ...batchItems === void 0 ? {} : { batchItems },
    ...deadlineMs === void 0 ? {} : { deadlineMs },
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

// packages/host/dist/execution/endpoint.js
var CAPABILITY_OF = /* @__PURE__ */ Symbol.for("x3.host/rpc/proxied-remote");
var RemoteCapabilityImpl = class {
  endpoint;
  ref;
  contract;
  major;
  data;
  constructor(endpoint, ref, contract, major, data = Object.freeze({})) {
    this.endpoint = endpoint;
    this.ref = ref;
    this.contract = contract;
    this.major = major;
    this.data = data;
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
function normalizeProgress(value) {
  if (typeof value !== "object" || value === null)
    return void 0;
  const record = value;
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
        async return(value) {
          if (iterator === void 0)
            return { done: true, value };
          return await iterator.return?.(value) ?? { done: true, value };
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
function isAbortSignal(value) {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}
function isAsyncIterable(value) {
  return typeof value === "object" && value !== null && typeof value[Symbol.asyncIterator] === "function";
}
function isLeaseLike(value) {
  return typeof value === "object" && value !== null && "value" in value && typeof value.release === "function";
}
var EndpointImpl = class _EndpointImpl {
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
  /**
   * The highest peer sequence released per `<owner><generation>`. A released handle leaves the
   * live tables entirely — it must not hold a slot under `maxHandles` or keep its proxy alive for
   * the life of the session — and the peer allocates sequences monotonically, so one watermark
   * per generation still refuses a reused id without retaining anything per handle.
   */
  retiredRemote = /* @__PURE__ */ new Map();
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
      remoteHandles: this.remote.size,
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
    const data = this.fieldData(target, surface);
    const has = this.presentOptional(target, surface);
    const record = this.table.allocate({
      kind: "lease",
      target,
      release,
      contract: surface.contract,
      major: surface.major
    });
    return new LocalCapabilityImpl(this, handleRef(record.id, "lease", surface, data, has), surface.contract, surface.major);
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
    if (this.retiredRemoteHandle(inner.id)) {
      throw this.failWith({ code: "bad-handle", message: `handle ${inner.id} was released` });
    }
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
          const value = holder[ref.key];
          const matches = expect === "signal" ? isAbortSignal(value) : typeof value === "function";
          if (!matches && value !== void 0)
            return void 0;
          args[ref.arg] = Object.fromEntries(Object.entries(holder).filter(([key]) => key !== ref.key));
          return value;
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
          ...onProgress === void 0 ? {} : { onProgress },
          ...method.deadlineMs === void 0 ? {} : { deadlineMs: method.deadlineMs }
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
    this.remote.clear();
    this.remoteProxies.clear();
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
    const measure = (value, handles, move) => {
      const checked = validateWireValue(value, this.limits, handles);
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
    const encode = (value, path) => {
      if (value instanceof RemoteCapabilityImpl || value instanceof LocalCapabilityImpl) {
        if (value.isReleased) {
          throw new ModkitError({
            code: "x3.host/rpc-released-handle",
            message: `argument ${path} is a released capability`
          });
        }
        return value.ref;
      }
      if (typeof value === "object" && value !== null && CAPABILITY_OF in value) {
        return encode(value[CAPABILITY_OF], path);
      }
      if (isHandleRef(value))
        return value;
      if (Array.isArray(value))
        return value.map((item, index) => encode(item, `${path}[${index}]`));
      if (isPlainObject(value)) {
        const out = {};
        for (const [key, item] of Object.entries(value))
          out[key] = encode(item, `${path}.${key}`);
        return out;
      }
      return value;
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
    if (this.remote.has(inner.id) || this.retiredRemoteHandle(inner.id))
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
  /** Splits a validated handle id into its `<owner><generation>` prefix and sequence. */
  static parseRemoteId(id) {
    const cut = id.lastIndexOf("-");
    if (cut <= 0)
      return void 0;
    const sequence = Number(id.slice(cut + 1));
    return Number.isSafeInteger(sequence) ? { prefix: id.slice(0, cut), sequence } : void 0;
  }
  retiredRemoteHandle(id) {
    const parsed = _EndpointImpl.parseRemoteId(id);
    if (parsed === void 0)
      return false;
    const watermark = this.retiredRemote.get(parsed.prefix);
    return watermark !== void 0 && parsed.sequence <= watermark;
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
    this.remote.delete(id);
    this.remoteProxies.delete(id);
    const parsed = _EndpointImpl.parseRemoteId(id);
    if (parsed === void 0)
      return;
    const watermark = this.retiredRemote.get(parsed.prefix);
    if (watermark === void 0 || parsed.sequence > watermark) {
      this.retiredRemote.set(parsed.prefix, parsed.sequence);
    }
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
    const batch = Math.min(Math.max(this.limits.iteratorBatchItems, decl.batchItems ?? 1), this.limits.maxArrayLength);
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
    if (result.released && this.state === "open")
      this.trySend({ t: "revoke", handle: id });
  }
  decodeArgs(args) {
    const decode = (value) => {
      if (isHandleRef(value)) {
        const inner = value[HANDLE_MARKER];
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
        return this.materialize(this.proxy(value));
      }
      if (Array.isArray(value))
        return value.map((item) => decode(item));
      if (isPlainObject(value)) {
        const out = {};
        for (const [key, item] of Object.entries(value))
          out[key] = decode(item);
        return out;
      }
      return value;
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
      case "revoke":
        if (this.table.owns(frame.handle)) {
          this.fail({ code: "bad-handle", message: `peer revoked handle ${frame.handle} this side owns` });
          return;
        }
        this.markRemoteReleased(frame.handle);
        return;
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
        const value = lease === void 0 ? result : lease.value;
        const resultSurface = dynamicResult ?? decl.result;
        if (typeof value !== "object" || value === null || resultSurface === void 0) {
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
          const data = this.fieldData(value, resultSurface);
          const has = this.presentOptional(value, resultSurface);
          const child = this.table.allocate({
            kind: "lease",
            target: value,
            release: lease === void 0 ? noopRelease : () => lease.release(),
            contract: resultSurface.contract,
            major: resultSurface.major,
            parent: record.id
          });
          this.reply(frame.id, {
            kind: "handle",
            value: handleRef(child.id, "lease", resultSurface, data, has)
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
  placeInArg(args, ref, value) {
    while (args.length <= ref.arg)
      args.push(void 0);
    const holder = args[ref.arg];
    const base = typeof holder === "object" && holder !== null ? holder : {};
    args[ref.arg] = { ...base, [ref.key]: value };
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
    const data = {};
    for (const field of fields) {
      const value = target[field];
      if (value === void 0)
        continue;
      const checked = validateWireValue(value, this.limits, "forbid");
      if (!checked.ok) {
        throw new ModkitError({
          code: "x3.host/rpc-bad-return",
          message: `field \xAB${field}\xBB of ${surface.contract}@${surface.major} is not a wire value: ${checked.violation.message}`
        });
      }
      data[field] = value;
    }
    return Object.keys(data).length === 0 ? void 0 : Object.freeze(data);
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

// packages/host/dist/execution/message-port.js
function framePortFromMessagePort(port, options = {}) {
  const style = options.listener ?? (typeof port.addEventListener === "function" ? "event-target" : "emitter-value");
  const moves = (options.transfer ?? (style === "emitter-event" ? "copy" : "move")) === "move";
  return {
    post(frame, transfer) {
      if (moves)
        port.postMessage(frame, [...transfer]);
      else
        port.postMessage(frame);
    },
    onFrame(handler) {
      if (style === "event-target") {
        const listener2 = (event) => handler("data" in event ? event.data : void 0);
        port.addEventListener?.("message", listener2);
        port.start?.();
        return () => port.removeEventListener?.("message", listener2);
      }
      const listener = style === "emitter-value" ? (payload) => handler(payload) : (payload) => handler(typeof payload === "object" && payload !== null && "data" in payload ? payload.data : payload);
      port.on?.("message", listener);
      port.start?.();
      return () => port.off?.("message", listener);
    }
  };
}

// packages/host/dist/execution/frame-json.js
function base64Of(bytes) {
  if (typeof Buffer === "function")
    return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}
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
var ABI_RASTER_RESOURCES = { contract: "x3.abi/raster-resources", major: 1 };
var ABI_MODEL_RESOURCES = { contract: "x3.abi/model-resources", major: 1 };
var ABI_INSTALLATION_PROBES = { contract: "x3.abi/installation-probes", major: 1 };
var ABI_VIDEO_FRAMES = { contract: "x3.abi/video-frames", major: 1 };
var ABI_INSTALLATION_FILES = { contract: "x3.abi/installation-files", major: 1 };
var ABI_SUBJECT_CATALOG = { contract: "x3.abi/subject-catalog", major: 1 };
var ABI_CREDENTIALS = { contract: "x3.abi/credentials", major: 1 };
var ABI_MODEL_RESOURCE_ASSET = {
  contract: "x3.abi/model-resource-asset",
  major: 1
};
var ABI_LOGICAL_RESOURCES = { contract: "x3.abi/logical-resources", major: 1 };
var ABI_LOGICAL_RESOURCE_RESOLUTION = {
  contract: "x3.abi/logical-resource-resolution",
  major: 1
};
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
    list: { kind: "iterable", batchItems: 512, ...sig },
    readPreamble: { kind: "value", optional: true, ...sig },
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
var rasterResourcesSurface = {
  ...ABI_RASTER_RESOURCES,
  methods: { read: { kind: "value", ...sig } }
};
var installationProbesSurface = {
  ...ABI_INSTALLATION_PROBES,
  methods: {
    registryValues: { kind: "value", ...sig },
    steamAppDir: { kind: "value", ...sig },
    epicInstallLocation: { kind: "value", ...sig },
    gogInstallPath: { kind: "value", ...sig },
    storePackageLocation: { kind: "value", ...sig },
    knownFolder: { kind: "value", ...sig }
  }
};
var videoFramesSurface = {
  ...ABI_VIDEO_FRAMES,
  methods: { decodeFrame: { kind: "value", signal: { arg: 0, key: "signal" } } }
};
var installationFilesSurface = {
  ...ABI_INSTALLATION_FILES,
  methods: {
    size: { kind: "value", signal: { arg: 0, key: "signal" } },
    read: { kind: "value", signal: { arg: 0, key: "signal" } }
  }
};
var subjectCatalogSurface = {
  ...ABI_SUBJECT_CATALOG,
  methods: {
    entities: { kind: "value", arity: 2, ...sig },
    strings: { kind: "value", arity: 3, optional: true, ...sig }
  }
};
var credentialsSurface = {
  ...ABI_CREDENTIALS,
  methods: {
    status: { kind: "value", arity: 2, ...sig },
    acquire: { kind: "value", arity: 2, ...sig },
    fetch: { kind: "value", arity: 2, ...sig },
    secret: { kind: "value", arity: 2, ...sig },
    remember: { kind: "value", arity: 3, ...sig },
    forget: { kind: "value", arity: 2, ...sig }
  }
};
var modelAcquire = {
  kind: "lease",
  result: ABI_MODEL_RESOURCE_ASSET,
  wrapper: "lease",
  ...sig
};
var modelResourcesSurface = {
  ...ABI_MODEL_RESOURCES,
  methods: { acquire: modelAcquire }
};
var modelResourceAssetSurface = {
  ...ABI_MODEL_RESOURCE_ASSET,
  fields: ["result"],
  methods: {
    acquire: modelAcquire,
    readRaster: { kind: "value", ...sig },
    sceneInfo: { kind: "value", optional: true, ...sig },
    nodes: { kind: "value", optional: true, ...sig },
    meshes: { kind: "value", optional: true, ...sig },
    primitive: { kind: "value", optional: true, ...sig },
    skeletonBindings: { kind: "value", optional: true, ...sig },
    animationClips: { kind: "value", optional: true, ...sig },
    materials: { kind: "value", optional: true, ...sig },
    resourceReferences: { kind: "value", optional: true, ...sig },
    sockets: { kind: "value", optional: true, ...sig }
  }
};
var logicalResourcesSurface = {
  ...ABI_LOGICAL_RESOURCES,
  methods: {
    discover: { kind: "value", ...sig },
    readBatch: { kind: "value", ...sig },
    resolve: { kind: "lease", result: ABI_LOGICAL_RESOURCE_RESOLUTION, wrapper: "lease", ...sig },
    provenance: { kind: "value", ...sig },
    identity: { kind: "value", ...sig }
  }
};
var logicalResourceResolutionSurface = {
  ...ABI_LOGICAL_RESOURCE_RESOLUTION,
  fields: ["result"],
  methods: { openSource: { kind: "lease", result: ABI_ARTIFACT_SOURCE, wrapper: "lease", ...sig } }
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
  contractResolverSurface,
  rasterResourcesSurface,
  installationProbesSurface,
  videoFramesSurface,
  installationFilesSurface,
  subjectCatalogSurface,
  credentialsSurface,
  modelResourcesSurface,
  modelResourceAssetSurface,
  logicalResourcesSurface,
  logicalResourceResolutionSurface
]);

// packages/host/dist/execution/surface-adapter.js
function walkStrings(value, max) {
  if (typeof value === "string") {
    return value.length > max ? `a string is longer than ${max}` : void 0;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = walkStrings(item, max);
      if (problem !== void 0)
        return problem;
    }
    return void 0;
  }
  if (typeof value === "object" && value !== null && !(value instanceof Uint8Array)) {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > max)
        return `a key is longer than ${max}`;
      const problem = walkStrings(item, max);
      if (problem !== void 0)
        return problem;
    }
  }
  return void 0;
}
function countBytes(value) {
  if (value instanceof Uint8Array)
    return value.byteLength;
  if (Array.isArray(value))
    return value.reduce((sum, item) => sum + countBytes(item), 0);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).reduce((sum, item) => sum + countBytes(item), 0);
  }
  return 0;
}
function limitValidators(limits) {
  const { maxStringLength, maxBytes, maxPageItems } = limits;
  const validateArgs = maxStringLength === void 0 ? void 0 : (args) => walkStrings(args, maxStringLength);
  const validateReturn = maxStringLength === void 0 && maxBytes === void 0 && maxPageItems === void 0 ? void 0 : (value) => {
    if (maxStringLength !== void 0) {
      const problem = walkStrings(value, maxStringLength);
      if (problem !== void 0)
        return problem;
    }
    if (maxBytes !== void 0 && countBytes(value) > maxBytes) {
      return `result carries more than ${maxBytes} bytes`;
    }
    if (maxPageItems !== void 0 && typeof value === "object" && value !== null && !Array.isArray(value) && Array.isArray(value.items) && value.items.length > maxPageItems) {
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
  const editingSurfaces = {
    ...STANDARD_EDITING_SURFACES,
    "common.edit/writer": {
      ...STANDARD_EDITING_SURFACES["common.edit/writer"],
      methods: {
        ...STANDARD_EDITING_SURFACES["common.edit/writer"].methods,
        snapshotNativePreservingMpq: { kind: "value", optional: true, arity: 1 }
      }
    }
  };
  for (const table of [
    STANDARD_DATA_SOURCE_SURFACES,
    AUXILIARY_DATA_SOURCE_SURFACES,
    editingSurfaces
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

// packages/host/dist/execution/logical-resources.js
function logicalResourcesFromWire(wire) {
  return Object.freeze({
    identity: wire.identity.bind(wire),
    discover: wire.discover.bind(wire),
    readBatch: wire.readBatch.bind(wire),
    provenance: wire.provenance.bind(wire),
    async resolve(requirement, signal) {
      const handle = await wire.resolve(requirement, signal);
      try {
        const result = handle.value.result;
        if (result.state === "unresolved") {
          await handle.release();
          return result;
        }
        const source = await handle.value.openSource(signal);
        let released = false;
        return {
          ...result,
          lease: {
            value: source.value,
            async release() {
              if (released)
                return;
              released = true;
              try {
                await source.release();
              } finally {
                await handle.release();
              }
            }
          }
        };
      } catch (error) {
        await handle.release();
        throw error;
      }
    }
  });
}

export {
  protocolLimits,
  createEndpoint,
  framePortFromMessagePort,
  base64Of,
  ABI_CODEC_MODULE,
  ABI_SERVICE_PROVIDER_MODULE,
  ABI_ASSET_SESSION,
  createStandardSurfaceRegistry,
  logicalResourcesFromWire
};
