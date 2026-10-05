/**
 * Capability-RPC protocol v1 — wire vocabulary and validators (NXT-105, plan §6; owners:
 * MK3/24 §6.1 SB-1 boundary, §13 budgets/cancellation, §12 secrets; MK3/23 §3 grammars).
 *
 * This is the transport-agnostic *private* protocol between a host endpoint and an execution
 * endpoint (Node worker, browser worker, Electron preload/IPC). It is not part of the public SDK
 * ABI: extensions never see frames — they see the runtime ABI objects a proxy reconstructs.
 *
 * Design rules fixed here (review REVIEW_FABLE_NEXT_A2_A3 F-01/F-02/F-12):
 *  - every frame carries an exact-key envelope `{domain, version, session, generation, id}`;
 *    generation increments on worker restart so a stale reply can never satisfy a live call;
 *  - values crossing the boundary are JSON-safe data, `bigint`, whole typed arrays (transferred,
 *    never a view over a larger/shared buffer) and opaque handle refs — nothing else; functions,
 *    class instances, prototypes, paths, credentials and `AbortSignal` never cross;
 *  - validators are exact-key and prototype-safe (`__proto__`, `constructor`, `prototype` are
 *    rejected as keys) and enforce depth/node/string/array/transfer limits. Wire traversal uses
 *    one request-local path; only a reported violation retains a copied diagnostic path;
 *  - a handle ref is only meaningful where the method surface says a handle is expected; the
 *    marker key is `@x3.handle` and any other object carrying that key is a violation;
 *  - errors travel as a bounded DTO built from `ModkitError.toJSON()`; cancellation stays a
 *    distinct outcome (`cancelled: true`) and never turns into a generic failure; stacks never
 *    cross the boundary.
 *
 * Nothing in this file touches a transport, a worker or the public SDK surface.
 */

import {
  isModkitError,
  isQualifiedId,
  isSegment,
  ModkitError,
  OperationCancelledError,
  type Retryability,
} from '@modkit/core'

// ---------------------------------------------------------------------------------------------
// constants and grammars

export const CAPABILITY_RPC_DOMAIN = 'x3.host/rpc'
export const CAPABILITY_RPC_VERSION = 1

/** Marker key of an opaque handle reference inside a wire value. */
export const HANDLE_MARKER = '@x3.handle'

/**
 * Handle ids are `<owner><generation>-<sequence>` where owner is `h` (allocated by the host
 * endpoint) or `w` (allocated by the executing/worker endpoint); decimal, no leading zeros. The
 * owner prefix is what lets an endpoint tell its own handles from the peer's without a table.
 */
const HANDLE_ID = /^[hw](?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u
/** Subscription ids are `<owner>s<generation>-<sequence>`, allocated by the pushing side. */
const SUBSCRIPTION_ID = /^[hw]s(?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/u
/** Method names: lowerCamel, no dots (dots would look like operation ids). */
const METHOD_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/u
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const FRAME_TYPES = [
  'load',
  'ready',
  'call',
  'return',
  'throw',
  'cancel',
  'next',
  'done',
  'subscribe',
  'event',
  'unsubscribe',
  'progress',
  'release',
  'revoke',
  'terminate',
] as const

export type FrameType = (typeof FRAME_TYPES)[number]
export type HandleKind = 'lease' | 'iterator' | 'events'
const HANDLE_KINDS: readonly HandleKind[] = ['lease', 'iterator', 'events']

export function isHandleId(value: string): boolean {
  return HANDLE_ID.test(value)
}

export function isSubscriptionId(value: string): boolean {
  return SUBSCRIPTION_ID.test(value)
}

export function isMethodName(value: string): boolean {
  return METHOD_NAME.test(value)
}

// ---------------------------------------------------------------------------------------------
// wire values

export type WireScalar = null | boolean | number | string | bigint
/** Inside objects/arrays `undefined` is tolerated as "absent" (structured-clone preserves it). */
export type WireValue =
  WireScalar | WireTypedArray | readonly WireValue[] | { readonly [key: string]: WireValue }

/**
 * The typed arrays a wire value may carry, and the short code each travels under on a transport
 * that cannot carry them natively (the JSON codec tags with these; structured clone needs no help).
 *
 * The set is closed on purpose. A structured-clone transport would happily carry a `DataView`, but
 * a view that names no element type crosses as bytes whose reading is a matter of convention
 * between the two ends — exactly the kind of implicit agreement this protocol exists to remove.
 * Everything here names its element type and its length in elements.
 *
 * `Uint8Array` keeps the code `bytes` it has always had on the JSON wire; nothing that already
 * crossed changes shape.
 */
export const WIRE_TYPED_ARRAYS = Object.freeze({
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
  u64: BigUint64Array,
} as const)

export type WireTypedArrayCode = keyof typeof WIRE_TYPED_ARRAYS

export type WireTypedArray =
  | Uint8Array
  | Int8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

/** The code for a view's exact kind, or `undefined` when this is not a wire typed array. */
export function wireTypedArrayCode(view: ArrayBufferView): WireTypedArrayCode | undefined {
  for (const [code, constructor] of Object.entries(WIRE_TYPED_ARRAYS)) {
    // exact constructor, not `instanceof`: a subclass carries behaviour the far side would not
    // reconstruct, so it must not silently become its base kind
    if (view.constructor === constructor) return code as WireTypedArrayCode
  }
  return undefined
}

/** Opaque reference to a capability living on the other side of the boundary. */
export interface HandleRef {
  readonly [HANDLE_MARKER]: {
    readonly id: string
    readonly kind: HandleKind
    /** Surface identity of the leased capability (absent for iterators/events). */
    readonly contract?: string
    readonly major?: number
    /**
     * Data properties the surface declares as `fields`, copied by the side that created the
     * handle (a handle-free wire object). Lets data+method hybrids cross as one ref, wherever the
     * ref travels — lease results, `ready.root`, capabilities passed as arguments.
     */
    readonly data?: Readonly<Record<string, WireValue>>
    /**
     * Protocol 1.1: the surface's *optional* methods this particular object implements, listed by
     * the side that created the handle. Absent when the surface declares no optional method (or
     * the creator predates 1.1): the consumer then defines every declared method and an absent
     * implementation answers `x3.host/rpc-method-unavailable`. Present (possibly empty): the
     * consumer defines exactly the required methods plus these.
     */
    readonly has?: readonly string[]
  }
}

/** Upper bound on `has` entries (a surface never declares more optional methods than this). */
export const MAX_OPTIONAL_METHODS = 64

export function handleRef(
  id: string,
  kind: HandleKind,
  contract?: { readonly contract: string; readonly major: number },
  data?: Readonly<Record<string, WireValue>>,
  has?: readonly string[],
): HandleRef {
  return Object.freeze({
    [HANDLE_MARKER]: Object.freeze({
      id,
      kind,
      ...(contract === undefined ? {} : { contract: contract.contract, major: contract.major }),
      ...(data === undefined ? {} : { data }),
      ...(has === undefined ? {} : { has: Object.freeze([...has]) }),
    }),
  })
}

function isPresentList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_OPTIONAL_METHODS &&
    value.every(item => typeof item === 'string' && isMethodName(item)) &&
    new Set(value).size === value.length
  )
}

