import {
  GAME_CONTRIBUTION_MODES,
  type CodecDependencyRef,
  type CodecSupportStatus,
  type GameContributionConfig,
  type GameContributionMode,
  type GameFeatureGroup,
} from './codec-manifest.js'

export const GAME_CONTRIBUTION_STATUS_FACETS = [
  'required',
  'default',
  'suggested',
  'integrated',
  'enabled',
  'user-disabled',
  'not-installed',
  'unavailable',
  'unsupported',
  'blocked-by-dependency',
] as const

export type GameContributionStatusFacet = (typeof GAME_CONTRIBUTION_STATUS_FACETS)[number]

export interface InstalledGameContribution {
  readonly coordinate: string
  readonly status: CodecSupportStatus
  readonly environmentAvailable: boolean
}

export interface ResolveGameContributionsInput {
  readonly gameCoordinate: string
  readonly featureGroups: Readonly<Record<string, GameFeatureGroup>>
  readonly contributionConfig?: readonly GameContributionConfig[]
  readonly selectedFeatureGroups: readonly string[]
  readonly installed: readonly InstalledGameContribution[]
  readonly userOverrides?: Readonly<Record<string, boolean>>
}

export interface EffectiveGameContribution {
  readonly codecId: string
  readonly mode: GameContributionMode
  readonly modes: readonly GameContributionMode[]
  readonly featureGroups: readonly string[]
  readonly ranges: readonly string[]
  readonly features: readonly string[]
  readonly priority: number
  readonly sourceScopes: readonly string[]
  readonly overrideKey: string
  readonly userConfigurable: boolean
  readonly enabled: boolean
  readonly statusFacets: readonly GameContributionStatusFacet[]
  readonly blockedBy: readonly string[]
}

interface AggregatedContribution {
  readonly codecId: string
  readonly modes: Set<GameContributionMode>
  readonly featureGroups: Set<string>
  readonly groupsByMode: Map<GameContributionMode, Set<string>>
  readonly ranges: Set<string>
  readonly features: Set<string>
}

