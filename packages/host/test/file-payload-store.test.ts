import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkit/core'
import type {
  AssetEditPlan,
  AssetRevision,
  FidelityEvidence,
  PermissionGrant,
  SubjectEditTarget,
  Writer,
} from '@modkit/sdk'
import {
  createCommitCoordinator,
  createGrantSnapshot,
  createSubjectEditing,
  type EditingBackend,
  type OpenedSubject,
} from '@modkit/host'
import {
  createFileEditingBackend,
  createFilePayloadStore,
  openFileArtifactSource,
} from '@modkit/host/node'

const scratch = mkdtempSync(join(tmpdir(), 'x3-file-payload-store-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

async function pinned(path: string) {
  const source = await openFileArtifactSource(path)
  const ref = { id: source.ref.id, uri: source.ref.uri }
  const revision: AssetRevision = {
    bindings: { content: source.revision },
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: 'content',
      source: ref,
      revision: source.revision,
    }),
  }
  const target: SubjectEditTarget = {
    targetId: 'content',
    subjectUri: ref.uri,
    ownerSource: ref,
    semanticPath: [],
    expectedRevision: revision,
  }
  return { ref, revision, target }
}

const evidence: FidelityEvidence = {
  roundTrip: 'byte-identical',
  preservesUnknownData: true,
  evidenceId: 'staged-payload-v1',
  corpusId: 'generated-17-mib',
  corpusDigest: 'sha256:generated',
  conformanceProfile: 'modkit/staged-payload-v1' as never,
  writer: {
    providerId: 'modkit/test-staged-writer',
    providerVersion: '1.0.0',
    artifactDigest: 'sha256:test-writer',
    formatId: 'binary',
    representationId: 'source',
  },
  optionsFingerprint: 'none',
  inputClass: 'generated-binary',
  provenAt: '2026-09-11T00:00:00.000Z',
}

async function* seventeenMiB(): AsyncIterable<Uint8Array> {
  for (let index = 0; index < 17; index += 1) {
    const chunk = new Uint8Array(1024 * 1024)
    chunk.fill(index)
    yield chunk
  }
}

