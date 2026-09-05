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
    readonly signal?: AbortSignal
  }): Promise<ViewerMount>
}
