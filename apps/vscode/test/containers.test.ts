/**
 * A member of an archive, opened as a subject — in the VS Code product thread, without VS Code.
 *
 * This is the wiring the block-9 smoke receipt recorded as an honest FAIL and the registry row
 * `block9/archive-entry-as-subject` carried as `partial`: the host has had `openNestedSubject`
 * since block 9, Electron reached it from its composition, and the VS Code product had no route to
 * it at all — its archive stage extracted an entry's bytes into a hex pane, which is a preview of a
 * member and not the member.
 *
 * Everything below the editor is production code: `createVsCodeSubjectHost` composes the same three
 * realms the extension host does, codecs run in real `worker_threads`, the container is opened
 * through `createPathSubjectOpener` with this window's roots, and the member is opened through the
 * host's own nested route. Two claims, and the second is the one that matters:
 *
 *  1. **The Explorer can be answered.** `stat`, `readDirectory` and `readFile` over the archive's
 *     own listing, including the directories a BIG never records.
 *  2. **A member is a subject.** A text member inside a ZIP opens with its own descriptor and
 *     arrives over the very subject RPC the webview speaks, so what is proved here is the
 *     product's generic route and not a private one or a product extension.
 *
 * The only thing not exercised is the editor itself; that is what `pnpm smoke:vscode` is for.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { CONTAINER_EXTRACT_OPERATION_ID, isModkitError } from '@modkit/core'
import {
  connectSubjectRpc,
  openSubject,
  type SubjectClientOpenResult,
  type SubjectServices,
} from '@modkit/host'
import {
  revisionId,
  type AssetSession,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkit/sdk'
import { rootSubject, serializeSubjectRef } from '@modkit/sdk/subjects'
import { proves } from '@modkit/testkit'
import { createBridge, type WebviewChannel } from '../src/bridge.js'
import {
  containerUriText,
  CONTAINER_SCHEME,
  joinContainer,
  parseContainerUriText,
  type ContainerNode,
} from '../src/container-uri.js'
import {
  CONTAINER_ENTRY_NOT_FOUND,
  createContainerRegistry,
  NOT_A_CONTAINER,
} from '../src/containers.js'
import {
  createVsCodeSubjectHost,
  subjectLabel,
  VSCODE_SUBJECT_CONTRIBUTION_ID,
  VSCODE_SUBJECT_SERVICES_URL,
  type VsCodeSubjectHost,
} from '../src/host.js'
import type { DirectoryProbe } from '../src/extension-roots.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(
  repositoryRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'mk2-synthetic',
)
const cleanup: (() => void | Promise<void>)[] = []

const containerBudget: ResourceBudget = {
  maxInputBytes: 16_000_000n,
  maxDepth: 32,
  maxNodes: 10_000,
  maxScalarBytes: 16_000_000,
  maxDiagnostics: 100,
}

afterAll(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

/** A tiny first-party catalog presented as if it shipped beside the extension. */
function catalogProbe(names: readonly string[]): DirectoryProbe {
  const common = join(repositoryRoot, 'extensions')
  const roots: Readonly<Record<string, string>> = {
    archives: join(common, 'archives'),
    'plain-text': join(common, 'data', 'plain-text'),
  }
  return {
    readDirectory: path => (path === 'catalog' ? [...names] : undefined),
    isFile: path => existsSync(path),
    readJson: path => {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown
      } catch {
        return undefined
      }
    },
    join: (...parts) =>
      parts[0] === 'catalog' && parts.length === 2
        ? (roots[parts[1] ?? ''] ?? join(common, parts[1] ?? ''))
        : join(...parts),
  }
}

/** The editor's single JSON duplex, as two ends that deliver asynchronously. */
function channelPair(): { readonly extension: WebviewChannel; readonly page: WebviewChannel } {
  const toPage = new Set<(message: unknown) => void>()
  const toExtension = new Set<(message: unknown) => void>()
  const deliver = (sinks: ReadonlySet<(message: unknown) => void>, message: unknown): void => {
    queueMicrotask(() => {
      for (const sink of [...sinks]) sink(message)
    })
  }
  return {
    extension: {
      post: message => deliver(toPage, message),
      onMessage: handler => {
        toExtension.add(handler)
        return () => toExtension.delete(handler)
      },
    },
    page: {
      post: message => deliver(toExtension, message),
      onMessage: handler => {
        toPage.add(handler)
        return () => toPage.delete(handler)
      },
    },
  }
}

