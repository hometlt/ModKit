import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import {
  createHostTopology,
  type JsonObject,
  type JsonValue,
  type PermissionGrant,
  type TreeDataSource,
} from '@modkit/sdk'
import {
  codecFidelityEvidenceRecords,
  createEvidenceRegistry,
  createSubjectEditing,
  type OpenedSubject,
} from '@modkit/host'
import {
  createFileEditingBackend,
  createFilesystemInputResolver,
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
  type NodeSubjectServices,
} from '@modkit/host/node'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { attachUvmFormatResidual } from '@modkit/uv/model/format-residual'
import { readUvmAnimationClips } from '@modkit/uv/model/animation-clips'
import { animationFixtureBundle } from '../../testkit/test/fixtures/uvm-animation-bundle.js'

const root = join(import.meta.dirname, '../../..')
const scratch = mkdtempSync(join(tmpdir(), 'modkit-uvm-edits-'))
const READ: PermissionGrant = { id: 'uvm-read', classes: ['read-source'] }
const WRITE: PermissionGrant = { id: 'uvm-write', classes: ['read-source', 'write-source'] }
const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const host = 'org.example.uvm/host',
  workers = 'org.example.uvm/workers'
const realmsBudget = {
  maxConcurrentTasks: 4,
  maxWorkerCount: 2,
  maxResidentBytes: uint64('1073741824'),
  maxTransferBytes: uint64('268435456'),
  defaultDeadlineMs: 60_000,
}
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.uvm/edit',
  realms: [
    {
      schemaVersion: 1,
      realmId: host,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'filesystem.atomic-replace', 'worker.module'],
      budgets: realmsBudget,
      policy: { id: 'org.example.uvm/policy', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: workers,
      budgets: realmsBudget,
      policy: { id: 'org.example.uvm/worker-policy', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(host, workers)],
})
let services: NodeSubjectServices
let fixture: Uint8Array
beforeAll(async () => {
  services = await createNodeSubjectServices({
    topology,
    realms: { host, workers },
    extensions: [
      {
        ...(await loadExtensionDirectory(join(root, 'extensions/models'))),
        execution: { origin: 'bundled', allowTrustedInProcess: true },
      },
    ],
    policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 }),
  })
  const triangle = readUvmContainer(
    Buffer.from(
      readFileSync(
        join(root, 'packages/testkit/test/fixtures/uvm/m3-triangle.uvm.glb.b64'),
        'utf8',
      ).trim(),
      'base64',
    ),
  )
  const wrapped = attachUvmFormatResidual(
    { ...triangle, extraChunks: [{ type: 0x12345678, bytes: Uint8Array.of(1, 8, 7, 3) }] },
    {
      namespace: 'BlizzardM3',
      format: 'm3',
      profile: 'portable-scene-v1',
      residual: {
        sections: Array.from({ length: 503 }, (_, i) => ({ name: `native-${i}`, 'a/b~c': i })),
      },
      mapping: { nodes: [0] },
    },
  )
  fixture = writeUvmContainer(wrapped)
  // Load the actual codec before individual assertions; keep the default per-test timeout.
  const warm = await open('warm.uvm.glb')
  await warm.opened.session.dispose()
}, 60_000)
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let current: { path: string; opened: OpenedSubject }
let caseIndex = 0
beforeEach(async context => {
  current = await open(
    `case-${caseIndex++}.uvm.glb`,
    context.task.name.includes('read grant') ? READ : WRITE,
  )
})

async function reopen(path: string, grant = WRITE): Promise<OpenedSubject> {
  const result = await services.open({
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    grant,
    budget,
    resolveInput: createFilesystemInputResolver({
      primaryPath: path,
      roots: [scratch],
      inventory: services.inventory,
    }),
  })
  if (result.state !== 'opened') throw new Error(`UVM open failed: ${result.reason}`)
  expect(result.selected.contributionId, show(result.diagnostics)).toBe('modkit/model-uvm')
  return result
}
async function open(name: string, grant = WRITE) {
  const path = join(scratch, name)
  writeFileSync(path, fixture)
  return { path, opened: await reopen(path, grant) }
}
const show = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

