/**
 * The subject RPC (S9; R6 generalised): one root capability `x3.app/subject-services@1` with two
 * methods — `open(path)` → an inert snapshot, `attach(sessionId)` → the live session under
 * `x3.abi/asset-session@1` — served over capability-RPC (`x3.host/rpc`) on any port-shaped
 * transport: Electron's `MessageChannelMain`, a DOM `MessagePort`, Node `worker_threads` ports,
 * or anything the `framePortFromMessagePort` adapter accepts. Everything below the root comes from
 * the surface authority: the session is the standard ABI surface, `dataSource(contract, major)`
 * resolves its leased surface from the arguments, iterables are real pull streams. Neither side
 * holds a method list — a data-source contract added to the standard table crosses this boundary
 * with zero application changes.
 *
 * Electron's main/renderer pair was the first consumer (R6); the server (S9) exposes the same
 * root over a port it hands to an embedding process or realm. The opener is host policy: it maps
 * a requested path to an opened subject (or refuses), and nothing here touches a file.
 */

import type { Diagnostic } from '@modkit/core'
import type {
  AssetEditPlan,
  AssetRevision,
  AssetSession,
  ChangeSet,
  CommitReceipt,
  NamespaceEntry,
  NamespaceEntrySource,
  NamespacePageRequest,
  OperationSession,
  Page,
  PresentationPlan,
  RasterResourcePort,
  RasterResourceRequest,
  RasterResourceResult,
  SourceConflict,
  SubjectEditTarget,
  ValidationResult,
  ViewerSubjectNavigation,
  ViewerSubjectNavigationResult,
} from '@modkit/sdk'
import {
  parseSubjectRef,
  serializeSubjectRef,
  subjectRefEquals,
  type SubjectRef,
} from '@modkit/sdk/subjects'
import type { SubjectEditing } from './subject-editing.js'
import { createScopedViewerSubjectNavigation } from './subject-navigation.js'
import { ABI_ASSET_SESSION } from './execution/abi-surfaces.js'
import { createEndpoint, type Endpoint, type FramePort } from './execution/endpoint.js'
import {
  framePortFromMessagePort,
  type MessagePortFrameOptions,
  type MessagePortLike,
} from './execution/message-port.js'
import { protocolLimits, type ProtocolLimits } from './execution/protocol.js'
import { createStandardSurfaceRegistry } from './execution/surface-adapter.js'
import type { CapabilitySurface } from './execution/surface.js'

// ---------------------------------------------------------------------------------------------
// the one app-level surface

export const SUBJECT_SERVICES = Object.freeze({ contract: 'x3.app/subject-services', major: 1 })
/** The editing arm of an opened subject; leased from `edit(sessionId)` when the host allows it. */
export const SUBJECT_EDITING = Object.freeze({ contract: 'x3.app/subject-editing', major: 1 })
/** Loader-validated module identity of the services root (there is nothing to import). */
export const SUBJECT_SERVICES_URL = 'x3-app://subject-services'

const subjectServicesSurface: CapabilitySurface = {
  ...SUBJECT_SERVICES,
  methods: {
    /** `open(path)` → an inert snapshot (opened carries a `sessionId` to attach). */
    open: { kind: 'value', signal: 'last' },
    /** `attach(sessionId)` → the live session under `x3.abi/asset-session@1`. */
    attach: { kind: 'lease', result: ABI_ASSET_SESSION, wrapper: 'bare' },
    /** `navigate(sessionId, target)` resolves a target from that exact live parent session. */
    navigate: { kind: 'value', signal: 'last', arity: 2 },
    /** `edit(sessionId)` → the editing arm, when this host can write this subject. */
    edit: { kind: 'lease', result: SUBJECT_EDITING, wrapper: 'bare' },
    /** Decode one bounded image through the attached subject's confined resource origin. */
    readRaster: { kind: 'value', signal: 'last', arity: 2 },
  },
}

/**
 * The editing arm crosses as data and ids, never as authority: the grant snapshot, the prepared
 * commit and the backends stay on the serving side. A consumer proposes a change, receives a plan,
 * prepares it (getting an id back) and commits that id. Nothing it holds can be replayed into a
 * write it was not granted, because it never holds the grant.
 */
const subjectEditingSurface: CapabilitySurface = {
  ...SUBJECT_EDITING,
  releaseVia: 'dispose',
  methods: {
    state: { kind: 'value' },
    propose: { kind: 'value', signal: 'last', arity: 1 },
    plan: { kind: 'value', signal: 'last', arity: 1 },
    prepare: { kind: 'value', signal: 'last', arity: 1 },
    commit: { kind: 'value', signal: 'last', arity: 1 },
    undo: { kind: 'value', signal: 'last', arity: 1 },
    redo: { kind: 'value', signal: 'last', arity: 1 },
    discardHistory: { kind: 'value', arity: 1 },
    dispose: { kind: 'value' },
  },
}

/** One registry: the services surface names the session ABI surface as a result; closure checked. */
export function subjectRpcSurfaces() {
  return createStandardSurfaceRegistry({
    surfaces: [subjectServicesSurface, subjectEditingSurface],
  })
}

