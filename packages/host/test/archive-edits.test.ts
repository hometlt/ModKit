/**
 * A4 — ZIP archive editing on the 13D seam (ADR-HOST-002 Path A), proven end to end on a real
 * archive built by this test:
 *
 *  edit.structure  adds one entry and removes another worker-brokered, returns a whole-source
 *                  edit plan across the boundary, the host commits it through the file backend
 *                  under `write-source`, and a reopen sees the new entry set;
 *  verbatim        every kept entry's local header + compressed data is byte-identical to the
 *                  original, its central-directory record differs only in the local-header
 *                  offset, and a kept deflated entry still inflates with `node:zlib`;
 *  edit.content    replaces one entry's payload (stored) and leaves the rest untouched;
 *  refusals        no `write-source` → the archive still opens (degraded) and the operation is
 *                  refused host-side; ZIP64 and encrypted archives are refused by the codec with
 *                  the reason on the descriptor, and nothing is written.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import {
  createHostTopology,
  type AssetEditPlan,
  type FidelityEvidence,
  type JsonValue,
  type NamespaceEntrySource,
  type PermissionGrant,
} from '@modkit/sdk'
import { createSubjectEditing, type ExtensionInput, type OpenedSubject } from '@modkit/host'
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
const archivesDir = join(repoRoot, 'extensions', 'archives')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/a4',
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
      policy: { id: 'org.example.policy/a4', revision: '1' },
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
      policy: { id: 'org.example.policy/a4-worker', revision: '1' },
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
const READ: PermissionGrant = { id: 'a4-read', classes: ['read-source'] }
const WRITE: PermissionGrant = { id: 'a4-write', classes: ['read-source', 'write-source'] }

const scratch = mkdtempSync(join(tmpdir(), 'x3-archive-edits-'))
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
      extensions: [await linked(archivesDir)],
      policy,
    }))())

// -----------------------------------------------------------------------------------------------
// A ZIP writer and reader owned by the proof: the codec's output is checked against an
// implementation that shares no code with it (CRC-32 and deflate come from `node:zlib`).

interface ZipInput {
  readonly name: string
  readonly data: Uint8Array
  readonly deflate?: boolean
  readonly extra?: Uint8Array
  readonly comment?: string
  readonly flags?: number
  readonly externalAttributes?: number
}

const DOS_TIME = 0x6000
const DOS_DATE = 0x5a21

function buildZip(inputs: readonly ZipInput[], archiveComment = ''): Buffer {
  const blocks: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const input of inputs) {
    const nameBytes = Buffer.from(input.name, 'utf8')
    const extra = Buffer.from(input.extra ?? new Uint8Array(0))
    const comment = Buffer.from(input.comment ?? '', 'utf8')
    const plain = Buffer.from(input.data)
    const payload = input.deflate === true ? deflateRawSync(plain) : plain
    const method = input.deflate === true ? 8 : 0
    const flags = input.flags ?? 0
    const sum = crc32(plain)
    const local = Buffer.alloc(30 + nameBytes.length + extra.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(plain.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(extra.length, 28)
    nameBytes.copy(local, 30)
    extra.copy(local, 30 + nameBytes.length)
    blocks.push(local, payload)
    const central = Buffer.alloc(46 + nameBytes.length + extra.length + comment.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(plain.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt16LE(comment.length, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(input.externalAttributes ?? 0, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    extra.copy(central, 46 + nameBytes.length)
    comment.copy(central, 46 + nameBytes.length + extra.length)
    centrals.push(central)
    offset += local.length + payload.length
  }
  const directory = Buffer.concat(centrals)
  const commentBytes = Buffer.from(archiveComment, 'utf8')
  const eocd = Buffer.alloc(22 + commentBytes.length)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(inputs.length, 8)
  eocd.writeUInt16LE(inputs.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(commentBytes.length, 20)
  commentBytes.copy(eocd, 22)
  return Buffer.concat([...blocks, directory, eocd])
}

interface ZipRead {
  readonly name: string
  readonly method: number
  readonly crc: number
  readonly compressedSize: number
  readonly size: number
  readonly comment: string
  readonly dosTime: number
  readonly dosDate: number
  readonly externalAttributes: number
  /** the entry's bytes in the file: local header, then compressed data */
  readonly block: Buffer
  /** the entry's central-directory record, offset field zeroed so records compare by content */
  readonly record: Buffer
}

