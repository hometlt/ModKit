/** Presentation-neutral model for the VS Code Extensions tree. */
import { compareUtf8 } from '@modkitx-x3/core'
import type { ExtensionManagerEntry } from '@modkitx/extension-manager'
import {
  contributionContractLabel,
  createUiLocalizer,
  type UiLocalizer,
} from '@modkitx-x3/ui/localization'

import type { ContributionRow } from './contributions.js'

export const OPEN_EXTENSION_COMMAND = 'modkit.extensions.openExtension'
export const OPEN_CONTRIBUTION_COMMAND = 'modkit.extensions.openContribution'

export type ExtensionGroup = 'installed' | 'available' | 'problems'

export interface ExtensionProblemNode {
  readonly kind: 'problem'
  readonly label: string
  readonly detail: string
}

export interface ExtensionGroupNode {
  readonly kind: 'group'
  readonly group: ExtensionGroup
  readonly label: string
  readonly entries?: readonly ExtensionEntryNode[]
  readonly problems?: readonly ExtensionProblemNode[]
}

export interface ExtensionEntryNode {
  readonly kind: 'entry'
  readonly group: ExtensionGroup
  readonly entry: ExtensionManagerEntry
  readonly contributions: readonly ContributionRow[]
}

/** A visual grouping only. It is deliberately not a card subject. */
export interface ContributionContractNode {
  readonly kind: 'contract'
  readonly group: ExtensionGroup
  readonly extension: string
  /** Exact manifest contract id. Absent only for an unparsed contribution record. */
  readonly contract?: string
  readonly contractMajor?: number
  readonly label: string
  readonly contributions: readonly ContributionRow[]
  readonly extensionEnabled: boolean
  readonly configuredDisabledContributionIds: ReadonlySet<string>
}

export interface ContributionNode {
  readonly kind: 'contribution'
  readonly group: ExtensionGroup
  readonly extension: string
  readonly contribution: ContributionRow
  /** Effective state after both the extension and contribution switches are applied. */
  readonly enabled: boolean
  /** State requested in settings; the running host may still differ until reload. */
  readonly configuredDisabled: boolean
  readonly pendingReload: boolean
}

export type ExtensionNode =
  | ExtensionGroupNode
  | ExtensionEntryNode
  | ContributionContractNode
  | ContributionNode
  | ExtensionProblemNode

export interface CreateExtensionTreeOptions {
  readonly entries: readonly ExtensionManagerEntry[]
  readonly contributions: readonly ContributionRow[]
  readonly configuredDisabledContributionIds: readonly string[]
  readonly problems: readonly ExtensionProblemNode[]
  /** Host-scoped translator; defaults to English for presentation-neutral callers and tests. */
  readonly localizer?: UiLocalizer
}

function contributionKey(row: ContributionRow): string {
  return `${row.contract ?? ''}\u0000${row.contractMajor ?? ''}`
}

function contractLabel(row: ContributionRow, localizer: UiLocalizer): string {
  return contributionContractLabel(localizer, row.contract)
}

function firstContribution(rows: readonly ContributionRow[]): ContributionRow {
  const first = rows[0]
  if (first === undefined) throw new TypeError('contribution contract group cannot be empty')
  return first
}

function entryNode(
  group: ExtensionGroup,
  entry: ExtensionManagerEntry,
  contributionsByExtension: ReadonlyMap<string, readonly ContributionRow[]>,
): ExtensionEntryNode {
  /*
   * This join is intentionally exact. A manager row may name a distribution package that owns
   * several extension roots, while an inventory contribution names its real extension owner.
   * The manager snapshot does not expose package -> root membership yet, so guessing by publisher
   * or path would put contributions under the wrong subject. Such package rows remain leaves until
   * that relationship is supplied by the shared manager model.
   */
  return Object.freeze({
    kind: 'entry',
    group,
    entry,
    contributions: contributionsByExtension.get(entry.id) ?? Object.freeze([]),
  })
}

