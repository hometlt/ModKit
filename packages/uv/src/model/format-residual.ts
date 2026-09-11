import type { JsonObject, JsonValue } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from './container.js'

export interface UvmFormatResidualInput {
  readonly namespace: string
  readonly format: string
  readonly profile: string
  readonly residual: JsonObject
  readonly mapping: JsonObject
}

function object(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as JsonObject
}

/** Attach format-owned reconstruction data without retaining native input bytes. The format
 * codec owns the field ledger that proves every residual member cannot be represented by glTF or
 * a common UVM extension. */
export function attachUvmFormatResidual(
  source: UvmContainer,
  input: UvmFormatResidualInput,
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): UvmContainer {
  signal?.throwIfAborted()
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(input.namespace))
    throw new TypeError('invalid format residual namespace')
  if (!input.format.trim() || !input.profile.trim())
    throw new TypeError('format residual requires format and profile')
  const extras =
    source.document['extras'] === undefined ? {} : object(source.document['extras'], 'extras')
  if (Object.hasOwn(extras, input.namespace))
    throw new TypeError('format residual namespace already exists')
  const envelope = snapshotJson(
    {
      schemaVersion: 1,
      format: input.format,
      profile: input.profile,
      residual: input.residual,
      mapping: input.mapping,
    },
    { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
    signal,
  ) as JsonObject
  const result: UvmContainer = {
    ...source,
    document: snapshotJson(
      { ...source.document, extras: { ...extras, [input.namespace]: envelope } },
      { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
      signal,
    ) as JsonObject,
  }
  writeUvmContainer(result, budget, signal)
  return Object.freeze(result)
}

export function readUvmFormatResidual(
  container: UvmContainer,
  namespace: string,
): Readonly<{
  format: string
  profile: string
  residual: JsonObject
  mapping: JsonObject
}> {
  const envelope = object(object(container.document['extras'], 'extras')[namespace], namespace)
  if (envelope['schemaVersion'] !== 1)
    throw new TypeError('unsupported format residual schemaVersion')
  const format = envelope['format'],
    profile = envelope['profile']
  if (typeof format !== 'string' || !format.trim() || typeof profile !== 'string' || !profile.trim())
    throw new TypeError('invalid format residual identity')
  return Object.freeze({
    format,
    profile,
    residual: object(envelope['residual'], 'format residual'),
    mapping: object(envelope['mapping'], 'format mapping'),
  })
}
