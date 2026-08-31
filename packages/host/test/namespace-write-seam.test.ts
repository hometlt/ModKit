/**
 * Block 12 slice 12-3 item 1 — creating a *new* artifact through the durable-write coordinator.
 *
 * Slice 12-2 pinned the hole this file closes. A writer that wants to export a new artifact (UVT
 * produces two: a KTX2 container and a JSON sidecar) has to say which namespace it is creating
 * into, because `invalidPlan` refuses any `create`, `delete` or `rename` whose target carries no
 * `namespaceRevision` — without one there is nothing to check for a conflict. Every subject a
 * writer could obtain was `single` topology, where that field is `never` at the type level, so the
 * refusal was unconditional: **no writer could create anything, ever.**
 *
 * The fix needed no ABI change, and that is the point of the design. `topology: 'namespace'`
 * already carries exactly the field the rule asks for; what was missing was a way to *get* such a
 * target. A directory opened through block 9's file VFS provider is a namespace subject, and this
 * file proves the whole path works end to end:
 *
 *  - a directory subject yields an edit target whose `expectedRevision.namespaceRevision` is set;
 *  - the coordinator accepts a two-`create` plan that it used to refuse as `plan-invalid`;
 *  - both entries land *inside* the pinned directory, not beside it;
 *  - the optimistic check is **real**: a concurrent create between plan and commit is a detected
 *    conflict, not last-writer-wins.
 *
 * That last case is the one that matters most, and it is why the backend had to change too. Every
 * `namespaceRevision` in the file backend used to be copied through from the plan's own expected
 * revision, so "live" and "expected" were the same value and could never disagree. A guarantee that
 * cannot fail is not a guarantee; the backend now reads the directory's own token instead.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createHostContributionContractRegistry,
  createExecutionBackendRegistry,
  createSubjectEditing,
} from '@modkit/host'
import { createFileEditingBackend } from '@modkit/host/node'
import { VirtualFileSystem } from '@modkit/vfs'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'
import type { AssetEditPlan, FidelityEvidence, PermissionGrant, ResourceBudget } from '@modkit/sdk'

const WRITE = Object.freeze({
  classes: Object.freeze(['read-source', 'write-source']),
}) as unknown as PermissionGrant

const budget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 64,
}

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const

/**
 * Evidence for the export claim this plan makes.
 *
 * The coordinator refuses a plan whose fidelity claim nothing vouches for, which is right and is a
 * separate rule from the namespace one. An export that creates new bytes is honestly `lossy` — the
 * created artifact is not a copy of anything — so that is what is claimed and what is proven.
 */
const EXPORT_EVIDENCE = Object.freeze({
  roundTrip: 'lossy' as const,
  preservesUnknownData: false as const,
  evidenceId: 'x3.test/namespace-export',
  corpusId: 'namespace-write-seam',
  corpusDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  conformanceProfile: 'export-only',
  writer: {
    providerId: 'x3.test/namespace-export-writer',
    providerVersion: '1.0.0',
    artifactDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    formatId: 'x3.test/export',
    representationId: 'source',
  },
  optionsFingerprint: 'none',
  inputClass: 'synthetic',
  provenAt: '2026-08-26T00:00:00.000Z',
}) as unknown as FidelityEvidence

/** The explicit confirmation a lossy plan requires before the coordinator will prepare it. */
const CONFIRM = 'namespace-export-confirmed'

let scratch: string | undefined

afterEach(async () => {
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
  scratch = undefined
})

/** Open `directory` as a namespace subject: block 9's file provider, bridged to an SDK namespace. */
async function openNamespaceSubject(directory: string) {
  const { openSubject } = await import('@modkit/host')
  const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
  const mount = await vfs.openMount(pathToFileURL(directory).href)
  const uri = pathToFileURL(directory).href
  const source = artifactNamespaceSourceFromVfsMount(mount, { ref: { id: uri, uri } })
  const inventory = await buildInventory([], createHostContributionContractRegistry())
  const opened = await openSubject({
    inventory,
    source,
    path: directory,
    intent: 'full',
    target,
    grant: WRITE,
    budget,
    executionBackends: createExecutionBackendRegistry([]),
  })
  /*
   * `unresolved` is the correct state here, not a failure: no codec claims a bare directory, and
   * none should have to. The descriptor still carries the namespace origin, which is everything an
   * edit target needs.
   */
  if (opened.state !== 'unresolved') throw new Error(`unexpected state ${opened.state}`)
  if (opened.descriptor.origin.kind !== 'namespace') {
    throw new Error(`expected a namespace origin, got ${opened.descriptor.origin.kind}`)
  }
  return { opened, mount }
}