const SUBJECT_RPC_LIMITS: ProtocolLimits = protocolLimits({ defaultCallDeadlineMs: 60_000 })

/** The frame port either side runs on: the one it was handed, or one adapted from a port shape. */
function resolveFramePort(options: {
  readonly port?: MessagePortLike
  readonly framePort?: FramePort
  readonly listener?: MessagePortFrameOptions['listener']
}): FramePort {
  if (options.framePort !== undefined) return options.framePort
  if (options.port === undefined) {
    throw new TypeError('subject RPC needs either a port or a framePort')
  }
  return framePortFromMessagePort(
    options.port,
    options.listener === undefined ? {} : { listener: options.listener },
  )
}

// ---------------------------------------------------------------------------------------------
// wire snapshots (inert data; the session itself is a capability, never part of the snapshot)

/**
 * A diagnostic as it travels in a snapshot.
 *
 * `severity` is carried because a host has to be able to act on it. This shape used to be code and
 * message only, and the narrowing had a cost that only showed up in a real editor: VS Code's
 * Problems panel wants a severity, and a host fed from this snapshot could do nothing better than
 * guess one from the code string — so an informational `x3.host/companion-unavailable` and a
 * genuine error would have arrived looking identical.
 *
 * It stays optional so every existing producer of a snapshot remains valid; a consumer that has no
 * severity to show simply ignores it.
 */
export interface SnapshotDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity?: 'error' | 'warning' | 'information' | 'hint'
}

export interface SubjectOpenedSnapshot {
  readonly state: 'opened'
  readonly sessionId: string
  readonly descriptor: Record<string, unknown>
  /** A host that resolves presentation ships the immutable plan; fallback-only hosts omit it. */
  readonly presentation?: PresentationPlan
  readonly selected: {
    /** Additive owner identity; older producers and consumers may omit or ignore it. */
    readonly extensionId?: string
    readonly contributionId: string
    readonly variantId: string
    readonly confidence: number
  }
  /**
   * Product-observed codec route, never a source locator.
   *
   * A direct subject has one step. A container-aware host may prepend the actual parent selection
   * before returning a nested subject. Optional keeps the wire compatible with older producers.
   */
  readonly selectedRoute?: readonly {
    readonly formatId: string
    readonly extensionId: string
    readonly contributionId: string
  }[]
  readonly candidates: readonly unknown[]
  readonly diagnostics: readonly SnapshotDiagnostic[]
}

export interface SubjectUnresolvedSnapshot {
  readonly state: 'unresolved'
  readonly reason: string
  readonly candidates: readonly unknown[]
  readonly diagnostics: readonly SnapshotDiagnostic[]
}

const NAMESPACE_ENTRY_SOURCE = 'common.view/namespace-entry-source'

/**
 * What an application lists of a container: entries marked `hidden` only when it asks
 * (`includeHidden`) — the one filter, so no viewer keeps its own. Exact lookups and opens still
 * reach a hidden entry (a model names its texture in `versions.*`). Subject RPC applies it to every
 * session it serves; an application that opens subjects in its own realm (the web app) applies it
 * to the container listings it shows. Codecs and host readers never get it: they need everything.
 */
export function withoutHiddenEntries(namespace: NamespaceEntrySource): NamespaceEntrySource {
  const visible = async (
    answer: Promise<Page<NamespaceEntry>>,
    page: NamespacePageRequest,
  ): Promise<Page<NamespaceEntry>> => {
    const listed = await answer
    return page.includeHidden === true || !listed.items.some(item => item.hidden === true)
      ? listed
      : { ...listed, items: listed.items.filter(item => item.hidden !== true) }
  }
  const children = namespace.children?.bind(namespace)
  const search = namespace.search?.bind(namespace)
  const passed = (key: 'readPreamble' | 'lookup' | 'nestedContext' | 'openEntrySource') => {
    const method = namespace[key] as ((...args: never[]) => unknown) | undefined
    return method === undefined ? {} : { [key]: method.bind(namespace) }
  }
  return {
    list: (prefix, page, signal) => visible(namespace.list(prefix, page, signal), page),
    ...(children === undefined
      ? {}
      : { children: (path, page, signal) => visible(children(path, page, signal), page) }),
    ...(search === undefined
      ? {}
      : { search: (query, page, signal) => visible(search(query, page, signal), page) }),
    ...passed('readPreamble'),
    ...passed('lookup'),
    ...passed('nestedContext'),
    ...passed('openEntrySource'),
    openEntry: (entryId, signal) => namespace.openEntry(entryId, signal),
  } as NamespaceEntrySource
}

export type SubjectOpenSnapshot = SubjectOpenedSnapshot | SubjectUnresolvedSnapshot

/**
 * The one mapping from an open result to the snapshot that travels over the RPC.
 *
 * There are two ways a subject is reached now — a path on disk, and an entry inside an open
 * container — and both have to arrive at the page looking identical, because the page has no idea
 * which one it asked for. Writing the mapping twice would be an invitation to drift: the day a
 * field is added to `SubjectOpenedSnapshot`, one of the two callers gets it and the other silently
 * does not, and the symptom is a nested subject that renders with something missing.
 *
 * `diagnostics` is passed in rather than read off the result because the result is not the whole
 * story: companion findings are produced by the resolver *around* the open, so the caller holds
 * findings the open itself never saw.
 */
