/**
 * Browser-safe progress reporting shared by codecs, operations, and hosts.
 *
 * Reporters form a tree of relative ranges. Every numeric update is mapped into the root
 * `0..1` range before it reaches the listener, so a host only has to maintain one monotonic
 * progress watermark for an operation.
 */

import { ModkitError } from '@modkitx/core/errors'
import { throwIfCancelled, type CancellationToken } from './cancellation.js'
import { isJsonSerializable, type JsonObject, type JsonValue } from './json.js'

export const ASSET_PROGRESS_SCHEMA_VERSION = 1 as const

export interface AssetProgress {
  readonly schemaVersion: typeof ASSET_PROGRESS_SCHEMA_VERSION
  /** Immutable path from the reporter root to the scope that emitted this update. */
  readonly scope: readonly string[]
  /** Numeric progress mapped into the root reporter's `0..1` range. */
  readonly fraction?: number
  /** Scope-local work count, preserved when the producer reported counts. */
  readonly completed?: number
  /** Scope-local total, present whenever {@link completed} is present. */
  readonly total?: number
  readonly message?: string
  readonly detail?: JsonObject
}

export interface AssetProgressUpdate {
  /** Scope-local fraction. Mutually exclusive with `completed` and `total`. */
  readonly fraction?: number
  /** Scope-local work count. Must be supplied together with `total`. */
  readonly completed?: number
  /** Positive scope-local total. Must be supplied together with `completed`. */
  readonly total?: number
  readonly message?: string
  readonly detail?: JsonObject
}

/** Relative portion of the parent reporter assigned to a child scope. */
export interface AssetProgressRange {
  readonly start: number
  readonly end: number
}

export type AssetProgressListener = (progress: AssetProgress) => void

export interface AssetProgressReporter {
  /** Immutable path identifying this reporter. */
  readonly scope: readonly string[]
  report(update: AssetProgressUpdate): void
  createScope(id: string, range: AssetProgressRange): AssetProgressReporter
  /** Emits the end of this scope once. Subsequent calls are no-ops. */
  complete(): void
}

export interface AssetProgressReporterOptions {
  readonly cancellationToken?: CancellationToken
  /** Optional immutable prefix for the root reporter's scope path. */
  readonly scope?: readonly string[]
}

interface ProgressState {
  readonly listener: AssetProgressListener
  readonly cancellationToken: CancellationToken | undefined
  watermark: number
}

/** Removes insignificant affine-mapping noise while retaining meaningful fractional precision. */
function normalizeRootFraction(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toPrecision(15))))
}

function invalidProgress(message: string, context: Record<string, unknown>): never {
  throw new ModkitError({ code: 'CONFIG_INVALID', message, context })
}

function validateScope(scope: readonly string[], operation: string): void {
  if (!Array.isArray(scope)) {
    invalidProgress('Asset progress scope must be an array of IDs', { operation, scope })
  }
  for (let index = 0; index < scope.length; index += 1) {
    const id = scope[index]
    if (typeof id !== 'string' || id.trim().length === 0) {
      invalidProgress('Asset progress scope IDs must be non-empty strings', {
        operation,
        scope: [...scope],
        index,
        id,
      })
    }
  }
}

function validateRange(range: AssetProgressRange, scope: readonly string[]): void {
  if (
    range === null ||
    typeof range !== 'object' ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end > 1 ||
    range.start >= range.end
  ) {
    invalidProgress('Asset progress scope range must be finite and satisfy 0 <= start < end <= 1', {
      operation: 'createScope',
      scope: [...scope],
      range,
    })
  }
}

function validateUpdate(update: AssetProgressUpdate, scope: readonly string[]): number | undefined {
  if (update === null || typeof update !== 'object' || Array.isArray(update)) {
    invalidProgress('Asset progress update must be an object', {
      operation: 'report',
      scope: [...scope],
      update,
    })
  }
  const hasFraction = update.fraction !== undefined
  const hasCompleted = update.completed !== undefined
  const hasTotal = update.total !== undefined

  if (hasFraction && (hasCompleted || hasTotal)) {
    invalidProgress('Asset progress must use either fraction or completed/total, not both', {
      operation: 'report',
      scope: [...scope],
      fraction: update.fraction,
      completed: update.completed,
      total: update.total,
    })
  }
  if (hasCompleted !== hasTotal) {
    invalidProgress('Asset progress completed and total must be supplied together', {
      operation: 'report',
      scope: [...scope],
      completed: update.completed,
      total: update.total,
    })
  }

  let localFraction: number | undefined
  if (hasFraction) {
    if (!Number.isFinite(update.fraction) || update.fraction! < 0 || update.fraction! > 1) {
      invalidProgress('Asset progress fraction must be finite and between 0 and 1', {
        operation: 'report',
        scope: [...scope],
        fraction: update.fraction,
      })
    }
    localFraction = update.fraction
  } else if (hasCompleted && hasTotal) {
    if (
      !Number.isFinite(update.completed) ||
      !Number.isFinite(update.total) ||
      update.total! <= 0 ||
      update.completed! < 0 ||
      update.completed! > update.total!
    ) {
      invalidProgress(
        'Asset progress counts must be finite and satisfy 0 <= completed <= total with total > 0',
        {
          operation: 'report',
          scope: [...scope],
          completed: update.completed,
          total: update.total,
        },
      )
    }
    localFraction = update.completed! / update.total!
  }

  if (
    update.fraction === undefined &&
    update.completed === undefined &&
    update.total === undefined &&
    update.message === undefined &&
    update.detail === undefined
  ) {
    invalidProgress('Asset progress update must contain progress, a message, or detail', {
      operation: 'report',
      scope: [...scope],
    })
  }
  if (update.message !== undefined && typeof update.message !== 'string') {
    invalidProgress('Asset progress message must be a string', {
      operation: 'report',
      scope: [...scope],
      message: update.message,
    })
  }
  if (
    update.detail !== undefined &&
    (update.detail === null ||
      typeof update.detail !== 'object' ||
      Array.isArray(update.detail) ||
      !isJsonSerializable(update.detail))
  ) {
    invalidProgress('Asset progress detail must be a JSON-serializable object', {
      operation: 'report',
      scope: [...scope],
    })
  }

  return localFraction
}

