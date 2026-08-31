/**
 * Handle, pending-call and subscription bookkeeping for the capability-RPC endpoints (NXT-105).
 *
 * Everything with a lifecycle crosses the boundary as a handle bound to `(session, generation)`:
 *  - a *local* handle names a capability this side executes (target object + release);
 *  - handles are allocated monotonically per generation, so an id below the allocation counter
 *    that is no longer present is *released* (idempotent release, no tombstones), while an id at
 *    or above the counter was never allocated (a violation);
 *  - releasing a handle cascades to everything created through it (leases, iterators, event
 *    subscriptions) in reverse allocation order; invalidating a generation releases everything;
 *  - pending outbound calls remember cancellation so a late reply after `cancel` is dropped
 *    deterministically instead of being mistaken for a duplicate or an unknown target.
 *
 * Pure data structures: no transport, no timers, no I/O.
 */

import { ModkitError, OperationCancelledError } from '@modkit/core'
import type {
  ErrorDto,
  HandleKind,
  HandleRef,
  ProgressDto,
  ProtocolLimits,
  WireValue,
} from './protocol.js'

// ---------------------------------------------------------------------------------------------
// local handles

export interface LocalHandleRecord {
  readonly id: string
  readonly kind: HandleKind
  /** Surface identity for `lease` handles; iterators/events carry the item validator only. */
  readonly contract?: string
  readonly major?: number
  readonly target: unknown
  readonly parent?: string
  readonly children: Set<string>
  /** Called exactly once, on release; must be idempotent on the target side. */
  readonly release: () => Promise<void> | void
  released: boolean
}

export interface HandleTableCounts {
  readonly live: number
  readonly leases: number
  readonly iterators: number
  readonly events: number
  readonly allocated: number
  readonly releasedTotal: number
}

export type HandleLookup =
  | { readonly state: 'live'; readonly record: LocalHandleRecord }
  | { readonly state: 'released' }
  | { readonly state: 'unknown' }
  | { readonly state: 'foreign-generation' }

export class HandleTable {
  private readonly records = new Map<string, LocalHandleRecord>()
  private sequence = 0
  private releasedTotal = 0
  private invalidated = false

  constructor(
    /** `h` for the host endpoint, `w` for the executing endpoint (see protocol HANDLE_ID). */
    readonly owner: 'h' | 'w',
    readonly generation: number,
    private readonly limits: ProtocolLimits,
  ) {}

  get isInvalidated(): boolean {
    return this.invalidated
  }

  counts(): HandleTableCounts {
    let leases = 0
    let iterators = 0
    let events = 0
    for (const record of this.records.values()) {
      if (record.kind === 'lease') leases += 1
      else if (record.kind === 'iterator') iterators += 1
      else events += 1
    }
    return Object.freeze({
      live: this.records.size,
      leases,
      iterators,
      events,
      allocated: this.sequence,
      releasedTotal: this.releasedTotal,
    })
  }

  private assertLimit(kind: HandleKind): void {
    const counts = this.counts()
    const limit = (code: string, current: number, max: number) => {
      if (current >= max) {
        throw new ModkitError({
          code: 'x3.host/rpc-limit-exceeded',
          message: `${code} limit ${max} reached for generation ${this.generation}`,
          context: { limit: code, max },
          retryability: 'conditional',
        })
      }
    }
    limit('handles', counts.live, this.limits.maxHandles)
    if (kind === 'iterator') limit('iterators', counts.iterators, this.limits.maxIterators)
    if (kind === 'events') limit('events', counts.events, this.limits.maxSubscriptions)
  }