export function isHandleRef(value: unknown): value is HandleRef {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== HANDLE_MARKER) return false
  const inner = (value as Record<string, unknown>)[HANDLE_MARKER]
  if (!isPlainObject(inner)) return false
  const record = inner as Record<string, unknown>
  const innerKeys = Object.keys(inner)
    .filter(key => key !== 'data' && key !== 'has')
    .sort()
  const base = ['id', 'kind']
  const withContract = ['contract', 'id', 'kind', 'major']
  const shape =
    innerKeys.join(',') === base.join(',') || innerKeys.join(',') === withContract.join(',')
  if (!shape) return false
  if (record['data'] !== undefined && !isPlainObject(record['data'])) return false
  if (record['has'] !== undefined && !isPresentList(record['has'])) return false
  if (typeof record['id'] !== 'string' || !isHandleId(record['id'])) return false
  if (typeof record['kind'] !== 'string' || !HANDLE_KINDS.includes(record['kind'] as HandleKind))
    return false
  if (innerKeys.length === 4) {
    if (typeof record['contract'] !== 'string' || !isQualifiedId(record['contract'])) return false
    if (!Number.isSafeInteger(record['major']) || (record['major'] as number) < 0) return false
  }
  return true
}

/** A plain data object: `Object.prototype` or null prototype, nothing else. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

// ---------------------------------------------------------------------------------------------
// limits

export interface ProtocolLimits {
  /** Maximum nesting depth of a wire value (arrays/objects). */
  readonly maxDepth: number
  /** Maximum number of nodes (scalars + containers) in one wire value. */
  readonly maxNodes: number
  readonly maxStringLength: number
  readonly maxArrayLength: number
  readonly maxObjectKeys: number
  /** Maximum total typed-array bytes carried by one frame. */
  readonly maxTransferBytes: number
  /** Maximum number of call arguments. */
  readonly maxArgs: number
  /** Concurrency/lifecycle limits enforced by the endpoints (per session/generation). */
  readonly maxPendingCalls: number
  readonly maxHandles: number
  readonly maxIterators: number
  readonly maxSubscriptions: number
  readonly maxQueuedEvents: number
  /** Default per-call deadline when the caller passes none; 0 disables. */
  readonly defaultCallDeadlineMs: number
  /**
   * Protocol 1.1: how many items a consumer asks for per `next` (`next.max`). Default 1 keeps the
   * item-per-round-trip pull byte-identical to 1.0; a consumer that raises it opts into batching.
   * Bounded by `maxArrayLength` — a batch reply is one array value.
   */
  readonly iteratorBatchItems: number
}

