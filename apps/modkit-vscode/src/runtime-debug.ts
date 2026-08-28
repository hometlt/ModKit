/**
 * Game-neutral play/debug control for the VS Code product.
 *
 * Runtime selection remains in the host: this adapter supplies a `runtimeId` and required v2
 * offers to `openRuntimeSession`, then holds the returned lease for as long as the editor session
 * is visible. It never imports a provider or guesses a game from a file name.
 *
 * The frozen v2 contract is deliberately left alone. "Pause" means that this controller is not
 * issuing another bounded step; continue-to-breakpoint is a sequence of one-tick `step` calls with
 * ordered event inspection between them. That makes pause and breakpoints editor policy rather
 * than a second simulation API.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type { PermissionGrant, ResourceBudget } from '@modkitx-x3/sdk'
import {
  RUNTIME_SESSION_V2_MEMBERS,
  type RuntimeBudget,
  type RuntimeEvent,
  type RuntimeSession,
  type RuntimeSessionOffer,
  type RuntimeSessionStatus,
  type RuntimeSessionV2,
  type RuntimeSnapshot,
  type RuntimeStateIdentity,
} from '@modkitx-x3/sdk/runtime'
import {
  openRuntimeSession,
  type OpenRuntimeSessionRequest,
  type RuntimeHostServices,
  type RuntimeProviderInvocationContext,
  type RuntimeSessionResolution,
} from '@modkitx-x3/host/runtime'

const ALL_OFFERS: readonly RuntimeSessionOffer[] = Object.freeze([
  'step',
  'events',
  'snapshot',
  'restore',
  'state-hash',
])
const OFFER_SET = new Set<RuntimeSessionOffer>(ALL_OFFERS)
const MAX_EVENT_BATCH = 10_000
const MAX_CONTINUE_TICKS = 10_000
const MAX_SNAPSHOTS_PER_SESSION = 16
const ACTIONS = new Set([
  'start',
  'status',
  'step',
  'events',
  'snapshot',
  'restore',
  'stateHash',
  'inspect',
  'continue',
  'pause',
  'stop',
])

export interface RuntimeBreakpoint {
  /** Stop after reaching this tick. */
  readonly tick?: number
  /** Stop after observing an event of this exact namespaced kind. */
  readonly eventKind?: string
  /** Stop after observing this event sequence or a later one. */
  readonly sequence?: number
}

export interface RuntimeDebugStartRequest {
  readonly action: 'start'
  readonly runtimeId: string
  readonly sessionId: string
  readonly requiredOffers?: readonly RuntimeSessionOffer[]
  readonly budget?: RuntimeBudget
  /** Neutral host-owned inputs for providers which require a workspace snapshot. */
  readonly providerInvocation?: RuntimeProviderInvocationContext
  readonly signal?: AbortSignal
}

export type RuntimeDebugCommandRequest =
  | RuntimeDebugStartRequest
  | Readonly<{ action: 'status'; sessionId: string }>
  | Readonly<{ action: 'step'; sessionId: string; ticks: number; signal?: AbortSignal }>
  | Readonly<{
      action: 'events'
      sessionId: string
      afterSequence?: number
      maxEvents?: number
    }>
  | Readonly<{ action: 'snapshot'; sessionId: string; snapshotId: string; signal?: AbortSignal }>
  | Readonly<{ action: 'restore'; sessionId: string; snapshotId: string; signal?: AbortSignal }>
  | Readonly<{ action: 'stateHash'; sessionId: string; signal?: AbortSignal }>
  | Readonly<{
      action: 'inspect'
      sessionId: string
      afterSequence?: number
      maxEvents?: number
    }>
  | Readonly<{
      action: 'continue'
      sessionId: string
      maxTicks: number
      breakpoints?: readonly RuntimeBreakpoint[]
      signal?: AbortSignal
    }>
  | Readonly<{ action: 'pause'; sessionId: string }>
  | Readonly<{ action: 'stop'; sessionId: string }>

