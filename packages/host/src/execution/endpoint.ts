/**
 * Capability-RPC endpoint — the transport-agnostic state machine both sides of an execution
 * boundary run (NXT-105). A transport (Node `worker_threads`, browser `Worker`, Electron
 * preload/IPC — all NXT-114/115/401, not here) supplies a `FramePort` that moves frames as
 * structured-clone data; this module supplies everything else:
 *
 *  - outbound calls with cancellation (`AbortSignal` → `cancel` frame), deadlines and progress;
 *  - inbound execution of calls on exposed local capabilities under an `AbortSignal`;
 *  - handles for leases, iterators (pull: `next`/`done`) and event streams (push:
 *    `subscribe`/`event`/`unsubscribe`/`done`), generation-aware, released deterministically;
 *  - materialized proxies so ABI consumers see plain objects with methods (surface-driven);
 *  - fail-closed handling: any protocol violation closes the endpoint, rejects every pending
 *    call, releases every local target and reports the violation to the transport, which
 *    terminates the peer. Late replies after `cancel` are dropped and counted, never mistaken
 *    for duplicates.
 *
 * What it does not know: workers, ports, module loading (a `loader` is injected), the public SDK
 * ABI, or any standard surface data (a `SurfaceRegistry` is injected).
 */

import {
  isModkitError,
  ModkitError,
  OperationCancelledError,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  ActiveCalls,
  HandleTable,
  PendingCalls,
  Subscriptions,
  type PendingOutcome,
} from './handles.js'
import {
  CAPABILITY_RPC_DOMAIN,
  CAPABILITY_RPC_VERSION,
  DEFAULT_PROTOCOL_LIMITS,
  fromErrorDto,
  handleRef,
  HANDLE_MARKER,
  isHandleRef,
  isPlainObject,
  protocolViolationError,
  toErrorDto,
  validateFrame,
  validateWireValue,
  type Frame,
  type FrameOf,
  type HandleKind,
  type HandleRef,
  type ProgressDto,
  type ProtocolLimits,
  type ProtocolViolation,
  type WireValue,
} from './protocol.js'
import type { CapabilitySurface, MethodSurface, SurfaceRegistry } from './surface.js'

// ---------------------------------------------------------------------------------------------
// public types

export type EndpointRole = 'host' | 'worker'
export type EndpointState = 'open' | 'closed' | 'failed'

/** The only thing a transport has to provide. Frames are moved as structured-clone data. */
export interface FramePort {
  post(frame: Frame, transfer: readonly ArrayBuffer[]): void
  onFrame(handler: (frame: unknown) => void): () => void
}

export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface LoadRequest {
  readonly moduleUrl: string
  readonly contributionId: string
  readonly variantId: string
  readonly artifactDigest: string
  /** Digest of the entrypoint bytes the executing side must re-verify right before evaluation. */
  readonly entrypointDigest?: string
}

export interface LoadedModule {
  readonly module: object
  /** Surface of the module object (its `createCodec`/`createProvider` methods). */
  readonly surface: { readonly contract: string; readonly major: number }
  readonly release?: () => Promise<void> | void
}

export interface EndpointOptions {
  readonly role: EndpointRole
  readonly port: FramePort
  readonly session: string
  readonly generation: number
  readonly surfaces: SurfaceRegistry
  readonly limits?: ProtocolLimits
  /** Executing side only: turns a validated `load` request into a module object. */
  readonly loader?: (request: LoadRequest, signal: AbortSignal) => Promise<LoadedModule>
  readonly scheduler?: Scheduler
  /** A protocol violation or peer failure closed the endpoint; the transport terminates the peer. */
  readonly onFailure?: (failure: ProtocolViolation | ModkitError) => void
  /** Non-fatal observations (dropped late replies/events, release failures). */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** The peer asked this side to terminate (worker role). */
  readonly onTerminate?: (reason: string) => void
}

export interface CallOptions {
  readonly signal?: AbortSignal
  /** Overrides `limits.defaultCallDeadlineMs`; 0 disables the deadline. */
  readonly deadlineMs?: number
  readonly onProgress?: (progress: ProgressDto) => void
}

export type CallOutcome =
  | { readonly kind: 'value'; readonly value: WireValue | undefined }
  | { readonly kind: 'lease'; readonly remote: RemoteCapability }
  | {
      readonly kind: 'leased-value'
      readonly value: WireValue | undefined
      /** Releases the peer-side lease that owns `value`; idempotent. */
      readonly release: () => Promise<void>
    }
  | { readonly kind: 'iterable'; readonly iterable: AsyncIterable<WireValue> }
  | { readonly kind: 'events'; readonly events: AsyncIterable<WireValue> }

/** A capability this endpoint executes; hand its `ref` to the peer (e.g. inside call args). */
export interface LocalCapability {
  readonly ref: HandleRef
  readonly contract: string
  readonly major: number
  readonly isReleased: boolean
  release(): Promise<void>
}

/** A capability the peer executes; call it, iterate it, release it. */
export interface RemoteCapability {
  readonly ref: HandleRef
  readonly contract: string
  readonly major: number
  readonly isReleased: boolean
  /** Data fields the peer copied when it created the handle (surface `fields`). */
  readonly data: Readonly<Record<string, WireValue>>
  call(method: string, args?: readonly unknown[], options?: CallOptions): Promise<CallOutcome>
  release(): Promise<void>
}

export interface LoadResult {
  readonly abiVersion: 1
  readonly exports: readonly string[]
  readonly root: RemoteCapability
}

export interface EndpointCounters {
  readonly state: EndpointState
  readonly outbound: number
  readonly inbound: number
  readonly pendingCalls: number
  readonly activeCalls: number
  readonly localHandles: number
  readonly remoteHandles: number
  readonly subscriptions: number
  readonly droppedLateReplies: number
  readonly droppedEvents: number
  readonly violations: number
}

export interface Endpoint {
  readonly role: EndpointRole
  readonly session: string
  readonly generation: number
  readonly state: EndpointState
  readonly limits: ProtocolLimits
  expose(
    target: object,
    surface: { readonly contract: string; readonly major: number },
    release?: () => Promise<void> | void,
  ): LocalCapability
  /** Host role: load a module on the peer and receive its root capability. */
  load(request: LoadRequest, options?: CallOptions): Promise<LoadResult>
  /** Wraps a handle ref received in data (e.g. a call argument) as a remote capability. */
  proxy(ref: HandleRef): RemoteCapability
  /** Surface-driven object with one method per declared method; usable as the ABI object. */
  materialize(remote: RemoteCapability): Record<string, unknown>
  /** Deliver one raw frame from the transport. */
  receive(raw: unknown): void
  /** Graceful close initiated by this side (sends `terminate`). */
  close(reason: string): Promise<void>
  /** The transport observed the peer going away. */
  peerClosed(reason: string): Promise<void>
  counters(): EndpointCounters
}

/** Marker on materialized proxies so they can be passed back as arguments. */
export const CAPABILITY_OF = Symbol.for('x3.host/rpc/proxied-remote')

// ---------------------------------------------------------------------------------------------
// implementation

interface RemoteHandleState {
  readonly ref: HandleRef
  released: boolean
  readonly children: Set<string>
  readonly parent?: string
}

interface IteratorTarget {
  readonly iterator: AsyncIterator<unknown>
  busy: boolean
}

interface EventsTarget {
  readonly iterable: AsyncIterable<unknown>
  subscription?: string
  stopped: boolean
}