export const DEFAULT_PROTOCOL_LIMITS: ProtocolLimits = Object.freeze({
  maxDepth: 32,
  // Resolved game catalogs legitimately carry tens of thousands of definitions and field nodes
  // in one pinned snapshot. The byte, array, object-key, deadline and worker-memory ceilings still
  // bound the frame; this node ceiling prevents valid schemas from being rejected first.
  maxNodes: 4_000_000,
  // As large as a frame: a pixel operation carries its image as base64 in its JSON input (a 1024²
  // RGBA image is 5.6 M characters). ponytail: an image past ~3500² needs bytes in operation input.
  maxStringLength: 64 * 1024 * 1024,
  maxArrayLength: 100_000,
  maxObjectKeys: 10_000,
  maxTransferBytes: 64 * 1024 * 1024,
  maxArgs: 16,
  maxPendingCalls: 256,
  maxHandles: 4096,
  maxIterators: 256,
  maxSubscriptions: 64,
  maxQueuedEvents: 1024,
  defaultCallDeadlineMs: 30_000,
  iteratorBatchItems: 1,
})

export function protocolLimits(overrides: Partial<ProtocolLimits> = {}): ProtocolLimits {
  const merged = { ...DEFAULT_PROTOCOL_LIMITS, ...overrides }
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ModkitError({
        code: 'x3.host/rpc-invalid-limits',
        message: `protocol limit ${key} must be a non-negative safe integer`,
        context: { key },
      })
    }
  }
  if (merged.iteratorBatchItems < 1 || merged.iteratorBatchItems > merged.maxArrayLength) {
    throw new ModkitError({
      code: 'x3.host/rpc-invalid-limits',
      message: 'protocol limit iteratorBatchItems must be between 1 and maxArrayLength',
      context: { key: 'iteratorBatchItems' },
    })
  }
  return Object.freeze(merged)
}

// ---------------------------------------------------------------------------------------------
// violations

export type ProtocolViolationCode =
  | 'not-an-object'
  | 'unknown-key'
  | 'missing-key'
  | 'bad-envelope'
  | 'bad-type'
  | 'bad-id'
  | 'bad-handle'
  | 'bad-subscription'
  | 'bad-method'
  | 'bad-value'
  | 'forbidden-key'
  | 'reserved-key'
  | 'depth-exceeded'
  | 'nodes-exceeded'
  | 'string-too-long'
  | 'array-too-long'
  | 'too-many-keys'
  | 'transfer-too-large'
  | 'partial-typed-array'
  | 'shared-buffer'
  | 'too-many-args'
  | 'bad-error'
  | 'bad-progress'
  | 'non-monotonic-id'
  | 'unknown-reply-target'
  | 'duplicate-reply'
  | 'unknown-handle'
  | 'stale-generation'
  | 'released-handle'
  | 'wrong-handle-kind'
  | 'iterator-busy'
  | 'unknown-subscription'
  | 'events-overflow'
  | 'limit-exceeded'
  | 'unexpected-frame'
  | 'unknown-method'
  | 'unknown-surface'
  | 'bad-argument'
  | 'bad-return'
  | 'handle-not-allowed'
  | 'endpoint-closed'

export interface ProtocolViolation {
  readonly code: ProtocolViolationCode
  readonly message: string
  /** JSON-pointer-like path into the offending frame/value; never carries payload bytes. */
  readonly path?: readonly (string | number)[]
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly violation: ProtocolViolation }

export function violation(
  code: ProtocolViolationCode,
  message: string,
  path?: readonly (string | number)[],
): { readonly ok: false; readonly violation: ProtocolViolation } {
  return {
    ok: false,
    violation: Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }),
  }
}

/** Structured error a caller receives when a protocol violation aborts an endpoint. */
export function protocolViolationError(item: ProtocolViolation): ModkitError {
  return new ModkitError({
    code: 'x3.host/rpc-protocol-violation',
    message: `capability-rpc protocol violation: ${item.message}`,
    context: {
      violation: item.code,
      ...(item.path === undefined ? {} : { path: [...item.path] }),
    },
  })
}

// ---------------------------------------------------------------------------------------------
// wire value validation

export interface WireValueMeasure {
  readonly nodes: number
  readonly transferBytes: number
  /** Whole typed-array buffers found; a transport moves them instead of copying. */
  readonly transferables: readonly ArrayBuffer[]
}

interface Measure {
  nodes: number
  bytes: number
  buffers: ArrayBuffer[]
}

const SHARED = typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer : undefined

