/**
 * A5 — metadata editing for images/audio and a PNG encoder writer, proven end to end
 * (ADR-HOST-002; the pattern is `subject-editing.test.ts`).
 *
 *  Path A  the bundled JPEG codec's `edit.field` (set/replace the COM segment) and
 *          `edit.structure` (drop one metadata segment), and the MP3 codec's `edit.field`
 *          (set/replace an ID3v2 text frame, or create the tag) each run worker-brokered,
 *          return a single byte-range plan across the boundary, are committed by the file
 *          backend and survive a reopen with every untouched byte identical;
 *  Path B  the images extension's PNG encoder writer resolves by facet `png/rgba8`, is leased
 *          across the boundary, encodes a 2×2 RGBA payload and the committed file reopens as a
 *          2×2 PNG whose decoded pixels are the payload;
 *  refusals: an unsynchronised ID3v2 tag and a structural JPEG marker are refused by the codec,
 *          and a change set the encoder cannot honour is invalid before any plan exists.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  type ChangeSet,
  type FidelityEvidence,
  type PermissionGrant,
  type RasterImageSource,
  type Writer,
  type WriterIdentity,
} from '@modkitx-x3/sdk'
import {
  createHostServiceResolver,
  createSubjectEditing,
  type ExtensionInput,
  type OpenedSubject,
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
const imagesDir = join(repoRoot, 'extensions', 'images')
const audioDir = join(repoRoot, 'extensions', 'audio')
/** The only real JPEG in the repository (a theme preview); the PNG is the app favicon. */
const jpegFixture = join(repoRoot, 'assets', 'themes', 'nexus-forge', 'preview-web.jpg')
const pngFixture = join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/a5',
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
      policy: { id: 'org.example.policy/a5', revision: '1' },
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
      policy: { id: 'org.example.policy/a5-worker', revision: '1' },
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
const WRITE: PermissionGrant = { id: 'a5-write', classes: ['read-source', 'write-source'] }

const scratch = mkdtempSync(join(tmpdir(), 'x3-media-edits-'))
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
      extensions: [await linked(imagesDir), await linked(audioDir)],
      policy,
    }))())

/** The MP3 contribution declares `inspect`, not `full`; the image codecs declare both. */
type Intent = 'full' | 'inspect'

async function openCopy(name: string, bytes: Uint8Array, intent: Intent = 'full') {
  const path = join(scratch, name)
  writeFileSync(path, bytes)
  return openPath(path, intent)
}

async function openPath(path: string, intent: Intent = 'full') {
  const result = await (
    await services()
  ).open({
    source: await openFileArtifactSource(path),
    path,
    intent,
    grant: WRITE,
    budget,
  })
  if (result.state !== 'opened') throw new Error(`open failed: ${result.reason}`)
  return { path, result }
}

async function artifactDigestOf(contributionId: string): Promise<string> {
  const digest = (await services()).inventory.extensions
    .flatMap(extension => extension.contributions)
    .find(contribution => contribution.manifest?.id === contributionId)?.record?.artifactDigest
  if (digest === undefined) throw new Error(`no artifact digest for ${contributionId}`)
  return digest
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Host evidence policy of this proof: first-party evidence, one entry per shipped operation. */
function byteIdenticalEvidence(
  evidenceId: string,
  corpus: { readonly id: string; readonly bytes: Uint8Array },
  writer: WriterIdentity,
): FidelityEvidence {
  return {
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    evidenceId,
    corpusId: corpus.id,
    corpusDigest: sha256(corpus.bytes),
    conformanceProfile: 'org.modkitx/codec-contribution-v1' as never,
    writer,
    optionsFingerprint: 'options:none',
    inputClass: writer.formatId,
    provenAt: '2026-08-19T00:00:00Z',
  }
}

async function codecWriter(
  opened: OpenedSubject,
  formatId: string,
  representationId = 'source',
): Promise<WriterIdentity> {
  return {
    providerId: opened.selected.contributionId,
    providerVersion: '1.0.0',
    artifactDigest: await artifactDigestOf(opened.selected.contributionId),
    formatId,
    representationId,
  }
}

const show = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

/** Plan → prepare → commit through the file backend, with the plan's own claim as evidence. */
async function commitPlan(
  opened: OpenedSubject,
  output: unknown,
  evidence: FidelityEvidence,
): Promise<{ readonly editBytes: number }> {
  const backend = createFileEditingBackend({ roots: [scratch] })
  try {
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence,
    })
    const plan = editing.planFromOperation(output as never)
    expect(plan.edits).toHaveLength(1)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') throw new Error('prepare failed')
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, show(committed)).toBe('committed')
    const edit = plan.edits[0]
    const payload = edit?.operation === 'replace' ? edit.payload : undefined
    return { editBytes: payload?.kind === 'inline' ? payload.bytes.byteLength : 0 }
  } finally {
    await backend.dispose()
  }
}

