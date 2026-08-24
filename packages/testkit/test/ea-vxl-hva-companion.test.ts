/**
 * VXL + HVA: the animation family block 8 recorded as `Условно — требует companion`, now resolved
 * through the host's real companion facility rather than by the codec looking for a file.
 *
 * The tests that matter most here are the refusals. A `.hva` names its sections, and so does a
 * `.vxl`; the reference implementation binds by name and silently falls back to *positional order*
 * when the names disagree, which produces a confident, plausible, wrong answer whenever two files
 * belong to different models. This codec binds by name and reports a mismatch instead — and a
 * single-frame `.hva` is published as a rest pose, never as "an animation was read".
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  openSubject,
  type Inventory,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetSession,
  type ModelSceneSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const vxlFixture = join(syntheticDir, 'minimal.ra2.vxl')
/** The section the synthetic VXL declares; every HVA below is written against this name. */
const FIXTURE_SECTION = 'FixtureBody'

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'vxl-hva', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 32,
  maxNodes: 200_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 100,
}

// ---------------------------------------------------------------------------------------------
// HVA fixtures, written from the format

interface HvaSpec {
  readonly sectionNames: readonly string[]
  readonly frames: number
  /** Per frame, per section, a 3x4 row-major affine matrix. Defaults to a distinct translation. */
  readonly matrix?: (frame: number, section: number) => readonly number[]
  /** Truncate the encoded payload to this many bytes, to model a damaged sidecar. */
  readonly truncateTo?: number
}

function buildHva(spec: HvaSpec): Uint8Array {
  const { sectionNames, frames } = spec
  const total = 24 + sectionNames.length * 16 + frames * sectionNames.length * 48
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('X3\\FIXTURE'), 0)
  view.setUint32(16, frames, true)
  view.setUint32(20, sectionNames.length, true)
  sectionNames.forEach((name, index) => {
    bytes.set(new TextEncoder().encode(name).slice(0, 15), 24 + index * 16)
  })
  const matricesAt = 24 + sectionNames.length * 16
  for (let frame = 0; frame < frames; frame += 1) {
    for (let section = 0; section < sectionNames.length; section += 1) {
      const cell = frame * sectionNames.length + section
      const values = spec.matrix?.(frame, section) ??
        // identity rotation with a translation that encodes which cell it came from
        [1, 0, 0, frame + 1, 0, 1, 0, section + 1, 0, 0, 1, (frame + 1) * 10]
      values.forEach((value, component) => {
        view.setFloat32(matricesAt + cell * 48 + component * 4, value, true)
      })
    }
  }
  return spec.truncateTo === undefined ? bytes : bytes.slice(0, spec.truncateTo)
}

// ---------------------------------------------------------------------------------------------
// host wiring

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

let cached: Inventory | undefined