/** Validate every wire node with one local path; a failure returns before any path unwinding. */
function validateInner(
  value: unknown,
  limits: ProtocolLimits,
  measure: Measure,
  depth: number,
  path: (string | number)[],
  handles: 'forbid' | 'allow',
): ProtocolViolation | undefined {
  measure.nodes += 1
  if (measure.nodes > limits.maxNodes) {
    return { code: 'nodes-exceeded', message: `value has more than ${limits.maxNodes} nodes` }
  }
  if (depth > limits.maxDepth) {
    return { code: 'depth-exceeded', message: `value nests deeper than ${limits.maxDepth}`, path }
  }
  switch (typeof value) {
    case 'boolean':
    case 'bigint':
      return undefined
    case 'undefined':
      // an absent optional property (`{ truncation: undefined }`) as ABI objects routinely carry;
      // structured clone preserves it, JSON would drop it — either reading is harmless
      return depth === 0
        ? { code: 'bad-value', message: 'undefined is not a wire value', path }
        : undefined
    case 'number':
      return Number.isFinite(value)
        ? undefined
        : { code: 'bad-value', message: 'non-finite number', path }
    case 'string':
      return value.length <= limits.maxStringLength
        ? undefined
        : { code: 'string-too-long', message: `string longer than ${limits.maxStringLength}`, path }
    case 'object':
      break
    default:
      return { code: 'bad-value', message: `${typeof value} is not a wire value`, path }
  }
  if (value === null) return undefined
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const kind = value.constructor.name
    if (wireTypedArrayCode(value) === undefined) {
      return { code: 'bad-value', message: `${kind} is not a wire value`, path }
    }
    if (SHARED !== undefined && value.buffer instanceof SHARED) {
      return {
        code: 'shared-buffer',
        message: 'SharedArrayBuffer-backed bytes are not transferable',
        path,
      }
    }
    if ((value.buffer as { detached?: boolean }).detached === true) {
      return {
        code: 'bad-value',
        message: `a ${kind} over a detached buffer cannot cross (it was transferred already)`,
        path,
      }
    }
    if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
      return {
        code: 'partial-typed-array',
        message: `a ${kind} must own its whole buffer (slice() before sending)`,
        path,
      }
    }
    measure.bytes += value.byteLength
    if (measure.bytes > limits.maxTransferBytes) {
      return {
        code: 'transfer-too-large',
        message: `frame carries more than ${limits.maxTransferBytes} bytes`,
        path,
      }
    }
    measure.buffers.push(value.buffer as ArrayBuffer)
    return undefined
  }
  if (value instanceof DataView || value instanceof ArrayBuffer) {
    // a DataView declares no element type and a bare ArrayBuffer no element type *and* no length
    // in elements; both would cross as bytes whose reading is a matter of convention
    return {
      code: 'bad-value',
      message: 'binary payloads must be a typed array that names its element type',
      path,
    }
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      return { code: 'array-too-long', message: `array longer than ${limits.maxArrayLength}`, path }
    }
    for (let index = 0; index < value.length; index += 1) {
      path.push(index)
      const found = validateInner(value[index], limits, measure, depth + 1, path, handles)
      if (found !== undefined) return found
      path.pop()
    }
    return undefined
  }
  if (!isPlainObject(value)) {
    return { code: 'bad-value', message: 'only plain data objects may cross the boundary', path }
  }
  if (Object.hasOwn(value, HANDLE_MARKER)) {
    if (handles === 'forbid') {
      return {
        code: 'handle-not-allowed',
        message: 'a handle ref is not allowed at this position',
        path,
      }
    }
    if (!isHandleRef(value)) return { code: 'bad-handle', message: 'malformed handle ref', path }
    const data = value[HANDLE_MARKER].data
    if (data === undefined) return undefined
    path.push(HANDLE_MARKER, 'data')
    const found = validateInner(data, limits, measure, depth + 1, path, 'forbid')
    if (found !== undefined) return found
    path.length -= 2
    return undefined
  }
  const keys = Object.keys(value)
  if (keys.length > limits.maxObjectKeys) {
    return {
      code: 'too-many-keys',
      message: `object has more than ${limits.maxObjectKeys} keys`,
      path,
    }
  }
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { code: 'forbidden-key', message: `key «${key}» is forbidden`, path: [...path, key] }
    }
    if (key.length > limits.maxStringLength) {
      return { code: 'string-too-long', message: 'object key too long', path: [...path, key] }
    }
    path.push(key)
    const found = validateInner(value[key], limits, measure, depth + 1, path, handles)
    if (found !== undefined) return found
    path.pop()
  }
  return undefined
}

/**
 * Validates one wire value against the limits. `handles: 'forbid'` (default) rejects any handle
 * ref inside; `'top'` allows a handle ref only as the whole value; `'nested'` allows refs at any
 * depth (used only by the endpoints for surfaces that return handle-bearing structures — none in
 * v1, kept for the state machine's own frames).
 */
