/** Presentation-neutral model for the VS Code Extensions tree. */
import { compareUtf8 } from '@modkit/core'
import type { ExtensionManagerEntry } from '@modkit/extension-manager'
import {
  contributionContractLabel,
  createUiLocalizer,
  type UiLocalizer,
} from '@modkit/ui/localization'

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
  /** Presentation hierarchy for installed and available packages. */
  readonly vendors?: readonly ExtensionVendorNode[]
  /** Flat count and backwards-compatible access to the package rows. */
  readonly entries?: readonly ExtensionEntryNode[]
  readonly problems?: readonly ExtensionProblemNode[]
}

/** A publisher/vendor branch. It is presentation only and never a card subject. */
export interface ExtensionVendorNode {
  readonly kind: 'vendor'
  readonly group: Exclude<ExtensionGroup, 'problems'>
  readonly id: string
  readonly label: string
  readonly components: readonly ExtensionComponentNode[]
}

/** A game-specific branch, or the vendor's cross-game/shared components. */
export interface ExtensionComponentNode {
  readonly kind: 'component'
  readonly group: Exclude<ExtensionGroup, 'problems'>
  readonly component: 'game' | 'shared'
  readonly id?: string
  readonly label: string
  readonly entries: readonly ExtensionEntryNode[]
}

export interface ExtensionEntryNode {
  readonly kind: 'entry'
  readonly group: ExtensionGroup
  readonly entry: ExtensionManagerEntry
  readonly contributions: readonly ContributionRow[]
  readonly configuredDisabledContributionIds: ReadonlySet<string>
  /** The package store changed, but the running extension host still needs a reload. */
  readonly pendingReload: boolean
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
  | ExtensionVendorNode
  | ExtensionComponentNode
  | ExtensionEntryNode
  | ContributionContractNode
  | ContributionNode
  | ExtensionProblemNode

/** Context value consumed by VS Code's inline `view/item/context` actions. */
export function extensionActionContextValue(node: ExtensionEntryNode | ContributionNode): string {
  if (node.kind === 'contribution') {
    if (node.contribution.id === undefined) return 'modkitContribution.invalid'
    if (node.group === 'installed' && node.contribution.contract === 'modkit/codec-contribution') {
      return `modkitContribution.codec.${node.configuredDisabled ? 'disabled' : 'enabled'}`
    }
    return `modkitContribution.${node.configuredDisabled ? 'disabled' : 'enabled'}`
  }

  const { entry } = node
  if (entry.installedVersion === undefined) return 'modkitExtension.available'
  const immutable =
    entry.source === 'bundled' ||
    entry.source === 'workspace' ||
    entry.source === 'configured' ||
    entry.source.startsWith('local:') ||
    entry.source.startsWith('managed:')
  const base = immutable
    ? 'modkitExtension.installed.immutable'
    : `modkitExtension.installed.mutable${entry.updateAvailable ? '.update' : ''}`
  const codecIds = node.contributions.flatMap(contribution =>
    contribution.contract === 'modkit/codec-contribution' && contribution.id !== undefined
      ? [contribution.id]
      : [],
  )
  if (codecIds.length === 0) return base
  const everyCodecEnabled = codecIds.every(id => !node.configuredDisabledContributionIds.has(id))
  return `${base}.codecs.${everyCodecEnabled ? 'enabled' : 'disabled'}`
}

/** Context value for commands attached to a root group rather than a package row. */
export function extensionGroupActionContextValue(node: ExtensionGroupNode): string {
  if (node.group === 'available' && (node.entries?.length ?? 0) === 0) {
    return 'modkitExtensionGroup.available.empty'
  }
  return `modkitExtensionGroup.${node.group}`
}

export interface CreateExtensionTreeOptions {
  readonly entries: readonly ExtensionManagerEntry[]
  readonly contributions: readonly ContributionRow[]
  readonly configuredDisabledContributionIds: readonly string[]
  readonly problems: readonly ExtensionProblemNode[]
  /** Package ids changed in storage during this host lifetime and are not active until reload. */
  readonly pendingReloadEntryIds?: readonly string[]
  /** Host-scoped translator; defaults to English for presentation-neutral callers and tests. */
  readonly localizer?: UiLocalizer
}

interface PresentationVendor {
  readonly id?: string
  readonly displayName?: string
}

interface PresentationGame {
  readonly id?: string
  readonly displayName?: string
}

interface ExtensionPresentation {
  readonly displayName?: string
  readonly vendor?: PresentationVendor
  readonly games?: readonly PresentationGame[]
}

type PresentedExtensionEntry = ExtensionManagerEntry & {
  readonly presentation?: ExtensionPresentation
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function presentation(entry: ExtensionManagerEntry): ExtensionPresentation | undefined {
  const value = (entry as PresentedExtensionEntry).presentation
  return value !== null && typeof value === 'object' ? value : undefined
}

/** Use a catalog's friendly package name when it supplies one, without requiring new metadata. */
export function extensionEntryDisplayName(entry: ExtensionManagerEntry): string {
  return nonBlank(presentation(entry)?.displayName) ?? entry.displayName
}

interface VendorIdentity {
  readonly id: string
  readonly label: string
}

function vendorIdentity(entry: ExtensionManagerEntry): VendorIdentity {
  const vendor = presentation(entry)?.vendor
  const id = nonBlank(vendor?.id) ?? entry.publisher
  return Object.freeze({ id, label: nonBlank(vendor?.displayName) ?? entry.publisher })
}

interface ComponentIdentity {
  readonly component: 'game' | 'shared'
  readonly id?: string
  readonly label: string
}

const SHARED_COMPONENTS_LABEL = 'Shared Components'
const SHARED_COMPONENTS_KEY = 'vscode.extensions.sharedComponents'

function sharedComponentsLabel(localizer: UiLocalizer): string {
  const translated = localizer.text(SHARED_COMPONENTS_KEY)
  return translated === SHARED_COMPONENTS_KEY ? SHARED_COMPONENTS_LABEL : translated
}

function componentIdentities(
  entry: ExtensionManagerEntry,
  sharedLabel: string,
): readonly ComponentIdentity[] {
  const seen = new Set<string>()
  const games = presentation(entry)?.games ?? []
  const result = games.flatMap(game => {
    const id = nonBlank(game.id)
    if (id === undefined || seen.has(id)) return []
    seen.add(id)
    return [
      Object.freeze({
        component: 'game' as const,
        id,
        label: nonBlank(game.displayName) ?? id,
      }),
    ]
  })
  return result.length === 0
    ? Object.freeze([Object.freeze({ component: 'shared' as const, label: sharedLabel })])
    : Object.freeze(result)
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
  configuredDisabledContributionIds: ReadonlySet<string>,
  pendingReloadEntryIds: ReadonlySet<string>,
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
    configuredDisabledContributionIds,
    pendingReload: pendingReloadEntryIds.has(entry.id),
  })
}

