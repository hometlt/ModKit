import { MessageChannel } from 'node:worker_threads'
import { afterEach, expect, it } from 'vitest'
import { revisionId, type AssetSession, type NamespaceEntry } from '@modkit/sdk'
import { rootSubject, serializeSubjectRef } from '@modkit/sdk/subjects'
import { connectSubjectRpc, exposeSubjectRpc } from '../src/index.js'

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined)
})

const ref = rootSubject({ id: 'memory://archive.zip' }, 'workspace-a')
const entries: NamespaceEntry[] = [
  { id: 'readme.txt', path: 'readme.txt', kind: 'file' },
  { id: '__MACOSX/', path: '__MACOSX/', kind: 'directory', hidden: true },
  { id: '__MACOSX/._readme.txt', path: '__MACOSX/._readme.txt', kind: 'file', hidden: true },
]

const session: AssetSession = {
  revision: revisionId('content-hash.sha256:archive'),
  state: () => 'live',
  descriptor: async () =>
    ({
      subjectUri: serializeSubjectRef(ref),
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
    }) as never,
  dataSource: async () =>
    ({
      value: Object.freeze({
        list: async () => ({ items: entries }),
        lookup: async (path: string) => entries.find(entry => entry.path === path),
        openEntry: async () => ({ value: { id: 'x' }, release: async () => undefined }),
      }),
      release: async () => undefined,
    }) as never,
  operations: () =>
    ({
      invoke: async () => ({ state: 'rejected', reason: 'unsupported', diagnostics: [] }),
      dispose: async () => undefined,
    }) as never,
  events: async function* () {
    yield* []
  },
  dispose: async () => undefined,
}

it('an application lists hidden container entries only when it asks for them', async () => {
  const channel = new MessageChannel()
  const exposure = exposeSubjectRpc({
    port: channel.port1 as never,
    listener: 'event-target',
    session: 'hidden-entries',
    open: async () => ({
      snapshot: {
        state: 'opened',
        sessionId: 'archive-session',
        descriptor: { subjectUri: serializeSubjectRef(ref) },
        selected: { contributionId: 'fixture/zip', variantId: 'main', confidence: 1 },
        candidates: [],
        diagnostics: [],
      },
      session,
    }),
  })
  const client = await connectSubjectRpc({
    port: channel.port2 as never,
    listener: 'event-target',
    session: 'hidden-entries',
  })
  closers.push(
    () => client.close('test finished'),
    () => exposure.close('test finished'),
    async () => {
      channel.port1.close()
      channel.port2.close()
    },
  )
  const opened = await client.open('archive.zip')
  if (opened.state !== 'opened') throw new Error('the archive did not open')
  const lease = await opened.session.dataSource('common.view/namespace-entry-source' as never, 1)
  const namespace = lease.value as {
    list(prefix: string, page: object): Promise<{ items: NamespaceEntry[] }>
    lookup(path: string): Promise<NamespaceEntry | undefined>
  }
  const paths = async (page: object) =>
    (await namespace.list('', page)).items.map(entry => entry.path)
  expect(await paths({ limit: 16 })).toEqual(['readme.txt'])
  expect(await paths({ limit: 16, includeHidden: true })).toEqual(entries.map(entry => entry.path))
  // an exact path still reaches a hidden entry
  expect((await namespace.lookup('__MACOSX/._readme.txt'))?.hidden).toBe(true)
  await lease.release()
  await opened.session.dispose()
})
