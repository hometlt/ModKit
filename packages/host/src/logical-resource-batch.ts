import type {
  LogicalResourcePort,
  LogicalResourceReadBatchItem,
  LogicalResourceReadBatchRequest,
  LogicalResourceReadBatchResult,
  LogicalResourceReadOutcome,
  LogicalResourceRequirement,
  ResourceBudget,
} from '@modkit/sdk'
import { isRevisionId } from '@modkit/sdk'
import { logicalResourceDeadline } from './logical-resource-deadline.js'

type Refusal = Extract<LogicalResourceReadBatchResult, { state: 'refused' }>
type Unavailable = 'context-unavailable' | 'permission-missing' | undefined

/** Shared worker slots, including reserved starts and calls still cleaning up after a timeout. */
export interface LogicalResourceBatchState {
  activeReads: number
  reservedBytes: bigint
}

export interface LogicalResourceBatchContext {
  readonly state: LogicalResourceBatchState
  readonly budget: ResourceBudget
  readonly resolve: LogicalResourcePort['resolve']
  readonly captureRequirement: (value: LogicalResourceRequirement) => LogicalResourceRequirement
  readonly unavailable: () => Unavailable
}

function refused(reason: Refusal['reason'], message: string): Refusal {
  return Object.freeze({
    state: 'refused',
    reason,
    message,
    items: Object.freeze([] as const),
    bytes: 0n,
  })
}

function deadlineOutcome(message: string): LogicalResourceReadOutcome {
  return Object.freeze({ state: 'unresolved', reason: 'deadline-exceeded', message })
}

function capture(
  request: LogicalResourceReadBatchRequest,
  context: LogicalResourceBatchContext,
): LogicalResourceReadBatchRequest {
  if (request === null || typeof request !== 'object')
    throw new TypeError('A read batch is required.')
  const { items, concurrency, readTimeoutMs, totalTimeoutMs, maxBytes } = request
  if (
    Object.keys(request).some(
      key => !['items', 'concurrency', 'readTimeoutMs', 'totalTimeoutMs', 'maxBytes'].includes(key),
    ) ||
    !Array.isArray(items) ||
    items.length > context.budget.maxNodes ||
    ![concurrency, readTimeoutMs, totalTimeoutMs].every(
      value => Number.isSafeInteger(value) && value > 0,
    ) ||
    typeof maxBytes !== 'bigint' ||
    maxBytes < 0n
  )
    throw new TypeError('Invalid bounded read batch.')
  const length = items.length
  const selected: LogicalResourceReadBatchItem[] = []
  let textBytes = 0
  for (let index = 0; index < length; index += 1) {
    const item = items[index]
    if (
      item === null ||
      typeof item !== 'object' ||
      Object.keys(item).some(key => !['requirement', 'expectedRevision', 'size'].includes(key))
    )
      throw new TypeError('Invalid batch item.')
    const { requirement: raw, expectedRevision, size } = item
    if (
      (expectedRevision !== undefined && !isRevisionId(expectedRevision)) ||
      (size !== undefined && (typeof size !== 'bigint' || size < 0n))
    )
      throw new TypeError('Invalid batch revision or extent.')
    const requirement = context.captureRequirement(raw)
    textBytes += new TextEncoder().encode(
      requirement.id +
        requirement.logicalId +
        (requirement.parentResourceId ?? '') +
        (requirement.alternatives ?? []).join('') +
        (expectedRevision ?? '') +
        requirement.scopes.join(''),
    ).length
    if (textBytes > context.budget.maxScalarBytes)
      throw new TypeError('Batch metadata exceeds the subject budget.')
    selected.push(
      Object.freeze({
        requirement,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        ...(size === undefined ? {} : { size }),
      }),
    )
  }
  const ceiling =
    context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes)
      ? context.budget.maxInputBytes
      : BigInt(context.budget.maxScalarBytes)
  return Object.freeze({
    items: Object.freeze(selected),
    concurrency: Math.min(concurrency, 4, context.budget.maxNodes),
    readTimeoutMs: Math.min(readTimeoutMs, 8000, context.budget.deadlineMs ?? Infinity),
    totalTimeoutMs: Math.min(totalTimeoutMs, 10000, context.budget.deadlineMs ?? Infinity),
    maxBytes: maxBytes < ceiling ? maxBytes : ceiling,
  })
}

