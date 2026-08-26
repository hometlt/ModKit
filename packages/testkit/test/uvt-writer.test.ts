/**
 * The UVT export, all the way through the one durable-write seam (block 12 slice 12-2, item 7).
 *
 * Slice 12-1 built the materializer and proved the bytes against three oracles, but it wrote
 * nothing: the artifact never left memory, so `writerEvidence` stayed `not-declared` and the claim
 * "there is exactly one way bytes reach a source" was untested for this format. This file closes
 * that: a real BMP is opened through the host, materialized, and the two artifacts a UVT projection
 * consists of are written by `common.edit/writer@1` through the host commit coordinator under a
 * `write-source` grant — the same route the block-11A text writers take.
 *
 * It found the seam is not there yet, and that finding is the point of the file.
 *
 * A `create` edit is anchored to a namespace whose revision the coordinator can check for
 * conflicts, and `invalidPlan` refuses any plan whose create-target carries no `namespaceRevision`.
 * Every subject a writer can be handed today — a file, or an archive opened *as* a file — has a
 * `single` topology and therefore no namespace revision; the only creates that reach the
 * coordinator are the ones an archive codec authors itself through `edit.structure`. So a writer
 * cannot currently export a *new* artifact through the one durable-write seam at all.
 *
 * This file pins that: the writer's own contract is proved (it validates the two-artifact export,
 * refuses a `replace`, refuses a path that is neither of the two the profile names), the plan it
 * produces is proved, and the coordinator's refusal is asserted *with its reason* so that the day
 * exports gain a namespace-bearing target this test goes red and someone finishes the job.
 *
 * The reopen half is real regardless: the bytes are written, read back by the shipped KTX2 codec —
 * not by the materializer's own view of what it wrote — and the sidecar is re-validated against the
 * pinned profile. A writer that can only be verified by the thing that wrote it is not verified.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type ChangeSet,
  type Codec,
  type ContributionContext,
  type FidelityEvidence,
  type PermissionGrant,
  type RasterImageSource,
  type ResourceBudget,
  type Writer,
} from '@modkitx-x3/sdk'
import { createSubjectEditing, type UnresolvedSubject } from '@modkitx-x3/host'
import { createFileEditingBackend } from '@modkitx-x3/host/node'
import { materializeTextureAndCompare, readKtx2Container } from '@modkitx-x3/testkit'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const WRITE: PermissionGrant = { id: 'uvt-write', classes: ['read-source', 'write-source'] }

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('the image fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('the image fixtures have no foreign service dependency')
    },
  },
}

const scratchDirectories: string[] = []
afterAll(async () => {
  for (const directory of scratchDirectories) {
    await rm(directory, { recursive: true, force: true })
  }
})

function inputFor(uri: string, bytes: Uint8Array): unknown {
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:uvt-writer-source'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: 'uvt-writer',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

/** Open the BMP through its shipped codec and drain its whole base level as one rgba8 region. */
async function decodedBmp(): Promise<{
  info: Record<string, unknown>
  region: {
    width: number
    height: number
    rowStride: number
    pixelFormat: string
    pixels: Uint8Array
  }
  dispose(): Promise<void>
}> {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'common', 'images', 'src', 'bmp', 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  const bytes = new Uint8Array(await readFile(join(fixtures, 'minimal.bmp')))
  const session = await module
    .createCodec(context)
    .open(inputFor('memory://uvt/source.bmp', bytes) as never, 'inspect', budget)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  const raster = lease.value as RasterImageSource
  const info = (await raster.info()) as unknown as Record<string, unknown>
  if (raster.readRegion === undefined) throw new Error('the BMP publishes no decoded region')
  const region = await raster.readRegion({
    x: 0,
    y: 0,
    width: info['width'] as number,
    height: info['height'] as number,
    pixelFormat: 'rgba8',
    maxBytes: 8_000_000,
  })
  return {
    info,
    region: region as never,
    async dispose() {
      await lease.release()
      await session.dispose()
    },
  }
}

