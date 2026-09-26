/** The Host tree view: the realms this window composed. */
import * as vscode from 'vscode'
import { type UiLocalizer } from '@modkit/ui/localization'

import { type VsCodeSubjectHost } from './host.js'
import { type FacilityReport } from './facilities.js'
import { type SelectedContentSource } from './workbench-workflows.js'

/**
 * The realm rail, as a native tree.
 *
 * Exactly the facts the webview used to draw down the side of its own panel — the topology and
 * realm this window composed, what loaded from where, and the facilities this page holds. None of
 * it was ever editor content: it describes the window, it is true whatever file is open, and a
 * sidebar is where VS Code puts that kind of thing. Drawing it inside the editor area meant the
 * custom editor was showing something other than the subject, which is what the owner's screenshot
 * caught.
 */
export interface HostNode {
  readonly label: string
  readonly detail?: string
  readonly icon?: string
  readonly children?: readonly HostNode[]
}

export class HostView implements vscode.TreeDataProvider<HostNode> {
  private readonly changed = new vscode.EventEmitter<HostNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  /** What the page answered for; undefined until a page has loaded and reported. */
  private facilities: FacilityReport | undefined

  constructor(
    private readonly host: VsCodeSubjectHost,
    private readonly topologyId: string,
    private readonly sources: () => readonly SelectedContentSource[],
    private readonly localizer: UiLocalizer,
  ) {}

  refresh(): void {
    this.changed.fire(undefined)
  }

  /** Called when a page reports its facilities, so the rail stops guessing and starts knowing. */
  report(facilities: FacilityReport | undefined): void {
    this.facilities = facilities
    this.changed.fire(undefined)
  }

  getTreeItem(node: HostNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children === undefined || node.children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Expanded,
    )
    if (node.detail !== undefined) {
      item.description = node.detail
      item.tooltip = `${node.label}\n${node.detail}`
    }
    if (node.icon !== undefined) item.iconPath = new vscode.ThemeIcon(node.icon)
    return item
  }

  getChildren(node?: HostNode): HostNode[] {
    if (node !== undefined) return [...(node.children ?? [])]
    const services = this.host.services
    const webviewFacilities = this.host.webview.profile.facilities
    /*
     * The isolation claim, drawn from the very object the running product hands the page — so this
     * row is a statement about this window, not a repetition of what the topology intends.
     */
    const isolated = !webviewFacilities.includes('editor.host-native')
    return [
      {
        label: this.localizer.text('sidebar.host'),
        icon: 'server-process',
        children: [
          { label: this.localizer.text('vscode.host.topology'), detail: this.topologyId },
          {
            label: this.localizer.text('vscode.host.extensionHost'),
            detail: services.host.profile.realmId,
          },
          {
            label: this.localizer.text('vscode.host.codecs'),
            detail: `${services.workers.profile.realmId} (${services.executionProfiles.join('/')})`,
          },
          {
            label: this.localizer.text('vscode.host.webview'),
            detail: this.host.webview.profile.realmId,
          },
          {
            label: this.localizer.text('vscode.host.inventoryDiagnostics'),
            detail: String(services.host.inventory.diagnostics.length),
          },
          {
            label: this.localizer.text('vscode.host.isolation'),
            detail: isolated
              ? this.localizer.text('vscode.host.isolationSafe')
              : this.localizer.text('vscode.host.isolationUnsafe'),
            icon: isolated ? 'shield' : 'warning',
          },
          {
            label: this.localizer.text('vscode.host.detectableTypes'),
            detail: String(this.host.supportedExtensions.length),
          },
        ],
      },
      {
        /*
         * Composed against honoured. Before a page has loaded there is nothing to compare, and the
         * rail says the composed set and no more — inventing an observation would be the exact
         * imitation §1.5 forbids.
         */
        label: this.localizer.text('sidebar.facilities'),
        icon: 'list-unordered',
        children:
          this.facilities === undefined
            ? webviewFacilities.map(facility => ({
                label: facility,
                detail: this.localizer.text('vscode.host.facilitiesPending'),
              }))
            : [
                ...this.facilities.intended.map(facility => ({
                  label: facility,
                  detail: this.facilities?.observed.includes(facility)
                    ? this.localizer.text('vscode.host.facilityHonoured')
                    : this.localizer.text('vscode.host.facilityUnavailable'),
                  icon: this.facilities?.observed.includes(facility) ? 'pass' : 'warning',
                })),
                ...this.facilities.ungranted.map(facility => ({
                  label: facility,
                  detail: this.localizer.text('vscode.host.facilityUngranted'),
                  icon: 'circle-outline',
                })),
              ],
      },
      {
        label: this.localizer.text('vscode.host.sources'),
        icon: 'root-folder',
        children:
          this.sources().length === 0
            ? [
                {
                  label: this.localizer.text('vscode.host.noSelectedGame'),
                  detail: this.localizer.text('vscode.host.selectGameHint'),
                },
              ]
            : this.sources().map(source => ({
                label: source.displayName,
                detail: source.gameId,
                icon: 'folder-library',
              })),
      },
    ]
  }
}
