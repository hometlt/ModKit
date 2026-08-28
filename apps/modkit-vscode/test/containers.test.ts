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
 *  2. **A member is a subject.** The W3D inside the archive opens with its own descriptor and
 *     resolves its texture *from the same archive* — and it arrives over the very subject RPC the
 *     webview speaks, so what is proved here is the product's route and not a private one.
 *
 * The only thing not exercised is the editor itself; that is what `pnpm smoke:vscode` is for.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isModkitError } from '@modkitx-x3/core'
import { connectSubjectRpc } from '@modkitx-x3/host'
import { proves } from '@modkitx-x3/testkit'
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

/** The `ea` catalog presented as if it shipped beside the extension; only what this suite needs. */
function catalogProbe(names: readonly string[]): DirectoryProbe {
  const ea = join(repositoryRoot, 'extensions', 'ea')
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
    join: (...parts) => (parts[0] === 'catalog' ? join(ea, ...parts.slice(1)) : join(...parts)),
  }
}

/** A BIG4 archive, written by hand: header, flat index of `offset/size/name\0`, then the payloads. */
function buildBig(
  entries: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Uint8Array {
  const encoder = new TextEncoder()
  const stored = entries.map(item => ({ name: encoder.encode(item.path), payload: item.bytes }))
  const indexBytes = stored.reduce((total, item) => total + 8 + item.name.byteLength + 1, 0)
  const dataOffset = 16 + indexBytes
  const total = stored.reduce((size, item) => size + item.payload.byteLength, dataOffset)
  const archive = new Uint8Array(total)
  const view = new DataView(archive.buffer)
  archive.set(encoder.encode('BIG4'), 0)
  view.setUint32(4, total, true)
  view.setUint32(8, stored.length, false)
  view.setUint32(12, dataOffset, false)
  let index = 16
  let payload = dataOffset
  for (const item of stored) {
    view.setUint32(index, payload, false)
    view.setUint32(index + 4, item.payload.byteLength, false)
    index += 8
    archive.set(item.name, index)
    index += item.name.byteLength
    archive[index] = 0
    index += 1
    archive.set(item.payload, payload)
    payload += item.payload.byteLength
  }
  return archive
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
    const model = new Uint8Array(readFileSync(join(syntheticDir, 'minimal.westwood.w3d')))
    // the model declares «fixture.tga»; the archive stores it under that name, in another folder
    const skin = new Uint8Array(readFileSync(join(syntheticDir, 'minimal.tga')))
    const archive = join(workspace, 'fixture.big')
    writeFileSync(
      archive,
      buildBig([
        { path: 'art/w3d/minimal.w3d', bytes: model },
        { path: 'art/textures/fixture.tga', bytes: skin },
        { path: 'readme.txt', bytes: new TextEncoder().encode('inside the archive') },
      ]),
    )
    const plain = join(workspace, 'loose.txt')
    writeFileSync(plain, 'not a container')

    const host = await createVsCodeSubjectHost({
      catalogCandidates: ['catalog'],
      probe: catalogProbe(['big', 'models']),
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
  it('lists the directories a BIG never recorded', async () => {
    const { containers, archive } = await registryFor()
    const root = await containers.list(archive, '')
    expect(root.map((node: ContainerNode) => [node.name, node.kind]).sort()).toEqual([
      ['art', 'directory'],
      ['readme.txt', 'file'],
    ])
    expect((await containers.list(archive, 'art')).map(node => node.name).sort()).toEqual([
      'textures',
      'w3d',
    ])
    const model = await containers.stat(archive, 'art/w3d/minimal.w3d')
    expect(model.kind).toBe('file')
    expect(model.size).toBeGreaterThan(0)
  }, 120_000)

  it('reads a member through the container, not from disk', async () => {
    const { containers, archive } = await registryFor()
    const bytes = await containers.read(archive, 'readme.txt')
    expect(new TextDecoder().decode(bytes)).toBe('inside the archive')
    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'read',
      note: 'a container member is read through the open container in the VS Code composition',
    })
  }, 120_000)

  it('searches, refreshes and releases the shared held container without a second cache', async () => {
    const { containers, archive } = await registryFor()
    expect((await containers.search(archive, 'MINIMAL')).map(hit => hit.path)).toEqual([
      'art/w3d/minimal.w3d',
    ])
    expect(containers.held()).toEqual([archive])
    expect((await containers.refresh(archive)).files.has('readme.txt')).toBe(true)
    expect(containers.held()).toEqual([archive])
    expect(await containers.release(archive)).toBe(true)
    expect(await containers.release(archive)).toBe(false)
    expect(containers.held()).toEqual([])
  }, 120_000)

  it('names what it refuses: a missing member, a directory, a file that holds nothing', async () => {
    const { containers, archive, plain } = await registryFor()
    expect(await codeOf(() => containers.stat(archive, 'art/w3d/absent.w3d'))).toBe(
      CONTAINER_ENTRY_NOT_FOUND,
    )
    expect(await codeOf(() => containers.read(archive, 'art'))).toBe(CONTAINER_ENTRY_NOT_FOUND)
    expect(await codeOf(() => containers.index(plain))).toBe(NOT_A_CONTAINER)
  }, 120_000)

  it('refuses a container outside the granted roots, exactly as a direct open would', async () => {
    const { containers, archive } = await registryFor(() => [join(tmpdir(), 'nowhere-at-all')])
    await expect(containers.index(archive)).rejects.toThrow(/outside the granted roots/u)
  }, 120_000)
})

