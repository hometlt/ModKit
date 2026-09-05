/**
 * R6: the Electron subject bridge over capability-RPC — a faithful copy of the production pair.
 * The main side runs `exposeElectronSubjectRpc` with the `emitter-event` adapter over a port
 * shaped exactly like Electron's `MessagePortMain` (`on('message', e => e.data)`); the renderer
 * side runs `connectElectronSubjectRpc` with the `event-target` adapter over the DOM-shaped end
 * (`addEventListener`), which is what a Node `worker_threads` MessagePort provides natively.
 * No Electron binary is involved; the adapters, surfaces and endpoints are the production ones.
 */
import { MessageChannel, type MessagePort as NodeMessagePort } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { revisionId, type ArtifactByteSource, type NamespaceEntrySource } from '@modkit/sdk'
import { rootSubject, serializeSubjectRef } from '@modkit/sdk/subjects'
import { subjectOpenSnapshot } from '@modkit/host'
import {
  createEndpoint,
  createStandardSurfaceRegistry,
  framePortFromMessagePort,
  protocolLimits,
  type MessagePortLike,
} from '@modkit/host/execution'
import { ABI_ASSET_SESSION } from '@modkit/host/execution'
import { ELECTRON_SUBJECT_SERVICES, ELECTRON_SUBJECT_SERVICES_URL } from '../src/index.js'
import {
  connectElectronSubjectRpc,
  createElectronNestedSubjectNavigator,
  createElectronSubjectServices,
  exposeElectronSubjectRpc,
  resolveElectronPresentationPlan,
  type ElectronSubjectOpener,
  type SubjectRpcClient,
  type SubjectRpcExposure,
} from '../src/index.js'
import {
  openElectronNavigatedSubject,
  type ElectronSubjectOpenResult,
} from '../src/subject-client.js'