const MODE_STATUS: Readonly<Record<GameContributionMode, GameContributionStatusFacet>> = {
  requires: 'required',
  defaults: 'default',
  suggests: 'suggested',
  integrates: 'integrated',
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function dependencySort(left: CodecDependencyRef, right: CodecDependencyRef): number {
  return (
    left.id.localeCompare(right.id) ||
    left.range.localeCompare(right.range) ||
    (left.features ?? []).join('\0').localeCompare((right.features ?? []).join('\0'))
  )
}

function installedByCoordinate(
  installed: readonly InstalledGameContribution[],
): ReadonlyMap<string, InstalledGameContribution> {
  const result = new Map<string, InstalledGameContribution>()
  for (const entry of [...installed].sort((left, right) =>
    left.coordinate.localeCompare(right.coordinate),
  )) {
    if (result.has(entry.coordinate)) {
      throw new Error(`Installed codec coordinate '${entry.coordinate}' is duplicated.`)
    }
    result.set(entry.coordinate, entry)
  }
  return result
}

function configByCoordinate(
  configs: readonly GameContributionConfig[],
): ReadonlyMap<string, GameContributionConfig> {
  const result = new Map<string, GameContributionConfig>()
  for (const config of [...configs].sort((left, right) =>
    left.codecId.localeCompare(right.codecId),
  )) {
    if (result.has(config.codecId)) {
      throw new Error(`Game contribution config '${config.codecId}' is duplicated.`)
    }
    result.set(config.codecId, config)
  }
  return result
}

function contributionsForMode(
  group: GameFeatureGroup,
  mode: GameContributionMode,
): readonly CodecDependencyRef[] {
  return group[mode] ?? []
}

function aggregateContributions(
  featureGroups: Readonly<Record<string, GameFeatureGroup>>,
  selectedFeatureGroups: readonly string[],
): ReadonlyMap<string, AggregatedContribution> {
  const result = new Map<string, AggregatedContribution>()
  for (const groupId of sortedUnique(selectedFeatureGroups)) {
    const group = featureGroups[groupId]
    if (group === undefined) {
      throw new Error(`Selected game feature group '${groupId}' is not declared.`)
    }
    for (const mode of GAME_CONTRIBUTION_MODES) {
      for (const dependency of [...contributionsForMode(group, mode)].sort(dependencySort)) {
        let aggregate = result.get(dependency.id)
        if (aggregate === undefined) {
          aggregate = {
            codecId: dependency.id,
            modes: new Set(),
            featureGroups: new Set(),
            groupsByMode: new Map(),
            ranges: new Set(),
            features: new Set(),
          }
          result.set(dependency.id, aggregate)
        }
        aggregate.modes.add(mode)
        aggregate.featureGroups.add(groupId)
        aggregate.ranges.add(dependency.range)
        for (const feature of dependency.features ?? []) aggregate.features.add(feature)
        const modeGroups = aggregate.groupsByMode.get(mode) ?? new Set<string>()
        modeGroups.add(groupId)
        aggregate.groupsByMode.set(mode, modeGroups)
      }
    }
  }
  return result
}

function effectiveMode(modes: ReadonlySet<GameContributionMode>): GameContributionMode {
  const mode = GAME_CONTRIBUTION_MODES.find(candidate => modes.has(candidate))
  if (mode === undefined) throw new Error('Game contribution has no declared mode.')
  return mode
}

function isUsable(entry: InstalledGameContribution | undefined): boolean {
  return entry !== undefined && entry.environmentAvailable && entry.status !== 'unsupported'
}

function requiredBlockersByGroup(
  featureGroups: Readonly<Record<string, GameFeatureGroup>>,
  selectedFeatureGroups: readonly string[],
  installed: ReadonlyMap<string, InstalledGameContribution>,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, readonly string[]>()
  for (const groupId of sortedUnique(selectedFeatureGroups)) {
    const group = featureGroups[groupId]
    if (group === undefined) continue
    result.set(
      groupId,
      sortedUnique(
        contributionsForMode(group, 'requires')
          .map(dependency => dependency.id)
          .filter(coordinate => !isUsable(installed.get(coordinate))),
      ),
    )
  }
  return result
}

function blockersFor(
  contribution: AggregatedContribution,
  mode: GameContributionMode,
  blockersByGroup: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  if (mode === 'requires') return []
  const relevantGroups = contribution.groupsByMode.get(mode) ?? contribution.featureGroups
  const blockers = [...relevantGroups].map(groupId => blockersByGroup.get(groupId) ?? [])
  if (blockers.some(groupBlockers => groupBlockers.length === 0)) return []
  return sortedUnique(blockers.flat())
}

export function gameContributionOverrideKey(
  gameCoordinate: string,
  codecCoordinate: string,
): string {
  return `${gameCoordinate}::${codecCoordinate}`
}

/**
 * Resolves declarative game feature groups into a deterministic settings/runtime view.
 *
 * This function only evaluates supplied metadata. It never imports or instantiates a codec.
 */
export function resolveGameContributions(
  input: ResolveGameContributionsInput,
): readonly EffectiveGameContribution[] {
  const selectedGroups = sortedUnique(input.selectedFeatureGroups)
  const installed = installedByCoordinate(input.installed)
  const configs = configByCoordinate(input.contributionConfig ?? [])
  const contributions = aggregateContributions(input.featureGroups, selectedGroups)
  const blockersByGroup = requiredBlockersByGroup(input.featureGroups, selectedGroups, installed)

  return [...contributions.values()]
    .map(contribution => {
      const mode = effectiveMode(contribution.modes)
      const installedEntry = installed.get(contribution.codecId)
      const config = configs.get(contribution.codecId)
      const overrideKey = gameContributionOverrideKey(input.gameCoordinate, contribution.codecId)
      const override = input.userOverrides?.[overrideKey]
      const userConfigurable = mode === 'defaults' || mode === 'suggests'
      const userDisabled = userConfigurable && override === false
      const activationRequested = mode === 'suggests' ? override === true : !userDisabled
      const blockedBy = blockersFor(contribution, mode, blockersByGroup)
      const statusFacets: GameContributionStatusFacet[] = [MODE_STATUS[mode]]

      if (installedEntry === undefined) statusFacets.push('not-installed')
      else {
        if (!installedEntry.environmentAvailable) statusFacets.push('unavailable')
        if (installedEntry.status === 'unsupported') statusFacets.push('unsupported')
      }
      if (userDisabled) statusFacets.push('user-disabled')
      if (blockedBy.length > 0) statusFacets.push('blocked-by-dependency')

      const enabled = activationRequested && isUsable(installedEntry) && blockedBy.length === 0
      if (enabled) statusFacets.push('enabled')

      return {
        codecId: contribution.codecId,
        mode,
        modes: GAME_CONTRIBUTION_MODES.filter(candidate => contribution.modes.has(candidate)),
        featureGroups: sortedUnique(contribution.featureGroups),
        ranges: sortedUnique(contribution.ranges),
        features: sortedUnique(contribution.features),
        priority: config?.priority ?? 0,
        sourceScopes: sortedUnique(config?.sourceScopes ?? []),
        overrideKey,
        userConfigurable,
        enabled,
        statusFacets,
        blockedBy,
      }
    })
    .sort(
      (left, right) => right.priority - left.priority || left.codecId.localeCompare(right.codecId),
    )
}