interface PumpState {
  readonly handle: string
  stopped: boolean
  iterator?: AsyncIterator<unknown>
}

class RemoteCapabilityImpl implements RemoteCapability {
  constructor(
    private readonly endpoint: EndpointImpl,
    readonly ref: HandleRef,
    readonly contract: string,
    readonly major: number,
    readonly data: Readonly<Record<string, WireValue>> = Object.freeze({}),
  ) {}

  get id(): string {
    return this.ref[HANDLE_MARKER].id
  }

  get isReleased(): boolean {
    return this.endpoint.remoteReleased(this.id)
  }

  call(
    method: string,
    args: readonly unknown[] = [],
    options: CallOptions = {},
  ): Promise<CallOutcome> {
    return this.endpoint.callRemote(this, method, args, options)
  }

  release(): Promise<void> {
    return this.endpoint.releaseRemote(this.id)
  }
}

class LocalCapabilityImpl implements LocalCapability {
  constructor(
    private readonly endpoint: EndpointImpl,
    readonly ref: HandleRef,
    readonly contract: string,
    readonly major: number,
  ) {}

  get isReleased(): boolean {
    return this.endpoint.localReleased(this.ref[HANDLE_MARKER].id)
  }

  async release(): Promise<void> {
    await this.endpoint.releaseLocal(this.ref[HANDLE_MARKER].id)
  }
}

const noopRelease = (): void => undefined

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}

function isLeaseLike(
  value: unknown,
): value is { readonly value: unknown; release(): Promise<void> | void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    typeof (value as { release?: unknown }).release === 'function'
  )
}

class EndpointImpl implements Endpoint {
  readonly role: EndpointRole
  readonly session: string
  readonly generation: number
  readonly limits: ProtocolLimits
  state: EndpointState = 'open'

  private readonly port: FramePort
  private readonly surfaces: SurfaceRegistry
  private readonly loader: EndpointOptions['loader']
  private readonly scheduler: Scheduler
  private readonly onFailure: EndpointOptions['onFailure']
  private readonly onDiagnostic: EndpointOptions['onDiagnostic']
  private readonly onTerminate: EndpointOptions['onTerminate']
  private readonly unsubscribePort: () => void

  private readonly ownerPrefix: 'h' | 'w'
  private readonly table: HandleTable
  private readonly pending: PendingCalls
  private readonly active = new ActiveCalls()
  private readonly subscriptions: Subscriptions
  private readonly remote = new Map<string, RemoteHandleState>()
  private readonly remoteProxies = new Map<string, RemoteCapabilityImpl>()
  private readonly pumps = new Map<string, PumpState>()
  private pumpSequence = 0
  private outboundId = 0
  private lastInboundId = 0
  private droppedEvents = 0
  private violations = 0
  private inboundCount = 0

  constructor(options: EndpointOptions) {
    this.role = options.role
    this.session = options.session
    this.generation = options.generation
    this.limits = options.limits ?? DEFAULT_PROTOCOL_LIMITS
    this.port = options.port
    this.surfaces = options.surfaces
    this.loader = options.loader
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
    this.onFailure = options.onFailure
    this.onDiagnostic = options.onDiagnostic
    this.onTerminate = options.onTerminate
    this.ownerPrefix = options.role === 'host' ? 'h' : 'w'
    this.table = new HandleTable(this.ownerPrefix, options.generation, this.limits)
    this.pending = new PendingCalls(this.limits)
    this.subscriptions = new Subscriptions(this.limits)
    this.unsubscribePort = options.port.onFrame(raw => this.receive(raw))
  }

  // ------------------------------------------------------------------ public surface

  counters(): EndpointCounters {
    return Object.freeze({
      state: this.state,
      outbound: this.outboundId,
      inbound: this.inboundCount,
      pendingCalls: this.pending.size,
      activeCalls: this.active.size,
      localHandles: this.table.counts().live,
      remoteHandles: [...this.remote.values()].filter(item => !item.released).length,
      subscriptions: this.subscriptions.size,
      droppedLateReplies: this.pending.droppedLateReplies,
      droppedEvents: this.droppedEvents,
      violations: this.violations,
    })
  }

  expose(
    target: object,
    surface: { readonly contract: string; readonly major: number },
    release: () => Promise<void> | void = noopRelease,
  ): LocalCapability {
    this.assertOpen()
    if (this.surfaces.surfaceFor(surface.contract, surface.major) === undefined) {
      throw new ModkitError({
        code: 'x3.host/rpc-unknown-surface',
        message: `cannot expose a capability with unregistered surface ${surface.contract}@${surface.major}`,
      })
    }
    const data = this.fieldData(target, surface)
    const record = this.table.allocate({
      kind: 'lease',
      target,
      release,
      contract: surface.contract,
      major: surface.major,
    })
    return new LocalCapabilityImpl(
      this,
      handleRef(record.id, 'lease', surface, data),
      surface.contract,
      surface.major,
    )
  }

  async load(request: LoadRequest, options: CallOptions = {}): Promise<LoadResult> {
    this.assertOpen()
    if (this.role !== 'host') {
      throw new ModkitError({
        code: 'x3.host/rpc-role-violation',
        message: 'only the host endpoint loads modules',
      })
    }
    const outcome = await this.request({ t: 'load', ...request }, 'load', options)
    if (outcome.kind === 'throw') throw fromErrorDto(outcome.error)
    if (outcome.kind !== 'handle') {
      throw this.failWith({ code: 'unexpected-frame', message: 'load must be answered by ready' })
    }
    const ready = outcome.value as {
      readonly abiVersion: 1
      readonly exports: readonly string[]
      readonly root: HandleRef
    }
    return Object.freeze({ abiVersion: 1, exports: ready.exports, root: this.proxy(ready.root) })
  }

  proxy(ref: HandleRef): RemoteCapability {
    const inner = ref[HANDLE_MARKER]
    if (this.table.owns(inner.id)) {
      throw new ModkitError({
        code: 'x3.host/rpc-not-remote',
        message: `handle ${inner.id} is local to this endpoint`,
      })
    }
    if (inner.kind !== 'lease' || inner.contract === undefined || inner.major === undefined) {
      throw new ModkitError({
        code: 'x3.host/rpc-bad-handle',
        message: `handle ${inner.id} is not a lease capability`,
      })
    }
    if (this.surfaces.surfaceFor(inner.contract, inner.major) === undefined) {
      throw this.failWith({
        code: 'unknown-surface',
        message: `peer offered unregistered surface ${inner.contract}@${inner.major}`,
      })
    }
    const existing = this.remoteProxies.get(inner.id)
    if (existing !== undefined) return existing
    if (!this.remote.has(inner.id))
      this.remote.set(inner.id, { ref, released: false, children: new Set() })
    const capability = new RemoteCapabilityImpl(
      this,
      ref,
      inner.contract,
      inner.major,
      Object.freeze({ ...(inner.data ?? {}) }),
    )
    this.remoteProxies.set(inner.id, capability)
    return capability
  }

