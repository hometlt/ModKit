/**
 * A plan editing one file of a directory-namespace subject (a folder .SC2Map): the host admits the
 * entry target namespaceEntryEditTarget builds, and the file backend pins it the same way.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkit/core'
import { fileSystemRevisionToken } from '@modkit/vfs/providers/file'
import {
  namespaceEntryEditTarget,
  revisionId,
  type AnyDescriptor,
  type AssetEditPlan,
  type PayloadStore,
} from '@modkit/sdk'
import { createFileEditingBackend } from '@modkit/host/node'
import { editPlanFromOperationForDescriptor } from '../src/subject-editing.js'

const scratch = mkdtempSync(join(tmpdir(), 'x3-namespace-entry-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const payloads: PayloadStore = {
  async open() {
    throw new Error('no staged payloads in this test')
  },
}

async function openedMap() {
  const directory = join(scratch, 'Window.SC2Map')
  mkdirSync(directory)
  writeFileSync(join(directory, 't3HeightMap'), Uint8Array.from([1, 2, 3]))
  writeFileSync(join(directory, 'MapInfo'), Uint8Array.from([9, 9]))
  const rootUri = pathToFileURL(directory).href
  const root = { id: rootUri, uri: rootUri }
  const namespaceRevision = revisionId(await fileSystemRevisionToken(directory))
  const descriptor = {
    subjectUri: rootUri,
    origin: { kind: 'namespace', root, revision: namespaceRevision },
  } as unknown as AnyDescriptor
  return { directory, root, namespaceRevision, descriptor }
}

const planFor = (target: ReturnType<typeof namespaceEntryEditTarget>, bytes: Uint8Array): AssetEditPlan =>
  ({
    planId: 'heights',
    targets: [target],
    edits: [{ operation: 'replace', targetId: target.targetId, source: target.ownerSource, payload: { kind: 'inline', bytes } }],
    semantics: 'atomic',
    fidelity: { roundTrip: 'semantic', preservesUnknownData: true },
    diagnostics: [],
  }) as unknown as AssetEditPlan

describe('editing one file of a directory-namespace subject', () => {
  it('admits the entry target and commits only that file at the pinned revision', async () => {
    const { directory, root, namespaceRevision, descriptor } = await openedMap()
    const target = namespaceEntryEditTarget({
      subjectUri: descriptor.subjectUri,
      root,
      namespaceRevision,
      entry: { path: 't3HeightMap', size: 3 },
    })
    const plan = editPlanFromOperationForDescriptor(descriptor, { kind: 'edit-plan', plan: planFor(target, Uint8Array.from([4, 5, 6])) } as never)
    const backend = createFileEditingBackend({ roots: [scratch] })
    expect(canonicalJsonStringify(await backend.currentRevision(target))).toBe(
      canonicalJsonStringify(target.expectedRevision),
    )
    const edit = plan.edits[0]!
    const applied = await backend.apply(edit, { transactionId: 'heights', payloads, expectedRevision: target.expectedRevision })
    expect([...readFileSync(join(directory, 't3HeightMap'))]).toEqual([4, 5, 6])
    expect([...readFileSync(join(directory, 'MapInfo'))]).toEqual([9, 9])
    expect(canonicalJsonStringify(applied.after)).not.toBe(canonicalJsonStringify(target.expectedRevision))
    await backend.dispose()
  })

  it('refuses an entry of another root or one that leaves the namespace', async () => {
    const { root, namespaceRevision, descriptor } = await openedMap().catch(async () => {
      const directory = join(scratch, `Other-${Date.now()}.SC2Map`)
      mkdirSync(directory)
      const rootUri = pathToFileURL(directory).href
      const namespaceRevision = revisionId(await fileSystemRevisionToken(directory))
      return {
        root: { id: rootUri, uri: rootUri },
        namespaceRevision,
        descriptor: { subjectUri: rootUri, origin: { kind: 'namespace', root: { id: rootUri, uri: rootUri }, revision: namespaceRevision } } as unknown as AnyDescriptor,
      }
    })
    const foreign = namespaceEntryEditTarget({
      subjectUri: descriptor.subjectUri,
      root: { id: `${root.id}-other`, uri: pathToFileURL(join(scratch, 'Elsewhere.SC2Map')).href },
      namespaceRevision,
      entry: { path: 't3HeightMap', size: 3 },
    })
    const escaping = namespaceEntryEditTarget({ subjectUri: descriptor.subjectUri, root, namespaceRevision, entry: { path: '../x', size: 1 } })
    for (const target of [foreign, escaping]) {
      expect(() =>
        editPlanFromOperationForDescriptor(descriptor, { kind: 'edit-plan', plan: planFor(target, Uint8Array.of(0)) } as never),
      ).toThrow(/is not this subject/)
    }
  })
})