it('attaches an animation bundle through host resources, commits once and reopens the complete catalog', async () => {
  const { path, opened } = current
  const bundleBytes = writeUvmContainer(animationFixtureBundle(true))
  const bundleName = `bundle-${caseIndex}.uvm.glb`
  const bundlePath = join(scratch, bundleName)
  writeFileSync(bundlePath, bundleBytes)
  const bundle = await openFileArtifactSource(bundlePath)
  const { backend, editing } = editingFor(opened)
  try {
    expect(opened.descriptor.operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'model.attach-animation' })]),
    )
    const output = await planFor(opened, 'attach-uvm-animation', {
      source: {
        logicalId: bundleName,
        expectedRevision: bundle.revision,
        size: String(bundle.size),
      },
      binding: {
        id: 'selected-bundle',
        clips: [
          { sourceId: 'visibility', id: 'attached-visibility', sequenceIndex: 101 },
          { sourceId: 'truly-empty', id: 'attached-empty', sequenceIndex: 102 },
        ],
        nodes: [{ source: 0, target: 0 }],
        primitives: [{ source: { mesh: 0, primitive: 0 }, target: { mesh: 0, primitive: 0 } }],
      },
    })
    expect(readFileSync(path)).toEqual(Buffer.from(fixture))
    const plan = editing.planFromOperation(output)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('attachment was not prepared')
    expect(
      (await editing.coordinator.commit(prepared.prepared, { grant: editing.grantSnapshot })).state,
    ).toBe('committed')
    const after = readUvmContainer(readFileSync(path))
    expect(readUvmAnimationClips(after.document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'attached-visibility', sourceSequenceIndex: 101 }),
        expect.objectContaining({
          id: 'attached-empty',
          sourceSequenceIndex: 102,
          durationSeconds: 3,
        }),
      ]),
    )
    const before = readUvmContainer(fixture)
    expect(after.document['extras']).toEqual(before.document['extras'])
    expect(after.extraChunks).toEqual(before.extraChunks)
    const extensions = after.document['extensions'] as JsonObject
    const catalog = extensions['UV_game_animation_clips'] as JsonObject
    const attachments = catalog['attachments'] as readonly JsonObject[]
    const attachment = attachments.find(item => item['id'] === 'selected-bundle')
    expect(attachment).toMatchObject({
      id: 'selected-bundle',
      clips: ['attached-visibility', 'attached-empty'],
    })
    expect(attachment).not.toHaveProperty('sourceBlob')
    expect(attachment).not.toHaveProperty('sourceSha256')
    const fresh = await reopen(path)
    await fresh.session.dispose()
  } finally {
    await opened.session.dispose()
    await backend.dispose()
  }
})

it('refuses stale animation bundles and leaves the model untouched', async () => {
  const { path, opened } = current
  const bundleName = `stale-bundle-${caseIndex}.uvm.glb`
  const bundlePath = join(scratch, bundleName)
  const container = animationFixtureBundle(true)
  writeFileSync(bundlePath, writeUvmContainer(container))
  const source = await openFileArtifactSource(bundlePath)
  writeFileSync(
    bundlePath,
    writeUvmContainer({
      ...container,
      document: { ...container.document, extras: { changed: 'new revision with different bytes' } },
    }),
  )
  try {
    await expect(
      opened.session.operations().invoke('attach-uvm-animation', {
        source: { logicalId: bundleName, expectedRevision: source.revision },
        binding: {
          id: 'stale',
          clips: [{ sourceId: 'truly-empty', id: 'must-not-appear', sequenceIndex: 100 }],
        },
      }),
    ).rejects.toThrow('source-revision-changed')
    expect(readFileSync(path)).toEqual(Buffer.from(fixture))
  } finally {
    await opened.session.dispose()
  }
})
function editingFor(opened: OpenedSubject, grant = WRITE, proof = true) {
  const backend = createFileEditingBackend({ roots: [scratch] })
  const records = codecFidelityEvidenceRecords(services.inventory, {
    codecId: 'modkit/model-uvm',
    formatId: 'uvm',
  })
  const registry = createEvidenceRegistry(proof ? records : [])
  return {
    backend,
    editing: createSubjectEditing({
      opened,
      grant,
      backendFor: () => backend,
      evidenceFor: plan => registry.evidenceFor(plan),
    }),
  }
}
async function planFor(opened: OpenedSubject, handler: string, input: JsonValue) {
  const invoked = await opened.session.operations().invoke(handler, input)
  expect(invoked.state, show(invoked)).toBe('ok')
  if (invoked.state !== 'ok') throw new Error('operation refused')
  expect(invoked.output.kind).toBe('edit-plan')
  return invoked.output
}

