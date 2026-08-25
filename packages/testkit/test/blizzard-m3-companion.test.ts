/**
 * M3 texture companions — the same declaration reaching the same resolver from a container.
 *
 * M3 keeps its strings in `CHAR` sections and points at them from layer records. This codec reads
 * the string table rather than following that indirection, because a path ending in `.dds` is a
 * texture reference whichever layer points at it, and reading a string table is a fixed cost while
 * decoding layer records is not.
 *
 * The references are *paths* (`Assets/Textures/X.dds`), which is what makes them searchable: the
 * host matches a pattern containing `/` against the whole logical id and narrows the container's
 * listing to that directory. The env-gated case at the end measures exactly that on a live CASC of
 * 666,588 entries — and records, honestly, why the shipped model's texture is still not bound.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  artifactNamespaceSourceFromVfsMount,
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
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'm3-companion', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

// ---------------------------------------------------------------------------------------------
// a minimal MD34 with a string table

/**
 * The shipped `minimal.m3` fixture with a `CHAR` string table appended.
 *
 * Built on the real fixture rather than from scratch because the M3 header section carries a model
 * struct the geometry decoder reads; a hand-rolled header parses as a section index but decodes as
 * no model at all. Appending leaves that struct byte-for-byte intact and adds only the string table
 * this suite is about.
 */
let fixtureBytes: Uint8Array | undefined

async function buildM3(strings: readonly string[]): Promise<Uint8Array> {
  fixtureBytes ??= new Uint8Array(
    await readFile(join(import.meta.dirname, 'fixtures', 'mk2-synthetic', 'minimal.m3')),
  )
  const base = fixtureBytes
  const baseView = new DataView(base.buffer, base.byteOffset, base.byteLength)
  const baseIndexOffset = baseView.getUint32(4, true)
  const baseIndexCount = baseView.getUint32(8, true)

  const chars = new TextEncoder().encode(`${strings.join('\u0000')}\u0000`)
  const charOffset = baseIndexOffset
  const indexOffset = charOffset + chars.byteLength
  const count = baseIndexCount + 1
  const bytes = new Uint8Array(indexOffset + count * 16)
  const view = new DataView(bytes.buffer)
  // everything up to the original index — header plus the model struct — is carried over unchanged
  bytes.set(base.subarray(0, baseIndexOffset), 0)
  bytes.set(chars, charOffset)
  view.setUint32(4, indexOffset, true)
  view.setUint32(8, count, true)
  // the original section entries, then one CHAR entry pointing at the appended table
  bytes.set(base.subarray(baseIndexOffset, baseIndexOffset + baseIndexCount * 16), indexOffset)
  const at = indexOffset + baseIndexCount * 16
  for (let index = 0; index < 4; index += 1) bytes[at + index] = 'CHAR'.charCodeAt(3 - index)
  view.setUint32(at + 4, charOffset, true)
  view.setUint32(at + 8, 1, true)
  view.setUint32(at + 12, 0, true)
  return bytes
}

// ---------------------------------------------------------------------------------------------

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

const inventories = new Map<string, Inventory>()

async function inventory(parts: readonly (readonly string[])[]): Promise<Inventory> {
  const key = parts.map(item => item.join('/')).join('|')
  const cached = inventories.get(key)
  if (cached !== undefined) return cached
  const inputs = await Promise.all(
    parts.map(async item => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...item))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  const built = await buildInventory(inputs, createHostContributionContractRegistry())
  inventories.set(key, built)
  return built
}

const temporaries: string[] = []

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

interface M3Summary {
  readonly textureReferences: readonly { readonly value: string; readonly provenance: string }[]
  readonly textureBindings: readonly { readonly bindingId: string }[]
}