/** The fields of an unresolved open this mapping reads; declared structurally, not imported. */
export interface UnresolvedOpenLike {
  readonly state: 'unresolved'
  readonly reason: string
  readonly candidates: readonly unknown[]
}

/** The fields of a resolved open this mapping reads. */
export interface OpenedSubjectLike {
  readonly state: 'opened'
  readonly descriptor: unknown
  readonly selected: {
    /** Present on `OpenedSubject`; optional here for backwards-compatible structural callers. */
    readonly extensionId?: string
    readonly contributionId: string
    readonly variantId: string
    readonly confidence: number
  }
  readonly candidates: readonly unknown[]
}

export interface SubjectOpenSnapshotOptions<Result> {
  readonly result: Result
  /** Minted only for an open that resolved, so an unresolved answer consumes no id. */
  readonly sessionId: () => string
  readonly diagnostics: readonly SnapshotDiagnostic[]
}

export function subjectOpenSnapshot(
  options: SubjectOpenSnapshotOptions<OpenedSubjectLike>,
): SubjectOpenedSnapshot
export function subjectOpenSnapshot(
  options: SubjectOpenSnapshotOptions<UnresolvedOpenLike>,
): SubjectUnresolvedSnapshot
export function subjectOpenSnapshot(
  options: SubjectOpenSnapshotOptions<OpenedSubjectLike | UnresolvedOpenLike>,
): SubjectOpenSnapshot
export function subjectOpenSnapshot(
  options: SubjectOpenSnapshotOptions<OpenedSubjectLike | UnresolvedOpenLike>,
): SubjectOpenSnapshot {
  const { result, diagnostics } = options
  if (result.state === 'unresolved') {
    return {
      state: 'unresolved',
      reason: result.reason,
      candidates: result.candidates,
      diagnostics,
    }
  }
  const descriptor = result.descriptor as Record<string, unknown>
  const identity = descriptor['identity']
  const formatId =
    typeof identity === 'object' &&
    identity !== null &&
    typeof (identity as Record<string, unknown>)['formatId'] === 'string'
      ? ((identity as Record<string, unknown>)['formatId'] as string)
      : undefined
  const extensionId = result.selected.extensionId
  const selectedRoute =
    extensionId === undefined ||
    extensionId.length === 0 ||
    formatId === undefined ||
    formatId.length === 0
      ? undefined
      : [
          {
            formatId,
            extensionId,
            contributionId: result.selected.contributionId,
          },
        ]
  return {
    state: 'opened',
    sessionId: options.sessionId(),
    descriptor,
    selected: {
      ...(extensionId === undefined ? {} : { extensionId }),
      contributionId: result.selected.contributionId,
      variantId: result.selected.variantId,
      confidence: result.selected.confidence,
    },
    ...(selectedRoute === undefined ? {} : { selectedRoute }),
    candidates: result.candidates,
    diagnostics,
  }
}

/** What the editing arm reports about the subject it can write. */
export interface SubjectEditingState {
  readonly revision: AssetRevision
  readonly targets: readonly SubjectEditTarget[]
  /** UI hint from the host-owned scope. Other targets are dependency revision guards.
   * This list conveys no authority; prepare/commit still validate the server-side grant. */
  readonly writableTargetIds: readonly string[]
}

/** `prepare` answers with an id, never with the prepared commit itself. */
export type SubjectEditingPrepareResult =
  | { readonly state: 'ready'; readonly preparedId: string }
  | { readonly state: 'conflict'; readonly conflicts: readonly SourceConflict[] }
  | {
      readonly state: 'rejected'
      readonly reason: string
      readonly diagnostics: readonly Diagnostic[]
    }

export type SubjectEditingCommitResult =
  | { readonly state: 'committed'; readonly receipt: CommitReceipt }
  | { readonly state: 'rolled-back'; readonly receipt: CommitReceipt }
  | { readonly state: 'partially-applied'; readonly receipt: CommitReceipt }
  | {
      readonly state: 'not-applied'
      readonly reason: string
      readonly diagnostics: readonly Diagnostic[]
    }

/** Serving-side opener: host policy from a requested path to a snapshot (+ the live session). */
export type SubjectOpener = (
  path: string,
  signal?: AbortSignal,
) => Promise<{
  readonly snapshot: SubjectOpenSnapshot
  readonly session?: AssetSession
  readonly rasterResources?: RasterResourcePort
}>

export interface SubjectNavigationOpenRequest {
  readonly sourceSessionId: string
  readonly parent: AssetSession
  readonly current: SubjectRef
  readonly target: SubjectRef
}

/** Serving-side policy for reference classes the composition can authoritatively invert. */
export type SubjectNavigator = (
  request: SubjectNavigationOpenRequest,
  signal?: AbortSignal,
) => Promise<
  | {
      readonly snapshot: SubjectOpenSnapshot
      readonly session?: AssetSession
      readonly rasterResources?: RasterResourcePort
    }
  | undefined
>