function memorySource(name: string, value: string | Uint8Array): ArtifactByteSource {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return {
    kind: 'bytes',
    ref: { id: `memory://electron/${name}`, uri: `memory://electron/${name}` },
    revision: revisionId(`content-hash.sha256:${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

/** Wrap a Node port so listeners receive `{ data }` events — the `MessagePortMain` shape. */
function messagePortMainShape(port: NodeMessagePort): MessagePortLike {
  const wrapped = new Map<(payload: unknown) => void, (value: unknown) => void>()
  return {
    postMessage: (message, transfer) =>
      port.postMessage(message, transfer === undefined ? [] : [...transfer]),
    on(_event, listener) {
      const translated = (value: unknown) => listener({ data: value })
      wrapped.set(listener, translated)
      port.on('message', translated)
      return this
    },
    off(_event, listener) {
      const translated = wrapped.get(listener)
      if (translated !== undefined) port.off('message', translated)
      wrapped.delete(listener)
      return this
    },
    start: () => port.start(),
    close: () => port.close(),
  }
}

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined)
})

async function rpcPair(
  open: ElectronSubjectOpener,
  options: {
    readonly navigate?: Parameters<typeof exposeElectronSubjectRpc>[0]['navigate']
    readonly onNavigate?: Parameters<typeof connectElectronSubjectRpc>[0]['onNavigate']
  } = {},
): Promise<{
  client: SubjectRpcClient
  exposure: SubjectRpcExposure
}> {
  const channel = new MessageChannel()
  const session = 'electron-rpc-test'
  const exposure = exposeElectronSubjectRpc({
    port: messagePortMainShape(channel.port1),
    listener: 'emitter-event',
    session,
    open,
    ...(options.navigate === undefined ? {} : { navigate: options.navigate }),
  })
  const client = await connectElectronSubjectRpc({
    // a Node MessagePort is an EventTarget: the same `event-target` style the DOM port uses
    port: channel.port2 as unknown as MessagePortLike,
    session,
    ...(options.onNavigate === undefined ? {} : { onNavigate: options.onNavigate }),
  })
  closers.push(
    () => client.close('test finished'),
    () => exposure.close('test finished'),
    async () => {
      channel.port1.close()
      channel.port2.close()
    },
  )
  return { client, exposure }
}

describe('Electron subject RPC — the production pair without the binary', () => {
  it('opens JSON end to end: snapshot over the wire, session attached as a capability, tree pages and search pulled through surfaces, dispose cascades', async () => {
    const services = await createElectronSubjectServices([
      // JSON is native Core functionality; no extension root is required.
    ])
    const opener: ElectronSubjectOpener = async (path, signal) => {
      const result = await services.open({
        source: memorySource(path, '{"name":"Modkit","items":[1,2,3]}'),
        path,
        intent: 'full',
        grant: { id: 'electron-rpc-open', classes: ['read-source'] },
        budget: {
          maxInputBytes: 1_000_000n,
          maxDepth: 128,
          maxNodes: 100_000,
          maxScalarBytes: 1_000_000,
          maxDiagnostics: 100,
        },
        ...(signal === undefined ? {} : { signal }),
      })
      if (result.state === 'unresolved') {
        return {
          snapshot: {
            state: 'unresolved',
            reason: result.reason,
            candidates: result.candidates,
            diagnostics: result.diagnostics,
          },
        }
      }
      const sessionId = 'rpc-session-1'
      const presentation = await resolveElectronPresentationPlan(
        result.descriptor,
        {
          sessionId,
          contributionId: result.selected.contributionId,
          variantId: result.selected.variantId,
        },
        {
          sourceBytes: BigInt(
            new TextEncoder().encode('{"name":"Modkit","items":[1,2,3]}').byteLength,
          ),
        },
      )
      return {
        snapshot: {
          state: 'opened',
          sessionId,
          descriptor: result.descriptor as unknown as Record<string, unknown>,
          presentation,
          selected: result.selected,
          candidates: result.candidates,
          diagnostics: result.diagnostics,
        },
        session: result.session,
      }
    }
    const { client } = await rpcPair(opener)

    const opened = await client.open('document.json')
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error('open failed')
    // the codec ran worker-brokered in main's worker realm; the wire carried the honest notice
    expect(opened.snapshot.selected).toMatchObject({
      contributionId: 'modkit/text-json',
      variantId: 'core-native',
    })
    expect(opened.snapshot.diagnostics.map(item => item.code)).toContain(
      'x3.host/full-process-authority',
    )
    expect(opened.snapshot.presentation).toMatchObject({ activeStage: 'code' })
    expect((await opened.session.descriptor())['interpretation']).toBe('codec')

    // dataSource(contract, major): the leased surface comes from the standard registry
    const tree = (await opened.session.dataSource('common.view/tree-data-source', 1)) as {
      value: {
        root(): Promise<{ id: string; hasChildren: boolean }>
        children(node: unknown, page: unknown): Promise<{ items: readonly { id: string }[] }>
        search(query: unknown): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>
      }
      release(): Promise<void>
    }
    const root = await tree.value.root()
    expect(root).toMatchObject({ id: 'root', hasChildren: true })
    const page = await tree.value.children(root, { limit: 10 })
    expect(page.items.length).toBeGreaterThan(0)
    // iterables are real pull streams across the port — no 1000-item materialization
    const hits: unknown[] = []
    // the kit's tree search matches node labels (JSON keys)
    for await (const hit of await tree.value.search({ pattern: 'items' })) hits.push(hit)
    expect(hits.length).toBeGreaterThan(0)
    await tree.release()

    // no method allowlist: a method the surface does not declare simply does not exist
    expect((tree.value as Record<string, unknown>)['stealBytes']).toBeUndefined()

    await opened.session.dispose()
    // the lease cascade disposed the real session in main: a second dispose is answered
    // structurally by the endpoint, not by a lingering session table
    await expect(opened.session.dataSource('common.view/tree-data-source', 1)).rejects.toThrow()
  }, 30_000)

  it('opens an authoritative container-entry ref through the main policy and renderer route', async () => {
    const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
    const services = await createElectronSubjectServices([
      join(repositoryRoot, 'extensions', 'archives'),
    ])
    const bytes = new Uint8Array(
      readFileSync(join(repositoryRoot, 'apps', 'web', 'public', 'samples', 'sample.zip')),
    )
    const grant = { id: 'electron-rpc-nested', classes: ['read-source'] } as const
    const budget = {
      maxInputBytes: 10_000_000n,
      maxDepth: 128,
      maxNodes: 100_000,
      maxScalarBytes: 1_000_000,
      maxDiagnostics: 100,
    }
    let sequence = 0
    const snapshot = async (
      result: Awaited<ReturnType<typeof services.open>>,
      diagnostics = result.diagnostics,
    ) => {
      const opened = subjectOpenSnapshot({
        result,
        sessionId: () => `electron-nested-${++sequence}`,
        diagnostics,
      })
      return result.state === 'opened'
        ? { snapshot: opened, session: result.session }
        : { snapshot: opened }
    }
    const opener: ElectronSubjectOpener = async path => {
      const result = await services.open({
        source: memorySource(path, bytes),
        path,
        intent: 'full',
        grant,
        budget,
      })
      return snapshot(result)
    }
    const navigate = createElectronNestedSubjectNavigator({
      services,
      grant: () => grant,
      budget,
      async answer(_parent, nested, diagnostics) {
        return snapshot(nested.result, [...nested.result.diagnostics, ...diagnostics])
      },
    })
    const staged = new Map<string, ElectronSubjectOpenResult>()
    let child: ElectronSubjectOpenResult | undefined
    const { client } = await rpcPair(opener, {
      navigate,
      onNavigate: event =>
        openElectronNavigatedSubject(event, {
          ownsSource: sessionId => sessionId === 'electron-nested-1',
          hasTarget: target => staged.has(target),
          stage: (target, result) => void staged.set(target, result),
          async open(target) {
            child = staged.get(target)
          },
          discard: target => void staged.delete(target),
        }),
    })

    const parent = await client.open('sample.zip')
    expect(parent.state).toBe('opened')
    if (parent.state !== 'opened') throw new Error('the archive did not open')
    const listing = await parent.session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (listing.value as NamespaceEntrySource).list('', { limit: 64 })
    const entry = page.items.find(item => item.kind === 'file' && item.path.endsWith('.csv'))
    if (entry === undefined) throw new Error('the archive lists no CSV entry')
    const entryRef = await (listing.value as NamespaceEntrySource).openEntry(entry.id)
    const target = serializeSubjectRef(rootSubject({ id: entryRef.value.uri }))
    await entryRef.release()
    await listing.release()

    const navigation = parent.session.subjectNavigation
    if (navigation === undefined) throw new Error('the attached session has no navigation port')
    await expect(navigation.open(target)).resolves.toEqual({ state: 'opened' })
    if (child?.state !== 'opened') throw new Error('the renderer route received no opened child')
    expect((await child.session.descriptor())['subjectUri']).toBe(target)
    await child.session.dispose()
    await parent.session.dispose()
    await services.dispose()
  }, 60_000)

  it('unresolved subjects cross as inert snapshots; never-attached sessions are disposed on close', async () => {
    let disposed = 0
    const opener: ElectronSubjectOpener = async path => {
      if (path.endsWith('.mystery')) {
        return {
          snapshot: {
            state: 'unresolved',
            reason: 'no-candidate',
            candidates: [],
            diagnostics: [{ code: 'x3.demo/none', message: 'nothing matched' }],
          },
        }
      }
      return {
        snapshot: {
          state: 'opened',
          sessionId: 'orphan-1',
          descriptor: {},
          presentation: { activeStage: 'code', alternateStages: [], stages: [] } as never,
          selected: { contributionId: 'org.demo/x', variantId: 'v', confidence: 1 },
          candidates: [],
          diagnostics: [],
        },
        session: {
          revision: revisionId('content-hash.sha256:orphan'),
          state: () => 'live',
          descriptor: async () => ({}),
          dataSource: async () => ({ value: {}, release: async () => undefined }),
          operations: () => ({
            invoke: async () => ({ kind: 'ok' }),
            dispose: async () => undefined,
          }),
          events: async function* () {
            yield* []
          },
          dispose: async () => {
            disposed += 1
          },
        } as never,
      }
    }
    const { client } = await rpcPair(opener)
    const missed = await client.open('unknown.mystery')
    expect(missed.state).toBe('unresolved')
    if (missed.state === 'unresolved') {
      expect(missed.snapshot.reason).toBe('no-candidate')
      expect(missed.snapshot.diagnostics[0]?.code).toBe('x3.demo/none')
    }

    // a raw host endpoint (the client always attaches): open without attach, then close the
    // exposure — the pending session must be disposed by main, not leaked
    const channel = new MessageChannel()
    const exposure = exposeElectronSubjectRpc({
      port: messagePortMainShape(channel.port1),
      listener: 'emitter-event',
      session: 'pending-dispose',
      open: opener,
    })
    const raw = createEndpoint({
      role: 'host',
      port: framePortFromMessagePort(channel.port2 as unknown as MessagePortLike),
      session: 'pending-dispose',
      generation: 1,
      surfaces: createStandardSurfaceRegistry({
        surfaces: [
          {
            ...ELECTRON_SUBJECT_SERVICES,
            methods: {
              open: { kind: 'value', signal: 'last' },
              attach: { kind: 'lease', result: ABI_ASSET_SESSION, wrapper: 'bare' },
            },
          },
        ],
      }),
      limits: protocolLimits({ defaultCallDeadlineMs: 10_000 }),
    })
    closers.push(
      () => raw.close('test finished'),
      () => exposure.close('test finished'),
      async () => {
        channel.port1.close()
        channel.port2.close()
      },
    )
    const loaded = await raw.load({
      moduleUrl: ELECTRON_SUBJECT_SERVICES_URL,
      contributionId: 'modkit.app.electron/subject-services',
      variantId: 'main',
      artifactDigest: 'sha256:app-composition',
    })
    const outcome = await loaded.root.call('open', ['keep.pending'])
    expect(outcome.kind).toBe('value')
    if (outcome.kind === 'value') {
      expect((outcome.value as { state: string }).state).toBe('opened')
    }
    expect(disposed).toBe(0)
    await exposure.close('window closed')
    expect(disposed).toBe(1) // the never-attached session was disposed with the exposure
  }, 20_000)

  it('a hostile frame from the renderer side fails the endpoint closed instead of reaching a session', async () => {
    const opener: ElectronSubjectOpener = async () => ({
      snapshot: { state: 'unresolved', reason: 'no-candidate', candidates: [], diagnostics: [] },
    })
    const channel = new MessageChannel()
    const failures: string[] = []
    const exposure = exposeElectronSubjectRpc({
      port: messagePortMainShape(channel.port1),
      listener: 'emitter-event',
      session: 'hostile-side',
      open: opener,
      onDiagnostic: diagnostic => void failures.push(diagnostic.code),
    })
    closers.push(
      () => exposure.close('test finished'),
      async () => {
        channel.port1.close()
        channel.port2.close()
      },
    )
    // raw injection: a frame with a forged session must be a violation, not a dispatch
    channel.port2.postMessage({
      domain: 'x3.host/rpc',
      version: 1,
      session: 'someone-else',
      generation: 1,
      id: 1,
      t: 'call',
      handle: 'w1-1',
      method: 'open',
      args: ['C:/secrets.txt'],
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(exposure.endpoint.state).toBe('failed')
    expect(failures).toContain('x3.app/subject-rpc-failed')
  }, 20_000)
})
