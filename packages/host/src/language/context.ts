import { canonicalJsonStringify, compareUtf8 } from '@modkit/core'
import type { JsonValue } from '@modkit/sdk'
import type { LanguageWorkspaceSemanticInput } from '@modkit/sdk/language'

export const LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_DEPTH = 64
export const LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES = 64 * 1024 * 1024
const LANGUAGE_WORKSPACE_SEMANTIC_INPUTS_MAX = 256
const encoder = new TextEncoder()

const boundedContextText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8_192 && !value.includes('\0')

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
    const expectedKeys = new Set(['length'])
    for (let index = 0; index < value.length; index += 1) expectedKeys.add(String(index))
    if (
      keys.length !== expectedKeys.size ||
      keys.some(key => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
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
      payloadBytes += encoder.encode(JSON.stringify(payload)).byteLength
      if (payloadBytes > LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES) {
        throw new TypeError('language workspace semantic payload exceeds maximum bytes')
      }
    }
    const copy = Object.freeze({
      kind,
      id,
      revision,
      ...(hasPayload ? { payload: payload! } : {}),
    })
    const key = `${copy.kind}\0${copy.id}`
    const previous = byKey.get(key)
    if (
      previous !== undefined &&
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

const fnv64 = (value: string, seed: bigint, reverse: boolean): string => {
  const bytes = new TextEncoder().encode(value)
  let hash = seed
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = reverse ? bytes.length - index - 1 : index
    hash ^= BigInt(bytes[offset]!)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

/** Compact deterministic identity for a canonical host-owned language context description. */
export const languageWorkspaceContextToken = (value: unknown): string => {
  const canonical = canonicalJsonStringify(value)
  return `language-context-v1:${fnv64(canonical, 0xcbf29ce484222325n, false)}${fnv64(canonical, 0x84222325cbf29ce4n, true)}`
}
