import { describe, expect, it } from 'vitest'

import { createSourceTree, type SourceTreeText } from '../src/source-tree.js'

const text: SourceTreeText = {
  workspace: 'Workspace',
  selectedInstallations: 'Selected installations',
  providerSources: 'Provider sources',
  connections: 'Connections',
  roots: 'Roots',
  noWorkspaceFolders: 'No workspace folders',
  noSelectedInstallations: 'No selected installations',
  providerUnavailable: 'Provider unavailable',
  connected: 'connected',
  selected: 'selected',
  mounted: 'mounted',
  mounting: 'mounting…',
  available: 'available',
  signIn: 'Sign in to Battle.net…',
  onlineUnavailable: 'Battle.net accounts are unavailable',
  myPublications: 'My published mods',
  publicCatalogue: 'Public mods',
  localFolders: 'Local folders',
}

const providerSnapshot = {
  label: 'Battle.net',
  regions: [{ id: 'us', label: 'Americas' }],
  connections: [{ id: 'account', accountId: 'example', label: 'Example account', region: 'us' }],
  roots: [
    { id: 'mine:account', label: 'Example account · US', region: 'us', kind: 'mine' as const },
    { id: 'public:us', label: 'Public mods · Americas', region: 'us', kind: 'public' as const },
    { id: 'local:cache', label: 'Battle.net cache', region: 'local', kind: 'local' as const },
  ],
}

const installation = {
  gameId: 'blizzard.starcraft2',
  displayName: 'StarCraft II',
  installPath: 'C:\\Games\\StarCraft II',
  normalizedPath: 'c:\\games\\starcraft ii',
}

describe('VS Code Sources tree', () => {
  /**
   * Everything about one title lives under that title.
   *
   * An installation and the publisher's online catalogue are two doors into the same game; listing
   * them as unrelated top-level sections made the reader hold that connection in their head.
   */
  it('groups the installation and the online provider under the game', () => {
    const tree = createSourceTree({
      workspaceFolders: [{ name: 'Test mod', uri: 'file:///C:/mods/Test.SC2Mod' }],
      selectedInstallations: [{ ...installation, version: '5.0.16.97563', buildName: 'SC2' }],
      mountedProviderRootIds: new Set(['public:us']),
      providerSnapshot,
      text,
    })

    expect(tree.map(node => node.id)).toEqual(['workspace', 'game'])
    expect(tree[0]?.children?.[0]).toMatchObject({
      kind: 'workspace',
      uri: 'file:///C:/mods/Test.SC2Mod',
    })

    const game = tree[1]
    expect(game?.label).toBe('StarCraft II')
    expect(game?.children?.map(node => node.id)).toEqual(['installations', 'provider'])
    expect(game?.children?.[0]?.children?.[0]).toMatchObject({
      kind: 'installation',
      normalizedPath: 'c:\\games\\starcraft ii',
      label: 'CASC: StarCraft II · 5.0.16.97563',
    })

    // Roots are grouped by what they answer: my publications, a region's public catalogue, and
    // folders on this machine are different questions.
    const provider = game?.children?.[1]
    expect(provider?.contextValue).toBe('modkitSource.provider')
    expect(provider?.children?.map(node => node.id)).toEqual([
      'provider:connections',
      'provider:mine',
      'provider:public',
      'provider:local',
    ])
    expect(provider?.children?.[0]?.children?.[0]).toMatchObject({
      kind: 'connection',
      description: 'us · connected',
      contextValue: 'modkitSource.connection',
    })
    expect(provider?.children?.[2]?.children?.[0]).toMatchObject({
      sourceId: 'public:us',
      description: 'us · mounted',
      contextValue: 'modkitSource.providerRoot.mounted',
    })
  })

  /**
   * Mount and unmount are one action per state, so the row carries which state it is in: a mount
   * in flight says so before its folder can list anything, and only then offers to cancel.
   */
  it('marks a mount in flight and marks a mounted installation', () => {
    const tree = createSourceTree({
      workspaceFolders: [],
      selectedInstallations: [installation],
      mountedProviderRootIds: new Set(),
      // The mounted set is derived from workspace folder URIs — forward slashes, original case —
      // while discovery reports backslashes and lowercase. They must still be the same install.
      mountedInstallationPaths: new Set(['C:/Games/StarCraft II']),
      mountingIds: new Set(['local:cache']),
      providerSnapshot,
      text,
    })

    const game = tree[1]
    expect(game?.children?.[0]?.children?.[0]).toMatchObject({
      description: 'blizzard.starcraft2 · mounted',
      contextValue: 'modkitSource.installation.mounted',
    })
    const local = game?.children?.[1]?.children?.find(node => node.id === 'provider:local')
    expect(local?.children?.[0]).toMatchObject({
      sourceId: 'local:cache',
      description: 'local · mounting…',
      icon: 'sync~spin',
      contextValue: 'modkitSource.localRoot.mounting',
    })
  })

  /**
   * A provider with no regions has no online half: the local folders still work, but offering
   * «sign in» would send the reader into a dialog that can only fail.
   */
  it('says the online provider is missing instead of offering a sign-in that cannot work', () => {
    const tree = createSourceTree({
      workspaceFolders: [],
      selectedInstallations: [installation],
      mountedProviderRootIds: new Set(),
      providerSnapshot: { ...providerSnapshot, connections: [], regions: [] },
      text,
    })

    const connections = tree[1]?.children?.[1]?.children?.[0]
    expect(connections?.children?.[0]).toMatchObject({
      id: 'provider:offline',
      label: 'Battle.net accounts are unavailable',
    })
  })

  /** With no account connected, the Connections list is where signing in is offered. */
  it('offers sign-in inside Connections when no account is connected', () => {
    const tree = createSourceTree({
      workspaceFolders: [],
      selectedInstallations: [installation],
      mountedProviderRootIds: new Set(),
      providerSnapshot: { ...providerSnapshot, connections: [] },
      text,
    })

    const connections = tree[1]?.children?.[1]?.children?.[0]
    expect(connections?.id).toBe('provider:connections')
    expect(connections?.contextValue).toBe('modkitSource.connections')
    expect(connections?.children?.[0]).toMatchObject({
      id: 'provider:sign-in',
      label: 'Sign in to Battle.net…',
      contextValue: 'modkitSource.signIn',
    })
  })

  it('keeps unavailable authorities visible with actionable notice rows', () => {
    const tree = createSourceTree({
      workspaceFolders: [],
      selectedInstallations: [],
      mountedProviderRootIds: new Set(),
      providerProblem: 'runtime is not configured',
      text,
    })

    expect(tree[0]?.children?.[0]).toMatchObject({ kind: 'notice', id: 'workspace:none' })
    const game = tree[1]
    // Without an installation the provider still names the section.
    expect(game?.label).toBe('Provider sources')
    expect(game?.children?.[0]?.children?.[0]).toMatchObject({
      kind: 'notice',
      id: 'installations:none',
    })
    expect(game?.children?.[1]?.children?.[0]).toMatchObject({
      kind: 'notice',
      id: 'provider:unavailable',
      description: 'runtime is not configured',
    })
  })
})
