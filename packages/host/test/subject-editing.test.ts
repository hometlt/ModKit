/**
 * ADR-HOST-002 — binary editing on the 13D seam, proven end to end on a real PNG:
 *
 *  Path A  the bundled PNG codec's `edit.field` (set/replace a tEXt keyword) runs worker-brokered,
 *          returns an edit plan across the boundary, the host commits it through the file backend
 *          under `write-source`, and a reopen sees the chunk with every other byte untouched;
 *  Path B  a writer provider (`common.edit/writer@1`, fixture) resolves by facet, is leased across
 *          the boundary with the standard surface, and backs a writer edit session;
 *  refusals: no `write-source` → the open still works (degraded) and the operation is refused
 *          host-side; a changed file between plan and prepare → conflict; a grant snapshot without
 *          `write-source` → permission-missing; a foreign plan → subject mismatch.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  type ChangeSet,
  type FidelityEvidence,
  type PermissionGrant,
  type Writer,
} from '@modkitx-x3/sdk'
import {
  createHostServiceResolver,
  createSubjectEditing,
  createGrantSnapshot,
  type ExtensionInput,
  type OpenedSubject,
} from '@modkitx-x3/host'
import {
  createFileEditingBackend,
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
  type NodeSubjectServices,
} from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const imagesDir = join(repoRoot, 'extensions', 'common', 'images')
const writerFixtureDir = join(import.meta.dirname, 'fixtures', 'writer-extension')
const favicon = join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/s8',
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
      policy: { id: 'org.example.policy/s8', revision: '1' },
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
      policy: { id: 'org.example.policy/s8-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})
const policy = workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 })
const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const READ: PermissionGrant = { id: 's8-read', classes: ['read-source'] }
const WRITE: PermissionGrant = { id: 's8-write', classes: ['read-source', 'write-source'] }

const scratch = mkdtempSync(join(tmpdir(), 'x3-subject-editing-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const linked = async (directory: string): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(directory)),
  execution: { origin: 'linked', allowTrustedInProcess: false },
})

let cached: Promise<NodeSubjectServices> | undefined
const services = () =>
  (cached ??= (async () =>
    createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [await linked(imagesDir), await linked(writerFixtureDir)],
      policy,
    }))())

async function openCopy(name: string, grant: PermissionGrant) {
  const path = join(scratch, name)
  writeFileSync(path, readFileSync(favicon))
  const result = await (
    await services()
  ).open({
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    grant,
    budget,
  })
  if (result.state !== 'opened') throw new Error(`open failed: ${result.reason}`)
  return { path, result }
}

/** Host evidence policy of this proof: first-party evidence for the PNG tEXt plan. */
function pngEvidence(opened: OpenedSubject, artifactDigest: string): FidelityEvidence {
  return {
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    evidenceId: 'png-set-text-v1',
    corpusId: 'modkitX3/apps/web/public/favicon-32.png',
    corpusDigest: `sha256:${createHash('sha256').update(readFileSync(favicon)).digest('hex')}`,
    conformanceProfile: 'org.modkitx/codec-contribution-v1' as never,
    writer: {
      providerId: opened.selected.contributionId,
      providerVersion: '1.0.0',
      artifactDigest,
      formatId: 'png',
      representationId: 'source',
    },
    optionsFingerprint: 'options:none',
    inputClass: 'png-rgba8',
    provenAt: '2026-08-19T00:00:00Z',
  }
}

function pngChunks(bytes: Uint8Array): { type: string; offset: number; length: number }[] {
  const out: { type: string; offset: number; length: number }[] = []
  let offset = 8
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    out.push({ type, offset, length })
    offset += 12 + length
    if (type === 'IEND') break
  }
  return out
}

const show = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

const textOf = (bytes: Uint8Array, chunk: { offset: number; length: number }) =>
  String.fromCharCode(...bytes.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.length))

