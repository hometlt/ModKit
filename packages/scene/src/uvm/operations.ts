import type { JsonObject, JsonValue } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { DEFAULT_UVM_CONTAINER_BUDGET } from '@modkit/uv/model/container'
import {
  openUvmDocument,
  type UvmBinaryEdit,
  type UvmDocumentOptions,
  type UvmJsonEdit,
} from './document.js'

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as JsonObject
}

/** Prepare one scalar field write from the existing common field/tree contract. No storage writes. */
export function prepareUvmFieldWrite(
  bytes: Uint8Array,
  input: JsonValue,
  options: UvmDocumentOptions = {},
): Uint8Array {
  const budget = options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET
  const request = object(
    snapshotJson(
      input,
      { maxBytes: budget.maxJsonBytes, maxNodes: budget.maxNodes, maxDepth: budget.maxDepth },
      options.signal,
    ),
    'UVM field request',
  )
  const path = request['path']
  if (!Array.isArray(path) || path.length === 0 || !path.every(key => typeof key === 'string'))
    throw new TypeError('UVM field write requires its full semantic path')
  const value = request['value']
  if (
    value === undefined ||
    request['groupId'] !== 'tree' ||
    request['key'] !== path.at(-1) ||
    !Object.hasOwn(request, 'value')
  )
    throw new TypeError('UVM field identity or value is invalid')
  const pointer =
    '/' + path.map(key => (key as string).replace(/~/gu, '~0').replace(/\//gu, '~1')).join('/')
  return prepareUvmJsonEdits(bytes, [{ op: 'replace', path: pointer, value }], options)
}

/** Shared draft preparation: capture original state, validate the complete candidate, then serialize. */
export function prepareUvmJsonEdits(
  bytes: Uint8Array,
  edits: readonly UvmJsonEdit[],
  options: UvmDocumentOptions = {},
): Uint8Array {
  if (edits.length === 0) throw new TypeError('UVM edit batch must not be empty')
  const document = openUvmDocument(bytes, { ...options, maxHistoryEntries: 0 })
  try {
    const expectedRevision = document.status().revision
    const result = document.apply({ expectedRevision, json: edits })
    return document.serialize(result.revision)
  } finally {
    document.dispose()
  }
}

/** JSON operation input used by UI, MCP and CLI; all edits share one atomic candidate. */
export function prepareUvmEditRequest(
  bytes: Uint8Array,
  input: JsonValue,
  options: UvmDocumentOptions = {},
): Uint8Array {
  const budget = options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET
  const request = object(
    snapshotJson(
      input,
      { maxBytes: budget.maxJsonBytes, maxNodes: budget.maxNodes, maxDepth: budget.maxDepth + 3 },
      options.signal,
    ),
    'UVM edit request',
  )
  if (Object.keys(request).some(key => key !== 'json' && key !== 'binary'))
    throw new TypeError('UVM edit request accepts only json and binary edit arrays')
  const jsonInput = Object.hasOwn(request, 'json') ? request['json'] : []
  const binaryInput = Object.hasOwn(request, 'binary') ? request['binary'] : []
  if (!Array.isArray(jsonInput) || !Array.isArray(binaryInput))
    throw new TypeError('UVM edit request requires edit arrays')
  if (jsonInput.length + binaryInput.length === 0)
    throw new TypeError('UVM edit batch must not be empty')
  if (jsonInput.length + binaryInput.length > (options.maxEdits ?? 4096))
    throw new RangeError('UVM edit batch exceeds maxEdits')
  const edits = jsonInput.map((entry): UvmJsonEdit => {
    const edit = object(entry, 'UVM JSON edit')
    const op = edit['op']
    const path = edit['path']
    if (
      typeof path !== 'string' ||
      (op !== 'add' && op !== 'replace' && op !== 'remove') ||
      Object.keys(edit).some(key => !['op', 'path', 'value'].includes(key))
    )
      throw new TypeError('invalid UVM JSON edit')
    if (op === 'remove') {
      if (Object.hasOwn(edit, 'value')) throw new TypeError('remove edit cannot carry a value')
      return { op, path }
    }
    const value = edit['value']
    if (value === undefined || !Object.hasOwn(edit, 'value'))
      throw new TypeError('UVM JSON edit value is missing')
    return { op, path, value }
  })
  let binaryBytes = 0
  const binary = binaryInput.map((entry): UvmBinaryEdit => {
    const edit = object(entry, 'UVM binary edit')
    const byteOffset = edit['byteOffset']
    const bytesHex = edit['bytesHex']
    if (
      Object.keys(edit).some(key => key !== 'byteOffset' && key !== 'bytesHex') ||
      typeof byteOffset !== 'number' ||
      !Number.isSafeInteger(byteOffset) ||
      byteOffset < 0 ||
      typeof bytesHex !== 'string' ||
      bytesHex.length === 0 ||
      bytesHex.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/u.test(bytesHex)
    )
      throw new TypeError('UVM binary edit requires a byte offset and nonempty hexadecimal bytes')
    binaryBytes += bytesHex.length / 2
    if (binaryBytes > budget.maxInputBytes)
      throw new RangeError('UVM binary edits exceed maxInputBytes')
    const replacement = new Uint8Array(bytesHex.length / 2)
    for (let index = 0; index < replacement.length; index++) {
      if ((index & 4095) === 0 && options.signal?.aborted)
        throw new DOMException('operation cancelled', 'AbortError')
      replacement[index] = Number.parseInt(bytesHex.slice(index * 2, index * 2 + 2), 16)
    }
    return { byteOffset, bytes: replacement }
  })
  const document = openUvmDocument(bytes, { ...options, maxHistoryEntries: 0 })
  try {
    const result = document.apply({
      expectedRevision: document.status().revision,
      json: edits,
      binary,
    })
    return document.serialize(result.revision)
  } finally {
    document.dispose()
  }
}