async function inventory(): Promise<Inventory> {
  if (cached !== undefined) return cached
  const inputs = await Promise.all(
    [
      ['ea', 'tiberian-sun'],
      ['ea', 'big'],
    ].map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  cached = await buildInventory(inputs, createHostContributionContractRegistry())
  return cached
}

const temporaries: string[] = []

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

/** A throwaway folder holding the synthetic VXL and, optionally, a sidecar beside it. */
async function folder(hva?: Uint8Array, hvaName = 'minimal.ra2.hva'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-vxl-hva-'))
  temporaries.push(directory)
  await cp(vxlFixture, join(directory, 'minimal.ra2.vxl'))
  if (hva !== undefined) await writeFile(join(directory, hvaName), hva)
  return directory
}

interface VxlSummary {
  readonly sections: readonly {
    readonly name: string
    readonly transformProvenance: string
    readonly hva: Record<string, unknown>
  }[]
  readonly hva: Record<string, unknown>
}

async function openThroughHost(directory: string): Promise<{
  readonly summary: VxlSummary
  readonly model: ModelSceneSource
  readonly diagnostics: readonly string[]
  readonly session: AssetSession
}> {
  const subjects = createSubjectServices({
    inventory: await inventory(),
    target,
    executionBackends,
  })
  const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
  const { snapshot, session } = await open(join(directory, 'minimal.ra2.vxl'))
  if (snapshot.state !== 'opened') throw new Error(JSON.stringify(snapshot.diagnostics))
  if (session === undefined) throw new Error('the VXL opened without a session')
  const inspected = await session.operations().invoke('inspect', null)
  if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
  const lease = await session.dataSource('common.view/model-scene-source', 1)
  return {
    summary: inspected.output.value as unknown as VxlSummary,
    model: lease.value as ModelSceneSource,
    diagnostics: snapshot.diagnostics.map(item => item.code),
    session,
  }
}

// ---------------------------------------------------------------------------------------------

describe('a VXL declares its HVA and reads only what the host bound', () => {
  it('opens without a sidecar and says the capability is simply absent', async () => {
    const { summary, model, session } = await openThroughHost(await folder())
    expect(summary.hva).toEqual({ state: 'absent' })
    expect(summary.sections[0]?.hva).toMatchObject({ provenance: 'absent', reason: 'no-companion' })
    // nothing was invented: no animation, and the node keeps identity
    expect(await model.info()).toMatchObject({ animations: 0 })
    expect((await model.nodes({ limit: 4 })).items[0]?.transform).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ])
    await session.dispose()
  })

  it('binds a multi-frame sidecar by section name and publishes its rest pose with provenance', async () => {
    const hva = buildHva({ sectionNames: [FIXTURE_SECTION], frames: 3 })
    const { summary, model, session } = await openThroughHost(await folder(hva))

    expect(summary.hva).toMatchObject({
      state: 'resolved',
      frames: 3,
      sections: 1,
      boundSections: 1,
      kind: 'animation',
    })
    const fact = summary.sections[0]?.hva as Record<string, unknown>
    expect(fact['provenance']).toBe('companion')
    expect(fact['hvaSectionName']).toBe(FIXTURE_SECTION)
    expect(String(fact['bindingId'])).toContain('hva#')
    // the tailer transform stays what it always was: read from the file itself
    expect(summary.sections[0]?.transformProvenance).toBe('direct')

    expect(await model.info()).toMatchObject({ animations: 1 })
    // frame 0 of the fixture is translation (1, 1, 10) in row-major 3x4 → column-major 4x4
    expect((await model.nodes({ limit: 4 })).items[0]?.transform).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 10, 1,
    ])
    await session.dispose()
  })

  it('calls a single-frame sidecar a rest pose, not an animation', async () => {
    /*
     * The real Red Alert 2 corpus is full of these: `gnavrail.hva` is 88 bytes — one section, one
     * frame. It says where the body rests and nothing about motion. Reporting `animations: 1` here
     * would be synthesising a track out of an identity pose, which §3.1 forbids by name.
     */
    const hva = buildHva({ sectionNames: [FIXTURE_SECTION], frames: 1 })
    const { summary, model, session } = await openThroughHost(await folder(hva))
    expect(summary.hva).toMatchObject({ state: 'resolved', frames: 1, kind: 'rest-pose' })
    expect(summary.sections[0]?.hva).toMatchObject({ provenance: 'companion' })
    expect(await model.info()).toMatchObject({ animations: 0 })
    await session.dispose()
  })

  it('refuses to bind sections whose identifiers disagree, instead of falling back to order', async () => {
    /*
     * The load-bearing test of this slice. Both files have exactly one section, so a positional
     * fallback — what the reference implementation does — would bind them and report a confident
     * transform for a limb that is not the same limb.
     */
    const hva = buildHva({ sectionNames: ['SomeOtherTurret'], frames: 4 })
    const { summary, model, session } = await openThroughHost(await folder(hva))

    expect(summary.hva).toMatchObject({ state: 'resolved', sections: 1, boundSections: 0 })
    expect(summary.sections[0]?.hva).toMatchObject({
      provenance: 'absent',
      reason: 'identifier-mismatch',
    })
    // an HVA that binds nothing yields no animation, and the node is left at identity
    expect(await model.info()).toMatchObject({ animations: 0 })
    expect((await model.nodes({ limit: 4 })).items[0]?.transform).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ])
    await session.dispose()
  })

  it('reports a sidecar section this model does not name', async () => {
    const hva = buildHva({ sectionNames: [FIXTURE_SECTION, 'Turret'], frames: 2 })
    const { summary, session } = await openThroughHost(await folder(hva))
    expect(summary.hva).toMatchObject({ sections: 2, boundSections: 1 })
    expect(summary.sections[0]?.hva).toMatchObject({ provenance: 'companion' })
    await session.dispose()
  })

  it('refuses a duplicated section name rather than picking the first', async () => {
    const hva = buildHva({ sectionNames: [FIXTURE_SECTION, FIXTURE_SECTION], frames: 2 })
    const { summary, session } = await openThroughHost(await folder(hva))
    expect(summary.sections[0]?.hva).toMatchObject({
      provenance: 'absent',
      reason: 'duplicate-section-name',
    })
    await session.dispose()
  })

  it('keeps the model readable when the sidecar is truncated, and names the damage', async () => {
    // header promises three frames of matrices; the file stops in the middle of the track
    const hva = buildHva({ sectionNames: [FIXTURE_SECTION], frames: 3, truncateTo: 80 })
    const { summary, model, session } = await openThroughHost(await folder(hva))

    expect(summary.hva).toMatchObject({ state: 'corrupt' })
    expect(summary.sections[0]?.hva).toMatchObject({
      provenance: 'absent',
      reason: 'companion-unreadable',
    })
    // a corrupt companion is not a corrupt subject: the voxel geometry is still there
    expect(await model.info()).toMatchObject({ geometryAccess: 'decoded', animations: 0 })
    await session.dispose()
  })

  it('distinguishes an absent sidecar from a corrupt one', async () => {
    const absent = await openThroughHost(await folder())
    const corrupt = await openThroughHost(
      await folder(buildHva({ sectionNames: [FIXTURE_SECTION], frames: 2, truncateTo: 40 })),
    )
    expect(absent.summary.hva).toEqual({ state: 'absent' })
    expect(corrupt.summary.hva).toMatchObject({ state: 'corrupt' })
    expect(absent.summary.sections[0]?.hva).toMatchObject({ reason: 'no-companion' })
    expect(corrupt.summary.sections[0]?.hva).toMatchObject({ reason: 'companion-unreadable' })
    await absent.session.dispose()
    await corrupt.session.dispose()
  })

  it('resolves the sidecar by exact name when several sit beside the model', async () => {
    const directory = await folder(buildHva({ sectionNames: [FIXTURE_SECTION], frames: 2 }))
    // a second, unrelated sidecar: an exact-name declaration must not become ambiguous
    await writeFile(
      join(directory, 'other.hva'),
      buildHva({ sectionNames: ['Nothing'], frames: 2 }),
    )
    const { summary, session } = await openThroughHost(directory)
    expect(summary.hva).toMatchObject({ state: 'resolved', boundSections: 1 })
    await session.dispose()
  })
})