describe('ADR-HOST-002 Path A — codec operation → edit plan → host commit', () => {
  it('PNG edit.field sets a tEXt chunk worker-brokered; the file backend commits atomically; a reopen sees it and every other byte is untouched', async () => {
    const { path, result } = await openCopy('set-text.png', WRITE)
    const original = readFileSync(path)
    expect(result.selected.variantId).toBe('portable')
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    expect(result.descriptor.operations.map(item => item.id)).toContain('edit.field')
    expect(result.descriptor.constraints.readOnly).toBe(false)

    const invoked = await result.session
      .operations()
      .invoke('set-text', { keyword: 'Comment', text: 'edited by S8' })
    expect(invoked.state).toBe('ok')
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    expect(invoked.output.kind).toBe('edit-plan')

    const artifactDigest = (await services()).inventory.extensions
      .find(item => item.contributions.some(c => c.manifest?.id === 'org.modkitx/image-png'))
      ?.contributions.find(c => c.manifest?.id === 'org.modkitx/image-png')?.record?.artifactDigest
    if (artifactDigest === undefined) throw new Error('no images artifact digest')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => pngEvidence(result, artifactDigest),
    })
    const plan = editing.planFromOperation(invoked.output)
    expect(plan.edits).toHaveLength(1)
    const edit = plan.edits[0]
    if (edit?.operation !== 'replace' || edit.range?.kind !== 'bytes') throw new Error('bad edit')
    // an insert before IEND: zero-length range at IEND's offset
    const iend = pngChunks(original).find(chunk => chunk.type === 'IEND')
    expect(edit.range.offset).toBe(BigInt(iend?.offset ?? -1))
    expect(edit.range.length).toBe(0n)

    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    expect(prepared.prepared.authorization).toMatchObject({
      granted: true,
      achievableGuarantee: 'atomic',
    })
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, show(committed)).toBe('committed')
    if (committed.state !== 'committed') return
    expect(committed.receipt.commitGuarantee).toBe('atomic')
    expect(committed.receipt.after[0]?.bindings['content']).not.toBe(
      committed.receipt.before[0]?.bindings['content'],
    )
    await result.session.dispose()

    // bytes: original with the tEXt chunk spliced in before IEND, nothing else touched
    const after = readFileSync(path)
    const payload = edit.payload.kind === 'inline' ? edit.payload.bytes : new Uint8Array()
    expect(after.byteLength).toBe(original.byteLength + payload.byteLength)
    expect(
      Buffer.compare(after.subarray(0, iend?.offset), original.subarray(0, iend?.offset)),
    ).toBe(0)
    expect(
      Buffer.compare(
        after.subarray(after.byteLength - 12),
        original.subarray(original.byteLength - 12),
      ),
    ).toBe(0)
    const chunks = pngChunks(new Uint8Array(after))
    const text = chunks.find(chunk => chunk.type === 'tEXt')
    expect(text).toBeDefined()
    if (text === undefined) throw new Error('no tEXt chunk')
    expect(textOf(new Uint8Array(after), text)).toBe('Comment\0edited by S8')

    // reopen: the codec parses the edited file (CRC and structure intact) and counts the chunk
    const reopened = await (
      await services()
    ).open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    expect(reopened.state).toBe('opened')
    if (reopened.state !== 'opened') return
    const described = reopened.descriptor as unknown as {
      readonly metadata?: readonly {
        readonly entries: readonly { readonly key: string; readonly value: unknown }[]
      }[]
    }
    const meta = described.metadata?.[0]?.entries.find(entry => entry.key === 'chunks')
    expect(meta?.value).toBe(chunks.length)

    // replace path: the same keyword again replaces the chunk in place (no second tEXt)
    const again = await reopened.session
      .operations()
      .invoke('set-text', { keyword: 'Comment', text: 'replaced' })
    if (again.state !== 'ok') throw new Error('second invoke rejected')
    const editing2 = createSubjectEditing({
      opened: reopened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => pngEvidence(reopened, artifactDigest),
    })
    const plan2 = editing2.planFromOperation(again.output)
    const prepared2 = await editing2.coordinator.prepare(plan2, { grant: editing2.grantSnapshot })
    if (prepared2.state !== 'ready') throw new Error('second prepare not ready')
    const committed2 = await editing2.coordinator.commit(prepared2.prepared, {
      grant: editing2.grantSnapshot,
    })
    expect(committed2.state).toBe('committed')
    await reopened.session.dispose()
    const final = new Uint8Array(readFileSync(path))
    const texts = pngChunks(final).filter(chunk => chunk.type === 'tEXt')
    expect(texts).toHaveLength(1)
    const only = texts[0]
    if (only === undefined) throw new Error('no tEXt chunk')
    expect(textOf(final, only)).toBe('Comment\0replaced')
    await backend.dispose()
  }, 60_000)

  it('without write-source the PNG still opens (degraded) and the mutating operation is refused by the host', async () => {
    const { result } = await openCopy('read-only.png', READ)
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/permission-degraded')
    const invoked = await result.session
      .operations()
      .invoke('set-text', { keyword: 'a', text: 'b' })
    expect(invoked.state).toBe('rejected')
    if (invoked.state === 'rejected') expect(invoked.reason).toBe('permission-missing')
    // read operations are untouched
    const inspected = await result.session.operations().invoke('inspect', {})
    expect(inspected.state).toBe('ok')
    await result.session.dispose()
  }, 60_000)

  it('a file that changed between plan and prepare is a conflict; a snapshot without write-source is permission-missing; a foreign plan is refused', async () => {
    const { path, result } = await openCopy('stale.png', WRITE)
    const invoked = await result.session
      .operations()
      .invoke('set-text', { keyword: 'k', text: 'v' })
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => undefined,
    })
    const plan = editing.planFromOperation(invoked.output)

    // no evidence → fidelity-unproven, nothing written
    const unproven = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(unproven).toMatchObject({ state: 'rejected', reason: 'fidelity-unproven' })

    // a snapshot without write-source → permission-missing
    const readOnlySnapshot = createGrantSnapshot({
      snapshotId: 'read-only',
      permissions: ['read-source'],
      sourceIds: [pathToFileURL(path).href],
    })
    const provenEditing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => pngEvidence(result, 'sha256:any'),
      isGrantValid: () => true,
    })
    const denied = await provenEditing.coordinator.prepare(plan, { grant: readOnlySnapshot })
    expect(denied).toMatchObject({ state: 'rejected', reason: 'permission-missing' })

    // the file changes underneath → conflict at prepare (stale revision), nothing written
    const before = readFileSync(path)
    writeFileSync(path, Buffer.concat([before, Buffer.from([0])]))
    const stale = await provenEditing.coordinator.prepare(plan, {
      grant: provenEditing.grantSnapshot,
    })
    expect(stale.state).toBe('conflict')
    expect(readFileSync(path).byteLength).toBe(before.byteLength + 1)

    // a plan for another subject is refused before the coordinator sees it
    const { result: other } = await openCopy('other.png', WRITE)
    const foreign = await other.session.operations().invoke('set-text', { keyword: 'k', text: 'v' })
    if (foreign.state !== 'ok') throw new Error('foreign invoke rejected')
    expect(() => provenEditing.planFromOperation(foreign.output)).toThrow(/subject/u)
    await other.session.dispose()
    await result.session.dispose()
    await backend.dispose()
  }, 60_000)
})