export type SubjectNavigationSnapshot =
  | { readonly state: 'opened'; readonly snapshot: SubjectOpenedSnapshot }
  | {
      readonly state: 'rejected'
      readonly reason: Extract<
        ViewerSubjectNavigationResult,
        { readonly state: 'rejected' }
      >['reason']
    }

// ---------------------------------------------------------------------------------------------
// serving side (worker role: it serves capabilities)

export interface ExposeSubjectRpcOptions {
  /** `MessagePortMain`, a DOM `MessagePort`, a Node port, or anything port-shaped. */
  readonly port?: MessagePortLike
  /**
   * A `FramePort` this host already built, used instead of adapting `port`.
   *
   * The port-shaped default fits structured-clone transports. A text channel — a VS Code webview,
   * a socket — is a `FramePort` from the start (`framePortFromJsonPort`), and without this it has
   * to be re-shaped back into something port-like only for this function to adapt it again. Pass
   * one or the other; `framePort` wins when both are given.
   */
  readonly framePort?: FramePort
  /** `'emitter-event'` for `MessagePortMain`; default follows the port's shape. */
  readonly listener?: MessagePortFrameOptions['listener']
  /** Endpoint identity; the consumer must connect with the same pair. */
  readonly session: string
  readonly generation?: number
  readonly open: SubjectOpener
  /** Exact inverse/open policy; absence leaves relation links fail-closed. */
  readonly navigate?: SubjectNavigator
  /**
   * Host policy: the editing wiring for an opened session, or `undefined` when this host cannot
   * write this subject (no backend, no writer, no `write-source` in the grant). The consumer sees
   * `edit()` refuse, which is the honest answer — not a save button that fails at the end.
   */
  readonly editing?: (sessionId: string) => SubjectEditing | undefined
  /**
   * Host policy for a lossy (or non-round-tripping) write: ask the person in the host's own UI and
   * answer with a token the editing coordinator's `confirmationMatches` accepts, or `undefined`
   * when they decline. Absent, such a plan is refused as `confirmation-required`. The consumer
   * never supplies a token itself — a page that could would be confirming on the person's behalf.
   */
  readonly confirm?: (plan: AssetEditPlan, signal?: AbortSignal) => Promise<string | undefined>
  /** Module identity the loader accepts (defaults to the generic root URL). */
  readonly moduleUrl?: string
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export interface SubjectRpcExposure {
  readonly endpoint: Endpoint
  /** Graceful close: pending (never attached) sessions are disposed, attached ones cascade. */
  close(reason: string): Promise<void>
}

export function exposeSubjectRpc(options: ExposeSubjectRpcOptions): SubjectRpcExposure {
  const moduleUrl = options.moduleUrl ?? SUBJECT_SERVICES_URL
  /** Opened sessions the consumer has not attached yet, keyed by the snapshot's sessionId. */
  interface ServedSubject {
    readonly session: AssetSession
    readonly rasterResources?: RasterResourcePort
  }
  const pending = new Map<string, ServedSubject>()
  /** Attached sessions remain addressable only until their exact RPC lease is released. */
  const live = new Map<string, ServedSubject>()
  /** Plans returned by codec operations, before their previews cross the RPC boundary. */
  const operationPlans = new Map<string, Map<string, AssetEditPlan>>()
  // ponytail: the newest pending plans only; a client that took a plan just for its bytes (an editor
  // backup, Save As) never prepares it — a call to drop such a plan would free it at once
  const maximumPendingOperationPlans = 8
  const maximumLiveSessions = 1_024

  const canonicalSubject = (value: unknown): SubjectRef | undefined => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) return undefined
    try {
      const parsed = parseSubjectRef(value)
      return serializeSubjectRef(parsed) === value ? parsed : undefined
    } catch {
      return undefined
    }
  }

  const registerPending = async (
    snapshot: SubjectOpenedSnapshot,
    session: AssetSession,
    rasterResources?: RasterResourcePort,
  ): Promise<boolean> => {
    if (pending.has(snapshot.sessionId) || live.has(snapshot.sessionId)) {
      await session.dispose()
      return false
    }
    pending.set(snapshot.sessionId, {
      session,
      ...(rasterResources === undefined ? {} : { rasterResources }),
    })
    return true
  }
  const services = {
    open: async (path: unknown, signal?: AbortSignal): Promise<SubjectOpenSnapshot> => {
      if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
        throw new TypeError('open(path) expects a non-empty path string')
      }
      const result = await options.open(path, signal)
      if (result.snapshot.state === 'opened') {
        if (result.session === undefined) {
          throw new TypeError('an opened snapshot must carry its session')
        }
        if (!(await registerPending(result.snapshot, result.session, result.rasterResources))) {
          throw new TypeError('subject session id collides with an existing session')
        }
      }
      return result.snapshot
    },
    attach: async (sessionId: unknown) => {
      const subject = typeof sessionId === 'string' ? pending.get(sessionId) : undefined
      if (subject === undefined) {
        throw new TypeError('subject session is unavailable (already attached or never opened)')
      }
      if (live.size >= maximumLiveSessions) {
        throw new TypeError('subject live-session registry is full')
      }
      pending.delete(sessionId as string)
      live.set(sessionId as string, subject)
      // the handle owns the session from here: releaseVia dispose (or cascade) releases the lease
      let disposed = false
      const dispose = async () => {
        if (disposed) return
        disposed = true
        operationPlans.delete(sessionId as string)
        if (live.get(sessionId as string) === subject) live.delete(sessionId as string)
        await subject.session.dispose()
      }
      const session = subject.session
      const served: AssetSession = {
        revision: session.revision,
        state: () => session.state(),
        descriptor: () => session.descriptor(),
        dataSource: async (contract, major) => {
          const lease = await session.dataSource(contract, major)
          return String(contract) === NAMESPACE_ENTRY_SOURCE
            ? ({
                value: withoutHiddenEntries(lease.value as NamespaceEntrySource),
                release: () => lease.release(),
              } as typeof lease)
            : lease
        },
        events: signal => session.events(signal),
        dispose,
        operations: () => {
          const operations = session.operations()
          return {
            dispose: () => operations.dispose(),
            invoke: async (handlerId, input, invokeOptions) => {
              const result = await operations.invoke(handlerId, input, invokeOptions)
              if (!disposed && result.state === 'ok' && result.output.kind === 'edit-plan') {
                const editing = options.editing?.(sessionId as string)
                if (editing !== undefined) {
                  const plan = editing.planFromOperation(result.output)
                  if (typeof plan.planId !== 'string' || plan.planId.length === 0) {
                    throw new TypeError('the operation returned an edit plan without an identity')
                  }
                  const plans =
                    operationPlans.get(sessionId as string) ?? new Map<string, AssetEditPlan>()
                  // A codec names a plan by what it does, so the same edit asked twice while the
                  // first is still pending (a backup, then the save) is told apart, not refused.
                  let planId = plan.planId
                  for (let copy = 2; plans.has(planId); copy += 1) planId = `${plan.planId}#${copy}`
                  plans.set(planId, structuredClone({ ...plan, planId }))
                  if (plans.size > maximumPendingOperationPlans)
                    plans.delete(plans.keys().next().value!)
                  operationPlans.set(sessionId as string, plans)
                  if (planId !== plan.planId)
                    return {
                      ...result,
                      output: { ...result.output, plan: { ...result.output.plan, planId } },
                    }
                }
              }
              return result
            },
          }
        },
      }
      return {
        value: served,
        release: dispose,
      }
    },
    navigate: async (
      sourceSessionId: unknown,
      targetValue: unknown,
      signal?: AbortSignal,
    ): Promise<SubjectNavigationSnapshot> => {
      if (typeof sourceSessionId !== 'string' || sourceSessionId.length === 0) {
        return { state: 'rejected', reason: 'session-unavailable' }
      }
      const parent = live.get(sourceSessionId)
      if (parent === undefined) return { state: 'rejected', reason: 'session-unavailable' }
      const target = canonicalSubject(targetValue)
      if (target === undefined) return { state: 'rejected', reason: 'invalid-subject' }
      const descriptor = await parent.session.descriptor()
      const current = canonicalSubject(descriptor.subjectUri)
      if (current === undefined) return { state: 'rejected', reason: 'session-unavailable' }
      if (current.workspace !== target.workspace) {
        return { state: 'rejected', reason: 'workspace-mismatch' }
      }
      const opened = await options.navigate?.(
        {
          sourceSessionId,
          parent: parent.session,
          current,
          target,
        },
        signal,
      )
      if (opened?.snapshot.state !== 'opened' || opened.session === undefined) {
        await opened?.session?.dispose()
        return { state: 'rejected', reason: 'target-unavailable' }
      }
      const openedSubject = canonicalSubject(opened.snapshot.descriptor['subjectUri'])
      if (openedSubject === undefined || !subjectRefEquals(openedSubject, target)) {
        await opened.session.dispose()
        throw new TypeError(
          `subject navigation policy opened a different target (${String(
            opened.snapshot.descriptor['subjectUri'],
          )} != ${serializeSubjectRef(target)})`,
        )
      }
      if (!(await registerPending(opened.snapshot, opened.session, opened.rasterResources))) {
        return { state: 'rejected', reason: 'collision' }
      }
      return { state: 'opened', snapshot: opened.snapshot }
    },
    readRaster: async (
      sessionId: unknown,
      request: unknown,
      signal?: AbortSignal,
    ): Promise<RasterResourceResult> => {
      const raster =
        typeof sessionId === 'string' ? live.get(sessionId)?.rasterResources : undefined
      if (raster === undefined) {
        throw new TypeError('this subject has no raster resource origin')
      }
      return raster.read(request as RasterResourceRequest, signal)
    },
    edit: async (sessionId: unknown) => {
      const editing = typeof sessionId === 'string' ? options.editing?.(sessionId) : undefined
      if (editing === undefined) {
        throw new TypeError('this subject is not editable in this host')
      }
      // ids, not authority: the grant snapshot and the prepared commit never leave this side
      const issuedPlans = new Map<string, AssetEditPlan>()
      const prepared = new Map<string, Parameters<typeof editing.coordinator.commit>[0]>()
      const historyIds = new Set<string>()
      let sequence = 0
      const arm = {
        state: (): SubjectEditingState => ({
          revision: editing.revision,
          targets: editing.targets,
          writableTargetIds: editing.targets
            .filter(
              target =>
                editing.grantSnapshot.permissions.includes('write-source') &&
                editing.grantSnapshot.sourceIds.includes(target.ownerSource.id),
            )
            .map(target => target.targetId),
        }),
        propose: async (change: unknown, signal?: AbortSignal): Promise<ValidationResult> => {
          if (editing.session === undefined) {
            throw new TypeError('this subject has no writer, so a change cannot be validated')
          }
          void signal
          return editing.session.propose(change as ChangeSet)
        },
        plan: async (change: unknown, signal?: AbortSignal): Promise<AssetEditPlan> => {
          if (editing.session === undefined) {
            throw new TypeError('this subject has no writer, so a change cannot be planned')
          }
          void signal
          const plan = await editing.session.plan(change as ChangeSet)
          if (typeof plan.planId !== 'string' || plan.planId.length === 0) {
            throw new TypeError('the writer returned an edit plan without an identity')
          }
          if (issuedPlans.has(plan.planId)) {
            throw new TypeError('the writer returned a duplicate edit plan identity')
          }
          // Keep a distinct structured value even for in-process/test transports that may return
          // value results without an intervening platform structured-clone boundary.
          issuedPlans.set(plan.planId, structuredClone(plan))
          return plan
        },
        prepare: async (
          plan: unknown,
          signal?: AbortSignal,
        ): Promise<SubjectEditingPrepareResult> => {
          // Preserve the named subject/revision refusal for malformed cross-subject previews.
          // This validation grants no authority: its bytes are never sent to the coordinator.
          const clientPreview = editing.planFromOperation({
            kind: 'edit-plan',
            plan: plan as AssetEditPlan,
          })
          const operationIssued = operationPlans.get(sessionId as string)
          if (issuedPlans.has(clientPreview.planId) && operationIssued?.has(clientPreview.planId)) {
            throw new TypeError('ambiguous edit plan identity')
          }
          const issued =
            issuedPlans.get(clientPreview.planId) ?? operationIssued?.get(clientPreview.planId)
          if (issued === undefined) {
            throw new TypeError(
              'unknown edit plan (already prepared, or never issued by this subject)',
            )
          }
          issuedPlans.delete(clientPreview.planId)
          operationIssued?.delete(clientPreview.planId)
          /*
           * The client copy is a preview. Only its id comes back as a selector; all executable
           * bytes and metadata come from the exact writer or operation result retained here. The
           * subject/revision validation therefore runs over that host-owned plan as well.
           */
          const validated = editing.planFromOperation({
            kind: 'edit-plan',
            plan: issued,
          })
          const lossy =
            validated.fidelity.roundTrip === 'lossy' || validated.fidelity.roundTrip === 'none'
          const confirmationToken = lossy ? await options.confirm?.(validated, signal) : undefined
          const result = await editing.coordinator.prepare(validated, {
            grant: editing.grantSnapshot,
            ...(confirmationToken === undefined ? {} : { confirmationToken }),
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'ready') {
            sequence += 1
            const preparedId = `prepared-${sequence}`
            prepared.set(preparedId, result.prepared)
            return { state: 'ready', preparedId }
          }
          if (result.state === 'conflict') return { state: 'conflict', conflicts: result.conflicts }
          return { state: 'rejected', reason: result.reason, diagnostics: result.diagnostics }
        },
        commit: async (
          preparedId: unknown,
          signal?: AbortSignal,
        ): Promise<SubjectEditingCommitResult> => {
          const found = typeof preparedId === 'string' ? prepared.get(preparedId) : undefined
          if (found === undefined) {
            throw new TypeError('unknown prepared commit (already committed, or never prepared)')
          }
          prepared.delete(preparedId as string)
          const result = await editing.coordinator.commit(found, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'not-applied') {
            return { state: 'not-applied', reason: result.reason, diagnostics: result.diagnostics }
          }
          historyIds.add(result.receipt.transactionId)
          return { state: result.state, receipt: result.receipt }
        },
        undo: async (
          transactionId: unknown,
          signal?: AbortSignal,
        ): Promise<SubjectEditingCommitResult> => {
          if (typeof transactionId !== 'string' || !historyIds.has(transactionId)) {
            throw new TypeError('unknown editing transaction')
          }
          const result = await editing.coordinator.undo(transactionId, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'not-applied') {
            return { state: 'not-applied', reason: result.reason, diagnostics: result.diagnostics }
          }
          return { state: result.state, receipt: result.receipt }
        },
        redo: async (
          transactionId: unknown,
          signal?: AbortSignal,
        ): Promise<SubjectEditingCommitResult> => {
          if (typeof transactionId !== 'string' || !historyIds.has(transactionId)) {
            throw new TypeError('unknown editing transaction')
          }
          const result = await editing.coordinator.redo(transactionId, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'not-applied') {
            return { state: 'not-applied', reason: result.reason, diagnostics: result.diagnostics }
          }
          return { state: result.state, receipt: result.receipt }
        },
        discardHistory: async (transactionId: unknown): Promise<boolean> => {
          if (typeof transactionId !== 'string' || !historyIds.has(transactionId)) return false
          const discarded = await editing.coordinator.discardHistory(transactionId)
          if (discarded) historyIds.delete(transactionId)
          return discarded
        },
        dispose: async (): Promise<void> => {
          issuedPlans.clear()
          prepared.clear()
          historyIds.clear()
          await editing.session?.dispose()
        },
      }
      let released = false
      return {
        value: arm,
        release: async () => {
          if (released) return
          released = true
          await arm.dispose()
        },
      }
    },
  }
  const endpoint = createEndpoint({
    role: 'worker',
    port: resolveFramePort(options),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    loader: async request => {
      if (request.moduleUrl !== moduleUrl) {
        throw new TypeError('the subject-services endpoint serves exactly one module')
      }
      return { module: services, surface: SUBJECT_SERVICES, release: () => undefined }
    },
    ...(options.onDiagnostic === undefined
      ? {}
      : {
          onDiagnostic: (diagnostic: { code: string; message: string }) =>
            options.onDiagnostic?.(diagnostic),
        }),
    onFailure: failure => {
      options.onDiagnostic?.({
        code: 'x3.app/subject-rpc-failed',
        message: `${failure.code}: ${failure.message}`,
      })
    },
  })
  let closed = false
  return {
    endpoint,
    async close(reason: string): Promise<void> {
      if (closed) return
      closed = true
      await endpoint.close(reason)
      const orphans = [...pending.values()]
      pending.clear()
      const attached = [...live.values()]
      live.clear()
      operationPlans.clear()
      await Promise.allSettled([...orphans, ...attached].map(subject => subject.session.dispose()))
    },
  }
}

