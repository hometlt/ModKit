/**
 * Core owner of bounded immutable JSON snapshots: finite primitives, plain objects and arrays,
 * UTF-8 byte/node/depth budgets, cancellation, cycle refusal, optional stable key ordering.
 * Accessors are refused without calling getters; this is data validation, not a Proxy sandbox.
 * Reuses only snapshots minted by this owner, charging their complete size on every occurrence.
 * Foreign frozen values still undergo admission; tighter budgets retain ordinary refusal order.
 */
export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface JsonSnapshotBudget {
  readonly maxDepth: number
  readonly maxNodes: number
  /** Size of the UTF-8 JSON representation, including keys and punctuation. */
  readonly maxBytes: number
}

export interface JsonSnapshotOptions extends JsonSnapshotBudget {
  /** Stable object-key order for deterministic artifacts; array order always remains authored. */
  readonly sortKeys?: boolean
}

/** Count UTF-8 bytes without allocating an encoded copy of the JSON text. */
function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index++
    } else bytes += 3
  }
  return bytes
}

/** Read own data only: omitted properties remain undefined, accessors never execute. */
function dataProperty(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw new TypeError('JSON snapshot rejects accessor properties')
  return descriptor.value
}

interface SnapshotSize {
  readonly nodes: number
  readonly bytes: number
  readonly height: number
  readonly sorted: boolean
}

// Only this owner can mint entries: Object.isFrozen alone never establishes admissible data.
// Keep roots and large subtrees, not one metadata record for every small animation tuple.
const ownedSnapshots = new WeakMap<object, SnapshotSize>()
const MIN_REUSABLE_SUBTREE_NODES = 256

/** Own immutable JSON data; reject lossy conversions and stop before exceeding the budget. */
export function snapshotJson(
  value: unknown,
  budget: JsonSnapshotOptions,
  signal?: AbortSignal,
): JsonValue {
  for (const limit of [budget?.maxDepth, budget?.maxNodes, budget?.maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError('invalid JSON snapshot budget')
  }
  const ancestors = new Set<object>()
  let nodes = 0
  let bytes = 0
  let copiedHeight = 0
  const charge = (count: number): void => {
    bytes += count
    if (bytes > budget.maxBytes) throw new RangeError('JSON snapshot exceeds maxBytes')
  }
  const finish = (result: object, depth: number, height: number, previousNodes: number, previousBytes: number): JsonValue => {
    copiedHeight = height
    if (depth === 0 || nodes - previousNodes >= MIN_REUSABLE_SUBTREE_NODES)
      ownedSnapshots.set(result, {
        nodes: nodes - previousNodes, bytes: bytes - previousBytes,
        height, sorted: budget.sortKeys === true,
      })
    return result as JsonValue
  }
  const copy = (entry: unknown, depth: number): JsonValue => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    if (depth > budget.maxDepth) throw new RangeError('JSON snapshot exceeds maxDepth')
    const previousNodes = nodes, previousBytes = bytes
    copiedHeight = 0
    if (++nodes > budget.maxNodes) throw new RangeError('JSON snapshot exceeds maxNodes')
    if (entry === null || typeof entry === 'boolean') {
      charge(entry === false ? 5 : 4)
      return entry
    }
    if (typeof entry === 'string') {
      charge(utf8ByteLength(JSON.stringify(entry)))
      return entry
    }
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      // JSON numbers contain only ASCII, including exponent notation and -0 as 0.
      charge(JSON.stringify(entry).length)
      return entry
    }
    if (typeof entry !== 'object' || entry === null) throw new TypeError('non-JSON snapshot value')
    const owned = ownedSnapshots.get(entry)
    if (owned !== undefined && (!budget.sortKeys || owned.sorted) &&
        depth + owned.height <= budget.maxDepth &&
        previousNodes + owned.nodes <= budget.maxNodes &&
        previousBytes + owned.bytes <= budget.maxBytes) {
      nodes = previousNodes + owned.nodes
      charge(owned.bytes)
      copiedHeight = owned.height
      return entry as JsonValue
    }
    // A tighter budget takes the normal walk, preserving the original first refusal as well.
    const prototype: unknown = Object.getPrototypeOf(entry)
    if (!Array.isArray(entry) && prototype !== null && prototype !== Object.prototype) {
      throw new TypeError('JSON snapshot requires plain objects')
    }
    if (ancestors.has(entry)) throw new TypeError('cyclic JSON snapshot')
    ancestors.add(entry)
    try {
      let height = 0
      charge(2)
      if (Array.isArray(entry)) {
        const result: JsonValue[] = []
        for (let index = 0; index < entry.length; index++) {
          if (index > 0) charge(1)
          result.push(copy(dataProperty(entry, String(index)), depth + 1))
          height = Math.max(height, 1 + copiedHeight)
        }
        return finish(Object.freeze(result), depth, height, previousNodes, previousBytes)
      }
      const result: [string, JsonValue][] = []
      const keys = Object.keys(entry)
      if (budget.sortKeys) keys.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      for (const key of keys) {
        const item = dataProperty(entry, key)
        // Optional object members follow JSON semantics; array holes/undefined are rejected.
        if (item === undefined) continue
        charge(utf8ByteLength(JSON.stringify(key)) + 1 + (result.length > 0 ? 1 : 0))
        result.push([key, copy(item, depth + 1)])
        height = Math.max(height, 1 + copiedHeight)
      }
      return finish(Object.freeze(Object.fromEntries(result)), depth, height, previousNodes, previousBytes)
    } finally {
      ancestors.delete(entry)
    }
  }
  return copy(value, 0)
}
