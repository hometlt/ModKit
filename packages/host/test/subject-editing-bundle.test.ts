import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import {
  revisionId,
  type BundleAssetInput,
  type FidelityEvidence,
  type UnresolvedSourceDescriptor,
} from '@modkit/sdk'
import { editPlanFromBinding, replaceBytes } from '../../codec-kit/src/index.js'
import {
  createSubjectEditing,
  editPlanFromOperationForDescriptor,
  subjectEditTargetsFromDescriptor,
} from '../src/subject-editing.js'
import { createFileEditingBackend, openFileArtifactSource } from '@modkit/host/node'

const scratch = mkdtempSync(join(tmpdir(), 'modkit-bundle-edit-'))
afterAll(() => {
  if (
    !resolve(scratch).startsWith(resolve(tmpdir()) + sep) ||
    !basename(scratch).startsWith('modkit-bundle-edit-')
  )
    throw new Error('unexpected test directory')
  rmSync(scratch, { recursive: true, force: true })
})
let sequence = 0
const fidelity = { roundTrip: 'semantic', preservesUnknownData: true } as const
const evidence: FidelityEvidence = {
  ...fidelity,
  evidenceId: 'bundle-fixture-v1',
  corpusId: 'bundle-file-fixture',
  corpusDigest: 'sha256:fixture',
  conformanceProfile: 'common.edit/writer-v1',
  optionsFingerprint: 'options:bundle-fixture',
  inputClass: 'two-files',
  provenAt: '2026-09-08T00:00:00Z',
  writer: {
    providerId: 'fixture/writer',
    providerVersion: '1',
    artifactDigest: 'sha256:fixture',
    formatId: 'fixture',
    representationId: 'source',
  },
}
async function fixture() {
  const n = sequence++
  const ownerPath = join(scratch, `${n}-model.bin`),
    companionPath = join(scratch, `${n}-texture.bin`)
  writeFileSync(ownerPath, 'model')
  writeFileSync(companionPath, 'texture')
  const owner = await openFileArtifactSource(ownerPath),
    companion = await openFileArtifactSource(companionPath)
  const bindings: BundleAssetInput['bindings'] = [
    {
      sourceKind: 'candidate',
      bindingId: 'model',
      role: 'content',
      ownership: 'owned',
      source: owner.ref,
      revision: owner.revision,
    },
    {
      sourceKind: 'requirement',
      requirementId: 'textures',
      bindingId: 'texture',
      role: 'texture',
      ownership: 'companion',
      source: companion.ref,
      revision: companion.revision,
    },
  ]
  const revision = revisionId('provider-token:bundle-fixture')
  const input: BundleAssetInput = {
    originKind: 'bundle',
    primaryBindingId: 'model',
    bindings,
    revisions: {
      topology: 'bundle',
      revision,
      bindings: [
        { bindingId: 'model', revision: owner.revision },
        { bindingId: 'texture', revision: companion.revision },
      ],
      compositionFingerprint: 'fixture-open-bundle',
    },
    bindingsFor: () => [],
    openBinding: async () => {
      throw new Error('planning must not reopen inputs')
    },
  }
  const descriptor: UnresolvedSourceDescriptor = {
    schemaVersion: 2,
    subjectUri: owner.ref.uri,
    origin: {
      kind: 'bundle',
      primary: 'model',
      bindings: bindings.map(binding => ({
        id: binding.bindingId,
        role: binding.role,
        source: binding.source,
        revision: binding.revision,
        ownership: binding.ownership,
        required: true,
      })),
    },
    interpretation: 'none',
    candidates: [],
    revision,
    traits: [],
    operations: [],
    dataSources: [],
    diagnostics: [],
    constraints: { readOnly: false, seekable: true, randomAccess: true, trusted: false },
  }
  const backend = createFileEditingBackend({ roots: [scratch] })
  // A dependency can be readable without offering any write guarantee.
  const readBackend = {
    ...backend,
    writable: false,
    profile: { ...backend.profile, guarantees: ['best-effort'] as const },
  }
  const editing = createSubjectEditing({
    opened: {
      state: 'unresolved',
      reason: 'no-candidate',
      descriptor,
      candidates: [],
      diagnostics: [],
      fallback: { preferred: 'hex', available: ['hex'] },
    },
    grant: { id: 'bundle-write', classes: ['read-source', 'write-source'] },
    backendFor: id =>
      id === owner.ref.id ? backend : id === companion.ref.id ? readBackend : undefined,
    evidenceFor: () => evidence,
  })
  const plan = editPlanFromBinding(input, 'model', {
    planId: `bundle-${n}`,
    fidelity,
    edits: [replaceBytes(0, 5, new TextEncoder().encode('edited'))],
  })
  return { input, descriptor, owner, companion, ownerPath, companionPath, backend, editing, plan }
}
it('commits only the owned file with an atomic write and preserves companion revision guards', async () => {
  const f = await fixture()
  try {
    expect(f.editing.planFromOperation({ kind: 'edit-plan', plan: f.plan })).toEqual(f.plan)
    expect(f.plan.targets).toEqual(subjectEditTargetsFromDescriptor(f.descriptor))
    expect(f.editing.grantSnapshot.sourceIds).toEqual([f.owner.ref.id])
    const prepared = await f.editing.coordinator.prepare(f.plan, { grant: f.editing.grantSnapshot })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('not prepared')
    expect(prepared.prepared.writeSet.entries).toHaveLength(1)
    const result = await f.editing.coordinator.commit(prepared.prepared, {
      grant: f.editing.grantSnapshot,
    })
    expect(result.state).toBe('committed')
    if (result.state !== 'committed') throw new Error('not committed')
    expect(result.receipt.commitGuarantee).toBe('atomic')
    expect(result.receipt.writes).toHaveLength(1)
    expect(readFileSync(f.ownerPath, 'utf8')).toBe('edited')
    expect(readFileSync(f.companionPath, 'utf8')).toBe('texture')
    const undone = await f.editing.coordinator.undo(result.receipt.transactionId, {
      grant: f.editing.grantSnapshot,
    })
    expect(undone.state).toBe('committed')
    expect(readFileSync(f.ownerPath, 'utf8')).toBe('model')
    const redone = await f.editing.coordinator.redo(result.receipt.transactionId, {
      grant: f.editing.grantSnapshot,
    })
    expect(redone.state).toBe('committed')
    expect(readFileSync(f.ownerPath, 'utf8')).toBe('edited')
    expect(readFileSync(f.companionPath, 'utf8')).toBe('texture')
  } finally {
    await f.backend.dispose()
  }
})
it.each(['prepare', 'commit', 'undo'] as const)(
  'refuses a changed read-only companion at %s',
  async phase => {
    const f = await fixture()
    try {
      if (phase === 'prepare') {
        writeFileSync(f.companionPath, 'texture changed')
        const result = await f.editing.coordinator.prepare(f.plan, {
          grant: f.editing.grantSnapshot,
        })
        expect(result).toMatchObject({ state: 'conflict' })
      } else {
        const prepared = await f.editing.coordinator.prepare(f.plan, {
          grant: f.editing.grantSnapshot,
        })
        if (prepared.state !== 'ready') throw new Error('not prepared')
        if (phase === 'undo') {
          const committed = await f.editing.coordinator.commit(prepared.prepared, {
            grant: f.editing.grantSnapshot,
          })
          if (committed.state !== 'committed') throw new Error('not committed')
          writeFileSync(f.companionPath, 'texture changed')
          const result = await f.editing.coordinator.undo(committed.receipt.transactionId, {
            grant: f.editing.grantSnapshot,
          })
          expect(result).toMatchObject({ state: 'not-applied', reason: 'stale-revision' })
          expect(readFileSync(f.ownerPath, 'utf8')).toBe('edited')
          return
        }
        writeFileSync(f.companionPath, 'texture changed')
        const result = await f.editing.coordinator.commit(prepared.prepared, {
          grant: f.editing.grantSnapshot,
        })
        expect(result).toMatchObject({ state: 'not-applied', reason: 'stale-revision' })
      }
      expect(readFileSync(f.ownerPath, 'utf8')).toBe('model')
    } finally {
      await f.backend.dispose()
    }
  },
)
it('rejects omitted guards, companion writes, foreign owners and source aliases', async () => {
  const f = await fixture()
  try {
    expect(() =>
      editPlanFromBinding(f.input, 'texture', { planId: 'bad', edits: [], fidelity }),
    ).toThrow('owned binding')
    expect(() =>
      editPlanFromBinding(f.input, 'model', {
        planId: 'bad',
        fidelity,
        edits: [{ ...replaceBytes(0, 1, Uint8Array.of(1)), targetId: 'texture' }],
      }),
    ).toThrow('different owner')
    expect(() =>
      editPlanFromOperationForDescriptor(f.descriptor, {
        kind: 'edit-plan',
        plan: {
          ...f.plan,
          targets: f.plan.targets.slice(0, 1),
        },
      }),
    ).toThrow('every opened binding')
    expect(() =>
      editPlanFromOperationForDescriptor(f.descriptor, {
        kind: 'edit-plan',
        plan: {
          ...f.plan,
          edits: [
            {
              ...replaceBytes(0, 1, Uint8Array.of(1)),
              targetId: 'texture',
              source: f.companion.ref,
            },
          ],
        },
      }),
    ).toThrow('not this subject')
    const [first, second] = f.input.bindings
    if (second === undefined) throw new Error('second binding absent')
    const aliased: BundleAssetInput = {
      ...f.input,
      bindings: [first, { ...second, source: first.source }],
    }
    expect(() =>
      editPlanFromBinding(aliased, 'model', { planId: 'bad', edits: [], fidelity }),
    ).toThrow('aliased')
  } finally {
    await f.backend.dispose()
  }
})
