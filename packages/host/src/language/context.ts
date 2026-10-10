/**
 * Canonical Host language captures: strict immutable JSON inputs and primitive document snapshots,
 * bounded aggregate bytes/depth and deterministic identity tokens. Only owner-created copies are
 * memoized; caller objects, including frozen ones, must cross validation again.
 */
import { canonicalJsonStringify, compareUtf8 } from '@modkit/core'
import type { JsonValue } from '@modkit/sdk'
import type { LanguageDocument, LanguageWorkspaceSemanticInput } from '@modkit/sdk/language'

export const LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_DEPTH = 64
export const LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES = 64 * 1024 * 1024
const LANGUAGE_WORKSPACE_SEMANTIC_INPUTS_MAX = 256
const encoder = new TextEncoder()

const boundedContextText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8_192 && !value.includes('\0')

/** Copy strict JSON without invoking accessors; reject cycles, extra array keys and unsafe keys. */
function cloneSemanticPayload(
  value: unknown,
  depth = 0,
  ancestors: Set<object> = new Set(),
): JsonValue {
  if (depth > LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_DEPTH) {
    throw new TypeError('language workspace semantic payload exceeds maximum depth')
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new TypeError('language workspace semantic payload is not strict JSON')
  }
  ancestors.add(value)
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string')) {
    throw new TypeError('language workspace semantic payload is not strict JSON')
  }
  if (Array.isArray(value)) {
    // The count plus every own enumerable data index below proves a dense array with no
    // extra properties. No second collection of all numeric keys is needed.
    if (keys.length !== value.length + 1) {
      throw new TypeError('language workspace semantic payload is not strict JSON')
    }
    const clone: JsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('language workspace semantic payload is not strict JSON')
      }
      clone.push(cloneSemanticPayload(descriptor.value, depth + 1, ancestors))
    }
    ancestors.delete(value)
    return Object.freeze(clone)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('language workspace semantic payload is not strict JSON')
  }
  const clone: Record<string, JsonValue> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError('language workspace semantic payload is not strict JSON')
    }
    clone[key] = cloneSemanticPayload(descriptor.value, depth + 1, ancestors)
  }
  ancestors.delete(value)
  return Object.freeze(clone)
}

// Only copies created here are trusted. Frozen objects supplied by callers still cross validation.
const validatedContextCopies = new WeakMap<
  object,
  | {
      input: LanguageWorkspaceSemanticInput
      payloadBytes: number
      token?: string
    }
  | { document: LanguageDocument; textToken?: string }
>()

/**
 * True only for the immutable captures this owner created: validated semantic inputs (deep-frozen
 * strict JSON) and document snapshots (frozen primitive fields). An execution boundary may leave
 * them with its worker between calls; caller objects, frozen or not, never qualify.
 */
export function languageImmutableCapture(value: object): boolean {
  return validatedContextCopies.has(value)
}

/** Capture primitive document fields; only copies made by this owner can reuse their text token. */
export function languageDocumentSnapshot(document: LanguageDocument): LanguageDocument {
  const metadata = validatedContextCopies.get(document)
  if (metadata !== undefined && 'document' in metadata) return metadata.document
  const copy = Object.freeze({
    uri: document.uri,
    languageId: document.languageId,
    version: document.version,
    text: document.text,
    ...(document.dialect === undefined ? {} : { dialect: document.dialect }),
  })
  validatedContextCopies.set(copy, { document: copy })
  return copy
}

export function languageDocumentTextToken(document: LanguageDocument): string {
  const metadata = validatedContextCopies.get(document)
  if (metadata !== undefined && 'document' in metadata) {
    return (metadata.textToken ??= languageWorkspaceContextToken(metadata.document.text))
  }
  return languageWorkspaceContextToken(document.text)
}

function copySemanticInput(item: unknown): Readonly<{
  input: LanguageWorkspaceSemanticInput
  payloadBytes: number
}> {
  const cached =
    typeof item === 'object' && item !== null ? validatedContextCopies.get(item) : undefined
  if (cached !== undefined && 'input' in cached) return cached
  let payloadBytes = 0
  const keys = typeof item === 'object' && item !== null ? Reflect.ownKeys(item) : []
  if (
    typeof item !== 'object' ||
    item === null ||
    Array.isArray(item) ||
    (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) ||
    keys.some(
      key => typeof key !== 'string' || !['kind', 'id', 'revision', 'payload'].includes(key),
    )
  ) {
    throw new TypeError('language workspace semantic input is invalid')
  }
  const descriptors = Object.getOwnPropertyDescriptors(item)
  if (
    keys.some(key => {
      if (typeof key !== 'string') return true
      const descriptor = descriptors[key]
      return descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)
    })
  ) {
    throw new TypeError('language workspace semantic input is invalid')
  }
  const kind = descriptors['kind']?.value
  const id = descriptors['id']?.value
  const revision = descriptors['revision']?.value
  if (!boundedContextText(kind) || !boundedContextText(id) || !boundedContextText(revision)) {
    throw new TypeError('language workspace semantic input is invalid')
  }
  const hasPayload = Object.prototype.hasOwnProperty.call(item, 'payload')
  const payload = hasPayload ? cloneSemanticPayload(descriptors['payload']?.value) : undefined
  if (payload !== undefined) {
    payloadBytes = encoder.encode(JSON.stringify(payload)).byteLength
  }
  const copy = Object.freeze({
    kind,
    id,
    revision,
    ...(payload === undefined ? {} : { payload }),
  })
  const result = { input: copy, payloadBytes }
  validatedContextCopies.set(copy, result)
  return result
}

