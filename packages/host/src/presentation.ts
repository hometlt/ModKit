import {
  ModkitError,
  compareUtf8,
  parseSemver,
  parseVersionRange,
  satisfiesRange,
} from '@modkitx-x3/core'
import {
  definePresentationPlan,
  type AnyDescriptor,
  type BindingRef,
  type Lease,
  type OpaqueBindingRef,
  type PresentationPlan,
  type PresentationPlanIssue,
  type PresentationPlanValidation,
  type PresentationPlanValidator,
  type PresentationSlot,
  type PresentationSlotId,
  type ResolvedBinding,
  type ResolvedPresentationPlan,
  type ViewerSources,
  type ViewerContributionSpecV1,
  type ViewerApplicability,
  isStandardTraitId,
} from '@modkitx-x3/sdk'

export interface ViewerApplicabilityFacts {
  readonly interpretation: 'none' | 'codec'
  readonly sourceBytes?: bigint
  readonly longestLineBytes?: number | 'unknown'
}

/**
 * The result of evaluating *applicability rules* alone — interpretation, size, line length.
 *
 * Deliberately narrower than `ViewerContributionEligibility`: these rules are about the subject's
 * shape, not about what it publishes, so this evaluator has nothing to say about data sources and
 * does not pretend to by carrying an always-empty list.
 */
export interface ViewerApplicabilityResult {
  readonly eligible: boolean
  readonly missing: readonly string[]
}

export interface ViewerContributionEligibility {
  readonly eligible: boolean
  readonly missing: readonly string[]
  /**
   * The stage's *optional* data sources that this descriptor actually publishes.
   *
   * Optional facets never decide eligibility — a stage that named one in `consumesDataSources`
   * would lose every subject that publishes no facets at all, which is the opposite of optional.
   * But something still has to decide which of them to bind, and until block 12 slice 12-3 that
   * decision lived in each application's catalog: web bound them by hand in `views.ts`, Electron
   * gained the same list separately in slice 12-2. Two applications answering one question about
   * one descriptor is exactly the shape this stage exists to remove, so the answer is computed
   * here, once, beside the eligibility it belongs with.
   */
  readonly optionalBound: readonly string[]
}

export function evaluateViewerApplicability(
  rule: ViewerApplicability | undefined,
  facts: ViewerApplicabilityFacts,
): ViewerApplicabilityResult {
  const missing: string[] = []
  if (
    rule?.interpretation !== undefined &&
    rule.interpretation !== 'any' &&
    rule.interpretation !== facts.interpretation
  ) {
    missing.push(`interpretation:${rule.interpretation}`)
  }
  if (rule?.sourceBytes?.maximum !== undefined) {
    const maximum = BigInt(rule.sourceBytes.maximum)
    if (facts.sourceBytes === undefined || facts.sourceBytes > maximum) {
      missing.push(`source-bytes<=${maximum}`)
    }
  }
  if (rule?.longestLineBytes !== undefined) {
    const value = facts.longestLineBytes
    if (
      value === undefined ||
      (value === 'unknown' && rule.longestLineBytes.whenUnknown === 'ineligible') ||
      (value !== 'unknown' && value > rule.longestLineBytes.maximum)
    ) {
      missing.push(`longest-line<=${rule.longestLineBytes.maximum}`)
    }
  }
  return Object.freeze({ eligible: missing.length === 0, missing: Object.freeze(missing) })
}