  allocate(input: {
    readonly kind: HandleKind
    readonly target: unknown
    readonly release: () => Promise<void> | void
    readonly contract?: string
    readonly major?: number
    readonly parent?: string
  }): LocalHandleRecord {
    if (this.invalidated) {
      throw new ModkitError({
        code: 'x3.host/rpc-generation-invalidated',
        message: `generation ${this.generation} is invalidated; no new handles`,
      })
    }
    this.assertLimit(input.kind)
    if (input.parent !== undefined) {
      const parent = this.records.get(input.parent)
      if (parent === undefined) {
        throw new ModkitError({
          code: 'x3.host/rpc-unknown-handle',
          message: `parent handle ${input.parent} is not live`,
        })
      }
    }
    this.sequence += 1
    const id = `${this.owner}${this.generation}-${this.sequence}`
    const record: LocalHandleRecord = {
      id,
      kind: input.kind,
      ...(input.contract === undefined ? {} : { contract: input.contract }),
      ...(input.major === undefined ? {} : { major: input.major }),
      target: input.target,
      ...(input.parent === undefined ? {} : { parent: input.parent }),
      children: new Set(),
      release: input.release,
      released: false,
    }
    this.records.set(id, record)
    if (input.parent !== undefined) this.records.get(input.parent)?.children.add(id)
    return record
  }

  private parseId(id: string): { owner: string; generation: number; sequence: number } | undefined {
    const match = /^([hw])(\d+)-(\d+)$/u.exec(id)
    if (match === null) return undefined
    return { owner: match[1] as string, generation: Number(match[2]), sequence: Number(match[3]) }
  }

  /** True when the id was allocated by this side (owner prefix), whatever its generation. */
  owns(id: string): boolean {
    return this.parseId(id)?.owner === this.owner
  }

  lookup(id: string): HandleLookup {
    const live = this.records.get(id)
    if (live !== undefined) return { state: 'live', record: live }
    const parsed = this.parseId(id)
    if (
      parsed === undefined ||
      parsed.owner !== this.owner ||
      parsed.generation !== this.generation
    ) {
      return { state: 'foreign-generation' }
    }
    return parsed.sequence >= 1 && parsed.sequence <= this.sequence
      ? { state: 'released' }
      : { state: 'unknown' }
  }

  /**
   * Releases a handle and everything created through it (children first, reverse allocation
   * order). Idempotent: an already released or unknown-but-plausible id reports `false`.
   * Release failures are collected, never swallowed.
   */
  async release(
    id: string,
  ): Promise<{ readonly released: boolean; readonly failures: readonly unknown[] }> {
    const record = this.records.get(id)
    if (record === undefined) return { released: false, failures: [] }
    const failures: unknown[] = []
    await this.releaseRecord(record, failures)
    return { released: true, failures }
  }

  private async releaseRecord(record: LocalHandleRecord, failures: unknown[]): Promise<void> {
    if (record.released) return
    record.released = true
    const children = [...record.children].reverse()
    for (const childId of children) {
      const child = this.records.get(childId)
      if (child !== undefined) await this.releaseRecord(child, failures)
    }
    this.records.delete(record.id)
    if (record.parent !== undefined) this.records.get(record.parent)?.children.delete(record.id)
    this.releasedTotal += 1
    try {
      await record.release()
    } catch (error) {
      failures.push(error)
    }
  }

  /** Releases every live handle (reverse allocation order) and refuses future allocations. */
  async invalidate(): Promise<{
    readonly released: readonly string[]
    readonly failures: readonly unknown[]
  }> {
    this.invalidated = true
    const failures: unknown[] = []
    const released: string[] = []
    const ids = [...this.records.keys()].reverse()
    for (const id of ids) {
      const record = this.records.get(id)
      if (record === undefined) continue
      released.push(id)
      await this.releaseRecord(record, failures)
    }
    return { released, failures }
  }

  liveIds(): readonly string[] {
    return [...this.records.keys()]
  }
}

// ---------------------------------------------------------------------------------------------
// pending outbound calls

export type PendingOutcome =
  | {
      readonly kind: 'return'
      readonly value: WireValue | undefined
      readonly handle?: never
      /** `leased-value`: the release-only handle owning `value`. */
      readonly lease?: HandleRef
    }
  | { readonly kind: 'handle'; readonly value: unknown }
  | { readonly kind: 'throw'; readonly error: ErrorDto }
  | { readonly kind: 'done' }

