/**
 * F3 — the host's evidence policy and raw writer: an editor that knows nothing about the format
 * (hex, plain text) saves through the 13D coordinator, the policy proves exactly the claim the
 * plan makes and nothing stronger, and the bounded-editor hazard is refused rather than risked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  type AssetEditPlan,
  type ChangeSet,
  type PermissionGrant,
  type Writer,
} from '@modkitx-x3/sdk'
import {
  buildInventory,
  codecFidelityEvidenceRecords,
  createHostContributionContractRegistry,
  createEvidenceRegistry,
  createRawWriter,
  createSubjectEditing,
  HOST_RAW_WRITER_EVIDENCE_RECORD,
  HOST_RAW_WRITER_IDENTITY,
  serviceProviderFidelityEvidenceRecord,
  type ExtensionInput,
  type Inventory,
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
const textJsonDir = join(repoRoot, 'extensions', 'common', 'text-json')
const documentsDir = join(repoRoot, 'extensions', 'common', 'documents')
const archivesDir = join(repoRoot, 'extensions', 'common', 'archives')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/f3',
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
      policy: { id: 'org.example.policy/f3', revision: '1' },
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
      policy: { id: 'org.example.policy/f3-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})
const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const WRITE: PermissionGrant = { id: 'f3-write', classes: ['read-source', 'write-source'] }

const scratch = mkdtempSync(join(tmpdir(), 'x3-editing-evidence-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

let cached: Promise<NodeSubjectServices> | undefined
const services = () =>
  (cached ??= (async () => {
    const linked = async (directory: string): Promise<ExtensionInput> => ({
      ...(await loadExtensionDirectory(directory)),
      execution: { origin: 'linked', allowTrustedInProcess: false },
    })
    return createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [await linked(textJsonDir), await linked(documentsDir)],
      policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 }),
    })
  })())

async function openJson(name: string, text: string) {
  const path = join(scratch, name)
  writeFileSync(path, text, 'utf8')
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
  return { path, result }
}

describe('F3 evidence registry', () => {
  it('proves exactly the claim a plan makes, never a weaker record for a stronger claim', () => {
    const registry = createEvidenceRegistry()
    const byteIdentical = registry.evidenceFor({
      planId: 'p',
      targets: [],
      edits: [],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    })
    expect(byteIdentical?.evidenceId).toBe(HOST_RAW_WRITER_EVIDENCE_RECORD.evidenceId)
    expect(byteIdentical?.writer).toEqual(HOST_RAW_WRITER_IDENTITY)
    // the built-in record is structural and says so instead of naming a corpus it never ran
    expect(byteIdentical?.corpusDigest).toBe('none:by-construction')
    // a semantic plan is not proven by the byte-identical record
    expect(
      registry.evidenceFor({
        planId: 'p',
        targets: [],
        edits: [],
        semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
        fidelity: { roundTrip: 'semantic', preservesUnknownData: false },
        diagnostics: [],
      }),
    ).toBeUndefined()
    // registries are immutable; `with` yields a policy that also covers the added record
    const extended = registry.with({
      ...HOST_RAW_WRITER_EVIDENCE_RECORD,
      evidenceId: 'png-encoder-v1',
      claim: { roundTrip: 'semantic', preservesUnknownData: false },
      corpusId: 'lab:png-encoder',
      corpusDigest: 'sha256:deadbeef',
    })
    expect(registry.list()).toHaveLength(1)
    expect(extended.list()).toHaveLength(2)
    expect(
      extended.evidenceFor({
        planId: 'p',
        targets: [],
        edits: [],
        semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
        fidelity: { roundTrip: 'semantic', preservesUnknownData: false },
        diagnostics: [],
      })?.evidenceId,
    ).toBe('png-encoder-v1')
  })

  it('joins bundled codec proof citations with inventory-owned writer coordinates', async () => {
    const input: ExtensionInput = {
      ...(await loadExtensionDirectory(archivesDir)),
      execution: { origin: 'bundled', allowTrustedInProcess: true },
    }
    const proofHost = await createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [input],
      policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 }),
    })
    const records = codecFidelityEvidenceRecords(proofHost.inventory, {
      codecId: 'org.modkitx/archive-zip',
      formatId: 'zip',
    })
    expect(records.map(record => record.evidenceId)).toEqual([
      'zip-verbatim-reassembly-v1',
      'zip-verbatim-reassembly-non-canonical-v1',
    ])
    const zip = proofHost.inventory.extensions[0]?.contributions.find(
      contribution => contribution.manifest?.id === 'org.modkitx/archive-zip',
    )
    expect(records[0]?.writer).toEqual({
      providerId: 'org.modkitx/archive-zip',
      providerVersion: proofHost.inventory.extensions[0]?.manifest.version,
      artifactDigest: zip?.record?.artifactDigest,
      formatId: 'zip',
      representationId: 'archive-namespace',
    })

    const installed = {
      ...proofHost.inventory,
      extensions: proofHost.inventory.extensions.map(extension => ({
        ...extension,
        origin: 'installed' as const,
      })),
    } satisfies Inventory
    expect(
      codecFidelityEvidenceRecords(installed, {
        codecId: 'org.modkitx/archive-zip',
        formatId: 'zip',
      }),
    ).toEqual([])
    expect(
      codecFidelityEvidenceRecords(installed, {
        codecId: 'org.modkitx/archive-zip',
        formatId: 'zip',
        acceptedOrigins: ['installed'],
      }),
    ).toHaveLength(2)
  })

  it('admits only the exact inventory-bound service writer declaration', async () => {
    const contributionPath = 'contributions/writer.json'
    const providerId = 'org.example/trusted-writer'
    const artifactDigest = 'sha256:trusted-writer-artifact'
    const declaration = {
      offerId: 'native-source',
      evidenceId: 'native-source-proof-v1',
      claim: { roundTrip: 'semantic' as const, preservesUnknownData: true },
      corpusId: 'org.example.corpus/native-source-v1',
      corpusDigest: 'sha256:trusted-corpus',
      conformanceProfile: 'org.example/native-source-writer-v1',
      optionsFingerprint: 'options:default',
      inputClass: 'native-source',
      provenAt: '2026-08-28T00:00:00Z',
    }
    const serviceManifest = (withDeclaration: boolean) => ({
      schemaVersion: 1,
      contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
      id: providerId,
      displayName: 'Trusted writer',
      runtimeVariants: [
        {
          variantId: 'node',
          entrypoint: './dist/provider.js',
          target: { environments: ['node'] },
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: [],
        },
      ],
      spec: {
        lifecycleScope: 'session',
        provides: [
          {
            offerId: declaration.offerId,
            contract: 'common.edit/writer',
            major: 1,
            version: '1.0.0',
            facet: {
              providerId,
              fidelityEvidenceId: declaration.evidenceId,
              formatId: 'archive',
              representationId: 'native-source',
              mutationMode: 'mutate',
              minimumRoundTrip: 'semantic',
            },
          },
        ],
        ...(withDeclaration ? { fidelityEvidence: [declaration] } : {}),
      },
    })
    const inventory = async (withDeclaration: boolean) =>
      buildInventory(
        [
          {
            source: 'trusted-writer',
            containers: {
              standalone: {
                schemaVersion: 1,
                publisher: 'org.example',
                id: 'trusted-writer-pack',
                version: '1.0.0',
                license: 'MIT',
                contributionManifests: ['./contributions/*.json'],
              },
            },
            files: [contributionPath, 'dist/provider.js'],
            documents: new Map([[contributionPath, serviceManifest(withDeclaration)]]),
            documentDigests: new Map([[contributionPath, 'sha256:writer-manifest']]),
            artifact: {
              inventoryRecordId: 'artifact:trusted-writer',
              artifactDigest,
              artifactRoot: new URL('file:///trusted-writer/'),
              verifyArtifactDigest: (expected: string) => expected === artifactDigest,
            },
            execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
          },
        ],
        createHostContributionContractRegistry(),
      )
    const writer = (
      overrides: Partial<Writer['identity']> = {},
      evidenceId = declaration.evidenceId,
    ) =>
      ({
        identity: {
          providerId,
          providerVersion: '1.0.0',
          artifactDigest,
          formatId: 'archive',
          representationId: 'native-source',
          ...overrides,
        },
        offer: {
          providerId,
          fidelityEvidenceId: evidenceId,
          formatId: 'archive',
          representationId: 'native-source',
          mutationMode: 'mutate',
          minimumRoundTrip: 'semantic',
        },
        validate: async () => ({ valid: true, diagnostics: [] }),
        plan: async () => {
          throw new Error('not used by evidence materialization')
        },
      }) satisfies Writer
    const plan: AssetEditPlan = {
      planId: 'semantic-native',
      targets: [],
      edits: [],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: declaration.claim,
      diagnostics: [],
    }

    const trusted = await inventory(true)
    const selected = writer()
    const record = serviceProviderFidelityEvidenceRecord(trusted, { writer: selected })
    expect(record?.evidenceId).toBe(declaration.evidenceId)
    expect(record?.writer).toEqual(selected.identity)
    expect(
      createEvidenceRegistry(record === undefined ? [] : [record]).evidenceFor(
        plan,
        selected.identity,
      )?.evidenceId,
    ).toBe(declaration.evidenceId)

    expect(
      serviceProviderFidelityEvidenceRecord(trusted, {
        writer: writer({ artifactDigest: 'sha256:other' }),
      }),
    ).toBeUndefined()
    expect(
      serviceProviderFidelityEvidenceRecord(trusted, {
        writer: writer({ providerVersion: '2.0.0' }),
      }),
    ).toBeUndefined()
    expect(
      serviceProviderFidelityEvidenceRecord(trusted, {
        writer: writer({}, 'wrong-proof'),
      }),
    ).toBeUndefined()

    const undeclared = await inventory(false)
    expect(serviceProviderFidelityEvidenceRecord(undeclared, { writer: selected })).toBeUndefined()
    expect(createEvidenceRegistry([]).evidenceFor(plan, selected.identity)).toBeUndefined()
  })
})

describe('F3 raw writer — a format-blind editor saves through the coordinator', () => {
  it('commits a UTF-16 range edit through the coordinator and the codec still opens the result', async () => {
    const { path, result } = await openJson('doc.json', '{"name":"Modkit","items":[1,2,3]}')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: plan => createEvidenceRegistry().evidenceFor(plan),
      writer: createRawWriter(),
    })
    if (editing.session === undefined || editing.editorPorts === undefined) {
      throw new Error('a writer must produce a session and editor ports')
    }
    // the ports are what a ui editor module receives; authorization hands back the host snapshot
    const authorized = await editing.editorPorts.authorization.request({} as never)
    expect(authorized?.grant).toBe(editing.grantSnapshot)

    const target = editing.targets[0]
    if (target === undefined) throw new Error('no edit target')
    const original = readFileSync(path, 'utf8')
    const at = original.indexOf('Modkit')
    const change: ChangeSet = {
      targets: editing.targets,
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
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await editing.session.plan(change)
    expect(plan.fidelity).toEqual({ roundTrip: 'byte-identical', preservesUnknownData: true })
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state).toBe('committed')
    expect(readFileSync(path, 'utf8')).toBe('{"name":"Edited","items":[1,2,3]}')
    await result.session.dispose()

    // the edited file is still a subject the codec opens
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
    await reopened.session.dispose()
    await backend.dispose()
  }, 60_000)

  /*
   * Block 11 slice 11A.2. Markdown is not ported again — it already lives in
   * `extensions/common/documents`. What the slice owes it is an edit transaction on the existing
   * seam: the format-blind editor authors a range edit, the coordinator commits it, and the
   * markdown codec opens the result. The codec itself stays read-only throughout.
   */
  it('commits a markdown range edit through the same seam and reopens it as markdown', async () => {
    const source = '# Port Plan\n\nSee [spec](https://example.invalid/spec).\n'
    const { path, result } = await openJson('notes.md', source)
    expect(result.selected.contributionId).toBe('org.modkitx/document-markdown')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: plan => createEvidenceRegistry().evidenceFor(plan),
      writer: createRawWriter(),
    })
    if (editing.session === undefined) throw new Error('a writer must produce a session')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no edit target')
    const at = source.indexOf('Port Plan')
    const change: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'utf16', offset: at, length: 'Port Plan'.length },
          payload: { kind: 'text', text: 'Slice 11A' },
        },
      ],
      provenance: { actor: 'user' },
    }
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await editing.session.plan(change)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state).toBe('committed')
    expect(readFileSync(path, 'utf8')).toBe(source.replace('Port Plan', 'Slice 11A'))
    await result.session.dispose()

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
    expect(reopened.selected.contributionId).toBe('org.modkitx/document-markdown')
    const inspected = await reopened.session.operations().invoke('inspect', null)
    expect(inspected.state).toBe('ok')
    if (inspected.state === 'ok' && inspected.output.kind === 'json') {
      expect(inspected.output.value).toMatchObject({ format: 'markdown', headings: 1, links: 1 })
    }
    await reopened.session.dispose()
    await backend.dispose()
  }, 60_000)

  it('refuses what a literal writer cannot honestly plan: non-replace edits, foreign targets, and whole-source from a bounded editor', async () => {
    const { result } = await openJson('bounded.json', '{"a":1}')
    const bounded = createRawWriter({ allowWholeSource: false })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => undefined,
      evidenceFor: plan => createEvidenceRegistry().evidenceFor(plan),
      writer: bounded,
    })
    if (editing.session === undefined) throw new Error('no session')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no target')
    const base = { targets: editing.targets, provenance: { actor: 'user' as const } }

    // a whole-source replace: refused, because a bounded editor may hold only a prefix
    const whole = await editing.session.propose({
      ...base,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          payload: { kind: 'text', text: 'everything' },
        },
      ],
    })
    expect(whole.valid).toBe(false)
    expect(whole.diagnostics.map(item => item.code)).toContain(
      'x3.host/raw-writer-whole-source-refused',
    )

    // a delete: the raw writer plans replacements only
    const removed = await editing.session.propose({
      ...base,
      edits: [{ operation: 'delete', targetId: target.targetId, source: target.ownerSource }],
    })
    expect(removed.diagnostics.map(item => item.code)).toContain(
      'x3.host/raw-writer-operation-unsupported',
    )

    // an edit naming a target the change set never declared
    const foreign = await editing.session.propose({
      ...base,
      edits: [
        {
          operation: 'replace',
          targetId: 'somewhere-else',
          source: target.ownerSource,
          range: { kind: 'bytes', offset: 0n, length: 1n },
          payload: { kind: 'text', text: 'x' },
        },
      ],
    })
    expect(foreign.diagnostics.map(item => item.code)).toContain(
      'x3.host/raw-writer-unknown-target',
    )

    // and a refused change never becomes a committable plan
    const plan = await editing.session.plan({
      ...base,
      edits: [{ operation: 'delete', targetId: target.targetId, source: target.ownerSource }],
    })
    expect(plan.targets).toEqual([])
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state).toBe('rejected')
    await result.session.dispose()
  }, 60_000)

  it('an unproven claim is refused before any side effect', async () => {
    const { path, result } = await openJson('unproven.json', '{"keep":true}')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      // a policy that proves nothing at all
      evidenceFor: () => undefined,
      writer: createRawWriter(),
    })
    if (editing.session === undefined) throw new Error('no session')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no target')
    const plan = await editing.session.plan({
      targets: editing.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'bytes', offset: 0n, length: 1n },
          payload: { kind: 'text', text: ' ' },
        },
      ],
      provenance: { actor: 'user' },
    })
    expect(await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })).toMatchObject(
      {
        state: 'rejected',
        reason: 'fidelity-unproven',
      },
    )
    expect(readFileSync(path, 'utf8')).toBe('{"keep":true}')
    await result.session.dispose()
    await backend.dispose()
  }, 60_000)
})