describe('host-owned file payload store', () => {
  it('stages, verifies and commits a source above the 16 MiB inline limit, then releases it', async () => {
    const path = join(scratch, 'large.bin')
    writeFileSync(path, Uint8Array.of(1, 2, 3))
    const { ref, target } = await pinned(path)
    const payloads = createFilePayloadStore({ directory: join(scratch, 'payloads') })
    const staged = await payloads.stage(seventeenMiB())
    expect(staged.bytes).toBe(17n * 1024n * 1024n)
    expect(await payloads.verify(staged)).toBe(true)

    const backend = createFileEditingBackend({ roots: [scratch] })
    const grant = createGrantSnapshot({
      snapshotId: 'staged-grant',
      permissions: ['write-source'],
      sourceIds: [ref.id],
    })
    const coordinator = createCommitCoordinator({
      payloads,
      backendFor: sourceId => (sourceId === ref.id ? backend : undefined),
      evidenceFor: () => evidence,
      isGrantValid: candidate => candidate.snapshotId === grant.snapshotId,
      digest: () => 'staged-plan-digest',
      verifyStagedPayload: (candidate, signal) => payloads.verify(candidate, signal),
      maxInlinePayloadBytes: 16 * 1024 * 1024,
    })
    const plan: AssetEditPlan = {
      planId: 'staged-plan',
      targets: [target],
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: ref,
          payload: { kind: 'staged', ref: staged },
        },
      ],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    }

    const prepared = await coordinator.prepare(plan, { grant })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('staged plan did not prepare')
    const committed = await coordinator.commit(prepared.prepared, { grant })
    expect(committed.state).toBe('committed')
    if (committed.state !== 'committed') throw new Error('staged plan did not commit')

    const bytes = readFileSync(path)
    expect(bytes.byteLength).toBe(17 * 1024 * 1024)
    expect(bytes[0]).toBe(0)
    expect(bytes[16 * 1024 * 1024]).toBe(16)
    const reopened = await pinned(path)
    expect(canonicalJsonStringify(reopened.revision)).toBe(
      canonicalJsonStringify(committed.receipt.after[0]),
    )

    await payloads.release(staged)
    expect(await payloads.verify(staged)).toBe(false)
    await expect(payloads.open(staged)).rejects.toMatchObject({
      code: 'x3.host/edit-payload-unavailable',
    })
    await backend.dispose()
    await payloads.dispose()
  }, 60_000)

  it('refuses a staged payload tampered on disk or forged by digest, before and after prepare', async () => {
    const path = join(scratch, 'tampered.bin')
    writeFileSync(path, Uint8Array.of(7, 7, 7))
    const { ref, target } = await pinned(path)
    const directory = join(scratch, 'payloads-tampered')
    const payloads = createFilePayloadStore({ directory })
    const staged = await payloads.stage(Uint8Array.of(1, 2, 3, 4))
    const backend = createFileEditingBackend({ roots: [scratch] })
    const grant = createGrantSnapshot({
      snapshotId: 'tamper-grant',
      permissions: ['write-source'],
      sourceIds: [ref.id],
    })
    const coordinator = createCommitCoordinator({
      payloads,
      backendFor: sourceId => (sourceId === ref.id ? backend : undefined),
      evidenceFor: () => evidence,
      isGrantValid: candidate => candidate.snapshotId === grant.snapshotId,
      digest: () => 'tamper-plan-digest',
      verifyStagedPayload: (candidate, signal) => payloads.verify(candidate, signal),
    })
    const planWith = (payloadRef: typeof staged): AssetEditPlan => ({
      planId: 'tamper-plan',
      targets: [target],
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: ref,
          payload: { kind: 'staged', ref: payloadRef },
        },
      ],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    })

    // A ref whose digest a caller rewrote no longer names a stored payload.
    const forged = { ...staged, digest: `sha256:${'0'.repeat(64)}` }
    expect(await payloads.verify(forged)).toBe(false)
    expect(await coordinator.prepare(planWith(forged), { grant })).toMatchObject({
      state: 'rejected',
      reason: 'payload-unavailable',
    })

    // Prepared against intact bytes, then the stored bytes change with the same length.
    const prepared = await coordinator.prepare(planWith(staged), { grant })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('intact staged plan did not prepare')
    writeFileSync(join(directory, `${staged.handleId}.payload`), Uint8Array.of(9, 9, 9, 9))
    expect(await payloads.verify(staged)).toBe(false)
    const committed = await coordinator.commit(prepared.prepared, { grant })
    expect(committed.state).toBe('not-applied')
    expect([...readFileSync(path)]).toEqual([7, 7, 7])
    expect(await coordinator.prepare(planWith(staged), { grant })).toMatchObject({
      state: 'rejected',
      reason: 'payload-unavailable',
    })

    await backend.dispose()
    await payloads.dispose()
  })

  it('automatically stages oversized writer and operation plans and releases owned refs', async () => {
    const path = join(scratch, 'auto-stage.bin')
    writeFileSync(path, Uint8Array.of(1))
    const { ref, revision, target } = await pinned(path)
    const payloads = createFilePayloadStore({ directory: join(scratch, 'payloads-auto') })
    const backend = createFileEditingBackend({ roots: [scratch] })
    const authored: AssetEditPlan = {
      planId: 'auto-stage-plan',
      targets: [target],
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: ref,
          payload: { kind: 'inline', bytes: new Uint8Array(2048) },
        },
      ],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    }
    const writer: Writer = {
      identity: evidence.writer,
      offer: {
        providerId: evidence.writer.providerId,
        fidelityEvidenceId: evidence.evidenceId,
        formatId: 'binary',
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
      async validate() {
        return { valid: true, diagnostics: [] }
      },
      async plan() {
        return authored
      },
    }
    const grant: PermissionGrant = { id: 'auto-stage', classes: ['write-source'] }
    const opened = {
      descriptor: {
        schemaVersion: 2,
        subjectUri: ref.uri,
        origin: {
          kind: 'single',
          binding: { id: target.targetId, source: ref, revision: revision.bindings['content'] },
        },
        traits: [],
        operations: [],
        dataSources: [],
        constraints: { readOnly: false },
      },
    } as unknown as OpenedSubject
    const editing = createSubjectEditing({
      opened,
      grant,
      backendFor: () => backend,
      evidenceFor: () => evidence,
      payloads,
      verifyStagedPayload: (candidate, signal) => payloads.verify(candidate, signal),
      maxInlinePayloadBytes: 1024,
      writer,
    })

    const writerPlan = await editing.session?.plan({
      targets: [target],
      edits: [],
      provenance: { actor: 'user' },
    })
    if (writerPlan === undefined) throw new Error('writer session did not produce a plan')
    const writerEdit = writerPlan?.edits[0]
    if (writerEdit?.operation !== 'replace' || writerEdit.payload.kind !== 'staged')
      throw new Error('writer payload was not staged')
    expect(await payloads.verify(writerEdit.payload.ref)).toBe(true)

    const operationPlan = await editing.stagePlan({ ...authored, planId: 'operation-stage-plan' })
    const operationEdit = operationPlan.edits[0]
    if (operationEdit?.operation !== 'replace' || operationEdit.payload.kind !== 'staged')
      throw new Error('operation payload was not staged')
    expect(await payloads.verify(operationEdit.payload.ref)).toBe(true)

    const prepared = await editing.coordinator.prepare(writerPlan, {
      grant: editing.grantSnapshot,
    })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('writer plan did not prepare')
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state).toBe('committed')
    if (committed.state !== 'committed') throw new Error('writer plan did not commit')

    expect(await editing.coordinator.discardHistory(committed.receipt.transactionId)).toBe(true)
    expect(await editing.coordinator.discardHistory(committed.receipt.transactionId)).toBe(false)
    expect(editing.session?.state()).toBe('live')
    expect(await payloads.verify(writerEdit.payload.ref)).toBe(false)
    expect(await payloads.verify(operationEdit.payload.ref)).toBe(true)

    await editing.dispose()
    expect(await payloads.verify(operationEdit.payload.ref)).toBe(false)
    await backend.dispose()
    await payloads.dispose()
  })

  it('rolls back the first file when a second backend fails after a large staged write', async () => {
    const firstPath = join(scratch, 'rollback-first.bin')
    const secondPath = join(scratch, 'rollback-second.bin')
    const firstOriginal = Uint8Array.of(1, 2, 3, 4)
    const secondOriginal = Uint8Array.of(5, 6, 7, 8)
    writeFileSync(firstPath, firstOriginal)
    writeFileSync(secondPath, secondOriginal)
    const first = await pinned(firstPath)
    const second = await pinned(secondPath)
    const secondTarget: SubjectEditTarget = { ...second.target, targetId: 'secondary' }
    const payloads = createFilePayloadStore({ directory: join(scratch, 'payloads-rollback') })
    const large = await payloads.stage(seventeenMiB())
    const small = await payloads.stage(Uint8Array.of(9))
    const firstBackend = createFileEditingBackend({ roots: [scratch], backendId: 'first-file' })
    const secondBackend = createFileEditingBackend({ roots: [scratch], backendId: 'second-file' })
    const failingSecond: EditingBackend = {
      profile: secondBackend.profile,
      writable: secondBackend.writable,
      currentRevision: target => secondBackend.currentRevision(target),
      async apply() {
        throw new Error('seeded second-backend failure')
      },
      ...(secondBackend.rollback === undefined
        ? {}
        : { rollback: secondBackend.rollback.bind(secondBackend) }),
    }
    const grant = createGrantSnapshot({
      snapshotId: 'rollback-grant',
      permissions: ['write-source'],
      sourceIds: [first.ref.id, second.ref.id],
    })
    const coordinator = createCommitCoordinator({
      payloads,
      backendFor: sourceId =>
        sourceId === first.ref.id
          ? firstBackend
          : sourceId === second.ref.id
            ? failingSecond
            : undefined,
      evidenceFor: () => evidence,
      isGrantValid: candidate => candidate.snapshotId === grant.snapshotId,
      digest: () => 'rollback-plan-digest',
      verifyStagedPayload: (candidate, signal) => payloads.verify(candidate, signal),
      async createRecovery(_preparedId, planDigest) {
        return { kind: 'journal', ref: 'test:rollback', digest: planDigest }
      },
      maxInlinePayloadBytes: 16 * 1024 * 1024,
    })
    const plan: AssetEditPlan = {
      planId: 'large-rollback-plan',
      targets: [first.target, secondTarget],
      edits: [
        {
          operation: 'replace',
          targetId: first.target.targetId,
          source: first.ref,
          payload: { kind: 'staged', ref: large },
        },
        {
          operation: 'replace',
          targetId: secondTarget.targetId,
          source: second.ref,
          payload: { kind: 'staged', ref: small },
        },
      ],
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'transactional' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    }
    const prepared = await coordinator.prepare(plan, { grant })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('rollback plan did not prepare')
    const result = await coordinator.commit(prepared.prepared, { grant })
    expect(result.state).toBe('rolled-back')
    if (result.state !== 'rolled-back') throw new Error('large write was not rolled back')
    expect(result.receipt.writes.map(write => write.state)).toEqual(['rolled-back', 'failed'])
    expect([...readFileSync(firstPath)]).toEqual([...firstOriginal])
    expect([...readFileSync(secondPath)]).toEqual([...secondOriginal])

    await payloads.release(large)
    await payloads.release(small)
    await firstBackend.dispose()
    await secondBackend.dispose()
    await payloads.dispose()
  }, 60_000)
})
