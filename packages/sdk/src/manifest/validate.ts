/**
 * CSP-safe runtime validation over build-time AJV standalone validators.
 *
 * The JSON Schema const remains the single wire authority. `scripts/emit-schemas.mjs` compiles
 * every platform-owned schema and drift-checks both the published JSON and generated validator
 * source. Runtime code never imports AJV's compiler and never relies on `eval`/`new Function`.
 */

import { canonicalJsonStringify, diagnostic, ModkitError, type Diagnostic } from '@modkitx-x3/core'
import { PRECOMPILED_SCHEMA_VALIDATORS } from './validators.generated.js'

export interface JsonSchemaEvaluationError {
  readonly instancePath: string
  readonly keyword: string
  readonly message?: string
  readonly params: Record<string, unknown>
}

/** A validator emitted by trusted build tooling and paired with one immutable schema authority. */
export type PrecompiledSchemaValidator = ((value: unknown) => boolean | Promise<unknown>) & {
  errors?: readonly JsonSchemaEvaluationError[] | null
}

const platformValidators = PRECOMPILED_SCHEMA_VALIDATORS as ReadonlyMap<
  string,
  PrecompiledSchemaValidator
>

function toPath(error: JsonSchemaEvaluationError): (string | number)[] {
  return error.instancePath
    .split('/')
    .filter(part => part.length > 0)
    .map(part =>
      /^\d+$/.test(part) ? Number(part) : part.replaceAll('~1', '/').replaceAll('~0', '~'),
    )
}

function schemaDiagnostics(
  errors: readonly JsonSchemaEvaluationError[] | null | undefined,
  code: string,
): Diagnostic[] {
  return (errors ?? []).map(error =>
    diagnostic(
      'error',
      code,
      `${error.instancePath || '/'} ${error.message ?? 'schema violation'}`,
      toPath(error),
      { keyword: error.keyword, params: error.params },
    ),
  )
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

interface PathNode {
  readonly parent?: PathNode
  readonly segment?: string | number
}

interface PendingJsonValue {
  readonly value?: unknown
  readonly path: PathNode
  readonly parent?: unknown[] | Record<string, unknown>
  readonly key?: string | number
  readonly exit?: object
}

interface JsonSnapshotResult {
  readonly value?: unknown
  readonly diagnostics: readonly Diagnostic[]
}

function materializePath(node: PathNode): (string | number)[] {
  const reversed: (string | number)[] = []
  for (let current: PathNode | undefined = node; current?.segment !== undefined;) {
    reversed.push(current.segment)
    current = current.parent
  }
  return reversed.reverse()
}

function nonJsonDiagnostic(path: readonly (string | number)[], reason: string): Diagnostic {
  return diagnostic(
    'error',
    'x3.sdk/non-json-wire-value',
    `${path.length === 0 ? '/' : `/${path.join('/')}`} is not JSON-wire-safe: ${reason}`,
    path,
    { reason },
  )
}

/**
 * Ajv validates JSON-shaped data, but its JavaScript API also accepts values that JSON can never
 * carry (for example `bigint`, functions, sparse arrays, accessors and cycles). Reject those before
 * schema evaluation so every successful validation result is safe to cross a wire unchanged.
 */
function assignJsonValue(
  parent: unknown[] | Record<string, unknown>,
  key: string | number,
  value: unknown,
): void {
  Object.defineProperty(parent, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  })
}

