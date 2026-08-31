/** Generic nested-container and large-namespace contracts over synthetic in-memory ZIPs. */
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { isModkitError } from '@modkitx-x3/core'
import {
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
import { openNestedSubject } from '../src/nested-subject.js'
import { createNamespaceCompanionOrigin } from '../src/namespace-origin.js'
import { COMPANION_BUDGET_EXCEEDED, createCompanionInputResolver } from '../src/input-resolution.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const archiveExtension = join(repoRoot, 'extensions', 'archives')
const nestedExtension = join(import.meta.dirname, 'fixtures', 'companion-namespace-extension')
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'generic-nested-containers', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 16_000_000n,
  maxDepth: 32,
  maxNodes: 10_000,
  maxScalarBytes: 16_000_000,
  maxDiagnostics: 100,
}
const MODEL_BYTES = new TextEncoder().encode('MESH\u0000nested-container-geometry')
const TEXTURE_BYTES = new TextEncoder().encode('TEXTURE\u0000nested-container-pixels')

interface ZipEntryInput {
  readonly path: string
  readonly bytes: Uint8Array
  readonly compress?: boolean
}

/** Independent classic-ZIP writer with stored and raw-deflate entries. */
function buildZip(entries: readonly ZipEntryInput[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const plain = Buffer.from(entry.bytes)
    const payload = entry.compress === true ? deflateRawSync(plain) : plain
    const method = entry.compress === true ? 8 : 0
    const checksum = crc32(plain)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(plain.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, payload)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(plain.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + payload.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, eocd]))
}

function byteSource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://generic-nested/${name}`
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