interface MutableComponent {
  readonly identity: ComponentIdentity
  readonly entries: ExtensionEntryNode[]
}

interface MutableVendor {
  readonly identity: VendorIdentity
  readonly components: Map<string, MutableComponent>
}

function compareEntryNodes(left: ExtensionEntryNode, right: ExtensionEntryNode): number {
  const displayName = compareUtf8(
    extensionEntryDisplayName(left.entry),
    extensionEntryDisplayName(right.entry),
  )
  return displayName === 0 ? compareUtf8(left.entry.id, right.entry.id) : displayName
}

function vendorNodes(
  group: Exclude<ExtensionGroup, 'problems'>,
  entries: readonly ExtensionEntryNode[],
  localizer: UiLocalizer,
): readonly ExtensionVendorNode[] {
  const vendors = new Map<string, MutableVendor>()
  for (const entry of entries) {
    const vendor = vendorIdentity(entry.entry)
    const vendorNode = vendors.get(vendor.id) ?? {
      identity: vendor,
      components: new Map<string, MutableComponent>(),
    }
    vendors.set(vendor.id, vendorNode)
    for (const component of componentIdentities(entry.entry, sharedComponentsLabel(localizer))) {
      const key = `${component.component}\u0000${component.id ?? ''}`
      const componentNode = vendorNode.components.get(key) ?? { identity: component, entries: [] }
      componentNode.entries.push(entry)
      vendorNode.components.set(key, componentNode)
    }
  }
  return Object.freeze(
    [...vendors.values()]
      .sort((left, right) => {
        const label = compareUtf8(left.identity.label, right.identity.label)
        return label === 0 ? compareUtf8(left.identity.id, right.identity.id) : label
      })
      .map(vendor =>
        Object.freeze({
          kind: 'vendor' as const,
          group,
          id: vendor.identity.id,
          label: vendor.identity.label,
          components: Object.freeze(
            [...vendor.components.values()]
              .sort((left, right) => {
                if (left.identity.component !== right.identity.component) {
                  return left.identity.component === 'game' ? -1 : 1
                }
                return compareUtf8(left.identity.label, right.identity.label)
              })
              .map(component =>
                Object.freeze({
                  kind: 'component' as const,
                  group,
                  component: component.identity.component,
                  ...(component.identity.id === undefined ? {} : { id: component.identity.id }),
                  label: component.identity.label,
                  entries: Object.freeze([...component.entries].sort(compareEntryNodes)),
                }),
              ),
          ),
        }),
      ),
  )
}

/** Build package-state roots, then vendor/game/component presentation branches and Problems. */
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
  const configuredDisabledContributionIds = new Set(options.configuredDisabledContributionIds)
  const pendingReloadEntryIds = new Set(options.pendingReloadEntryIds ?? [])
  const nodes = (group: ExtensionGroup, entries: readonly ExtensionManagerEntry[]) =>
    Object.freeze(
      entries.map(entry =>
        entryNode(
          group,
          entry,
          frozenContributions,
          configuredDisabledContributionIds,
          pendingReloadEntryIds,
        ),
      ),
    )

  const entries = options.entries
  const installed = nodes(
    'installed',
    entries.filter(entry => entry.installedVersion !== undefined),
  )
  const available = nodes(
    'available',
    entries.filter(entry => entry.installedVersion === undefined),
  )
  return Object.freeze([
    Object.freeze({
      kind: 'group',
      group: 'installed',
      label: localizer.text('extensions.group.installed'),
      entries: installed,
      vendors: vendorNodes('installed', installed, localizer),
    }),
    Object.freeze({
      kind: 'group',
      group: 'available',
      label: localizer.text('extensions.group.available'),
      entries: available,
      vendors: vendorNodes('available', available, localizer),
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
    return node.group === 'problems' ? (node.problems ?? []) : (node.vendors ?? node.entries ?? [])
  if (node.kind === 'vendor') return node.components
  if (node.kind === 'component') return node.entries
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