export interface PendingCall {
  readonly id: number
  readonly kind: 'call' | 'load' | 'next' | 'subscribe' | 'release'
  readonly resolve: (outcome: PendingOutcome) => void
  readonly reject: (error: ModkitError) => void
  readonly onProgress?: (progress: ProgressDto) => void
  cancelled: boolean
  settled: boolean
}

export type SettleResult = 'settled' | 'late-after-cancel' | 'duplicate' | 'unknown'

/**
 * Outbound calls awaiting a reply. Ids are the sender's own monotonic frame ids. After `cancel`
 * the entry stays until the peer replies (or the endpoint closes) so that the late reply is
 * recognised and dropped; a reply for an id that was never pending — or was already settled — is
 * a protocol violation the caller reports.
 */
export class PendingCalls {
  private readonly calls = new Map<number, PendingCall>()
  private lateAfterCancel = 0
  /** Highest id ever opened; a reply above it never had a call, a reply at or below it did. */
  private highestOpened = 0

  constructor(private readonly limits: ProtocolLimits) {}

  get size(): number {
    return this.calls.size
  }

  get droppedLateReplies(): number {
    return this.lateAfterCancel
  }

  open(call: Omit<PendingCall, 'cancelled' | 'settled'>): PendingCall {
    // A cancelled request stays here until its one terminal reply arrives, so a late reply can be
    // released/dropped deterministically. It still consumes bounded bookkeeping: a peer that
    // never replies after cancel must not turn this table into an unbounded memory sink.
    if (this.calls.size >= this.limits.maxPendingCalls) {
      throw new ModkitError({
        code: 'x3.host/rpc-limit-exceeded',
        message: `pending call limit ${this.limits.maxPendingCalls} reached`,
        context: { limit: 'pendingCalls', max: this.limits.maxPendingCalls },
        retryability: 'conditional',
      })
    }
    const entry: PendingCall = { ...call, cancelled: false, settled: false }
    this.calls.set(call.id, entry)
    if (call.id > this.highestOpened) this.highestOpened = call.id
    return entry
  }

  peek(id: number): PendingCall | undefined {
    return this.calls.get(id)
  }

  /** Forgets a call that was never sent (send failure); the caller rejects it locally. */
  drop(id: number): void {
    this.calls.delete(id)
  }

  /** Marks the call cancelled locally; the caller has already been rejected with cancellation. */
  cancel(id: number): PendingCall | undefined {
    const entry = this.calls.get(id)
    if (entry === undefined || entry.settled) return undefined
    entry.cancelled = true
    return entry
  }

  progress(id: number, progress: ProgressDto): SettleResult {
    const entry = this.calls.get(id)
    if (entry === undefined) return id <= this.highestOpened ? 'duplicate' : 'unknown'
    if (entry.cancelled) return 'late-after-cancel'
    entry.onProgress?.(progress)
    return 'settled'
  }

  settle(id: number, outcome: PendingOutcome): SettleResult {
    const entry = this.calls.get(id)
    if (entry === undefined) return id <= this.highestOpened ? 'duplicate' : 'unknown'
    this.calls.delete(id)
    if (entry.cancelled) {
      this.lateAfterCancel += 1
      return 'late-after-cancel'
    }
    if (entry.settled) return 'duplicate'
    entry.settled = true
    entry.resolve(outcome)
    return 'settled'
  }

  /** Rejects every non-cancelled pending call (endpoint failure / peer exit). */
  failAll(error: ModkitError): number {
    let rejected = 0
    for (const entry of [...this.calls.values()]) {
      this.calls.delete(entry.id)
      if (entry.cancelled || entry.settled) continue
      entry.settled = true
      entry.reject(error)
      rejected += 1
    }
    return rejected
  }
}

// ---------------------------------------------------------------------------------------------
// inbound (executing) calls

