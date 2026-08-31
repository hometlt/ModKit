/**
 * The VS Code settings surface, over structural fakes.
 *
 * There is no editor here, so what is proven is exactly what does not need one:
 *
 *  - the pure setting rewrites (`modkit.extensions`, `modkit.disabledContributions`);
 *  - that the webview's request actually reaches a configuration write and comes back with the
 *    state after it — the fake `VsCodeConfigurationPort` stands in for
 *    `vscode.workspace.getConfiguration().update`, which is a structural match, not the editor;
 *  - that `modkit.disabledContributions` reaches composition and a disabled codec's subject answers
 *    unresolved **through the real open path** — `createVsCodeSubjectHost` composing the real
 *    catalog, the real inventory, the real resolution;
 *  - that a junk folder is reported with the loader's own code and message.
 *
 * What still needs a real editor: that `vscode.workspace.getConfiguration('modkit').update` writes
 * to the settings file the user sees, that `showOpenDialog` returns a folder, that the reload
 * prompt appears, and that the webview's DOM renders inside a real webview. Those are adapter
 * lines in `./src/extension.ts`, deliberately kept to one file for that reason.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ShellRequest, ShellSettingsView } from '../src/bridge.js'
import {
  configuredDisabledContributions,
  configuredDisabledExtensions,
  describeConfiguredExtensions,
  withContributionDisabled,
  withContributionsDisabled,
  withExtensionDisabled,
  withExtensionEnabled,
  withExtensionRoot,
  withoutExtension,
} from '../src/extension-roots.js'
import { openFileArtifactSource } from '@modkit/host/node'

import { createVsCodeSubjectHost, type VsCodeConfigurationPort } from '../src/host.js'
import type { WebviewChannel } from '../src/bridge.js'
import { createBridge } from '../src/bridge.js'
import type { ExtensionCardResourceTarget } from '../src/extension-cards.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
/** The directory the first-party catalog lives in; discovery scans its children, not itself. */
const commonExtensions = join(repositoryRoot, 'extensions')
const PNG_CODEC = 'modkit/image-png'

const extensionFolders = ((): { readonly ok: string; readonly junk: string } => {
  const target = join(mkdtempSync(join(tmpdir(), 'modkit-vscode-extfix-')), 'folders')
  execFileSync(
    process.execPath,
    [
      join(repositoryRoot, 'apps', 'electron', 'test', 'fixtures', 'build-extension-folders.mjs'),
      target,
    ],
    { stdio: 'pipe' },
  )
  return { ok: join(target, 'ok'), junk: join(target, 'junk') }
})()

// ---------------------------------------------------------------------------------------------
// the pure setting rewrites

describe('rewriting modkit.extensions', () => {
  it('appends a folder as a plain string and leaves everything the user authored alone', () => {
    const before = ['./one', { path: './two', id: 'org.example/two', enabled: false }]
    const { next, added } = withExtensionRoot(before, '/three', { caseSensitive: true })
    expect(added).toBe(true)
    expect(next).toEqual([...before, '/three'])
  })

  it('refuses a folder already there, in either literal form', () => {
    expect(withExtensionRoot(['/one'], '/one', { caseSensitive: true }).added).toBe(false)
    expect(withExtensionRoot([{ path: '/one' }], '/one', { caseSensitive: true }).added).toBe(false)
    // case folding is asked for, never guessed: the same path in another case is one folder on
    // Windows and two on Linux, and the caller is the side that knows which
    expect(withExtensionRoot(['/One'], '/one', { caseSensitive: false }).added).toBe(false)
    expect(withExtensionRoot(['/One'], '/one', { caseSensitive: true }).added).toBe(true)
  })

  it('turns a bare string into an entry object only when it has to record "off"', () => {
    expect(withExtensionEnabled(['./one', './two'], 0, false).next).toEqual([
      { path: './one', enabled: false },
      './two',
    ])
    expect(withExtensionEnabled([{ path: './one', id: 'org.example/one' }], 0, false).next).toEqual(
      [{ path: './one', id: 'org.example/one', enabled: false }],
    )
    expect(withExtensionEnabled(['./one'], 4, false).changed).toBe(false)
  })

  it('removes one entry by position and keeps the rest in order', () => {
    expect(withoutExtension(['a', 'b', 'c'], 1).next).toEqual(['a', 'c'])
    expect(withoutExtension(['a'], 9).changed).toBe(false)
  })

  it('describes the setting with the positions the writers name', () => {
    const views = describeConfiguredExtensions([
      './one',
      { path: './two', id: 'org.example/two', enabled: false },
      { nonsense: true },
      42,
    ])
    expect(views).toEqual([
      { index: 0, path: './one', enabled: true },
      { index: 1, path: './two', id: 'org.example/two', enabled: false },
    ])
  })
})