// ---------------------------------------------------------------------------------------------
// JPEG

interface JpegSegment {
  readonly marker: number
  readonly offset: number
  readonly end: number
}

/** An independent JPEG segment walk, so the test never trusts the codec's own offsets. */
function jpegSegments(bytes: Uint8Array): readonly JpegSegment[] {
  const out: JpegSegment[] = []
  let offset = 2
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.byteLength) break
    const marker = bytes[offset] ?? 0
    const start = offset - 1
    offset += 1
    if (marker === 0xd9) break
    if (marker === 0xda) {
      out.push({ marker, offset: start, end: bytes.byteLength })
      break
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
    out.push({ marker, offset: start, end: offset + length })
    offset += length
  }
  return out
}

const jpegComment = (bytes: Uint8Array, segment: JpegSegment): string =>
  String.fromCharCode(...bytes.subarray(segment.offset + 4, segment.end))

const summaryOf = (opened: OpenedSubject): Record<string, unknown> =>
  opened.descriptor as unknown as { readonly metadata?: readonly unknown[] } as never

describe('A5 Path A — JPEG metadata edits on the 13D seam', () => {
  it('edit.field writes the COM segment after the APP block, byte-identical elsewhere, and replaces it in place on the second call', async () => {
    const original = new Uint8Array(readFileSync(jpegFixture))
    const { path, result } = await openCopy('comment.jpg', original)
    expect(result.selected.variantId).toBe('portable')
    expect(result.descriptor.constraints.readOnly).toBe(false)
    expect(result.descriptor.operations.map(item => item.id)).toEqual(
      expect.arrayContaining(['edit.field', 'edit.structure']),
    )

    const invoked = await result.session
      .operations()
      .invoke('set-comment', { text: 'A5 metadata editing' })
    expect(invoked.state).toBe('ok')
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    expect(invoked.output.kind).toBe('edit-plan')

    // the insert lands at the first non-APPn segment, i.e. after SOI and the APP block
    const segments = jpegSegments(original)
    const anchor = segments.find(
      segment => segment.marker < 0xe0 || segment.marker > 0xef,
    ) as JpegSegment
    expect(anchor.offset).toBeGreaterThan(2)

    const evidence = byteIdenticalEvidence(
      'jpeg-set-comment-v1',
      { id: 'modkitX3/assets/themes/nexus-forge/preview-web.jpg', bytes: original },
      await codecWriter(result, 'jpeg'),
    )
    const { editBytes } = await commitPlan(result, invoked.output, evidence)
    await result.session.dispose()

    const after = new Uint8Array(readFileSync(path))
    expect(after.byteLength).toBe(original.byteLength + editBytes)
    expect(
      Buffer.compare(after.subarray(0, anchor.offset), original.subarray(0, anchor.offset)),
    ).toBe(0)
    expect(
      Buffer.compare(after.subarray(anchor.offset + editBytes), original.subarray(anchor.offset)),
    ).toBe(0)
    const comments = jpegSegments(after).filter(segment => segment.marker === 0xfe)
    expect(comments).toHaveLength(1)
    const [comment] = comments
    if (comment === undefined) throw new Error('no COM segment')
    expect(jpegComment(after, comment)).toBe('A5 metadata editing')

    // the codec parses the edited file and the image itself is untouched
    const reopened = await openPath(path)
    expect(summaryOf(reopened.result)).toBeDefined()
    const inspected = await reopened.result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('no summary')
    expect(inspected.output.value).toMatchObject({ format: 'jpeg', jfif: true })

    // second call: the same segment is replaced in place, not duplicated
    const again = await reopened.result.session
      .operations()
      .invoke('set-comment', { text: 'replaced' })
    if (again.state !== 'ok') throw new Error('second invoke rejected')
    await commitPlan(
      reopened.result,
      again.output,
      byteIdenticalEvidence(
        'jpeg-set-comment-v1',
        { id: 'modkitX3/assets/themes/nexus-forge/preview-web.jpg', bytes: original },
        await codecWriter(reopened.result, 'jpeg'),
      ),
    )
    await reopened.result.session.dispose()
    const final = new Uint8Array(readFileSync(path))
    const finalComments = jpegSegments(final).filter(segment => segment.marker === 0xfe)
    expect(finalComments).toHaveLength(1)
    const [only] = finalComments
    if (only === undefined) throw new Error('no COM segment')
    expect(jpegComment(final, only)).toBe('replaced')
    // everything before the comment and everything after it is the original file, byte for byte
    expect(Buffer.compare(final.subarray(0, only.offset), original.subarray(0, only.offset))).toBe(
      0,
    )
    expect(Buffer.compare(final.subarray(only.end), original.subarray(only.offset))).toBe(0)
  }, 90_000)

  it('edit.structure removes one metadata segment and refuses a structural marker', async () => {
    const original = new Uint8Array(readFileSync(jpegFixture))
    const { path, result } = await openCopy('structure.jpg', original)
    const app0 = jpegSegments(original).find(segment => segment.marker === 0xe0) as JpegSegment
    expect(app0).toBeDefined()

    // a marker that carries the image itself is refused before any plan exists
    await expect(
      result.session.operations().invoke('remove-segment', { marker: 'SOS' }),
    ).rejects.toThrow()
    await expect(
      result.session.operations().invoke('remove-segment', { marker: 0xdb }),
    ).rejects.toThrow()

    const invoked = await result.session.operations().invoke('remove-segment', { marker: 'APP0' })
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    await commitPlan(
      result,
      invoked.output,
      byteIdenticalEvidence(
        'jpeg-remove-segment-v1',
        { id: 'modkitX3/assets/themes/nexus-forge/preview-web.jpg', bytes: original },
        await codecWriter(result, 'jpeg'),
      ),
    )
    await result.session.dispose()

    const after = new Uint8Array(readFileSync(path))
    const removed = app0.end - app0.offset
    expect(after.byteLength).toBe(original.byteLength - removed)
    expect(Buffer.compare(after.subarray(0, app0.offset), original.subarray(0, app0.offset))).toBe(
      0,
    )
    expect(Buffer.compare(after.subarray(app0.offset), original.subarray(app0.end))).toBe(0)
    expect(jpegSegments(after).some(segment => segment.marker === 0xe0)).toBe(false)

    // the codec reopens the file and reports the JFIF marker as gone
    const reopened = await openPath(path)
    const inspected = await reopened.result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('no summary')
    expect(inspected.output.value).toMatchObject({ format: 'jpeg', jfif: false })
    await reopened.result.session.dispose()
  }, 90_000)
})