interface Staged {
  readonly host: VsCodeSubjectHost
  readonly workspace: string
  readonly archive: string
  readonly plain: string
}

let staged: Promise<Staged> | undefined

/** One composition and one archive for the whole file; composing costs three realms and a worker. */
function stage(): Promise<Staged> {
  staged ??= (async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'modkit-vscode-containers-'))
    cleanup.push(() => rmSync(workspace, { recursive: true, force: true }))
    const archive = join(workspace, 'fixture.zip')
    writeFileSync(archive, readFileSync(join(syntheticDir, 'minimal.zip')))
    const plain = join(workspace, 'loose.txt')
    writeFileSync(plain, 'not a container')

    const host = await createVsCodeSubjectHost({
      catalogCandidates: ['catalog'],
      probe: catalogProbe(['archives', 'plain-text']),
    })
    expect(host.extensions.failures).toEqual([])
    return { host, workspace, archive, plain }
  })()
  return staged
}

/** A registry over the staged workspace; disposed with the suite. */
async function registryFor(roots?: () => readonly string[]) {
  const { host, workspace, archive, plain } = await stage()
  const containers = host.containers({ roots: roots ?? (() => [workspace]) })
  cleanup.push(() => containers.dispose())
  return { containers, workspace, archive, plain, host }
}

const codeOf = async (action: () => unknown): Promise<string> => {
  try {
    await action()
  } catch (error) {
    return isModkitError(error) ? error.code : `not-a-modkit-error: ${String(error)}`
  }
  return 'no error'
}

describe('the manifest opens the window for it', () => {
  /*
   * A saved workspace can hold a `modkit-container:` folder, and the Explorer will ask this
   * extension to list it before any command has been run. Without the activation event the request
   * arrives at an extension that is not running, and the folder shows as an error — so the event is
   * derived from the same authority document the commands are, and this is the assertion that says
   * the derivation happened.
   */
  it('activates on the container filesystem scheme and on both container commands', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { readonly activationEvents?: readonly string[] }
    expect(manifest.activationEvents).toContain(`onFileSystem:${CONTAINER_SCHEME}`)
    expect(manifest.activationEvents).toContain('onCommand:modkit.browseContainer')
    expect(manifest.activationEvents).toContain('onCommand:modkit.openArchiveEntry')
  })
})