  materialize(remote: RemoteCapability): Record<string, unknown> {
    const surface = this.requireSurface(remote.contract, remote.major)
    const object: Record<string, unknown> = {}
    for (const field of surface.fields ?? []) {
      if (Object.hasOwn(remote.data, field)) {
        Object.defineProperty(object, field, {
          value: remote.data[field],
          enumerable: true,
          writable: false,
        })
      }
    }
    for (const [name, method] of Object.entries(surface.methods)) {
      object[name] = async (...rawArgs: unknown[]) => {
        const args = [...rawArgs]
        let signal: AbortSignal | undefined
        const last = args[args.length - 1]
        if (isAbortSignal(last)) {
          signal = last
          args.pop()
        }
        const outcome = await remote.call(name, args, signal === undefined ? {} : { signal })
        switch (outcome.kind) {
          case 'value':
            return outcome.value
          case 'lease': {
            const materialized = this.materialize(outcome.remote)
            return method.wrapper === 'lease'
              ? { value: materialized, release: () => outcome.remote.release() }
              : materialized
          }
          case 'leased-value':
            return { value: outcome.value, release: outcome.release }
          case 'iterable':
            return outcome.iterable
          case 'events':
            return outcome.events
        }
      }
    }
    if (surface.releaseVia !== undefined) {
      const inner = object[surface.releaseVia] as (...args: unknown[]) => Promise<unknown>
      object[surface.releaseVia] = async (...args: unknown[]) => {
        try {
          return await inner(...args)
        } finally {
          await remote.release()
        }
      }
    }
    Object.defineProperty(object, CAPABILITY_OF, { value: remote, enumerable: false })
    return object
  }