// ---------------------------------------------------------------------------------------------
// MP3 — the repository has no MP3 fixture, so the proof builds one: a real ID3v2.3 tag with two
// text frames and padding, followed by valid MPEG-1 Layer III frame headers (128 kbps, 44.1 kHz).

const latin1Bytes = (text: string): Uint8Array =>
  Uint8Array.from(text, char => char.codePointAt(0) ?? 0)

function id3v23Frame(id: string, text: string): Uint8Array {
  const content = new Uint8Array(1 + text.length)
  content.set(latin1Bytes(text), 1)
  const frame = new Uint8Array(10 + content.byteLength)
  frame.set(latin1Bytes(id), 0)
  new DataView(frame.buffer).setUint32(4, content.byteLength, false)
  frame.set(content, 10)
  return frame
}

function id3v23Tag(frames: readonly Uint8Array[], paddingBytes: number, flags = 0): Uint8Array {
  const body = frames.reduce((total, frame) => total + frame.byteLength, 0) + paddingBytes
  const tag = new Uint8Array(10 + body)
  tag.set(latin1Bytes('ID3'), 0)
  tag[3] = 3
  tag[5] = flags
  tag[6] = (body >>> 21) & 0x7f
  tag[7] = (body >>> 14) & 0x7f
  tag[8] = (body >>> 7) & 0x7f
  tag[9] = body & 0x7f
  let offset = 10
  for (const frame of frames) {
    tag.set(frame, offset)
    offset += frame.byteLength
  }
  return tag
}