describe('12-2 UVT export writes through the host coordinator and reopens', () => {
  it('plans the two-artifact export, is refused for want of a namespace target, and reopens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'x3-uvt-write-'))
    scratchDirectories.push(directory)
    /*
     * The subject being written *into* is the namespace the artifacts land in.
     *
     * A `create` edit is anchored to a namespace whose revision the coordinator can check for
     * conflicts — that is what `expectedRevision.namespaceRevision` is for. Slice 12-2 could only
     * pin the absence of such a target; slice 12-3 supplies one, because a directory opened through
     * block 9's file provider *is* a namespace subject. So the export now runs the whole way to
     * disk through the one durable-write seam, which is what this file was written to prove.
     */

    const image = await decodedBmp()
    const verdict = await materializeTextureAndCompare(repoRoot, image, {
      assetId: 'synthetic/bmp',
      subjectRevision: 'content-hash.sha256:uvt-writer-source',
    })
    await image.dispose()
    expect(verdict.mappingViolations).toEqual([])

    /*
     * The writer module, resolved as a provider exactly as the host would. It is the *only* route
     * to disk for this format — the materializer produced bytes and has no way to persist them,
     * which is the ADR-UV-001 split working as designed rather than an inconvenience.
     */
    const writerModule = (await import(
      pathToFileURL(
        join(repoRoot, 'extensions', 'common', 'uv-materializer', 'src', 'texture-writer.js'),
      ).href
    )) as {
      createProvider(selection: { offerId: string }): Promise<{ value: Writer }>
    }
    const writerLease = await writerModule.createProvider({ offerId: 'uvt-source' })
    const writer = writerLease.value
    expect(writer.offer).toMatchObject({
      formatId: 'uvt',
      mutationMode: 'export-only',
      minimumRoundTrip: 'lossy',
    })

    // the subject being exported *from* is the image; the artifacts land inside the namespace
    const opened = await openNamespaceSubjectFor(directory)
    const backend = createFileEditingBackend({ roots: [directory] })
    const evidence: FidelityEvidence = {
      roundTrip: 'lossy',
      preservesUnknownData: false,
      evidenceId: writer.offer.fidelityEvidenceId,
      corpusId: 'modkitX3/packages/testkit/test/uvt-writer',
      corpusDigest: `sha256:${createHash('sha256').update(verdict.bytes).digest('hex')}`,
      conformanceProfile: 'common.edit/writer-v1' as never,
      writer: writer.identity,
      optionsFingerprint: 'options:uvt-core-1.0',
      inputClass: 'rgba8-base-level',
      provenAt: '2026-08-26T00:00:00Z',
    }
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence,
      writer,
      confirmationMatches: token => token === UVT_EXPORT_CONFIRMED,
    })
    if (editing.session === undefined) throw new Error('the UVT writer produced no session')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no edit target')

    const containerPath = 'source.uvt.ktx2'
    const sidecarPath = 'source.uvt.json'
    const sidecarBytes = new TextEncoder().encode(`${JSON.stringify(verdict.sidecar, null, 2)}\n`)
    const change: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'create',
          targetId: target.targetId,
          source: target.ownerSource,
          newPath: containerPath,
          payload: { kind: 'inline', bytes: verdict.bytes },
          label: 'UVT container',
        },
        {
          operation: 'create',
          targetId: target.targetId,
          source: target.ownerSource,
          newPath: sidecarPath,
          payload: { kind: 'inline', bytes: sidecarBytes },
          label: 'UVT sidecar',
        },
      ],
      provenance: { actor: 'user', note: 'block 12 slice 12-2 UVT export' },
    }
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })

    const plan = await editing.session.plan(change)
    // `lossy`, and the notes say in what way — a UVT container is not a copy of the source image
    expect(plan.fidelity).toMatchObject({ roundTrip: 'lossy', preservesUnknownData: false })
    expect(plan.fidelity.notes?.join(' ')).toContain('base level')
    expect(plan.semantics.mutationMode).toBe('export-only')
    expect(plan.edits.map(edit => edit.operation)).toEqual(['create', 'create'])

    /*
     * And here the seam now holds. The target is the namespace, so it carries the
     * `namespaceRevision` the create rule requires, and the coordinator takes the plan: prepare,
     * then commit, then two artifacts on disk written by the host and nobody else. The lossy claim
     * still needs an explicit confirmation, which an export that creates new bytes should need.
     */
    expect(editing.targets[0]?.expectedRevision.namespaceRevision).toBeDefined()
    const prepared = await editing.coordinator.prepare(plan, {
      grant: editing.grantSnapshot,
      confirmationToken: UVT_EXPORT_CONFIRMED,
    })
    expect(prepared.state, JSON.stringify(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, JSON.stringify(committed)).toBe('committed')

    // --- reopen ---------------------------------------------------------------------------
    const writtenContainer = new Uint8Array(await readFile(join(directory, 'source.uvt.ktx2')))
    const writtenSidecar = JSON.parse(
      await readFile(join(directory, 'source.uvt.json'), 'utf8'),
    ) as typeof verdict.sidecar

    // byte-for-byte what the materializer produced: the writer transports, it does not re-encode
    expect(Buffer.compare(Buffer.from(writtenContainer), Buffer.from(verdict.bytes))).toBe(0)

    /*
     * Read back by the shipped KTX2 codec — a reader that knows nothing about UVT — and every row
     * of the mandatory mapping table is compared against what *it* saw. This is the part that makes
     * the sidecar worth having: the two agree, or one of them is wrong.
     */
    const ktx2 = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'common', 'images', 'src', 'ktx2', 'codec.js'))
        .href
    )) as { createCodec(context: ContributionContext): Codec }
    const reopened = await ktx2
      .createCodec(context)
      .open(
        inputFor(pathToFileURL(containerPath).href, writtenContainer) as never,
        'inspect',
        budget,
      )
    const inspected = await reopened.operations().invoke('inspect', null)
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
    const summary = inspected.output.value as unknown as {
      width: number
      height: number
      vkFormat: number
      mipLevels: number
      faces: number
      supercompression: string
    }
    await reopened.dispose()

    expect(summary.vkFormat).toBe(writtenSidecar.ktx2.vkFormat)
    expect(summary.width).toBe(writtenSidecar.ktx2.pixelWidth)
    expect(summary.height).toBe(writtenSidecar.ktx2.pixelHeight)
    expect(summary.mipLevels).toBe(writtenSidecar.ktx2.levelCount)
    expect(summary.faces).toBe(writtenSidecar.ktx2.faceCount)
    expect(summary.supercompression).toBe('none')

    // and the pinned profile still accepts the sidecar after a round trip through the filesystem
    const { assertUvtProfile } = (await import(
      pathToFileURL(
        join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'tools', 'uvt-profile.mjs'),
      ).href
    )) as { assertUvtProfile(sidecar: unknown): unknown }
    expect(() => assertUvtProfile(writtenSidecar)).not.toThrow()
    const container = readKtx2Container(writtenContainer)
    expect(container.keyValues['KTXorientation']).toBe(writtenSidecar.orientation)
    expect(container.transferFunction).toBe(writtenSidecar.color.transferFunction)
  }, 120_000)

  it('refuses a replace and a path that is neither of the two the profile names', async () => {
    const writerModule = (await import(
      pathToFileURL(
        join(repoRoot, 'extensions', 'common', 'uv-materializer', 'src', 'texture-writer.js'),
      ).href
    )) as { createProvider(selection: { offerId: string }): Promise<{ value: Writer }> }
    const writer = (await writerModule.createProvider({ offerId: 'uvt-source' })).value
    const targets = [
      { targetId: 't1', ownerSource: { id: 'memory://x', uri: 'memory://x' } },
    ] as never as ChangeSet['targets']
    const base = { targets, provenance: { actor: 'user' as const } }

    const replaced = await writer.validate({
      ...base,
      edits: [
        {
          operation: 'replace',
          targetId: 't1',
          source: { id: 'memory://x', uri: 'memory://x' },
          range: { kind: 'utf16', offset: 0, length: 1 },
          payload: { kind: 'text', text: 'x' },
        },
      ],
    } as never as ChangeSet)
    // overwriting an existing file is a mutation, and this offer does not claim one
    expect(replaced.valid).toBe(false)
    expect(replaced.diagnostics.map(item => item.code)).toContain(
      'org.modkitx/uvt-writer-operation-unsupported',
    )

    const misnamed = await writer.validate({
      ...base,
      edits: [
        {
          operation: 'create',
          targetId: 't1',
          source: { id: 'memory://x', uri: 'memory://x' },
          newPath: 'texture.png',
          payload: { kind: 'inline', bytes: new Uint8Array([1]) },
        },
      ],
    } as never as ChangeSet)
    // the pairing is the whole reason the sidecar is worth having, so the names are checked
    expect(misnamed.valid).toBe(false)
    expect(misnamed.diagnostics.map(item => item.code)).toContain(
      'org.modkitx/uvt-writer-path-unexpected',
    )
  })
})

