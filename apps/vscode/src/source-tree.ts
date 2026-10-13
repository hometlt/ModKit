/**
 * Format-neutral model for the native Sources view.
 *
 * The view joins three existing source authorities without copying their state: VS Code workspace
 * folders, game installations selected through extension discovery, and roots exposed by the
 * configured `ContentSources` provider. The extension-host adapter only turns these rows into
 * `TreeItem`s and commands.
 */
import { contentSourceRootServes } from '@modkit/host'
import type { ContentSourceModuleInfo, ContentSourceSnapshot } from '@modkit/vfs/content-sources'

import type { SelectedContentSource } from './workbench-workflows.js'

export interface SourceTreeWorkspaceFolder {
  readonly name: string
  readonly uri: string
}

export interface SourceTreeText {
  readonly workspace: string
  readonly selectedInstallations: string
  readonly providerSources: string
  /** The group's name when installations of several games are selected. */
  readonly games: string
  readonly connections: string
  readonly roots: string
  readonly noWorkspaceFolders: string
  readonly noSelectedInstallations: string
  readonly providerUnavailable: string
  readonly connected: string
  readonly selected: string
  /** A selected installation whose folder is gone (moved or deleted). */
  readonly missing: string
  readonly mounted: string
  readonly mounting: string
  readonly available: string
  readonly signIn: string
  readonly disconnected: string
  readonly stale: string
  readonly onlineUnavailable: string
  readonly myPublications: string
  readonly publicCatalogue: string
  readonly localFolders: string
  /** The group of games whose sources start when first needed. */
  readonly pendingModules: string
  /** What such a game's row says: it starts on its own, or when selected. */
  readonly pendingModule: string
}

export type SourceTreeNodeKind =
  | 'group'
  | 'workspace'
  | 'installation'
  | 'connection'
  | 'provider-root'
  | 'publication'
  | 'pending-module'
  | 'notice'

export interface SourceTreeNode {
  readonly kind: SourceTreeNodeKind
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly tooltip?: string
  readonly icon: string
  readonly contextValue?: string
  readonly uri?: string
  readonly normalizedPath?: string
  readonly sourceId?: string
  /** A URI the host can decorate: it is what greys a row that is not connected or not downloaded. */
  readonly resourceUri?: string
  /** Publication rows only: whether the archive is already in the local cache. */
  readonly cached?: boolean
  /** An account this machine knows but is not connected to; selecting the row signs in. */
  readonly offlineAccount?: { readonly region: string; readonly accountId: string }
  /** Installation rows: the game whose sources read it, started before the installation opens. */
  readonly gameId?: string
  /** Pending-module rows: the extension whose content sources selecting the row starts. */
  readonly moduleId?: string
  readonly children?: readonly SourceTreeNode[]
}

