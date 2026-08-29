/**
 * The third container: MPQ, and — where the corpus is installed — a real StarCraft II CASC.
 *
 * Root's §3.1 makes this the acceptance test of the whole companion facility, not another case:
 * filesystem, BIG and CASC/MPQ must go through *one* resolver with no format branching inside it.
 * A second container that needed its own branch would mean the abstraction was wrong and had to be
 * redone before any codec deepening — so the interesting result of this suite is not that MPQ works
 * but that making it work required no format knowledge anywhere in the resolution path.
 *
 * The synthetic half is deliberately built from the *same* fixture codec and the *same* requirement
 * the BIG suite uses, over an archive of a completely different format. Nothing is re-declared:
 * identical codec, identical companion rule, identical `openNestedSubject`, different container.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { productExtensionDirectory } from '../../../scripts/lib/external-extension-roots.mjs'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
  type Inventory,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetSession,
  type NamespaceEntrySource,
  type PageRequest,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { openNestedSubject } from '../src/nested-subject.js'
import { createNamespaceCompanionOrigin } from '../src/namespace-origin.js'
import {
  COMPANION_AMBIGUOUS,
  COMPANION_BUDGET_EXCEEDED,
  createCompanionInputResolver,
} from '../src/input-resolution.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
const nestedExtension = join(import.meta.dirname, 'fixtures', 'companion-namespace-extension')

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'nested-blizzard', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

// ---------------------------------------------------------------------------------------------
// a real MPQ, assembled in memory

/**
 * MPQ's key schedule, as the shipped codec implements it in reverse.
 *
 * Duplicated here rather than imported on purpose: a fixture built with the reader's own helpers
 * proves only that the reader agrees with itself. Written out from the format, it proves the reader
 * parses an archive it did not produce.
 */
const cryptTable = (() => {
  let seed = 0x00100001
  const table: number[] = []
  for (let slot = 0; slot < 0x100; slot += 1) {
    let index = slot
    for (let round = 0; round < 5; round += 1) {
      seed = (seed * 125 + 3) % 0x2aaaab
      const high = (seed & 0xffff) << 16
      seed = (seed * 125 + 3) % 0x2aaaab
      table[index] = (high | (seed & 0xffff)) >>> 0
      index += 0x100
    }
  }
  return table
})()

const HASH_TABLE_OFFSET = 0
const HASH_A = 1
const HASH_B = 2
const HASH_TABLE = 3

function mpqHash(input: string, type: number): number {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee
  for (const original of new TextEncoder().encode(input)) {
    const value = original >= 0x61 && original <= 0x7a ? original - 0x20 : original
    const encrypted = cryptTable[((type << 8) + value) & 0x3ff] as number
    seed1 = (encrypted ^ (seed1 + seed2)) >>> 0
    seed2 = (value + seed1 + seed2 + (seed2 << 5) + 3) >>> 0
  }
  return seed1 >>> 0
}