// ---------------------------------------------------------------------------------------------
// consuming side (host role: it consumes capabilities)

/** The shape a preview/tool needs; `dataSource` leases come straight from the proxy. */
export interface SubjectPreviewSession {
  readonly presentation?: PresentationPlan
  descriptor(): Promise<Record<string, unknown>>
  dataSource(contract: string, major: number): Promise<{ value: unknown }>
  /**
   * The subject's operation session, leased across the wire like any other ABI lease.
   *
   * A consumer that can only read data sources can draw a viewer and nothing else: an operation
   * toolbar, a transport bar and a container's entry extraction all need to *invoke*. The ABI
   * surface has always declared this method and the wire has always carried it — only the client
   * facade omitted it, which is why the Electron app had to fork this whole function to add one
   * line. What crosses is still gated on the serving side: main opens with the classes it means to
   * grant, so a mutating operation is refused there, not here.
   */
  operations(): Promise<OperationSession>
  /** Decode a logical model texture without granting the consumer path or codec authority. */
  readRasterResource?(
    request: RasterResourceRequest,
    signal?: AbortSignal,
  ): Promise<RasterResourceResult>
  /** Minted from this exact attached RPC session when the app owns an open-target handler. */
  readonly subjectNavigation?: ViewerSubjectNavigation
  dispose(): Promise<void>
}