export interface SourceTreeInput {
  readonly workspaceFolders: readonly SourceTreeWorkspaceFolder[]
  readonly selectedInstallations: readonly SelectedContentSource[]
  /** Normalized paths of selected installations whose folder no longer exists. */
  readonly missingInstallationPaths?: ReadonlySet<string>
  readonly mountedProviderRootIds: ReadonlySet<string>
  /** Normalized installation paths already mounted as a container folder in this window. */
  readonly mountedInstallationPaths?: ReadonlySet<string>
  /** Roots whose mount is in flight, so the row says so before its folder can list anything. */
  readonly mountingIds?: ReadonlySet<string>
  /** Accounts this machine last had open. One that is not connected is listed as a way back in. */
  readonly knownConnections?: readonly { readonly region: string; readonly accountId: string }[]
  /** What each account has left to publish into, ready to read, keyed by source id. */
  readonly storage?: ReadonlyMap<string, string>
  /** Accounts whose catalogue was kept from an earlier session, listed until one is refreshed. */
  readonly rememberedRoots?: readonly {
    readonly id: string
    readonly label: string
    readonly region: string
  }[]
  readonly providerSnapshot?: ContentSourceSnapshot
  readonly providerProblem?: string
  /** Content-source modules that start when first needed and have not yet. */
  readonly pendingModules?: readonly ContentSourceModuleInfo[]
  readonly text: SourceTreeText
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/**
 * Compare two spellings of the same path.
 *
 * The mounted set is derived from workspace folder URIs and the installation list comes from game
 * discovery; both name the same directory but not with the same separators or case, and a mounted
 * installation that does not match simply never offers unmount.
 */
const samePath = (left: string, right: string): boolean =>
  left.replaceAll('\\', '/').toLowerCase() === right.replaceAll('\\', '/').toLowerCase()

const includesPath = (paths: ReadonlySet<string> | undefined, value: string): boolean => {
  if (paths === undefined) return false
  for (const path of paths) if (samePath(path, value)) return true
  return false
}

const notice = (id: string, label: string, detail?: string): SourceTreeNode =>
  Object.freeze({
    kind: 'notice',
    id,
    label,
    ...(detail === undefined ? {} : { description: detail, tooltip: detail }),
    icon: 'info',
    contextValue: 'modkitSource.notice',
  })

/** Build the complete Sources tree from live host state. */
export function createSourceTree(input: SourceTreeInput): readonly SourceTreeNode[] {
  const workspaceChildren = [...input.workspaceFolders]
    .sort((left, right) => compareText(left.name, right.name) || compareText(left.uri, right.uri))
    .map(folder =>
      Object.freeze({
        kind: 'workspace' as const,
        id: `workspace:${folder.uri}`,
        label: folder.name,
        description: 'workspace',
        tooltip: folder.uri,
        icon: 'folder',
        contextValue: 'modkitSource.workspace',
        uri: folder.uri,
      }),
    )

  const installationChildren = [...input.selectedInstallations]
    .sort(
      (left, right) =>
        compareText(left.displayName, right.displayName) ||
        compareText(left.normalizedPath, right.normalizedPath),
    )
    .map(source => {
      // an installation, of whichever game: what reads its storage is the provider's business; a
      // version that already names the game (BAR's «Beyond All Reason test-30891-…») stands alone
      const version = source.version
      const label =
        version === undefined
          ? source.displayName
          : version.startsWith(source.displayName)
            ? version
            : `${source.displayName} · ${version}`
      const build = [source.buildName, source.buildUid].filter(Boolean).join(' · ')
      const mounting =
        includesPath(input.mountingIds, source.normalizedPath) ||
        includesPath(input.mountingIds, source.installPath)
      // Opening an installation mounts the content-source root that reads its storage, when one
      // does (`storageOf`); that root being mounted is this installation being mounted.
      const servedBy = input.providerSnapshot?.roots.find(
        root =>
          contentSourceRootServes(root, source.installPath) ||
          contentSourceRootServes(root, source.normalizedPath),
      )
      const mounted =
        includesPath(input.mountedInstallationPaths, source.normalizedPath) ||
        includesPath(input.mountedInstallationPaths, source.installPath) ||
        (servedBy !== undefined && input.mountedProviderRootIds.has(servedBy.id))
      // a folder moved away (02.10: SC2 from C:Apps to F:GAMES) is said, not shown as chosen
      const missing = includesPath(input.missingInstallationPaths, source.normalizedPath)
      const state = mounting
        ? input.text.mounting
        : missing
          ? input.text.missing
          : mounted
            ? input.text.mounted
            : input.text.selected
      return Object.freeze({
        kind: 'installation' as const,
        id: `installation:${source.normalizedPath}`,
        label,
        description: `${source.gameId} · ${state}`,
        tooltip: build === '' ? source.installPath : `${source.installPath}\n${build}`,
        icon: mounting ? 'sync~spin' : missing ? 'warning' : 'database',
        contextValue: `modkitSource.installation${mounting ? '.mounting' : mounted ? '.mounted' : ''}`,
        uri: source.installPath,
        normalizedPath: source.normalizedPath,
        gameId: source.gameId,
      })
    })

  const providerChildren: SourceTreeNode[] = []
  if (input.providerSnapshot !== undefined) {
    const connectionChildren = [...input.providerSnapshot.connections]
      .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id))
      .map(connection =>
        Object.freeze({
          kind: 'connection' as const,
          id: `connection:${connection.id}`,
          label: connection.label,
          description: `${connection.region} · ${input.text.connected}`,
          tooltip: connection.accountId,
          icon: 'account',
          contextValue: 'modkitSource.connection',
        }),
      )
    /*
     * An account this machine knows but is not connected to is still an account: it is listed,
     * greyed, and selecting it signs back in. Without the row the reader has to remember which
     * account was theirs and find it again in a region list.
     */
    const connectedIds = new Set(input.providerSnapshot.connections.map(item => item.accountId))
    const offlineChildren = (input.knownConnections ?? [])
      .filter(item => !connectedIds.has(item.accountId))
      .sort((left, right) => compareText(left.accountId, right.accountId) || compareText(left.region, right.region))
      .map(item =>
        Object.freeze({
          kind: 'connection' as const,
          id: `connection:offline:${item.region}:${item.accountId}`,
          label: item.accountId,
          description: `${item.region} · ${input.text.disconnected}`,
          icon: 'account',
          contextValue: 'modkitSource.connection.offline',
          resourceUri: `modkit-account://${encodeURIComponent(item.region)}/${encodeURIComponent(item.accountId)}`,
          offlineAccount: item,
        }),
      )
    const accountChildren = [...connectionChildren, ...offlineChildren]
    providerChildren.push(
      Object.freeze({
        kind: 'group',
        id: 'provider:connections',
        label: input.text.connections,
        description: String(accountChildren.length),
        icon: 'plug',
        // Signing in belongs where the accounts are listed, and an empty list has to say how to
        // stop being empty: a toolbar action on a section nobody expanded is not an answer.
        contextValue: 'modkitSource.connections',
        children: Object.freeze(
          accountChildren.length > 0
            ? accountChildren
            : /*
               * A provider that reports no regions has no online half at all — the local folders
               * still work, but there is nothing to sign in to. Saying «sign in» there sends the
               * reader to a dialog that can only fail, so the row says what is actually missing.
               */
              (input.providerSnapshot.regions ?? []).length === 0
              ? [notice('provider:offline', input.text.onlineUnavailable)]
              : [
                  Object.freeze({
                    kind: 'notice' as const,
                    id: 'provider:sign-in',
                    label: input.text.signIn,
                    icon: 'sign-in',
                    contextValue: 'modkitSource.signIn',
                  }),
                ],
        ),
      }),
    )