it('commits a common tree field write and reopens residual metadata and opaque GLB chunks', async () => {
  const { path, opened } = current
  const { backend, editing } = editingFor(opened)
  try {
    const lease = await opened.session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const facts = await tree.facts({
      id: 'json:/extras/BlizzardM3/residual/sections/502/a~1b~0c',
      hasChildren: false,
    })
    expect(facts).toMatchObject({ value: 502, editable: { write: { operation: 'edit.field' } } })
    await lease.release()
    if (facts.semanticPath === undefined) throw new Error('tree semantic path missing')
    const output = await planFor(opened, 'set-uvm-field', {
      groupId: 'tree',
      key: facts.label,
      path: [...facts.semanticPath],
      value: 60,
    })
    const plan = editing.planFromOperation(output)
    expect(readFileSync(path)).toEqual(Buffer.from(fixture))
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('not prepared')
    expect(
      (await editing.coordinator.commit(prepared.prepared, { grant: editing.grantSnapshot })).state,
    ).toBe('committed')
    const after = readUvmContainer(readFileSync(path))
    const before = readUvmContainer(fixture)
    const expected = JSON.parse(JSON.stringify(before.document))
    expected.extras.BlizzardM3.residual.sections[502]['a/b~c'] = 60
    expect(after.document).toEqual(expected)
    expect(after.binary).toEqual(before.binary)
    expect(after.extraChunks).toEqual(before.extraChunks)
    expect((after.document['extensions'] as JsonObject)['UV_source_blob']).toBeUndefined()
    const fresh = await reopen(path)
    try {
      const treeLease = await fresh.session.dataSource('common.view/tree-data-source', 1)
      expect(
        await (treeLease.value as TreeDataSource).facts({
          id: 'json:/extras/BlizzardM3/residual/sections/502/a~1b~0c',
          hasChildren: false,
        }),
      ).toMatchObject({ value: 60 })
      await treeLease.release()
    } finally {
      await fresh.session.dispose()
    }
  } finally {
    await opened.session.dispose()
    await backend.dispose()
  }
})

it('prepares atomic JSON batches and refuses malformed profiles before exposing any write plan', async () => {
  const { path, opened } = current
  try {
    const output = await planFor(opened, 'edit-uvm-document', {
      json: [
        { op: 'add', path: '/extras/newProperty', value: { future: 45 } },
        { op: 'replace', path: '/extras/BlizzardM3/residual/sections/0/name', value: 'updated' },
        { op: 'remove', path: '/extras/BlizzardM3/residual/sections/1' },
      ],
    })
    if (output.kind !== 'edit-plan') throw new Error('missing plan')
    const edit = output.plan.edits[0]
    if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline')
      throw new Error('missing replacement')
    const candidate = readUvmContainer(edit.payload.bytes)
    expect(candidate.document['extras']).toHaveProperty('newProperty', { future: 45 })
    await expect(
      opened.session.operations().invoke('edit-uvm-document', {
        json: [
          {
            op: 'replace',
            path: '/extras/BlizzardM3/residual/sections/0/name',
            value: 'must not escape',
          },
          { op: 'remove', path: '/asset/extras/uv' },
        ],
      }),
    ).rejects.toThrow('UVM profile marker')
    expect(readFileSync(path)).toEqual(Buffer.from(fixture))
  } finally {
    await opened.session.dispose()
  }
})

it('refuses a stale source at commit preparation and refuses missing fidelity evidence', async () => {
  const { path, opened } = current
  const { backend, editing } = editingFor(opened)
  const unproven = editingFor(opened, WRITE, false)
  try {
    const output = await planFor(opened, 'set-uvm-field', {
      groupId: 'tree',
      key: 'name',
      path: ['extras', 'BlizzardM3', 'residual', 'sections', '0', 'name'],
      value: 'edited',
    })
    const plan = editing.planFromOperation(output)
    const denied = await unproven.editing.coordinator.prepare(plan, {
      grant: unproven.editing.grantSnapshot,
    })
    expect(denied.state).not.toBe('ready')
    expect(show(denied)).toContain('fidelity-unproven')
    writeFileSync(path, Buffer.concat([Buffer.from(fixture), Buffer.from([99])]))
    const changed = readFileSync(path)
    const stale = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(stale.state).not.toBe('ready')
    expect(show(stale)).toContain('revision')
    expect(readFileSync(path)).toEqual(changed)
  } finally {
    await opened.session.dispose()
    await backend.dispose()
    await unproven.backend.dispose()
  }
})

it('opens under a read grant but denies edits', async () => {
  const { path, opened } = current
  try {
    const denied = await opened.session.operations().invoke('set-uvm-field', {
      groupId: 'tree',
      key: 'name',
      path: ['extras', 'BlizzardM3', 'metadata', 'sections', '0', 'name'],
      value: 'denied',
    })
    expect(denied.state).toBe('rejected')
    expect(show(denied)).toContain('permission')
    expect(readFileSync(path)).toEqual(Buffer.from(fixture))
  } finally {
    await opened.session.dispose()
  }
})

it('honours operation cancellation before preparing bytes', async () => {
  const { path, opened: writable } = current
  try {
    await expect(
      writable.session
        .operations()
        .invoke(
          'edit-uvm-document',
          { json: [{ op: 'add', path: '/extras/cancelled', value: true }] },
          { signal: AbortSignal.abort() },
        ),
    ).rejects.toThrow('operation cancelled')
    expect(readFileSync(path)).toEqual(Buffer.from(fixture))
  } finally {
    await writable.session.dispose()
  }
})