describe('rewriting modkit.disabledContributions', () => {
  it('normalizes a hand-edited list into a sorted set and says what it dropped', () => {
    const { ids, problems } = configuredDisabledContributions([
      'b',
      'a',
      'a',
      'org.modkitx/image-png',
      'modkit/image-png',
      3,
      ' ',
    ])
    expect(ids).toEqual(['a', 'b', 'modkit/image-png'])
    expect(problems).toHaveLength(2)
  })

  it('adds and removes one id, and reports when nothing changed', () => {
    expect(withContributionDisabled(['a'], 'b', true).next).toEqual(['a', 'b'])
    expect(withContributionDisabled(['a', 'b'], 'a', false).next).toEqual(['b'])
    expect(withContributionDisabled(['org.modkitx/image-png'], 'modkit/image-png', true)).toEqual({
      next: ['modkit/image-png'],
      changed: false,
    })
    expect(withContributionDisabled(['a'], 'a', true).changed).toBe(false)
    expect(withContributionDisabled(undefined, 'a', false).changed).toBe(false)
  })

  it('switches all codec ids from one extension with one normalized update', () => {
    expect(withContributionsDisabled(['other', 'codec-b'], ['codec-a', 'codec-b'], true)).toEqual({
      next: ['codec-a', 'codec-b', 'other'],
      changed: true,
    })
    expect(
      withContributionsDisabled(['codec-a', 'codec-b', 'other'], ['codec-a', 'codec-b'], false),
    ).toEqual({ next: ['other'], changed: true })
    expect(withContributionsDisabled(['other'], [], true).changed).toBe(false)
  })
})

describe('rewriting modkit.disabledExtensions', () => {
  it('uses extension coordinates as an independent sorted set', () => {
    expect(
      configuredDisabledExtensions(['org.example/z', 'org.example/a', 'org.modkitx/images']).ids,
    ).toEqual(['modkit/images', 'org.example/a', 'org.example/z'])
    expect(withExtensionDisabled([], 'org.example/demo', true).next).toEqual(['org.example/demo'])
  })
})

// ---------------------------------------------------------------------------------------------
// the shell channel, end to end over a fake editor

/** A `VsCodeConfigurationPort` that records writes instead of reaching a real editor. */
function fakeConfiguration(initial: {
  extensions?: unknown
  disabled?: unknown
  disabledExtensions?: unknown
  folder?: string
}): VsCodeConfigurationPort & { readonly writes: { key: string; value: readonly unknown[] }[] } {
  let extensions = initial.extensions
  let disabled = initial.disabled
  let disabledExtensions = initial.disabledExtensions
  const writes: { key: string; value: readonly unknown[] }[] = []
  return {
    writes,
    scope: 'workspace',
    readExtensions: () => extensions,
    readDisabledContributions: () => disabled,
    readDisabledExtensions: () => disabledExtensions,
    async write(key, value) {
      writes.push({ key, value: [...value] })
      if (key === 'extensions') extensions = [...value]
      else if (key === 'disabledExtensions') disabledExtensions = [...value]
      else disabled = [...value]
    },
    async pickFolder() {
      return initial.folder
    },
  }
}

