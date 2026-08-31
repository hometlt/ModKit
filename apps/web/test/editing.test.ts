/**
 * A8: editing in the browser, proven in Node against structural fakes.
 *
 * The subject is opened the way the page opens it — the attested catalog, the served artifacts, the
 * production worker entry in a fake module Worker — so the plan, the revision and the descriptor
 * are the real ones. What is faked is only what a browser would supply: a `FileSystemFileHandle`
 * whose `createWritable()` writes into a `Uint8Array`, and the permission surface that decides
 * whether the page may ask for it at all.
 *
 * The six claims this file makes are the six the feature stands on: a text edit lands as the right
 * bytes, a hex edit lands as the right bytes, a file that moved under the tab is refused as a
 * conflict rather than overwritten, a denied permission drops the editable stages, a file with no
 * handle never offers them, and a writer's refusal arrives with the writer's own reason attached.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetEditPlan,
  type ChangeSet,
  type AnyDescriptor,
} from '@modkit/sdk'
import type { OpenedSubject, SubjectEditorPorts } from '@modkit/host'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import { createWebSubjectServices, type WebSubjectServices } from '../src/subjects.js'
import {
  createWebEditingArm,
  describeEditability,
  mergeByteRuns,
  normalizeChangeSet,
  requestWriteAccess,
  sourceRevisionToken,
  sourceUriFor,
  webEditEvidence,
} from '../src/editing.js'
import { createSingleFileAccess, type WebFileAccess, type WebFileLike } from '../src/files.js'
import { applicableStages, createWebPreviewStages, stageIdOf } from '../src/views.js'
import {
  budget,
  diskOrigin,
  domGlobals,
  identity,
  nodeModuleMap,
  ORIGIN,
  probe,
  spawned,
} from './browser-harness.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const stages = createWebPreviewStages({ operationsFor: () => undefined })

afterEach(() => {
  spawned.splice(0)
})

// ---------------------------------------------------------------------------------------------
// the fakes a browser would supply

/** A file behind a handle that behaves like the File System Access one, in memory. */
function memoryFile(name: string, text: string) {
  let content = encoder.encode(text)
  let modified = 1_000
  const snapshot = (): WebFileLike => {
    const held = content
    return {
      name,
      size: held.byteLength,
      lastModified: modified,
      slice: (start: number, end: number) => ({
        async arrayBuffer() {
          const part = held.slice(start, end)
          const copy = new ArrayBuffer(part.byteLength)
          new Uint8Array(copy).set(part)
          return copy
        },
      }),
    }
  }
  let permission: 'granted' | 'denied' | 'prompt' = 'granted'
  let writes = 0
  const handle = {
    kind: 'file' as const,
    name,
    async getFile() {
      return snapshot()
    },
    async createWritable() {
      const chunks: Uint8Array[] = []
      return {
        async write(data: Uint8Array) {
          chunks.push(data.slice())
        },
        async close() {
          const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
          const next = new Uint8Array(total)
          let at = 0
          for (const chunk of chunks) {
            next.set(chunk, at)
            at += chunk.byteLength
          }
          content = next
          // a real write moves the mtime, which is exactly what the revision guard watches
          modified += 1
          writes += 1
        },
      }
    },
    async queryPermission() {
      return permission
    },
    async requestPermission() {
      return permission
    },
  }
  return {
    handle,
    name,
    bytes: () => content,
    text: () => decoder.decode(content),
    writes: () => writes,
    /** Something else on the machine touched the file while the tab held it. */
    touch(next: string) {
      content = encoder.encode(next)
      modified += 1
    },
    deny() {
      permission = 'denied'
    },
    snapshot: () => ({ size: content.byteLength, lastModified: modified }),
  }
}

type MemoryFile = ReturnType<typeof memoryFile>

/** A one-file `WebFileAccess` over a memory file, the shape the shell hands the editing arm. */
function memoryAccess(file: MemoryFile): WebFileAccess {
  return {
    label: file.name,
    writeGrant: file.handle,
    async list(entryId) {
      return entryId === undefined
        ? [{ id: file.name, name: file.name, directory: false, size: file.bytes().byteLength }]
        : []
    },
    sizeOf: entryId => (entryId === file.name ? file.bytes().byteLength : undefined),
    handleOf: entryId => (entryId === file.name ? file.handle : undefined),
    async snapshotOf(entryId) {
      return entryId === file.name ? file.snapshot() : undefined
    },
    async read(entryId) {
      if (entryId !== file.name) throw new TypeError(`${entryId} is not the opened file`)
      return file.bytes().slice()
    },
  }
}