/** Bounded scheduling over the existing subject resolver; no paths or resolver authority added. */
export async function readLogicalResourceBatch(
  request: LogicalResourceReadBatchRequest,
  context: LogicalResourceBatchContext,
  signal?: AbortSignal,
): Promise<LogicalResourceReadBatchResult> {
  signal?.throwIfAborted()
  const unavailable = context.unavailable()
  if (unavailable !== undefined) return refused(unavailable, 'A live readable subject is required.')
  let captured: LogicalResourceReadBatchRequest
  try {
    captured = capture(request, context)
  } catch (error) {
    return refused(
      'request-invalid',
      error instanceof Error ? error.message : 'Invalid read batch.',
    )
  }
  const declaredBytes = captured.items.reduce((total, item) => total + (item.size ?? 0n), 0n)
  if (declaredBytes > captured.maxBytes)
    return refused('budget-exceeded', 'Batch extents exceed the combined byte budget.')
  if (captured.items.length === 0)
    return Object.freeze({ state: 'complete', items: Object.freeze([]), bytes: 0n })
  const results: (LogicalResourceReadOutcome | undefined)[] = Array.from({
    length: captured.items.length,
  })
  const controller = new AbortController()
  let fatal: Refusal | undefined
  let reservedBytes = 0n
  const hostByteCeiling =
    context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes)
      ? context.budget.maxInputBytes
      : BigInt(context.budget.maxScalarBytes)
  const reservations = new Set<{ bytes: bigint; settled: boolean }>()
  let closed = false
  const releaseReservation = (reservation: { bytes: bigint; settled: boolean }): void => {
    if (!reservations.delete(reservation)) return
    context.state.reservedBytes -= reservation.bytes
  }
  let cursor = 0
  const fail = (reason: Refusal['reason'], message: string): void => {
    if (fatal !== undefined) return
    fatal = refused(reason, message)
    controller.abort(new DOMException(message, 'AbortError'))
  }
  const readResolved = async (
    item: LogicalResourceReadBatchItem,
    itemSignal: AbortSignal,
    reservation: { bytes: bigint; settled: boolean },
  ): Promise<LogicalResourceReadOutcome> => {
    const resolution = await context.resolve(item.requirement, itemSignal)
    if (resolution.state === 'unresolved') {
      itemSignal.throwIfAborted()
      if (
        [
          'budget-exceeded',
          'source-revision-changed',
          'permission-missing',
          'session-disposed',
        ].includes(resolution.reason)
      )
        fail(resolution.reason, resolution.diagnostic.message)
      return Object.freeze({
        state: 'unresolved',
        reason: resolution.reason,
        message: resolution.diagnostic.message,
        provenance: resolution.provenance,
      })
    }
    try {
      itemSignal.throwIfAborted()
      const source = resolution.lease.value
      if (item.expectedRevision !== undefined && resolution.revision !== item.expectedRevision) {
        fail('source-revision-changed', 'A resource changed after candidate discovery.')
        itemSignal.throwIfAborted()
      }
      if (source.kind !== 'bytes' || source.size === undefined)
        return Object.freeze({
          state: 'unresolved',
          reason: 'size-mismatch',
          message: 'A bounded byte source is required.',
          provenance: resolution.provenance,
        })
      const size = source.size
      if (item.size !== undefined && item.size !== size) {
        fail('source-revision-changed', 'A resource extent changed after candidate discovery.')
        itemSignal.throwIfAborted()
      }
      if (
        size < 0n ||
        size > BigInt(Number.MAX_SAFE_INTEGER) ||
        reservedBytes + size > captured.maxBytes ||
        context.state.reservedBytes + size > hostByteCeiling
      ) {
        fail('budget-exceeded', 'Resolved extents exceed the combined batch byte budget.')
        itemSignal.throwIfAborted()
      }
      // Keep every reservation until this batch ends, including timed-out backend calls.
      // A late backend allocation cannot evade the combined resident-buffer ceiling.
      reservedBytes += size
      reservation.bytes = size
      context.state.reservedBytes += size
      const bytes = await source.read(0n, Number(size), itemSignal)
      itemSignal.throwIfAborted()
      const after = context.unavailable()
      if (after !== undefined) {
        fail(after, 'The read context is no longer authorized.')
        itemSignal.throwIfAborted()
      }
      if (bytes.length !== Number(size))
        return Object.freeze({
          state: 'unresolved',
          reason: 'size-mismatch',
          message: 'The resource ended before its declared extent.',
          provenance: resolution.provenance,
        })
      return Object.freeze({
        state: 'read',
        bytes,
        revision: resolution.revision,
        provenance: resolution.provenance,
      })
    } finally {
      await resolution.lease.release()
    }
  }
  const read = async (
    item: LogicalResourceReadBatchItem,
    itemSignal: AbortSignal,
    permit: (typeof permits)[number],
  ): Promise<LogicalResourceReadOutcome> => {
    permit.busy = true
    const reservation = { bytes: 0n, settled: false }
    reservations.add(reservation)
    try {
      return await readResolved(item, itemSignal, reservation)
    } finally {
      permit.busy = false
      if (permit.retired) releasePermit(permit)
      reservation.settled = true
      if (closed) releaseReservation(reservation)
    }
  }
  // Reserve synchronously: another batch may arrive before deadline callbacks start workers.
  const workerCount = Math.min(captured.concurrency, captured.items.length, 4 - context.state.activeReads)
  if (workerCount <= 0)
    return refused('budget-exceeded', 'The subject has no free resource read slots.')
  const permits = Array.from({ length: workerCount }, () => ({ busy: false, retired: false, released: false }))
  const releasePermit = (permit: (typeof permits)[number]): void => {
    if (permit.released) return
    permit.released = true
    context.state.activeReads -= 1
  }
  const retirePermit = (permit: (typeof permits)[number]): void => {
    permit.retired = true
    if (!permit.busy) releasePermit(permit)
  }
  context.state.activeReads += workerCount
  const onAbort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  try {
    const completion = await logicalResourceDeadline(
      async batchSignal => {
        const worker = async (permit: (typeof permits)[number]): Promise<void> => {
          try {
            while (cursor < captured.items.length) {
              batchSignal.throwIfAborted()
              if (permit.retired) return
              const index = cursor++
              const item = captured.items[index]
              if (item === undefined) throw new TypeError('Captured batch item is absent.')
              try {
                const result = await logicalResourceDeadline(
                  itemSignal => read(item, itemSignal, permit),
                  captured.readTimeoutMs,
                  batchSignal,
                )
                if (result.state === 'deadline-exceeded') {
                  results[index] = deadlineOutcome('The resource read exceeded its duration ceiling.')
                  // An uncooperative backend may still be running: do not reuse this slot.
                  return
                }
                results[index] = result.value
              } catch (error) {
                batchSignal.throwIfAborted()
                const after = context.unavailable()
                if (after !== undefined) {
                  fail(after, 'The read context is no longer authorized.')
                  return
                }
                const code =
                  error !== null && typeof error === 'object' && 'code' in error
                    ? error.code
                    : undefined
                if (
                  typeof code === 'string' &&
                  (code.includes('budget-exceeded') || code.includes('revision-changed'))
                ) {
                  fail(
                    code.includes('revision-changed') ? 'source-revision-changed' : 'budget-exceeded',
                    'The host refused a staged resource read.',
                  )
                  return
                }
                results[index] = Object.freeze({
                  state: 'unresolved',
                  reason: 'read-failed',
                  message: 'The resource could not be read.',
                })
              }
            }
          } finally {
            // A timed-out worker keeps its permit until the underlying lease cleanup settles.
            retirePermit(permit)
          }
        }
        await Promise.all(permits.map(worker))
      },
      captured.totalTimeoutMs,
      controller.signal,
    )
    signal?.throwIfAborted()
    if (fatal !== undefined) return fatal
    if (completion.state === 'deadline-exceeded')
      return refused('deadline-exceeded', 'The complete batch exceeded its duration ceiling.')
    const after = context.unavailable()
    if (after !== undefined) return refused(after, 'The read context is no longer authorized.')
    const items = Object.freeze(
      results.map(
        item => item ?? deadlineOutcome('No read slot remained after timed-out backend calls.'),
      ),
    )
    return Object.freeze({
      state: 'complete',
      items,
      bytes: items.reduce(
        (sum, item) => sum + (item.state === 'read' ? BigInt(item.bytes.length) : 0n),
        0n,
      ),
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (fatal !== undefined) return fatal
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    closed = true
    // Includes permits whose deadline callback never started because cancellation won the race.
    for (const permit of permits) retirePermit(permit)
    for (const reservation of reservations) {
      if (reservation.settled) releaseReservation(reservation)
    }
  }
}