function cloneAndFreezeJsonObject(detail: JsonObject): JsonObject {
  return freezeJsonValue(JSON.parse(JSON.stringify(detail)) as JsonValue) as JsonObject
}

function freezeJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const entry of value) freezeJsonValue(entry)
    return Object.freeze(value)
  }
  for (const entry of Object.values(value)) freezeJsonValue(entry)
  return Object.freeze(value)
}

class DefaultAssetProgressReporter implements AssetProgressReporter {
  readonly scope: readonly string[]
  private completed = false

  constructor(
    private readonly state: ProgressState,
    scope: readonly string[],
    private readonly absoluteStart: number,
    private readonly absoluteEnd: number,
    private readonly parent?: DefaultAssetProgressReporter,
  ) {
    this.scope = Object.freeze([...scope])
  }

  report(update: AssetProgressUpdate): void {
    this.assertActive('report')
    throwIfCancelled(this.state.cancellationToken, 'Asset progress reporting was cancelled')
    const localFraction = validateUpdate(update, this.scope)
    const fraction =
      localFraction === undefined
        ? undefined
        : normalizeRootFraction(
            this.absoluteStart + (this.absoluteEnd - this.absoluteStart) * localFraction,
          )

    if (fraction !== undefined && fraction < this.state.watermark) {
      invalidProgress('Asset progress cannot decrease the global watermark', {
        operation: 'report',
        scope: [...this.scope],
        fraction,
        previousFraction: this.state.watermark,
      })
    }
    if (fraction !== undefined) this.state.watermark = fraction

    const progress: AssetProgress = {
      schemaVersion: ASSET_PROGRESS_SCHEMA_VERSION,
      scope: this.scope,
      ...(fraction === undefined ? {} : { fraction }),
      ...(update.completed === undefined ? {} : { completed: update.completed }),
      ...(update.total === undefined ? {} : { total: update.total }),
      ...(update.message === undefined ? {} : { message: update.message }),
      ...(update.detail === undefined ? {} : { detail: cloneAndFreezeJsonObject(update.detail) }),
    }
    this.state.listener(Object.freeze(progress))
  }

  createScope(id: string, range: AssetProgressRange): AssetProgressReporter {
    this.assertActive('createScope')
    throwIfCancelled(this.state.cancellationToken, 'Asset progress reporting was cancelled')
    validateScope([id], 'createScope')
    validateRange(range, this.scope)

    const width = this.absoluteEnd - this.absoluteStart
    return new DefaultAssetProgressReporter(
      this.state,
      [...this.scope, id],
      normalizeRootFraction(this.absoluteStart + width * range.start),
      normalizeRootFraction(this.absoluteStart + width * range.end),
      this,
    )
  }

  complete(): void {
    if (this.completed) return
    this.assertAncestorsActive('complete')
    throwIfCancelled(this.state.cancellationToken, 'Asset progress reporting was cancelled')
    if (this.absoluteEnd < this.state.watermark) {
      invalidProgress('Completing an asset progress scope cannot decrease the global watermark', {
        operation: 'complete',
        scope: [...this.scope],
        fraction: this.absoluteEnd,
        previousFraction: this.state.watermark,
      })
    }

    this.completed = true
    this.state.watermark = this.absoluteEnd
    this.state.listener(
      Object.freeze({
        schemaVersion: ASSET_PROGRESS_SCHEMA_VERSION,
        scope: this.scope,
        fraction: this.absoluteEnd,
      }),
    )
  }

  private assertActive(operation: 'report' | 'createScope'): void {
    if (this.completed) {
      invalidProgress('Asset progress scope is already complete', {
        operation,
        scope: [...this.scope],
      })
    }
    this.assertAncestorsActive(operation)
  }

  private assertAncestorsActive(operation: 'report' | 'createScope' | 'complete'): void {
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.completed) {
        invalidProgress('An ancestor asset progress scope is already complete', {
          operation,
          scope: [...this.scope],
          completedScope: [...ancestor.scope],
        })
      }
    }
  }
}

export function createAssetProgressReporter(
  listener: AssetProgressListener,
  options: AssetProgressReporterOptions = {},
): AssetProgressReporter {
  if (typeof listener !== 'function') {
    invalidProgress('Asset progress listener must be a function', {
      operation: 'createAssetProgressReporter',
    })
  }
  const scope = options.scope ?? []
  validateScope(scope, 'createAssetProgressReporter')
  return new DefaultAssetProgressReporter(
    { listener, cancellationToken: options.cancellationToken, watermark: 0 },
    scope,
    0,
    1,
  )
}