export type SubjectClientOpenResult =
  | {
      readonly state: 'opened'
      readonly snapshot: SubjectOpenedSnapshot
      readonly session: SubjectPreviewSession
    }
  | { readonly state: 'unresolved'; readonly snapshot: SubjectUnresolvedSnapshot }

/** The editing arm as a consumer sees it: data in, ids back, no authority anywhere. */
export interface SubjectEditingArm {
  state(): Promise<SubjectEditingState>
  propose(change: ChangeSet): Promise<ValidationResult>
  plan(change: ChangeSet): Promise<AssetEditPlan>
  prepare(plan: AssetEditPlan): Promise<SubjectEditingPrepareResult>
  commit(preparedId: string): Promise<SubjectEditingCommitResult>
  undo(transactionId: string): Promise<SubjectEditingCommitResult>
  redo(transactionId: string): Promise<SubjectEditingCommitResult>
  discardHistory(transactionId: string): Promise<boolean>
  dispose(): Promise<void>
}

export interface SubjectRpcClient {
  open(path: string): Promise<SubjectClientOpenResult>
  /**
   * The editing arm of an opened session. Rejects when the serving side cannot write this subject
   * — which is the honest answer, and the reason a consumer can hide a save button rather than
   * offer one that fails at the end.
   */
  edit(sessionId: string): Promise<SubjectEditingArm>
  close(reason: string): Promise<void>
}