/** The exact inverse of the codec's `decrypt`: both seed updates consume the *plain* word. */
function encrypt(data: Uint8Array, key: number): Uint8Array {
  let seed1 = key >>> 0
  let seed2 = 0xeeeeeeee
  const out = data.slice()
  const source = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  for (let index = 0; index < Math.floor(data.byteLength / 4); index += 1) {
    seed2 = (seed2 + (cryptTable[0x400 + (seed1 & 0xff)] as number)) >>> 0
    const plain = source.getUint32(index * 4, true)
    view.setUint32(index * 4, (plain ^ ((seed1 + seed2) >>> 0)) >>> 0, true)
    seed1 = (((~seed1 << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0
    seed2 = (plain + seed2 + (seed2 << 5) + 3) >>> 0
  }
  return out
}

const FILE_EXISTS = 0x80000000
const FILE_SINGLE_UNIT = 0x01000000

interface MpqEntryInput {
  readonly path: string
  readonly bytes: Uint8Array
}

/** A version-0 MPQ with uncompressed single-unit entries and a `(listfile)` that names them. */
function buildMpq(entries: readonly MpqEntryInput[]): Uint8Array {
  const encoder = new TextEncoder()
  const listfile = encoder.encode(
    `${entries.map(entry => entry.path.replaceAll('/', '\\')).join('\r\n')}\r\n`,
  )
  const files = [...entries.map(e => ({ ...e })), { path: '(listfile)', bytes: listfile }]

  const HEADER = 32
  let cursor = HEADER
  const placed = files.map(file => {
    const at = cursor
    cursor += file.bytes.byteLength
    return { ...file, offset: at }
  })
  // a power of two, with slack so linear probing always terminates
  let hashEntries = 4
  while (hashEntries < placed.length * 2) hashEntries *= 2
  const hashOffset = cursor
  const blockOffset = hashOffset + hashEntries * 16
  const total = blockOffset + placed.length * 16

  const archive = new Uint8Array(total)
  const view = new DataView(archive.buffer)
  archive.set(encoder.encode('MPQ\u001a'), 0)
  view.setUint32(4, HEADER, true)
  view.setUint32(8, total, true)
  view.setUint16(12, 0, true) // format version 0
  view.setUint16(14, 3, true) // sector shift; unused for single-unit entries
  view.setUint32(16, hashOffset, true)
  view.setUint32(20, blockOffset, true)
  view.setUint32(24, hashEntries, true)
  view.setUint32(28, placed.length, true)

  const hashPlain = new Uint8Array(hashEntries * 16)
  const hashView = new DataView(hashPlain.buffer)
  for (let slot = 0; slot < hashEntries; slot += 1) {
    hashView.setUint32(slot * 16 + 12, 0xffffffff, true) // empty, never used
  }
  const blockPlain = new Uint8Array(placed.length * 16)
  const blockView = new DataView(blockPlain.buffer)

  placed.forEach((file, index) => {
    archive.set(file.bytes, file.offset)
    blockView.setUint32(index * 16, file.offset, true)
    blockView.setUint32(index * 16 + 4, file.bytes.byteLength, true)
    blockView.setUint32(index * 16 + 8, file.bytes.byteLength, true)
    blockView.setUint32(index * 16 + 12, (FILE_EXISTS | FILE_SINGLE_UNIT) >>> 0, true)

    const key = file.path.replaceAll('/', '\\')
    let slot = mpqHash(key, HASH_TABLE_OFFSET) % hashEntries
    while (hashView.getUint32(slot * 16 + 12, true) !== 0xffffffff) {
      slot = (slot + 1) % hashEntries
    }
    hashView.setUint32(slot * 16, mpqHash(key, HASH_A), true)
    hashView.setUint32(slot * 16 + 4, mpqHash(key, HASH_B), true)
    hashView.setUint16(slot * 16 + 8, 0, true) // locale
    hashView.setUint16(slot * 16 + 10, 0, true) // platform
    hashView.setUint32(slot * 16 + 12, index, true)
  })

  archive.set(encrypt(hashPlain, mpqHash('(hash table)', HASH_TABLE)), hashOffset)
  archive.set(encrypt(blockPlain, mpqHash('(block table)', HASH_TABLE)), blockOffset)
  return archive
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://nested-blizzard/${name}`
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

async function inventoryOf(directories: readonly (readonly string[])[]): Promise<Inventory> {
  const inputs = await Promise.all(
    directories.map(async parts => ({
      ...(await loadExtensionDirectory(
        parts[0] === 'fixture' ? nestedExtension : productExtensionDirectory(repoRoot, parts),
      )),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  return buildInventory(inputs, createHostContributionContractRegistry())
}

async function entriesOf(session: AssetSession, limit = 1000): Promise<readonly string[]> {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  try {
    const namespace = lease.value as NamespaceEntrySource
    const paths: string[] = []
    let cursor: string | undefined
    do {
      const page = await namespace.list('', {
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })
      paths.push(...page.items.map(item => item.path))
      cursor = page.nextCursor
    } while (cursor !== undefined)
    return paths
  } finally {
    await lease.release()
  }
}

describe('CASC — the installed StarCraft II namespace', () => {
  const sc2Root = process.env['MODKITX_SC2_ROOT']?.trim()
  const buildInfo = sc2Root === undefined ? undefined : join(sc2Root, '.build.info')
  const installed = buildInfo !== undefined && existsSync(buildInfo)

  /** The product ingress the SC2 corpus suites already use: a file VFS mount opened as a subject. */
  async function openCasc(inventory: Inventory): Promise<AssetSession> {
    if (sc2Root === undefined) throw new TypeError('MODKITX_SC2_ROOT is not set')
    const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
    const result = await openSubject({
      inventory,
      source: artifactNamespaceSourceFromVfsMount(mount),
      path: sc2Root,
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (result.state !== 'opened') {
      throw new Error(`CASC open failed: ${JSON.stringify(result.diagnostics).slice(0, 400)}`)
    }
    expect(result.selected.contributionId).toBe('org.modkitx/casc')
    return result.session
  }

  const assets = 'campaigns/liberty.sc2campaign/base.sc2assets/assets'
  const modelPath = `${assets}/campaign/terran/artifact1/artifact1.m3`
  const texturePath = `${assets}/textures/alpha2.dds`

  it.skipIf(!installed)(
    'opens a real M3 entry as its own subject through the same route',
    async () => {
      const inventory = await inventoryOf([
        ['blizzard', 'casc'],
        ['blizzard', 'models'],
      ])
      const casc = await openCasc(inventory)
      try {
        const { result, entry } = await openNestedSubject({
          parent: casc,
          entryId: modelPath,
          inventory,
          executionBackends,
          target,
          grant,
          budget,
        })
        expect(entry.path).toBe(modelPath)
        if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
        // the shipping M3 decoder, on an entry it never had to locate or extract itself
        expect(result.selected.contributionId).toBe('org.modkitx/m3')
        await result.session.dispose()
      } finally {
        await casc.dispose()
      }
    },
    300_000,
  )

  it.skipIf(!installed)(
    'resolves a texture companion inside the merged CASC namespace, under budget',
    async () => {
      /*
       * The point of the SC2 case, and the reason Root required a second archive system.
       *
       * Unlike Command & Conquer — where the models are in Misc.big and the textures are in
       * Terrain.big, so `current-mount` structurally cannot reach them — StarCraft II merges
       * everything into one CASC namespace, and `current-mount` therefore must reach a model's
       * texture. It does. What makes that possible under a 4096-entry budget is the prefix the
       * resolver derives from the requirement's own patterns: this namespace lists 666,588 entries,
       * and a requirement naming a directory reads a few hundred instead of all of them.
       */
      const inventory = await inventoryOf([['blizzard', 'casc']])
      const casc = await openCasc(inventory)
      const namespaceLease = await casc.dataSource('common.view/namespace-entry-source', 1)
      let enumerated = 0
      try {
        const namespace = namespaceLease.value as NamespaceEntrySource
        const origin = createNamespaceCompanionOrigin({
          namespace: Object.freeze({
            async list(prefix: string, page: PageRequest, signal?: AbortSignal) {
              const result = await namespace.list(prefix, page, signal)
              enumerated += result.items.length
              return result
            },
            openEntry: (entryId: string, signal?: AbortSignal) =>
              namespace.openEntry(entryId, signal),
          }) as NamespaceEntrySource,
          primaryLogicalId: modelPath,
          containerRevision: (await casc.descriptor()).revision,
          extract: async (entryId, signal) => {
            const invoked = await casc
              .operations()
              .invoke('extract-entry', { entryId }, signal === undefined ? {} : { signal })
            if (invoked.state !== 'ok' || invoked.output.kind !== 'bytes') {
              throw new Error(`CASC extraction failed for ${entryId}`)
            }
            return invoked.output.value
          },
        })

        const input = await createCompanionInputResolver(origin)({
          source: byteSource(new Uint8Array([0x33, 0x44, 0x4d, 0x4f]), 'artifact1.m3'),
          plan: {
            originKind: 'bundle',
            candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
            requirements: [
              {
                id: 'skin',
                role: 'texture',
                ownership: 'companion',
                // a path-qualified pattern: the codec says where its textures live, and the host
                // turns that into a bounded listing instead of a 666k-entry walk
                patterns: [`${assets}/textures/alpha2.dds`],
                scopes: ['current-mount'],
                cardinality: 'one',
                required: true,
              },
            ],
          } as never,
          detection: {
            codecId: 'org.modkitx/m3',
            confidence: 1,
            evidence: [],
            requiredRanges: [],
          },
        })
        if (input.originKind === 'derived') throw new Error('unexpected derived input')
        expect(input.bindingsFor('skin').map(item => item.bindingId)).toEqual([
          `skin#${texturePath}`,
        ])

        /*
         * Bounded to the point of being cheap: an exact-path pattern narrows the container listing
         * to the entry itself, so resolving this companion reads a couple of entries out of
         * 666,588. Pinned tightly on purpose — if a future change re-lists a directory (4,100
         * entries here) or the whole namespace, this number moves and says so.
         */
        expect(enumerated).toBeLessThan(16)
        console.info(`[sc2-live] CASC companion resolved after ${enumerated} listed entries`)

        const lease = await input.openBinding(`skin#${texturePath}`)
        try {
          if (lease.value.kind !== 'bytes') throw new Error('texture is not a byte source')
          const head = await lease.value.read(0n, 4)
          expect(new TextDecoder().decode(head)).toBe('DDS ')
        } finally {
          await lease.release()
        }
      } finally {
        await namespaceLease.release()
        await casc.dispose()
      }
    },
    300_000,
  )

  it.skipIf(!installed)(
    'refuses a name-only requirement over a namespace too large to scan',
    async () => {
      /*
       * The other side of the same coin, and the reason the budget is not merely decorative: a
       * requirement that declares only a bare filename gives the host nowhere to narrow to, so the
       * search would be the whole 666k-entry index. That ends in a named refusal, not a slow scan.
       */
      const inventory = await inventoryOf([['blizzard', 'casc']])
      const casc = await openCasc(inventory)
      const namespaceLease = await casc.dataSource('common.view/namespace-entry-source', 1)
      try {
        const origin = createNamespaceCompanionOrigin({
          namespace: namespaceLease.value as NamespaceEntrySource,
          primaryLogicalId: modelPath,
          containerRevision: (await casc.descriptor()).revision,
          extract: async () => {
            throw new Error('the refusal must happen before any extraction')
          },
        })
        let code = 'no-error'
        try {
          await createCompanionInputResolver(origin)({
            source: byteSource(new Uint8Array([0x33, 0x44, 0x4d, 0x4f]), 'artifact1.m3'),
            plan: {
              originKind: 'bundle',
              candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
              requirements: [
                {
                  id: 'skin',
                  role: 'texture',
                  ownership: 'companion',
                  patterns: ['alpha2.dds'],
                  scopes: ['current-mount'],
                  cardinality: 'one',
                  required: true,
                },
              ],
            } as never,
            detection: {
              codecId: 'org.modkitx/m3',
              confidence: 1,
              evidence: [],
              requiredRanges: [],
            },
          })
        } catch (error) {
          code = (error as { readonly code?: string }).code ?? String(error)
        }
        expect(code).toBe(COMPANION_BUDGET_EXCEEDED)
      } finally {
        await namespaceLease.release()
        await casc.dispose()
      }
    },
    300_000,
  )
})

describe('a container inside a container, through one route twice', () => {
  const sc2Root = process.env['MODKITX_SC2_ROOT']?.trim()
  const installed = sc2Root !== undefined && existsSync(join(sc2Root, '.build.info'))
  const mpqEntry =
    'mods/liberty.sc2mod/base.sc2data/battlenetcache/' +
    'fc2161abf876306f1a0467cfacf5e513cba4281fdc13532b440e8c8abb8835ac.s2ma'

  it.skipIf(!installed)(
    'opens an MPQ out of CASC, then a texture out of that MPQ',
    async () => {
      /*
       * Two levels, one function, and — the part worth checking — one lease chain. The MPQ subject
       * holds the CASC listing for as long as it lives; the texture subject holds the MPQ's. Nobody
       * wrote nesting logic for this: `openNestedSubject` asks a parent for an entry listing and a
       * bounded extraction, and an MPQ that came out of a CASC answers both exactly as the CASC did.
       */
      if (sc2Root === undefined) throw new TypeError('MODKITX_SC2_ROOT is not set')
      const inventory = await inventoryOf([
        ['blizzard', 'casc'],
        ['blizzard', 'mpq'],
        ['common', 'images'],
      ])
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
      const opened = await openSubject({
        inventory,
        source: artifactNamespaceSourceFromVfsMount(mount),
        path: sc2Root,
        intent: 'full',
        target,
        grant,
        budget,
        executionBackends,
      })
      if (opened.state !== 'opened') throw new Error('CASC did not open')
      try {
        const archive = await openNestedSubject({
          parent: opened.session,
          entryId: mpqEntry,
          inventory,
          executionBackends,
          target,
          grant,
          budget,
        })
        if (archive.result.state !== 'opened') {
          throw new Error(JSON.stringify(archive.result.diagnostics).slice(0, 400))
        }
        expect(archive.result.selected.contributionId).toBe('org.modkitx/mpq')
        try {
          const inner = await entriesOf(archive.result.session)
          const dds = inner.find(path => /\.dds$/iu.test(path))
          if (dds === undefined) throw new Error(`MPQ ${mpqEntry} holds no DDS`)

          const texture = await openNestedSubject({
            parent: archive.result.session,
            entryId: dds,
            inventory,
            executionBackends,
            target,
            grant,
            budget,
          })
          if (texture.result.state !== 'opened') {
            throw new Error(JSON.stringify(texture.result.diagnostics).slice(0, 400))
          }
          expect(texture.result.descriptor).toMatchObject({ identity: { formatId: 'dds' } })
          console.info(`[sc2-live] CASC → MPQ → ${dds} opened through one nested route`)
          await texture.result.session.dispose()
        } finally {
          await archive.result.session.dispose()
        }
      } finally {
        await opened.session.dispose()
      }
    },
    300_000,
  )
})

describe('MPQ — the third container through the same resolver', () => {
  async function openMpq(): Promise<{
    readonly session: AssetSession
    readonly inventory: Inventory
  }> {
    const model = new Uint8Array(await readFile(join(syntheticDir, 'minimal.westwood.w3d')))
    const skin = new Uint8Array(await readFile(join(syntheticDir, 'minimal.tga')))
    /*
     * The same entry names, the same payloads and the same fixture codec as the BIG suite. Only
     * the container is different, which is the entire claim being tested.
     */
    const archive = buildMpq([
      { path: 'data/editor/molds/bowl.w3d', bytes: model },
      { path: 'art/textures/bowl.tga', bytes: skin },
      { path: 'art/textures/other.tga', bytes: skin },
    ])
    const inventory = await inventoryOf([['blizzard', 'mpq'], ['fixture']])
    const result = await openSubject({
      inventory,
      source: byteSource(archive, 'fixture.mpq'),
      path: 'fixture.mpq',
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (result.state !== 'opened') {
      throw new Error(`the MPQ fixture did not open: ${JSON.stringify(result.diagnostics)}`)
    }
    expect(result.selected.contributionId).toBe('org.modkitx/mpq')
    return { session: result.session, inventory }
  }

  it('opens an MPQ entry as its own subject and binds its companion from the same archive', async () => {
    const { session, inventory } = await openMpq()
    try {
      const paths = await entriesOf(session)
      expect(paths).toContain('data/editor/molds/bowl.w3d')

      const { result, entry } = await openNestedSubject({
        parent: session,
        entryId: 'data/editor/molds/bowl.w3d',
        inventory,
        executionBackends,
        target,
        grant,
        budget,
      })
      expect(entry.path).toBe('data/editor/molds/bowl.w3d')
      if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
      // the very codec the BIG suite exercises, unchanged, over a Blizzard container
      expect(result.selected.contributionId).toBe('org.example/nested-required')

      const inspected = await result.session.operations().invoke('inspect', {})
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
      const summary = inspected.output.value as {
        readonly skin: readonly number[] | null
        readonly boundBindingIds: readonly string[]
      }
      const skin = new Uint8Array(await readFile(join(syntheticDir, 'minimal.tga')))
      expect(summary.skin).toEqual(Array.from(skin))
      expect(summary.boundBindingIds).toEqual(['skin#art/textures/bowl.tga'])
      await result.session.dispose()
    } finally {
      await session.dispose()
    }
  })

  it('refuses an ambiguous companion inside an MPQ exactly as it does inside a BIG', async () => {
    const model = new Uint8Array(await readFile(join(syntheticDir, 'minimal.westwood.w3d')))
    const skin = new Uint8Array(await readFile(join(syntheticDir, 'minimal.tga')))
    const archive = buildMpq([
      { path: 'data/editor/molds/bowl.w3d', bytes: model },
      { path: 'art/textures/bowl.tga', bytes: skin },
      { path: 'art/textures/decoy/bowl.tga', bytes: skin },
    ])
    const inventory = await inventoryOf([['blizzard', 'mpq'], ['fixture']])
    const opened = await openSubject({
      inventory,
      source: byteSource(archive, 'ambiguous.mpq'),
      path: 'ambiguous.mpq',
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (opened.state !== 'opened') throw new Error('the ambiguous MPQ fixture did not open')
    try {
      const { result } = await openNestedSubject({
        parent: opened.session,
        entryId: 'data/editor/molds/bowl.w3d',
        inventory,
        executionBackends,
        target,
        grant,
        budget,
      })
      expect(result.state).toBe('unresolved')
      expect(result.diagnostics.map(item => item.code)).toContain(COMPANION_AMBIGUOUS)
    } finally {
      await opened.session.dispose()
    }
  })
})