/** Data-only preflight. Viewer code is not imported or activated by this evaluation. */
export function evaluateViewerContribution(
  spec: ViewerContributionSpecV1,
  descriptor: AnyDescriptor,
  facts: ViewerApplicabilityFacts,
): ViewerContributionEligibility {
  const missing = [...evaluateViewerApplicability(spec.applicability, facts).missing]
  for (const requirement of spec.requiresTraits ?? []) {
    const match = descriptor.traits.some(instance => {
      if (instance.id !== requirement.id) return false
      if (!(requirement.states ?? ['available']).includes(instance.state)) return false
      if (isStandardTraitId(instance.id)) {
        return requirement.definitionRange === undefined && instance.definitionVersion === undefined
      }
      const range =
        requirement.definitionRange === undefined
          ? undefined
          : parseVersionRange(requirement.definitionRange)
      const version =
        instance.definitionVersion === undefined
          ? undefined
          : parseSemver(instance.definitionVersion)
      return range !== undefined && version !== undefined && satisfiesRange(version, range)
    })
    if (!match) missing.push(`trait:${requirement.id}`)
  }
  for (const operation of spec.requiresOperations ?? []) {
    if (!descriptor.operations.some(item => item.id === operation && item.state === 'available')) {
      missing.push(`operation:${operation}`)
    }
  }
  for (const dataSource of spec.consumesDataSources) {
    if (
      !descriptor.dataSources.some(
        item => item.contract === dataSource.contract && item.major === dataSource.major,
      )
    ) {
      missing.push(`data-source:${dataSource.contract}@${dataSource.major}`)
    }
  }
  const ordered = Object.freeze([...new Set(missing)].sort(compareUtf8))
  // optional facets are bound when published and simply absent otherwise; they never gate the stage
  const optionalBound = Object.freeze(
    [
      ...new Set(
        (spec.optionalDataSources ?? [])
          .filter(optional =>
            descriptor.dataSources.some(
              item => item.contract === optional.contract && item.major === optional.major,
            ),
          )
          .map(optional => optional.contract),
      ),
    ].sort(compareUtf8),
  )
  return Object.freeze({ eligible: ordered.length === 0, missing: ordered, optionalBound })
}

export interface CatalogPresentationCandidate extends PresentationSlot {
  /** Result of data-only catalog applicability evaluation for this descriptor. */
  readonly eligible: boolean
  readonly missing?: readonly string[]
}

export interface PresentationResolverOptions<Ticket> {
  readonly descriptor: AnyDescriptor
  readonly candidates: readonly CatalogPresentationCandidate[]
  resolveBinding(
    binding: BindingRef,
    slot: PresentationSlot,
  ): Promise<ResolvedBinding<Ticket> | undefined>
  /** Host-selected digest authority (normally SHA-256 over canonical plan JSON). */
  readonly digest: (plan: PresentationPlan) => string
  readonly ticketMatches: (binding: ResolvedBinding<Ticket>) => boolean
}

export interface PresentationValidatorOptions<Ticket> {
  readonly digest: (plan: PresentationPlan) => string
  readonly ticketMatches: (binding: ResolvedBinding<Ticket>) => boolean
}

function slotKey(slot: PresentationSlot): string {
  return `${String(999_999_999 - slot.priority).padStart(9, '0')}\u0000${slot.extensionId}\u0000${slot.contributionId}\u0000${slot.slotId}`
}

function sortedSlots<Slot extends PresentationSlot>(slots: readonly Slot[]): Slot[] {
  return [...slots].sort((left, right) => compareUtf8(slotKey(left), slotKey(right)))
}

function bindingKey(binding: BindingRef): string {
  return binding.bindingId
}

function sameBinding(left: BindingRef, right: BindingRef): boolean {
  if (left.bindingId !== right.bindingId) return false
  if ('dataSource' in left || 'dataSource' in right) {
    return (
      'dataSource' in left &&
      'dataSource' in right &&
      left.dataSource.contract === right.dataSource.contract &&
      left.dataSource.major === right.dataSource.major
    )
  }
  return left.contract === right.contract && left.major === right.major
}

function planBindings(plan: PresentationPlan): readonly BindingRef[] {
  return [
    ...plan.slots.flatMap(slot => slot.bindings),
    ...(plan.fallback === undefined ? [] : plan.fallback.bindings),
  ]
}