function readZip(bytes: Buffer): { entries: ZipRead[]; comment: string } {
  let eocd = -1
  for (let at = bytes.length - 22; at >= 0; at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new Error('no EOCD in the archive')
  const count = bytes.readUInt16LE(eocd + 10)
  const commentLength = bytes.readUInt16LE(eocd + 20)
  const entries: ZipRead[] = []
  let at = bytes.readUInt32LE(eocd + 16)
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central record ${index}`)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const centralCommentLength = bytes.readUInt16LE(at + 32)
    const compressedSize = bytes.readUInt32LE(at + 20)
    const localOffset = bytes.readUInt32LE(at + 42)
    const recordLength = 46 + nameLength + extraLength + centralCommentLength
    const record = Buffer.from(bytes.subarray(at, at + recordLength))
    record.writeUInt32LE(0, 42)
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header ${index}`)
    const dataOffset =
      localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28)
    entries.push({
      name: bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      method: bytes.readUInt16LE(at + 10),
      crc: bytes.readUInt32LE(at + 16),
      compressedSize,
      size: bytes.readUInt32LE(at + 24),
      comment: bytes
        .subarray(at + 46 + nameLength + extraLength, at + recordLength)
        .toString('utf8'),
      dosTime: bytes.readUInt16LE(at + 12),
      dosDate: bytes.readUInt16LE(at + 14),
      externalAttributes: bytes.readUInt32LE(at + 38),
      block: Buffer.from(bytes.subarray(localOffset, dataOffset + compressedSize)),
      record,
    })
    at += recordLength
  }
  return { entries, comment: bytes.subarray(eocd + 22, eocd + 22 + commentLength).toString('utf8') }
}

function payloadOf(entry: ZipRead): Buffer {
  const data = entry.block.subarray(entry.block.length - entry.compressedSize)
  return entry.method === 8 ? inflateRawSync(data) : Buffer.from(data)
}

const named = (read: { entries: ZipRead[] }, name: string): ZipRead => {
  const found = read.entries.find(entry => entry.name === name)
  if (found === undefined) throw new Error(`no entry «${name}»`)
  return found
}

// -----------------------------------------------------------------------------------------------

const NOTES = '# notes\n\nthe quick brown fox jumps over the lazy dog, repeatedly.\n'.repeat(8)
const EXTENDED_TIMESTAMP = Uint8Array.from([0x55, 0x54, 0x05, 0x00, 0x03, 0x11, 0x22, 0x33, 0x44])

/** The fixture: a stored entry with an unknown extra field and a comment, a deflated entry, a
 * directory marker, a removable entry, and an archive comment. */
function fixture(): Buffer {
  return buildZip(
    [
      {
        name: 'readme.txt',
        data: Buffer.from('A4 fixture readme\n', 'utf8'),
        extra: EXTENDED_TIMESTAMP,
        comment: 'kept entry comment',
      },
      { name: 'data/notes.md', data: Buffer.from(NOTES, 'utf8'), deflate: true },
      { name: 'keep/', data: Buffer.alloc(0), externalAttributes: 0x10 },
      { name: 'drop.bin', data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) },
    ],
    'A4 archive comment',
  )
}

async function openArchive(name: string, bytes: Buffer, grant: PermissionGrant) {
  const path = join(scratch, name)
  writeFileSync(path, bytes)
  const result = await (
    await services()
  ).open({
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    grant,
    budget,
  })
  if (result.state !== 'opened') throw new Error(`open failed: ${result.reason}`)
  return { path, result }
}

let digest: string | undefined
async function artifactDigest(): Promise<string> {
  if (digest !== undefined) return digest
  const found = (await services()).inventory.extensions
    .find(item => item.contributions.some(c => c.manifest?.id === 'modkit/archive-zip'))
    ?.contributions.find(c => c.manifest?.id === 'modkit/archive-zip')?.record?.artifactDigest
  if (found === undefined) throw new Error('no archives artifact digest')
  digest = found
  return found
}

