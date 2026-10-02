import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { uint64 } from '@modkit/core'
import {
  createHostTopology,
  type CommitCoordinator,
  type FidelityEvidence,
  type PermissionGrant,
  type WorldSceneObjectItem,
} from '@modkit/sdk'
import { createSubjectEditing, linkedExtensionInputs } from '@modkit/host'
import {
  createFileEditingBackend,
  createNodeSubjectServices,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  type NodeSubjectServices,
} from '@modkit/host/node'
import { canonicalizeUvwProfile, parseUvwProfile } from '@modkit/uv/world'
import {
  commitWorldObjectMove,
  createWorldEditState,
  previewWorldObjectMove,
  selectWorldObject,
} from '@modkit/ui/world'
import { uvModule } from '../../uv/src/module.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixturePath = join(
  repoRoot,
  'vendor',
  'multiverse-specs',
  'specs',
  'world',
  'fixtures',
  'uvw-profile-single-space.uvw.json',
)
const objectFixturePath = join(
  repoRoot,
  'vendor',
  'multiverse-specs',
  'specs',
  'world',
  'fixtures',
  'uvw-profile-renderable-world.uvw.json',
)
const scratch = mkdtempSync(join(tmpdir(), 'modkit-uvw-edit-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const HOST = 'org.modkit.test/uvw-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkit.test/uvw-editing',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'filesystem.atomic-replace'],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('268435456'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 30_000,
      },
      policy: { id: 'org.modkit.test/uvw-editing-policy', revision: '1' },
    },
  ],
  links: [],
})
const budget = {
  maxInputBytes: 64n * 1024n * 1024n,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxScalarBytes: 128 * 1024 * 1024,
  maxDiagnostics: 1_000,
}
const WRITE: PermissionGrant = {
  id: 'uvw-edit-write',
  classes: ['read-source', 'write-source'],
}

const linked = linkedExtensionInputs([uvModule])

let cachedServices: Promise<NodeSubjectServices> | undefined
const services = () =>
  (cachedServices ??= createNodeSubjectServices({
    topology,
    realms: { host: HOST, workers: HOST },
    extensions: linked.inputs,
    linkedModules: linked.modules,
  }))

function evidence(
  artifactDigest: string,
  corpusPath = fixturePath,
  corpusId = 'multiverse/uvw-profile-single-space',
): FidelityEvidence {
  const corpus = readFileSync(corpusPath)
  return {
    roundTrip: 'semantic',
    preservesUnknownData: true,
    evidenceId: 'uvw-canonical-edit-v1',
    corpusId,
    corpusDigest: `sha256:${createHash('sha256').update(corpus).digest('hex')}`,
    conformanceProfile: 'modkit/codec-contribution-v1' as never,
    writer: {
      providerId: 'modkit/world-uvw',
      providerVersion: '1.0.0',
      artifactDigest,
      formatId: 'uvw',
      representationId: 'source',
    },
    optionsFingerprint: 'options:none',
    inputClass: 'uvw-profile-1.0',
    provenAt: '2026-09-13T00:00:00Z',
  }
}

function firstHeight(path: string): number {
  const document = parseUvwProfile(new Uint8Array(readFileSync(path)))
  const terrain = document.spaces[0]?.layers.find(layer => layer.kind === 'heightfield')
  if (terrain?.kind !== 'heightfield') throw new Error('UVW terrain missing after edit')
  return terrain.samples[0]?.[0] ?? Number.NaN
}

function objectPosition(path: string, id: string): readonly [number, number, number] | undefined {
  const document = parseUvwProfile(new Uint8Array(readFileSync(path)))
  const layer = document.spaces
    .flatMap(space => space.layers)
    .find(candidate => candidate.kind === 'objects')
  return layer?.kind === 'objects'
    ? layer.instances.find(instance => instance.id === id)?.position
    : undefined
}