function planFor(
  targets: readonly { targetId: string; ownerSource: { id: string; uri: string } }[],
  entries: readonly { name: string; text: string }[],
): AssetEditPlan {
  const first = targets[0]
  if (first === undefined) throw new Error('no edit target')
  return {
    planId: 'namespace-create-plan',
    targets,
    edits: entries.map(entry => ({
      operation: 'create' as const,
      targetId: first.targetId,
      source: first.ownerSource,
      newPath: entry.name,
      payload: { kind: 'text' as const, text: entry.text },
    })),
    semantics: { mutationMode: 'export-only', minimumGuarantee: 'atomic' },
    fidelity: {
      roundTrip: 'lossy',
      preservesUnknownData: false,
      notes: ['export creates new bytes'],
    },
    diagnostics: [],
  } as unknown as AssetEditPlan
}

describe('12-3 a writer can create a new artifact through the commit coordinator', () => {
  it('pins the namespace revision on the edit target a directory subject yields', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'x3-namespace-seam-'))
    const { opened, mount } = await openNamespaceSubject(scratch)

    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => createFileEditingBackend({ roots: [scratch as string] }),
      evidenceFor: () => EXPORT_EVIDENCE,
      // a lossy plan needs an explicit confirmation; the export says so rather than pretending
      confirmationMatches: token => token === CONFIRM,
    })
    const editTarget = editing.targets[0]
    if (editTarget === undefined) throw new Error('no edit target')

    // the field the coordinator's create rule requires, and the reason the refusal existed
    expect(editTarget.expectedRevision.namespaceRevision).toBeDefined()
    expect(editTarget.expectedRevision.namespaceRevision).toMatch(/^provider-token:/u)
    await mount.dispose()
  }, 60_000)

  it('commits two creates and puts both inside the directory the plan pinned', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'x3-namespace-seam-'))
    const { opened, mount } = await openNamespaceSubject(scratch)

    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => createFileEditingBackend({ roots: [scratch as string] }),
      evidenceFor: () => EXPORT_EVIDENCE,
      // a lossy plan needs an explicit confirmation; the export says so rather than pretending
      confirmationMatches: token => token === CONFIRM,
    })
    const plan = planFor(editing.targets, [
      { name: 'export.uvt.json', text: '{"profile":"uvt"}' },
      { name: 'export.notes.txt', text: 'second artifact of the same export' },
    ])

    const prepared = await editing.coordinator.prepare(plan, {
      grant: editing.grantSnapshot,
      confirmationToken: CONFIRM,
    })
    // this is the assertion slice 12-2 could only make in the negative
    expect(prepared.state, JSON.stringify(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, JSON.stringify(committed)).toBe('committed')

    // inside the namespace, not beside it — the `dirname` rule would have put them one level up
    const listed = (await readdir(scratch)).filter(name => !name.startsWith('.x3-edit-')).sort()
    expect(listed).toEqual(['export.notes.txt', 'export.uvt.json'])
    expect(await readFile(join(scratch, 'export.uvt.json'), 'utf8')).toBe('{"profile":"uvt"}')
    await mount.dispose()
  }, 60_000)

  it('detects a concurrent create instead of overwriting it: the check reads the directory', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'x3-namespace-seam-'))
    const { opened, mount } = await openNamespaceSubject(scratch)

    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => createFileEditingBackend({ roots: [scratch as string] }),
      evidenceFor: () => EXPORT_EVIDENCE,
      // a lossy plan needs an explicit confirmation; the export says so rather than pretending
      confirmationMatches: token => token === CONFIRM,
    })
    const plan = planFor(editing.targets, [{ name: 'export.uvt.json', text: '{"mine":true}' }])
    const prepared = await editing.coordinator.prepare(plan, {
      grant: editing.grantSnapshot,
      confirmationToken: CONFIRM,
    })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return

    /*
     * Somebody else writes into the same directory between plan and commit. The directory's own
     * mtime moves, so the namespace revision the plan pinned is stale. Before this slice the
     * backend echoed the expected value back to itself and this commit would have succeeded,
     * silently racing; now it is refused.
     */
    await writeFile(join(scratch, 'someone-elses-file.txt'), 'written by another writer')

    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, JSON.stringify(committed)).not.toBe('committed')

    // and the loser's file is not on disk: a refused commit creates nothing
    const listed = (await readdir(scratch)).filter(name => !name.startsWith('.x3-edit-')).sort()
    expect(listed).toEqual(['someone-elses-file.txt'])
    await mount.dispose()
  }, 60_000)
})