export function createPresentationPlanValidator<Ticket>(
  options: PresentationValidatorOptions<Ticket>,
): PresentationPlanValidator<Ticket> {
  return Object.freeze({
    validate(resolved: ResolvedPresentationPlan<Ticket>): PresentationPlanValidation {
      const issues = new Set<PresentationPlanIssue>()
      const slotIds = new Set<string>()
      const stageIds = new Set<string>()
      const singletonGroups = new Set<string>()
      for (const slot of resolved.plan.slots) {
        if (slotIds.has(slot.slotId)) issues.add('duplicate-slot-id')
        slotIds.add(slot.slotId)
        if (slot.kind === 'stage') {
          stageIds.add(slot.slotId)
          if (slot.singletonGroup !== undefined) {
            if (singletonGroups.has(slot.singletonGroup)) issues.add('duplicate-singleton-group')
            singletonGroups.add(slot.singletonGroup)
          }
        }
      }
      if (resolved.plan.activeStage === undefined) {
        if (
          resolved.plan.fallback === undefined ||
          resolved.plan.fallback.kind !== 'fallback' ||
          resolved.plan.alternateStages.length !== 0
        ) {
          issues.add('invalid-fallback')
        }
      } else {
        if (!stageIds.has(resolved.plan.activeStage)) issues.add('missing-active-stage')
        for (const alternate of resolved.plan.alternateStages) {
          if (!stageIds.has(alternate)) issues.add('missing-alternate-stage')
        }
      }
      if (resolved.plan.fallback !== undefined && resolved.plan.fallback.kind !== 'fallback') {
        issues.add('invalid-fallback')
      }

      const expected = new Map<string, BindingRef>()
      for (const binding of planBindings(resolved.plan)) {
        const key = bindingKey(binding)
        if (expected.has(key)) issues.add('duplicate-binding-id')
        else expected.set(key, binding)
      }
      const actual = new Map<string, ResolvedBinding<Ticket>>()
      for (const binding of resolved.bindings) {
        const key = bindingKey(binding)
        if (actual.has(key)) issues.add('duplicate-binding-id')
        else actual.set(key, binding)
      }
      for (const [key, binding] of expected) {
        const selected = actual.get(key)
        if (selected === undefined) issues.add('unresolved-binding')
        else if (!sameBinding(binding, selected) || !options.ticketMatches(selected)) {
          issues.add('ticket-binding-mismatch')
        }
      }
      for (const key of actual.keys()) {
        if (!expected.has(key)) issues.add('unexpected-binding')
      }
      if (options.digest(resolved.plan) !== resolved.planDigest) {
        issues.add('invalid-plan-digest')
      }
      return issues.size === 0
        ? { valid: true }
        : { valid: false, issues: Object.freeze([...issues].sort(compareUtf8)) }
    },
  })
}