describe('what declaring a companion actually costs a VXL open', () => {
  it('costs one bounded directory listing and no source opens when no sidecar exists', async () => {
    /*
     * Stated honestly rather than as "nothing changed": flipping this codec from `single` to
     * `bundle` means every VXL open now asks the host to look, and looking is one enumeration of
     * the confined directory. What it must not cost is *opens* — a model with no sidecar beside it
     * must not pay to discover that, and a model with one must pay for exactly that one.
     */
    const { createCompanionInputResolver } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'input-resolution.js')).href
    )) as typeof import('../../host/src/input-resolution.js')
    const { createFilesystemCompanionOrigin } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'node', 'companion-origin.js')).href
    )) as typeof import('../../host/src/node/companion-origin.js')

    const measure = async (directory: string) => {
      const primaryPath = join(directory, 'minimal.ra2.vxl')
      const origin = createFilesystemCompanionOrigin({ primaryPath, roots: [directory] })
      let enumerations = 0
      let opens = 0
      const counted = {
        ...origin,
        enumerate(scope: never, options: never, signal?: AbortSignal) {
          enumerations += 1
          return origin.enumerate(scope, options, signal)
        },
        async open(logicalId: string, signal?: AbortSignal) {
          opens += 1
          return origin.open(logicalId, signal)
        },
      }
      const vxl = new Uint8Array(await readFile(primaryPath))
      const uri = pathToFileURL(primaryPath).href
      const input = await createCompanionInputResolver(counted)({
        source: {
          kind: 'bytes',
          ref: { id: uri, uri },
          revision: revisionId('content-hash.sha256:vxl-cost'),
          size: BigInt(vxl.byteLength),
          async read(offset: bigint, length: number) {
            return vxl.slice(Number(offset), Number(offset) + length)
          },
          async *stream() {
            yield vxl
          },
        },
        plan: {
          originKind: 'bundle',
          candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
          requirements: [
            {
              id: 'hva',
              role: 'hva',
              ownership: 'companion',
              patterns: ['minimal.ra2.hva'],
              scopes: ['sibling-directory'],
              cardinality: 'zero-or-one',
              required: false,
            },
          ],
        } as never,
        detection: {
          codecId: 'org.modkitx/red-alert2-vxl',
          confidence: 1,
          evidence: [],
          requiredRanges: [],
        },
      })
      if (input.originKind === 'derived') throw new Error('unexpected derived input')
      return { enumerations, opens, bound: input.bindingsFor('hva').length }
    }

    expect(await measure(await folder())).toEqual({ enumerations: 1, opens: 0, bound: 0 })
    expect(
      await measure(await folder(buildHva({ sectionNames: [FIXTURE_SECTION], frames: 2 }))),
    ).toEqual({ enumerations: 1, opens: 1, bound: 1 })
  })

  it('costs a codec opened without any host resolver nothing at all', async () => {
    /*
     * The other path this codec still has to survive: a caller that builds a `single` input by
     * hand and never consults a resolver — which is exactly what the ported-codec suites do. The
     * companion code must notice there are no bindings and read nothing.
     */
    const module = (await import(
      pathToFileURL(
        join(repoRoot, 'extensions', 'ea', 'tiberian-sun', 'src', 'red-alert2-vxl', 'codec.js'),
      ).href
    )) as { createCodec(context: unknown): import('@modkitx-x3/sdk').Codec }
    const vxl = new Uint8Array(await readFile(vxlFixture))
    let reads = 0
    const uri = 'memory://vxl-cost/minimal.ra2.vxl'
    const value: ArtifactByteSource = {
      kind: 'bytes',
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:vxl-no-resolver'),
      size: BigInt(vxl.byteLength),
      async read(offset, length) {
        reads += 1
        return vxl.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        reads += 1
        yield vxl
      },
    }
    let openBindingCalls = 0
    const session = await module
      .createCodec({
        budgets: budget,
        diagnostics: { report: () => undefined },
        contracts: {
          async resolve() {
            throw new Error('no service dependency')
          },
          async resolveUnknown() {
            throw new Error('no foreign service dependency')
          },
        },
      })
      .open(
        {
          originKind: 'single',
          bindings: [
            {
              sourceKind: 'candidate',
              bindingId: 'content',
              role: 'content',
              ownership: 'owned',
              source: value.ref,
              revision: value.revision,
            },
          ],
          primaryBindingId: 'content',
          revisions: {
            topology: 'single',
            revision: value.revision,
            bindings: [{ bindingId: 'content', revision: value.revision }],
            compositionFingerprint: value.ref.id,
          },
          bindingsFor: () => [],
          async openBinding() {
            openBindingCalls += 1
            return { value, release: async () => undefined }
          },
        } as never,
        'inspect',
        budget,
      )
    // exactly one binding open — the primary — and nothing else went looking
    expect(openBindingCalls).toBe(1)
    expect(reads).toBeGreaterThan(0)
    await session.dispose()
  })
})