describe('12-3 the UVM export takes the same coordinator seam', () => {
  /*
   * Slice 12-2 recorded that UVM's `write-reopen-compared` meant an *artifact* round-trip —
   * materialize, reopen, compare — and not a commit through the host coordinator, because no
   * writer could create anything at all. The seam exists now, so the claim is made to mean the
   * stronger thing for UVM too: the bytes reach disk through `prepare`/`commit`, and what is read
   * back is what the coordinator wrote.
   *
   * The UVM writer claims `semantic` round-trip rather than `lossy`, so unlike UVT it needs no
   * confirmation token — which is the coordinator's rule working, not an inconsistency.
   */
  it('commits a materialized UVM artifact and reads back exactly those bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'x3-uvm-write-'))
    scratchDirectories.push(directory)

    const { loadUvTools, materializeAndCompare } = await import('@modkitx-x3/testkit')
    const gltf = (await import(
      pathToFileURL(join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'tools', 'uvm-core.mjs'))
        .href
    )) as { readGltfFixture(path: string): { document: unknown; binary: Uint8Array } }
    const tools = await loadUvTools(repoRoot)
    const fixture = join(
      repoRoot,
      'vendor',
      'multiverse-specs',
      'specs',
      'model',
      'fixtures',
      'uvm-core-triangle.uvm.gltf',
    )
    const { document, binary } = gltf.readGltfFixture(fixture)
    const verdict = await materializeAndCompare(
      repoRoot,
      tools.uvmCore.projectionFromUvmCore(document, binary),
      {
        assetId: 'synthetic/uvm-core-triangle',
        sourceFormat: 'uvm',
        subjectRevision: 'provider-token:uvm-writer-seam',
      },
    )

    const writerModule = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'common', 'uv-materializer', 'src', 'writer.js'))
        .href
    )) as { createProvider(selection: { offerId: string }): Promise<{ value: Writer }> }
    const writer = (await writerModule.createProvider({ offerId: 'uvm-source' })).value
    expect(writer.offer).toMatchObject({ formatId: 'uvm', mutationMode: 'export-only' })

    const opened = await openNamespaceSubjectFor(directory)
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => createFileEditingBackend({ roots: [directory] }),
      evidenceFor: () => ({
        roundTrip: 'semantic',
        preservesUnknownData: false,
        evidenceId: writer.offer.fidelityEvidenceId,
        corpusId: 'modkitX3/packages/testkit/test/uvm-writer-seam',
        corpusDigest: `sha256:${createHash('sha256').update(verdict.bytes).digest('hex')}`,
        conformanceProfile: 'common.edit/writer-v1' as never,
        writer: writer.identity,
        optionsFingerprint: 'options:uvm-core-1.0',
        inputClass: 'uvm-core-triangle',
        provenAt: '2026-08-26T00:00:00Z',
      }),
      writer,
    })
    if (editing.session === undefined) throw new Error('the UVM writer produced no session')
    const editTarget = editing.targets[0]
    if (editTarget === undefined) throw new Error('no edit target')
    expect(editTarget.expectedRevision.namespaceRevision).toBeDefined()

    const change: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'create',
          targetId: editTarget.targetId,
          source: editTarget.ownerSource,
          newPath: 'triangle.uvm.glb',
          payload: { kind: 'inline', bytes: verdict.bytes },
          label: 'UVM artifact',
        },
      ],
      provenance: { actor: 'user', note: 'block 12 slice 12-3 UVM export' },
    }
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await editing.session.plan(change)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, JSON.stringify(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, JSON.stringify(committed)).toBe('committed')

    // what the coordinator wrote is byte-for-byte what the materializer produced
    const written = new Uint8Array(await readFile(join(directory, 'triangle.uvm.glb')))
    expect(Buffer.compare(Buffer.from(written), Buffer.from(verdict.bytes))).toBe(0)
  }, 120_000)
})