/** A plain `File` with no handle at all: a drop, an `<input type="file">`, or a fetch. */
function handlelessFile(name: string, text: string): WebFileLike {
  const bytes = encoder.encode(text)
  return {
    name,
    size: bytes.byteLength,
    lastModified: 7,
    slice: (start: number, end: number) => ({
      async arrayBuffer() {
        const part = bytes.slice(start, end)
        const copy = new ArrayBuffer(part.byteLength)
        new Uint8Array(copy).set(part)
        return copy
      },
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// the real open path

async function services(): Promise<WebSubjectServices> {
  const site = diskOrigin()
  return createWebSubjectServices({
    baseUrl: ORIGIN,
    catalog: WEB_EXTENSION_CATALOG,
    identity,
    probe,
    dom: domGlobals(site.fetch),
    moduleMap: nodeModuleMap,
  })
}

/** The source the shell mints for a picked file: entry-id URI, `size`/`lastModified` revision. */
function pickedSource(file: MemoryFile): ArtifactByteSource {
  const bytes = file.bytes()
  const uri = sourceUriFor(file.name)
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(sourceRevisionToken(file.snapshot())),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

const WRITE_GRANT = { id: 'pwa-edit', classes: ['read-source', 'write-source'] } as const

interface Session {
  readonly opened: OpenedSubject
  readonly ports: SubjectEditorPorts
  readonly notices: string[]
  readonly dirty: (readonly [string, boolean])[]
  dispose(): Promise<void>
}

/** Open a memory file for real and compose the editing arm over it, exactly as the shell does. */
async function editable(
  file: MemoryFile,
  options: { readonly permission?: 'granted' | 'denied' | 'prompt' } = {},
): Promise<Session> {
  const host = await services()
  const bytes = file.bytes().slice()
  const opened = await host.open({
    source: pickedSource(file),
    path: file.name,
    intent: 'full',
    grant: WRITE_GRANT,
    budget,
  })
  if (opened.state !== 'opened') throw new Error(`${file.name} did not open: ${opened.reason}`)
  const notices: string[] = []
  const dirty: (readonly [string, boolean])[] = []
  const arm = createWebEditingArm({
    inventory: host.main.inventory,
    handleFor: sourceId => (sourceId === sourceUriFor(file.name) ? file.handle : undefined),
    onNotice: message => void notices.push(message),
    onDirty: (entryId, value) => void dirty.push([entryId, value]),
    async ensureWriteAccess() {
      return options.permission ?? 'granted'
    },
  })
  const ports = arm.portsFor({
    entryId: file.name,
    name: file.name,
    opened,
    grant: WRITE_GRANT,
    bytes,
  })
  if (ports === undefined) throw new Error('the arm produced no editor ports')
  return {
    opened,
    ports,
    notices,
    dirty,
    async dispose() {
      await arm.dispose()
      await opened.session.dispose()
    },
  }
}

/** The change set the shipped text editor builds: whole-source replacement, one text payload. */
const textChange = (ports: SubjectEditorPorts, text: string): ChangeSet => ({
  targets: ports.edit.targets,
  edits: ports.edit.targets.map(target => ({
    operation: 'replace' as const,
    targetId: target.targetId,
    source: target.ownerSource,
    payload: { kind: 'text' as const, text },
    label: 'Edit text',
  })),
  provenance: { actor: 'user' },
})

/** The change set the shipped hex editor builds: binding-keyed byte runs, not `SourceEdit`s. */
const hexChange = (
  revision: string,
  runs: readonly (readonly [number, readonly number[]])[],
): unknown => ({
  baseRevisions: { content: revision },
  edits: runs.map(([offset, values]) => ({
    kind: 'bytes',
    bindingId: 'content',
    range: { kind: 'bytes', offset: BigInt(offset), length: BigInt(values.length) },
    payload: { kind: 'inline', bytes: new Uint8Array(values) },
  })),
  provenance: { origin: 'hex-editor' },
})

/** propose → plan → authorize → prepare → commit, the chain every shipped editor walks. */
async function save(
  ports: SubjectEditorPorts,
  change: unknown,
): Promise<{ readonly stage: string; readonly reason?: string }> {
  const validation = await ports.edit.propose(change as ChangeSet)
  if (!validation.valid) {
    return {
      stage: 'propose',
      ...(validation.diagnostics[0] === undefined
        ? {}
        : { reason: validation.diagnostics[0].message }),
    }
  }
  const plan = await ports.edit.plan(change as ChangeSet)
  const authorization = await ports.authorization.request(plan)
  if (authorization === undefined) return { stage: 'authorize' }
  const prepared = await ports.commit.prepare(plan, { grant: authorization.grant })
  if (prepared.state !== 'ready') {
    return {
      stage: prepared.state,
      ...(prepared.state === 'rejected' ? { reason: prepared.reason } : {}),
    }
  }
  const result = await ports.commit.commit(prepared.prepared, { grant: authorization.grant })
  return {
    stage: result.state,
    ...(result.state === 'not-applied' ? { reason: result.reason } : {}),
  }
}

// ---------------------------------------------------------------------------------------------

describe('browser editing — the write path', () => {
  it('a text edit becomes the bytes the user typed, written through the handle', async () => {
    const file = memoryFile('sample.csv', 'name,value\nalpha,1\n')
    const session = await editable(file)
    expect(await save(session.ports, textChange(session.ports, 'name,value\nomega,9\n'))).toEqual({
      stage: 'committed',
    })
    expect(file.text()).toBe('name,value\nomega,9\n')
    // one write, through `createWritable()` — not a rewrite per edit
    expect(file.writes()).toBe(1)
    // the tab was marked dirty when the change was proposed and clean again when it landed
    expect(session.dirty).toEqual([
      ['sample.csv', true],
      ['sample.csv', false],
    ])
    expect(session.notices.join('\n')).toMatch(/Saved/u)
    await session.dispose()
  }, 30_000)

  it('a hex edit becomes the bytes the user typed, with the gap between two runs left alone', async () => {
    const file = memoryFile('sample.csv', 'name,value\nalpha,1\n')
    const session = await editable(file)
    const revision = session.opened.descriptor.revision
    // 'n' -> 'N' at 0 and 'm' -> 'M' at 2: two runs, one contiguous write, byte 1 untouched
    const result = await save(
      session.ports,
      hexChange(revision, [
        [0, [0x4e]],
        [2, [0x4d]],
      ]),
    )
    expect(result).toEqual({ stage: 'committed' })
    expect(file.text()).toBe('NaMe,value\nalpha,1\n')
    expect(file.writes()).toBe(1)
    await session.dispose()
  }, 30_000)

  it('a file that changed under the tab is refused at prepare as a conflict, not overwritten', async () => {
    const file = memoryFile('sample.csv', 'name,value\nalpha,1\n')
    const session = await editable(file)
    // something else on the machine wrote the file after this tab read it
    file.touch('name,value\nsomebody,else\n')
    const result = await save(session.ports, textChange(session.ports, 'name,value\nomega,9\n'))
    expect(result).toEqual({ stage: 'conflict' })
    expect(file.text()).toBe('name,value\nsomebody,else\n')
    expect(file.writes()).toBe(0)
    expect(session.notices.join('\n')).toMatch(/changed on disk after this tab read it/u)
    await session.dispose()
  }, 30_000)

  it('a writer refusal reaches the UI with the writer own reason, not a generic failure', async () => {
    const file = memoryFile('sample.csv', 'name,value\nalpha,1\n')
    const session = await editable(file)
    const target = session.ports.edit.targets[0]
    if (target === undefined) throw new Error('the subject has no edit target')
    // The raw writer plans literal replacements only; `create` needs a format writer and a
    // directory handle, and this is exactly the refusal a user must be able to read.
    const refused = await save(session.ports, {
      targets: session.ports.edit.targets,
      edits: [
        {
          operation: 'create',
          targetId: target.targetId,
          source: target.ownerSource,
          newPath: 'copy.csv',
          payload: { kind: 'text', text: 'x' },
        },
      ],
      provenance: { actor: 'user' },
    })
    expect(refused.stage).toBe('propose')
    expect(refused.reason).toMatch(/plans replacements only/u)
    expect(session.notices.join('\n')).toMatch(/plans replacements only/u)
    expect(file.writes()).toBe(0)
    await session.dispose()
  }, 30_000)

  it('a denied write permission stops the save at authorization and says so', async () => {
    const file = memoryFile('sample.csv', 'name,value\nalpha,1\n')
    const session = await editable(file, { permission: 'denied' })
    expect(await save(session.ports, textChange(session.ports, 'x,y\n'))).toEqual({
      stage: 'authorize',
    })
    expect(file.writes()).toBe(0)
    expect(session.notices.join('\n')).toMatch(/denied write access/u)
    await session.dispose()
  }, 30_000)
})

describe('browser editing — who gets an editor at all', () => {
  it('a denied permission drops both editable stages, and only those', async () => {
    const file = memoryFile('sample.csv', 'name,value\nalpha,1\n')
    const access = memoryAccess(file)
    const allowed = await describeEditability(access, file.name)
    expect(allowed).toMatchObject({ state: 'granted', editable: true })

    file.deny()
    const denied = await describeEditability(access, file.name)
    expect(denied.state).toBe('denied')
    expect(denied.editable).toBe(false)
    expect(denied.sentence).toMatch(/Write access was denied/u)

    const host = await services()
    const opened = await host.open({
      source: pickedSource(file),
      path: file.name,
      intent: 'full',
      grant: WRITE_GRANT,
      budget,
    })
    if (opened.state !== 'opened') throw new Error(`did not open: ${opened.reason}`)
    const descriptor = await opened.session.descriptor()
    const withEditors = applicableStages(stages, descriptor, { editorPorts: true }).map(stageIdOf)
    const withoutEditors = applicableStages(stages, descriptor, {
      editorPorts: denied.editable,
    }).map(stageIdOf)
    expect(withEditors).toContain('text-editor')
    expect(withEditors).toContain('hex-editor')
    expect(withoutEditors).not.toContain('text-editor')
    expect(withoutEditors).not.toContain('hex-editor')
    // nothing else moved: dropping the editors is not dropping the viewers
    expect(withEditors.filter(id => !id.endsWith('-editor'))).toEqual(withoutEditors)
    await opened.session.dispose()
  }, 30_000)

  it('a file with no handle never offers an editor, and the sentence says why', async () => {
    const picked = createSingleFileAccess(handlelessFile('dropped.csv', 'a,b\n1,2\n'))
    const decision = await describeEditability(picked.access, 'dropped.csv')
    expect(decision.state).toBe('no-handle')
    expect(decision.editable).toBe(false)
    expect(decision.sentence).toMatch(/arrived through a file input, a drop or a fetch/u)
    expect(picked.access.handleOf('dropped.csv')).toBeUndefined()
    expect(picked.access.writeGrant).toBeUndefined()
    // and asking for permission is refused with the same reason rather than throwing
    expect((await requestWriteAccess(picked.access)).state).toBe('no-handle')
  })

  it('the same file picked through a handle is editable, and pending permission still counts', async () => {
    const file = memoryFile('picked.csv', 'a,b\n1,2\n')
    const picked = createSingleFileAccess(await file.handle.getFile(), file.handle)
    expect(picked.access.handleOf('picked.csv')).toBe(file.handle)
    expect((await describeEditability(picked.access, 'picked.csv')).editable).toBe(true)
    expect((await requestWriteAccess(picked.access)).state).toBe('granted')

    // a browser with no permission surface at all: unknown is not "no", and the first save decides
    const bare = createSingleFileAccess(await file.handle.getFile(), {
      kind: 'file',
      name: 'picked.csv',
      getFile: () => file.handle.getFile(),
      createWritable: () => file.handle.createWritable(),
    })
    const unknown = await describeEditability(bare.access, 'picked.csv')
    expect(unknown.state).toBe('no-permission-surface')
    expect(unknown.editable).toBe(true)
    expect(unknown.sentence).toMatch(/decided by the first save/u)
  })
})

describe('browser editing — change-set translation', () => {
  it('merges byte runs into one replacement and keeps the untouched bytes in between', () => {
    const original = encoder.encode('abcdef')
    const merged = mergeByteRuns(
      [
        { offset: 1, bytes: new Uint8Array([0x42]) },
        { offset: 4, bytes: new Uint8Array([0x45]) },
      ],
      original,
    )
    if (merged === undefined) throw new Error('two runs inside the source must merge')
    expect(merged.offset).toBe(1)
    // 'bcde' with 'b' -> 'B' and 'e' -> 'E'; 'c' and 'd' are the source's own bytes, written back
    expect(decoder.decode(merged.bytes)).toBe('BcdE')
    // and a run past the bytes this tab loaded is refused rather than padded
    expect(
      mergeByteRuns([{ offset: 5, bytes: new Uint8Array([1, 2, 3]) }], original),
    ).toBeUndefined()
  })

  it('passes a real change set through untouched and translates the hex editor shape', () => {
    const targets = [
      {
        targetId: 'content',
        subjectUri: 'file-picker://x',
        ownerSource: { id: 'file-picker://x', uri: 'file-picker://x' },
        semanticPath: [],
        expectedRevision: {
          bindings: { content: revisionId('provider-token:6-1') },
          compositionFingerprint: 'fingerprint',
        },
      },
    ] as const
    const authored: ChangeSet = {
      targets,
      edits: [
        {
          operation: 'replace',
          targetId: 'content',
          source: targets[0].ownerSource,
          payload: { kind: 'text', text: 'hello' },
        },
      ],
      provenance: { actor: 'user' },
    }
    expect(normalizeChangeSet(authored, targets, encoder.encode('abcdef'))).toBe(authored)

    const translated = normalizeChangeSet(
      hexChange('provider-token:6-1', [[2, [0x5a]]]),
      targets,
      encoder.encode('abcdef'),
    )
    expect(translated?.edits).toHaveLength(1)
    const edit = translated?.edits[0]
    if (edit === undefined || edit.operation !== 'replace') throw new Error('not a replacement')
    expect(edit.targetId).toBe('content')
    expect(edit.range).toEqual({ kind: 'bytes', offset: 2n, length: 1n })
    expect(edit.payload).toEqual({ kind: 'inline', bytes: new Uint8Array([0x5a]) })

    // a change that is neither shape is refused rather than guessed at
    expect(normalizeChangeSet({ edits: [] }, targets, encoder.encode('abcdef'))).toBeUndefined()
    expect(normalizeChangeSet('nonsense', targets, encoder.encode('abcdef'))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// the fidelity evidence policy

/**
 * What this application accepts as proof of a fidelity claim (ADR-HOST-002 §6).
 *
 * The list is the whole point: a claim with no record is `fidelity-unproven` and nothing is
 * written. Path A made it load-bearing — a codec's plan claims what the codec did, and the ZIP
 * codec's archive re-assembly is `semantic`, which the raw writer's by-construction record does
 * not and must not cover.
 */
describe('what this app accepts as proof of a fidelity claim', () => {
  /** A plan is only ever matched on its claim; the rest is what the coordinator checks. */
  const claiming = (
    roundTrip: AssetEditPlan['fidelity']['roundTrip'],
    preservesUnknownData: boolean,
  ): AssetEditPlan =>
    ({ fidelity: { roundTrip, preservesUnknownData } }) as unknown as AssetEditPlan

  const zipEvidence = async () => {
    const host = await services()
    return webEditEvidence(host.main.inventory, {
      interpretation: 'codec',
      identity: { codecId: 'modkit/archive-zip', formatId: 'zip' },
    } as unknown as AnyDescriptor)
  }

  it('proves the raw writer byte-identical claim by construction', async () => {
    const evidence = (await zipEvidence()).evidenceFor(claiming('byte-identical', true))
    expect(evidence?.writer.providerId).toBe('modkit.host/raw-writer')
    expect(evidence?.corpusDigest).toBe('none:by-construction')
  })

  it('proves the ZIP codec semantic re-assembly from inventory, both ways', async () => {
    const registry = await zipEvidence()
    const canonical = registry.evidenceFor(claiming('semantic', true))
    const other = registry.evidenceFor(claiming('semantic', false))
    expect(canonical?.writer.providerId).toBe('modkit/archive-zip')
    expect(canonical?.evidenceId).toBe('zip-verbatim-reassembly-v1')
    expect(canonical?.writer.artifactDigest).not.toBe('none:extension-artifact-not-pinned')
    expect(other?.evidenceId).toBe('zip-verbatim-reassembly-non-canonical-v1')
    /*
     * The two claims are different claims and get different records; neither stands in for the
     * other, and neither names a corpus this app pretends to have run itself.
     */
    expect(canonical?.corpusId).toMatch(/archive-edits\.test\.ts/u)
    expect(canonical?.preservesUnknownData).toBe(true)
    expect(other?.preservesUnknownData).toBe(false)
  })

  it('refuses a claim no record covers, which is what makes the list mean anything', async () => {
    const registry = await zipEvidence()
    expect(registry.evidenceFor(claiming('byte-identical', false))).toBeUndefined()
    expect(registry.evidenceFor(claiming('lossy', true))).toBeUndefined()
    expect(registry.evidenceFor(claiming('none', false))).toBeUndefined()
  })
})