async function planFor(bytes: Uint8Array) {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'models', 'src', 'm3', 'codec.js')).href
  )) as { createCodec(context: unknown): import('@modkitx-x3/sdk').Codec }
  const uri = 'memory://m3/plan.m3'
  const codec = module.createCodec({
    budgets: budget,
    diagnostics: { report: () => undefined },
    contracts: {
      async resolve() {
        throw new Error('M3 has no service dependency')
      },
      async resolveUnknown() {
        throw new Error('M3 has no foreign service dependency')
      },
    },
  })
  let reads = 0
  const plan = await codec.planInput?.(
    {
      kind: 'bytes',
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:m3-plan'),
      size: BigInt(bytes.byteLength),
      async read(offset, length) {
        reads += 1
        return bytes.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        reads += 1
        yield bytes
      },
    },
    { codecId: 'org.modkitx/m3', confidence: 1, evidence: [], requiredRanges: [] },
    undefined,
  )
  return { plan, reads }
}

describe('an M3 declares the textures it names', () => {
  it('declares nothing and stays on the single path when it names no texture', async () => {
    const { plan, reads } = await planFor(await buildM3(['Stand', 'Ref_Center']))
    expect(plan).toMatchObject({ originKind: 'single', requirements: [] })
    // one bounded read of the front of the file, and nothing more
    expect(reads).toBe(1)
  })

  it('turns each texture path into an exact requirement pattern', async () => {
    const { plan, reads } = await planFor(
      await buildM3([
        'Assets/Textures/SM_HML_Artifact_diff512.dds',
        'Assets/Textures/SM_HML_Artifact_norm512.dds',
        // duplicates and non-texture strings are not references
        'Assets/Textures/SM_HML_Artifact_diff512.dds',
        '24 - Default',
      ]),
    )
    expect(plan).toMatchObject({ originKind: 'bundle' })
    const requirement = (
      plan as {
        readonly requirements: readonly {
          readonly patterns: readonly string[]
          readonly cardinality: string
          readonly required: boolean
        }[]
      }
    ).requirements[0]
    expect(requirement?.patterns).toEqual([
      'Assets/Textures/SM_HML_Artifact_diff512.dds',
      'Assets/Textures/SM_HML_Artifact_norm512.dds',
    ])
    expect(requirement).toMatchObject({ cardinality: 'many', required: false })
    expect(reads).toBe(1)
  })

  it.each([
    ['a parent traversal', '../../secrets/key.dds'],
    ['an absolute path', '/etc/shadow.dds'],
    ['a windows path', 'C:/Windows/thing.dds'],
    ['a url', 'https://example.invalid/x.dds'],
  ])('refuses a reference that is %s', async (_label, reference) => {
    const { plan } = await planFor(await buildM3([reference]))
    expect(plan).toMatchObject({ originKind: 'single', requirements: [] })
  })
})

describe('M3 textures resolved inside a container', () => {
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

  it('binds a texture the model names, out of the same archive, through current-mount', async () => {
    const { openNestedSubject } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'nested-subject.js')).href
    )) as typeof import('../../host/src/nested-subject.js')

    const texture = 'Assets/Textures/Hero_diff.dds'
    const model = await buildM3([texture])
    const archive = buildBig([
      { path: 'Assets/Models/hero.m3', bytes: model },
      { path: texture, bytes: new Uint8Array([0x44, 0x44, 0x53, 0x20]) },
      // a decoy the model does not name, to show the declaration is exact rather than by extension
      { path: 'Assets/Textures/Unrelated.dds', bytes: new Uint8Array([0]) },
    ])
    const uri = 'memory://m3-big/fixture.big'
    const source: ArtifactByteSource = Object.freeze({
      kind: 'bytes' as const,
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:m3-big'),
      size: BigInt(archive.byteLength),
      async read(offset: bigint, length: number) {
        return archive.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        yield archive
      },
    })
    const inventoryValue = await inventory([
      ['blizzard', 'models'],
      ['ea', 'big'],
    ])
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
      const page = await (lease.value as NamespaceEntrySource).list('', { limit: 20 })
      const entry = page.items.find(item => item.path === 'Assets/Models/hero.m3')
      await lease.release()
      if (entry === undefined) throw new Error('archive has no M3 entry')

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
      expect(nested.result.selected.contributionId).toBe('org.modkitx/m3')
      const inspected = await nested.result.session.operations().invoke('inspect', null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
      const summary = inspected.output.value as unknown as M3Summary
      expect(summary.textureReferences).toEqual([{ value: texture, provenance: 'companion' }])
      // exactly one binding: the decoy `.dds` beside it was never asked for
      expect(summary.textureBindings).toHaveLength(1)
      await nested.result.session.dispose()
    } finally {
      await opened.session.dispose()
    }
  })

  it('opens from a plain directory with the path-shaped reference unbound', async () => {
    /*
     * A consequence of the reference being a path, stated rather than hidden: the filesystem origin
     * serves exactly one confined directory, so `Assets/Textures/Hero_diff.dds` — which names a
     * location two levels down — cannot match a sibling. The model opens and reports the reference
     * as `reference-only`, which is the correct answer, not a failure.
     */
    const directory = await mkdtemp(join(tmpdir(), 'x3-m3-'))
    temporaries.push(directory)
    await writeFile(join(directory, 'hero.m3'), await buildM3(['Assets/Textures/Hero_diff.dds']))
    await writeFile(join(directory, 'Hero_diff.dds'), new Uint8Array([0x44, 0x44, 0x53, 0x20]))
    const subjects = createSubjectServices({
      inventory: await inventory([['blizzard', 'models']]),
      target,
      executionBackends,
    })
    const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
    const { snapshot, session } = await open(join(directory, 'hero.m3'))
    if (snapshot.state !== 'opened' || session === undefined) {
      throw new Error(JSON.stringify(snapshot.diagnostics))
    }
    const inspected = await session.operations().invoke('inspect', null)
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
    const summary = inspected.output.value as unknown as M3Summary
    expect(summary.textureReferences[0]).toMatchObject({ provenance: 'reference-only' })
    expect(summary.textureBindings).toEqual([])
    await session.dispose()
  })
})