/** Build the three root groups from one manager snapshot and one composed inventory. */
export function createExtensionTree(
  options: CreateExtensionTreeOptions,
): readonly ExtensionGroupNode[] {
  const localizer = options.localizer ?? createUiLocalizer('en')
  const contributionsByExtension = new Map<string, ContributionRow[]>()
  for (const contribution of options.contributions) {
    const rows = contributionsByExtension.get(contribution.extension) ?? []
    rows.push(contribution)
    contributionsByExtension.set(contribution.extension, rows)
  }
  const frozenContributions = new Map(
    [...contributionsByExtension].map(
      ([extension, rows]) => [extension, Object.freeze([...rows])] as const,
    ),
  )
  const nodes = (group: ExtensionGroup, entries: readonly ExtensionManagerEntry[]) =>
    Object.freeze(entries.map(entry => entryNode(group, entry, frozenContributions)))

  const entries = options.entries
  return Object.freeze([
    Object.freeze({
      kind: 'group',
      group: 'installed',
      label: localizer.text('extensions.group.installed'),
      entries: nodes(
        'installed',
        entries.filter(entry => entry.installedVersion !== undefined),
      ),
    }),
    Object.freeze({
      kind: 'group',
      group: 'available',
      label: localizer.text('extensions.group.available'),
      entries: nodes(
        'available',
        entries.filter(entry => entry.installedVersion === undefined),
      ),
    }),
    Object.freeze({
      kind: 'group',
      group: 'problems',
      label: localizer.text('extensions.group.problems'),
      problems: Object.freeze([...options.problems]),
    }),
  ])
}

function contractNodes(
  node: ExtensionEntryNode,
  configuredDisabledContributionIds: ReadonlySet<string>,
  localizer: UiLocalizer,
): readonly ContributionContractNode[] {
  const groups = new Map<string, ContributionRow[]>()
  for (const contribution of node.contributions) {
    const key = contributionKey(contribution)
    const rows = groups.get(key) ?? []
    rows.push(contribution)
    groups.set(key, rows)
  }
  return Object.freeze(
    [...groups.values()]
      .sort((left, right) =>
        compareUtf8(
          contributionKey(firstContribution(left)),
          contributionKey(firstContribution(right)),
        ),
      )
      .map(rows => {
        const first = firstContribution(rows)
        return Object.freeze({
          kind: 'contract' as const,
          group: node.group,
          extension: node.entry.id,
          ...(first.contract === undefined ? {} : { contract: first.contract }),
          ...(first.contractMajor === undefined ? {} : { contractMajor: first.contractMajor }),
          label: contractLabel(first, localizer),
          contributions: Object.freeze([...rows]),
          extensionEnabled: node.entry.enabled,
          configuredDisabledContributionIds,
        })
      }),
  )
}

/** Return real tree children. Contract nodes are visual grouping; leaves are inventory rows. */
export function extensionTreeChildren(
  node: ExtensionNode,
  configuredDisabledContributionIds: readonly string[],
  localizer: UiLocalizer = createUiLocalizer('en'),
): readonly ExtensionNode[] {
  if (node.kind === 'group')
    return node.group === 'problems' ? (node.problems ?? []) : (node.entries ?? [])
  if (node.kind === 'entry') {
    if (node.contributions.length === 0) return []
    return contractNodes(node, new Set(configuredDisabledContributionIds), localizer)
  }
  if (node.kind === 'contract') {
    return Object.freeze(
      node.contributions.map(contribution => {
        const configuredDisabled =
          contribution.id === undefined
            ? contribution.disabled
            : node.configuredDisabledContributionIds.has(contribution.id)
        return Object.freeze({
          kind: 'contribution' as const,
          group: node.group,
          extension: node.extension,
          contribution,
          enabled: node.extensionEnabled && !configuredDisabled,
          configuredDisabled,
          pendingReload: configuredDisabled !== contribution.disabled,
        })
      }),
    )
  }
  return []
}