  receive(raw: unknown): void {
    if (this.state !== 'open') return
    const validated = validateFrame(raw, this.limits, {
      session: this.session,
      generation: this.generation,
    })
    if (!validated.ok) {
      this.fail(validated.violation)
      return
    }
    const frame = validated.value
    if (frame.id <= this.lastInboundId) {
      this.fail({
        code: 'non-monotonic-id',
        message: `frame id ${frame.id} is not greater than ${this.lastInboundId}`,
      })
      return
    }
    this.lastInboundId = frame.id
    this.inboundCount += 1
    void this.dispatch(frame).catch((error: unknown) => {
      // Handlers convert their own failures into frames; anything escaping is an endpoint bug
      // and is treated as a violation so it cannot leave leases behind silently.
      this.fail({
        code: 'unexpected-frame',
        message: `frame handler failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
  }

  async close(reason: string): Promise<void> {
    if (this.state !== 'open') return
    this.state = 'closed'
    this.trySend({ t: 'terminate', reason })
    await this.teardown(
      new ModkitError({
        code: 'x3.host/rpc-endpoint-closed',
        message: `endpoint closed: ${reason}`,
        retryability: 'conditional',
      }),
    )
  }

  async peerClosed(reason: string): Promise<void> {
    if (this.state !== 'open') return
    this.state = 'closed'
    await this.teardown(
      new ModkitError({
        code: 'x3.host/rpc-peer-exited',
        message: `peer exited: ${reason}`,
        retryability: 'conditional',
      }),
    )
  }

  // ------------------------------------------------------------------ internal: lifecycle

  private assertOpen(): void {
    if (this.state !== 'open') {
      throw new ModkitError({
        code: 'x3.host/rpc-endpoint-closed',
        message: `endpoint is ${this.state}`,
      })
    }
  }

  private failWith(item: ProtocolViolation): ModkitError {
    this.fail(item)
    return protocolViolationError(item)
  }

  private fail(item: ProtocolViolation): void {
    if (this.state !== 'open') return
    this.violations += 1
    this.state = 'failed'
    this.trySend({ t: 'terminate', reason: `protocol violation: ${item.code}` })
    void this.teardown(protocolViolationError(item))
    this.onFailure?.(item)
  }

  private async teardown(error: ModkitError): Promise<void> {
    this.unsubscribePort()
    this.pending.failAll(error)
    this.active.cancelAll()
    this.subscriptions.closeAll(error)
    for (const pump of this.pumps.values()) {
      pump.stopped = true
      void pump.iterator?.return?.()
    }
    this.pumps.clear()
    for (const state of this.remote.values()) state.released = true
    const { failures } = await this.table.invalidate()
    for (const failure of failures)
      this.report(
        'x3.host/rpc-release-failed',
        `release failed during teardown: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
  }

  private report(code: string, message: string): void {
    this.onDiagnostic?.({ code, severity: 'warning', message })
  }

  // ------------------------------------------------------------------ internal: sending

  private nextId(): number {
    this.outboundId += 1
    return this.outboundId
  }

  private buildFrame(body: FrameBody): Frame {
    return {
      domain: CAPABILITY_RPC_DOMAIN,
      version: CAPABILITY_RPC_VERSION,
      session: this.session,
      generation: this.generation,
      id: this.nextId(),
      ...body,
    } as Frame
  }

  /** Sends a frame; outbound values are validated with our own limits before they leave. */
  private send(body: FrameBody): Frame {
    const frame = this.buildFrame(body)
    const transfer: ArrayBuffer[] = []
    const measure = (value: unknown, handles: 'forbid' | 'top' | 'nested') => {
      const checked = validateWireValue(value, this.limits, handles)
      if (!checked.ok) {
        throw new ModkitError({
          code: 'x3.host/rpc-outbound-value-invalid',
          message: `outbound value rejected: ${checked.violation.message}`,
          context: { violation: checked.violation.code },
        })
      }
      transfer.push(...checked.value.transferables)
    }
    if (frame.t === 'call') measure(frame.args, 'nested')
    else if (frame.t === 'return' && frame.value !== undefined) measure(frame.value, 'top')
    else if (frame.t === 'event') measure(frame.value, 'forbid')
    this.port.post(frame, transfer)
    return frame
  }

  private trySend(body: FrameBody): void {
    try {
      this.port.post(this.buildFrame(body), [])
    } catch {
      // the transport is already gone; nothing else to do
    }
  }

  private request(
    body: FrameBody,
    kind: 'call' | 'load' | 'next' | 'subscribe' | 'release',
    options: CallOptions,
  ): Promise<PendingOutcome> {
    this.assertOpen()
    if (options.signal?.aborted) {
      return Promise.reject(new OperationCancelledError(options.signal.reason))
    }
    return new Promise<PendingOutcome>((resolve, reject) => {
      const id = this.outboundId + 1
      let timer: unknown
      let abortListener: (() => void) | undefined
      const cleanup = () => {
        if (timer !== undefined) this.scheduler.clearTimeout(timer)
        if (abortListener !== undefined) options.signal?.removeEventListener('abort', abortListener)
      }
      const entry = this.pending.open({
        id,
        kind,
        resolve: outcome => {
          cleanup()
          resolve(outcome)
        },
        reject: error => {
          cleanup()
          reject(error)
        },
        ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      })
      const cancelWith = (error: ModkitError) => {
        if (entry.settled || entry.cancelled) return
        this.pending.cancel(id)
        cleanup()
        this.trySend({ t: 'cancel', target: id })
        reject(error)
      }
      const deadline = options.deadlineMs ?? this.limits.defaultCallDeadlineMs
      if (deadline > 0 && kind !== 'subscribe') {
        timer = this.scheduler.setTimeout(
          () =>
            cancelWith(
              new ModkitError({
                code: 'x3.host/rpc-deadline-exceeded',
                message: `${kind} #${id} exceeded its ${deadline} ms deadline`,
                context: { id, deadlineMs: deadline },
                retryability: 'conditional',
              }),
            ),
          deadline,
        )
      }
      if (options.signal !== undefined) {
        abortListener = () => cancelWith(new OperationCancelledError(options.signal?.reason))
        options.signal.addEventListener('abort', abortListener, { once: true })
      }
      try {
        const frame = this.send(body)
        if (frame.id !== id) {
          throw new ModkitError({
            code: 'x3.host/rpc-internal',
            message: 'frame id allocation raced',
          })
        }
      } catch (error) {
        this.pending.drop(id)
        cleanup()
        reject(
          isModkitError(error)
            ? error
            : new ModkitError({ code: 'x3.host/rpc-send-failed', message: String(error) }),
        )
      }
    })
  }

  // ------------------------------------------------------------------ internal: remote side

  remoteReleased(id: string): boolean {
    return this.remote.get(id)?.released ?? true
  }

  localReleased(id: string): boolean {
    return this.table.lookup(id).state !== 'live'
  }

  private requireSurface(contract: string, major: number): CapabilitySurface {
    const surface = this.surfaces.surfaceFor(contract, major)
    if (surface === undefined) {
      throw new ModkitError({
        code: 'x3.host/rpc-unknown-surface',
        message: `no surface registered for ${contract}@${major}`,
      })
    }
    return surface
  }

  private encodeArgs(args: readonly unknown[]): WireValue[] {
    const encode = (value: unknown, path: string): WireValue => {
      if (value instanceof RemoteCapabilityImpl || value instanceof LocalCapabilityImpl) {
        if (value.isReleased) {
          throw new ModkitError({
            code: 'x3.host/rpc-released-handle',
            message: `argument ${path} is a released capability`,
          })
        }
        return value.ref as unknown as WireValue
      }
      if (typeof value === 'object' && value !== null && CAPABILITY_OF in value) {
        return encode((value as Record<symbol, unknown>)[CAPABILITY_OF], path)
      }
      if (isHandleRef(value)) return value as unknown as WireValue
      if (Array.isArray(value)) return value.map((item, index) => encode(item, `${path}[${index}]`))
      if (isPlainObject(value)) {
        const out: Record<string, WireValue> = {}
        for (const [key, item] of Object.entries(value)) out[key] = encode(item, `${path}.${key}`)
        return out
      }
      return value as WireValue
    }
    return args.map((arg, index) => encode(arg, `args[${index}]`))
  }

  async callRemote(
    remote: RemoteCapabilityImpl,
    method: string,
    args: readonly unknown[],
    options: CallOptions,
  ): Promise<CallOutcome> {
    this.assertOpen()
    if (remote.isReleased) {
      throw new ModkitError({
        code: 'x3.host/rpc-released-handle',
        message: `remote ${remote.id} was released`,
      })
    }
    const surface = this.requireSurface(remote.contract, remote.major)
    const decl = surface.methods[method]
    if (decl === undefined) {
      throw new ModkitError({
        code: 'x3.host/rpc-unknown-method',
        message: `surface ${remote.contract}@${remote.major} has no method «${method}»`,
      })
    }
    if (args.length > this.limits.maxArgs) {
      throw new ModkitError({
        code: 'x3.host/rpc-limit-exceeded',
        message: `more than ${this.limits.maxArgs} arguments`,
      })
    }
    const encoded = this.encodeArgs(args)
    const argProblem = decl.validateArgs?.(encoded)
    if (argProblem !== undefined) {
      throw new ModkitError({
        code: 'x3.host/rpc-bad-argument',
        message: `${method}: ${argProblem}`,
      })
    }
    const outcome = await this.request(
      {
        t: 'call',
        handle: remote.id,
        method,
        args: encoded,
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
      },
      'call',
      options,
    )
    if (outcome.kind === 'throw') throw fromErrorDto(outcome.error)
    if (outcome.kind === 'done')
      throw this.failWith({ code: 'unexpected-frame', message: 'call answered with done' })
    if (surface.releaseVia === method) this.markRemoteReleased(remote.id)
    if (decl.kind === 'value') {
      if (outcome.kind !== 'return')
        throw this.failWith({
          code: 'bad-return',
          message: `value method «${method}» returned a handle`,
        })
      const problem = decl.validateReturn?.(outcome.value)
      if (problem !== undefined)
        throw this.failWith({ code: 'bad-return', message: `${method}: ${problem}` })
      return { kind: 'value', value: outcome.value }
    }
    if (decl.kind === 'leased-value') {
      if (outcome.kind !== 'return' || outcome.lease === undefined) {
        throw this.failWith({
          code: 'bad-return',
          message: `leased-value method «${method}» did not return a value with its lease`,
        })
      }
      const problem = decl.validateReturn?.(outcome.value)
      if (problem !== undefined)
        throw this.failWith({ code: 'bad-return', message: `${method}: ${problem}` })
      const leaseId = this.adoptRemoteHandle(outcome.lease, remote.id, 'lease')
      return {
        kind: 'leased-value',
        value: outcome.value,
        release: () => this.releaseRemote(leaseId),
      }
    }
    if (outcome.kind !== 'handle') {
      throw this.failWith({
        code: 'bad-return',
        message: `${decl.kind} method «${method}» returned a plain value`,
      })
    }
    const ref = outcome.value as HandleRef
    const inner = ref[HANDLE_MARKER]
    this.adoptRemoteHandle(ref, remote.id)
    switch (decl.kind) {
      case 'lease': {
        const expected = decl.result
        const dynamic = decl.resultFromArgs !== undefined
        if (
          inner.kind !== 'lease' ||
          inner.contract === undefined ||
          inner.major === undefined ||
          (!dynamic &&
            (expected === undefined ||
              inner.contract !== expected.contract ||
              inner.major !== expected.major))
        ) {
          throw this.failWith({
            code: 'bad-handle',
            message: `lease method «${method}» returned a handle of another kind/surface`,
          })
        }
        if (dynamic && this.surfaces.surfaceFor(inner.contract, inner.major) === undefined) {
          throw this.failWith({
            code: 'unknown-surface',
            message: `lease method «${method}» returned unregistered surface ${inner.contract}@${inner.major}`,
          })
        }
        return { kind: 'lease', remote: this.proxy(ref) }
      }
      case 'iterable': {
        if (inner.kind !== 'iterator')
          throw this.failWith({
            code: 'bad-handle',
            message: `iterable method «${method}» did not return an iterator handle`,
          })
        return { kind: 'iterable', iterable: this.remoteIterable(inner.id, decl) }
      }
      case 'events': {
        if (inner.kind !== 'events')
          throw this.failWith({
            code: 'bad-handle',
            message: `events method «${method}» did not return an events handle`,
          })
        return { kind: 'events', events: this.remoteEvents(inner.id, decl) }
      }
      default:
        throw this.failWith({ code: 'bad-return', message: 'unknown method kind' })
    }
  }

  /** Registers a handle the peer produced for us; refuses our own, reused or over-limit ids. */
  private adoptRemoteHandle(ref: HandleRef, parent: string, expectKind?: HandleKind): string {
    const inner = ref[HANDLE_MARKER]
    if (this.table.owns(inner.id))
      throw this.failWith({ code: 'bad-handle', message: 'peer returned a handle this side owns' })
    if (this.remote.has(inner.id))
      throw this.failWith({ code: 'bad-handle', message: `peer reused handle ${inner.id}` })
    if (expectKind !== undefined && inner.kind !== expectKind)
      throw this.failWith({ code: 'bad-handle', message: `expected a ${expectKind} handle` })
    if (this.remote.size >= this.limits.maxHandles) {
      throw new ModkitError({
        code: 'x3.host/rpc-limit-exceeded',
        message: `remote handle limit ${this.limits.maxHandles} reached`,
      })
    }
    this.remote.set(inner.id, { ref, released: false, children: new Set(), parent })
    this.remote.get(parent)?.children.add(inner.id)
    return inner.id
  }

  private markRemoteReleased(id: string): void {
    const state = this.remote.get(id)
    if (state === undefined || state.released) return
    state.released = true
    for (const child of [...state.children].reverse()) this.markRemoteReleased(child)
    if (state.parent !== undefined) this.remote.get(state.parent)?.children.delete(id)
  }

  async releaseRemote(id: string): Promise<void> {
    const state = this.remote.get(id)
    if (state === undefined || state.released) return
    this.markRemoteReleased(id)
    if (this.state !== 'open') return
    const outcome = await this.request({ t: 'release', handle: id }, 'release', {
      deadlineMs: this.limits.defaultCallDeadlineMs,
    })
    if (outcome.kind === 'throw') throw fromErrorDto(outcome.error)
  }

  private remoteIterable(id: string, decl: MethodSurface): AsyncIterable<WireValue> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<WireValue> => {
        let finished = false
        return {
          next: async (): Promise<IteratorResult<WireValue>> => {
            if (finished || this.remoteReleased(id)) return { done: true, value: undefined }
            const outcome = await this.request({ t: 'next', handle: id }, 'next', {})
            if (outcome.kind === 'done') {
              finished = true
              this.markRemoteReleased(id)
              return { done: true, value: undefined }
            }
            if (outcome.kind === 'throw') {
              finished = true
              this.markRemoteReleased(id)
              throw fromErrorDto(outcome.error)
            }
            if (outcome.kind !== 'return') {
              throw this.failWith({
                code: 'bad-return',
                message: 'iterator item must be a plain value',
              })
            }
            const problem = decl.validateReturn?.(outcome.value)
            if (problem !== undefined) throw this.failWith({ code: 'bad-return', message: problem })
            return { done: false, value: outcome.value as WireValue }
          },
          return: async (): Promise<IteratorResult<WireValue>> => {
            if (!finished) {
              finished = true
              await this.releaseRemote(id)
            }
            return { done: true, value: undefined }
          },
        }
      },
    }
  }

  private remoteEvents(id: string, decl: MethodSurface): AsyncIterable<WireValue> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<WireValue> => {
        let subscription: string | undefined
        let finished = false
        const stop = async () => {
          if (finished) return
          finished = true
          if (subscription !== undefined) {
            this.subscriptions.close(subscription)
            this.subscriptions.drop(subscription)
            if (this.state === 'open') this.trySend({ t: 'unsubscribe', subscription })
          }
          await this.releaseRemote(id)
        }
        return {
          next: async (): Promise<IteratorResult<WireValue>> => {
            if (finished) return { done: true, value: undefined }
            if (subscription === undefined) {
              const outcome = await this.request({ t: 'subscribe', handle: id }, 'subscribe', {})
              if (outcome.kind === 'throw') {
                finished = true
                throw fromErrorDto(outcome.error)
              }
              if (outcome.kind !== 'return' || typeof outcome.value !== 'string') {
                throw this.failWith({
                  code: 'bad-return',
                  message: 'subscribe must return a subscription id',
                })
              }
              subscription = outcome.value
              this.subscriptions.register(subscription, id)
            }
            for (;;) {
              const record = this.subscriptions.get(subscription)
              if (record === undefined) {
                finished = true
                return { done: true, value: undefined }
              }
              const item = record.queue.shift()
              if (item !== undefined) {
                const problem = decl.validateReturn?.(item)
                if (problem !== undefined)
                  throw this.failWith({ code: 'bad-return', message: problem })
                return { done: false, value: item }
              }
              if (record.closed) {
                // ended, failed or torn down — and the queue is drained
                finished = true
                this.subscriptions.drop(subscription)
                if (record.error !== undefined) throw record.error
                return { done: true, value: undefined }
              }
              await new Promise<void>(resolve => {
                record.wake = resolve
              })
              record.wake = undefined
            }
          },
          return: async (): Promise<IteratorResult<WireValue>> => {
            await stop()
            return { done: true, value: undefined }
          },
        }
      },
    }
  }