/** The two ends of one webview channel, wired to each other in memory. */
function linkedChannels(): { readonly host: WebviewChannel; readonly page: WebviewChannel } {
  const hostSinks = new Set<(message: unknown) => void>()
  const pageSinks = new Set<(message: unknown) => void>()
  return {
    host: {
      post: message => {
        for (const sink of [...pageSinks]) sink(message)
      },
      onMessage: handler => {
        hostSinks.add(handler)
        return () => hostSinks.delete(handler)
      },
    },
    page: {
      post: message => {
        for (const sink of [...hostSinks]) sink(message)
      },
      onMessage: handler => {
        pageSinks.add(handler)
        return () => pageSinks.delete(handler)
      },
    },
  }
}

async function servedHost(options: {
  readonly configuration?: VsCodeConfigurationPort
  readonly configuredExtensions?: unknown
  readonly configuredDisabledContributions?: unknown
  readonly linkableExtensionRoots?: ReadonlyMap<string, string>
  readonly managedPackageIds?: ReadonlySet<string>
  readonly setManagedPackageEnabled?: (id: string, enabled: boolean) => Promise<void>
  readonly extensionCardResources?: ReadonlyMap<string, readonly ExtensionCardResourceTarget[]>
  readonly openExtensionCardResource?: (resource: ExtensionCardResourceTarget) => Promise<void>
}): Promise<{
  ask(request: ShellRequest): Promise<unknown>
  readonly host: Awaited<ReturnType<typeof createVsCodeSubjectHost>>
  close(): Promise<void>
}> {
  const host = await createVsCodeSubjectHost({
    catalogCandidates: [commonExtensions],
    ...(options.configuredExtensions === undefined
      ? {}
      : { configuredExtensions: options.configuredExtensions }),
    ...(options.configuredDisabledContributions === undefined
      ? {}
      : { configuredDisabledContributions: options.configuredDisabledContributions }),
  })
  const channels = linkedChannels()
  const served = host.serve({
    channel: channels.host,
    session: 'test-session',
    roots: () => [],
    ...(options.linkableExtensionRoots === undefined
      ? {}
      : { linkableExtensionRoots: options.linkableExtensionRoots }),
    ...(options.managedPackageIds === undefined
      ? {}
      : { managedPackageIds: options.managedPackageIds }),
    ...(options.setManagedPackageEnabled === undefined
      ? {}
      : { setManagedPackageEnabled: options.setManagedPackageEnabled }),
    ...(options.extensionCardResources === undefined
      ? {}
      : { extensionCardResources: options.extensionCardResources }),
    ...(options.openExtensionCardResource === undefined
      ? {}
      : { openExtensionCardResource: options.openExtensionCardResource }),
    ...(options.configuration === undefined ? {} : { configuration: options.configuration }),
  })
  const page = createBridge({ channel: channels.page, idPrefix: 'page' })
  return {
    ask: request => page.request(request),
    host,
    async close() {
      page.dispose()
      await served.close('test over')
    },
  }
}

