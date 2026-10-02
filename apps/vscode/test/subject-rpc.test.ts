/**
 * The VS Code bridge, end to end, without VS Code.
 *
 * Everything below the editor is the production code: the extension host composes three realms and
 * serves `x3.app/subject-services@1` over `framePortFromJsonPort`, codecs run in a real
 * `worker_threads` realm, files are opened through `createPathSubjectOpener` and written through
 * `createFileEditingBackend`. The only thing faked is the editor's own duplex — the single JSON
 * channel VS Code gives a webview — which is replaced by a pair of in-process channels that
 * deliver asynchronously, exactly as `postMessage` does.
 *
 * What this therefore proves and what it does not: it proves the transport, the RPC surface, the
 * confinement, the descriptor crossing, and that a text edit driven from the consuming side lands
 * on disk. It does not prove that VS Code renders the page, that the CSP admits the bundle, or
 * that a custom editor resolves — those need a real editor.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { connectSubjectRpc, type SubjectRpcClient } from '@modkit/host'
import type { ChangeSet } from '@modkit/sdk'
import { createBridge, type WebviewChannel } from '../src/bridge.js'
import {
  createVsCodeSubjectHost,
  ownedWireBytes,
  VSCODE_MAXIMUM_RANGE_BACKED_SUBJECT_BYTES,
  VSCODE_MAXIMUM_SUBJECT_BYTES,
  VSCODE_SUBJECT_CONTRIBUTION_ID,
  VSCODE_SUBJECT_SERVICES_URL,
  withinRoots,
  type VsCodeServed,
  type VsCodeSubjectHost,
} from '../src/host.js'
import type { DirectoryProbe } from '../src/extension-roots.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const cleanup: (() => void | Promise<void>)[] = []

afterAll(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

/**
 * One extension from the lab checkout, presented as if it were the catalog that ships beside the
 * extension. Only `text-json` loads, which keeps the composition to one codec.
 */