describe('the same declaration resolved inside an archive namespace', () => {
  /** A minimal BIG4 holding the VXL and its sidecar as stored entries. */
  function buildBig(entries: readonly { readonly path: string; readonly bytes: Uint8Array }[]) {
    const encoder = new TextEncoder()
    const named = entries.map(entry => ({ ...entry, name: encoder.encode(entry.path) }))
    const indexBytes = named.reduce((total, e) => total + 8 + e.name.byteLength + 1, 0)
    const dataOffset = 16 + indexBytes
    const total = named.reduce((size, e) => size + e.bytes.byteLength, dataOffset)
    const archive = new Uint8Array(total)
    const view = new DataView(archive.buffer)
    archive.set(encoder.encode('BIG4'), 0)
    view.setUint32(4, total, true)
    view.setUint32(8, named.length, false)
    view.setUint32(12, dataOffset, false)
    let cursor = 16
    let payload = dataOffset
    for (const entry of named) {
      view.setUint32(cursor, payload, false)
      view.setUint32(cursor + 4, entry.bytes.byteLength, false)
      cursor += 8
      archive.set(entry.name, cursor)
      cursor += entry.name.byteLength
      archive[cursor] = 0
      cursor += 1
      archive.set(entry.bytes, payload)
      payload += entry.bytes.byteLength
    }
    return archive
  }

  it('binds the sidecar out of the same BIG through current-mount', async () => {
    const { openNestedSubject } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'nested-subject.js')).href
    )) as typeof import('../../host/src/nested-subject.js')

    const vxl = new Uint8Array(await readFile(vxlFixture))
    const archive = buildBig([
      { path: 'art/models/minimal.ra2.vxl', bytes: vxl },
      {
        path: 'art/models/minimal.ra2.hva',
        bytes: buildHva({ sectionNames: [FIXTURE_SECTION], frames: 5 }),
      },
    ])
    const uri = 'memory://vxl-hva/fixture.big'
    const source: ArtifactByteSource = Object.freeze({
      kind: 'bytes' as const,
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:vxl-hva-big'),
      size: BigInt(archive.byteLength),
      async read(offset: bigint, length: number) {
        return archive.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        yield archive
      },
    })
    const inventoryValue = await inventory()
    const opened = await openSubject({
      inventory: inventoryValue,
      source,
      path: 'fixture.big',
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (opened.state !== 'opened') throw new Error('the BIG fixture did not open')
    try {
      const lease = await opened.session.dataSource('common.view/namespace-entry-source', 1)
      const page = await (lease.value as NamespaceEntrySource).list('', { limit: 10 })
      const entry = page.items.find(item => item.path === 'art/models/minimal.ra2.vxl')
      await lease.release()
      if (entry === undefined) throw new Error('the fixture archive has no VXL entry')

      const nested = await openNestedSubject({
        parent: opened.session,
        entryId: entry.id,
        inventory: inventoryValue,
        executionBackends,
        target,
        grant,
        budget,
      })
      if (nested.result.state !== 'opened') {
        throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 400))
      }
      expect(nested.result.selected.contributionId).toBe('org.modkitx/red-alert2-vxl')
      const inspected = await nested.result.session.operations().invoke('inspect', null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
      const summary = inspected.output.value as unknown as VxlSummary
      /*
       * The same declaration, a different medium. An archive entry's reference carries an opaque
       * id rather than its path, so the codec cannot name `minimal.ra2.hva` exactly here and falls
       * back to the broad `*.hva` — which this archive answers unambiguously.
       */
      expect(summary.hva).toMatchObject({ state: 'resolved', frames: 5, boundSections: 1 })
      expect(summary.sections[0]?.hva).toMatchObject({ provenance: 'companion' })
      await nested.result.session.dispose()
    } finally {
      await opened.session.dispose()
    }
  })
})