describe('UVW codec edit → host commit/history', () => {
  it('writes a map layer window and keeps every datum it does not touch; unknown data never opens as UVW', async () => {
    const path = join(scratch, 'layer-window.uvw.json')
    const fixture = JSON.parse(readFileSync(objectFixturePath, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({ $comment: 'authored note', ...fixture }))
    const original = readFileSync(path)
    const canonical = (bytes: Buffer) =>
      JSON.parse(JSON.stringify(canonicalizeUvwProfile(parseUvwProfile(new Uint8Array(bytes))))) as {
        $comment?: string
        spaces: { layers: { kind: string; samples?: number[][] }[] }[]
      }
    const before = canonical(original)
    const service = await services()
    const open = async (file: string) =>
      service.open({ source: await openFileArtifactSource(file), path: file, intent: 'full', grant: WRITE, budget })
    const opened = await open(path)
    if (opened.state !== 'opened') throw new Error(opened.reason)
    const listed = await opened.session.operations().invoke('map-layers', null)
    if (listed.state !== 'ok' || listed.output.kind !== 'json') throw new Error('map.layers failed')
    const layer = (listed.output.value as { layers: { id: string; valueScale: number; valueOffset: number }[] }).layers[0]
    if (layer === undefined) throw new Error('the height layer is missing')
    const written = await opened.session.operations().invoke('map-layer-write', {
      layer: layer.id, x: 1, y: 0, width: 1, height: 1, values: [(7.5 - layer.valueOffset) / layer.valueScale],
    })
    if (written.state !== 'ok') throw new Error('map.layer-write was rejected')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence('sha256:uvw-codec-edit-v1', objectFixturePath, 'multiverse/uvw-profile-renderable-world'),
    })
    const prepared = await editing.coordinator.prepare(editing.planFromOperation(written.output), {
      grant: editing.grantSnapshot,
    })
    if (prepared.state !== 'ready') throw new Error(`UVW layer write prepare: ${prepared.state}`)
    const committed = await editing.coordinator.commit(prepared.prepared, { grant: editing.grantSnapshot })
    if (committed.state !== 'committed') throw new Error(`UVW layer write commit: ${committed.state}`)

    // The write puts the document in canonical order; its data may change only at the written sample.
    const terrain = before.spaces[0]?.layers.find(item => item.kind === 'heightfield')
    if (terrain?.samples?.[0] === undefined) throw new Error('the fixture heightfield is missing')
    terrain.samples[0][1] = 7.5
    expect(canonical(readFileSync(path))).toEqual(before)
    expect(before.$comment).toBe('authored note')
    const reopened = await open(path)
    expect(reopened.state === 'opened' ? reopened.selected.contributionId : reopened.state).toBe('modkit/world-uvw')
    if (reopened.state === 'opened') await reopened.session.dispose()
    const undone = await editing.coordinator.undo(committed.receipt.transactionId, { grant: editing.grantSnapshot })
    expect(undone.state).toBe('committed')
    expect(Buffer.compare(readFileSync(path), original)).toBe(0)

    // A property the profile does not know is refused when the document is read, so no UVW
    // writer ever sees data it would drop.
    const unknownPath = join(scratch, 'unknown-property.uvw.json')
    writeFileSync(unknownPath, JSON.stringify({ ...fixture, vendorData: { keep: true } }))
    const unknown = await open(unknownPath)
    expect(unknown.state === 'opened' ? unknown.selected.contributionId : unknown.state).not.toBe('modkit/world-uvw')
    if (unknown.state === 'opened') await unknown.session.dispose()
    await opened.session.dispose()
    await backend.dispose()
  }, 30_000)

  it('commits a validated canonical edit, reopens it, then undoes and redoes exact bytes', async () => {
    const path = join(scratch, 'editable.uvw.json')
    const original = readFileSync(fixturePath)
    writeFileSync(path, original)
    const service = await services()
    const opened = await service.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error(opened.reason)
    expect(
      opened.selected.contributionId,
      JSON.stringify({
        diagnostics: opened.diagnostics,
        extensions: service.inventory.extensions.map(item => ({
          id: item.manifest.id,
          contributions: item.contributions.map(contribution => ({
            id: contribution.manifest?.id,
            diagnostics: contribution.diagnostics,
          })),
        })),
      }),
    ).toBe('modkit/world-uvw')
    expect(opened.descriptor.operations.map(item => item.id)).toEqual(
      expect.arrayContaining(['edit.field', 'edit.structure']),
    )
    const invoked = await opened.session.operations().invoke('edit-uvw-document', {
      json: [{ op: 'replace', path: '/spaces/0/layers/0/samples/0/0', value: 1.25 }],
    })
    expect(invoked.state).toBe('ok')
    if (invoked.state !== 'ok') throw new Error('UVW edit operation was rejected')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence('sha256:uvw-codec-edit-v1'),
    })
    const plan = editing.planFromOperation(invoked.output)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error(`UVW edit prepare: ${prepared.state}`)
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state).toBe('committed')
    if (committed.state !== 'committed') throw new Error(`UVW edit commit: ${committed.state}`)
    expect(firstHeight(path)).toBe(1.25)

    const reopened = await service.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    expect(reopened.state).toBe('opened')
    if (reopened.state === 'opened') {
      const world = await reopened.session.dataSource('common.view/world-scene-source', 1)
      const page = await world.value.page({
        facet: 'terrain',
        layerId: 'main/terrain',
        lod: 'exact',
        limit: 1,
      })
      expect(page.items[0]).toMatchObject({ heightBase: 1.25 })
      await world.release()
      await reopened.session.dispose()
    }

    const undone = await editing.coordinator.undo(committed.receipt.transactionId, {
      grant: editing.grantSnapshot,
    })
    expect(undone.state).toBe('committed')
    expect(Buffer.compare(readFileSync(path), original)).toBe(0)
    const redone = await editing.coordinator.redo(committed.receipt.transactionId, {
      grant: editing.grantSnapshot,
    })
    expect(redone.state).toBe('committed')
    expect(firstHeight(path)).toBe(1.25)

    const cancelledController = new AbortController()
    cancelledController.abort()
    const cancelled = await opened.session
      .operations()
      .invoke(
        'edit-uvw-document',
        { json: [{ op: 'replace', path: '/spaces/0/layers/0/samples/0/0', value: 2 }] },
        { signal: cancelledController.signal },
      )
    expect(cancelled).toMatchObject({ state: 'rejected', reason: 'cancelled' })

    const staleOpened = await service.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    if (staleOpened.state !== 'opened') throw new Error('stale UVW fixture did not open')
    const staleInvoked = await staleOpened.session.operations().invoke('set-uvw-field', {
      groupId: 'tree',
      key: '0',
      path: ['spaces', '0', 'layers', '0', 'samples', '0', '0'],
      value: 3,
    })
    if (staleInvoked.state !== 'ok') throw new Error('stale UVW plan was not created')
    const staleEditing = createSubjectEditing({
      opened: staleOpened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence('sha256:uvw-codec-edit-v1'),
    })
    const stalePlan = staleEditing.planFromOperation(staleInvoked.output)
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('\n')]))
    const conflict = await staleEditing.coordinator.prepare(stalePlan, {
      grant: staleEditing.grantSnapshot,
    })
    expect(conflict.state).toBe('conflict')
    await staleOpened.session.dispose()

    await opened.session.dispose()
    await backend.dispose()
  }, 30_000)

  it('moves a standalone UVW object through the real UI operation and host history route', async () => {
    const path = join(scratch, 'object-editable.uvw.json')
    const original = readFileSync(objectFixturePath)
    writeFileSync(path, original)
    const service = await services()
    const opened = await service.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error(opened.reason)

    const worldLease = await opened.session.dataSource('common.view/world-scene-source', 1)
    const info = await worldLease.value.info()
    expect(opened.descriptor.revision).toBe(info.snapshotId)
    expect(info.edit).toEqual({
      operationId: 'edit.structure',
      moveObjectKind: 'object.update',
    })
    const objects = await worldLease.value.page({
      facet: 'objects',
      layerId: 'main/objects',
      limit: 16,
    })
    const selected = objects.items[0] as WorldSceneObjectItem | undefined
    expect(selected).toMatchObject({
      facet: 'objects',
      id: 'main/objects:instance-a',
      objectId: 0,
      position: { x: 0.25, y: 0.5, z: 0.25 },
    })
    if (selected === undefined || selected.facet !== 'objects')
      throw new Error('standalone UVW object was not published')
    await worldLease.release()

    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () =>
        evidence(
          'sha256:uvw-ui-object-edit-v1',
          objectFixturePath,
          'multiverse/uvw-profile-renderable-world',
        ),
    })
    let transactionId: string | undefined
    const coordinator: CommitCoordinator = {
      prepare: (...args) => editing.coordinator.prepare(...args),
      async commit(...args) {
        const result = await editing.coordinator.commit(...args)
        if (result.state === 'committed') transactionId = result.receipt.transactionId
        return result
      },
      undo: (...args) => editing.coordinator.undo(...args),
      redo: (...args) => editing.coordinator.redo(...args),
      discardHistory: (...args) => editing.coordinator.discardHistory(...args),
    }
    const selectedState = selectWorldObject(
      createWorldEditState(opened.descriptor.revision),
      selected,
    )
    const preview = previewWorldObjectMove(selectedState, { x: 4, y: 5, z: 6 })
    const committedState = await commitWorldObjectMove(preview, {
      descriptor: opened.descriptor,
      operations: opened.session.operations(),
      coordinator,
      authorization: {
        async request() {
          return { grant: editing.grantSnapshot }
        },
      },
      ...(info.edit?.operationId === undefined ? {} : { operationId: info.edit.operationId }),
      ...(info.edit?.moveObjectKind === undefined
        ? {}
        : { moveObjectKind: info.edit.moveObjectKind }),
    })
    expect(committedState).toMatchObject({
      status: 'idle',
      message: 'saved; awaiting refreshed world snapshot',
    })
    expect(objectPosition(path, 'instance-a')).toEqual([4.25, 5.5, 6.25])

    const reopened = await service.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    expect(reopened.state).toBe('opened')
    if (reopened.state === 'opened') {
      const lease = await reopened.session.dataSource('common.view/world-scene-source', 1)
      const page = await lease.value.page({ facet: 'objects', layerId: 'main/objects', limit: 1 })
      expect(page.items[0]).toMatchObject({ position: { x: 4.25, y: 5.5, z: 6.25 } })
      await lease.release()
      await reopened.session.dispose()
    }

    if (transactionId === undefined) throw new Error('UI object move produced no transaction id')
    const undone = await editing.coordinator.undo(transactionId, { grant: editing.grantSnapshot })
    expect(undone.state).toBe('committed')
    expect(Buffer.compare(readFileSync(path), original)).toBe(0)
    const redone = await editing.coordinator.redo(transactionId, { grant: editing.grantSnapshot })
    expect(redone.state).toBe('committed')
    expect(objectPosition(path, 'instance-a')).toEqual([4.25, 5.5, 6.25])

    const staleState = previewWorldObjectMove(
      selectWorldObject(createWorldEditState('content-hash.sha256:stale'), selected),
      { x: 1, y: 0 },
    )
    const rejected = await commitWorldObjectMove(staleState, {
      descriptor: opened.descriptor,
      operations: opened.session.operations(),
      coordinator,
      authorization: {
        async request() {
          return { grant: editing.grantSnapshot }
        },
      },
      ...(info.edit?.operationId === undefined ? {} : { operationId: info.edit.operationId }),
      ...(info.edit?.moveObjectKind === undefined
        ? {}
        : { moveObjectKind: info.edit.moveObjectKind }),
    })
    expect(rejected.status).toBe('stale')

    await opened.session.dispose()
    await backend.dispose()
  }, 30_000)
})

describe('UVW codec under a worker target', () => {
  it('opens in-process as its linked module ships only that variant, as the CLI and VS Code open it', async () => {
    const WORKER = 'org.modkit.test/uvw-worker'
    const workerServices = await createNodeSubjectServices({
      topology: createHostTopology({
        schemaVersion: 1,
        topologyId: 'org.modkit.test/uvw-worker-target',
        realms: [
          ...topology.realms,
          nodeWorkerRealmProfile({
            realmId: WORKER,
            budgets: topology.realms[0]!.budgets,
            policy: { id: 'org.modkit.test/uvw-worker-policy', revision: '1' },
          }),
        ],
        links: [...nodeWorkerLinks(HOST, WORKER)],
      }),
      realms: { host: HOST, workers: WORKER },
      extensions: linked.inputs,
      linkedModules: linked.modules,
    })
    const opened = await workerServices.open({
      source: await openFileArtifactSource(fixturePath),
      path: fixturePath,
      intent: 'full',
      grant: WRITE,
      budget,
    })
    expect(opened.state === 'opened' ? opened.selected.contributionId : opened).toBe(
      'modkit/world-uvw',
    )
    if (opened.state === 'opened') await opened.session.dispose()
  }, 30_000)
})
