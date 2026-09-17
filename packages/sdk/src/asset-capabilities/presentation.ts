/** Presentation contracts only. Resolution and validation implementations land in A-6. */

import { isSegment } from '@modkit/core'
import type {
  DataSourceMajor,
  DataSourceOf,
  KnownDataSourceId,
  Lease,
  OpaqueDataSourceRef,
} from './data-sources.js'
import type { AnyDescriptor, RevisionId } from './types.js'
import type { OperationSession } from '../runtime-abi.js'
import type { CommitCoordinator, EditAuthorizationPort } from '../editing.js'
import type { KnowledgeCatalog } from '../knowledge/index.js'
import { snapshotJsonWireData } from '../manifest/validate.js'

declare const BINDING_ID_BRAND: unique symbol
declare const PRESENTATION_SLOT_ID_BRAND: unique symbol

export type BindingId = string & { readonly [BINDING_ID_BRAND]: true }
export type PresentationSlotId = string & { readonly [PRESENTATION_SLOT_ID_BRAND]: true }

export function bindingId<const Value extends string>(value: Value): BindingId & Value {
  if (!isSegment(value)) throw new TypeError(`invalid binding id: ${value}`)
  return value as BindingId & Value
}

export function presentationSlotId<const Value extends string>(
  value: Value,
): PresentationSlotId & Value {
  if (!isSegment(value)) throw new TypeError(`invalid presentation slot id: ${value}`)
  return value as PresentationSlotId & Value
}

type DataSourceMajorOfUnion<Contract extends KnownDataSourceId> = Contract extends KnownDataSourceId
  ? DataSourceMajor<Contract>
  : never

export type KnownBindingRef<
  Contract extends KnownDataSourceId = KnownDataSourceId,
  Major extends number = DataSourceMajorOfUnion<Contract>,
> = Contract extends KnownDataSourceId
  ? Major extends DataSourceMajor<Contract>
    ? {
        readonly bindingId: BindingId
        readonly contract: Contract
        readonly major: Major
      }
    : never
  : never

export interface OpaqueBindingRef {
  readonly bindingId: BindingId
  readonly dataSource: OpaqueDataSourceRef
}

export type BindingRef = KnownBindingRef | OpaqueBindingRef
export type PresentationKind =
  'stage' | 'tree' | 'panel' | 'toolbar' | 'transport' | 'status' | 'fallback'

export interface PresentationSlot {
  readonly slotId: PresentationSlotId
  readonly kind: PresentationKind
  readonly contributionId: string
  readonly extensionId: string
  readonly priority: number
  /** Host-global singleton selection key; at most one stage per group enters a session plan. */
  readonly singletonGroup?: string
  readonly bindings: readonly BindingRef[]
}

export type StageSlotId<Slots extends readonly PresentationSlot[] = readonly PresentationSlot[]> = [
  Extract<Slots[number], { readonly kind: 'stage' }>,
] extends [never]
  ? PresentationSlotId
  : Extract<Slots[number], { readonly kind: 'stage' }>['slotId']

export type FallbackSlot = PresentationSlot & { readonly kind: 'fallback' }

interface PresentationPlanBase<
  Slots extends readonly PresentationSlot[] = readonly PresentationSlot[],
> {
  readonly subjectUri: string
  readonly revision: RevisionId
  readonly slots: Slots
  readonly unsatisfied: readonly {
    readonly contributionId: string
    readonly missing: readonly string[]
  }[]
}

export type PresentationPlan<
  Slots extends readonly PresentationSlot[] = readonly PresentationSlot[],
> = PresentationPlanBase<Slots> &
  (
    | {
        readonly activeStage: StageSlotId<Slots>
        readonly alternateStages: readonly StageSlotId<Slots>[]
        readonly fallback?: FallbackSlot
      }
    | {
        readonly activeStage?: never
        readonly alternateStages: readonly []
        readonly fallback: FallbackSlot
      }
  )

