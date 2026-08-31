/**
 * A6 — text writers on the 13D seam (ADR-HOST-002 Path B), proven on real text files:
 *
 *  every bundled text codec family now ships a `common.edit/writer@1` provider, so the universal
 *  text editor can save through the host coordinator instead of writing files itself. For JSON,
 *  INI and CSV this proof loads the extension, opens a temp copy worker-brokered, resolves the
 *  writer *by facet* (format + representation + mutation mode + round trip), backs a
 *  `createSubjectEditing` session with it, proposes and plans a UTF-16 range edit that replaces
 *  one value, commits through the node file backend, and reopens: the bytes changed exactly in
 *  that range and the codec still parses the result.
 *
 *  refusals: an edit the text writer cannot carry (`create`) is refused by `validate` with a
 *  diagnostic, not silently dropped; a writer request for a format no loaded extension owns is
 *  unresolved at the facet matcher.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import {
  createHostTopology,
  type ChangeSet,
  type FidelityEvidence,
  type PermissionGrant,
  type Writer,
} from '@modkit/sdk'
import {
  createHostServiceResolver,
  createSubjectEditing,
  type ExtensionInput,
  type OpenedSubject,
} from '@modkit/host'
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
} from '@modkit/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const dataExtensionDir = join(repoRoot, 'extensions', 'data')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/a6',
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
      policy: { id: 'org.example.policy/a6', revision: '1' },
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
      policy: { id: 'org.example.policy/a6-worker', revision: '1' },
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
const WRITE: PermissionGrant = { id: 'a6-write', classes: ['read-source', 'write-source'] }

const scratch = mkdtempSync(join(tmpdir(), 'x3-text-writers-'))
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
      extensions: [await linked(dataExtensionDir)],
      policy,
    }))())

/** Write (or reuse, when no text is given) a file under the scratch root and open it. */
async function openCopy(
  name: string,
  text?: string,
): Promise<{ path: string; opened: OpenedSubject }> {
  const path = join(scratch, name)
  if (text !== undefined) writeFileSync(path, text, 'utf8')
  const result = await (
    await services()
  ).open({
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    grant: WRITE,
    budget,
  })
  if (result.state !== 'opened') throw new Error(`open failed: ${result.reason}`)
  return { path, opened: result }
}

async function resolver() {
  const svc = await services()
  if (svc.serviceDefinitions === undefined) throw new Error('no definitions registry')
  return createHostServiceResolver({
    inventory: svc.inventory,
    target: svc.target,
    executionBackends: svc.executionBackends,
    definitions: svc.serviceDefinitions,
    grant: WRITE,
    budgets: budget,
  })
}

/** Host evidence policy of this proof: the writer's own pass-through claim, bound to its identity. */
function textEvidence(writer: Writer, source: string): FidelityEvidence {
  return {
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    evidenceId: writer.offer.fidelityEvidenceId,
    corpusId: `modkit/packages/host/test/text-writers:${writer.identity.formatId}`,
    corpusDigest: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    conformanceProfile: 'common.edit/writer-v1' as never,
    writer: writer.identity,
    optionsFingerprint: 'options:none',
    inputClass: `${writer.identity.formatId}-utf8`,
    provenAt: '2026-08-19T00:00:00Z',
  }
}

const show = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

interface TextWriterCase {
  readonly formatId: string
  readonly codecId: string
  readonly providerId: string
  readonly evidenceId: string
  readonly file: string
  readonly source: string
  readonly find: string
  readonly replacement: string
  /** Read-back operation after the commit; syntax formats parse, plain text inspects. */
  readonly reopenOperation?: string
}

const CASES: readonly TextWriterCase[] = [
  {
    formatId: 'json',
    codecId: 'modkit/text-json',
    providerId: 'modkit/text-json-writer',
    evidenceId: 'text-json-text-writer-v1',
    file: 'sample.json',
    source: '{\n  "name": "alpha",\n  "count": 1\n}\n',
    find: 'alpha',
    replacement: 'omega-one',
  },
  {
    formatId: 'ini',
    codecId: 'modkit/text-ini',
    providerId: 'modkit/text-ini-writer',
    evidenceId: 'text-ini-text-writer-v1',
    file: 'sample.ini',
    source: '[server]\nhost = localhost\nport = 8080\n',
    find: 'localhost',
    replacement: '127.0.0.1',
  },
  {
    formatId: 'csv',
    codecId: 'modkit/text-csv',
    providerId: 'modkit/text-delimited-writer',
    evidenceId: 'text-delimited-text-writer-v1',
    file: 'sample.csv',
    source: 'id,name,size\n1,alpha,10\n2,beta,20\n',
    find: 'alpha',
    replacement: 'omega',
  },
  {
    // Block 11 slice 11A: plain text could be edited before the migration and it can again — but
    // through its own writer contribution, never through the read-only codec.
    formatId: 'txt',
    codecId: 'modkit/txt',
    providerId: 'modkit/plain-text-writer',
    evidenceId: 'plain-text-writer-v1',
    file: 'sample.txt',
    source: 'First paragraph.\nStill first.\n\nSecond paragraph.\n',
    find: 'Second',
    replacement: 'Third',
    reopenOperation: 'inspect',
  },
]

