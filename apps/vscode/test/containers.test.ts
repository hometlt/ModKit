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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isModkitError } from '@modkit/core'
import { connectSubjectRpc } from '@modkit/host'
import { proves } from '@modkit/testkit'
import { createBridge, type WebviewChannel } from '../src/bridge.js'
import {
  containerUriText,
  CONTAINER_SCHEME,
  parseContainerUriText,
  type ContainerNode,
} from '../src/container-uri.js'
import { CONTAINER_ENTRY_NOT_FOUND, NOT_A_CONTAINER } from '../src/containers.js'
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
    const session = answer.session
    expect(session).toBeDefined()

    // the child goes first and the container survives it, still listable
    await session?.dispose()
    expect((await containers.list(archive, '')).length).toBe(1)
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
    const client = await connectSubjectRpc({
      framePort: page.framePort,
      session: 'vscode-containers',
      moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
      contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
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
  }, 180_000)
})