describe('the installed StarCraft II M3', () => {
  const sc2Root = process.env['MODKITX_SC2_ROOT']?.trim()
  const installed = sc2Root !== undefined && existsSync(join(sc2Root, '.build.info'))
  const modelPath =
    'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'

  it.skipIf(!installed)(
    'opens as a nested subject, names its textures, and keeps the search bounded',
    async () => {
      if (sc2Root === undefined) throw new TypeError('MODKITX_SC2_ROOT is not set')
      const { openNestedSubject } = (await import(
        pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'nested-subject.js')).href
      )) as typeof import('../../host/src/nested-subject.js')

      const inventoryValue = await inventory([
        ['blizzard', 'casc'],
        ['blizzard', 'models'],
      ])
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
      const casc = await openSubject({
        inventory: inventoryValue,
        source: artifactNamespaceSourceFromVfsMount(mount),
        path: sc2Root,
        intent: 'full',
        target,
        grant,
        budget,
        executionBackends,
      })
      if (casc.state !== 'opened') throw new Error('CASC did not open')
      try {
        const nested = await openNestedSubject({
          parent: casc.session,
          entryId: modelPath,
          inventory: inventoryValue,
          executionBackends,
          target,
          grant,
          budget,
        })
        if (nested.result.state !== 'opened') {
          throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 400))
        }
        // the shipped M3 decoder, on an entry it never located or extracted itself
        expect(nested.result.selected.contributionId).toBe('org.modkitx/m3')
        const inspected = await nested.result.session.operations().invoke('inspect', null)
        if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
        const summary = inspected.output.value as unknown as M3Summary

        // the model does name real textures, read out of its own string table
        expect(summary.textureReferences.length).toBeGreaterThan(0)
        expect(summary.textureReferences.every(item => item.value.includes('/'))).toBe(true)

        /*
         * And here is the honest outcome, pinned so it cannot drift silently.
         *
         * The reference reads `Assets/Textures/SM_HML_Artifact_diff512.dds`; the file exists in
         * this very CASC at `mods/liberty.sc2mod/base.sc2assets/assets/textures/…`. The reference
         * is relative to a *mod root*, and the merged namespace prefixes every entry with the mod
         * that shipped it — a mod root the model itself does not name and this codec cannot derive,
         * because an archive entry's reference reaches it as an opaque id rather than its path.
         *
         * So the texture stays unbound: a named `reference-only` outcome, not a wrong binding and
         * not a silent 666,588-entry scan. Resolving it needs the `workspace-dependency-layer`
         * scope with a provider that knows SC2's mod dependency chain.
         */
        expect(summary.textureBindings).toEqual([])
        expect(summary.textureReferences.every(item => item.provenance === 'reference-only')).toBe(
          true,
        )
        console.info(
          `[sc2-live] M3 texture references ${summary.textureReferences.length}, bound ` +
            `${summary.textureBindings.length} (cross-mod-root, see comment)`,
        )

        /*
         * The same reference, now through the post-open `ResourceSessionPort` of slice 11C0.
         *
         * This is the part the pre-open seam structurally cannot do: the name comes out of the
         * model's own string table, so no input plan could have carried it. The port takes it as a
         * logical requirement and resolves it against the very same CASC namespace, with the same
         * confinement and the same bounded prefix listing the companion resolver uses.
         *
         * The verdict is expected to stay `reference-only` for the reason above — but it is now a
         * *typed* outcome with a coded reason and a provenance record instead of an absence, which
         * is the whole point of the port. Full resolution needs a game-mount provider that knows
         * SC2's mod dependency chain: blocks 12 and 15.
         */
        const { createNamespaceCompanionOrigin } = (await import(
          pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'namespace-origin.js')).href
        )) as typeof import('../../host/src/namespace-origin.js')
        const { createResourceSession, RESOURCE_NOT_FOUND } = (await import(
          pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'resource-session.js')).href
        )) as typeof import('../../host/src/resource-session.js')

        const namespaceLease = await casc.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        const cascRevision = (await casc.session.descriptor()).revision
        const resources = createResourceSession({
          origin: createNamespaceCompanionOrigin({
            namespace: namespaceLease.value,
            primaryLogicalId: modelPath,
            containerRevision: cascRevision,
            extract: async (entryId, signal) => {
              const payload = await casc.session
                .operations()
                .invoke('extract-entry', { entryId }, signal === undefined ? {} : { signal })
              if (payload.state !== 'ok' || payload.output.kind !== 'bytes') {
                throw new Error(`CASC extraction failed for ${entryId}`)
              }
              return payload.output.value
            },
          }),
          revision: cascRevision,
        })
        try {
          const reference = summary.textureReferences[0]?.value
          if (reference === undefined) throw new Error('the M3 named no texture')
          const first = await resources.resolve({
            id: 'texture-0',
            logicalId: reference,
            role: 'texture',
            scopes: ['current-mount', 'enclosing-container'],
          })
          // whichever way it goes, it is a named outcome carrying provenance — never an absence
          expect(first.provenance).toMatchObject({
            requirementId: 'texture-0',
            logicalId: reference,
            role: 'texture',
            cached: false,
          })
          if (first.state === 'unresolved') {
            expect(first.reason).toBe('not-found')
            expect(first.diagnostic.code).toBe(RESOURCE_NOT_FOUND)
            // a cross-mod-root reference is a fact about the corpus, not a defect in the model
            expect(first.diagnostic.severity).toBe('information')
          } else {
            expect(first.revision).toBe(first.lease.value.revision)
            await first.lease.release()
          }

          // the budget is spent once: asking again is served from the session index, hit or miss
          const repeat = await resources.resolve({
            id: 'texture-0-again',
            logicalId: reference,
            role: 'texture',
            scopes: ['current-mount', 'enclosing-container'],
          })
          expect(repeat.provenance.cached).toBe(true)
          expect(repeat.state).toBe(first.state)
          if (repeat.state === 'resolved') await repeat.lease.release()

          expect(resources.provenance()).toHaveLength(2)
          console.info(
            `[sc2-live] ResourceSessionPort «${reference}»: ${first.state}` +
              (first.state === 'unresolved' ? ` (${first.reason})` : ''),
          )
        } finally {
          // nested so a throwing dispose cannot strand the container lease behind it
          try {
            await resources.dispose()
          } finally {
            await namespaceLease.release()
          }
        }
        expect(resources.state()).toBe('disposed')

        await nested.result.session.dispose()
      } finally {
        await casc.session.dispose()
      }
    },
    300_000,
  )
})