/** Host evidence policy of this proof: first-party evidence for verbatim ZIP re-assembly. */
function zipEvidence(
  plan: AssetEditPlan,
  opened: OpenedSubject,
  artifact: string,
  corpus: Buffer,
): FidelityEvidence {
  return {
    roundTrip: 'semantic',
    preservesUnknownData: plan.fidelity.preservesUnknownData,
    evidenceId: 'zip-verbatim-reassembly-v1',
    corpusId: 'modkit/packages/host/test/archive-edits.test.ts',
    corpusDigest: `sha256:${createHash('sha256').update(corpus).digest('hex')}`,
    conformanceProfile: 'modkit/codec-contribution-v1' as never,
    writer: {
      providerId: opened.selected.contributionId,
      providerVersion: '1.0.0',
      artifactDigest: artifact,
      formatId: 'zip',
      representationId: 'archive-namespace',
    },
    optionsFingerprint: 'options:stored-additions',
    inputClass: 'zip-classic',
    provenAt: '2026-08-19T00:00:00Z',
  }
}

const show = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

const descriptorDiagnostics = (opened: OpenedSubject): readonly { readonly code: string }[] =>
  (opened.descriptor as unknown as { readonly diagnostics?: readonly { readonly code: string }[] })
    .diagnostics ?? []

/** Invoke a mutating operation, commit its plan through the file backend, return the plan. */
async function commitOperation(
  opened: OpenedSubject,
  handlerId: string,
  input: JsonValue,
  corpus: Buffer,
  backendRoot: string,
): Promise<AssetEditPlan> {
  const invoked = await opened.session.operations().invoke(handlerId, input)
  expect(invoked.state, show(invoked)).toBe('ok')
  if (invoked.state !== 'ok') throw new Error('invoke rejected')
  expect(invoked.output.kind).toBe('edit-plan')
  const backend = createFileEditingBackend({ roots: [backendRoot] })
  try {
    const artifact = await artifactDigest()
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: plan => zipEvidence(plan, opened, artifact, corpus),
    })
    const plan = editing.planFromOperation(invoked.output)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('prepare not ready')
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, show(committed)).toBe('committed')
    return plan
  } finally {
    await backend.dispose()
  }
}