/** Four MPEG-1 Layer III frames: only the headers have to be real for this codec. */
function mpegAudio(): Uint8Array {
  const frameBytes = 417
  const audio = new Uint8Array(frameBytes * 4)
  for (let index = 0; index < 4; index += 1) {
    audio.set(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), index * frameBytes)
  }
  return audio
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

const id3TagBytes = (bytes: Uint8Array): number =>
  10 +
  ((((bytes[6] ?? 0) & 0x7f) << 21) |
    (((bytes[7] ?? 0) & 0x7f) << 14) |
    (((bytes[8] ?? 0) & 0x7f) << 7) |
    ((bytes[9] ?? 0) & 0x7f))

function id3Frames(bytes: Uint8Array): readonly { id: string; bytes: Uint8Array }[] {
  const end = id3TagBytes(bytes)
  const out: { id: string; bytes: Uint8Array }[] = []
  let offset = 10
  while (offset + 10 <= end && bytes[offset] !== 0) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      offset + 4,
      false,
    )
    out.push({ id, bytes: bytes.subarray(offset, offset + 10 + size) })
    offset += 10 + size
  }
  return out
}

const frameText = (frame: Uint8Array): string =>
  String.fromCharCode(...frame.subarray(11, frame.byteLength))

describe('A5 Path A — MP3 ID3v2 text frames on the 13D seam', () => {
  it('edit.field rewrites one text frame, keeps every other frame and the padding, and never moves an audio byte', async () => {
    const audio = mpegAudio()
    const tag = id3v23Tag([id3v23Frame('TPE1', 'Original artist'), id3v23Frame('TIT2', 'Old')], 24)
    const original = concat(tag, audio)
    const { path, result } = await openCopy('tagged.mp3', original, 'inspect')
    expect(result.selected.variantId).toBe('portable')
    expect(result.descriptor.operations.map(item => item.id)).toContain('edit.field')

    const invoked = await result.session
      .operations()
      .invoke('set-text-frame', { keyword: 'TIT2', text: 'A5 title' })
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    expect(invoked.output.kind).toBe('edit-plan')
    await commitPlan(
      result,
      invoked.output,
      byteIdenticalEvidence(
        'mp3-set-text-frame-v1',
        { id: 'x3/media-edits/tagged.mp3', bytes: original },
        await codecWriter(result, 'mp3'),
      ),
    )
    await result.session.dispose()

    const after = new Uint8Array(readFileSync(path))
    // the audio is untouched, bit for bit, and still starts right after the tag
    expect(Buffer.compare(after.subarray(id3TagBytes(after)), Buffer.from(audio))).toBe(0)
    const frames = id3Frames(after)
    expect(frames.map(frame => frame.id)).toEqual(['TPE1', 'TIT2'])
    const artist = frames[0]
    const title = frames[1]
    if (artist === undefined || title === undefined) throw new Error('frames missing')
    // the frame the edit did not name is copied verbatim
    expect(Buffer.compare(artist.bytes, id3v23Frame('TPE1', 'Original artist'))).toBe(0)
    expect(frameText(title.bytes)).toBe('A5 title')
    // the padding kept its length, so the tag grew by exactly the frame's growth
    expect(after.byteLength).toBe(original.byteLength + ('A5 title'.length - 'Old'.length))

    const reopened = await openPath(path, 'inspect')
    const inspected = await reopened.result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('no summary')
    expect(inspected.output.value).toMatchObject({ format: 'mp3', id3Version: '2.3.0' })
    /*
     * The descriptor publishes the values edit.field writes, not only the tag's size: without
     * this, a host can set a frame and never show it — every form starts from a default instead
     * of from what the file says (A12's request 5).
     */
    const groups = (
      reopened.result.descriptor as unknown as {
        metadata: readonly { id: string; entries: readonly { key: string; value: unknown }[] }[]
      }
    ).metadata
    const id3Group = groups.find(group => group.id === 'id3')
    if (id3Group === undefined) throw new Error('no id3 metadata group')
    expect(id3Group.entries).toEqual(
      expect.arrayContaining([
        { key: 'TIT2', value: 'A5 title' },
        { key: 'TPE1', value: 'Original artist' },
      ]),
    )
    await reopened.result.session.dispose()
  }, 90_000)

  it('edit.field creates an ID3v2.4 tag when the file has none, and refuses an unsynchronised tag', async () => {
    const audio = mpegAudio()
    const { path, result } = await openCopy('bare.mp3', audio, 'inspect')
    const invoked = await result.session
      .operations()
      .invoke('set-text-frame', { keyword: 'TALB', text: 'A5 album' })
    if (invoked.state !== 'ok') throw new Error('invoke rejected')
    await commitPlan(
      result,
      invoked.output,
      byteIdenticalEvidence(
        'mp3-set-text-frame-v1',
        { id: 'x3/media-edits/bare.mp3', bytes: audio },
        await codecWriter(result, 'mp3'),
      ),
    )
    await result.session.dispose()

    const after = new Uint8Array(readFileSync(path))
    expect(String.fromCharCode(...after.subarray(0, 3))).toBe('ID3')
    expect(after[3]).toBe(4)
    expect(Buffer.compare(after.subarray(id3TagBytes(after)), Buffer.from(audio))).toBe(0)
    const reopened = await openPath(path, 'inspect')
    const inspected = await reopened.result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('no summary')
    expect(inspected.output.value).toMatchObject({ id3Version: '2.4.0' })
    await reopened.result.session.dispose()

    // an unsynchronised tag is refused, not guessed at
    const unsynchronised = concat(id3v23Tag([id3v23Frame('TIT2', 'Old')], 8, 0x80), audio)
    const { result: refused } = await openCopy('unsynchronised.mp3', unsynchronised, 'inspect')
    await expect(
      refused.session.operations().invoke('set-text-frame', { keyword: 'TIT2', text: 'x' }),
    ).rejects.toThrow()
    await refused.session.dispose()
  }, 90_000)
})

