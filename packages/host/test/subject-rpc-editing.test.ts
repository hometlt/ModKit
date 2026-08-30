/**
 * S14 — editing over the subject RPC: a consumer that holds no grant, no backend and no prepared
 * commit can still save, because the serving side keeps all three and answers with ids. This is
 * what lets an Electron renderer (or any consumer of `x3.app/subject-services@1`) offer a save
 * button that does what it says.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type ChangeSet, type PermissionGrant } from '@modkitx-x3/sdk'
import {
  connectSubjectRpc,
  createEvidenceRegistry,
  createRawWriter,
  createSubjectEditing,
  exposeSubjectRpc,
  type ExtensionInput,
  type SubjectEditing,
  type SubjectRpcClient,
} from '@modkitx-x3/host'
import type { MessagePortLike } from '@modkitx-x3/host/execution'
import {
  createFileEditingBackend,
  createNodeSubjectServices,
  createPathSubjectOpener,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
} from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const textJsonDir = join(repoRoot, 'extensions', 'common', 'data', 'text-json')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/s14',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'filesystem.atomic-replace', 'worker.module'],
      budgets: {
        maxConcurrentTasks: 4,
        maxWorkerCount: 2,
        maxResidentBytes: uint64('1073741824'),
        maxTransferBytes: uint64('268435456'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/s14', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: WORKERS,
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('536870912'),
        maxTransferBytes: uint64('134217728'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/s14-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})
const WRITE: PermissionGrant = { id: 's14-write', classes: ['read-source', 'write-source'] }

const scratch = mkdtempSync(join(tmpdir(), 'x3-rpc-editing-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined)
})

/**
 * A serving side that opens subjects and decides, per session, whether it can write them: the
 * shape Electron main has (a file backend, the host's raw writer, an evidence policy).
 */
async function servingPair(options: { readonly editable: boolean }): Promise<{
  client: SubjectRpcClient
  path: string
}> {
  const input: ExtensionInput = {
    ...(await loadExtensionDirectory(textJsonDir)),
    execution: { origin: 'linked', allowTrustedInProcess: false },
  }
  const subjects = await createNodeSubjectServices({
    topology,
    realms: { host: HOST, workers: WORKERS },
    extensions: [input],
    policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 }),
  })
  const path = join(scratch, `doc-${options.editable ? 'rw' : 'ro'}.json`)
  writeFileSync(path, '{"name":"Modkit","items":[1,2,3]}', 'utf8')
  const backend = createFileEditingBackend({ roots: [scratch] })
  closers.push(() => backend.dispose())

  const editingBySession = new Map<string, SubjectEditing>()
  const open = createPathSubjectOpener({ subjects, roots: [scratch], grant: WRITE })
  const channel = new MessageChannel()
  const session = 's14-rpc'
  const real = exposeSubjectRpc({
    port: channel.port1 as unknown as MessagePortLike,
    session,
    async open(requested, signal) {
      const result = await open(requested, signal)
      if (result.snapshot.state === 'opened' && result.session !== undefined && options.editable) {
        // the host keeps the editing wiring; only its id crosses
        editingBySession.set(
          result.snapshot.sessionId,
          createSubjectEditing({
            opened: {
              state: 'opened',
              session: result.session,
              descriptor: result.snapshot.descriptor as never,
            } as never,
            grant: WRITE,
            backendFor: () => backend,
            evidenceFor: plan => createEvidenceRegistry().evidenceFor(plan),
            writer: createRawWriter(),
          }),
        )
      }
      return result
    },
    editing: sessionId => editingBySession.get(sessionId),
  })
  const client = await connectSubjectRpc({
    port: channel.port2 as unknown as MessagePortLike,
    session,
  })
  closers.push(
    () => client.close('test finished'),
    () => real.close('test finished'),
    async () => {
      channel.port1.close()
      channel.port2.close()
    },
  )
  return { client, path }
}