export interface RuntimeDebugOk {
  readonly state: 'ok'
  readonly action: string
  readonly sessionId: string
  readonly value: unknown
}

export interface RuntimeDebugUnavailable {
  readonly state: 'unavailable'
  readonly action: string
  readonly sessionId: string
  readonly code: string
  readonly message: string
  readonly diagnostics: readonly Diagnostic[]
}

export type RuntimeDebugCommandResult = RuntimeDebugOk | RuntimeDebugUnavailable

export interface RuntimeDebugControllerOptions {
  readonly services: RuntimeHostServices
  readonly grant: PermissionGrant
  readonly activationBudget: ResourceBudget
  readonly sessionBudget: RuntimeBudget
  /** Injectable only so the adapter's failure paths can be tested without an extension catalog. */
  readonly openSession?: (request: OpenRuntimeSessionRequest) => Promise<RuntimeSessionResolution>
}

export interface RuntimeDebugController {
  readonly sessionIds: readonly string[]
  snapshotIds(sessionId: string): readonly string[]
  dispatch(request: RuntimeDebugCommandRequest): Promise<RuntimeDebugCommandResult>
  dispose(): Promise<void>
}

interface DebugSession {
  readonly runtimeId: string
  readonly providerId: string
  readonly session: RuntimeSessionV2
  readonly release: () => Promise<void>
  readonly snapshots: Map<string, RuntimeSnapshot>
  paused: boolean
  continueController?: AbortController
  lastEventSequence: number
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function boundedInteger(value: unknown, maximum: number, allowZero = true): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= maximum
  )
}

function runtimeV2(session: RuntimeSession): RuntimeSessionV2 | undefined {
  const candidate = session as Partial<RuntimeSessionV2>
  if (!Array.isArray(candidate.offers)) return undefined
  for (const member of RUNTIME_SESSION_V2_MEMBERS) {
    if (member === 'offers') continue
    if (typeof candidate[member] !== 'function') return undefined
  }
  return session as RuntimeSessionV2
}

function requiredOffers(
  value: readonly RuntimeSessionOffer[] | undefined,
): readonly RuntimeSessionOffer[] | undefined {
  const offers = value ?? ALL_OFFERS
  if (new Set(offers).size !== offers.length || offers.some(offer => !OFFER_SET.has(offer))) {
    return undefined
  }
  return Object.freeze([...offers])
}

function unavailable(
  action: string,
  sessionId: string,
  code: string,
  message: string,
  diagnostics: readonly Diagnostic[] = [],
): RuntimeDebugUnavailable {
  return Object.freeze({
    state: 'unavailable',
    action,
    sessionId,
    code,
    message,
    diagnostics: Object.freeze([...diagnostics]),
  })
}

function ok(action: string, sessionId: string, value: unknown): RuntimeDebugOk {
  return Object.freeze({ state: 'ok', action, sessionId, value })
}

function operationFailure(
  request: RuntimeDebugCommandRequest,
  error: unknown,
): RuntimeDebugUnavailable {
  return unavailable(
    request.action,
    request.sessionId,
    'x3.vscode/runtime-operation-failed',
    error instanceof Error ? error.message : String(error),
  )
}

function supports(session: RuntimeSessionV2, offer: RuntimeSessionOffer): boolean {
  return session.offers.includes(offer)
}

function offerUnavailable(
  action: string,
  sessionId: string,
  offer: RuntimeSessionOffer,
): RuntimeDebugUnavailable {
  return unavailable(
    action,
    sessionId,
    'x3.vscode/runtime-offer-unavailable',
    `runtime session ${sessionId} does not offer ${offer}`,
  )
}

function validBreakpoint(value: RuntimeBreakpoint): boolean {
  const fields = [value.tick, value.sequence, value.eventKind].filter(item => item !== undefined)
  return (
    fields.length > 0 &&
    (value.tick === undefined || boundedInteger(value.tick, Number.MAX_SAFE_INTEGER)) &&
    (value.sequence === undefined || boundedInteger(value.sequence, Number.MAX_SAFE_INTEGER)) &&
    (value.eventKind === undefined || nonEmptyString(value.eventKind))
  )
}