  private closeSubscription(id: string, error?: ModkitError): void {
    this.subscriptions.close(id, error)
  }

  // ------------------------------------------------------------------ internal: local side

  async releaseLocal(id: string): Promise<void> {
    const result = await this.table.release(id)
    for (const failure of result.failures) {
      this.report(
        'x3.host/rpc-release-failed',
        `release of ${id} failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
    }
  }

  private decodeArgs(args: readonly WireValue[]): unknown[] {
    const decode = (value: WireValue): unknown => {
      if (isHandleRef(value)) {
        const inner = value[HANDLE_MARKER]
        if (this.table.owns(inner.id)) {
          const lookup = this.table.lookup(inner.id)
          if (lookup.state !== 'live') {
            throw new ModkitError({
              code: 'x3.host/rpc-released-handle',
              message: `argument references released local handle ${inner.id}`,
            })
          }
          return lookup.record.target
        }
        if (inner.kind !== 'lease') {
          throw new ModkitError({
            code: 'x3.host/rpc-bad-argument',
            message: 'only lease capabilities may be passed as arguments',
          })
        }
        return this.materialize(this.proxy(value))
      }
      if (Array.isArray(value)) return value.map(item => decode(item))
      if (isPlainObject(value)) {
        const out: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) out[key] = decode(item as WireValue)
        return out
      }
      return value
    }
    return args.map(arg => decode(arg))
  }

  private reply(
    inReplyTo: number,
    outcome:
      | PendingOutcome
      | {
          readonly kind: 'ready'
          readonly value: { abiVersion: 1; exports: readonly string[]; root: HandleRef }
        },
  ): void {
    if (this.state !== 'open') return
    try {
      switch (outcome.kind) {
        case 'return':
          this.send({
            t: 'return',
            inReplyTo,
            ...(outcome.value === undefined ? {} : { value: outcome.value }),
            ...(outcome.lease === undefined ? {} : { lease: outcome.lease }),
          })
          break
        case 'handle':
          this.send({ t: 'return', inReplyTo, value: outcome.value as HandleRef })
          break
        case 'throw':
          this.send({ t: 'throw', inReplyTo, error: outcome.error })
          break
        case 'ready':
          this.send({
            t: 'ready',
            inReplyTo,
            abiVersion: 1,
            exports: outcome.value.exports,
            root: outcome.value.root,
          })
          break
        case 'done':
          break
      }
    } catch (error) {
      // our own outbound value was invalid (e.g. a target returned unbounded data): report it
      // structurally instead of leaking half a reply
      this.trySend({ t: 'throw', inReplyTo, error: toErrorDto(error, this.limits) })
    }
  }

  private async dispatch(frame: Frame): Promise<void> {
    switch (frame.t) {
      case 'load':
        return this.handleLoad(frame)
      case 'ready':
        return this.handleReady(frame)
      case 'call':
        return this.handleCall(frame)
      case 'return':
        return this.handleSettle(
          frame.inReplyTo,
          isHandleRef(frame.value)
            ? { kind: 'handle', value: frame.value }
            : {
                kind: 'return',
                value: frame.value,
                ...(frame.lease === undefined ? {} : { lease: frame.lease }),
              },
        )
      case 'throw':
        return this.handleSettle(frame.inReplyTo, { kind: 'throw', error: frame.error })
      case 'progress': {
        const result = this.pending.progress(frame.inReplyTo, frame.progress)
        // progress after settlement is harmless noise; progress for a call that never existed is not
        if (result === 'unknown')
          this.fail({
            code: 'unknown-reply-target',
            message: `progress for unknown call ${frame.inReplyTo}`,
          })
        return
      }
      case 'cancel':
        this.active.cancel(frame.target)
        return
      case 'next':
        return this.handleNext(frame)
      case 'done':
        return this.handleDone(frame)
      case 'subscribe':
        return this.handleSubscribe(frame)
      case 'event':
        return this.handleEvent(frame)
      case 'unsubscribe': {
        const pump = this.pumps.get(frame.subscription)
        if (pump !== undefined) {
          pump.stopped = true
          this.pumps.delete(frame.subscription)
          await pump.iterator?.return?.()
        }
        return
      }
      case 'release':
        return this.handleRelease(frame)
      case 'terminate':
        if (this.state !== 'open') return
        this.state = 'closed'
        await this.teardown(
          new ModkitError({
            code: 'x3.host/rpc-terminated',
            message: `peer terminated: ${frame.reason}`,
            retryability: 'conditional',
          }),
        )
        this.onTerminate?.(frame.reason)
        return
    }
  }

  private handleSettle(inReplyTo: number, outcome: PendingOutcome): void {
    const result = this.pending.settle(inReplyTo, outcome)
    if (result === 'unknown')
      this.fail({ code: 'unknown-reply-target', message: `reply for unknown call ${inReplyTo}` })
    else if (result === 'duplicate')
      this.fail({ code: 'duplicate-reply', message: `duplicate reply for call ${inReplyTo}` })
    else if (result === 'late-after-cancel')
      this.report(
        'x3.host/rpc-late-reply-dropped',
        `dropped late reply for cancelled call ${inReplyTo}`,
      )
    if (result === 'late-after-cancel' && outcome.kind === 'handle') {
      // the peer created a capability for a call we cancelled: release it so nothing leaks
      const ref = outcome.value as HandleRef
      this.discardHandle(ref[HANDLE_MARKER].id)
    } else if (result === 'late-after-cancel' && outcome.kind === 'return' && outcome.lease) {
      this.discardHandle(outcome.lease[HANDLE_MARKER].id)
    }
  }

  /**
   * Releases a handle the peer produced for a request this side had already cancelled. The peer
   * answers every `release`, so this must be a real request with a pending entry — a
   * fire-and-forget frame would turn the peer's acknowledgement into an `unknown-reply-target`
   * violation (found by the transport conformance kit on real event-loop hops).
   */
  private discardHandle(id: string): void {
    if (this.state !== 'open') return
    const failed = (reason: string) =>
      this.report('x3.host/rpc-release-failed', `discard of late handle ${id} failed: ${reason}`)
    void this.request({ t: 'release', handle: id }, 'release', {
      deadlineMs: this.limits.defaultCallDeadlineMs,
    }).then(
      outcome => {
        if (outcome.kind === 'throw') failed(outcome.error.message)
      },
      (error: unknown) => failed(error instanceof Error ? error.message : String(error)),
    )
  }

  private async handleLoad(frame: FrameOf<'load'>): Promise<void> {
    if (this.role !== 'worker') {
      this.fail({ code: 'unexpected-frame', message: 'load received by a host endpoint' })
      return
    }
    if (this.loader === undefined) {
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(
          new ModkitError({
            code: 'x3.host/rpc-no-loader',
            message: 'this endpoint cannot load modules',
          }),
          this.limits,
        ),
      })
      return
    }
    const active = this.active.begin(frame.id)
    try {
      const loaded = await this.loader(
        {
          moduleUrl: frame.moduleUrl,
          contributionId: frame.contributionId,
          variantId: frame.variantId,
          artifactDigest: frame.artifactDigest,
          ...(frame.entrypointDigest === undefined ? {} : { entrypointDigest: frame.entrypointDigest }),
        },
        active.controller.signal,
      )
      const capability = this.expose(loaded.module, loaded.surface, loaded.release ?? noopRelease)
      const exports = Object.keys(loaded.module)
        .filter(key => key.length <= 256)
        .sort()
      this.reply(frame.id, {
        kind: 'ready',
        value: { abiVersion: 1, exports, root: capability.ref },
      })
    } catch (error) {
      this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
    } finally {
      this.active.end(frame.id)
    }
  }

  private handleReady(frame: FrameOf<'ready'>): void {
    const entry = this.pending.peek(frame.inReplyTo)
    if (entry !== undefined && entry.kind !== 'load' && !entry.cancelled) {
      this.fail({ code: 'unexpected-frame', message: 'ready received for a non-load call' })
      return
    }
    const result = this.pending.settle(frame.inReplyTo, {
      kind: 'handle',
      value: { abiVersion: 1, exports: frame.exports, root: frame.root },
    })
    if (result === 'unknown') {
      this.fail({
        code: 'unknown-reply-target',
        message: `ready for unknown load ${frame.inReplyTo}`,
      })
    } else if (result === 'duplicate') {
      this.fail({ code: 'duplicate-reply', message: `duplicate ready for load ${frame.inReplyTo}` })
    } else if (result === 'late-after-cancel') {
      this.report(
        'x3.host/rpc-late-reply-dropped',
        `dropped late ready for cancelled load ${frame.inReplyTo}`,
      )
      this.discardHandle(frame.root[HANDLE_MARKER].id)
    }
  }

  private async handleCall(frame: FrameOf<'call'>): Promise<void> {
    if (!this.table.owns(frame.handle)) {
      this.fail({
        code: 'unknown-handle',
        message: `call on handle ${frame.handle} this side does not own`,
      })
      return
    }
    const lookup = this.table.lookup(frame.handle)
    if (lookup.state === 'unknown' || lookup.state === 'foreign-generation') {
      this.fail({
        code: lookup.state === 'unknown' ? 'unknown-handle' : 'stale-generation',
        message: `call on ${lookup.state} handle ${frame.handle}`,
      })
      return
    }
    if (lookup.state === 'released') {
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(
          new ModkitError({
            code: 'x3.host/rpc-released-handle',
            message: `handle ${frame.handle} was released`,
          }),
          this.limits,
        ),
      })
      return
    }
    const record = lookup.record
    if (record.kind !== 'lease' || record.contract === undefined || record.major === undefined) {
      this.fail({
        code: 'wrong-handle-kind',
        message: `call on ${record.kind} handle ${frame.handle}`,
      })
      return
    }
    const surface = this.surfaces.surfaceFor(record.contract, record.major)
    const decl = surface?.methods[frame.method]
    if (surface === undefined || decl === undefined) {
      this.fail({
        code: 'unknown-method',
        message: `no method «${frame.method}» on ${record.contract}@${record.major}`,
      })
      return
    }
    let args: unknown[]
    try {
      args = this.decodeArgs(frame.args)
      const problem = decl.validateArgs?.(frame.args)
      if (problem !== undefined)
        throw new ModkitError({
          code: 'x3.host/rpc-bad-argument',
          message: `${frame.method}: ${problem}`,
        })
    } catch (error) {
      this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
      return
    }
    const target = record.target as Record<string, unknown>
    const fn = target[frame.method]
    if (typeof fn !== 'function') {
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(
          new ModkitError({
            code: 'x3.host/rpc-method-unavailable',
            message: `target has no method «${frame.method}»`,
          }),
          this.limits,
        ),
      })
      return
    }
    // a `lease` whose surface is named by the call itself (`dataSource(contract, major)`)
    let dynamicResult: { readonly contract: string; readonly major: number } | undefined
    if (decl.kind === 'lease' && decl.resultFromArgs !== undefined) {
      const contract = args[decl.resultFromArgs.contract]
      const major = args[decl.resultFromArgs.major]
      if (
        typeof contract !== 'string' ||
        typeof major !== 'number' ||
        this.surfaces.surfaceFor(contract, major) === undefined
      ) {
        this.reply(frame.id, {
          kind: 'throw',
          error: toErrorDto(
            new ModkitError({
              code: 'x3.host/rpc-bad-argument',
              message: `${frame.method}: arguments do not name a registered surface`,
            }),
            this.limits,
          ),
        })
        return
      }
      dynamicResult = { contract, major }
    }
    const active = this.active.begin(frame.id)
    if (decl.arity !== undefined) while (args.length < decl.arity) args.push(undefined)
    if (decl.signal === 'last') args.push(active.controller.signal)
    let result: unknown
    try {
      result = await Reflect.apply(fn, target, args)
    } catch (error) {
      this.active.end(frame.id)
      this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
      return
    }
    this.active.end(frame.id)
    if (active.cancelled) {
      // the caller already gave up: nothing must leak, and exactly one reply still goes back so
      // the caller's pending entry is cleared deterministically (it drops it as late-after-cancel)
      if (isLeaseLike(result)) await result.release()
      else if (decl.kind !== 'value' && isAsyncIterable(result)) {
        await result[Symbol.asyncIterator]().return?.()
      }
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(new OperationCancelledError('cancelled by peer'), this.limits),
      })
      return
    }
    switch (decl.kind) {
      case 'value': {
        const checked =
          result === undefined
            ? ({ ok: true } as const)
            : validateWireValue(result, this.limits, 'forbid')
        const problem = checked.ok
          ? decl.validateReturn?.(result as WireValue | undefined)
          : checked.violation.message
        if (problem !== undefined) {
          this.reply(frame.id, {
            kind: 'throw',
            error: toErrorDto(
              new ModkitError({
                code: 'x3.host/rpc-bad-return',
                message: `${frame.method}: ${problem}`,
              }),
              this.limits,
            ),
          })
          return
        }
        this.reply(frame.id, { kind: 'return', value: result as WireValue | undefined })
        if (surface.releaseVia === frame.method) await this.releaseLocal(record.id)
        return
      }
      case 'leased-value': {
        const lease = isLeaseLike(result) ? result : undefined
        const checked =
          lease === undefined
            ? undefined
            : lease.value === undefined
              ? ({ ok: true } as const)
              : validateWireValue(lease.value, this.limits, 'forbid')
        const problem =
          lease === undefined
            ? 'did not return a lease'
            : checked !== undefined && !checked.ok
              ? checked.violation.message
              : decl.validateReturn?.(lease.value as WireValue | undefined)
        if (lease === undefined || problem !== undefined) {
          if (lease !== undefined) await lease.release()
          this.reply(frame.id, {
            kind: 'throw',
            error: toErrorDto(
              new ModkitError({
                code: 'x3.host/rpc-bad-return',
                message: `${frame.method}: ${problem ?? 'did not return a lease'}`,
              }),
              this.limits,
            ),
          })
          return
        }
        try {
          const child = this.table.allocate({
            kind: 'lease',
            target: {},
            release: () => lease.release(),
            parent: record.id,
          })
          this.reply(frame.id, {
            kind: 'return',
            value: lease.value as WireValue | undefined,
            lease: handleRef(child.id, 'lease'),
          })
        } catch (error) {
          await lease.release()
          this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
        }
        return
      }
      case 'lease': {
        const lease = isLeaseLike(result) ? result : undefined
        const value = lease === undefined ? result : lease.value
        const resultSurface = dynamicResult ?? decl.result
        if (typeof value !== 'object' || value === null || resultSurface === undefined) {
          if (lease !== undefined) await lease.release()
          this.reply(frame.id, {
            kind: 'throw',
            error: toErrorDto(
              new ModkitError({
                code: 'x3.host/rpc-bad-return',
                message: `${frame.method} did not return a capability`,
              }),
              this.limits,
            ),
          })
          return
        }
        try {
          const data = this.fieldData(value, resultSurface)
          const child = this.table.allocate({
            kind: 'lease',
            target: value,
            release: lease === undefined ? noopRelease : () => lease.release(),
            contract: resultSurface.contract,
            major: resultSurface.major,
            parent: record.id,
          })
          this.reply(frame.id, {
            kind: 'handle',
            value: handleRef(child.id, 'lease', resultSurface, data),
          })
        } catch (error) {
          if (lease !== undefined) await lease.release()
          this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
        }
        return
      }
      case 'iterable':
      case 'events': {
        if (!isAsyncIterable(result)) {
          this.reply(frame.id, {
            kind: 'throw',
            error: toErrorDto(
              new ModkitError({
                code: 'x3.host/rpc-bad-return',
                message: `${frame.method} did not return an async iterable`,
              }),
              this.limits,
            ),
          })
          return
        }
        try {
          if (decl.kind === 'iterable') {
            const iteratorTarget: IteratorTarget = {
              iterator: result[Symbol.asyncIterator](),
              busy: false,
            }
            const child = this.table.allocate({
              kind: 'iterator',
              target: iteratorTarget,
              release: () => iteratorTarget.iterator.return?.().then(() => undefined),
              parent: record.id,
            })
            this.reply(frame.id, { kind: 'handle', value: handleRef(child.id, 'iterator') })
          } else {
            const eventsTarget: EventsTarget = { iterable: result, stopped: false }
            const child = this.table.allocate({
              kind: 'events',
              target: eventsTarget,
              release: () => {
                eventsTarget.stopped = true
                if (eventsTarget.subscription !== undefined) {
                  const pump = this.pumps.get(eventsTarget.subscription)
                  this.pumps.delete(eventsTarget.subscription)
                  if (pump !== undefined) {
                    pump.stopped = true
                    return pump.iterator?.return?.().then(() => undefined)
                  }
                }
                return undefined
              },
              parent: record.id,
            })
            this.reply(frame.id, { kind: 'handle', value: handleRef(child.id, 'events') })
          }
        } catch (error) {
          await result[Symbol.asyncIterator]().return?.()
          this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
        }
        return
      }
    }
  }

  private async handleNext(frame: FrameOf<'next'>): Promise<void> {
    const lookup = this.lookupOwned(frame.handle, 'iterator')
    if (lookup === undefined) return
    if (lookup.state === 'released') {
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(
          new ModkitError({
            code: 'x3.host/rpc-released-handle',
            message: `iterator ${frame.handle} was released`,
          }),
          this.limits,
        ),
      })
      return
    }
    const target = lookup.record.target as IteratorTarget
    if (target.busy) {
      this.fail({ code: 'iterator-busy', message: `concurrent next on iterator ${frame.handle}` })
      return
    }
    target.busy = true
    const active = this.active.begin(frame.id)
    active.controller.signal.addEventListener('abort', () => void target.iterator.return?.(), {
      once: true,
    })
    try {
      const step = await target.iterator.next()
      if (active.cancelled) {
        this.reply(frame.id, {
          kind: 'throw',
          error: toErrorDto(new OperationCancelledError('cancelled by peer'), this.limits),
        })
        await this.releaseLocal(frame.handle)
        return
      }
      if (step.done === true) {
        this.send({ t: 'done', inReplyTo: frame.id, handle: frame.handle })
        await this.releaseLocal(frame.handle)
        return
      }
      const checked = validateWireValue(step.value, this.limits, 'forbid')
      if (!checked.ok) {
        this.reply(frame.id, {
          kind: 'throw',
          error: toErrorDto(
            new ModkitError({
              code: 'x3.host/rpc-bad-return',
              message: `iterator item rejected: ${checked.violation.message}`,
            }),
            this.limits,
          ),
        })
        await this.releaseLocal(frame.handle)
        return
      }
      this.reply(frame.id, { kind: 'return', value: step.value as WireValue })
    } catch (error) {
      this.reply(frame.id, { kind: 'throw', error: toErrorDto(error, this.limits) })
      await this.releaseLocal(frame.handle)
    } finally {
      target.busy = false
      this.active.end(frame.id)
    }
  }

  private lookupOwned(
    handle: string,
    kind: 'iterator' | 'events',
  ):
    { state: 'released' } | { state: 'live'; record: { target: unknown; id: string } } | undefined {
    if (!this.table.owns(handle)) {
      this.fail({
        code: 'unknown-handle',
        message: `${kind} handle ${handle} is not owned by this side`,
      })
      return undefined
    }
    const lookup = this.table.lookup(handle)
    if (lookup.state === 'unknown' || lookup.state === 'foreign-generation') {
      this.fail({
        code: lookup.state === 'unknown' ? 'unknown-handle' : 'stale-generation',
        message: `${kind} handle ${handle} is ${lookup.state}`,
      })
      return undefined
    }
    if (lookup.state === 'released') return { state: 'released' }
    if (lookup.record.kind !== kind) {
      this.fail({
        code: 'wrong-handle-kind',
        message: `handle ${handle} is a ${lookup.record.kind}, expected ${kind}`,
      })
      return undefined
    }
    return { state: 'live', record: lookup.record }
  }

  private async handleSubscribe(frame: FrameOf<'subscribe'>): Promise<void> {
    const lookup = this.lookupOwned(frame.handle, 'events')
    if (lookup === undefined) return
    if (lookup.state === 'released') {
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(
          new ModkitError({
            code: 'x3.host/rpc-released-handle',
            message: `events ${frame.handle} was released`,
          }),
          this.limits,
        ),
      })
      return
    }
    const target = lookup.record.target as EventsTarget
    if (target.subscription !== undefined) {
      this.reply(frame.id, {
        kind: 'throw',
        error: toErrorDto(
          new ModkitError({
            code: 'x3.host/rpc-already-subscribed',
            message: `events ${frame.handle} already has a subscriber`,
          }),
          this.limits,
        ),
      })
      return
    }
    this.pumpSequence += 1
    const subscription = `${this.ownerPrefix}s${this.generation}-${this.pumpSequence}`
    target.subscription = subscription
    const pump: PumpState = { handle: frame.handle, stopped: false }
    this.pumps.set(subscription, pump)
    this.reply(frame.id, { kind: 'return', value: subscription })
    void (async () => {
      try {
        pump.iterator = target.iterable[Symbol.asyncIterator]()
        for (;;) {
          const step = await pump.iterator.next()
          if (pump.stopped || this.state !== 'open') return
          if (step.done === true) break
          const checked = validateWireValue(step.value, this.limits, 'forbid')
          if (!checked.ok) {
            throw new ModkitError({
              code: 'x3.host/rpc-bad-return',
              message: `event rejected: ${checked.violation.message}`,
            })
          }
          this.send({ t: 'event', subscription, value: step.value as WireValue })
        }
        if (this.state === 'open') this.send({ t: 'done', handle: frame.handle })
      } catch (error) {
        if (!pump.stopped && this.state === 'open') {
          this.trySend({ t: 'done', handle: frame.handle, error: toErrorDto(error, this.limits) })
        }
      } finally {
        this.pumps.delete(subscription)
        await this.releaseLocal(frame.handle)
      }
    })()
  }

  private handleEvent(frame: FrameOf<'event'>): void {
    const result = this.subscriptions.push(frame.subscription, frame.value)
    if (result === 'queued') return
    if (result === 'unknown') {
      this.droppedEvents += 1
      return
    }
    // overflow: this consumer is too slow; end the stream for it deterministically
    this.trySend({ t: 'unsubscribe', subscription: frame.subscription })
    this.closeSubscription(
      frame.subscription,
      new ModkitError({
        code: 'x3.host/rpc-events-overflow',
        message: `event queue for ${frame.subscription} exceeded ${this.limits.maxQueuedEvents}`,
        retryability: 'conditional',
      }),
    )
  }

  private handleDone(frame: FrameOf<'done'>): void {
    if (frame.inReplyTo !== undefined) {
      const entry = this.pending.peek(frame.inReplyTo)
      if (entry !== undefined && entry.kind !== 'next' && !entry.cancelled) {
        this.fail({ code: 'unexpected-frame', message: 'done received for a non-iterator call' })
        return
      }
      this.handleSettle(frame.inReplyTo, { kind: 'done' })
      this.markRemoteReleased(frame.handle)
      return
    }
    // unsolicited: an event stream ended (normally or with an error)
    const error = frame.error === undefined ? undefined : fromErrorDto(frame.error)
    for (const [id, record] of this.subscriptions.entries()) {
      if (record.handle === frame.handle) this.closeSubscription(id, error)
    }
    this.markRemoteReleased(frame.handle)
  }

  /**
   * Copies the data properties a surface declares (`fields`) off a capability object; each must
   * be a bounded wire value without handles. Absent properties are skipped; an invalid one is a
   * bad return on the executing side (thrown as `x3.host/rpc-bad-return`).
   */
  private fieldData(
    target: unknown,
    surface: { readonly contract: string; readonly major: number },
  ): Readonly<Record<string, WireValue>> | undefined {
    const fields = this.surfaces.surfaceFor(surface.contract, surface.major)?.fields
    if (fields === undefined || fields.length === 0) return undefined
    if (typeof target !== 'object' || target === null) return undefined
    const data: Record<string, WireValue> = {}
    for (const field of fields) {
      const value = (target as Record<string, unknown>)[field]
      if (value === undefined) continue
      const checked = validateWireValue(value, this.limits, 'forbid')
      if (!checked.ok) {
        throw new ModkitError({
          code: 'x3.host/rpc-bad-return',
          message: `field «${field}» of ${surface.contract}@${surface.major} is not a wire value: ${checked.violation.message}`,
        })
      }
      data[field] = value as WireValue
    }
    return Object.keys(data).length === 0 ? undefined : Object.freeze(data)
  }

  private async handleRelease(frame: FrameOf<'release'>): Promise<void> {
    if (!this.table.owns(frame.handle)) {
      this.fail({
        code: 'unknown-handle',
        message: `release of handle ${frame.handle} this side does not own`,
      })
      return
    }
    const lookup = this.table.lookup(frame.handle)
    if (lookup.state === 'unknown' || lookup.state === 'foreign-generation') {
      this.fail({
        code: lookup.state === 'unknown' ? 'unknown-handle' : 'stale-generation',
        message: `release of ${lookup.state} handle ${frame.handle}`,
      })
      return
    }
    const result = await this.table.release(frame.handle)
    for (const failure of result.failures) {
      this.report(
        'x3.host/rpc-release-failed',
        `release of ${frame.handle} failed: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
    }
    this.reply(frame.id, { kind: 'return', value: { released: result.released } })
  }
}

type Envelope = Pick<Frame, 'domain' | 'version' | 'session' | 'generation' | 'id'>
/** Distributive omit: keeps every frame variant's own fields. */
type FrameBody = Frame extends infer F ? (F extends Frame ? Omit<F, keyof Envelope> : never) : never

export function createEndpoint(options: EndpointOptions): Endpoint {
  return new EndpointImpl(options)
}
