/**
 * The Electron composition, opened headlessly: does the product thread actually carry a subject
 * from a path (or from inside an archive) all the way to a working session, and does it let go?
 *
 * Block 9 changed the answer to the first half. Once VXL, W3D, W3X and M3 began declaring
 * companions, their `planInput` started returning a *composite* plan — and a composite plan handed
 * to a host with no companion resolver fails closed on `x3.host/input-resolver-required`. The Node
 * path opener composes that resolver for itself; `electron/main.cjs` opens the byte source by hand
 * (it decides writability, it has its own diagnostics to merge) and so did not. Every voxel and
 * every model would have refused to open in the desktop app while every unit test stayed green,
 * because no test ran the composition Electron actually uses.
 *
 * So this suite runs it. Not the window — the window is not where the bug was — but the same
 * `createElectronSubjectServices` main boots, the same `services.open` call it makes, the same
 * resolver factory, against real fixtures. Four claims:
 *
 *  1. **The composition stands up.** Extensions load, the worker realm is Electron's.
 *  2. **The open carries a resolver, and it matters.** A VXL finds its `.hva` sidecar through it;
 *     the identical open without one is refused by name. The negative is the point — a resolver
 *     that changed nothing would prove nothing about the wiring.
 *  3. **`main.cjs` is the one wired.** The product file is CommonJS behind an Electron `require`,
 *     so it cannot be imported here; its call is asserted on the source instead. A weaker check
 *     than running it, and named as such, but it is what stands between this fix and a silent
 *     revert.
 *  4. **An archive entry opens as a subject.** The first product-reachable `openNestedSubject`:
 *     a W3D inside a BIG, opened with its texture bound from the same archive.
 *
 * And disposal is counted, not assumed: worker threads before and after, via `process.report`.
 */

import { readFile, mkdtemp, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkitx-x3/core'
import { isModkitError } from '@modkitx-x3/core'
import {
  revisionId,
  type ArtifactByteSource,
  type ModelSceneSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  createElectronSubjectServices,
  createFilesystemInputResolver,
  ELECTRON_WORKER_REALM,
  openFileArtifactSource,
  openNestedSubject,
  type ElectronSubjectServices,
} from '../src/index.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const extensionsRoot = join(repositoryRoot, 'extensions')
const syntheticDir = join(
  repositoryRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'mk2-synthetic',
)
/** The section the synthetic VXL declares; the sidecar below is written against this name. */
const FIXTURE_SECTION = 'FixtureBody'

const budget: ResourceBudget = {
  maxInputBytes: 16_000_000n,
  maxDepth: 64,
  maxNodes: 200_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 200,
}
const grant = { id: 'electron-smoke', classes: ['read-source'] } as const

// ---------------------------------------------------------------------------------------------
// counters

/**
 * Live worker threads in this process.
 *
 * `process.report.getReport().workers` is one report per live worker thread, so its length is a
 * count nobody has to be trusted about — not a diagnostic the backend chose to emit, and not the
 * absence of one. A clean shutdown emits no `x3.host/worker-terminated` at all (the worker exits on
 * its own after the terminate frame), which is exactly why "no crash diagnostic" is not evidence
 * that anything was closed.
 */
function liveWorkers(): number {
  return (process.report.getReport() as { readonly workers: readonly unknown[] }).workers.length
}

/** Workers are torn down asynchronously; a count taken the instant `dispose` resolves races it. */
async function settledWorkers(expected: number): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (liveWorkers() === expected) return expected
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return liveWorkers()
}

interface CountedSource {
  readonly source: ArtifactByteSource
  /** Byte-range reads the host asked the file for. */
  readonly reads: () => number
}

/** The subject's own bytes, counted, so "nothing touched it after dispose" is measured. */
function counted(inner: ArtifactByteSource): CountedSource {
  let reads = 0
  const source: ArtifactByteSource = Object.freeze({
    ...inner,
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      reads += 1
      return inner.read(offset, length, signal)
    },
    async *stream(request?: unknown, signal?: AbortSignal) {
      reads += 1
      yield* inner.stream(request as never, signal)
    },
  }) as ArtifactByteSource
  return { source, reads: () => reads }
}

// ---------------------------------------------------------------------------------------------
// fixtures