function catalogProbe(names: readonly string[]): DirectoryProbe {
  const common = join(repositoryRoot, 'extensions')
  return {
    readDirectory: path => (path === 'catalog' ? names : undefined),
    isFile: path => existsSync(path),
    readJson: path => {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown
      } catch {
        return undefined
      }
    },
    join: (...parts) => (parts[0] === 'catalog' ? join(common, ...parts.slice(1)) : join(...parts)),
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

interface Wired {
  readonly host: VsCodeSubjectHost
  readonly served: VsCodeServed
  readonly client: SubjectRpcClient
  readonly page: ReturnType<typeof createBridge>
  readonly channels: ReturnType<typeof channelPair>
  readonly workspace: string
}

async function wire(
  files: Readonly<Record<string, string>>,
  lifecycle?: {
    readonly onDirty?: (path: string, dirty: boolean) => void
    readonly onSaveRequested?: (path: string) => void
    readonly onRevertRequested?: (path: string) => void
  },
): Promise<Wired> {
  const workspace = mkdtempSync(join(tmpdir(), 'modkit-vscode-rpc-'))
  cleanup.push(() => rmSync(workspace, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(workspace, name), text)

  const host = await createVsCodeSubjectHost({
    catalogCandidates: ['catalog'],
    probe: catalogProbe(['text-json']),
  })
  expect(host.extensions.failures).toEqual([])
  expect(host.extensions.bundled.length).toBe(0)

  const channels = channelPair()
  const served = host.serve({
    channel: channels.extension,
    session: 'vscode-test',
    roots: () => [workspace],
    confirmClose: async () => 'discard',
    ...(lifecycle?.onDirty === undefined ? {} : { onDocumentDirty: lifecycle.onDirty }),
    ...(lifecycle?.onSaveRequested === undefined
      ? {}
      : { onDocumentSaveRequested: lifecycle.onSaveRequested }),
    ...(lifecycle?.onRevertRequested === undefined
      ? {}
      : { onDocumentRevertRequested: lifecycle.onRevertRequested }),
  })
  const page = createBridge({ channel: channels.page, idPrefix: 'page' })
  const client = await connectSubjectRpc({
    framePort: page.framePort,
    session: 'vscode-test',
    moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
    contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
  })
  cleanup.push(async () => {
    await client.close('test finished').catch(() => undefined)
    page.dispose()
    await served.close('test finished').catch(() => undefined)
  })
  return { host, served, client, page, channels, workspace }
}

describe('the VS Code subject bridge', () => {
  // v88: after «Developer: Reload Webviews» a panel waited out «load #1 exceeded its 60000 ms deadline»
  it('serves a page that loads again in its panel', async () => {
    const { page, channels, workspace } = await wire({ 'asset.json': '{"a":1}' })
    page.emit({ op: 'page-listening' })
    // the page reloads: its bridge goes, the panel and the host stay
    page.dispose()
    const again = createBridge({ channel: channels.page, idPrefix: 'page' })
    again.emit({ op: 'page-listening' })
    const client = await connectSubjectRpc({
      framePort: again.framePort,
      session: 'vscode-test',
      moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
      contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
    })
    try {
      const opened = await client.open(join(workspace, 'asset.json'))
      expect(opened.state).toBe('opened')
      if (opened.state === 'opened') await opened.session.dispose()
    } finally {
      await client.close('test finished').catch(() => undefined)
      again.dispose()
    }
  }, 30_000)

  it('carries native custom-document dirty, save, and revert lifecycle over the shell channel', async () => {
    const dirty: [string, boolean][] = []
    const saveRequested: string[] = []
    const revertRequested: string[] = []
    const { page, served, workspace } = await wire(
      { 'asset.txt': 'before' },
      {
        onDirty: (path, state) => dirty.push([path, state]),
        onSaveRequested: path => saveRequested.push(path),
        onRevertRequested: path => revertRequested.push(path),
      },
    )
    const path = join(workspace, 'asset.txt')
    const requests: string[] = []
    page.serve(async request => {
      requests.push(request.op)
      return request.op === 'document-save' || request.op === 'document-revert'
    })

    page.emit({ op: 'document-dirty', path, dirty: true })
    page.emit({ op: 'document-save-requested', path })
    page.emit({ op: 'document-revert-requested', path })
    await served.saveDocument(path)
    await served.revertDocument(path)

    expect(dirty).toEqual([[path, true]])
    expect(saveRequested).toEqual([path])
    expect(revertRequested).toEqual([path])
    expect(requests).toEqual(['document-save', 'document-revert'])
    // composing the real host takes seconds under load, as for the other tests of this bridge
  }, 120_000)

  it('opens a subject over the JSON channel and hands the page its descriptor', async () => {
    const { client, served, workspace } = await wire({
      'sample.json': '{"name":"Modkit","items":[1,2,3]}',
    })
    const result = await client.open(join(workspace, 'sample.json'))
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') return

    // the descriptor crossed as data: the consuming side never ran a codec
    const descriptor = await result.session.descriptor()
    const contracts = (descriptor['dataSources'] as { contract: string }[]).map(
      source => source.contract,
    )
    expect(contracts).toContain('common.view/tree-data-source')
    expect(contracts).toContain('common.view/byte-range-source')
    expect((descriptor['traits'] as { id: string }[]).map(trait => trait.id)).toContain(
      'content.text',
    )
    expect(result.snapshot.selected.contributionId).toContain('text-json')
    expect(served.languageSubject()).toMatchObject({
      descriptor: { interpretation: 'codec' },
      revision: expect.any(String),
    })

    // and the live session is a lease, not a copy: a data source resolves through the wire
    const lease = await result.session.dataSource('common.view/byte-range-source', 1)
    expect(lease.value).toBeDefined()
    await result.session.dispose()
    expect(served.languageSubject()).toBeUndefined()
  }, 120_000)

  it('lends the same generic tree data source to native views without a webview session', async () => {
    const { host, workspace } = await wire({
      'sample.json': '{"name":"Modkit","items":[1,2,3]}',
    })
    const subject = await host.openTreeSubject(join(workspace, 'sample.json'), [workspace])
    expect(subject).toBeDefined()
    if (subject === undefined) return
    const lease = await subject.openTreeDataSource()
    expect(lease).toBeDefined()
    if (lease !== undefined) {
      const root = await lease.value.root()
      expect(await lease.value.facts(root)).toMatchObject({ label: expect.any(String) })
      await lease.release()
    }
    await subject.dispose()
    expect(await subject.openTreeDataSource()).toBeUndefined()
  }, 120_000)

  it('refuses a path outside the granted roots before it touches the filesystem', async () => {
    const { client } = await wire({ 'sample.json': '{"a":1}' })
    await expect(client.open(join(tmpdir(), 'somewhere-else', 'secret.json'))).rejects.toThrow(
      /outside the granted roots/u,
    )
  }, 120_000)

  it('carries file bytes over the shell channel under the frames codec', async () => {
    const { page, workspace } = await wire({ 'sample.json': '{"a":1}' })
    const bytes = await page.request({
      op: 'read',
      path: join(workspace, 'sample.json'),
      maxBytes: 1024,
    })
    // a Uint8Array survived a JSON-only transport because both sides use encodeJsonValue
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('{"a":1}')

    const listing = (await page.request({ op: 'list' })) as { id: string }[]
    expect(listing.map(entry => entry.id)).toEqual([workspace])
    const files = (await page.request({ op: 'list', path: workspace })) as { name: string }[]
    expect(files.map(entry => entry.name)).toContain('sample.json')

    await expect(
      page.request({ op: 'read', path: join(tmpdir(), 'nope'), maxBytes: 8 }),
    ).rejects.toThrow(/outside the folders this window granted/u)
  }, 120_000)

  it('saves a text edit through the editing arm, and the file on disk changes', async () => {
    const source = '{"name":"Modkit","items":[1,2,3]}'
    const { client, workspace } = await wire({ 'sample.json': source })
    const path = join(workspace, 'sample.json')
    const result = await client.open(path)
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') return

    /*
     * The arm the editable stages are given. Everything it hands back is data and ids: the grant
     * snapshot, the coordinator, the backend and the prepared commit stay on the extension host's
     * side of this channel.
     */
    const arm = await client.edit(result.snapshot.sessionId)
    const state = await arm.state()
    const target = state.targets[0]
    expect(target).toBeDefined()
    if (target === undefined) return

    const offset = source.indexOf('Modkit')
    const change: ChangeSet = {
      targets: state.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'utf16', offset, length: 'Modkit'.length },
          payload: { kind: 'text', text: 'Modkit MK3' },
          label: 'rename',
        },
      ],
      provenance: { actor: 'user', note: 'VS Code editing proof' },
    }

    expect(await arm.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await arm.plan(change)
    const prepared = await arm.prepare(plan)
    expect(prepared.state, JSON.stringify(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await arm.commit(prepared.preparedId)
    expect(committed.state, JSON.stringify(committed)).toBe('committed')
    if (committed.state !== 'committed') return

    expect(readFileSync(path, 'utf8')).toBe('{"name":"Modkit MK3","items":[1,2,3]}')

    const undone = await arm.undo(committed.receipt.transactionId)
    expect(undone.state, JSON.stringify(undone)).toBe('committed')
    expect(readFileSync(path, 'utf8')).toBe(source)
    const redone = await arm.redo(committed.receipt.transactionId)
    expect(redone.state, JSON.stringify(redone)).toBe('committed')
    expect(readFileSync(path, 'utf8')).toBe('{"name":"Modkit MK3","items":[1,2,3]}')
    expect(await arm.discardHistory(committed.receipt.transactionId)).toBe(true)
    await expect(arm.undo(committed.receipt.transactionId)).rejects.toThrow(
      /unknown editing transaction/u,
    )

    // the id is spent: a replay is refused rather than writing twice
    await expect(arm.commit(prepared.preparedId)).rejects.toThrow(/unknown prepared commit/u)
    await arm.dispose()
    await result.session.dispose()
  }, 120_000)

  it('refuses the editing arm for a session it never opened', async () => {
    const { client } = await wire({ 'sample.json': '{"a":1}' })
    await expect(client.edit('not-a-session')).rejects.toThrow(/not editable in this host/u)
  }, 120_000)
})

describe('root confinement', () => {
  it('keeps large range-backed opens separate from in-memory materialization', () => {
    expect(VSCODE_MAXIMUM_RANGE_BACKED_SUBJECT_BYTES).toBe(256 * 1024 * 1024)
    expect(VSCODE_MAXIMUM_SUBJECT_BYTES).toBe(64 * 1024 * 1024)
  })

  it('accepts the root itself and anything under it, and nothing beside it', () => {
    const root = join(tmpdir(), 'granted')
    expect(withinRoots([root], root)).toBe(true)
    expect(withinRoots([root], join(root, 'a', 'b.txt'))).toBe(true)
    expect(withinRoots([root], join(tmpdir(), 'granted-elsewhere', 'b.txt'))).toBe(false)
    expect(withinRoots([], join(root, 'a.txt'))).toBe(false)
  })
})

describe('bytes that cross the capability wire', () => {
  /*
   * `workspace.fs.readFile` is typed `Uint8Array` and returns a Node `Buffer`. The wire refuses a
   * subclass by design, and `Buffer.prototype.slice` hands back another view rather than the copy a
   * defensive `.slice()` reads as — which is how the installed Save As route sent a `Buffer` and was
   * refused with `x3.host/rpc-outbound-value-invalid`.
   */
  it('turns a Node Buffer into an owned plain Uint8Array', () => {
    const source = Buffer.from([1, 2, 3])
    const wire = ownedWireBytes(source)
    expect(wire.constructor).toBe(Uint8Array)
    expect([...wire]).toEqual([1, 2, 3])
    source[0] = 9
    expect(wire[0]).toBe(1)
  })

  it('copies a plain Uint8Array rather than aliasing it', () => {
    const source = Uint8Array.from([4, 5, 6])
    const wire = ownedWireBytes(source)
    expect(wire.constructor).toBe(Uint8Array)
    expect(wire).not.toBe(source)
    source[0] = 9
    expect(wire[0]).toBe(4)
  })
})