// ---------------------------------------------------------------------------------------------
// PNG encoder writer

describe('A5 Path B — the PNG encoder writer resolves by facet and its plan commits', () => {
  it('refuses JPEG pixel editing before save, even when the caller accepts lossy output', async () => {
    const svc = await services()
    if (svc.serviceDefinitions === undefined) throw new Error('no definitions registry')
    const resolver = createHostServiceResolver({
      inventory: svc.inventory,
      target: svc.target,
      executionBackends: svc.executionBackends,
      definitions: svc.serviceDefinitions,
      grant: WRITE,
      budgets: budget,
    })
    try {
      await expect(
        resolver.port.resolve({
          contract: 'common.edit/writer',
          major: 1,
          facet: {
            formatId: 'jpeg',
            representationId: 'rgba8',
            mutationMode: 'mutate',
            minimumRoundTrip: 'lossy',
          },
        }),
      ).rejects.toMatchObject({ code: 'x3.host/service-contract-unresolved' })
    } finally {
      await resolver.release()
    }
  })

  it('encodes a 2×2 RGBA payload; the committed file reopens as a 2×2 PNG whose decoded pixels are the payload', async () => {
    const { path, result } = await openCopy('encoded.png', new Uint8Array(readFileSync(pngFixture)))
    const svc = await services()
    if (svc.serviceDefinitions === undefined) throw new Error('no definitions registry')
    const resolver = createHostServiceResolver({
      inventory: svc.inventory,
      target: svc.target,
      executionBackends: svc.executionBackends,
      definitions: svc.serviceDefinitions,
      grant: WRITE,
      budgets: budget,
    })
    const lease = await resolver.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'png',
        representationId: 'rgba8',
        mutationMode: 'mutate',
        minimumRoundTrip: 'semantic',
      },
    })
    const writer = lease.value as Writer
    expect(writer.offer).toMatchObject({
      providerId: 'org.modkitx/png-encoder-writer',
      fidelityEvidenceId: 'png-encoder-v1',
      minimumRoundTrip: 'semantic',
    })
    expect(resolver.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')

    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened: result,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => ({
        roundTrip: 'semantic',
        preservesUnknownData: false,
        evidenceId: 'png-encoder-v1',
        corpusId: 'x3/media-edits/rgba8-2x2',
        corpusDigest: sha256(new Uint8Array(readFileSync(pngFixture))),
        conformanceProfile: 'common.edit/writer-v1' as never,
        writer: writer.identity,
        optionsFingerprint: 'options:none',
        inputClass: 'rgba8',
        provenAt: '2026-08-19T00:00:00Z',
      }),
      writer,
    })
    if (editing.session === undefined) throw new Error('no writer session')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no edit target')

    // red, green, blue, half-transparent white
    const pixels = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128,
    ])
    const change: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          payload: { kind: 'inline', bytes: pixels },
        },
      ],
      semanticIntent: { width: 2, height: 2 },
      provenance: { actor: 'automation', note: 'A5 PNG encoder proof' },
    }
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await editing.session.plan(change)
    expect(plan.fidelity.roundTrip).toBe('semantic')
    expect(plan.edits).toHaveLength(1)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state, show(prepared)).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state, show(committed)).toBe('committed')
    await result.session.dispose()

    // the bytes on disk are a PNG the bundled codec reads back as the same pixels
    const encoded = new Uint8Array(readFileSync(path))
    expect([...encoded.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const reopened = await openPath(path)
    const inspected = await reopened.result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('no summary')
    expect(inspected.output.value).toMatchObject({
      format: 'png',
      width: 2,
      height: 2,
      hasAlpha: true,
    })
    const rasterLease = await reopened.result.session.dataSource(
      'common.view/raster-image-source',
      1,
    )
    const raster = rasterLease.value as RasterImageSource
    expect(await raster.info()).toMatchObject({ width: 2, height: 2, decodedAccess: true })
    const readRegion = raster.readRegion
    if (readRegion === undefined) throw new Error('the encoded PNG must expose decoded regions')
    const region = await readRegion({
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      pixelFormat: 'rgba8',
      maxBytes: 1024,
    })
    expect(Buffer.compare(region.pixels, Buffer.from(pixels))).toBe(0)
    await rasterLease.release()
    await reopened.result.session.dispose()

    // a change set the encoder cannot honour never becomes a plan
    const mismatched: ChangeSet = { ...change, semanticIntent: { width: 3, height: 3 } }
    const validation = await editing.session.propose(mismatched)
    expect(validation.valid).toBe(false)
    expect(validation.diagnostics.map(item => item.code)).toContain(
      'x3.images/png-encoder-payload-mismatch',
    )
    await expect(editing.session.plan(mismatched)).rejects.toThrow()

    await lease.release()
    await resolver.release()
    await backend.dispose()
  }, 90_000)
})