/** Synchronously validates and clones inert JSON before any async validation boundary. */
function snapshotJsonWireValue(root: unknown): JsonSnapshotResult {
  const holder: { value?: unknown } = {}
  const rootPath: PathNode = {}
  const pending: PendingJsonValue[] = [
    { value: root, path: rootPath, parent: holder, key: 'value' },
  ]
  const active = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    if (current.exit !== undefined) {
      active.delete(current.exit)
      continue
    }

    const { value, path, parent, key } = current
    if (parent === undefined || key === undefined) continue
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      assignJsonValue(parent, key, value)
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        assignJsonValue(parent, key, value)
        continue
      }
      return { diagnostics: [nonJsonDiagnostic(materializePath(path), 'numbers must be finite')] }
    }
    if (typeof value !== 'object') {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), `unsupported JavaScript type ${typeof value}`),
        ],
      }
    }

    if (active.has(value)) {
      return { diagnostics: [nonJsonDiagnostic(materializePath(path), 'cyclic object graph')] }
    }
    active.add(value)
    pending.push({ value, path, exit: value })

    if (Object.getOwnPropertySymbols(value).length > 0) {
      return {
        diagnostics: [
          nonJsonDiagnostic(materializePath(path), 'symbol-keyed properties are not JSON fields'),
        ],
      }
    }

    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value)
      if (ownNames.length !== value.length + 1 || !ownNames.includes('length')) {
        return {
          diagnostics: [
            nonJsonDiagnostic(
              materializePath(path),
              'arrays must be dense and have no extra properties',
            ),
          ],
        }
      }
      const clone: unknown[] = new Array(value.length)
      assignJsonValue(parent, key, clone)
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        const childPath: PathNode = { parent: path, segment: index }
        if (descriptor === undefined) {
          return {
            diagnostics: [nonJsonDiagnostic(materializePath(childPath), 'sparse array element')],
          }
        }
        if (!descriptor.enumerable || !('value' in descriptor)) {
          return {
            diagnostics: [
              nonJsonDiagnostic(
                materializePath(childPath),
                'elements must be enumerable data values',
              ),
            ],
          }
        }
        pending.push({ value: descriptor.value, path: childPath, parent: clone, key: index })
      }
      continue
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        diagnostics: [
          nonJsonDiagnostic(
            materializePath(path),
            'objects must have Object.prototype or a null prototype',
          ),
        ],
      }
    }
    const clone: Record<string, unknown> = {}
    assignJsonValue(parent, key, clone)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      const childPath: PathNode = { parent: path, segment: key }
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return {
          diagnostics: [
            nonJsonDiagnostic(
              materializePath(childPath),
              'fields must be enumerable data properties',
            ),
          ],
        }
      }
      pending.push({ value: descriptor.value, path: childPath, parent: clone, key })
    }
  }

  return { value: holder.value, diagnostics: [] }
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  const pending: object[] = [value]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child)
    }
    Object.freeze(current)
  }
  return value
}

/** Takes an owned immutable snapshot so schema caches cannot diverge from mutable caller data. */
export function snapshotJsonWireData<Value>(value: Value): Value {
  const snapshot = snapshotJsonWireValue(value)
  if (snapshot.diagnostics.length > 0) {
    throw new ModkitError({
      code: 'x3.sdk/non-json-schema-registration',
      message: 'registered schema must be inert JSON data',
      context: { diagnostics: snapshot.diagnostics },
    })
  }
  return deepFreeze(snapshot.value as Value)
}

/** Object-specialized compatibility name used by schema registries. */
export function snapshotJsonWireObject<Value extends object>(value: Value): Value {
  return snapshotJsonWireData(value)
}

/** Validates `value` against a schema const; returns diagnostics, never throws. */
export async function validateWithSchema(
  schema: object,
  value: unknown,
  code = 'x3.sdk/schema-violation',
  suppliedValidator?: PrecompiledSchemaValidator,
): Promise<Diagnostic[]> {
  let valueSnapshot: JsonSnapshotResult
  try {
    valueSnapshot = snapshotJsonWireValue(value)
  } catch {
    valueSnapshot = {
      diagnostics: [nonJsonDiagnostic([], 'value could not be inspected as inert data')],
    }
  }
  if (valueSnapshot.diagnostics.length > 0) return [...valueSnapshot.diagnostics]

  let schemaSnapshot: object
  let schemaCacheKey: string
  try {
    schemaSnapshot = snapshotJsonWireObject(schema)
    schemaCacheKey = canonicalJsonStringify(schemaSnapshot)
  } catch (error) {
    return [
      diagnostic(
        'error',
        'x3.sdk/invalid-schema-authority',
        'the selected JSON Schema is not inert JSON data',
        [],
        { error: error instanceof Error ? error.message : String(error) },
      ),
    ]
  }
  const validate = suppliedValidator ?? platformValidators.get(schemaCacheKey)
  if (validate === undefined) {
    return [
      diagnostic(
        'error',
        'x3.sdk/invalid-schema-authority',
        'the selected JSON Schema has no CSP-safe precompiled validator',
        [],
        { reason: 'precompiled-validator-missing' },
      ),
    ]
  }
  try {
    const result = validate(valueSnapshot.value)
    if (isPromiseLike(result)) {
      await result
      return []
    }
    if (result) return []
  } catch (error) {
    const asyncErrors = (error as { errors?: readonly JsonSchemaEvaluationError[] | null } | null)
      ?.errors
    if (asyncErrors !== undefined && asyncErrors !== null) {
      return schemaDiagnostics(asyncErrors, code)
    }
    const reason = error instanceof Error ? error.message : String(error)
    return [
      diagnostic(
        'error',
        'x3.sdk/schema-evaluation-failed',
        `the selected JSON Schema failed while evaluating inert wire data: ${reason}`,
        [],
        { error: reason },
      ),
    ]
  }
  return schemaDiagnostics(validate.errors, code)
}