function breakpointHit(
  breakpoint: RuntimeBreakpoint,
  status: RuntimeSessionStatus,
  events: readonly RuntimeEvent[],
): boolean {
  if (breakpoint.tick !== undefined && status.ticks >= breakpoint.tick) return true
  return events.some(
    event =>
      (breakpoint.eventKind !== undefined && event.kind === breakpoint.eventKind) ||
      (breakpoint.sequence !== undefined && event.sequence >= breakpoint.sequence),
  )
}

async function collectEvents(
  session: RuntimeSessionV2,
  afterSequence: number,
  maximum: number,
): Promise<readonly RuntimeEvent[]> {
  const events: RuntimeEvent[] = []
  for await (const event of session.events(afterSequence)) {
    events.push(event)
    if (events.length >= maximum) break
  }
  return Object.freeze(events)
}

function completion(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

/** Compose one window-owned runtime controller over the ordinary host service plane. */
export function createRuntimeDebugController(
  options: RuntimeDebugControllerOptions,
): RuntimeDebugController {
  const sessions = new Map<string, DebugSession>()
  /** Session ids reserved before provider resolution crosses its first async boundary. */
  const opening = new Map<string, Promise<void>>()
  /** Session ids and the single release currently closing them. */
  const closing = new Map<string, Promise<void>>()
  const open = options.openSession ?? openRuntimeSession
  let disposed = false
  let disposal: Promise<void> | undefined

  const find = (
    request: Exclude<RuntimeDebugCommandRequest, RuntimeDebugStartRequest>,
  ): DebugSession | RuntimeDebugUnavailable =>
    sessions.get(request.sessionId) ??
    unavailable(
      request.action,
      request.sessionId,
      'x3.vscode/runtime-session-unavailable',
      `runtime session ${request.sessionId} is not open in this window`,
    )

  const inspect = async (
    record: DebugSession,
    request: Extract<RuntimeDebugCommandRequest, { action: 'inspect' }>,
  ): Promise<RuntimeDebugCommandResult> => {
    const afterSequence = request.afterSequence ?? record.lastEventSequence
    const maximum = request.maxEvents ?? 256
    if (
      !boundedInteger(afterSequence, Number.MAX_SAFE_INTEGER) ||
      !boundedInteger(maximum, MAX_EVENT_BATCH, false)
    ) {
      return unavailable(
        request.action,
        request.sessionId,
        'x3.vscode/runtime-inspection-invalid',
        'inspection event bounds must be non-negative safe integers within the adapter limit',
      )
    }
    const status = await record.session.status()
    const identity: RuntimeStateIdentity = await record.session.identity()
    const events = supports(record.session, 'events')
      ? await collectEvents(record.session, afterSequence, maximum)
      : Object.freeze([])
    const hash = supports(record.session, 'state-hash')
      ? await record.session.stateHash()
      : undefined
    if (events.length > 0) record.lastEventSequence = events.at(-1)?.sequence ?? afterSequence
    return ok(request.action, request.sessionId, {
      runtimeId: record.runtimeId,
      providerId: record.providerId,
      paused: record.paused,
      offers: record.session.offers,
      status,
      identity,
      events,
      ...(hash === undefined ? {} : { stateHash: hash }),
    })
  }

  const dispatch = async (
    request: RuntimeDebugCommandRequest,
  ): Promise<RuntimeDebugCommandResult> => {
    const raw = request as Readonly<{ action?: unknown; sessionId?: unknown }>
    if (typeof raw.action !== 'string' || !ACTIONS.has(raw.action)) {
      return unavailable(
        typeof raw.action === 'string' ? raw.action : 'invalid',
        typeof raw.sessionId === 'string' ? raw.sessionId : '',
        'x3.vscode/runtime-action-invalid',
        'runtime action is not part of the generic VS Code control surface',
      )
    }
    if (disposed) {
      return unavailable(
        raw.action,
        typeof raw.sessionId === 'string' ? raw.sessionId : '',
        'x3.vscode/runtime-controller-disposed',
        'the VS Code runtime controller is disposed',
      )
    }
    if (!nonEmptyString(request.sessionId)) {
      return unavailable(
        request.action,
        request.sessionId,
        'x3.vscode/runtime-session-id-invalid',
        'runtime session id must be a non-empty string',
      )
    }

    if (request.action === 'start') {
      if (!nonEmptyString(request.runtimeId)) {
        return unavailable(
          request.action,
          request.sessionId,
          'x3.vscode/runtime-id-invalid',
          'runtime id must be a non-empty string',
        )
      }
      if (sessions.has(request.sessionId) || opening.has(request.sessionId)) {
        return unavailable(
          request.action,
          request.sessionId,
          'x3.vscode/runtime-session-exists',
          `runtime session ${request.sessionId} is already open`,
        )
      }
      const wanted = requiredOffers(request.requiredOffers)
      if (wanted === undefined) {
        return unavailable(
          request.action,
          request.sessionId,
          'x3.vscode/runtime-offers-invalid',
          'required runtime offers must be unique frozen-v2 offer names',
        )
      }
      const opened = completion()
      opening.set(request.sessionId, opened.promise)
      try {
        const resolution = await open({
          services: options.services,
          runtimeId: request.runtimeId,
          sessionId: request.sessionId,
          budget: request.budget ?? options.sessionBudget,
          grant: options.grant,
          activationBudget: options.activationBudget,
          ...(request.providerInvocation === undefined
            ? {}
            : { providerInvocation: request.providerInvocation }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        })
        if (resolution.state === 'unresolved') {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-provider-unavailable',
            resolution.diagnostics.at(-1)?.message ??
              `no provider resolved for runtime ${request.runtimeId}`,
            resolution.diagnostics,
          )
        }
        if (disposed) {
          await resolution.release()
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-controller-disposed',
            'the VS Code runtime controller was disposed while the provider was resolving',
            resolution.diagnostics,
          )
        }
        const v2 = runtimeV2(resolution.session)
        const missing =
          v2 === undefined ? wanted : wanted.filter(offer => !v2.offers.includes(offer))
        if (v2 === undefined || missing.length > 0) {
          await resolution.release()
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-capability-unavailable',
            `runtime ${request.runtimeId} lacks required play/debug offers: ${missing.join(', ') || 'session-v2'}`,
            resolution.diagnostics,
          )
        }
        let initialStatus: RuntimeSessionStatus
        try {
          initialStatus = await v2.status()
        } catch (error) {
          try {
            await resolution.release()
          } catch (releaseError) {
            return unavailable(
              request.action,
              request.sessionId,
              'x3.vscode/runtime-start-release-failed',
              `runtime status failed (${error instanceof Error ? error.message : String(error)}) and its lease could not be released (${releaseError instanceof Error ? releaseError.message : String(releaseError)})`,
              resolution.diagnostics,
            )
          }
          return operationFailure(request, error)
        }
        if (disposed) {
          await resolution.release()
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-controller-disposed',
            'the VS Code runtime controller was disposed while the session was starting',
            resolution.diagnostics,
          )
        }
        sessions.set(request.sessionId, {
          runtimeId: request.runtimeId,
          providerId: resolution.providerId,
          session: v2,
          release: resolution.release,
          snapshots: new Map(),
          paused: true,
          lastEventSequence: 0,
        })
        return ok(request.action, request.sessionId, {
          runtimeId: request.runtimeId,
          providerId: resolution.providerId,
          offers: v2.offers,
          status: initialStatus,
          diagnostics: resolution.diagnostics,
        })
      } catch (error) {
        return operationFailure(request, error)
      } finally {
        opening.delete(request.sessionId)
        opened.resolve()
      }
    }

    const found = find(request)
    if ('state' in found) return found
    const record = found

    if (closing.has(request.sessionId)) {
      return unavailable(
        request.action,
        request.sessionId,
        'x3.vscode/runtime-session-closing',
        `runtime session ${request.sessionId} is already closing`,
      )
    }

    if (
      record.continueController !== undefined &&
      !['pause', 'status', 'events', 'inspect'].includes(request.action)
    ) {
      return unavailable(
        request.action,
        request.sessionId,
        'x3.vscode/runtime-session-running',
        `runtime session ${request.sessionId} must be paused before ${request.action}`,
      )
    }

    try {
      if (request.action === 'status') {
        return ok(request.action, request.sessionId, await record.session.status())
      }
      if (request.action === 'step') {
        if (!supports(record.session, 'step'))
          return offerUnavailable(request.action, request.sessionId, 'step')
        if (!boundedInteger(request.ticks, MAX_CONTINUE_TICKS)) {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-step-invalid',
            `ticks must be between 0 and ${MAX_CONTINUE_TICKS}`,
          )
        }
        record.paused = true
        return ok(
          request.action,
          request.sessionId,
          await record.session.step(request.ticks, request.signal),
        )
      }
      if (request.action === 'events') {
        if (!supports(record.session, 'events'))
          return offerUnavailable(request.action, request.sessionId, 'events')
        const afterSequence = request.afterSequence ?? 0
        const maximum = request.maxEvents ?? 256
        if (
          !boundedInteger(afterSequence, Number.MAX_SAFE_INTEGER) ||
          !boundedInteger(maximum, MAX_EVENT_BATCH, false)
        ) {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-events-invalid',
            'event bounds must be non-negative safe integers within the adapter limit',
          )
        }
        const events = await collectEvents(record.session, afterSequence, maximum)
        if (events.length > 0) record.lastEventSequence = events.at(-1)?.sequence ?? afterSequence
        return ok(request.action, request.sessionId, events)
      }
      if (request.action === 'snapshot') {
        if (!supports(record.session, 'snapshot'))
          return offerUnavailable(request.action, request.sessionId, 'snapshot')
        if (!nonEmptyString(request.snapshotId)) {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-snapshot-id-invalid',
            'snapshot id must be a non-empty string',
          )
        }
        const captured = await record.session.snapshot(request.signal)
        if (captured.outcome === 'refused') return ok(request.action, request.sessionId, captured)
        if (
          !record.snapshots.has(request.snapshotId) &&
          record.snapshots.size >= MAX_SNAPSHOTS_PER_SESSION
        ) {
          const oldest = record.snapshots.keys().next().value as string | undefined
          if (oldest !== undefined) record.snapshots.delete(oldest)
        }
        record.snapshots.set(request.snapshotId, captured.snapshot)
        return ok(request.action, request.sessionId, {
          outcome: captured.outcome,
          snapshotId: request.snapshotId,
          identity: captured.snapshot.identity,
          byteLength: captured.snapshot.bytes.byteLength,
        })
      }
      if (request.action === 'restore') {
        if (!supports(record.session, 'restore'))
          return offerUnavailable(request.action, request.sessionId, 'restore')
        const snapshot = record.snapshots.get(request.snapshotId)
        if (snapshot === undefined) {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-snapshot-unavailable',
            `snapshot ${request.snapshotId} is not held for runtime session ${request.sessionId}`,
          )
        }
        record.paused = true
        const restored = await record.session.restore(snapshot, request.signal)
        if (restored.outcome === 'restored') record.lastEventSequence = 0
        return ok(request.action, request.sessionId, restored)
      }
      if (request.action === 'stateHash') {
        if (!supports(record.session, 'state-hash'))
          return offerUnavailable(request.action, request.sessionId, 'state-hash')
        return ok(request.action, request.sessionId, await record.session.stateHash(request.signal))
      }
      if (request.action === 'inspect') return inspect(record, request)
      if (request.action === 'pause') {
        record.paused = true
        record.continueController?.abort('paused by VS Code')
        return ok(request.action, request.sessionId, await record.session.status())
      }
      if (request.action === 'continue') {
        if (!supports(record.session, 'step'))
          return offerUnavailable(request.action, request.sessionId, 'step')
        if (!supports(record.session, 'events'))
          return offerUnavailable(request.action, request.sessionId, 'events')
        if (!boundedInteger(request.maxTicks, MAX_CONTINUE_TICKS)) {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-continue-invalid',
            `maxTicks must be between 0 and ${MAX_CONTINUE_TICKS}`,
          )
        }
        const breakpoints = request.breakpoints ?? []
        if (!breakpoints.every(validBreakpoint)) {
          return unavailable(
            request.action,
            request.sessionId,
            'x3.vscode/runtime-breakpoint-invalid',
            'each breakpoint must name a non-negative tick, sequence, or non-empty event kind',
          )
        }
        const controller = new AbortController()
        const onAbort = (): void => controller.abort(request.signal?.reason)
        request.signal?.addEventListener('abort', onAbort, { once: true })
        record.continueController?.abort('superseded by another continue')
        record.continueController = controller
        record.paused = false
        let advanced = 0
        let hit: RuntimeBreakpoint | undefined
        const observed: RuntimeEvent[] = []
        let eventLimitReached = false
        try {
          while (advanced < request.maxTicks && !controller.signal.aborted) {
            const stepped = await record.session.step(1, controller.signal)
            if (stepped.outcome === 'refused') {
              return ok(request.action, request.sessionId, {
                outcome: stepped,
                advanced,
                paused: true,
                events: Object.freeze(observed),
              })
            }
            advanced += 1
            const eventCapacity = MAX_EVENT_BATCH - observed.length
            if (eventCapacity === 0) {
              eventLimitReached = true
              break
            }
            const events = await collectEvents(
              record.session,
              record.lastEventSequence,
              eventCapacity,
            )
            if (events.length > 0) {
              record.lastEventSequence = events.at(-1)?.sequence ?? record.lastEventSequence
              observed.push(...events)
            }
            hit = breakpoints.find(item => breakpointHit(item, stepped.status, events))
            if (hit !== undefined) break
          }
          return ok(request.action, request.sessionId, {
            outcome: controller.signal.aborted
              ? 'paused'
              : eventLimitReached
                ? 'event-limit'
                : hit === undefined
                  ? 'limit'
                  : 'breakpoint',
            advanced,
            paused: true,
            ...(hit === undefined ? {} : { breakpoint: hit }),
            status: await record.session.status(),
            events: Object.freeze(observed),
          })
        } finally {
          request.signal?.removeEventListener('abort', onAbort)
          if (record.continueController === controller) delete record.continueController
          record.paused = true
        }
      }
      record.continueController?.abort('runtime session stopped')
      const release = Promise.resolve().then(record.release)
      closing.set(request.sessionId, release)
      try {
        await release
        sessions.delete(request.sessionId)
      } finally {
        closing.delete(request.sessionId)
      }
      return ok(request.action, request.sessionId, { outcome: 'stopped' })
    } catch (error) {
      return operationFailure(request, error)
    }
  }

  return Object.freeze({
    get sessionIds(): readonly string[] {
      return Object.freeze([...sessions.keys()])
    },
    snapshotIds(sessionId: string): readonly string[] {
      return Object.freeze([...(sessions.get(sessionId)?.snapshots.keys() ?? [])])
    },
    dispatch,
    async dispose(): Promise<void> {
      if (disposal !== undefined) return disposal
      disposed = true
      disposal = (async () => {
        /*
         * Starts own the lease until their completion marker resolves. A start which returns after
         * `disposed` was set releases its candidate instead of publishing it into `sessions`.
         */
        await Promise.allSettled([...opening.values()])
        /* A pending stop already owns release; wait for it instead of calling release twice. */
        await Promise.allSettled([...closing.values()])
        const live = [...sessions.entries()]
        for (const [, record] of live) {
          record.continueController?.abort('VS Code window disposed')
        }
        await Promise.allSettled(live.map(([, record]) => record.release()))
        for (const [sessionId] of live) sessions.delete(sessionId)
      })()
      return disposal
    },
  })
}