describe('A6 — text writers resolve by facet and save through the host coordinator', () => {
  for (const testCase of CASES) {
    it(`${testCase.formatId}: a UTF-16 range edit is proposed, planned, committed and reopened`, async () => {
      const { path, opened } = await openCopy(testCase.file, testCase.source)
      expect(opened.selected.contributionId).toBe(testCase.codecId)
      const native = testCase.formatId === 'json' || testCase.formatId === 'txt'
      expect(opened.selected.variantId).toBe(native ? 'core-native' : 'portable')
      if (!native) {
        expect(opened.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
      }
      // the codec itself stays read-only: saving is the writer's contract, not the codec's
      expect(opened.descriptor.constraints.readOnly).toBe(true)

      const port = await resolver()
      const lease = await port.port.resolve({
        contract: 'common.edit/writer',
        major: 1,
        facet: {
          formatId: testCase.formatId,
          representationId: 'source',
          mutationMode: 'mutate',
          minimumRoundTrip: 'byte-identical',
        },
      })
      const writer = lease.value as Writer
      // identity/offer travel as handle data; validate/plan are boundary methods
      expect(writer.offer).toEqual({
        providerId: testCase.providerId,
        fidelityEvidenceId: testCase.evidenceId,
        formatId: testCase.formatId,
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      })
      expect(writer.identity.formatId).toBe(testCase.formatId)
      expect(port.diagnostics.map(item => item.code)).toContain(
        native ? 'x3.host/full-process-authority' : 'x3.host/worker-shared-process',
      )

      const backend = createFileEditingBackend({ roots: [scratch] })
      const editing = createSubjectEditing({
        opened,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: () => textEvidence(writer, testCase.source),
        writer,
      })
      if (editing.session === undefined) throw new Error('no writer session')
      const target = editing.targets[0]
      if (target === undefined) throw new Error('no edit target')

      const offset = testCase.source.indexOf(testCase.find)
      expect(offset).toBeGreaterThan(0)
      const change: ChangeSet = {
        targets: editing.targets,
        edits: [
          {
            operation: 'replace',
            targetId: target.targetId,
            source: target.ownerSource,
            range: { kind: 'utf16', offset, length: testCase.find.length },
            payload: { kind: 'text', text: testCase.replacement },
            label: `replace ${testCase.find}`,
          },
        ],
        provenance: { actor: 'user', note: 'A6 text writer proof' },
      }
      expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })

      // an edit a text writer cannot carry is refused with a diagnostic, not silently dropped
      const refused = await editing.session.propose({
        targets: editing.targets,
        edits: [
          {
            operation: 'create',
            targetId: target.targetId,
            source: target.ownerSource,
            newPath: `${path}.new`,
            payload: { kind: 'text', text: 'not a text edit' },
          },
        ],
        provenance: { actor: 'user' },
      })
      expect(refused.valid).toBe(false)
      expect(refused.diagnostics.map(item => item.code)).toEqual([
        'modkit/text-writer-operation-unsupported',
      ])

      // pass-through: the plan carries the editor's edits unchanged, at the writer's claim
      const plan = await editing.session.plan(change)
      expect(plan.edits).toEqual(change.edits)
      expect(plan.fidelity).toEqual({ roundTrip: 'byte-identical', preservesUnknownData: true })
      expect(plan.semantics).toEqual({ mutationMode: 'mutate', minimumGuarantee: 'atomic' })

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
      await opened.session.dispose()

      // the file changed exactly in the range the edit named, and nowhere else
      const after = readFileSync(path, 'utf8')
      const head = testCase.source.slice(0, offset)
      const tail = testCase.source.slice(offset + testCase.find.length)
      expect(after.slice(0, offset)).toBe(head)
      expect(after.slice(offset, offset + testCase.replacement.length)).toBe(testCase.replacement)
      expect(after.slice(offset + testCase.replacement.length)).toBe(tail)
      expect(after).toBe(head + testCase.replacement + tail)

      // the codec still opens and reads the edited file through the operation it actually declares:
      // the syntax formats parse a document, plain text has no syntax and inspects instead
      const { opened: reopened } = await openCopy(testCase.file)
      expect(reopened.selected.contributionId).toBe(testCase.codecId)
      const parsed = await reopened.session
        .operations()
        .invoke(testCase.reopenOperation ?? 'parse', {})
      expect(parsed.state, show(parsed)).toBe('ok')
      if (parsed.state === 'ok') expect(parsed.output.kind).toBe('json')
      await reopened.session.dispose()

      await lease.release()
      await port.release()
      await backend.dispose()
    }, 60_000)
  }

  it('an export-only request is satisfied by a mutating offer; a format no extension owns is unresolved', async () => {
    const port = await resolver()
    // the facet rule: `mutate` also serves an `export-only` request at the same round trip
    const lease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'tsv',
        representationId: 'source',
        mutationMode: 'export-only',
        minimumRoundTrip: 'semantic',
      },
    })
    expect((lease.value as Writer).offer.providerId).toBe('modkit/text-delimited-writer')
    await lease.release()

    // RTF is not part of the common data extension loaded by this lab.
    await expect(
      port.port.resolve({
        contract: 'common.edit/writer',
        major: 1,
        facet: {
          formatId: 'rtf',
          representationId: 'source',
          mutationMode: 'mutate',
          minimumRoundTrip: 'byte-identical',
        },
      }),
    ).rejects.toMatchObject({ code: 'x3.host/service-contract-unresolved' })

    // a representation the writers do not offer is unresolved for a format they do own
    await expect(
      port.port.resolve({
        contract: 'common.edit/writer',
        major: 1,
        facet: {
          formatId: 'json',
          representationId: 'syntax-document',
          mutationMode: 'mutate',
          minimumRoundTrip: 'byte-identical',
        },
      }),
    ).rejects.toMatchObject({ code: 'x3.host/service-contract-unresolved' })
    await port.release()
  }, 60_000)
})