export function validateWireValue(
  value: unknown,
  limits: ProtocolLimits,
  handles: 'forbid' | 'top' | 'nested' = 'forbid',
  path: readonly (string | number)[] = [],
): Validated<WireValueMeasure> {
  const measure: Measure = { nodes: 0, bytes: 0, buffers: [] }
  if (handles === 'top' && isHandleRef(value)) {
    // the ref itself is fine at the top; its carried data must still be a handle-free wire object
    const data = value[HANDLE_MARKER].data
    const found =
      data === undefined
        ? undefined
        : validateInner(data, limits, measure, 1, [...path, HANDLE_MARKER, 'data'], 'forbid')
    if (found !== undefined)
      return {
        ok: false,
        violation: Object.freeze({
          ...found,
          ...(found.path === undefined ? {} : { path: Object.freeze([...found.path]) }),
        }),
      }
    return {
      ok: true,
      value: Object.freeze({
        nodes: measure.nodes + 1,
        transferBytes: measure.bytes,
        transferables: Object.freeze(measure.buffers),
      }),
    }
  }
  const found = validateInner(
    value,
    limits,
    measure,
    0,
    [...path],
    handles === 'nested' ? 'allow' : 'forbid',
  )
  if (found !== undefined)
    return {
      ok: false,
      violation: Object.freeze({
        ...found,
        ...(found.path === undefined ? {} : { path: Object.freeze([...found.path]) }),
      }),
    }
  return {
    ok: true,
    value: Object.freeze({
      nodes: measure.nodes,
      transferBytes: measure.bytes,
      transferables: Object.freeze(measure.buffers),
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// error DTO

export interface ErrorDto {
  readonly code: string
  readonly message: string
  readonly retryability: Retryability
  readonly context?: Readonly<Record<string, WireValue>>
  /** True only for `OperationCancelledError`; rehydrates as cancellation, never as failure. */
  readonly cancelled?: true
  /** The original context was not a bounded wire value and was dropped rather than sent. */
  readonly contextDropped?: true
}

const RETRYABILITIES: readonly Retryability[] = ['never', 'safe', 'conditional']
const MAX_ERROR_MESSAGE = 8 * 1024

/**
 * Converts any thrown value into a bounded DTO. Stack traces, causes and non-wire context never
 * cross the boundary; a foreign (non-Modkit) error becomes `x3.host/rpc-foreign-error`.
 */
export function toErrorDto(error: unknown, limits: ProtocolLimits): ErrorDto {
  const clip = (text: string) =>
    text.length > MAX_ERROR_MESSAGE ? `${text.slice(0, MAX_ERROR_MESSAGE)}…` : text
  if (error instanceof OperationCancelledError) {
    return Object.freeze({
      code: error.code,
      message: clip(error.message),
      retryability: error.retryability,
      cancelled: true,
    })
  }
  if (isModkitError(error)) {
    let context: ErrorDto['context'] | undefined
    let dropped = false
    if (error.context !== undefined) {
      const checked = validateWireValue(error.context, limits, 'forbid')
      if (checked.ok && isPlainObject(error.context)) {
        context = error.context as Readonly<Record<string, WireValue>>
      } else {
        dropped = true
      }
    }
    return Object.freeze({
      code: error.code,
      message: clip(error.message),
      retryability: error.retryability,
      ...(context === undefined ? {} : { context }),
      ...(dropped ? { contextDropped: true as const } : {}),
    })
  }
  const message = error instanceof Error ? error.message : String(error)
  return Object.freeze({
    code: 'x3.host/rpc-foreign-error',
    message: clip(message.length === 0 ? 'unknown error' : message),
    retryability: 'never',
  })
}

/** Rehydrates a DTO into a structured error; a malformed DTO is itself a structured error. */
export function fromErrorDto(dto: ErrorDto): ModkitError {
  if (dto.cancelled === true) return new OperationCancelledError(dto.message)
  return new ModkitError({
    code: dto.code,
    message: dto.message,
    retryability: dto.retryability,
    ...(dto.context === undefined ? {} : { context: dto.context }),
  })
}

export function validateErrorDto(
  value: unknown,
  limits: ProtocolLimits,
  path: readonly (string | number)[] = [],
): Validated<ErrorDto> {
  if (!isPlainObject(value)) return violation('bad-error', 'error must be an object', path)
  const record = value
  const keys = Object.keys(record)
  const allowed = new Set([
    'code',
    'message',
    'retryability',
    'context',
    'cancelled',
    'contextDropped',
  ])
  for (const key of keys) {
    if (!allowed.has(key))
      return violation('bad-error', `unknown error key «${key}»`, [...path, key])
  }
  const code = record['code']
  if (typeof code !== 'string' || !isQualifiedId(code)) {
    return violation('bad-error', 'error code must be a qualified id', [...path, 'code'])
  }
  const message = record['message']
  if (typeof message !== 'string' || message.length > MAX_ERROR_MESSAGE + 1) {
    return violation('bad-error', 'error message must be a bounded string', [...path, 'message'])
  }
  const retryability = record['retryability']
  if (typeof retryability !== 'string' || !RETRYABILITIES.includes(retryability as Retryability)) {
    return violation('bad-error', 'error retryability is invalid', [...path, 'retryability'])
  }
  for (const flag of ['cancelled', 'contextDropped'] as const) {
    if (record[flag] !== undefined && record[flag] !== true) {
      return violation('bad-error', `error ${flag} must be true or absent`, [...path, flag])
    }
  }
  if (record['context'] !== undefined) {
    if (!isPlainObject(record['context'])) {
      return violation('bad-error', 'error context must be an object', [...path, 'context'])
    }
    const checked = validateWireValue(record['context'], limits, 'forbid', [...path, 'context'])
    if (!checked.ok) return checked
  }
  return { ok: true, value: Object.freeze({ ...(record as unknown as ErrorDto) }) }
}

// ---------------------------------------------------------------------------------------------
// frames

export interface Envelope {
  readonly domain: typeof CAPABILITY_RPC_DOMAIN
  readonly version: typeof CAPABILITY_RPC_VERSION
  /** Opaque session id (segment grammar). */
  readonly session: string
  /** Worker generation; restarts increment it and invalidate everything before. */
  readonly generation: number
  /** Monotonic per sender direction, starts at 1. */
  readonly id: number
}

export interface ProgressDto {
  readonly completed: number
  readonly total?: number
  readonly message?: string
}

export type Frame =
  | (Envelope & {
      readonly t: 'load'
      /** Host-verified, artifact-contained module URL (24 §8: verified before spawn). */
      readonly moduleUrl: string
      readonly contributionId: string
      readonly variantId: string
      readonly artifactDigest: string
      /** Digest of the entrypoint bytes the loader must re-verify right before evaluation. */
      readonly entrypointDigest?: string
    })
  | (Envelope & {
      readonly t: 'ready'
      readonly inReplyTo: number
      readonly abiVersion: 1
      readonly exports: readonly string[]
      /** Handle of the loaded module object (surface: the module surface of its contract). */
      readonly root: HandleRef
    })
  | (Envelope & {
      readonly t: 'call'
      readonly handle: string
      readonly method: string
      readonly args: readonly WireValue[]
      readonly deadlineMs?: number
    })
  | (Envelope & {
      readonly t: 'return'
      readonly inReplyTo: number
      readonly value?: WireValue | HandleRef
      /** `leased-value` methods: the release-only handle that owns the returned value. */
      readonly lease?: HandleRef
    })
  | (Envelope & { readonly t: 'throw'; readonly inReplyTo: number; readonly error: ErrorDto })
  | (Envelope & { readonly t: 'cancel'; readonly target: number })
  | (Envelope & {
      readonly t: 'next'
      readonly handle: string
      /**
       * Protocol 1.1 batch pull: up to `max` items in one `return` whose value is an array;
       * `done` when the iterator is already exhausted. Absent: exactly one item per reply.
       */
      readonly max?: number
    })
  | (Envelope & {
      readonly t: 'done'
      /** Reply to a `next` (iterator exhausted) or unsolicited for an event stream. */
      readonly inReplyTo?: number
      readonly handle: string
      /** An event stream that ended by failing; iterators report failures with `throw`. */
      readonly error?: ErrorDto
    })
  | (Envelope & { readonly t: 'subscribe'; readonly handle: string })
  | (Envelope & { readonly t: 'event'; readonly subscription: string; readonly value: WireValue })
  | (Envelope & { readonly t: 'unsubscribe'; readonly subscription: string })
  | (Envelope & {
      readonly t: 'progress'
      readonly inReplyTo: number
      readonly progress: ProgressDto
    })
  | (Envelope & { readonly t: 'release'; readonly handle: string })
  /** The owner let go of a handle it once sent; the peer drops its proxy. No reply. */
  | (Envelope & { readonly t: 'revoke'; readonly handle: string })
  | (Envelope & { readonly t: 'terminate'; readonly reason: string })

export type FrameOf<T extends FrameType> = Extract<Frame, { readonly t: T }>

const ENVELOPE_KEYS = ['domain', 'version', 'session', 'generation', 'id', 't'] as const
const FRAME_KEYS: Readonly<
  Record<FrameType, { required: readonly string[]; optional: readonly string[] }>
> = {
  load: {
    required: ['moduleUrl', 'contributionId', 'variantId', 'artifactDigest'],
    optional: ['entrypointDigest'],
  },
  ready: { required: ['inReplyTo', 'abiVersion', 'exports', 'root'], optional: [] },
  call: { required: ['handle', 'method', 'args'], optional: ['deadlineMs'] },
  return: { required: ['inReplyTo'], optional: ['value', 'lease'] },
  throw: { required: ['inReplyTo', 'error'], optional: [] },
  cancel: { required: ['target'], optional: [] },
  next: { required: ['handle'], optional: ['max'] },
  done: { required: ['handle'], optional: ['inReplyTo', 'error'] },
  subscribe: { required: ['handle'], optional: [] },
  event: { required: ['subscription', 'value'], optional: [] },
  unsubscribe: { required: ['subscription'], optional: [] },
  progress: { required: ['inReplyTo', 'progress'], optional: [] },
  release: { required: ['handle'], optional: [] },
  revoke: { required: ['handle'], optional: [] },
  terminate: { required: ['reason'], optional: [] },
}

export interface FrameExpectation {
  readonly session: string
  readonly generation: number
}

function isMessageId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function checkExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): ProtocolViolation | undefined {
  for (const key of required) {
    if (!Object.hasOwn(record, key))
      return { code: 'missing-key', message: `missing key «${key}»`, path: [key] }
  }
  const allowed = new Set([...ENVELOPE_KEYS, ...required, ...optional])
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key))
      return { code: 'forbidden-key', message: `key «${key}» is forbidden`, path: [key] }
    if (!allowed.has(key))
      return { code: 'unknown-key', message: `unknown key «${key}»`, path: [key] }
  }
  return undefined
}