describe('the configured real Red Alert 2 model', () => {
  const realVxl = process.env['MODKITX_VXL_PATH']?.trim()
  const available = realVxl !== undefined && existsSync(realVxl)

  it.skipIf(!available)('binds its real sidecar and reports stable counts', async () => {
    if (realVxl === undefined) throw new TypeError('MODKITX_VXL_PATH is not set')
    const directory = await mkdtemp(join(tmpdir(), 'x3-vxl-real-'))
    temporaries.push(directory)
    // copied rather than opened in place: the real sample folder is not a granted root, and the
    // sibling scope must see exactly the model and the sidecar that belongs to it
    const stem = basename(realVxl).replace(/\.vxl$/iu, '')
    await cp(realVxl, join(directory, `${stem}.vxl`))
    const sidecar = join(dirname(realVxl), `${stem}.hva`)
    const hasSidecar = existsSync(sidecar)
    if (hasSidecar) await cp(sidecar, join(directory, `${stem}.hva`))

    const subjects = createSubjectServices({
      inventory: await inventory(),
      target,
      executionBackends,
    })
    const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
    const { snapshot, session } = await open(join(directory, `${stem}.vxl`))
    if (snapshot.state !== 'opened' || session === undefined) {
      throw new Error(JSON.stringify(snapshot.diagnostics))
    }
    const inspected = await session.operations().invoke('inspect', null)
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
    const summary = inspected.output.value as unknown as VxlSummary & {
      readonly sections: readonly { readonly name: string }[]
    }
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const info = await (lease.value as ModelSceneSource).info()

    // counts are printed rather than asserted against literals: the corpus is the user's, and a
    // tracked expectation would encode a file this repository does not ship
    console.info(
      `[vxl-live] sections ${summary.sections.length}, sidecar ${JSON.stringify(summary.hva)}, ` +
        `animations ${info.animations}, meshes ${info.meshes}`,
    )
    expect(summary.sections.length).toBeGreaterThan(0)
    expect(info.geometryAccess).toBe('decoded')
    if (hasSidecar) {
      // the real sidecar must be bound by name, not merely present
      expect(summary.hva).toMatchObject({ state: 'resolved' })
      expect(Number(summary.hva['boundSections'])).toBeGreaterThan(0)
      // and a one-frame sidecar stays a pose
      expect(info.animations).toBe(Number(summary.hva['frames']) > 1 ? 1 : 0)
    }
    await lease.release()
    await session.dispose()
  })
})