describe('a member is a subject in its own right', () => {
  it('opens the W3D inside the archive, with its texture bound from the same archive', async () => {
    const { containers, archive } = await registryFor()
    const uri = containerUriText(archive, 'art/w3d/minimal.w3d')
    const answer = await containers.open(uri)
    if (answer.snapshot.state !== 'opened') {
      throw new Error(`the nested W3D did not open: ${JSON.stringify(answer.snapshot.diagnostics)}`)
    }
    expect(answer.snapshot.selected.contributionId).toBe('org.modkitx/westwood-w3d')
    // the texture is a companion resolved inside the container: no unavailable-companion finding
    expect(
      answer.snapshot.diagnostics.filter(item => item.code.includes('companion-unavailable')),
    ).toEqual([])
    /*
     * And the receipt says «bound», not merely "nothing complained". The texture is stored in
     * another folder of the same archive, so a binding here can only have come through the
     * container's own namespace — there is no such file on disk anywhere.
     */
    const receipt = (
      answer.snapshot.descriptor as unknown as {
        readonly metadata: readonly {
          readonly id: string
          readonly entries: readonly { readonly value: unknown }[]
        }[]
      }
    ).metadata.find(group => group.id === 'uv-projection-receipt')?.entries[0]?.value as
      { readonly companions?: readonly { requirementId: string; state: string }[] } | undefined
    expect(receipt?.companions).toEqual([
      expect.objectContaining({ requirementId: 'textures', state: 'bound' }),
    ])
    const session = answer.session
    expect(session).toBeDefined()
    const scene = await session?.dataSource('common.view/model-scene-source', 1)
    expect(scene).toBeDefined()
    await scene?.release()

    // the child goes first and the container survives it, still listable
    await session?.dispose()
    expect((await containers.list(archive, 'art/w3d')).length).toBe(1)
    proves({
      capabilityId: 'block9/archive-entry-as-subject',
      operation: 'inspect',
      note: 'a W3D inside a BIG opens as its own subject in the VS Code composition',
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

    const uri = containerUriText(archive, 'art/w3d/minimal.w3d')
    const answer = await client.open(uri)
    if (answer.state !== 'opened') {
      throw new Error(
        `the page did not receive the member: ${JSON.stringify(answer.snapshot.diagnostics)}`,
      )
    }
    expect(answer.snapshot.selected.contributionId).toBe('org.modkitx/westwood-w3d')
    // the page is told what it opened by the same callback a file goes through
    expect(opened).toEqual([{ path: uri, contributionId: 'org.modkitx/westwood-w3d' }])
    // and the status surface names it without the container's absolute path
    expect(subjectLabel(uri)).toBe('fixture.big › art/w3d/minimal.w3d')
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
      path: containerUriText(archive, 'readme.txt'),
      maxBytes: 1024,
    })
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('inside the archive')

    const root = (await page.request({
      op: 'list',
      path: containerUriText(archive),
    })) as readonly { readonly id: string; readonly name: string; readonly directory: boolean }[]
    expect(root.map(item => [item.name, item.directory]).sort()).toEqual([
      ['art', true],
      ['readme.txt', false],
    ])
    // a child's id is its own address, so the page descends without knowing the encoding
    const art = root.find(item => item.name === 'art')
    expect(parseContainerUriText(art?.id ?? '')).toEqual({ container: archive, entry: 'art' })
  }, 180_000)
})
