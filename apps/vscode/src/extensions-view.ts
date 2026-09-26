/** The Extensions tree view. */
import * as vscode from 'vscode'
import type { ExtensionManagerEntry } from '@modkit/extension-manager'
import { type UiLocalizer } from '@modkit/ui/localization'

import {
  createExtensionTree,
  extensionActionContextValue,
  extensionComponentActionContextValue,
  extensionEntryDisplayName,
  extensionGroupActionContextValue,
  extensionTreeChildren,
  extensionVendorActionContextValue,
  OPEN_CONTRIBUTION_COMMAND,
  OPEN_EXTENSION_COMMAND,
  OPEN_GAME_COMMAND,
  OPEN_VENDOR_COMMAND,
  type ExtensionNode,
} from './extension-tree.js'
import { ExtensionManagerController } from './extension-manager.js'
import { type VsCodeSubjectHost } from './host.js'

// ---------------------------------------------------------------------------------------------
// tree views

/**
 * Native extension-manager surface.
 *
 * Installed packages own their contributions. Availability is a separate catalogue question, and
 * problems remain visible without repeating installed packages in state-specific root groups.
 */
export class ExtensionsView implements vscode.TreeDataProvider<ExtensionNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExtensionNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly subscription: { dispose(): void }

  constructor(
    private readonly host: VsCodeSubjectHost,
    private readonly manager: ExtensionManagerController,
    private readonly disabledContributionIds: () => readonly string[],
    private readonly availableContributions: readonly import('./contributions.js').ContributionRow[],
    private readonly localizer: UiLocalizer,
    private readonly iconPathForEntry?: (entry: ExtensionManagerEntry) => string | undefined,
    private readonly gameIconPath?: string,
  ) {
    this.subscription = manager.onDidChange(() => this.changed.fire(undefined))
  }

  dispose(): void {
    this.subscription.dispose()
    this.changed.dispose()
  }

  getTreeItem(node: ExtensionNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const count = node.entries?.length ?? node.problems?.length ?? 0
      const item = new vscode.TreeItem(
        `${node.label} (${count})`,
        node.group === 'installed' && count > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.iconPath = new vscode.ThemeIcon(node.group === 'problems' ? 'warning' : 'extensions')
      item.contextValue = extensionGroupActionContextValue(node)
      return item
    }
    if (node.kind === 'vendor') {
      const count = node.sections.reduce(
        (total, section) =>
          total +
          section.components.reduce((inner, component) => inner + component.entries.length, 0),
        0,
      )
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${count}`
      item.tooltip = node.label
      item.iconPath = new vscode.ThemeIcon('organization')
      item.contextValue = extensionVendorActionContextValue(node)
      item.command = {
        command: OPEN_VENDOR_COMMAND,
        title: this.localizer.text('extensions.action.openExtensionCard'),
        arguments: [{ kind: 'vendor', id: node.id } as const],
      }
      return item
    }
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${
        node.section === 'components'
          ? node.components.reduce((count, component) => count + component.entries.length, 0)
          : node.components.length
      }`
      item.tooltip = node.label
      item.iconPath = new vscode.ThemeIcon(node.section === 'games' ? 'game' : 'references')
      item.contextValue = `modkitExtensionSection.${node.section}`
      return item
    }
    if (node.kind === 'component') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${node.entries.length}`
      item.tooltip =
        node.component === 'shared'
          ? this.localizer.text('vscode.extensions.components')
          : (node.id ?? node.label)
      item.iconPath =
        node.component !== 'game' || this.gameIconPath === undefined
          ? new vscode.ThemeIcon(node.component === 'shared' ? 'references' : 'symbol-event')
          : vscode.Uri.file(this.gameIconPath)
      item.contextValue = extensionComponentActionContextValue(node)
      if (node.component === 'game' && node.id !== undefined) {
        item.command = {
          command: OPEN_GAME_COMMAND,
          title: this.localizer.text('extensions.action.openExtensionCard'),
          arguments: [{ kind: 'game', id: node.id } as const],
        }
      }
      return item
    }
    if (node.kind === 'problem') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.description = node.detail
      item.tooltip = `${node.label}\n${node.detail}`
      item.iconPath = new vscode.ThemeIcon('error')
      return item
    }

    if (node.kind === 'contract') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${node.contributions.length}`
      const exactContract =
        node.contract === undefined
          ? undefined
          : `${node.contract}${node.contractMajor === undefined ? '' : `@${node.contractMajor}`}`
      item.tooltip =
        exactContract === undefined
          ? this.localizer.text('extensions.tooltip.invalidContract')
          : `${node.label}\n${this.localizer.text('extensions.tooltip.exactContract', { contract: exactContract })}`
      item.iconPath = new vscode.ThemeIcon('symbol-interface')
      item.contextValue = 'modkitContributionContract'
      return item
    }

    if (node.kind === 'contribution') {
      const { contribution } = node
      const item = new vscode.TreeItem(
        contribution.displayName,
        vscode.TreeItemCollapsibleState.None,
      )
      const identity = contribution.id ?? contribution.path
      const state = this.localizer.text(node.enabled ? 'common.enabled' : 'common.disabled')
      // State is communicated by the icon, tooltip and assistive label; do not repeat it as text.
      if (node.pendingReload)
        item.description = this.localizer.text('extensions.state.reloadPending')
      const exactContract = `${contribution.contract ?? this.localizer.text('extensions.tooltip.invalidContract')}${
        contribution.contractMajor === undefined ? '' : `@${contribution.contractMajor}`
      }`
      item.tooltip =
        `${identity}\n${node.extension}\n` +
        `${this.localizer.text('extensions.tooltip.contract', { contract: exactContract })}\n` +
        `${this.localizer.text('extensions.tooltip.state', { state })}` +
        `${node.pendingReload ? ` · ${this.localizer.text('extensions.state.afterReload')}` : ''}\n` +
        this.localizer.text('extensions.tooltip.origin', { origin: contribution.origin })
      item.iconPath = new vscode.ThemeIcon(node.enabled ? 'pass-filled' : 'circle-slash')
      item.accessibilityInformation = {
        label: `${contribution.displayName}: ${state}${
          node.pendingReload ? `; ${this.localizer.text('extensions.state.afterReload')}` : ''
        }`,
      }
      item.contextValue = extensionActionContextValue(node)
      if (contribution.id !== undefined) {
        item.command = {
          command: OPEN_CONTRIBUTION_COMMAND,
          title: this.localizer.text('extensions.action.openContributionCard'),
          arguments: [
            { kind: 'contribution', id: contribution.id, extension: node.extension } as const,
          ],
        }
      }
      return item
    }

    const { entry } = node
    const displayName = extensionEntryDisplayName(entry)
    const item = new vscode.TreeItem(
      displayName,
      node.contributions.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    )
    const version =
      entry.installedVersion === undefined
        ? `${this.localizer.text('extensions.group.available')} ${entry.availableVersion}`
        : entry.updateAvailable
          ? `${entry.installedVersion} → ${entry.availableVersion}`
          : entry.installedVersion
    item.description = `${version}${
      node.pendingReload ? ` · ${this.localizer.text('extensions.state.reloadPending')}` : ''
    }`
    item.tooltip =
      `${displayName}\n${entry.id}\n${version}\n${this.localizer.text('extensions.tooltip.source', {
        source: entry.source,
      })}\n` +
      this.localizer.text(
        entry.trusted
          ? 'extensions.tooltip.trustedPublisher'
          : 'extensions.tooltip.unverifiedPublisher',
      ) +
      (node.pendingReload ? `\n${this.localizer.text('extensions.state.afterReload')}` : '')
    const iconPath = this.iconPathForEntry?.(entry)
    item.iconPath =
      iconPath === undefined
        ? new vscode.ThemeIcon(
            node.group === 'available'
              ? 'cloud-download'
              : entry.enabled
                ? 'extensions'
                : 'circle-slash',
          )
        : vscode.Uri.file(iconPath)
    item.contextValue = extensionActionContextValue(node)
    item.command = {
      command: OPEN_EXTENSION_COMMAND,
      title: this.localizer.text('extensions.action.openExtensionCard'),
      arguments: [{ kind: 'extension', id: entry.id } as const],
    }
    return item
  }

  async getChildren(node?: ExtensionNode): Promise<ExtensionNode[]> {
    if (node !== undefined)
      return [...extensionTreeChildren(node, this.disabledContributionIds(), this.localizer)]

    const entries = (await this.manager.snapshot()).entries
    const problems = [
      ...this.host.extensions.failures.map(failure => ({
        kind: 'problem' as const,
        label: failure.root,
        detail: `${failure.code}: ${failure.message}`,
      })),
      ...this.host.extensions.problems.map(problem => ({
        kind: 'problem' as const,
        label: problem,
        detail: this.localizer.text('activity.settings'),
      })),
    ]
    return [
      ...createExtensionTree({
        entries,
        contributions: [...this.host.contributions, ...this.availableContributions],
        configuredDisabledContributionIds: this.disabledContributionIds(),
        pendingReloadEntryIds: this.manager.pendingReloadIds(),
        problems,
        localizer: this.localizer,
      }),
    ]
  }
}