describe('the Explorer can be answered from inside a container', () => {
  it('opens a granted directory only as a container namespace source', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'modkit-vscode-namespace-container-'))
    cleanup.push(() => rmSync(workspace, { recursive: true, force: true }))
    writeFileSync(join(workspace, 'Data.000'), 'physical namespace marker')

    const descriptor = {
      identity: { formatId: 'casc' },
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
      operations: [
        {
          id: CONTAINER_EXTRACT_OPERATION_ID,
          handlerId: 'extract',
          state: 'available',
          mutatesSource: false,
        },
      ],
    }
    const listedBytes = new TextEncoder().encode('namespace member')
    const lateMember = 'mods/core.sc2mod/base.sc2assets/assets/sounds/late.wav'
    let rootSourceId = ''
    const children = vi.fn(async (path: string) => {
      if (path === '') {
        return {
          items: [
            {
              id: 'mods',
              path: 'Mods',
              name: 'Mods',
              kind: 'directory' as const,
              revision: revisionId('provider-token:directory-container-root'),
            },
            {
              id: 'campaigns',
              path: 'Campaigns',
              name: 'Campaigns',
              kind: 'directory' as const,
              revision: revisionId('provider-token:directory-container-root'),
            },
          ],
        }
      }
      if (path.toLowerCase() === 'mods') {
        return {
          items: [
            {
              id: 'mods/core.sc2mod',
              path: 'Mods/core.sc2mod',
              name: 'core.sc2mod',
              kind: 'directory' as const,
              revision: revisionId('provider-token:directory-container-mod'),
            },
          ],
        }
      }
      return { items: [] }
    })
    const namespace: NamespaceEntrySource = {
      async list(prefix, page) {
        expect(page.limit).toBeLessThanOrEqual(256)
        if (prefix.toLowerCase() === 'mods/core.sc2mod') {
          const path = 'Mods/core.sc2mod/DocumentInfo'
          return {
            items: [
              {
                id: path,
                path,
                name: 'DocumentInfo',
                kind: 'file' as const,
                size: BigInt(listedBytes.byteLength),
                revision: revisionId('provider-token:directory-container-document-info'),
              },
            ],
          }
        }
        const path = 'member.dds'
        return {
          items: [
            {
              id: path,
              path,
              name: path.split('/').at(-1) ?? path,
              kind: 'file',
              size: BigInt(listedBytes.byteLength),
              revision: revisionId('provider-token:directory-container-member'),
            },
          ],
        }
      },
      children,
      async openEntry(entryId) {
        expect([lateMember, 'member.dds', 'Mods/core.sc2mod/DocumentInfo']).toContain(entryId)
        return {
          value: {
            id: `fixture:${entryId}`,
            uri: `fixture:${entryId}`,
            ...(rootSourceId === '' ? {} : { parentIds: [rootSourceId] }),
          },
          release: async () => undefined,
        }
      },
    }
    let disposed = false
    const operations = vi.fn(() => ({
      async invoke() {
        return { state: 'ok', output: { kind: 'bytes', value: listedBytes }, diagnostics: [] }
      },
      dispose: async () => undefined,
    }))
    const dataSource = vi.fn(async () => ({ value: namespace, release: async () => undefined }))
    const session = {
      revision: revisionId('provider-token:directory-container'),
      state: () => (disposed ? 'disposed' : 'live'),
      descriptor: async () => descriptor,
      dataSource,
      operations,
      events: () =>
        (async function* () {
          /* this stand-in session publishes no events */
        })(),
      dispose: vi.fn(async () => {
        disposed = true
      }),
    } as unknown as AssetSession
    const modDescriptor = {
      identity: { formatId: 'sc2-mod' },
      dataSources: [],
      operations: [],
    }
    let modDisposed = false
    const modSession = {
      revision: revisionId('provider-token:directory-container-mod-session'),
      state: () => (modDisposed ? 'disposed' : 'live'),
      descriptor: async () => modDescriptor,
      dataSource: async () => {
        throw new TypeError('the fixture mod publishes no data source')
      },
      operations: () => ({ invoke: vi.fn(), dispose: async () => undefined }),
      events: () =>
        (async function* () {
          /* this stand-in session publishes no events */
        })(),
      dispose: vi.fn(async () => {
        modDisposed = true
      }),
    } as unknown as AssetSession
    const openNamespaceSubject = vi.fn(async (request: Parameters<typeof openSubject>[0]) => {
      expect(request.source.kind).toBe('namespace')
      if (request.source.kind !== 'namespace') throw new TypeError('expected namespace source')
      const lease = await request.source.openNamespace()
      try {
        const physical: string[] = []
        for await (const item of lease.value.list('')) physical.push(item.path)
        if (physical.includes('Data.000')) {
          rootSourceId = request.source.ref.id
        } else {
          expect(physical).toContain('DocumentInfo')
          return {
            state: 'opened',
            session: modSession,
            descriptor: modDescriptor,
            selected: {
              extensionId: 'fixture/sc2-mod',
              contributionId: 'fixture/sc2-mod',
              variantId: 'default',
              offerId: 'fixture',
              confidence: 1,
            },
            candidates: [],
            diagnostics: [],
          } as never
        }
      } finally {
        await lease.release()
      }
      return {
        state: 'opened',
        session,
        descriptor,
        selected: {
          extensionId: 'fixture/directory-container',
          contributionId: 'fixture/directory-container',
          variantId: 'default',
          offerId: 'fixture',
          confidence: 1,
        },
        candidates: [],
        diagnostics: [],
      } as never
    })
    const services = {
      inventory: {},
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      executionBackends: {},
      executionProfiles: [],
      supportedExtensions: [],
      open: async () => {
        throw new TypeError('the byte-source SubjectServices route must not open a directory')
      },
    } as unknown as SubjectServices
    const containers = createContainerRegistry({
      services,
      roots: () => [workspace],
      grant: { id: 'directory-container-test', classes: ['read-source'] },
      budget: containerBudget,
      openNamespaceSubject,
    })
    cleanup.push(() => containers.dispose())

    expect((await containers.list(workspace, '')).map(item => item.name)).toEqual([
      'Mods',
      'Campaigns',
    ])
    expect((await containers.list(workspace, 'Mods')).map(item => item.name)).toEqual([
      'core.sc2mod',
    ])
    expect(
      (await containers.walk(workspace, 'Mods/core.sc2mod', 100)).map(item => item.path),
    ).toEqual(['Mods/core.sc2mod/DocumentInfo'])
    expect(await containers.stat(workspace, 'mods/core.sc2mod')).toMatchObject({
      name: 'core.sc2mod',
      kind: 'directory',
    })
    expect(children).toHaveBeenCalledTimes(2)
    expect(new TextDecoder().decode(await containers.read(workspace, 'member.dds'))).toBe(
      'namespace member',
    )
    expect(await containers.stat(workspace, lateMember)).toMatchObject({
      name: 'late.wav',
      kind: 'file',
      entryId: lateMember,
    })
    expect(new TextDecoder().decode(await containers.read(workspace, lateMember))).toBe(
      'namespace member',
    )
    expect(operations).toHaveBeenCalledOnce()
    expect(dataSource).toHaveBeenCalledOnce()
    const openedMod = await containers.open(containerUriText(workspace, 'Mods/core.sc2mod'))
    expect(openedMod.snapshot).toMatchObject({
      state: 'opened',
      selected: { contributionId: 'fixture/sc2-mod' },
    })
    await expect(openedMod.session?.descriptor()).resolves.toMatchObject({
      identity: { formatId: 'sc2-mod' },
    })
    await openedMod.session?.dispose()
    expect(modSession.dispose).toHaveBeenCalledOnce()
    expect(openNamespaceSubject).toHaveBeenCalledTimes(2)
    expect(await containers.release(workspace)).toBe(true)
    expect(session.dispose).toHaveBeenCalledOnce()

    descriptor.identity.formatId = 'fixture-directory-container'
    await expect(containers.index(workspace)).rejects.toMatchObject({ code: NOT_A_CONTAINER })
    expect(openNamespaceSubject).toHaveBeenCalledTimes(3)

    const granted = mkdtempSync(join(tmpdir(), 'modkit-vscode-container-granted-'))
    const outside = mkdtempSync(join(tmpdir(), 'modkit-vscode-container-outside-'))
    cleanup.push(() => rmSync(granted, { recursive: true, force: true }))
    cleanup.push(() => rmSync(outside, { recursive: true, force: true }))
    const escaped = join(granted, 'casc-install')
    symlinkSync(outside, escaped, process.platform === 'win32' ? 'junction' : 'dir')
    const escapedContainers = createContainerRegistry({
      services,
      roots: () => [granted],
      grant: { id: 'directory-container-escape-test', classes: ['read-source'] },
      budget: containerBudget,
      openNamespaceSubject,
    })
    cleanup.push(() => escapedContainers.dispose())
    await expect(escapedContainers.index(escaped)).rejects.toThrow(
      /outside the physically granted roots/u,
    )
    expect(openNamespaceSubject).toHaveBeenCalledTimes(3)

    descriptor.identity.formatId = 'casc'
    const raceRoot = mkdtempSync(join(tmpdir(), 'modkit-vscode-container-race-'))
    cleanup.push(() => rmSync(raceRoot, { recursive: true, force: true }))
    writeFileSync(join(raceRoot, 'Data.000'), 'race namespace marker')
    let rejectFirst: ((reason: Error) => void) | undefined
    const raceOpen = vi.fn((request: Parameters<typeof openSubject>[0]) => {
      if (raceOpen.mock.calls.length === 1) {
        return new Promise<never>((_resolve, reject) => {
          rejectFirst = reject
        })
      }
      return openNamespaceSubject(request)
    })
    const racedContainers = createContainerRegistry({
      services,
      roots: () => [raceRoot],
      grant: { id: 'directory-container-race-test', classes: ['read-source'] },
      budget: containerBudget,
      openNamespaceSubject: raceOpen,
    })
    cleanup.push(() => racedContainers.dispose())
    const first = racedContainers.index(raceRoot)
    await vi.waitFor(() => expect(raceOpen).toHaveBeenCalledOnce())
    const releasingFirst = racedContainers.release(raceRoot)
    const second = racedContainers.index(raceRoot)
    await expect(second).resolves.toMatchObject({ files: expect.any(Map) })
    rejectFirst?.(new Error('first opening failed after replacement'))
    await expect(first).rejects.toThrow(/first opening failed after replacement/u)
    await expect(releasingFirst).resolves.toBe(true)
    expect(await racedContainers.release(raceRoot)).toBe(true)
  })

  it('retains a directory parent while an exact late-entry lookup races release', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'modkit-vscode-container-open-release-'))
    cleanup.push(() => rmSync(workspace, { recursive: true, force: true }))
    writeFileSync(join(workspace, 'Data.000'), 'physical namespace marker')
    const lateEntry = 'mods/core.sc2mod/base.sc2assets/assets/sounds/late.wav'
    let continueLookup: (() => void) | undefined
    let lookupStarted: (() => void) | undefined
    const lookupReady = new Promise<void>(resolve => {
      lookupStarted = resolve
    })
    const lookupContinue = new Promise<void>(resolve => {
      continueLookup = resolve
    })
    let disposed = false
    const descriptor = {
      identity: { formatId: 'casc' },
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
      operations: [
        {
          id: CONTAINER_EXTRACT_OPERATION_ID,
          handlerId: 'extract',
          state: 'available',
          mutatesSource: false,
        },
      ],
    }
    let listings = 0
    const namespace: NamespaceEntrySource = {
      async list(prefix) {
        listings += 1
        if (prefix === '' && listings > 1) {
          lookupStarted?.()
          await lookupContinue
          // `release()` has dropped the registry key, but this in-flight nested lookup still owns
          // a retainer. A disposed parent here would invalidate the VFS mount before open.
          expect(disposed).toBe(false)
          return { items: [] }
        }
        return {
          items: [
            {
              id: 'listed.dds',
              path: 'listed.dds',
              name: 'listed.dds',
              kind: 'file',
              size: 1n,
              revision: revisionId('provider-token:open-release-listed'),
            },
          ],
        }
      },
      async openEntry(entryId) {
        expect(entryId).toBe(lateEntry)
        lookupStarted?.()
        await lookupContinue
        // `release()` has dropped the registry key, but this in-flight exact lookup still owns a
        // retainer. A disposed parent here would invalidate the VFS mount before nested open.
        expect(disposed).toBe(false)
        throw new Error('late entry is absent')
      },
    }
    const session = {
      revision: revisionId('provider-token:open-release-parent'),
      state: () => (disposed ? 'disposed' : 'live'),
      descriptor: async () => descriptor,
      dataSource: async () => ({ value: namespace, release: async () => undefined }),
      operations: () => ({ dispose: async () => undefined }),
      events: () =>
        (async function* () {
          /* this stand-in session publishes no events */
        })(),
      dispose: vi.fn(async () => {
        disposed = true
      }),
    } as unknown as AssetSession
    const containers = createContainerRegistry({
      services: {
        inventory: {},
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        executionBackends: {},
        executionProfiles: [],
        supportedExtensions: [],
      } as unknown as SubjectServices,
      roots: () => [workspace],
      grant: { id: 'directory-open-release-test', classes: ['read-source'] },
      budget: containerBudget,
      openNamespaceSubject: async () =>
        ({
          state: 'opened',
          session,
          descriptor,
          selected: {
            extensionId: 'fixture/directory-container',
            contributionId: 'fixture/directory-container',
            variantId: 'default',
            offerId: 'fixture',
            confidence: 1,
          },
          candidates: [],
          diagnostics: [],
        }) as never,
    })
    cleanup.push(() => containers.dispose())

    await containers.index(workspace)
    const opening = containers.open(containerUriText(workspace, lateEntry))
    await lookupReady
    await expect(containers.release(workspace)).resolves.toBe(true)
    expect(session.dispose).not.toHaveBeenCalled()
    continueLookup?.()
    await expect(opening).rejects.toThrow(/late entry is absent|lists no|has no entry/u)
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it('lists a ZIP entry', async () => {
    const { containers, archive } = await registryFor()
    const root = await containers.list(archive, '')
    expect(root.map((node: ContainerNode) => [node.name, node.kind])).toEqual([
      ['hello.txt', 'file'],
    ])
    const text = await containers.stat(archive, 'hello.txt')
    expect(text.kind).toBe('file')
    expect(text.size).toBeGreaterThan(0)
  }, 120_000)

  it('writes a member back into its archive and reads the new bytes', async () => {
    const { containers, workspace, archive } = await registryFor()
    const copy = join(workspace, 'written.zip')
    writeFileSync(copy, readFileSync(archive))
    await containers.write(copy, 'hello.txt', new TextEncoder().encode('written back'))
    expect(new TextDecoder().decode(await containers.read(copy, 'hello.txt'))).toBe('written back')
    // A path the archive does not hold yet is created, as a file manager's save does.
    await containers.write(copy, 'added.txt', new TextEncoder().encode('new'))
    expect(new TextDecoder().decode(await containers.read(copy, 'added.txt'))).toBe('new')
  }, 120_000)

  it('opens, reads and writes a file inside an archive inside an archive', async () => {
    const { containers, workspace, archive } = await registryFor()
    const outer = join(workspace, 'outer.zip')
    writeFileSync(outer, readFileSync(archive))
    await containers.edit(outer, { write: [{ entry: 'inner.zip', bytes: readFileSync(archive) }] })
    const inner = joinContainer(outer, ['inner.zip'])
    expect(new TextDecoder().decode(await containers.read(inner, 'hello.txt'))).toContain('hello')
    const opened = await containers.open(containerUriText(inner, 'hello.txt'))
    expect(opened.snapshot.state).toBe('opened')
    await opened.session?.dispose()

    await containers.write(inner, 'hello.txt', new TextEncoder().encode('nested write'))
    expect(new TextDecoder().decode(await containers.read(inner, 'hello.txt'))).toBe('nested write')
  }, 120_000)

  it('creates, renames and removes files and folders as a file manager does', async () => {
    const { containers, workspace, archive } = await registryFor()
    const copy = join(workspace, 'managed.zip')
    writeFileSync(copy, readFileSync(archive))
    await containers.edit(copy, {
      folders: ['empty'],
      write: [{ entry: 'docs/a.txt', bytes: new TextEncoder().encode('a') }],
    })
    expect((await containers.list(copy, '')).map(node => node.name).sort()).toEqual([
      'docs',
      'empty',
      'hello.txt',
    ])
    await containers.edit(copy, { rename: [{ from: 'docs', to: 'notes' }] })
    expect(new TextDecoder().decode(await containers.read(copy, 'notes/a.txt'))).toBe('a')
    await containers.edit(copy, { remove: ['notes', 'empty'] })
    expect((await containers.list(copy, '')).map(node => node.name)).toEqual(['hello.txt'])
    expect(
      await codeOf(() =>
        containers.edit(copy, { rename: [{ from: 'hello.txt', to: 'hello.txt' }] }),
      ),
    ).toBe('x3.app/vscode-container-entry-exists')
  }, 120_000)

  it('reads a member through the container, not from disk', async () => {
    const { containers, archive } = await registryFor()
    const bytes = await containers.read(archive, 'hello.txt')
    expect(new TextDecoder().decode(bytes)).toContain('hello')
    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'read',
      note: 'a container member is read through the open container in the VS Code composition',
    })
  }, 120_000)

  it('searches, refreshes and releases the shared held container without a second cache', async () => {
    const { containers, archive } = await registryFor()
    expect((await containers.search(archive, 'HELLO')).map(hit => hit.path)).toEqual(['hello.txt'])
    expect(containers.held()).toEqual([archive])
    expect((await containers.refresh(archive)).files.has('hello.txt')).toBe(true)
    expect(containers.held()).toEqual([archive])
    expect(await containers.release(archive)).toBe(true)
    expect(await containers.release(archive)).toBe(false)
    expect(containers.held()).toEqual([])
  }, 120_000)

  it('keeps indexing and searching lazy, then attributes the ordinary member extraction', async () => {
    const { host, workspace, archive } = await stage()
    const extracted: {
      readonly container: string
      readonly entry: string
      readonly bytes: number
    }[] = []
    const containers = host.containers({
      roots: () => [workspace],
      onExtract: event => extracted.push(event),
    })
    cleanup.push(() => containers.dispose())

    await containers.index(archive)
    await containers.search(archive, 'hello')
    expect(extracted).toEqual([])

    const bytes = await containers.read(archive, 'hello.txt')
    expect(extracted).toEqual([{ container: archive, entry: 'hello.txt', bytes: bytes.byteLength }])
  }, 120_000)

  it('names what it refuses: a missing member, a directory, a file that holds nothing', async () => {
    const { containers, archive, plain } = await registryFor()
    expect(await codeOf(() => containers.stat(archive, 'absent.txt'))).toBe(
      CONTAINER_ENTRY_NOT_FOUND,
    )
    expect(await codeOf(() => containers.index(plain))).toBe(NOT_A_CONTAINER)
  }, 120_000)

  it('refuses a container outside the granted roots, exactly as a direct open would', async () => {
    const { containers, archive } = await registryFor(() => [join(tmpdir(), 'nowhere-at-all')])
    await expect(containers.index(archive)).rejects.toThrow(/outside the granted roots/u)
  }, 120_000)
})

