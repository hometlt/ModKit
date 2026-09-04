/**
 * Viewer contribution descriptors and resolution — `ASSET_CAPABILITIES.md` sections 3.5 and 6.
 *
 * Contributions connect compatible runtime UI factories to descriptors *by ID*. "Capabilities
 * do not directly name widgets" (section 3.5) and "no capability directly names a UI component"
 * (design rule 3): this module is presentation-neutral and contains no DOM, CSS, or component
 * reference. `@modkitx/viewer-shell` maps the resolved contribution IDs to real components.
 */

import {
  satisfiesCapabilityRequirement,
  type CapabilityInstance,
  type CapabilityRequirement,
} from './capabilities.js'
import {
  isOperationAvailable,
  type AssetOperationDescriptor,
  type AssetOperationId,
} from './operations.js'

export const CONTRIBUTION_KINDS = [
  'stage',
  'tree',
  'panel',
  'toolbar',
  'transport',
  'status',
  'fallback',
] as const

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number]

/** Hosts named by the canonical architecture; open for adapters added later. */
export const HOST_IDS = ['vscode', 'electron', 'browser', 'embed', 'cli', 'test'] as const

export type KnownHostId = (typeof HOST_IDS)[number]
export type HostId = KnownHostId | (string & Record<never, never>)

/** `ASSET_CAPABILITIES.md` section 6, verbatim plus an optional display label. */
export interface ViewerContributionDescriptor {
  readonly id: string
  readonly kind: ContributionKind
  readonly requiresTraits?: readonly CapabilityRequirement[]
  readonly requiresOperations?: readonly AssetOperationId[]
  readonly hosts?: readonly HostId[]
  readonly priority: number
  readonly conflicts?: readonly string[]
  /**
   * At most one contribution per singleton group is selected. `stage` contributions default to
   * the implicit `stage` group so exactly one renderer occupies the center surface.
   */
  readonly singletonGroup?: string
  readonly label?: string
}

export type ContributionRejectionCode =
  'missing-trait' | 'missing-operation' | 'host-unsupported' | 'superseded' | 'conflict'

export interface RejectedContribution {
  readonly id: string
  readonly code: ContributionRejectionCode
  readonly detail?: string
}

export interface ContributionResolution {
  /** Everything the shell should mount, ordered by priority then ID. */
  readonly selected: readonly ViewerContributionDescriptor[]
  /**
   * Compatible stages that lost their singleton group. They stay available through the view
   * switch (section 6, rule 4) and are *not* mounted by default.
   */
  readonly alternates: readonly ViewerContributionDescriptor[]
  readonly rejected: readonly RejectedContribution[]
}

export interface ContributionResolutionInput {
  readonly traits: readonly CapabilityInstance[]
  readonly operations: readonly AssetOperationDescriptor[]
  readonly contributions: readonly ViewerContributionDescriptor[]
  readonly hostId?: HostId
}

/** Highest priority first; ID ascending as a deterministic tiebreak. */
function compareContributions(
  a: ViewerContributionDescriptor,
  b: ViewerContributionDescriptor,
): number {
  return b.priority - a.priority || a.id.localeCompare(b.id)
}

function singletonGroupOf(contribution: ViewerContributionDescriptor): string | undefined {
  return contribution.singletonGroup ?? (contribution.kind === 'stage' ? 'stage' : undefined)
}

/**
 * Applies the resolution rules of `ASSET_CAPABILITIES.md` section 6:
 *
 * 1. filter contributions whose requirements and host constraints are satisfied;
 * 2. choose at most one contribution per singleton group, using explicit priority;
 * 3. keep compatible panels/commands from multiple domains;
 * 4. expose meaningful alternate stages through a view switch;
 * 5. use the diagnostic/binary fallback when no stage can render;
 * 6. never infer an editor from a data trait alone — enforced upstream by requiring an
 *    explicit `requiresOperations` entry, since a trait alone can never satisfy one.
 */
export function resolveContributions(input: ContributionResolutionInput): ContributionResolution {
  const rejected: RejectedContribution[] = []
  const compatible: ViewerContributionDescriptor[] = []

  for (const contribution of input.contributions) {
    if (input.hostId && contribution.hosts && !contribution.hosts.includes(input.hostId)) {
      rejected.push({
        id: contribution.id,
        code: 'host-unsupported',
        detail: `host ${input.hostId} is not declared`,
      })
      continue
    }
    const missingTrait = contribution.requiresTraits?.find(
      requirement => !satisfiesCapabilityRequirement(input.traits, requirement),
    )
    if (missingTrait) {
      rejected.push({ id: contribution.id, code: 'missing-trait', detail: missingTrait.id })
      continue
    }
    const missingOperation = contribution.requiresOperations?.find(
      id => !isOperationAvailable(input.operations, id),
    )
    if (missingOperation !== undefined) {
      rejected.push({ id: contribution.id, code: 'missing-operation', detail: missingOperation })
      continue
    }
    compatible.push(contribution)
  }

  const ordered = [...compatible].sort(compareContributions)
  const selected: ViewerContributionDescriptor[] = []
  const alternates: ViewerContributionDescriptor[] = []
  const claimedGroups = new Set<string>()
  const conflicted = new Set<string>()

  // Rule 5: a fallback only competes for the stage when no real stage survived filtering.
  const hasStage = ordered.some(contribution => contribution.kind === 'stage')

  for (const contribution of ordered) {
    if (conflicted.has(contribution.id)) {
      rejected.push({ id: contribution.id, code: 'conflict' })
      continue
    }
    if (contribution.kind === 'fallback' && hasStage) {
      rejected.push({
        id: contribution.id,
        code: 'superseded',
        detail: 'a compatible stage is available',
      })
      continue
    }
    const group =
      contribution.kind === 'fallback' && !hasStage ? 'stage' : singletonGroupOf(contribution)
    if (group && claimedGroups.has(group)) {
      if (group === 'stage') alternates.push(contribution)
      else rejected.push({ id: contribution.id, code: 'superseded', detail: group })
      continue
    }
    if (group) claimedGroups.add(group)
    selected.push(contribution)
    for (const id of contribution.conflicts ?? []) conflicted.add(id)
  }

  return { selected, alternates, rejected }
}