export interface ActiveCall {
  readonly id: number
  readonly controller: AbortController
  cancelled: boolean
}

/** Calls this side is currently executing for the peer; `cancel` frames abort them. */
export class ActiveCalls {
  private readonly calls = new Map<number, ActiveCall>()

  get size(): number {
    return this.calls.size
  }

  begin(id: number): ActiveCall {
    const entry: ActiveCall = { id, controller: new AbortController(), cancelled: false }
    this.calls.set(id, entry)
    return entry
  }

  end(id: number): void {
    this.calls.delete(id)
  }

  cancel(id: number): boolean {
    const entry = this.calls.get(id)
    if (entry === undefined) return false
    entry.cancelled = true
    entry.controller.abort(new OperationCancelledError('cancelled by peer'))
    return true
  }

  cancelAll(): void {
    for (const entry of this.calls.values()) {
      entry.cancelled = true
      entry.controller.abort(new OperationCancelledError('endpoint closed'))
    }
    this.calls.clear()
  }
}

// ---------------------------------------------------------------------------------------------
// subscriptions (event streams the peer pushes to us)

export interface SubscriptionRecord {
  readonly id: string
  readonly handle: string
  readonly queue: WireValue[]
  wake: (() => void) | undefined
  /** The pusher ended the stream; queued items are still delivered, then the consumer finishes. */
  closed: boolean
  error: ModkitError | undefined
}

/**
 * Consumer-side view of event streams the peer pushes; ids are allocated by the pusher. A closed
 * subscription stays registered until its consumer drained the queue and dropped it, so a
 * `done` arriving right after the last events never loses them.
 */
export class Subscriptions {
  private readonly records = new Map<string, SubscriptionRecord>()

  constructor(private readonly limits: ProtocolLimits) {}

  /** Live (not yet closed) subscriptions. */
  get size(): number {
    let live = 0
    for (const record of this.records.values()) if (!record.closed) live += 1
    return live
  }

  register(id: string, handle: string): SubscriptionRecord {
    if (this.records.has(id)) {
      throw new ModkitError({
        code: 'x3.host/rpc-duplicate-subscription',
        message: `subscription ${id} is already registered`,
      })
    }
    if (this.size >= this.limits.maxSubscriptions) {
      throw new ModkitError({
        code: 'x3.host/rpc-limit-exceeded',
        message: `subscription limit ${this.limits.maxSubscriptions} reached`,
        context: { limit: 'subscriptions', max: this.limits.maxSubscriptions },
        retryability: 'conditional',
      })
    }
    const record: SubscriptionRecord = {
      id,
      handle,
      queue: [],
      wake: undefined,
      closed: false,
      error: undefined,
    }
    this.records.set(id, record)
    return record
  }

  get(id: string): SubscriptionRecord | undefined {
    return this.records.get(id)
  }

  entries(): readonly (readonly [string, SubscriptionRecord])[] {
    return [...this.records.entries()]
  }

  /** Enqueues an event; `overflow` when the consumer is too slow (bounded queue). */
  push(id: string, value: WireValue): 'queued' | 'overflow' | 'unknown' {
    const record = this.records.get(id)
    if (record === undefined || record.closed) return 'unknown'
    if (record.queue.length >= this.limits.maxQueuedEvents) return 'overflow'
    record.queue.push(value)
    record.wake?.()
    return 'queued'
  }

  /** Marks the stream ended (optionally by failure) and wakes the consumer; keeps the queue. */
  close(id: string, error?: ModkitError): void {
    const record = this.records.get(id)
    if (record === undefined) return
    record.closed = true
    if (error !== undefined) record.error = error
    record.wake?.()
  }

  /** The consumer is done with the record (drained or abandoned). */
  drop(id: string): void {
    this.records.delete(id)
  }

  closeAll(error?: ModkitError): void {
    for (const id of [...this.records.keys()]) this.close(id, error)
  }
}