/** Authoring helper; full offer/ticket validation remains host-owned in A-6. */
export function definePresentationPlan<const Slots extends readonly PresentationSlot[]>(
  plan: PresentationPlan<Slots> & { readonly slots: Slots },
): Readonly<PresentationPlan<Slots>> {
  const stageIds = new Set(
    plan.slots.filter(slot => slot.kind === 'stage').map(slot => slot.slotId as string),
  )
  if (plan.activeStage === undefined) {
    if (
      plan.fallback === undefined ||
      plan.fallback.kind !== 'fallback' ||
      plan.alternateStages.length !== 0
    ) {
      throw new TypeError('a fallback-only presentation plan cannot declare stage alternates')
    }
    return snapshotJsonWireData(plan) as Readonly<PresentationPlan<Slots>>
  }
  if (!stageIds.has(plan.activeStage)) {
    throw new TypeError(`active presentation stage is not declared: ${plan.activeStage}`)
  }
  for (const slotId of plan.alternateStages) {
    if (!stageIds.has(slotId)) {
      throw new TypeError(`alternate presentation stage is not declared: ${slotId}`)
    }
  }
  return snapshotJsonWireData(plan) as Readonly<PresentationPlan<Slots>>
}

/** Host-only selection. `Ticket` remains opaque to the viewer and is bound by A-2. */
export type ResolvedBinding<Ticket = unknown> = BindingRef & {
  readonly offerId: string
  readonly providerId: string
  readonly variantId: string
  readonly ticket: Ticket
}

export interface ResolvedPresentationPlan<Ticket = unknown> {
  readonly plan: PresentationPlan
  readonly bindings: readonly ResolvedBinding<Ticket>[]
  readonly planDigest: string
}

export type PresentationPlanIssue =
  | 'duplicate-slot-id'
  | 'missing-active-stage'
  | 'missing-alternate-stage'
  | 'duplicate-binding-id'
  | 'duplicate-singleton-group'
  | 'unresolved-binding'
  | 'unexpected-binding'
  | 'ticket-binding-mismatch'
  | 'invalid-plan-digest'
  | 'invalid-fallback'

export type PresentationPlanValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly PresentationPlanIssue[] }

export interface PresentationPlanValidator<Ticket = unknown> {
  validate(resolved: ResolvedPresentationPlan<Ticket>): PresentationPlanValidation
}

/** Exact selected binding only: no contract-major lookup and no hidden re-resolution. */
export interface ViewerSources {
  get<Contract extends KnownDataSourceId, Major extends DataSourceMajor<Contract>>(
    binding: KnownBindingRef<Contract, Major>,
  ): Promise<Lease<DataSourceOf<Contract, Major>> | undefined>
  getUnknown(binding: OpaqueBindingRef): Promise<Lease<unknown> | undefined>
}

/** Immutable identity of the subject session that minted a navigation port. */
export interface ViewerSubjectNavigationScope {
  readonly sessionId: string
  readonly subject: string
  readonly workspace?: string
}

export interface ViewerSubjectNavigationRequest {
  readonly scope: ViewerSubjectNavigationScope
  readonly target: string
}

export type ViewerSubjectNavigationResult =
  | { readonly state: 'opened' }
  | {
      readonly state: 'rejected'
      readonly reason:
        | 'invalid-subject'
        | 'scope-mismatch'
        | 'workspace-mismatch'
        | 'session-unavailable'
        | 'target-unavailable'
        | 'collision'
        | 'disposed'
        | 'cancelled'
    }

/** Host-owned, per-session route for opening a serialized SubjectRef from a viewer. */
export interface ViewerSubjectNavigation {
  readonly scope: ViewerSubjectNavigationScope
  open(
    request: ViewerSubjectNavigationRequest,
    signal?: AbortSignal,
  ): Promise<ViewerSubjectNavigationResult>
}

export interface ViewerMount {
  update(args: {
    readonly descriptor: AnyDescriptor
    readonly slot: PresentationSlot
  }): Promise<void>
  unmount(): Promise<void>
}

/** One document beside the subject, exactly as the host holds it. */
export interface ViewerWorkspaceDocument {
  readonly uri: string
  readonly languageId: string
  readonly version: number
  readonly text: string
}

export interface ViewerWorkspaceDocumentsRequest {
  /** Restrict to these languages; omitted means the subject's own. */
  readonly languageIds?: readonly string[]
  readonly maxDocuments?: number
  readonly signal?: AbortSignal
}

export interface ViewerWorkspaceDocumentsResult {
  readonly documents: readonly ViewerWorkspaceDocument[]
  /** False when the host's bounds cut the answer; a viewer says so rather than implying totality. */
  readonly isComplete: boolean
}

/**
 * Optional host-owned view of the documents that surround this subject.
 *
 * An operation that resolves across files — a template naming one that lives in another file, a
 * localized string rendered through the mod's style sheet — is invoked on one open document and
 * cannot reach the rest, so it answers "not found" about things that are plainly there. Language
 * features have had a bounded snapshot for exactly this reason; this is the same thing for
 * operations.
 *
 * The host owns the bound and the reading. A viewer asks and passes the answer to the operation it
 * was already going to invoke; it never lists a directory, and a host that has no snapshot to give
 * simply does not pass the port, which the viewer reports instead of pretending.
 */