    const rootChildren = [...input.providerSnapshot.roots]
      .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id))
      .map(root => {
        const mounting = input.mountingIds?.has(root.id) === true
        const mounted = input.mountedProviderRootIds.has(root.id)
        const state = mounting
          ? input.text.mounting
          : mounted
            ? input.text.mounted
            : input.text.available
        // What the account has left to publish into belongs on the row that publishes.
        const room = input.storage?.get(root.id)
        return Object.freeze({
          kind: 'provider-root' as const,
          id: `provider-root:${root.id}`,
          label: root.label,
          description: `${root.region} · ${state}${room === undefined ? '' : ` · ${room}`}`,
          tooltip: root.id,
          icon: mounting ? 'sync~spin' : mounted ? 'folder-opened' : 'cloud',
          // A mounted root carries its own context value so the view can offer unmount on exactly
          // the rows that are mounted, without a second state the menu would have to guess at.
          // A public catalogue is one server's, so its row carries actions the account roots do not.
          contextValue: `${root.kind === 'local' ? 'modkitSource.localRoot' : root.kind === 'public' ? 'modkitSource.publicRoot' : 'modkitSource.providerRoot'}${mounting ? '.mounting' : mounted ? '.mounted' : ''}`,
          sourceId: root.id,
        })
      })
    /*
     * Roots are grouped by what they are, not listed flat: an account's own publications, the
     * public catalogue of a region, and folders on this machine answer different questions, and a
     * reader looking for «my mods» should not have to read the kind out of a description.
     */
    const rootsByKind = new Map<string, SourceTreeNode[]>()
    for (const [index, root] of [...input.providerSnapshot.roots]
      .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id))
      .entries()) {
      const node = rootChildren[index]
      if (node === undefined) continue
      const bucket = rootsByKind.get(root.kind)
      if (bucket === undefined) rootsByKind.set(root.kind, [node])
      else bucket.push(node)
    }
    /*
     * An account this window has no connection for still owns the mods it owned: the row is listed
     * from what was kept, greyed, and refreshing it is what signs back in. Leaving it out would
     * make a workspace look as if the account's mods had gone.
     */
    const liveRootIds = new Set(input.providerSnapshot.roots.map(root => root.id))
    const offlineRoots = (input.rememberedRoots ?? [])
      .filter(root => !liveRootIds.has(root.id))
      .sort((left, right) => compareText(left.label, right.label))
      .map(root =>
        Object.freeze({
          kind: 'provider-root' as const,
          id: `provider-root:${root.id}`,
          label: root.label,
          description: `${root.region} · ${input.text.stale}`,
          tooltip: root.id,
          icon: 'cloud',
          contextValue: 'modkitSource.providerRoot.offline',
          sourceId: root.id,
          resourceUri: `modkit-account://${encodeURIComponent(root.region)}/${encodeURIComponent(root.id)}`,
        }),
      )
    if (offlineRoots.length > 0) {
      rootsByKind.set('mine', [...(rootsByKind.get('mine') ?? []), ...offlineRoots])
    }
    const rootGroups: readonly (readonly [string, string, string])[] = [
      ['mine', 'provider:mine', input.text.myPublications],
      ['public', 'provider:public', input.text.publicCatalogue],
      ['local', 'provider:local', input.text.localFolders],
    ]
    for (const [kind, id, label] of rootGroups) {
      const children = rootsByKind.get(kind)
      if (children === undefined || children.length === 0) continue
      providerChildren.push(
        Object.freeze({
          kind: 'group',
          id,
          label,
          description: String(children.length),
          icon: kind === 'local' ? 'folder-library' : kind === 'mine' ? 'account' : 'globe',
          children: Object.freeze(children),
        }),
      )
      rootsByKind.delete(kind)
    }
    const remaining = [...rootsByKind.values()].flat()
    if (remaining.length > 0) {
      providerChildren.push(
        Object.freeze({
          kind: 'group',
          id: 'provider:roots',
          label: input.text.roots,
          description: String(remaining.length),
          icon: 'database',
          children: Object.freeze(remaining),
        }),
      )
    }
    // Games whose sources wait for the window to need them; selecting one starts it now.
    const pendingModules = [...(input.pendingModules ?? [])]
      .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id))
      .map(module =>
        Object.freeze({
          kind: 'pending-module' as const,
          id: `pending-module:${module.id}`,
          label: module.label,
          description: input.text.pendingModule,
          tooltip: module.id,
          icon: 'debug-start',
          contextValue: 'modkitSource.pendingModule',
          moduleId: module.id,
        }),
      )
    if (pendingModules.length > 0) {
      providerChildren.push(
        Object.freeze({
          kind: 'group',
          id: 'provider:pending',
          label: input.text.pendingModules,
          description: String(pendingModules.length),
          icon: 'debug-pause',
          children: Object.freeze(pendingModules),
        }),
      )
    }
  } else {
    providerChildren.push(
      notice('provider:unavailable', input.text.providerUnavailable, input.providerProblem),
    )
  }

  /*
   * Everything that belongs to one game sits under that game.
   *
   * An installation and the publisher's online catalogue are two doors into the same title, and
   * listing them as unrelated top-level sections made the reader hold that connection in their
   * head. The game's own name comes from discovery; without an installation the provider still
   * names itself. Installations of several games share the group, which then names none of them
   * (v84: Dune 2000 listed under «StarCraft II»).
   */
  const gameLabel =
    new Set(input.selectedInstallations.map(source => source.gameId)).size > 1
      ? input.text.games
      : (input.selectedInstallations[0]?.displayName ??
        input.providerSnapshot?.label ??
        input.text.providerSources)
  const gameChildren: SourceTreeNode[] = [
    Object.freeze({
      kind: 'group',
      id: 'installations',
      label: input.text.selectedInstallations,
      description: String(installationChildren.length),
      icon: 'database',
      children: Object.freeze(
        installationChildren.length === 0
          ? [notice('installations:none', input.text.noSelectedInstallations)]
          : installationChildren,
      ),
    }),
    Object.freeze({
      kind: 'group',
      id: 'provider',
      label: input.providerSnapshot?.label ?? input.text.providerSources,
      description:
        input.providerSnapshot === undefined
          ? input.text.providerUnavailable
          : `${input.providerSnapshot.connections.length} ${input.text.connections.toLowerCase()}`,
      icon: 'remote-explorer',
      contextValue: 'modkitSource.provider',
      children: Object.freeze(providerChildren),
    }),
  ]

  return Object.freeze([
    Object.freeze({
      kind: 'group',
      id: 'workspace',
      label: input.text.workspace,
      description: String(workspaceChildren.length),
      icon: 'folder',
      children: Object.freeze(
        workspaceChildren.length === 0
          ? [notice('workspace:none', input.text.noWorkspaceFolders)]
          : workspaceChildren,
      ),
    }),
    Object.freeze({
      kind: 'group',
      id: 'game',
      label: gameLabel,
      description: String(installationChildren.length),
      icon: 'rocket',
      children: Object.freeze(gameChildren),
    }),
  ])
}
