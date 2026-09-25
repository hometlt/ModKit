/**
 * A plan editing one file of a directory-namespace subject (a folder .SC2Map): the host admits the
 * entry target namespaceEntryEditTarget builds, grants the namespace root, and the file backend pins
 * and commits it the same way.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkit/core'
import { fileSystemRevisionToken } from '@modkit/vfs/providers/file'
import { namespaceEntryEditTarget, revisionId, type AnyDescriptor, type AssetEditPlan } from '@modkit/sdk'
import { createFileEditingBackend } from '@modkit/host/node'
import { createSubjectEditing, editPlanFromOperationForDescriptor } from '../src/subject-editing.js'

const scratch = mkdtempSync(join(tmpdir(), 'x3-namespace-entry-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let maps = 0

async function openedMap() {
  const directory = join(scratch, `Window-${maps++}.SC2Map`)
  mkdirSync(directory)
  writeFileSync(join(directory, 't3HeightMap'), Uint8Array.from([1, 2, 3]))
  writeFileSync(join(directory, 'MapInfo'), Uint8Array.from([9, 9]))
  const rootUri = pathToFileURL(directory).href
  const root = { id: rootUri, uri: rootUri }
  const namespaceRevision = revisionId(await fileSystemRevisionToken(directory))
  const descriptor = {
    subjectUri: rootUri,
    revision: namespaceRevision,
    origin: { kind: 'namespace', root, revision: namespaceRevision },
  } as unknown as AnyDescriptor
  return { directory, root, namespaceRevision, descriptor }
}

const planFor = (target: ReturnType<typeof namespaceEntryEditTarget>, bytes: Uint8Array): AssetEditPlan =>
  ({
    planId: 'heights',
    targets: [target],
    edits: [{ operation: 'replace', targetId: target.targetId, source: target.ownerSource, payload: { kind: 'inline', bytes } }],
    semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
    fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
    diagnostics: [],
  }) as unknown as AssetEditPlan

describe('editing one file of a directory-namespace subject', () => {
  it('names the file as the target subject and pins it as the backend does', async () => {
    const { root, namespaceRevision } = await openedMap()
    const target = namespaceEntryEditTarget({ root, namespaceRevision, entry: { path: 't3HeightMap', size: 3 } })
    expect(target.subjectUri.endsWith('t3HeightMap')).toBe(true)
    const backend = createFileEditingBackend({ roots: [scratch] })
    expect(canonicalJsonStringify(await backend.currentRevision(target))).toBe(
      canonicalJsonStringify(target.expectedRevision),
    )
    await backend.dispose()
  })

  it('prepares and commits only that file through the subject editing grant', async () => {
    const { directory, root, namespaceRevision, descriptor } = await openedMap()
    const target = namespaceEntryEditTarget({ root, namespaceRevision, entry: { path: 't3HeightMap', size: 3 } })
    const backend = createFileEditingBackend({ roots: [scratch] })
    try {
      const editing = createSubjectEditing({
        opened: { state: 'opened', descriptor } as never,
        grant: { id: 'namespace-entry', classes: ['read-source', 'write-source'] },
        backendFor: () => backend,
        evidenceFor: () => ({
          roundTrip: 'byte-identical',
          preservesUnknownData: true,
          evidenceId: 'test:namespace-entry',
          corpusId: 'test',
          corpusDigest: 'none:test',
          conformanceProfile: 'common.edit/writer-v1' as never,
          writer: {
            providerId: 'test/map',
            providerVersion: '1.0.0',
            artifactDigest: 'sha256:0',
            formatId: 'sc2-map',
            representationId: 'map-layers',
          },
          optionsFingerprint: 'options:none',
          inputClass: 'test',
          provenAt: '2026-09-26T00:00:00Z',
        }),
      })
      expect(editing.grantSnapshot.namespaceRoots).toEqual([root.uri])
      const plan = editing.planFromOperation({ kind: 'edit-plan', plan: planFor(target, Uint8Array.from([4, 5, 6])) } as never)
      const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
      expect(prepared.state, JSON.stringify(prepared)).toBe('ready')
      if (prepared.state !== 'ready') return
      const committed = await editing.coordinator.commit(prepared.prepared, { grant: editing.grantSnapshot })
      expect(committed.state, JSON.stringify(committed)).toBe('committed')
      expect([...readFileSync(join(directory, 't3HeightMap'))]).toEqual([4, 5, 6])
      expect([...readFileSync(join(directory, 'MapInfo'))]).toEqual([9, 9])
    } finally {
      await backend.dispose()
    }
  })

  it('refuses an entry of another root or one that leaves the namespace', async () => {
    const { root, namespaceRevision, descriptor } = await openedMap()
    const foreign = namespaceEntryEditTarget({
      root: { id: `${root.id}-other`, uri: pathToFileURL(join(scratch, 'Elsewhere.SC2Map')).href },
      namespaceRevision,
      entry: { path: 't3HeightMap', size: 3 },
    })
    const escaping = namespaceEntryEditTarget({ root, namespaceRevision, entry: { path: '../x', size: 1 } })
    for (const target of [foreign, escaping]) {
      expect(() =>
        editPlanFromOperationForDescriptor(descriptor, { kind: 'edit-plan', plan: planFor(target, Uint8Array.of(0)) } as never),
      ).toThrow(/is not this subject/)
    }
  })
})