describe('a member is a subject in its own right', () => {
  it('opens text inside the archive through a first-party codec', async () => {
    const { containers, archive } = await registryFor()
    const uri = containerUriText(archive, 'hello.txt')
    const answer = await containers.open(uri)
    if (answer.snapshot.state !== 'opened') {
      throw new Error(
        `the nested text did not open: ${JSON.stringify(answer.snapshot.diagnostics)}`,
      )
    }
    expect(answer.snapshot.selected.contributionId).toBe('modkit/txt')
    expect(answer.snapshot.selected.extensionId).toBeTruthy()
    expect(answer.snapshot.selectedRoute).toHaveLength(2)
    expect(answer.snapshot.selectedRoute?.[0]).toMatchObject({
      formatId: 'zip',
      contributionId: 'modkit/archive-zip',
    })
    expect(answer.snapshot.selectedRoute?.[1]).toEqual({
      formatId: 'txt',
      extensionId: answer.snapshot.selected.extensionId,
      contributionId: 'modkit/txt',
    })
    expect(answer.snapshot.selectedRoute?.[0]?.extensionId).not.toBe(
      answer.snapshot.selectedRoute?.[1]?.extensionId,
    )
    expect(JSON.stringify(answer.snapshot.selectedRoute)).not.toContain(archive)
    const session = answer.session
    expect(session).toBeDefined()

    // Releasing the registry drops its cache key but the live child retains the parent/session.
    expect(await containers.release(archive)).toBe(true)
    expect(session?.state()).toBe('live')
    await expect(session?.descriptor()).resolves.toMatchObject({ identity: { formatId: 'txt' } })
    await session?.dispose()
    expect(await containers.release(archive)).toBe(false)
    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'inspect',
      note: 'text inside a ZIP opens as its own subject in the VS Code composition',
    })
  }, 180_000)

  it('reaches the page over the same subject RPC a file does', async () => {
    const { host, workspace, archive } = await stage()
    const containers = host.containers({ roots: () => [workspace] })
    const channels = channelPair()
    const opened: { path: string; contributionId: string }[] = []
    const served = host.serve({
      channel: channels.extension,
      session: 'vscode-containers',
      roots: () => [workspace],
      containers,
      onSubjectOpened: item =>
        opened.push({ path: item.path, contributionId: item.contributionId }),
    })
    const page = createBridge({ channel: channels.page, idPrefix: 'page' })
    let navigated: Extract<SubjectClientOpenResult, { readonly state: 'opened' }> | undefined
    const client = await connectSubjectRpc({
      framePort: page.framePort,
      session: 'vscode-containers',
      moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
      contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
      onNavigate: event => {
        navigated = event.result
      },
    })
    cleanup.push(async () => {
      await client.close('test finished').catch(() => undefined)
      page.dispose()
      await served.close('test finished').catch(() => undefined)
      await containers.dispose()
    })

    const uri = containerUriText(archive, 'hello.txt')
    const answer = await client.open(uri)
    if (answer.state !== 'opened') {
      throw new Error(
        `the page did not receive the member: ${JSON.stringify(answer.snapshot.diagnostics)}`,
      )
    }
    expect(answer.snapshot.selected.contributionId).toBe('modkit/txt')
    expect(answer.snapshot.selectedRoute).toHaveLength(2)
    expect(answer.snapshot.selectedRoute?.map(step => step.contributionId)).toEqual([
      'modkit/archive-zip',
      'modkit/txt',
    ])
    // the page is told what it opened by the same callback a file goes through
    expect(opened).toEqual([{ path: uri, contributionId: 'modkit/txt' }])
    // and the status surface names it without the container's absolute path
    expect(subjectLabel(uri)).toBe('fixture.zip › hello.txt')
    expect(subjectLabel(uri)).not.toContain(workspace)
    expect(parseContainerUriText(uri)?.container).toBe(archive)

    /*
     * The page's *other* channel, and the reason this assertion exists.
     *
     * Opening a subject is the RPC; reading its bytes for the hex and text stages is the shell —
     * two channels, and the first run of the reworked VS Code smoke found only the first of them
     * wired. The member opened in a tab and the page then said «is outside the folders this window
     * granted», because the shell resolved the URI as a filesystem path. Both are asserted here so
     * a regression cannot pass by satisfying one of them.
     */
    const bytes = await page.request({
      op: 'read',
      path: containerUriText(archive, 'hello.txt'),
      maxBytes: 1024,
    })
    expect(new TextDecoder().decode(bytes as Uint8Array)).toContain('hello')

    const root = (await page.request({
      op: 'list',
      path: containerUriText(archive),
    })) as readonly { readonly id: string; readonly name: string; readonly directory: boolean }[]
    expect(root.map(item => [item.name, item.directory])).toEqual([['hello.txt', false]])
    // a child's id is its own address, so the page does not need to know the encoding
    expect(parseContainerUriText(root[0]?.id ?? '')).toEqual({
      container: archive,
      entry: 'hello.txt',
    })

    const parent = await client.open(archive)
    if (parent.state !== 'opened') throw new Error('the parent archive did not open over RPC')
    const namespace = await parent.session.dataSource('common.view/namespace-entry-source', 1)
    const entries = await (namespace.value as NamespaceEntrySource).list('', { limit: 16 })
    const hello = entries.items.find(item => item.path === 'hello.txt')
    if (hello === undefined) throw new Error('the parent archive has no hello.txt entry')
    const ref = await (namespace.value as NamespaceEntrySource).openEntry(hello.id)
    let target: string
    try {
      target = serializeSubjectRef(rootSubject({ id: ref.value.uri }))
    } finally {
      await ref.release()
    }
    // The attached viewer session owns the namespace source lease until parent.dispose().
    const navigation = parent.session.subjectNavigation
    if (navigation === undefined) throw new Error('the live RPC session has no navigation port')
    const navigationResult = await navigation
      .open({ scope: navigation.scope, target })
      .catch(error => {
        throw new Error(error instanceof Error ? error.message : JSON.stringify(error))
      })
    expect(navigationResult).toEqual({ state: 'opened' })
    expect(navigated?.snapshot.selected.contributionId).toBe('modkit/txt')
    await navigated?.session.dispose()
    await parent.session.dispose()
    await answer.session.dispose()
  }, 180_000)
})