const temporaries: string[] = []
const services: ElectronSubjectServices[] = []

afterAll(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

async function electron(...parts: readonly (readonly string[])[]): Promise<{
  readonly subjects: ElectronSubjectServices
  readonly diagnostics: readonly Diagnostic[]
}> {
  const diagnostics: Diagnostic[] = []
  const subjects = await createElectronSubjectServices(
    parts.map(part => join(extensionsRoot, ...part)),
    { onDiagnostic: item => void diagnostics.push(item) },
  )
  services.push(subjects)
  return { subjects, diagnostics }
}

/** The HVA sidecar, written from the format (see `ea-vxl-hva-companion` for the full matrix). */
function buildHva(sectionNames: readonly string[], frames: number): Uint8Array {
  const bytes = new Uint8Array(24 + sectionNames.length * 16 + frames * sectionNames.length * 48)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, frames, true)
  view.setUint32(20, sectionNames.length, true)
  sectionNames.forEach((name, index) => {
    bytes.set(new TextEncoder().encode(name).slice(0, 15), 24 + index * 16)
  })
  const matricesAt = 24 + sectionNames.length * 16
  for (let frame = 0; frame < frames; frame += 1) {
    for (let section = 0; section < sectionNames.length; section += 1) {
      const cell = frame * sectionNames.length + section
      const values = [1, 0, 0, frame + 1, 0, 1, 0, section + 1, 0, 0, 1, (frame + 1) * 10]
      values.forEach((value, component) => {
        view.setFloat32(matricesAt + cell * 48 + component * 4, value, true)
      })
    }
  }
  return bytes
}

/** A throwaway folder holding the synthetic VXL and, optionally, its sidecar beside it. */
async function voxelFolder(withSidecar: boolean): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-electron-smoke-'))
  temporaries.push(directory)
  await cp(join(syntheticDir, 'minimal.ra2.vxl'), join(directory, 'minimal.ra2.vxl'))
  if (withSidecar) {
    await writeFile(join(directory, 'minimal.ra2.hva'), buildHva([FIXTURE_SECTION], 3))
  }
  return directory
}

interface BigEntryInput {
  readonly path: string
  readonly bytes: Uint8Array
}

/** A BIG4 archive, stored entries only — the compressed path is covered in the host suite. */
function buildBig(entries: readonly BigEntryInput[]): Uint8Array {
  const encoder = new TextEncoder()
  const stored = entries.map(entry => ({ name: encoder.encode(entry.path), payload: entry.bytes }))
  const indexBytes = stored.reduce((total, entry) => total + 8 + entry.name.byteLength + 1, 0)
  const dataOffset = 16 + indexBytes
  const total = stored.reduce((size, entry) => size + entry.payload.byteLength, dataOffset)
  const archive = new Uint8Array(total)
  const view = new DataView(archive.buffer)
  archive.set(encoder.encode('BIG4'), 0)
  view.setUint32(4, total, true)
  view.setUint32(8, stored.length, false)
  view.setUint32(12, dataOffset, false)
  let index = 16
  let payload = dataOffset
  for (const entry of stored) {
    view.setUint32(index, payload, false)
    view.setUint32(index + 4, entry.payload.byteLength, false)
    index += 8
    archive.set(entry.name, index)
    index += entry.name.byteLength
    archive[index] = 0
    index += 1
    archive.set(entry.payload, payload)
    payload += entry.payload.byteLength
  }
  return archive
}