describe('A4 — ZIP editing on the 13D seam (ADR-HOST-002 Path A)', () => {
  it('lists what the container knows about an entry: stored size, method, timestamp and its own CRC', async () => {
    /*
     * A namespace listing that carries only a name and a size is not an archive viewer. The ZIP
     * codec has always parsed the compression method, the compressed size and the CRC-32 out of the
     * central directory — it simply never published them, so no host could show a column it had no
     * data for.
     */
    const { result } = await openArchive('listing.zip', fixture(), READ)
    const session = result.session
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 20 })
    const byPath = new Map(page.items.map(entry => [entry.path, entry]))

    const stored = byPath.get('readme.txt')
    const deflated = byPath.get('data/notes.md')
    const directory = byPath.get('keep/')
    if (stored === undefined || deflated === undefined || directory === undefined) {
      throw new Error(`missing entries: ${[...byPath.keys()].join(', ')}`)
    }

    // a stored entry: the two sizes agree, and saying so is the honest answer, not a missing field
    expect(stored.compression).toBe('stored')
    expect(stored.storedSize).toBe(stored.size)
    // a deflated one really is smaller, which is the fact a ratio column exists to show
    expect(deflated.compression).toBe('deflate')
    if (deflated.storedSize === undefined || deflated.size === undefined) throw new Error('sizes')
    expect(deflated.storedSize).toBeLessThan(deflated.size)

    // the container's own CRC-32, named so a consumer never infers the algorithm from a length
    expect(stored.checksum?.algorithm).toBe('crc-32')
    expect(stored.checksum?.value).toMatch(/^[0-9a-f]{8}$/u)

    // MS-DOS date/time carries no zone; it is read as UTC rather than shifted by the reader's own
    expect(stored.modifiedAt).toBe(Date.UTC(2025, 0, 1, 12, 0, 0))

    // a directory marker has no content to describe, and inventing zeroes for it would be a lie
    expect(directory.kind).toBe('directory')
    expect(directory.storedSize).toBeUndefined()
    expect(directory.checksum).toBeUndefined()

    await lease.release?.()
  })

  it('edit.structure adds and removes entries worker-brokered; kept entries are copied byte for byte and a kept deflated entry still inflates', async () => {
    const original = fixture()
    const { path, result } = await openArchive('structure.zip', original, WRITE)
    expect(result.selected.variantId).toBe('portable')
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    const declared = result.descriptor.operations.map(item => item.id)
    expect(declared).toContain('edit.structure')
    expect(declared).toContain('edit.content')
    expect(result.descriptor.constraints.readOnly).toBe(false)
    expect(descriptorDiagnostics(result)).toHaveLength(0)

    const added = Buffer.from('hello from A4\n', 'utf8')
    const plan = await commitOperation(
      result,
      'edit-structure',
      { add: [{ path: 'added/hello.txt', bytes: added.toString('base64') }], remove: ['drop.bin'] },
      original,
      scratch,
    )
    // one whole-source replace (no range) carrying the freshly assembled archive
    expect(plan.edits).toHaveLength(1)
    const edit = plan.edits[0]
    if (edit?.operation !== 'replace') throw new Error('expected a replace edit')
    expect(edit.range).toBeUndefined()
    expect(edit.payload.kind).toBe('inline')
    expect(plan.fidelity.roundTrip).toBe('semantic')
    // the fixture has a canonical layout, so nothing unknown is dropped and the claim is honest
    expect(plan.fidelity.preservesUnknownData).toBe(true)
    await result.session.dispose()

    const before = readZip(original)
    const after = readZip(readFileSync(path))
    expect(after.entries.map(entry => entry.name)).toEqual([
      'readme.txt',
      'data/notes.md',
      'keep/',
      'added/hello.txt',
    ])
    expect(after.comment).toBe('A4 archive comment')

    // every kept entry: local header + compressed data byte-identical, central record identical
    // apart from the local-header offset (zeroed by the reader before comparison)
    for (const name of ['readme.txt', 'data/notes.md', 'keep/']) {
      const source = named(before, name)
      const target = named(after, name)
      expect(Buffer.compare(target.block, source.block), `${name} block`).toBe(0)
      expect(Buffer.compare(target.record, source.record), `${name} record`).toBe(0)
    }
    // the unknown extra field and the entry comment rode along inside those verbatim bytes
    expect(named(after, 'readme.txt').comment).toBe('kept entry comment')
    expect(
      named(after, 'readme.txt').record.indexOf(Buffer.from(EXTENDED_TIMESTAMP)),
    ).toBeGreaterThan(0)

    // nothing was recompressed: the deflated entry is still deflate and still inflates
    const notes = named(after, 'data/notes.md')
    expect(notes.method).toBe(8)
    expect(notes.compressedSize).toBe(named(before, 'data/notes.md').compressedSize)
    expect(
      inflateRawSync(notes.block.subarray(notes.block.length - notes.compressedSize)).toString(
        'utf8',
      ),
    ).toBe(NOTES)

    // the new entry is stored with a CRC-32 node:zlib agrees with
    const hello = named(after, 'added/hello.txt')
    expect(hello.method).toBe(0)
    expect(hello.crc).toBe(crc32(added))
    expect(Buffer.compare(payloadOf(hello), added)).toBe(0)

    // and the host can reopen the result: the codec parses it and counts the new entry set
    const { result: reopened } = await openArchive(
      'structure-reopen.zip',
      readFileSync(path),
      WRITE,
    )
    const summary = (await reopened.session.operations().invoke('inspect', {})) as unknown as {
      readonly state: string
      readonly output: { readonly kind: string; readonly value: Record<string, unknown> }
    }
    expect(summary.state).toBe('ok')
    expect(summary.output.value['entries']).toBe(4)
    expect(summary.output.value['files']).toBe(3)
    expect(summary.output.value['editable']).toBe(true)
    await reopened.session.dispose()
  }, 60_000)

  it('edit.content replaces one entry (stored, fresh CRC) and leaves every other entry byte-identical', async () => {
    const original = fixture()
    const { path, result } = await openArchive('content.zip', original, WRITE)
    const replacement = Buffer.from('replaced by edit.content\n'.repeat(4), 'utf8')
    const plan = await commitOperation(
      result,
      'edit-content',
      { path: 'data/notes.md', bytes: replacement.toString('base64') },
      original,
      scratch,
    )
    expect(plan.planId).toBe('zip-edit-content:data/notes.md')
    await result.session.dispose()

    const before = readZip(original)
    const after = readZip(readFileSync(path))
    expect(after.entries.map(entry => entry.name)).toEqual(before.entries.map(entry => entry.name))
    const notes = named(after, 'data/notes.md')
    expect(notes.method).toBe(0)
    expect(notes.crc).toBe(crc32(replacement))
    expect(notes.size).toBe(replacement.length)
    expect(Buffer.compare(payloadOf(notes), replacement)).toBe(0)
    // the replaced entry keeps its own timestamp; the codec never invents one here
    expect(notes.dosTime).toBe(DOS_TIME)
    expect(notes.dosDate).toBe(DOS_DATE)
    for (const name of ['readme.txt', 'keep/', 'drop.bin']) {
      expect(Buffer.compare(named(after, name).block, named(before, name).block), name).toBe(0)
      expect(Buffer.compare(named(after, name).record, named(before, name).record), name).toBe(0)
    }
    expect(after.comment).toBe('A4 archive comment')
  }, 60_000)

  it('without write-source the archive still opens (degraded) and both mutating operations are refused by the host', async () => {
    const original = fixture()
    const { path, result } = await openArchive('read-only.zip', original, READ)
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/permission-degraded')
    for (const handler of ['edit-structure', 'edit-content']) {
      const invoked = await result.session
        .operations()
        .invoke(handler, { path: 'readme.txt', bytes: '' })
      expect(invoked.state, handler).toBe('rejected')
      if (invoked.state === 'rejected') expect(invoked.reason).toBe('permission-missing')
    }
    // reading is untouched
    const inspected = await result.session.operations().invoke('inspect', {})
    expect(inspected.state).toBe('ok')
    const namespace = await result.session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (namespace.value as NamespaceEntrySource).list('', { limit: 10 })
    const readme = page.items.find(item => item.path === 'readme.txt')
    if (readme === undefined) throw new Error('read-only ZIP did not list readme.txt')
    const extracted = await result.session
      .operations()
      .invoke('extract-entry', { entryId: readme.id })
    expect(extracted.state).toBe('ok')
    await namespace.release()
    await result.session.dispose()
    expect(Buffer.compare(readFileSync(path), original)).toBe(0)
  }, 60_000)

  it('edit.structure renames an entry without touching its data, and a non-canonical archive downgrades the fidelity claim honestly', async () => {
    // the same fixture with 16 bytes of junk after the EOCD: still readable, no longer a layout
    // whose every byte the central directory accounts for
    const original = Buffer.concat([fixture(), Buffer.alloc(16, 0x7a)])
    const { path, result } = await openArchive('rename.zip', original, WRITE)
    const plan = await commitOperation(
      result,
      'edit-structure',
      { rename: [{ from: 'data/notes.md', to: 'docs/notes.md' }] },
      original,
      scratch,
    )
    expect(plan.fidelity.roundTrip).toBe('semantic')
    expect(plan.fidelity.preservesUnknownData).toBe(false)
    expect(plan.fidelity.notes?.some(note => note.includes('canonical'))).toBe(true)
    await result.session.dispose()

    const before = readZip(original)
    const after = readZip(readFileSync(path))
    expect(after.entries.map(entry => entry.name)).toEqual([
      'readme.txt',
      'docs/notes.md',
      'keep/',
      'drop.bin',
    ])
    // the renamed entry: same method, same CRC, same compressed bytes — only the name moved
    const source = named(before, 'data/notes.md')
    const target = named(after, 'docs/notes.md')
    expect(target.method).toBe(source.method)
    expect(target.crc).toBe(source.crc)
    expect(target.compressedSize).toBe(source.compressedSize)
    expect(
      Buffer.compare(
        target.block.subarray(target.block.length - target.compressedSize),
        source.block.subarray(source.block.length - source.compressedSize),
      ),
    ).toBe(0)
    expect(
      inflateRawSync(target.block.subarray(target.block.length - target.compressedSize)).toString(
        'utf8',
      ),
    ).toBe(NOTES)
    for (const name of ['readme.txt', 'keep/', 'drop.bin']) {
      expect(Buffer.compare(named(after, name).block, named(before, name).block), name).toBe(0)
    }
    // the 16 trailing bytes are exactly what the plan warned it would drop
    expect(readFileSync(path).length).toBeLessThan(original.length)
  }, 60_000)

  it('an assembled archive above the host inline-payload cap is payload-unavailable; under the cap it commits', async () => {
    // 1.5 MiB of incompressible bytes stored: the whole-source payload is ~1.5 MiB
    const bulk = Buffer.alloc(1_536_000)
    for (let index = 0; index < bulk.length; index += 1) bulk[index] = (index * 2654435761) & 0xff
    const original = buildZip([{ name: 'bulk.bin', data: bulk }])
    const { path, result } = await openArchive('bulk.zip', original, WRITE)
    const invoked = await result.session.operations().invoke('edit-structure', {
      add: [{ path: 'tag.txt', bytes: Buffer.from('tag').toString('base64') }],
    })
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    const backend = createFileEditingBackend({ roots: [scratch] })
    const artifact = await artifactDigest()
    const options = {
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: (plan: AssetEditPlan) => zipEvidence(plan, result, artifact, original),
    }
    const editing = createSubjectEditing(options)
    const plan = editing.planFromOperation(invoked.output)
    const payload = plan.edits[0]
    if (payload?.operation !== 'replace' || payload.payload.kind !== 'inline') {
      throw new Error('expected an inline whole-source replace')
    }
    // deterministic assembly: the 1,536,038-byte bulk block, the new entry (40), two central
    // records (54 + 53) and the EOCD (22)
    expect(payload.payload.bytes.byteLength).toBe(1_536_207)
    // a host that caps inline payloads below the assembled archive writes nothing
    const capped = createSubjectEditing({ ...options, maxInlinePayloadBytes: 1024 * 1024 })
    expect(
      await capped.coordinator.prepare(capped.planFromOperation(invoked.output), {
        grant: capped.grantSnapshot,
      }),
    ).toMatchObject({ state: 'rejected', reason: 'payload-unavailable' })
    expect(Buffer.compare(readFileSync(path), original)).toBe(0)

    // and the same plan commits under the product default (16 MiB), which is what a real archive
    // save runs into first — the explicit raise below is what a host does for anything larger
    const raised = createSubjectEditing({ ...options, maxInlinePayloadBytes: 8 * 1024 * 1024 })
    const prepared = await raised.coordinator.prepare(raised.planFromOperation(invoked.output), {
      grant: raised.grantSnapshot,
    })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('prepare not ready')
    const committed = await raised.coordinator.commit(prepared.prepared, {
      grant: raised.grantSnapshot,
    })
    expect(committed.state, show(committed)).toBe('committed')
    await result.session.dispose()
    await backend.dispose()
    const after = readZip(readFileSync(path))
    expect(after.entries.map(entry => entry.name)).toEqual(['bulk.bin', 'tag.txt'])
    expect(
      Buffer.compare(
        named(after, 'bulk.bin').block,
        readZip(original).entries[0]?.block ?? Buffer.alloc(0),
      ),
    ).toBe(0)
  }, 60_000)

  it('ZIP64 and encrypted archives are refused with the reason on the descriptor and nothing is written', async () => {
    const zip64 = buildZip([
      {
        name: 'big.bin',
        data: Buffer.from('zip64 extended information'),
        // a well-formed ZIP64 extended-information extra field (header id 0x0001)
        extra: Uint8Array.from([0x01, 0x00, 0x10, 0x00, ...new Array<number>(16).fill(0)]),
      },
    ])
    const encrypted = buildZip([
      { name: 'secret.bin', data: Buffer.from('not really encrypted'), flags: 0x0001 },
    ])

    for (const [name, bytes, code] of [
      ['zip64.zip', zip64, 'x3.codec/zip-edit-zip64'],
      ['encrypted.zip', encrypted, 'x3.codec/zip-edit-encrypted'],
    ] as const) {
      const { path, result } = await openArchive(name, bytes, WRITE)
      // reading still works; only editing is refused, and the descriptor says why
      expect(descriptorDiagnostics(result).map(item => item.code)).toContain(code)
      await expect(
        result.session
          .operations()
          .invoke('edit-structure', { remove: ['nothing'], add: [], rename: [] }),
      ).rejects.toMatchObject({ code: 'x3.host/operation-handler-failed' })
      await expect(
        result.session.operations().invoke('edit-content', { path: 'x', bytes: '' }),
      ).rejects.toMatchObject({ code: 'x3.host/operation-handler-failed' })
      await result.session.dispose()
      expect(Buffer.compare(readFileSync(path), bytes), name).toBe(0)
    }
  }, 60_000)
})