export interface ViewerWorkspaceDocuments {
  read(request?: ViewerWorkspaceDocumentsRequest): Promise<ViewerWorkspaceDocumentsResult>
}

/**
 * One entry a viewer publishes to its host's status bar (VS Code draws native status bar items,
 * Electron its own footer). `choices` makes the entry a picker: the host shows them and reports the
 * picked id through `ViewerStatusPort.set`'s `onChoose`.
 */
/**
 * One entry in a status item's menu. A choice may carry its own choices — a target format and then
 * its encodings, say — and the host presents that as a second step rather than one flat list.
 */
export interface ViewerStatusChoice {
  readonly id: string
  readonly label: string
  readonly choices?: readonly ViewerStatusChoice[]
}

export interface ViewerStatusItem {
  readonly id: string
  readonly text: string
  readonly tooltip?: string
  /** `start` for identity (dimensions, format, size), `end` for controls (zoom, channel). */
  readonly align?: 'start' | 'end'
  readonly choices?: readonly ViewerStatusChoice[]
  readonly selected?: string
  /**
   * Codicon name drawn before the text (`zoom-in`, `symbol-ruler`, `file`, `symbol-color`), the
   * vocabulary VS Code's own status bar spells as `$(name)` and MK2's texture viewer used.
   */
  readonly icon?: string
  /** No choice list: clicking runs one action, reported as an empty choice id. */
  readonly action?: boolean
}

/** Host-owned status bar. A viewer mounted without it draws nothing there and loses nothing. */
export interface ViewerStatusPort {
  /** Replace this viewer's items. `onChoose(itemId, choiceId)` reports a picked choice. */
  set(
    items: readonly ViewerStatusItem[],
    onChoose?: (itemId: string, choiceId: string) => void,
  ): void
  clear(): void
}

/** One subject beside the opened one that a media viewer's gallery offers. */
export interface ViewerGalleryItem {
  readonly id: string
  readonly label: string
  /** Group heading, e.g. the containing folder. */
  readonly group?: string
  readonly active?: boolean
}

/**
 * Host-owned list of sibling subjects the viewer can switch between without leaving its render
 * area. `thumbnail` answers a small RGBA preview when the host can decode one.
 */
export interface ViewerGalleryPort {
  list(signal?: AbortSignal): Promise<readonly ViewerGalleryItem[]>
  thumbnail?(
    id: string,
    maxEdge: number,
    signal?: AbortSignal,
  ): Promise<
    { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | undefined
  >
  /** Show this sibling in the same editor; the host remounts the viewer for it. */
  open(id: string): Promise<void>
}

export interface ViewerModule {
  readonly abiVersion: 1
  mount(args: {
    readonly container: unknown
    readonly descriptor: AnyDescriptor
    readonly slot: PresentationSlot
    readonly sources: ViewerSources
    readonly operations: OperationSession
    /** Optional host-owned, read-only help catalog; viewers never construct or register one. */
    readonly knowledge?: KnowledgeCatalog
    /** Optional host-owned route scoped to this exact mounted subject session. */
    readonly subjectNavigation?: ViewerSubjectNavigation
    /** Optional bounded snapshot of the documents around this subject, for cross-file operations. */
    readonly workspaceDocuments?: ViewerWorkspaceDocuments
    /**
     * Optional commit route for a viewer that publishes editable values.
     *
     * A tree node or a table cell may carry `editable`, and writing it means invoking the operation
     * the codec named — which answers with an *edit plan*, not a finished write. Without somewhere
     * to send that plan the surface can accept a value, report success and change nothing, which is
     * the worst outcome available. So the route is optional and its absence is meaningful: a viewer
     * mounted without it must refuse to offer editing rather than pretend.
     *
     * The ports are the same ones `EditorModule` receives, because the write is the same write. A
     * host that grants them to a viewer is stating that this surface may spend them.
     */
    readonly commit?: CommitCoordinator
    readonly authorization?: EditAuthorizationPort
    /** Optional host status bar (zoom, channel, dimensions, format, size). */
    readonly status?: ViewerStatusPort
    /** Optional sibling subjects a media viewer shows in its gallery. */
    readonly gallery?: ViewerGalleryPort
    readonly signal?: AbortSignal
  }): Promise<ViewerMount>
}