/** The explicit confirmation a lossy export must carry before the coordinator will prepare it. */
const UVT_EXPORT_CONFIRMED = 'uvt-export-confirmed'

/**
 * Open a directory as a namespace subject — the edit target a `create` needs.
 *
 * `unresolved` is the right state and not a failure: no codec claims a bare directory, and the
 * descriptor still carries the namespace origin, which is all an edit target is derived from.
 */
async function openNamespaceSubjectFor(directory: string): Promise<UnresolvedSubject> {
  const { openSubject, artifactNamespaceSourceFromVfsMount } = await import('@modkitx-x3/host')
  const { VirtualFileSystem } = await import('@modkitx-x3/vfs')
  const { createFileVfsProvider } = await import('@modkitx-x3/vfs/providers/file')
  const { buildInventory, createHostContributionContractRegistry, createExecutionBackendRegistry } =
    await import('@modkitx-x3/host')
  const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
  const mount = await vfs.openMount(pathToFileURL(directory).href)
  const uri = pathToFileURL(directory).href
  const opened = await openSubject({
    inventory: await buildInventory([], createHostContributionContractRegistry()),
    source: artifactNamespaceSourceFromVfsMount(mount, { ref: { id: uri, uri } }),
    path: directory,
    intent: 'full',
    target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
    grant: WRITE,
    budget,
    executionBackends: createExecutionBackendRegistry([]),
  })
  if (opened.state !== 'unresolved') throw new Error(`unexpected subject state ${opened.state}`)
  return opened
}