describe('the webview asks, the extension side writes', () => {
  it('switches a contribution off through the channel and answers with the state after it', async () => {
    const configuration = fakeConfiguration({ extensions: [], disabled: [] })
    const served = await servedHost({ configuration })
    try {
      const before = (await served.ask({ op: 'settings' })) as ShellSettingsView
      expect(before.writable).toBe(true)
      expect(before.scope).toBe('workspace')
      expect(before.disabledContributions).toEqual([])
      expect(before.contributions.some(row => row.id === PNG_CODEC)).toBe(true)

      const answer = (await served.ask({
        op: 'set-contribution',
        id: PNG_CODEC,
        enabled: false,
      })) as { changed: boolean; message: string; view: ShellSettingsView }
      expect(answer.changed).toBe(true)
      expect(configuration.writes).toEqual([{ key: 'disabledContributions', value: [PNG_CODEC] }])
      expect(answer.view.disabledContributions).toEqual([PNG_CODEC])
      // the composition is the one built at activation, and the answer says so rather than
      // pretending the codec is already gone
      expect(answer.message).toContain('Reload the window')
      expect(answer.view.contributions.find(row => row.id === PNG_CODEC)?.disabled).toBe(false)

      // and back on again
      const restored = (await served.ask({
        op: 'set-contribution',
        id: PNG_CODEC,
        enabled: true,
      })) as { view: ShellSettingsView }
      expect(restored.view.disabledContributions).toEqual([])
    } finally {
      await served.close()
    }
  }, 60_000)

  it('switches every codec in an extension through one settings write', async () => {
    const configuration = fakeConfiguration({ extensions: [], disabled: ['unrelated'] })
    const served = await servedHost({ configuration })
    try {
      const disabled = (await served.ask({
        op: 'set-contributions',
        ids: [PNG_CODEC, 'org.example/second-codec'],
        enabled: false,
      })) as { changed: boolean; view: ShellSettingsView }
      expect(disabled.changed).toBe(true)
      expect(configuration.writes).toEqual([
        {
          key: 'disabledContributions',
          value: [PNG_CODEC, 'org.example/second-codec', 'unrelated'].sort(),
        },
      ])
      expect(disabled.view.disabledContributions).toEqual(
        [PNG_CODEC, 'org.example/second-codec', 'unrelated'].sort(),
      )

      await served.ask({
        op: 'set-contributions',
        ids: [PNG_CODEC, 'org.example/second-codec'],
        enabled: true,
      })
      expect(configuration.writes.at(-1)).toEqual({
        key: 'disabledContributions',
        value: ['unrelated'],
      })
    } finally {
      await served.close()
    }
  }, 60_000)

  it('refuses an empty bulk codec request without touching settings', async () => {
    const configuration = fakeConfiguration({ extensions: [], disabled: [] })
    const served = await servedHost({ configuration })
    try {
      const answer = (await served.ask({
        op: 'set-contributions',
        ids: [],
        enabled: false,
      })) as { changed: boolean; message: string }
      expect(answer.changed).toBe(false)
      expect(answer.message).toContain('empty or invalid')
      expect(configuration.writes).toEqual([])
    } finally {
      await served.close()
    }
  }, 60_000)

  it('adds the folder the dialog returned and refuses to add it twice', async () => {
    const configuration = fakeConfiguration({ extensions: [], folder: extensionFolders.ok })
    const served = await servedHost({ configuration })
    try {
      const added = (await served.ask({ op: 'add-extension-folder' })) as {
        changed: boolean
        message: string
        view: ShellSettingsView
      }
      expect(added.changed).toBe(true)
      expect(configuration.writes).toHaveLength(1)
      expect(added.view.configuredExtensions.map(entry => entry.path)).toEqual([
        expect.stringContaining('ok'),
      ])

      const again = (await served.ask({ op: 'add-extension-folder' })) as { changed: boolean }
      expect(again.changed).toBe(false)
      expect(configuration.writes).toHaveLength(1)
    } finally {
      await served.close()
    }
  }, 60_000)

  it('links only a host-discovered extension coordinate and never accepts a page path', async () => {
    const configuration = fakeConfiguration({ extensions: [] })
    const coordinate = 'org.example/demo'
    const served = await servedHost({
      configuration,
      linkableExtensionRoots: new Map([[coordinate, extensionFolders.ok]]),
    })
    try {
      const refused = (await served.ask({
        op: 'link-extension',
        id: 'org.example/not-discovered',
      })) as { changed: boolean }
      expect(refused.changed).toBe(false)
      expect(configuration.writes).toEqual([])

      const linked = (await served.ask({ op: 'link-extension', id: coordinate })) as {
        changed: boolean
      }
      expect(linked.changed).toBe(true)
      expect(configuration.writes).toEqual([{ key: 'extensions', value: [extensionFolders.ok] }])
    } finally {
      await served.close()
    }
  }, 60_000)

  it('mutates only a host-owned managed package id from a card', async () => {
    const calls: { id: string; enabled: boolean }[] = []
    const served = await servedHost({
      managedPackageIds: new Set(['org.example/package']),
      setManagedPackageEnabled: async (id, enabled) => {
        calls.push({ id, enabled })
      },
    })
    try {
      const refused = (await served.ask({
        op: 'set-managed-package',
        id: 'org.example/not-owned',
        enabled: true,
      })) as { changed: boolean }
      expect(refused.changed).toBe(false)
      expect(calls).toEqual([])

      const enabled = (await served.ask({
        op: 'set-managed-package',
        id: 'org.example/package',
        enabled: true,
      })) as { changed: boolean }
      expect(enabled.changed).toBe(true)
      expect(calls).toEqual([{ id: 'org.example/package', enabled: true }])
    } finally {
      await served.close()
    }
  }, 60_000)

  it('opens only an exact source or license resource registered for this extension-card subject', async () => {
    const opened: ExtensionCardResourceTarget[] = []
    const subjectId = 'subject:org.example/demo'
    const source: ExtensionCardResourceTarget = {
      id: 'source',
      role: 'source',
      kind: 'folder',
      target: extensionFolders.ok,
    }
    const license: ExtensionCardResourceTarget = {
      id: 'license-0',
      role: 'license',
      kind: 'file',
      target: join(extensionFolders.ok, 'LICENSE'),
    }
    const served = await servedHost({
      extensionCardResources: new Map([[subjectId, [source, license]]]),
      openExtensionCardResource: async resource => {
        opened.push(resource)
      },
    })
    try {
      const refused = (await served.ask({
        op: 'open-extension-resource',
        subjectId,
        resourceId: 'C:/not-a-resource',
        role: 'source',
      })) as { opened: boolean }
      expect(refused.opened).toBe(false)
      const wrongRole = (await served.ask({
        op: 'open-extension-resource',
        subjectId,
        resourceId: source.id,
        role: 'license',
      })) as { opened: boolean }
      expect(wrongRole.opened).toBe(false)
      expect(opened).toEqual([])

      const sourceOpened = (await served.ask({
        op: 'open-extension-resource',
        subjectId,
        resourceId: source.id,
        role: 'source',
      })) as { opened: boolean }
      const licenseOpened = (await served.ask({
        op: 'open-extension-resource',
        subjectId,
        resourceId: license.id,
        role: 'license',
      })) as { opened: boolean }
      expect(sourceOpened.opened).toBe(true)
      expect(licenseOpened.opened).toBe(true)
      expect(opened).toEqual([source, license])
    } finally {
      await served.close()
    }
  }, 60_000)

  it('switches one configured entry off and removes another, by position', async () => {
    const configuration = fakeConfiguration({ extensions: ['./one', './two'] })
    const served = await servedHost({ configuration })
    try {
      await served.ask({ op: 'set-extension', index: 0, enabled: false })
      expect(configuration.writes.at(-1)?.value).toEqual([
        { path: './one', enabled: false },
        './two',
      ])
      const removed = (await served.ask({ op: 'remove-extension', index: 1 })) as {
        view: ShellSettingsView
      }
      expect(configuration.writes.at(-1)?.value).toEqual([{ path: './one', enabled: false }])
      expect(removed.view.configuredExtensions.map(entry => entry.path)).toEqual(['./one'])
    } finally {
      await served.close()
    }
  }, 60_000)

  it('draws no switch and writes nothing when the window cannot configure', async () => {
    const served = await servedHost({})
    try {
      const view = (await served.ask({ op: 'settings' })) as ShellSettingsView
      expect(view.writable).toBe(false)
      const refused = (await served.ask({
        op: 'set-contribution',
        id: PNG_CODEC,
        enabled: false,
      })) as { changed: boolean; message: string }
      expect(refused.changed).toBe(false)
      expect(refused.message).toContain('Settings UI')
    } finally {
      await served.close()
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------
// the setting reaching composition

describe('modkit.disabledContributions reaches the real open path', () => {
  it('a switched-off codec stays listed, loses activation, and its subject answers unresolved', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'modkit-vscode-open-'))
    const png = join(scratch, 'sample.png')
    // a 1x1 PNG: enough that the codec would claim it if it were allowed to
    writeFileSync(
      png,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    )

    const enabled = await createVsCodeSubjectHost({ catalogCandidates: [commonExtensions] })
    const disabled = await createVsCodeSubjectHost({
      catalogCandidates: [commonExtensions],
      configuredDisabledContributions: [PNG_CODEC],
    })

    // the switch is in the composition, not in a filter the page applies
    expect(disabled.extensions.disabledContributions).toEqual([PNG_CODEC])
    const row = disabled.contributions.find(item => item.id === PNG_CODEC)
    if (row === undefined) throw new Error('the disabled contribution vanished from the inventory')
    expect(row).toMatchObject({ disabled: true, activationEligible: false })
    expect(enabled.contributions.find(item => item.id === PNG_CODEC)?.disabled).toBe(false)

    // …and the real open path agrees: with the codec on it resolves, with it off nothing claims it
    const budget = {
      maxInputBytes: 1_000_000n,
      maxDepth: 64,
      maxNodes: 10_000,
      maxScalarBytes: 1_000_000,
      maxDiagnostics: 100,
    } as const
    const openPng = async (
      host: Awaited<ReturnType<typeof createVsCodeSubjectHost>>,
    ): ReturnType<typeof host.services.open> =>
      host.services.open({
        // the host's own revision-checked adapter, so this is the production open path
        source: await openFileArtifactSource(png),
        path: png,
        intent: 'full',
        grant: { id: 'test', classes: ['read-source'] },
        budget,
      })

    const opened = await openPng(enabled)
    expect(opened.state).toBe('opened')
    if (opened.state === 'opened') {
      expect(opened.selected.contributionId).toBe(PNG_CODEC)
      await opened.session.dispose()
    }

    const refused = await openPng(disabled)
    expect(refused.state).toBe('unresolved')
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// a junk folder

describe('a folder that is not an extension', () => {
  it('is reported with the loader’s own code and message, and stops nothing else', async () => {
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [commonExtensions],
      configuredExtensions: [extensionFolders.junk, extensionFolders.ok],
    })
    expect(host.extensions.installed).toEqual(['org.example/fixture-thirdparty'])
    expect(host.extensions.failures).toHaveLength(1)
    expect(host.extensions.failures[0]).toMatchObject({
      code: 'x3.host/extension-not-an-extension',
    })
    expect(host.extensions.failures[0]?.message).toContain('modkit.extension.json')

    // and the settings view shows that failure against the entry the user wrote
    const configuration = fakeConfiguration({
      extensions: [extensionFolders.junk, extensionFolders.ok],
    })
    const channels = linkedChannels()
    const served = host.serve({
      channel: channels.host,
      session: 'junk-session',
      roots: () => [],
      configuration,
    })
    const page = createBridge({ channel: channels.page, idPrefix: 'page' })
    try {
      const view = (await page.request({ op: 'settings' })) as ShellSettingsView
      const junkRow = view.configuredExtensions.find(entry => entry.path === extensionFolders.junk)
      expect(junkRow).toMatchObject({ state: 'failed', code: 'x3.host/extension-not-an-extension' })
      expect(
        view.configuredExtensions.find(entry => entry.path === extensionFolders.ok),
      ).toMatchObject({ state: 'loaded' })
    } finally {
      page.dispose()
      await served.close('junk probe over')
    }
  }, 120_000)
})