export interface ConnectSubjectRpcOptions {
  /** The port the serving side handed over (or anything port-shaped in tests). */
  readonly port?: MessagePortLike
  /**
   * A `FramePort` this host already built, used instead of adapting `port`.
   *
   * The port-shaped default fits structured-clone transports. A text channel — a VS Code webview,
   * a socket — is a `FramePort` from the start (`framePortFromJsonPort`), and without this it has
   * to be re-shaped back into something port-like only for this function to adapt it again. Pass
   * one or the other; `framePort` wins when both are given.
   */
  readonly framePort?: FramePort
  /** Default `'event-target'` (a DOM `MessagePort`). */
  readonly listener?: MessagePortFrameOptions['listener']
  readonly session: string
  readonly generation?: number
  /** Must match the serving side's module identity (defaults to the generic root URL). */
  readonly moduleUrl?: string
  /** Identity recorded for the loaded root (defaults name the generic services composition). */
  readonly contributionId?: string
  /** App-local tab/history owner for a target already opened and attached by the RPC client. */
  readonly onNavigate?: (event: {
    readonly sourceSessionId: string
    readonly target: string
    readonly result: Extract<SubjectClientOpenResult, { readonly state: 'opened' }>
  }) => Promise<void> | void
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

interface ServicesProxy {
  open(path: string): Promise<SubjectOpenSnapshot>
  attach(sessionId: string): Promise<Record<string, unknown>>
  navigate(
    sourceSessionId: string,
    target: string,
    signal?: AbortSignal,
  ): Promise<SubjectNavigationSnapshot>
  edit(sessionId: string): Promise<SubjectEditingArm>
  readRaster(
    sessionId: string,
    request: RasterResourceRequest,
    signal?: AbortSignal,
  ): Promise<RasterResourceResult>
}

export async function connectSubjectRpc(
  options: ConnectSubjectRpcOptions,
): Promise<SubjectRpcClient> {
  const endpoint = createEndpoint({
    role: 'host',
    port: resolveFramePort(options),
    session: options.session,
    generation: options.generation ?? 1,
    surfaces: subjectRpcSurfaces(),
    limits: SUBJECT_RPC_LIMITS,
    ...(options.onDiagnostic === undefined
      ? {}
      : {
          onDiagnostic: (diagnostic: { code: string; message: string }) =>
            options.onDiagnostic?.(diagnostic),
        }),
    onFailure: failure => {
      options.onDiagnostic?.({
        code: 'x3.app/subject-rpc-failed',
        message: `${failure.code}: ${failure.message}`,
      })
    },
  })
  const loaded = await endpoint.load({
    moduleUrl: options.moduleUrl ?? SUBJECT_SERVICES_URL,
    contributionId: options.contributionId ?? 'modkit.app/subject-services',
    variantId: 'main',
    artifactDigest: 'sha256:app-composition',
  })
  const services = endpoint.materialize(loaded.root) as unknown as ServicesProxy
  const attachOpened = async (
    snapshot: SubjectOpenedSnapshot,
  ): Promise<SubjectClientOpenResult> => {
    const proxy = (await services.attach(snapshot.sessionId)) as {
      operations(): Promise<OperationSession>
      descriptor(): Promise<Record<string, unknown>>
      dataSource(contract: string, major: number): Promise<{ value: unknown }>
      dispose(): Promise<void>
    }
    let navigation: ReturnType<typeof createScopedViewerSubjectNavigation> | undefined
    const subject = snapshot.descriptor['subjectUri']
    if (options.onNavigate !== undefined && typeof subject === 'string') {
      let parsed: SubjectRef | undefined
      try {
        const candidate = parseSubjectRef(subject)
        if (serializeSubjectRef(candidate) === subject) parsed = candidate
      } catch {
        parsed = undefined
      }
      if (parsed !== undefined) {
        const workspace = parsed.workspace
        navigation = createScopedViewerSubjectNavigation({
          scope: {
            sessionId: snapshot.sessionId,
            subject,
            ...(workspace === undefined ? {} : { workspace }),
          },
          async open(target, signal) {
            const targetValue = serializeSubjectRef(target)
            const navigationSnapshot = await services.navigate(
              snapshot.sessionId,
              targetValue,
              signal,
            )
            if (navigationSnapshot.state === 'rejected') return navigationSnapshot
            const child = (await attachOpened(navigationSnapshot.snapshot)) as Extract<
              SubjectClientOpenResult,
              { readonly state: 'opened' }
            >
            try {
              await options.onNavigate?.({
                sourceSessionId: snapshot.sessionId,
                target: targetValue,
                result: child,
              })
              return { state: 'opened' }
            } catch (error) {
              await child.session.dispose().catch(() => undefined)
              throw error
            }
          },
        })
      }
    }
    let disposed = false
    const session: SubjectPreviewSession = {
      ...(snapshot.presentation === undefined ? {} : { presentation: snapshot.presentation }),
      ...(navigation === undefined ? {} : { subjectNavigation: navigation.port }),
      descriptor: async () => snapshot.descriptor,
      dataSource: (contract, major) => proxy.dataSource(contract, major),
      operations: () => proxy.operations(),
      readRasterResource: (request, signal) =>
        services.readRaster(snapshot.sessionId, request, signal),
      async dispose() {
        if (disposed) return
        disposed = true
        navigation?.dispose()
        await proxy.dispose()
      },
    }
    return { state: 'opened', snapshot, session }
  }
  return {
    async open(path: string): Promise<SubjectClientOpenResult> {
      const snapshot = await services.open(path)
      if (snapshot.state !== 'opened') return { state: 'unresolved', snapshot }
      return attachOpened(snapshot)
    },
    edit: (sessionId: string) => services.edit(sessionId),
    close: (reason: string) => endpoint.close(reason),
  }
}