describe('editing over the subject RPC (S14)', () => {
  it('a consumer with no grant proposes, plans, prepares and commits — the file changes and the ids are single-use', async () => {
    const { client, path } = await servingPair({ editable: true })
    const opened = await client.open(path)
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error('open failed')

    const arm = await client.edit(opened.snapshot.sessionId)
    const state = await arm.state()
    expect(state.targets).toHaveLength(1)
    const target = state.targets[0]
    if (target === undefined) throw new Error('no target')

    const original = readFileSync(path, 'utf8')
    const at = original.indexOf('Modkit')
    const change: ChangeSet = {
      targets: state.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'utf16', offset: at, length: 'Modkit'.length },
          payload: { kind: 'text', text: 'Edited' },
        },
      ],
      provenance: { actor: 'user' },
    }
    expect(await arm.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await arm.plan(change)
    expect(plan.fidelity).toEqual({ roundTrip: 'byte-identical', preservesUnknownData: true })

    const prepared = await arm.prepare(plan)
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('prepare failed')
    // an id, not a prepared commit: nothing crossing the wire carries authority
    expect(typeof prepared.preparedId).toBe('string')
    expect(prepared as unknown as Record<string, unknown>).not.toHaveProperty('prepared')

    const committed = await arm.commit(prepared.preparedId)
    expect(committed.state).toBe('committed')
    expect(readFileSync(path, 'utf8')).toBe('{"name":"Edited","items":[1,2,3]}')

    // the id is spent: a replay cannot commit the same prepared write twice
    await expect(arm.commit(prepared.preparedId)).rejects.toThrow(/unknown prepared commit/u)
    await arm.dispose()
    await opened.session.dispose()
  }, 60_000)

  it('a subject this host cannot write refuses the editing arm instead of failing at save time', async () => {
    const { client, path } = await servingPair({ editable: false })
    const opened = await client.open(path)
    if (opened.state !== 'opened') throw new Error('open failed')
    await expect(client.edit(opened.snapshot.sessionId)).rejects.toThrow(/not editable/u)
    expect(readFileSync(path, 'utf8')).toBe('{"name":"Modkit","items":[1,2,3]}')
    await opened.session.dispose()
  }, 60_000)

  it('a change the writer refuses never becomes a committable plan across the wire', async () => {
    const { client, path } = await servingPair({ editable: true })
    const opened = await client.open(path)
    if (opened.state !== 'opened') throw new Error('open failed')
    const arm = await client.edit(opened.snapshot.sessionId)
    const state = await arm.state()
    const target = state.targets[0]
    if (target === undefined) throw new Error('no target')
    const refused: ChangeSet = {
      targets: state.targets,
      edits: [{ operation: 'delete', targetId: target.targetId, source: target.ownerSource }],
      provenance: { actor: 'user' },
    }
    const validation = await arm.propose(refused)
    expect(validation.valid).toBe(false)
    expect(validation.diagnostics.map(item => item.code)).toContain(
      'x3.host/raw-writer-operation-unsupported',
    )
    const plan = await arm.plan(refused)
    expect(await arm.prepare(plan)).toMatchObject({ state: 'rejected' })
    expect(readFileSync(path, 'utf8')).toBe('{"name":"Modkit","items":[1,2,3]}')
    await arm.dispose()
    await opened.session.dispose()
  }, 60_000)
})

describe('plan validation across the wire (A12 request 4)', () => {
  it('a plan naming another subject is refused by name, before the coordinator sees it', async () => {
    const { client, path } = await servingPair({ editable: true })
    const opened = await client.open(path)
    if (opened.state !== 'opened') throw new Error('open failed')
    const arm = await client.edit(opened.snapshot.sessionId)
    const state = await arm.state()
    const target = state.targets[0]
    if (target === undefined) throw new Error('no target')

    // an honestly-made plan, then re-targeted: the shape every field-level check would pass,
    // except the one that matters — whose subject it is
    const change: ChangeSet = {
      targets: state.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'utf16', offset: 0, length: 1 },
          payload: { kind: 'text', text: 'X' },
        },
      ],
      provenance: { actor: 'user' },
    }
    const plan = await arm.plan(change)
    const foreign = {
      ...plan,
      targets: plan.targets.map(item => ({
        ...item,
        targetId: 'someone-elses-target',
        ownerSource: { ...item.ownerSource, id: 'file:///elsewhere/other.json' },
      })),
      edits: plan.edits.map(item => ({
        ...item,
        targetId: 'someone-elses-target',
        source: { ...item.source, id: 'file:///elsewhere/other.json' },
      })),
    }

    /*
     * Before the served `prepare` ran `planFromOperation`, this refusal came back as a
     * grant-scope side effect (`permission-missing`) — true, but useless to act on. The named
     * refusal says what actually happened: this plan is not this subject.
     */
    await expect(arm.prepare(foreign as never)).rejects.toMatchObject({
      code: 'x3.host/edit-plan-subject-mismatch',
    })

    // and a stale-revision plan is the same refusal, not a late conflict
    const stale = {
      ...plan,
      targets: plan.targets.map(item => ({
        ...item,
        expectedRevision: {
          ...item.expectedRevision,
          compositionFingerprint: 'fingerprint-of-some-other-open',
        },
      })),
    }
    await expect(arm.prepare(stale as never)).rejects.toMatchObject({
      code: 'x3.host/edit-plan-subject-mismatch',
    })

    await arm.dispose()
    await opened.session.dispose()
  }, 60_000)
})