describe('ADR-HOST-002 Path B — writer provider by facet, across the boundary, backing an edit session', () => {
  it('resolves common.edit/writer@1 for png/source, leases it worker-brokered, and commits a writer-planned change set', async () => {
    const { path, result } = await openCopy('writer.png', WRITE)
    const svc = await services()
    if (svc.serviceDefinitions === undefined) throw new Error('no definitions registry')
    const resolver = createHostServiceResolver({
      inventory: svc.inventory,
      target: svc.target,
      executionBackends: svc.executionBackends,
      definitions: svc.serviceDefinitions,
      grant: WRITE,
      budgets: budget,
    })
    const lease = await resolver.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'png',
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
    })
    const writer = lease.value as Writer
    // identity/offer travel as handle data; validate/plan are boundary methods
    expect(writer.offer).toMatchObject({ providerId: 'org.example/png-passthrough-writer' })
    expect(writer.identity.formatId).toBe('png')
    expect(resolver.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    expect(resolver.locks).toHaveLength(1)

    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => ({
        ...pngEvidence(result, 'sha256:png-passthrough-writer-fixture'),
        evidenceId: 'png-passthrough-v1',
        writer: writer.identity,
      }),
      writer,
    })
    if (editing.session === undefined) throw new Error('no writer session')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no edit target')
    const original = new Uint8Array(readFileSync(path))
    // an editor-authored change: a whole-source replace that appends nothing but rewrites the
    // file from the same bytes (the simplest honest byte-identical round trip)
    const change: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          payload: { kind: 'inline', bytes: original },
        },
      ],
      provenance: { actor: 'automation', note: 'S8 writer proof' },
    }
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await editing.session.plan(change)
    expect(plan.edits).toHaveLength(1)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state).toBe('committed')
    expect(Buffer.compare(readFileSync(path), Buffer.from(original))).toBe(0)

    // a request the facet rule cannot satisfy is refused at resolution
    await expect(
      resolver.port.resolve({
        contract: 'common.edit/writer',
        major: 1,
        facet: {
          formatId: 'bmp',
          representationId: 'source',
          mutationMode: 'mutate',
          minimumRoundTrip: 'semantic',
        },
      }),
    ).rejects.toMatchObject({ code: 'x3.host/service-contract-unresolved' })
    await lease.release()
    await resolver.release()
    await result.session.dispose()
    await backend.dispose()
  }, 60_000)
})