/**
 * Exact UTF-8 JSON byte length of an owner-validated semantic input payload, counted once when the
 * copy was made. Undefined for objects this owner did not copy: their sizes are never trusted.
 */
export function languageSemanticInputPayloadBytes(
  input: LanguageWorkspaceSemanticInput,
): number | undefined {
  const metadata = validatedContextCopies.get(input)
  return metadata !== undefined && 'input' in metadata ? metadata.payloadBytes : undefined
}

/** Validate, deduplicate and defensively copy semantic inputs crossing a host boundary. */
export function validatedLanguageWorkspaceSemanticInputs(
  value: unknown,
): readonly LanguageWorkspaceSemanticInput[] {
  if (!Array.isArray(value) || value.length > LANGUAGE_WORKSPACE_SEMANTIC_INPUTS_MAX) {
    throw new TypeError('language workspace semantic inputs are invalid')
  }
  let payloadBytes = 0
  const byKey = new Map<string, LanguageWorkspaceSemanticInput>()
  for (const item of value) {
    const validated = copySemanticInput(item)
    const copy = validated.input
    payloadBytes += validated.payloadBytes
    if (payloadBytes > LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES) {
      throw new TypeError('language workspace semantic payload exceeds maximum bytes')
    }
    const key = `${copy.kind}\0${copy.id}`
    const previous = byKey.get(key)
    if (
      previous !== undefined &&
      previous !== copy &&
      (previous.revision !== copy.revision ||
        canonicalJsonStringify(previous) !== canonicalJsonStringify(copy))
    ) {
      throw new TypeError(`language workspace semantic input ${copy.kind}/${copy.id} conflicts`)
    }
    byKey.set(key, copy)
  }
  return Object.freeze(
    [...byKey.values()].sort(
      (left, right) => compareUtf8(left.kind, right.kind) || compareUtf8(left.id, right.id),
    ),
  )
}

const fnv64 = (bytes: Uint8Array, low: number, high: number, reverse: boolean): string => {
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = reverse ? bytes.length - index - 1 : index
    low = (low ^ (bytes[offset] as number)) >>> 0
    // The FNV prime is 0x100000001b3. Keep its exact 64-bit product in two words;
    // low * 0x1b3 fits in Number's integer precision, including its carry.
    const product = low * 0x1b3
    high =
      (Math.imul(high, 0x1b3) + Math.imul(low, 0x100) + Math.floor(product / 0x100000000)) >>> 0
    low = product >>> 0
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')
}

const tokenForCanonicalJson = (canonical: string): string => {
  const bytes = encoder.encode(canonical)
  return `language-context-v1:${fnv64(bytes, 0x84222325, 0xcbf29ce4, false)}${fnv64(bytes, 0xcbf29ce4, 0x84222325, true)}`
}

/**
 * A canonical JSON rendering (as `canonicalJsonStringify` produced it, at the top level) as it reads
 * nested `depth` levels deep inside a larger canonical value, without its final newline: every line
 * after the first gains the deeper indentation. Lets an owner assemble one exact canonical
 * description from fragments it rendered once.
 */
export function canonicalJsonAtDepth(canonical: string, depth: number): string {
  const body = canonical.endsWith('\n') ? canonical.slice(0, -1) : canonical
  return depth === 0 ? body : body.replaceAll('\n', `\n${'  '.repeat(depth)}`)
}

/** Bounded workspace-local memo of exact canonical descriptions, never caller object identities. */
export function createLanguageContextTokenCache(maxBytes: number): Readonly<{
  token(value: unknown): string
  /** The token of an exact canonical description the caller assembled itself. */
  canonicalToken(canonical: string): string
  clear(): void
}> {
  const entries = new Map<string, Readonly<{ token: string; bytes: number }>>()
  let retainedBytes = 0
  const canonicalToken = (canonical: string): string => {
    const held = entries.get(canonical)
    if (held !== undefined) {
      entries.delete(canonical)
      entries.set(canonical, held)
      return held.token
    }
    const token = tokenForCanonicalJson(canonical)
    const bytes = 256 + 2 * (canonical.length + token.length)
    if (bytes <= maxBytes) {
      while (entries.size >= 16 || retainedBytes + bytes > maxBytes) {
        const oldest = entries.entries().next().value
        if (oldest === undefined) break
        entries.delete(oldest[0])
        retainedBytes -= oldest[1].bytes
      }
      entries.set(canonical, { token, bytes })
      retainedBytes += bytes
    }
    return token
  }
  return {
    // Re-serialize every call: changed content under an unchanged revision must still be seen.
    token: value => canonicalToken(canonicalJsonStringify(value)),
    canonicalToken,
    clear() {
      entries.clear()
      retainedBytes = 0
    },
  }
}

/** Compact deterministic identity for a canonical host-owned language context description. */
export const languageWorkspaceContextToken = (value: unknown): string => {
  const validated =
    typeof value === 'object' && value !== null ? validatedContextCopies.get(value) : undefined
  const semantic = validated !== undefined && 'input' in validated ? validated : undefined
  if (semantic?.token !== undefined) return semantic.token
  const token = tokenForCanonicalJson(canonicalJsonStringify(value))
  if (semantic !== undefined) semantic.token = token
  return token
}
