/** The Sources tree view. */
import { existsSync } from 'node:fs'
import * as vscode from 'vscode'
import { type ContentSources } from '@modkit/vfs/content-sources'
import { type UiLocalizer } from '@modkit/ui/localization'

import { type SelectedContentSource } from './workbench-workflows.js'
import { createSourceTree, type SourceTreeNode } from './source-tree.js'

/** The native, persistent view over the source authorities already used by the host. */
export class SourcesView implements vscode.TreeDataProvider<SourceTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SourceTreeNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  private providerState:
    | Promise<{
        readonly snapshot?: Awaited<ReturnType<ContentSources['snapshot']>>
        readonly problem?: string
      }>
    | undefined

  constructor(
    private readonly workspaceFolders: () => readonly {
      readonly name: string
      readonly uri: string
    }[],
    private readonly selectedInstallations: () => readonly SelectedContentSource[],
    private readonly mountedProviderRootIds: () => ReadonlySet<string>,
    private readonly providerSnapshot: () => Promise<
      Awaited<ReturnType<ContentSources['snapshot']>>
    >,
    private readonly localizer: UiLocalizer,
    private readonly mountedInstallationPaths: () => ReadonlySet<string> = () => new Set(),
    private readonly mountingIds: () => ReadonlySet<string> = () => new Set(),
    private readonly knownConnections: () => readonly {
      readonly region: string
      readonly accountId: string
    }[] = () => [],
    private readonly listPublications: (sourceId: string) => Promise<
      readonly {
        readonly name: string
        readonly cached: boolean
        /** Present only when this window holds a working copy of that publication. */
        readonly copy?: 'clean' | 'edited'
      }[]
    > = async () => [],
    private readonly rememberedRoots: () => readonly {
      readonly id: string
      readonly label: string
      readonly region: string
    }[] = () => [],
    private readonly storage: () => Promise<ReadonlyMap<string, string>> = async () => new Map(),
  ) {}

  dispose(): void {
    this.changed.dispose()
  }

  refresh(): void {
    this.providerState = undefined
    this.changed.fire(undefined)
  }

  private loadProviderState(): Promise<{
    readonly snapshot?: Awaited<ReturnType<ContentSources['snapshot']>>
    readonly problem?: string
  }> {
    this.providerState ??= this.providerSnapshot().then(
      snapshot => ({ snapshot }),
      error => ({ problem: error instanceof Error ? error.message : String(error) }),
    )
    return this.providerState
  }

  getTreeItem(node: SourceTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.kind === 'provider-root'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : node.children === undefined
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Expanded,
    )
    item.id = node.id
    // A publication is a file: the icon theme picks its icon by the name its URI carries.
    item.iconPath =
      node.kind === 'publication' && node.resourceUri !== undefined
        ? vscode.ThemeIcon.File
        : new vscode.ThemeIcon(node.icon)
    // The host decorates by URI, which is what greys a row that is not connected or not downloaded.
    if (node.resourceUri !== undefined) item.resourceUri = vscode.Uri.parse(node.resourceUri)
    if (node.contextValue !== undefined) item.contextValue = node.contextValue
    if (node.description !== undefined) item.description = node.description
    item.tooltip = node.tooltip ?? node.description ?? node.label
    if (node.kind === 'publication') {
      item.collapsibleState = vscode.TreeItemCollapsibleState.None
      item.command = {
        command: node.cached === true ? 'modkit.sources.revealLocal' : 'modkit.sources.download',
        title: this.localizer.text(
          node.cached === true ? 'vscode.sources.reveal' : 'vscode.sources.download',
        ),
        arguments: [node],
      }
    } else if (node.offlineAccount !== undefined) {
      // The row that says the account is not connected is the row that connects it.
      item.command = {
        command: 'modkit.sources.signIn',
        title: this.localizer.text('vscode.sources.signIn'),
        arguments: [node],
      }
    } else if (node.kind === 'provider-root') {
      item.command = {
        command: 'modkit.sources.open',
        title: this.localizer.text('vscode.sources.open'),
        arguments: [node],
      }
    } else if (node.kind === 'installation' && node.uri !== undefined) {
      item.command = {
        command: 'modkit.sources.openInstallation',
        title: this.localizer.text('vscode.sources.open'),
        arguments: [node],
      }
    } else if (node.kind === 'workspace' && node.uri !== undefined) {
      item.command = {
        command: 'revealInExplorer',
        title: this.localizer.text('vscode.sources.reveal'),
        arguments: [vscode.Uri.parse(node.uri)],
      }
    } else if (node.id === 'provider:sign-in') {
      // The row that says there is no account is the row that adds one.
      item.command = {
        command: 'modkit.sources.signIn',
        title: this.localizer.text('vscode.sources.signIn'),
      }
    } else if (node.id === 'provider:unavailable') {
      item.command = {
        command: 'modkit.contentSources',
        title: this.localizer.text('vscode.sources.manage'),
      }
    } else if (node.id === 'installations:none') {
      item.command = {
        command: 'modkit.selectGameInstallation',
        title: this.localizer.text('vscode.game.selectInstallation'),
      }
    }
    return item
  }

  async getChildren(node?: SourceTreeNode): Promise<SourceTreeNode[]> {
    /*
     * A root's children are the publications it carries, read through the provider so the row can
     * say whether each one is already downloaded. The catalogue itself is held by the provider and
     * only re-read on refresh, so expanding a root costs nothing.
     */
    if (node?.kind === 'provider-root' && node.sourceId !== undefined) {
      const sourceId = node.sourceId
      const rows = await this.listPublications(sourceId).catch(() => [])
      return rows.map(row =>
        Object.freeze({
          kind: 'publication' as const,
          id: `publication:${sourceId}:${row.name}`,
          label: row.name,
          // A working copy is the most useful thing the row can say, so it takes the icon. The
          // context value stays `cached`/`notCached`: the menus are keyed on exactly those two,
          // and a third value would silently take every button off an edited row.
          icon: row.copy === 'edited' ? 'edit' : row.cached ? 'package' : 'cloud',
          ...(row.copy === undefined
            ? {}
            : {
                description: this.localizer.text(
                  row.copy === 'edited' ? 'vscode.sources.copyEdited' : 'vscode.sources.copyClean',
                ),
              }),
          contextValue: `modkitSource.publication.${row.cached ? 'cached' : 'notCached'}`,
          sourceId,
          cached: row.cached,
          resourceUri: `modkit-source://battlenet/${encodeURIComponent(sourceId)}/${encodeURIComponent(row.name)}`,
          normalizedPath: row.name,
        }),
      )
    }
    if (node !== undefined) return [...(node.children ?? [])]
    const provider = await this.loadProviderState()
    return [
      ...createSourceTree({
        workspaceFolders: this.workspaceFolders(),
        selectedInstallations: this.selectedInstallations(),
        missingInstallationPaths: new Set(
          this.selectedInstallations()
            .filter(source => !existsSync(source.installPath))
            .map(source => source.normalizedPath),
        ),
        mountedProviderRootIds: this.mountedProviderRootIds(),
        mountedInstallationPaths: this.mountedInstallationPaths(),
        mountingIds: this.mountingIds(),
        knownConnections: this.knownConnections(),
        rememberedRoots: this.rememberedRoots(),
        storage: await this.storage(),
        ...(provider.snapshot === undefined ? {} : { providerSnapshot: provider.snapshot }),
        ...(provider.problem === undefined ? {} : { providerProblem: provider.problem }),
        text: {
          workspace: this.localizer.text('vscode.sources.workspace'),
          selectedInstallations: this.localizer.text('vscode.sources.selectedInstallations'),
          providerSources: this.localizer.text('vscode.sources.providerSources'),
          games: this.localizer.text('vscode.sources.games'),
          connections: this.localizer.text('vscode.sources.connections'),
          roots: this.localizer.text('vscode.sources.roots'),
          noWorkspaceFolders: this.localizer.text('vscode.sources.noWorkspaceFolders'),
          noSelectedInstallations: this.localizer.text('vscode.host.noSelectedGame'),
          providerUnavailable: this.localizer.text('vscode.sources.providerUnavailable'),
          connected: this.localizer.text('vscode.sources.connected'),
          selected: this.localizer.text('vscode.sources.selected'),
          missing: this.localizer.text('vscode.sources.missing'),
          mounted: this.localizer.text('vscode.sources.mounted'),
          mounting: this.localizer.text('vscode.sources.mounting'),
          available: this.localizer.text('vscode.sources.available'),
          signIn: this.localizer.text('vscode.sources.signIn'),
          disconnected: this.localizer.text('vscode.sources.disconnected'),
          stale: this.localizer.text('vscode.sources.stale'),
          onlineUnavailable: this.localizer.text('vscode.sources.onlineUnavailable'),
          myPublications: this.localizer.text('vscode.sources.myPublications'),
          publicCatalogue: this.localizer.text('vscode.sources.publicCatalogue'),
          localFolders: this.localizer.text('vscode.sources.localFolders'),
        },
      }),
    ]
  }
}