/**
 * Validates one incoming frame: plain object, exact envelope, exact keys for its type, grammar of
 * every id/method/handle, and every embedded wire value against the limits. Monotonic ids and
 * reply targets are checked by the endpoint (they need state); this function is pure.
 */
export function validateFrame(
  input: unknown,
  limits: ProtocolLimits,
  expect: FrameExpectation,
): Validated<Frame> {
  if (!isPlainObject(input)) return violation('not-an-object', 'frame must be a plain object')
  const record = input
  if (record['domain'] !== CAPABILITY_RPC_DOMAIN || record['version'] !== CAPABILITY_RPC_VERSION) {
    return violation('bad-envelope', 'frame domain/version mismatch')
  }
  if (record['session'] !== expect.session)
    return violation('bad-envelope', 'frame session mismatch', ['session'])
  if (record['generation'] !== expect.generation) {
    return violation('stale-generation', 'frame generation does not match the live generation', [
      'generation',
    ])
  }
  if (!isMessageId(record['id']))
    return violation('bad-id', 'frame id must be a positive safe integer', ['id'])
  const type = record['t']
  if (typeof type !== 'string' || !(FRAME_TYPES as readonly string[]).includes(type)) {
    return violation('bad-type', 'unknown frame type', ['t'])
  }
  const t = type as FrameType
  const keys = FRAME_KEYS[t]
  const keyViolation = checkExactKeys(record, keys.required, keys.optional)
  if (keyViolation !== undefined) return { ok: false, violation: keyViolation }

  const str = (
    key: string,
    test?: (value: string) => boolean,
    code: ProtocolViolationCode = 'bad-value',
  ) =>
    typeof record[key] === 'string' &&
    (record[key] as string).length > 0 &&
    (test?.(record[key] as string) ?? true)
      ? undefined
      : violation(code, `«${key}» is malformed`, [key])
  const replyId = (key: string) =>
    isMessageId(record[key])
      ? undefined
      : violation('bad-id', `«${key}» must be a positive safe integer`, [key])

  switch (t) {
    case 'load': {
      for (const key of ['moduleUrl', 'artifactDigest'] as const) {
        const bad = str(key, value => value.length <= limits.maxStringLength)
        if (bad) return bad
      }
      if (record['entrypointDigest'] !== undefined) {
        const bad = str('entrypointDigest', value => value.length <= 256)
        if (bad) return bad
      }
      const bad = str('contributionId', isQualifiedId) ?? str('variantId', isSegment)
      if (bad) return bad
      break
    }
    case 'ready': {
      const bad = replyId('inReplyTo')
      if (bad) return bad
      if (record['abiVersion'] !== 1)
        return violation('bad-value', 'abiVersion must be 1', ['abiVersion'])
      const exports = record['exports']
      if (
        !Array.isArray(exports) ||
        exports.length > limits.maxArrayLength ||
        !exports.every(item => typeof item === 'string' && item.length > 0 && item.length <= 256)
      ) {
        return violation('bad-value', 'exports must be an array of short strings', ['exports'])
      }
      if (!isHandleRef(record['root']))
        return violation('bad-handle', 'root must be a handle ref', ['root'])
      {
        const checked = validateWireValue(record['root'], limits, 'top', ['root'])
        if (!checked.ok) return checked
      }
      break
    }
    case 'call': {
      const bad =
        str('handle', isHandleId, 'bad-handle') ?? str('method', isMethodName, 'bad-method')
      if (bad) return bad
      const args = record['args']
      if (!Array.isArray(args)) return violation('bad-value', 'args must be an array', ['args'])
      if (args.length > limits.maxArgs)
        return violation('too-many-args', `more than ${limits.maxArgs} args`, ['args'])
      const checked = validateWireValue(args, limits, 'nested', ['args'])
      if (!checked.ok) return checked
      if (
        record['deadlineMs'] !== undefined &&
        (!Number.isSafeInteger(record['deadlineMs']) || (record['deadlineMs'] as number) < 0)
      ) {
        return violation('bad-value', 'deadlineMs must be a non-negative safe integer', [
          'deadlineMs',
        ])
      }
      break
    }
    case 'return': {
      const bad = replyId('inReplyTo')
      if (bad) return bad
      if (record['value'] !== undefined) {
        const checked = validateWireValue(record['value'], limits, 'top', ['value'])
        if (!checked.ok) return checked
      }
      if (record['lease'] !== undefined) {
        const lease = record['lease']
        if (!isHandleRef(lease) || lease[HANDLE_MARKER].kind !== 'lease') {
          return violation('bad-handle', 'lease must be a lease handle ref', ['lease'])
        }
        if (record['value'] !== undefined && isHandleRef(record['value'])) {
          return violation('bad-value', 'a leased value cannot itself be a handle', ['value'])
        }
        const checked = validateWireValue(lease, limits, 'top', ['lease'])
        if (!checked.ok) return checked
      }
      break
    }
    case 'throw': {
      const bad = replyId('inReplyTo')
      if (bad) return bad
      const checked = validateErrorDto(record['error'], limits, ['error'])
      if (!checked.ok) return checked
      break
    }
    case 'cancel':
      {
        const bad = replyId('target')
        if (bad) return bad
      }
      break
    case 'next': {
      const bad = str('handle', isHandleId, 'bad-handle')
      if (bad) return bad
      const max = record['max']
      if (
        max !== undefined &&
        (!Number.isSafeInteger(max) ||
          (max as number) < 1 ||
          (max as number) > limits.maxArrayLength)
      ) {
        return violation(
          'bad-value',
          `next.max must be an integer in 1..${limits.maxArrayLength}`,
          ['max'],
        )
      }
      break
    }
    case 'subscribe':
    case 'release':
    case 'revoke': {
      const bad = str('handle', isHandleId, 'bad-handle')
      if (bad) return bad
      break
    }
    case 'done': {
      const bad = str('handle', isHandleId, 'bad-handle')
      if (bad) return bad
      if (record['inReplyTo'] !== undefined) {
        const badReply = replyId('inReplyTo')
        if (badReply) return badReply
      }
      if (record['error'] !== undefined) {
        const checked = validateErrorDto(record['error'], limits, ['error'])
        if (!checked.ok) return checked
      }
      break
    }
    case 'event': {
      const bad = str('subscription', isSubscriptionId, 'bad-subscription')
      if (bad) return bad
      const checked = validateWireValue(record['value'], limits, 'forbid', ['value'])
      if (!checked.ok) return checked
      break
    }
    case 'unsubscribe': {
      const bad = str('subscription', isSubscriptionId, 'bad-subscription')
      if (bad) return bad
      break
    }
    case 'progress': {
      const bad = replyId('inReplyTo')
      if (bad) return bad
      const progress = record['progress']
      if (!isPlainObject(progress))
        return violation('bad-progress', 'progress must be an object', ['progress'])
      const progressKeys = Object.keys(progress)
      if (progressKeys.some(key => !['completed', 'total', 'message'].includes(key))) {
        return violation('bad-progress', 'progress has unknown keys', ['progress'])
      }
      if (
        typeof progress['completed'] !== 'number' ||
        !Number.isFinite(progress['completed']) ||
        progress['completed'] < 0
      ) {
        return violation('bad-progress', 'progress.completed must be a non-negative number', [
          'progress',
          'completed',
        ])
      }
      if (
        progress['total'] !== undefined &&
        (typeof progress['total'] !== 'number' ||
          !Number.isFinite(progress['total']) ||
          progress['total'] < 0)
      ) {
        return violation('bad-progress', 'progress.total must be a non-negative number', [
          'progress',
          'total',
        ])
      }
      if (
        progress['message'] !== undefined &&
        (typeof progress['message'] !== 'string' || progress['message'].length > 1024)
      ) {
        return violation('bad-progress', 'progress.message must be a short string', [
          'progress',
          'message',
        ])
      }
      break
    }
    case 'terminate': {
      const bad = str('reason', value => value.length <= 1024)
      if (bad) return bad
      break
    }
  }
  return { ok: true, value: record as unknown as Frame }
}

/** Payload-free description for diagnostics/logs (never echoes values, args or bytes). */
export function describeFrame(frame: Frame): string {
  switch (frame.t) {
    case 'call':
      return `call#${frame.id} ${frame.handle}.${frame.method}(${frame.args.length} args)`
    case 'return':
      return `return#${frame.id}→${frame.inReplyTo}`
    case 'throw':
      return `throw#${frame.id}→${frame.inReplyTo} ${frame.error.code}`
    case 'event':
      return `event#${frame.id} ${frame.subscription}`
    case 'progress':
      return `progress#${frame.id}→${frame.inReplyTo}`
    case 'done':
      return `done#${frame.id} ${frame.handle}`
    case 'load':
      return `load#${frame.id} ${frame.contributionId}#${frame.variantId}`
    case 'ready':
      return `ready#${frame.id}→${frame.inReplyTo}`
    case 'cancel':
      return `cancel#${frame.id}→${frame.target}`
    case 'terminate':
      return `terminate#${frame.id}`
    default:
      return `${frame.t}#${frame.id}`
  }
}