let inventoryPromise: Promise<Inventory> | undefined
function inventory(): Promise<Inventory> {
  inventoryPromise ??= Promise.all(
    [archiveExtension, nestedExtension].map(async directory => ({
      ...(await loadExtensionDirectory(directory)),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  ).then(inputs => buildInventory(inputs, createHostContributionContractRegistry()))
  return inventoryPromise
}

async function openZip(entries: readonly ZipEntryInput[], name: string): Promise<AssetSession> {
  const result = await openSubject({
    inventory: await inventory(),
    source: byteSource(buildZip(entries), name),
    path: name,
    intent: 'full',
    target,
    grant,
    budget,
    executionBackends,
  })
  if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
  expect(result.selected.contributionId).toBe('org.modkitx/archive-zip')
  return result.session
}

async function entryIdOf(session: AssetSession, path: string): Promise<string> {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  try {
    const page = await (lease.value as NamespaceEntrySource).list(path, { limit: 32 })
    const entry = page.items.find(item => item.path === path)
    if (entry === undefined) throw new Error(`fixture ZIP has no ${path}`)
    return entry.id
  } finally {
    await lease.release()
  }
}

async function originOver(session: AssetSession, primaryLogicalId: string) {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  const namespace = lease.value as NamespaceEntrySource
  let listed = 0
  const counted: NamespaceEntrySource = Object.freeze({
    async list(prefix: string, page: PageRequest, signal?: AbortSignal) {
      const result = await namespace.list(prefix, page, signal)
      listed += result.items.length
      return result
    },
    openEntry: (entryId: string, signal?: AbortSignal) => namespace.openEntry(entryId, signal),
  })
  return {
    origin: createNamespaceCompanionOrigin({
      namespace: counted,
      primaryLogicalId,
      containerRevision: (await session.descriptor()).revision,
      extract: async (entryId: string, signal?: AbortSignal) => {
        const result = await session
          .operations()
          .invoke('extract-entry', { entryId }, signal === undefined ? {} : { signal })
        if (result.state !== 'ok' || result.output.kind !== 'bytes') {
          throw new Error(`ZIP extraction failed for ${entryId}`)
        }
        return result.output.value
      },
    }),
    listed: () => listed,
    release: () => lease.release(),
  }
}

function resolutionContext(pattern: string) {
  return {
    source: byteSource(MODEL_BYTES, 'primary.mesh'),
    plan: {
      originKind: 'bundle' as const,
      candidate: { bindingId: 'content', role: 'content', ownership: 'owned' as const },
      requirements: [
        {
          id: 'skin',
          role: 'texture',
          ownership: 'companion',
          patterns: [pattern],
          scopes: ['current-mount'],
          cardinality: 'one',
          required: true,
        },
      ],
    } as never,
    detection: {
      codecId: 'org.example/nested-required',
      confidence: 1,
      evidence: [],
      requiredRanges: [],
    },
  }
}

describe('a container inside another container uses the same nested route twice', () => {
  it('opens ZIP → ZIP → mesh and resolves the companion from the inner namespace', async () => {
    const inner = buildZip([
      { path: 'assets/models/cube.mesh', bytes: MODEL_BYTES },
      { path: 'assets/textures/cube.texture', bytes: TEXTURE_BYTES, compress: true },
    ])
    const outer = await openZip(
      [
        { path: 'bundles/content.zip', bytes: inner },
        { path: 'notes/readme.txt', bytes: new TextEncoder().encode('neutral fixture') },
      ],
      'outer.zip',
    )
    try {
      const nestedArchive = await openNestedSubject({
        parent: outer,
        entryId: await entryIdOf(outer, 'bundles/content.zip'),
        inventory: await inventory(),
        executionBackends,
        target,
        grant,
        budget,
      })
      if (nestedArchive.result.state !== 'opened') {
        throw new Error(JSON.stringify(nestedArchive.result.diagnostics))
      }
      expect(nestedArchive.result.selected.contributionId).toBe('org.modkitx/archive-zip')
      try {
        const mesh = await openNestedSubject({
          parent: nestedArchive.result.session,
          entryId: await entryIdOf(nestedArchive.result.session, 'assets/models/cube.mesh'),
          inventory: await inventory(),
          executionBackends,
          target,
          grant,
          budget,
        })
        if (mesh.result.state !== 'opened') throw new Error(JSON.stringify(mesh.result.diagnostics))
        expect(mesh.result.selected.contributionId).toBe('org.example/nested-required')
        const inspected = await mesh.result.session.operations().invoke('inspect', {})
        if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
          throw new Error('nested mesh did not inspect')
        }
        expect((inspected.output.value as { skin: readonly number[] }).skin).toEqual(
          Array.from(TEXTURE_BYTES),
        )
        await mesh.result.session.dispose()
      } finally {
        await nestedArchive.result.session.dispose()
      }
    } finally {
      await outer.dispose()
    }
  })
})

describe('large namespace companion resolution remains bounded', () => {
  const crowdedEntries = (): readonly ZipEntryInput[] => [
    ...Array.from({ length: 4097 }, (_, index) => ({
      path: `bulk/${String(index).padStart(4, '0')}/item.bin`,
      bytes: new Uint8Array([index & 0xff]),
    })),
    { path: 'assets/models/cube.mesh', bytes: MODEL_BYTES },
    { path: 'assets/textures/cube.texture', bytes: TEXTURE_BYTES },
  ]

  it('uses a path-qualified pattern to list only the exact companion', async () => {
    const archive = await openZip(crowdedEntries(), 'qualified.zip')
    const { origin, listed, release } = await originOver(archive, 'assets/models/cube.mesh')
    try {
      const input = await createCompanionInputResolver(origin)(
        resolutionContext('assets/textures/cube.texture'),
      )
      if (input.originKind === 'derived') throw new Error('unexpected derived input')
      expect(input.bindingsFor('skin').map(item => item.bindingId)).toEqual([
        'skin#assets/textures/cube.texture',
      ])
      expect(listed()).toBeLessThan(4)
      const lease = await input.openBinding('skin#assets/textures/cube.texture')
      try {
        if (lease.value.kind !== 'bytes') throw new Error('companion is not bytes')
        expect(await lease.value.read(0n, TEXTURE_BYTES.byteLength)).toEqual(TEXTURE_BYTES)
      } finally {
        await lease.release()
      }
    } finally {
      await release()
      await archive.dispose()
    }
  })

  it('refuses a name-only requirement before an unbounded scan can complete', async () => {
    const archive = await openZip(crowdedEntries(), 'unqualified.zip')
    const { origin, listed, release } = await originOver(archive, 'assets/models/cube.mesh')
    try {
      let code = 'no-error'
      try {
        await createCompanionInputResolver(origin)(resolutionContext('cube.texture'))
      } catch (error) {
        code = isModkitError(error) ? error.code : String(error)
      }
      expect(code).toBe(COMPANION_BUDGET_EXCEEDED)
      expect(listed()).toBeGreaterThan(4096)
    } finally {
      await release()
      await archive.dispose()
    }
  })
})