/** Resolve an evaluated global viewer catalog into one immutable session-local plan. */
export async function resolvePresentationPlan<Ticket>(
  options: PresentationResolverOptions<Ticket>,
): Promise<ResolvedPresentationPlan<Ticket>> {
  const eligible = sortedSlots(
    options.candidates.filter(item => item.eligible && (item.missing?.length ?? 0) === 0),
  )
  const unsatisfied = options.candidates
    .filter(item => !item.eligible || (item.missing?.length ?? 0) > 0)
    .map(item => ({ contributionId: item.contributionId, missing: [...(item.missing ?? [])] }))
    .sort(
      (left, right) =>
        compareUtf8(left.contributionId, right.contributionId) ||
        compareUtf8(left.missing.join('\0'), right.missing.join('\0')),
    )
  const selectedStages: CatalogPresentationCandidate[] = []
  const seenGroups = new Set<string>()
  for (const stage of eligible.filter(item => item.kind === 'stage')) {
    const group = stage.singletonGroup ?? `slot:${stage.slotId}`
    if (seenGroups.has(group)) continue
    seenGroups.add(group)
    selectedStages.push(stage)
  }
  const active = selectedStages[0]
  const fallback = eligible.find(item => item.kind === 'fallback')
  if (active === undefined && fallback === undefined) {
    throw new ModkitError({
      code: 'x3.host/presentation-fallback-missing',
      message: 'no eligible stage and no eligible fallback contribution',
    })
  }
  const supporting = eligible.filter(item => item.kind !== 'stage' && item.kind !== 'fallback')
  const slots = Object.freeze([...selectedStages, ...supporting] as PresentationSlot[])
  const fallbackSlot = fallback as (PresentationSlot & { readonly kind: 'fallback' }) | undefined
  const common = {
    subjectUri: options.descriptor.subjectUri,
    revision: options.descriptor.revision,
    slots,
    unsatisfied: Object.freeze(
      unsatisfied.map(item => Object.freeze({ ...item, missing: Object.freeze(item.missing) })),
    ),
  }
  const plan: PresentationPlan =
    active === undefined
      ? definePresentationPlan({
          ...common,
          alternateStages: [],
          fallback: fallbackSlot as PresentationSlot & { readonly kind: 'fallback' },
        })
      : definePresentationPlan({
          ...common,
          activeStage: active.slotId,
          alternateStages: Object.freeze(selectedStages.slice(1).map(item => item.slotId)),
          ...(fallbackSlot === undefined ? {} : { fallback: fallbackSlot }),
        })

  const selectedBindings: ResolvedBinding<Ticket>[] = []
  const seenBindings = new Set<string>()
  for (const slot of [...slots, ...(fallbackSlot === undefined ? [] : [fallbackSlot])]) {
    for (const binding of slot.bindings) {
      if (seenBindings.has(binding.bindingId)) {
        throw new ModkitError({
          code: 'x3.host/duplicate-presentation-binding',
          message: `presentation binding ${binding.bindingId} is declared more than once`,
        })
      }
      seenBindings.add(binding.bindingId)
      const resolved = await options.resolveBinding(binding, slot)
      if (resolved === undefined) {
        throw new ModkitError({
          code: 'x3.host/unresolved-presentation-binding',
          message: `presentation binding ${binding.bindingId} could not be resolved`,
        })
      }
      selectedBindings.push(Object.freeze({ ...resolved }))
    }
  }
  const result = Object.freeze({
    plan,
    bindings: Object.freeze(selectedBindings),
    planDigest: options.digest(plan),
  })
  const validation = createPresentationPlanValidator(options).validate(result)
  if (!validation.valid) {
    throw new ModkitError({
      code: 'x3.host/invalid-presentation-plan',
      message: `resolved presentation plan failed validation: ${validation.issues.join(', ')}`,
      context: { issues: validation.issues },
    })
  }
  return result
}

/** Pure stage switch: provider tickets/bindings and the owning AssetSession are reused. */
export function switchPresentationStage<Ticket>(
  resolved: ResolvedPresentationPlan<Ticket>,
  activeStage: PresentationSlotId,
  digest: (plan: PresentationPlan) => string,
): ResolvedPresentationPlan<Ticket> {
  const stages = resolved.plan.slots.filter(slot => slot.kind === 'stage')
  if (!stages.some(slot => slot.slotId === activeStage)) {
    throw new ModkitError({
      code: 'x3.host/presentation-stage-missing',
      message: `presentation stage ${activeStage} is not in this session plan`,
    })
  }
  const plan = definePresentationPlan({
    ...resolved.plan,
    activeStage,
    alternateStages: stages.filter(slot => slot.slotId !== activeStage).map(slot => slot.slotId),
  } as PresentationPlan)
  return Object.freeze({ ...resolved, plan, planDigest: digest(plan) })
}

export function createViewerSources<Ticket>(
  resolved: ResolvedPresentationPlan<Ticket>,
  open: (binding: ResolvedBinding<Ticket>) => Promise<Lease<unknown> | undefined>,
): ViewerSources {
  const bindings = new Map(resolved.bindings.map(binding => [binding.bindingId, binding]))
  const find = async (binding: BindingRef) => {
    const selected = bindings.get(binding.bindingId)
    if (selected === undefined || !sameBinding(binding, selected)) return undefined
    return open(selected)
  }
  return Object.freeze({
    get: find as ViewerSources['get'],
    getUnknown: find as (binding: OpaqueBindingRef) => Promise<Lease<unknown> | undefined>,
  })
}
