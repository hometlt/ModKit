/**
 * The archive case of block 9, end to end: a W3D entry inside a BIG finds its texture inside the
 * *same* BIG, through the container's own bounded extraction.
 *
 * Two claims are load-bearing here, and both are proved by counting rather than by assertion:
 *
 * 1. **No filesystem fallback.** The archive is built in memory and handed to the host as an
 *    in-memory byte source. The backend that resolves companions inside it imports nothing from
 *    `node:*` — asserted on its source, because that makes a disk read unrepresentable rather than
 *    merely unobserved — and the only supplier of bytes it has is the container's own bounded
 *    extraction, which the suite counts. A temp-file staging would have to show up in one or the
 *    other.
 * 2. **The container outlives its child, exactly once.** Every namespace and entry lease the route
 *    takes is counted in and out, at each failure point: a missing required companion, an ambiguous
 *    one, an abort in the middle of enumeration, and the ordinary success followed by dispose.
 *
 * The BIG is genuine, not mocked: it is assembled by the writer below and parsed by the shipped EA
 * BIG codec, RefPack entry included, so the companion's bytes travel the real decompression path.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CANCELLED_CODE, isModkitError } from '@modkitx-x3/core'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  openSubject,
  type SubjectServices,
} from '@modkitx-x3/host'
import { loadExtensionDirectory, openFileArtifactSource } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetSession,
  type NamespaceEntrySource,
  type PageRequest,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  NESTED_ENTRY_UNREADABLE,
  NESTED_SUBJECT_UNSUPPORTED,
  openNestedSubject,
} from '../src/nested-subject.js'
import { createNamespaceCompanionOrigin } from '../src/namespace-origin.js'
import {
  COMPANION_AMBIGUOUS,
  COMPANION_REQUIRED_MISSING,
  COMPANION_SCOPE_UNSUPPORTED,
  COMPANION_UNAVAILABLE,
  createCompanionInputResolver,
} from '../src/input-resolution.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
const bigExtension = join(repoRoot, 'extensions', 'ea', 'big')
const nestedExtension = join(import.meta.dirname, 'fixtures', 'companion-namespace-extension')

const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'nested-companion', classes: ['read-source'] } as const

// ---------------------------------------------------------------------------------------------
// a real BIG4 archive, assembled in memory

/**
 * A literal-only RefPack stream.
 *
 * Deliberately the simplest *valid* encoding rather than a good one: the point of a compressed
 * entry in this fixture is that the container's decoder has to run and produce the original bytes
 * back, not that the archive is small. The shipped decoder rejects a stream that does not end in a
 * terminator command with the declared output length filled exactly, so a stream this writer
 * produces is a stream that decoder accepts — or the fixture test fails, which is also useful.
 */
function refPack(data: Uint8Array): Uint8Array {
  const out: number[] = [
    0x10,
    0xfb,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
  ]
  let cursor = 0
  while (data.length - cursor >= 4) {
    // long-literal command 0xE0..0xFB: ((control & 0x1f) + 1) << 2 bytes, so 4…112 at a time
    const chunk = Math.min(112, (data.length - cursor) & ~3)
    out.push(0xe0 + ((chunk >>> 2) - 1))
    for (let index = 0; index < chunk; index += 1) out.push(data[cursor + index] as number)
    cursor += chunk
  }
  const rest = data.length - cursor // 0…3, carried by the terminator itself
  out.push(0xfc + rest)
  for (let index = 0; index < rest; index += 1) out.push(data[cursor + index] as number)
  return new Uint8Array(out)
}

interface BigEntryInput {
  readonly path: string
  readonly bytes: Uint8Array
  readonly compress?: boolean
}