function memorySource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://electron-smoke/${name}`
  return Object.freeze({
    kind: 'bytes' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}-${bytes.byteLength}`),
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  })
}

async function codeOf(action: () => unknown): Promise<string> {
  try {
    await action()
  } catch (error) {
    return isModkitError(error) ? error.code : `not-a-modkit-error:${String(error)}`
  }
  return 'no-error'
}

// ---------------------------------------------------------------------------------------------

describe('the Electron composition opens a subject headlessly', () => {
  it('loads its extensions into the Electron worker realm', async () => {
    const { subjects } = await electron(['ea', 'tiberian-sun'], ['ea', 'big'], ['ea', 'models'])

    expect(subjects.application.main.inventory.extensions).toHaveLength(3)
    expect(subjects.extensions.failures).toEqual([])
    expect(subjects.supportedExtensions).toEqual(expect.arrayContaining(['vxl', 'big', 'w3d']))
    expect(subjects.application.workers.profile.realmId).toBe(ELECTRON_WORKER_REALM)
    expect(subjects.executionProfiles).toContain('worker-brokered')
  }, 60_000)

  it('binds a VXL sidecar through the resolver main composes, and refuses the same open without it', async () => {
    const { subjects } = await electron(['ea', 'tiberian-sun'])
    const directory = await voxelFolder(true)
    const file = join(directory, 'minimal.ra2.vxl')

    /*
     * Exactly the shape `electron/main.cjs` now builds: the byte source opened by the caller, the
     * resolver confined to the roots the user granted, companion notices collected for the
     * snapshot rather than thrown away.
     */
    const companionDiagnostics: Diagnostic[] = []
    const opened = await subjects.open({
      source: await openFileArtifactSource(file),
      path: file,
      intent: 'full',
      grant,
      budget,
      resolveInput: createFilesystemInputResolver({
        primaryPath: file,
        roots: [directory],
        inventory: subjects.application.main.inventory,
        deadlineMs: budget.deadlineMs ?? 30_000,
        onDiagnostic: item => void companionDiagnostics.push(item),
      }),
    })

    if (opened.state !== 'opened') {
      throw new Error(`the VXL did not open: ${JSON.stringify(opened.diagnostics)}`)
    }
    expect(opened.selected.contributionId).toBe('org.modkitx/red-alert2-vxl')
    // worker-brokered: the codec really ran across the Electron realm boundary, not in-process
    expect(opened.selected.variantId).toBe('portable')

    const inspected = await opened.session.operations().invoke('inspect', null)
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
      throw new Error('the VXL did not inspect')
    }
    const summary = inspected.output.value as unknown as {
      readonly hva: Record<string, unknown>
      readonly sections: readonly { readonly hva: Record<string, unknown> }[]
    }
    // the sidecar was found, read and bound by name — the whole point of the wiring
    expect(summary.hva).toMatchObject({ state: 'resolved', frames: 3, boundSections: 1 })
    expect(summary.sections[0]?.hva).toMatchObject({ provenance: 'companion' })
    const lease = await opened.session.dataSource('common.view/model-scene-source', 1)
    await expect((lease.value as ModelSceneSource).info()).resolves.toMatchObject({ animations: 1 })
    await lease.release()
    await opened.session.dispose()

    /*
     * The same file, the same services, no resolver — the regression this step exists to prevent.
     * Before the wiring, this was what the desktop app did to every voxel and every model.
     */
    const bare = await openFileArtifactSource(file)
    const refused = await subjects.open({ source: bare, path: file, intent: 'full', grant, budget })
    // not a crash — a refusal. The codec is rejected as a candidate and the subject stays closed,
    // which in the desktop app read as "modkit cannot open this voxel at all"
    expect(refused.state).toBe('unresolved')
    expect(refused.diagnostics.map(item => item.code)).toContain('x3.host/input-resolver-required')
  }, 120_000)

  it('is the call the main process makes', async () => {
    /*
     * `electron/main.cjs` is CommonJS loaded by Electron's own `require`, with `electron` itself as
     * an import — importing it here would need a running Electron, which is precisely the
     * interactive path this suite is meant to avoid. So the wiring is asserted on the source: the
     * factory is imported from the host surface, and `resolveInput` reaches `subjectServices.open`.
     * This is a weaker claim than executing it, and it is the honest one: what the tests above
     * prove is that the composition works, and what this proves is that main uses it.
     */
    const main = await readFile(join(import.meta.dirname, '..', 'electron', 'main.cjs'), 'utf8')
    expect(main).toMatch(/createFilesystemInputResolver,/u)
    expect(main).toMatch(/const resolveInput = createFilesystemInputResolver\(\{/u)
    const call = /await subjectServices\.open\(\{[\s\S]*?\n {4}\}\)/u.exec(main)?.[0] ?? ''
    expect(call, 'main.cjs opens subjects without a companion resolver').toContain('resolveInput,')
  })
})

describe('an archive entry opens as a subject of its own', () => {
  it('opens a W3D inside a BIG, with its texture bound from the same archive', async () => {
    const { subjects } = await electron(['ea', 'big'], ['ea', 'models'])
    const model = new Uint8Array(await readFile(join(syntheticDir, 'minimal.westwood.w3d')))
    const skin = new Uint8Array(await readFile(join(syntheticDir, 'minimal.tga')))
    const archiveBytes = buildBig([
      { path: 'art/w3d/minimal.w3d', bytes: model },
      { path: 'art/textures/minimal.tga', bytes: skin },
    ])

    const archive = await subjects.open({
      source: memorySource(archiveBytes, 'fixture.big'),
      path: 'fixture.big',
      intent: 'full',
      grant,
      budget,
    })
    if (archive.state !== 'opened') {
      throw new Error(`the BIG did not open: ${JSON.stringify(archive.diagnostics)}`)
    }
    expect(archive.selected.contributionId).toBe('org.modkitx/big')

    // the entry id is the container's own; the caller never names a path inside the archive
    const listing = await archive.session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (listing.value as NamespaceEntrySource).list('', { limit: 64 })
    const entry = page.items.find(item => item.path === 'art/w3d/minimal.w3d')
    await listing.release()
    if (entry === undefined) throw new Error('the fixture archive lost its model entry')

    const companionDiagnostics: Diagnostic[] = []
    const { result, entry: described } = await openNestedSubject({
      parent: archive.session,
      entryId: entry.id,
      inventory: subjects.application.main.inventory,
      executionBackends: subjects.application.executionBackends,
      target: subjects.application.workers.target,
      grant,
      budget,
      onDiagnostic: item => void companionDiagnostics.push(item),
    })

    expect(described.path).toBe('art/w3d/minimal.w3d')
    if (result.state !== 'opened') {
      throw new Error(`the nested W3D did not open: ${JSON.stringify(result.diagnostics)}`)
    }
    expect(result.selected.contributionId).toBe('org.modkitx/westwood-w3d')

    const scene = await result.session.dataSource('common.view/model-scene-source', 1)
    await expect((scene.value as ModelSceneSource).info()).resolves.toMatchObject({
      nodes: expect.any(Number),
    })
    await scene.release()

    // the child goes first and the parent survives it: still listable, still the same archive
    await result.session.dispose()
    const again = await archive.session.dataSource('common.view/namespace-entry-source', 1)
    await expect((again.value as NamespaceEntrySource).list('', { limit: 4 })).resolves.toBeTruthy()
    await again.release()
    await archive.session.dispose()
  }, 120_000)
})

describe('disposal closes what the open took', () => {
  it('leaves no worker thread and no reader behind', async () => {
    const { subjects } = await electron(['ea', 'tiberian-sun'])
    const directory = await voxelFolder(true)
    const file = join(directory, 'minimal.ra2.vxl')
    const idle = await settledWorkers(liveWorkers())
    const source = counted(await openFileArtifactSource(file))

    const opened = await subjects.open({
      source: source.source,
      path: file,
      intent: 'full',
      grant,
      budget,
      resolveInput: createFilesystemInputResolver({
        primaryPath: file,
        roots: [directory],
        inventory: subjects.application.main.inventory,
      }),
    })
    if (opened.state !== 'opened') throw new Error(JSON.stringify(opened.diagnostics))

    // the codec is out of process, so the session is holding a worker while it is open
    expect(liveWorkers()).toBeGreaterThan(idle)
    const lease = await opened.session.dataSource('common.view/model-scene-source', 1)
    await (lease.value as ModelSceneSource).info()
    await lease.release()
    const readsWhileOpen = source.reads()
    expect(readsWhileOpen).toBeGreaterThan(0)

    await opened.session.dispose()

    // the counter, not a diagnostic: every worker the open spawned is gone
    expect(await settledWorkers(idle)).toBe(idle)
    // and nothing kept reading the file behind the disposed session's back
    expect(source.reads()).toBe(readsWhileOpen)
    // the session itself fails closed rather than reopening anything
    expect(
      await codeOf(() => opened.session.dataSource('common.view/model-scene-source', 1)),
    ).not.toBe('no-error')
  }, 120_000)
})