function buildBig(entries: readonly BigEntryInput[]): Uint8Array {
  const encoder = new TextEncoder()
  const stored = entries.map(entry => ({
    path: entry.path,
    name: encoder.encode(entry.path),
    payload: entry.compress === true ? refPack(entry.bytes) : entry.bytes,
  }))
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

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://nested-companion/${name}`
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

// ---------------------------------------------------------------------------------------------
// the host under test

let model: Uint8Array
let skin: Uint8Array

async function payloads(): Promise<{ readonly model: Uint8Array; readonly skin: Uint8Array }> {
  model ??= new Uint8Array(await readFile(join(syntheticDir, 'minimal.westwood.w3d')))
  skin ??= new Uint8Array(await readFile(join(syntheticDir, 'minimal.tga')))
  return { model, skin }
}

let services: SubjectServices | undefined

async function nestedServices(): Promise<SubjectServices> {
  if (services !== undefined) return services
  const inputs = await Promise.all(
    [bigExtension, nestedExtension].map(async directory => ({
      ...(await loadExtensionDirectory(directory)),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  const inventory = await buildInventory(inputs, createHostContributionContractRegistry())
  services = createSubjectServices({
    inventory,
    target,
    executionBackends: createExecutionBackendRegistry([
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
    ]),
  })
  return services
}

/** Opens the archive itself as a subject — the parent every nested open starts from. */
async function openArchive(entries: readonly BigEntryInput[]): Promise<AssetSession> {
  const subjects = await nestedServices()
  const archive = buildBig(entries)
  const result = await openSubject({
    inventory: subjects.inventory,
    source: byteSource(archive, 'fixture.big'),
    path: 'fixture.big',
    intent: 'full',
    target,
    grant,
    budget,
    executionBackends: subjects.executionBackends,
  })
  if (result.state !== 'opened') {
    throw new Error(`the BIG fixture did not open: ${JSON.stringify(result.diagnostics)}`)
  }
  expect(result.selected.contributionId).toBe('org.modkitx/big')
  return result.session
}

async function standardEntries(): Promise<readonly BigEntryInput[]> {
  const { model: modelBytes, skin: skinBytes } = await payloads()
  return [
    { path: 'data/editor/molds/bowl.w3d', bytes: modelBytes },
    // the companion arrives RefPack-compressed: its bytes only match if the container decompressed
    { path: 'art/textures/bowl.tga', bytes: skinBytes, compress: true },
    { path: 'art/textures/other.tga', bytes: skinBytes },
    { path: 'data/editor/props/lamp.w3d', bytes: modelBytes },
  ]
}

async function entryIdOf(session: AssetSession, path: string): Promise<string> {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  try {
    const page = await (lease.value as NamespaceEntrySource).list('', { limit: 100 })
    const entry = page.items.find(item => item.path === path)
    if (entry === undefined) throw new Error(`fixture archive has no ${path}`)
    return entry.id
  } finally {
    await lease.release()
  }
}

async function codeOf(action: () => unknown): Promise<string> {
  try {
    await action()
  } catch (error) {
    return isModkitError(error) ? error.code : `not-a-modkit-error:${String(error)}`
  }
  return 'no-error'
}

interface Counters {
  opens: number
  releases: number
  doubleRelease: boolean
}

async function originOver(
  session: AssetSession,
  primaryLogicalId: string,
): Promise<{
  readonly origin: ReturnType<typeof createNamespaceCompanionOrigin>
  readonly counters: Counters
  /** Entry ids the container was actually asked to extract. */
  readonly extracted: readonly string[]
  readonly release: () => Promise<void>
}> {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  const namespace = lease.value as NamespaceEntrySource
  const counters: Counters = { opens: 0, releases: 0, doubleRelease: false }
  const extracted: string[] = []
  const counted: NamespaceEntrySource = Object.freeze({
    list: (prefix: string, page: PageRequest, signal?: AbortSignal) =>
      namespace.list(prefix, page, signal),
    async openEntry(entryId: string, signal?: AbortSignal) {
      counters.opens += 1
      const inner = await namespace.openEntry(entryId, signal)
      let released = false
      return {
        value: inner.value,
        async release() {
          if (released) {
            counters.doubleRelease = true
            return
          }
          released = true
          counters.releases += 1
          await inner.release()
        },
      }
    },
  })
  const descriptor = await session.descriptor()
  const origin = createNamespaceCompanionOrigin({
    namespace: counted,
    primaryLogicalId,
    containerRevision: descriptor.revision,
    extract: async entryId => {
      extracted.push(entryId)
      const invoked = await session.operations().invoke('extract-entry', { entryId })
      if (invoked.state !== 'ok' || invoked.output.kind !== 'bytes') throw new Error('extract')
      return invoked.output.value
    },
  })
  return { origin, counters, extracted, release: () => lease.release() }
}

const requirement = (scopes: readonly string[], cardinality: 'one' | 'many') =>
  ({
    id: 'skin',
    role: 'texture',
    ownership: 'companion',
    patterns: ['bowl.tga'],
    scopes,
    cardinality,
    required: cardinality === 'one',
  }) as never

const plan = (scopes: readonly string[], cardinality: 'one' | 'many') =>
  ({
    originKind: 'bundle' as const,
    candidate: { bindingId: 'content', role: 'content', ownership: 'owned' as const },
    requirements: [requirement(scopes, cardinality)],
  }) as never

const openSessions: AssetSession[] = []

afterEach(async () => {
  while (openSessions.length > 0) await openSessions.pop()?.dispose()
})

// ---------------------------------------------------------------------------------------------

describe('a container entry opens as its own subject, with companions from the same container', () => {
  it('binds the RefPack texture beside the model and hands the codec byte-exact bytes', async () => {
    const archive = await openArchive(await standardEntries())
    openSessions.push(archive)
    const { skin: skinBytes } = await payloads()
    const subjects = await nestedServices()

    const { result, entry } = await openNestedSubject({
      parent: archive,
      entryId: await entryIdOf(archive, 'data/editor/molds/bowl.w3d'),
      inventory: subjects.inventory,
      executionBackends: subjects.executionBackends,
      target,
      grant,
      budget,
    })

    expect(entry.path).toBe('data/editor/molds/bowl.w3d')
    if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
    expect(result.selected.contributionId).toBe('org.example/nested-required')

    const inspected = await result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
      throw new Error('the nested codec did not inspect')
    }
    const summary = inspected.output.value as {
      readonly skin: readonly number[] | null
      readonly boundBindingIds: readonly string[]
      readonly skinSource: readonly string[]
    }
    // byte-exact through the container's RefPack decoder, and nowhere else
    expect(summary.skin).toEqual(Array.from(skinBytes))
    expect(summary.boundBindingIds).toEqual(['skin#art/textures/bowl.tga'])
    // the codec reports the reference the host bound; it never built that URI
    expect(summary.skinSource[0]).toMatch(/^big-entry:/u)

    await result.session.dispose()
  })

  it('takes every companion byte from the container, and cannot reach a filesystem at all', async () => {
    /*
     * Two halves of one claim, because either alone is weak.
     *
     * Structurally: the archive backend is a module that imports no `node:` anything. It cannot
     * open a file, stage a temp copy or list a directory, whatever a future edit intends — a
     * property a spy could only observe, and which ESM namespace objects will not let one spy on
     * anyway. The doc comment at the top of that module makes this promise; this is the check.
     *
     * Behaviourally: the backend's *only* supplier of bytes is the `extract` closure handed to it,
     * so counting that closure accounts for every byte the codec received. The companion arrives
     * byte-exact and `extract` was called for exactly the two entries involved — the model and its
     * texture — which is what "resolved inside the same container" means operationally.
     */
    const backendSource = await readFile(
      join(import.meta.dirname, '..', 'src', 'namespace-origin.ts'),
      'utf8',
    )
    expect(backendSource).not.toMatch(/from 'node:/u)
    expect(backendSource).not.toMatch(/require\('node:/u)

    const archive = await openArchive(await standardEntries())
    openSessions.push(archive)
    const { skin: skinBytes } = await payloads()
    const { origin, counters, release, extracted } = await originOver(
      archive,
      'data/editor/molds/bowl.w3d',
    )
    try {
      const input = await createCompanionInputResolver(origin)({
        source: byteSource(new Uint8Array([0, 0, 0, 0]), 'entry'),
        plan: plan(['current-mount'], 'one'),
        detection: {
          codecId: 'org.example/nested-required',
          confidence: 1,
          evidence: [],
          requiredRanges: [],
        },
      })
      if (input.originKind === 'derived') throw new Error('unexpected derived input')
      const bound = input.bindingsFor('skin')
      const lease = await input.openBinding(bound[0]?.bindingId ?? '')
      try {
        if (lease.value.kind !== 'bytes') throw new Error('companion is not a byte source')
        expect(Array.from(await lease.value.read(0n, Number(lease.value.size ?? 0n)))).toEqual(
          Array.from(skinBytes),
        )
      } finally {
        await lease.release()
      }
      // every byte came through the container's own bounded extraction, and no other entry was read
      expect(new Set(extracted).size).toBe(1)
      expect(counters.opens).toBe(counters.releases)
      expect(counters.doubleRelease).toBe(false)

      /*
       * The other half of the security contract: the codec may read the identity of a binding it
       * was given, but may not name one it was not. A forged id — even one naming a real entry of
       * this very archive — is refused, so knowing the archive's contents buys no access to them.
       */
      const beforeForging = [...extracted]
      expect(await codeOf(() => input.openBinding('skin#art/textures/other.tga'))).toBe(
        'x3.host/unknown-asset-input-binding',
      )
      expect(await codeOf(() => input.openBinding('skin#../../etc/passwd'))).toBe(
        'x3.host/unknown-asset-input-binding',
      )
      // refused before the container was touched: neither forged id extracted anything
      expect(extracted).toEqual(beforeForging)
    } finally {
      await release()
    }
  })

  it('refuses the nested open when the required texture is absent, and releases the container', async () => {
    const { model: modelBytes, skin: skinBytes } = await payloads()
    const archive = await openArchive([
      { path: 'data/editor/molds/bowl.w3d', bytes: modelBytes },
      { path: 'art/textures/other.tga', bytes: skinBytes, compress: true },
    ])
    openSessions.push(archive)
    const subjects = await nestedServices()

    const { result } = await openNestedSubject({
      parent: archive,
      entryId: await entryIdOf(archive, 'data/editor/molds/bowl.w3d'),
      inventory: subjects.inventory,
      executionBackends: subjects.executionBackends,
      target,
      grant,
      budget,
    })

    expect(result.state).toBe('unresolved')
    if (result.state !== 'unresolved') throw new Error('a missing required texture opened')
    expect(result.reason).toBe('input-unresolved')
    const refusal = result.diagnostics.find(item => item.code === COMPANION_REQUIRED_MISSING)
    expect(refusal?.message).toContain('skin')
    expect(refusal?.message).toContain('current-mount')
    // the parent is still usable: the child's failure released only what the child took
    const stillListing = await archive.dataSource('common.view/namespace-entry-source', 1)
    expect(
      (await (stillListing.value as NamespaceEntrySource).list('', { limit: 5 })).items.length,
    ).toBeGreaterThan(0)
    await stillListing.release()
  })

  it('refuses to choose between two entries that share the declared name', async () => {
    const { model: modelBytes, skin: skinBytes } = await payloads()
    const archive = await openArchive([
      { path: 'data/editor/molds/bowl.w3d', bytes: modelBytes },
      { path: 'art/textures/bowl.tga', bytes: skinBytes, compress: true },
      // a second entry with the same name filed under another folder: two candidates, one slot
      { path: 'art/textures/decoy/bowl.tga', bytes: skinBytes },
    ])
    openSessions.push(archive)
    const subjects = await nestedServices()

    const { result } = await openNestedSubject({
      parent: archive,
      entryId: await entryIdOf(archive, 'data/editor/molds/bowl.w3d'),
      inventory: subjects.inventory,
      executionBackends: subjects.executionBackends,
      target,
      grant,
      budget,
    })

    expect(result.state).toBe('unresolved')
    expect(result.diagnostics.map(item => item.code)).toContain(COMPANION_AMBIGUOUS)
  })

  it('opens the optional variant without its texture and names the capability unavailable', async () => {
    const { model: modelBytes, skin: skinBytes } = await payloads()
    const archive = await openArchive([
      { path: 'data/editor/props/lamp.w3d', bytes: modelBytes },
      { path: 'art/textures/other.tga', bytes: skinBytes },
    ])
    openSessions.push(archive)
    const subjects = await nestedServices()
    const reported: string[] = []

    const { result } = await openNestedSubject({
      parent: archive,
      entryId: await entryIdOf(archive, 'data/editor/props/lamp.w3d'),
      inventory: subjects.inventory,
      executionBackends: subjects.executionBackends,
      target,
      grant,
      budget,
      onDiagnostic: item => reported.push(item.code),
    })

    if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
    expect(result.selected.contributionId).toBe('org.example/nested-optional')
    expect(reported).toContain(COMPANION_UNAVAILABLE)
    const inspected = await result.session.operations().invoke('inspect', {})
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
    // nothing was substituted for the missing texture
    expect((inspected.output.value as { readonly skin: unknown }).skin).toBeNull()
    await result.session.dispose()
  })

  it('refuses a parent that is not a container at all', async () => {
    const archive = await openArchive(await standardEntries())
    openSessions.push(archive)
    const subjects = await nestedServices()
    const entryId = await entryIdOf(archive, 'data/editor/molds/bowl.w3d')
    const { result } = await openNestedSubject({
      parent: archive,
      entryId,
      inventory: subjects.inventory,
      executionBackends: subjects.executionBackends,
      target,
      grant,
      budget,
    })
    if (result.state !== 'opened') throw new Error('setup: the nested model did not open')
    openSessions.push(result.session)

    // the nested W3D subject publishes neither an entry listing nor container.extract
    expect(
      await codeOf(() =>
        openNestedSubject({
          parent: result.session,
          entryId: '0',
          inventory: subjects.inventory,
          executionBackends: subjects.executionBackends,
          target,
          grant,
          budget,
        }),
      ),
    ).toBe(NESTED_SUBJECT_UNSUPPORTED)
  })

  it('reports an entry the container refuses to extract instead of opening an empty subject', async () => {
    const archive = await openArchive(await standardEntries())
    openSessions.push(archive)
    const subjects = await nestedServices()
    const entryId = await entryIdOf(archive, 'data/editor/molds/bowl.w3d')
    const operations = archive.operations()
    const refusing: AssetSession = Object.freeze({
      ...archive,
      revision: archive.revision,
      descriptor: () => archive.descriptor(),
      dataSource: archive.dataSource.bind(archive) as AssetSession['dataSource'],
      operations: () =>
        Object.freeze({
          invoke: async () => ({
            state: 'rejected' as const,
            reason: 'handler-unregistered' as const,
            diagnostics: [],
          }),
          dispose: () => operations.dispose(),
        }),
    })

    expect(
      await codeOf(() =>
        openNestedSubject({
          parent: refusing,
          entryId,
          inventory: subjects.inventory,
          executionBackends: subjects.executionBackends,
          target,
          grant,
          budget,
        }),
      ),
    ).toBe(NESTED_ENTRY_UNREADABLE)
  })
})

describe('the same route on a real shipped archive', () => {
  const cncRoot = process.env['MODKITX_CNC3_ROOT']?.trim()
  const archivePath = 'Core/1.0/Misc.big'
  const entryPath = 'data/editor/molds/bowl.w3d'

  /*
   * A synthetic BIG proves the route; a shipped one proves the route survives a real index — tens
   * of thousands of entries, real paths, real RefPack payloads. The inventory here is the shipping
   * one (EA BIG + EA models), so the entry is decoded by the codec a user would actually get.
   */
  it.skipIf(cncRoot === undefined)(
    `opens ${entryPath} out of ${archivePath} as its own subject`,
    async () => {
      if (cncRoot === undefined) throw new TypeError('MODKITX_CNC3_ROOT is not set')
      const inputs = await Promise.all(
        [
          ['ea', 'big'],
          ['ea', 'models'],
        ].map(async parts => ({
          ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
          execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
        })),
      )
      const inventory = await buildInventory(inputs, createHostContributionContractRegistry())
      const backends = createExecutionBackendRegistry([
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
      const liveBudget: ResourceBudget = {
        maxInputBytes: 64_000_000n,
        maxDepth: 128,
        maxNodes: 200_000,
        maxScalarBytes: 16_000_000,
        maxDiagnostics: 100,
      }
      const archiveFile = join(cncRoot, ...archivePath.split('/'))
      const opened = await openSubject({
        inventory,
        source: await openFileArtifactSource(archiveFile),
        path: archiveFile,
        intent: 'full',
        target,
        grant,
        budget: liveBudget,
        executionBackends: backends,
      })
      if (opened.state !== 'opened') throw new Error(JSON.stringify(opened.diagnostics))
      expect(opened.selected.contributionId).toBe('org.modkitx/big')
      openSessions.push(opened.session)

      const entryId = await entryIdOf(opened.session, entryPath)
      const { result, entry } = await openNestedSubject({
        parent: opened.session,
        entryId,
        inventory,
        executionBackends: backends,
        target,
        grant,
        budget: liveBudget,
      })
      expect(entry.path).toBe(entryPath)
      if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
      // the shipping W3D codec, decoding an entry it never had to find or extract itself
      expect(result.selected.contributionId).toBe('org.modkitx/westwood-w3d')
      const descriptor = result.descriptor as unknown as {
        readonly traits: readonly { readonly id: string }[]
      }
      expect(descriptor.traits.map(trait => trait.id)).toContain('model.geometry')
      await result.session.dispose()
    },
    120_000,
  )
})

describe('the container lease the route retains is released exactly once, on every path', () => {
  /**
   * A parent session whose namespace data source is counted in and out.
   *
   * "The child still worked afterwards" is the weak version of this claim — a leaked lease leaves
   * the parent perfectly usable and only shows up much later, as a handle a long-running host never
   * gets back. So the assertion is arithmetic: the route acquires the container's listing once per
   * nested open, and by the time that open has finished failing, or its session has been disposed,
   * it has given it back exactly once.
   */
  function countedParent(session: AssetSession): {
    readonly parent: AssetSession
    readonly acquired: () => number
    readonly released: () => number
    readonly doubleRelease: () => boolean
  } {
    let acquired = 0
    let released = 0
    let doubleRelease = false
    const parent: AssetSession = Object.freeze({
      revision: session.revision,
      state: () => session.state(),
      descriptor: () => session.descriptor(),
      operations: () => session.operations(),
      events: (signal?: AbortSignal) => session.events(signal),
      dispose: () => session.dispose(),
      dataSource: (async (contract: never, major: never) => {
        const lease = await session.dataSource(contract, major)
        if (contract !== 'common.view/namespace-entry-source') return lease
        acquired += 1
        let done = false
        return {
          value: lease.value,
          async release() {
            if (done) {
              doubleRelease = true
              return
            }
            done = true
            released += 1
            await lease.release()
          },
        }
      }) as AssetSession['dataSource'],
    })
    return {
      parent,
      acquired: () => acquired,
      released: () => released,
      doubleRelease: () => doubleRelease,
    }
  }

  async function nestedOver(
    entries: readonly BigEntryInput[],
    entryPath: string,
  ): Promise<{
    readonly counted: ReturnType<typeof countedParent>
    readonly nested: Awaited<ReturnType<typeof openNestedSubject>>
  }> {
    const archive = await openArchive(entries)
    openSessions.push(archive)
    const subjects = await nestedServices()
    const counted = countedParent(archive)
    const nested = await openNestedSubject({
      parent: counted.parent,
      entryId: await entryIdOf(archive, entryPath),
      inventory: subjects.inventory,
      executionBackends: subjects.executionBackends,
      target,
      grant,
      budget,
    })
    return { counted, nested }
  }

  it('holds the container while the child lives and gives it back on dispose', async () => {
    const { counted, nested } = await nestedOver(
      await standardEntries(),
      'data/editor/molds/bowl.w3d',
    )
    if (nested.result.state !== 'opened') throw new Error('the nested model did not open')

    // still held: the child is alive and its companion is reachable through the container
    expect(counted.acquired()).toBe(1)
    expect(counted.released()).toBe(0)

    await nested.result.session.dispose()
    expect(counted.released()).toBe(1)
    // and disposing twice must not hand the same container lease back twice
    await nested.result.session.dispose()
    expect(counted.released()).toBe(1)
    expect(counted.doubleRelease()).toBe(false)
  })

  it.each([
    [
      'a required companion is missing',
      async (): Promise<readonly BigEntryInput[]> => {
        const { model: modelBytes, skin: skinBytes } = await payloads()
        return [
          { path: 'data/editor/molds/bowl.w3d', bytes: modelBytes },
          { path: 'art/textures/other.tga', bytes: skinBytes, compress: true },
        ]
      },
    ],
    [
      'two candidates claim one slot',
      async (): Promise<readonly BigEntryInput[]> => {
        const { model: modelBytes, skin: skinBytes } = await payloads()
        return [
          { path: 'data/editor/molds/bowl.w3d', bytes: modelBytes },
          { path: 'art/textures/bowl.tga', bytes: skinBytes, compress: true },
          { path: 'art/textures/decoy/bowl.tga', bytes: skinBytes },
        ]
      },
    ],
  ])('gives the container back when %s', async (_label, entries) => {
    const { counted, nested } = await nestedOver(await entries(), 'data/editor/molds/bowl.w3d')
    expect(nested.result.state).toBe('unresolved')
    // nothing is left holding the archive: the failed child released what it took, before returning
    expect(counted.acquired()).toBe(1)
    expect(counted.released()).toBe(1)
    expect(counted.doubleRelease()).toBe(false)
  })
})

describe('the archive origin serves the scopes an entry actually has', () => {
  it.each([['current-mount'], ['enclosing-container']])(
    'resolves a companion asked for through %s',
    async scope => {
      const archive = await openArchive(await standardEntries())
      openSessions.push(archive)
      const { origin, counters, release } = await originOver(archive, 'data/editor/molds/bowl.w3d')
      try {
        const input = await createCompanionInputResolver(origin)({
          source: byteSource(new Uint8Array([0, 0, 0, 0]), 'entry'),
          plan: plan([scope], 'one'),
          detection: {
            codecId: 'org.example/nested-required',
            confidence: 1,
            evidence: [],
            requiredRanges: [],
          },
        })
        if (input.originKind === 'derived') throw new Error('unexpected derived input')
        expect(input.bindingsFor('skin').map(item => item.bindingId)).toEqual([
          'skin#art/textures/bowl.tga',
        ])
        expect(counters.opens).toBe(counters.releases)
        expect(counters.doubleRelease).toBe(false)
      } finally {
        await release()
      }
    },
  )

  it('refuses sibling-directory for an entry that has no directory', async () => {
    const archive = await openArchive(await standardEntries())
    openSessions.push(archive)
    const { origin, release } = await originOver(archive, 'data/editor/molds/bowl.w3d')
    try {
      const failing = () =>
        createCompanionInputResolver(origin)({
          source: byteSource(new Uint8Array([0, 0, 0, 0]), 'entry'),
          plan: plan(['sibling-directory'], 'one'),
          detection: {
            codecId: 'org.example/nested-required',
            confidence: 1,
            evidence: [],
            requiredRanges: [],
          },
        })
      expect(await codeOf(failing)).toBe(COMPANION_SCOPE_UNSUPPORTED)
    } finally {
      await release()
    }
  })

  it('cancels mid-resolution and leaves no container lease behind', async () => {
    const archive = await openArchive(await standardEntries())
    openSessions.push(archive)
    const { origin, counters, release } = await originOver(archive, 'data/editor/molds/bowl.w3d')
    try {
      const controller = new AbortController()
      const guarded = Object.freeze({
        ...origin,
        async *enumerate(scope: never, signal?: AbortSignal) {
          for await (const entry of origin.enumerate(scope, signal)) {
            controller.abort()
            yield entry
          }
        },
      })
      expect(
        await codeOf(() =>
          createCompanionInputResolver(guarded)({
            source: byteSource(new Uint8Array([0, 0, 0, 0]), 'entry'),
            plan: plan(['current-mount'], 'many'),
            detection: {
              codecId: 'org.example/nested-required',
              confidence: 1,
              evidence: [],
              requiredRanges: [],
            },
            signal: controller.signal,
          }),
        ),
      ).toBe(CANCELLED_CODE)
      expect(counters.opens).toBe(counters.releases)
      expect(counters.doubleRelease).toBe(false)
    } finally {
      await release()
    }
  })
})
