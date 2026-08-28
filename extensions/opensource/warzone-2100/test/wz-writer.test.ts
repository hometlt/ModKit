import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from 'modkit-extension-x3-archives/formats/zip/codec'
import {
  revisionId,
  type ChangeSet,
  type ContributionContext,
  type ResourceBudget,
  type Writer,
} from '@modkitx-x3/sdk'
import { parseWarzoneGameMap } from '../src/warzone2100-map/format.js'
import {
  createProvider,
  snapshotWarzoneWzGameMap,
  WARZONE_WZ_GAME_MAP_WRITE_INTENT,
} from '../src/warzone-wz/writer.js'

const ENTRY = 'multiplay/maps/2c-fixture/game.map'
const SOURCE = Object.freeze({ id: 'root', uri: 'memory://warzone/save-as/' })
const budget: ResourceBudget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 100,
}
const identity = Object.freeze({
  providerId: 'org.modkitx.opensource/warzone2100-wz-writer',
  providerVersion: '0.1.0',
  artifactDigest: `sha256:${'0'.repeat(64)}`,
})

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

function context(budgets: ResourceBudget = budget): ContributionContext {
  return {
    budgets,
    providerIdentity: identity,
    diagnostics: { report: () => undefined },
    contracts: {
      async resolve() {
        throw new Error('WZ writer has no service dependency')
      },
      async resolveUnknown() {
        throw new Error('WZ writer has no foreign service dependency')
      },
    },
  }
}

function gameMapFixture(): Uint8Array {
  const width = 3
  const height = 2
  const gatewayOffset = 16 + width * height * 3
  const bytes = new Uint8Array(gatewayOffset + 8 + 4 + 3)
  bytes.set([0x6d, 0x61, 0x70, 0x20])
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 10, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  for (let index = 0; index < width * height; index += 1) {
    const offset = 16 + index * 3
    view.setUint16(offset, 100 + index, true)
    view.setUint8(offset + 2, index + 1)
  }
  view.setUint32(gatewayOffset, 1, true)
  view.setUint32(gatewayOffset + 4, 1, true)
  bytes.set([0, 0, 2, 0], gatewayOffset + 8)
  bytes.set([0xde, 0xad, 0xbe], gatewayOffset + 12)
  return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function storedZip(
  entries: readonly {
    readonly name: string
    readonly bytes: Uint8Array
    readonly flags?: number
    readonly method?: number
  }[],
): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let localOffset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.bytes)
    const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, entry.flags ?? 0, true)
    localView.setUint16(8, entry.method ?? 0, true)
    localView.setUint16(10, 0, true)
    localView.setUint16(12, 33, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, entry.bytes.byteLength, true)
    localView.setUint32(22, entry.bytes.byteLength, true)
    localView.setUint16(26, name.byteLength, true)
    localView.setUint16(28, 0, true)
    local.set(name, 30)
    local.set(entry.bytes, 30 + name.byteLength)

    const central = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, entry.flags ?? 0, true)
    centralView.setUint16(10, entry.method ?? 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 33, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.bytes.byteLength, true)
    centralView.setUint32(24, entry.bytes.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, localOffset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    localOffset += local.byteLength
  }
  const centralOffset = localOffset
  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0)
  const eocd = new Uint8Array(22)
  const view = new DataView(eocd.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, entries.length, true)
  view.setUint16(10, entries.length, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, centralOffset, true)
  return concat([...locals, ...centrals, eocd])
}

function fixture(
  extraEntries: readonly {
    name: string
    bytes: Uint8Array
    flags?: number
    method?: number
  }[] = [],
) {
  const map = gameMapFixture()
  return {
    map,
    archive: storedZip([
      { name: 'ruleset.json', bytes: new TextEncoder().encode('{"type":"skirmish"}') },
      { name: ENTRY, bytes: map },
      { name: 'multiplay/maps/2c-fixture/struct.json', bytes: new TextEncoder().encode('{}') },
      ...extraEntries,
    ]),
  }
}

function writer(budgets: ResourceBudget = budget): Writer {
  return createProvider(
    {
      contract: 'common.edit/writer',
      major: 1,
      offerId: 'warzone2100-wz-game-map-source',
    } as never,
    context(budgets),
  ).value as Writer
}

function change(
  archive: Uint8Array,
  map: Uint8Array,
  updates: readonly Record<string, unknown>[],
  entryPath = ENTRY,
): ChangeSet {
  const sourceDigest = digest(archive)
  const entryDigest = digest(map)
  const revision = revisionId('provider-token:warzone-wz-fixture-r1')
  return {
    targets: [
      {
        targetId: 'root',
        subjectUri: SOURCE.uri,
        ownerSource: SOURCE,
        semanticPath: [],
        expectedRevision: {
          bindings: {},
          namespaceRevision: revision,
          compositionFingerprint: 'warzone-wz-writer-fixture',
        },
      },
    ],
    edits: [
      {
        operation: 'create',
        targetId: 'root',
        source: SOURCE,
        newPath: 'fixture-output.wz',
        payload: { kind: 'inline', bytes: archive },
      },
    ],
    semanticIntent: {
      kind: WARZONE_WZ_GAME_MAP_WRITE_INTENT.kind,
      sourceComplete: true,
      sourceContentDigest: sourceDigest,
      unknownDataPolicy: WARZONE_WZ_GAME_MAP_WRITE_INTENT.unknownDataPolicy,
      entryPath,
      sourceEntryContentDigest: entryDigest,
      gameMapEdit: {
        kind: WARZONE_WZ_GAME_MAP_WRITE_INTENT.nestedGameMapKind,
        sourceComplete: true,
        sourceContentDigest: entryDigest,
        unknownDataPolicy: WARZONE_WZ_GAME_MAP_WRITE_INTENT.nestedUnknownDataPolicy,
        updates,
      },
    },
    provenance: { actor: 'user', note: 'Warzone WZ writer fixture' },
  }
}

async function outputOf(plan: Awaited<ReturnType<Writer['plan']>>): Promise<Uint8Array> {
  const edit = plan.edits[0]
  if (edit?.operation !== 'create' || edit.payload.kind !== 'inline') {
    throw new Error('writer returned no inline Save As create')
  }
  return edit.payload.bytes
}

describe('Warzone WZ preserving Save As writer', () => {
  it('keeps an unchanged canonical whole container byte-identical in fresh bytes', async () => {
    const source = fixture()
    const plan = await writer().plan(change(source.archive, source.map, []))
    const output = await outputOf(plan)
    expect(output).not.toBe(source.archive)
    expect(output).toEqual(source.archive)
    expect(plan.semantics).toEqual({ mutationMode: 'export-only', minimumGuarantee: 'atomic' })
    expect(plan.fidelity).toMatchObject({ roundTrip: 'semantic', preservesUnknownData: true })
  })

  it('replaces the effective existing game.map through typed nested edits and reopens it', async () => {
    const source = fixture()
    const beforeArchive = source.archive.slice()
    const plan = await writer().plan(
      change(source.archive, source.map, [
        { kind: 'set-tile-v1', index: 1, texture: 0xabcd, height: 200 },
        { kind: 'set-gateway-v1', index: 0, x1: 0, y1: 1, x2: 2, y2: 1 },
      ]),
    )
    const output = await outputOf(plan)
    expect(source.archive).toEqual(beforeArchive)
    const entries = parseZipArchive(output, budget.maxNodes)
    const entry = entries.find(item => item.name === ENTRY)
    if (entry === undefined) throw new Error('reopened fixture lost game.map')
    const reopenedBytes = await extractZipArchiveEntry(output, entry)
    const reopened = parseWarzoneGameMap(reopenedBytes, budget)
    expect(reopened.tiles[1]).toMatchObject({ texture: 0xabcd, height: 200 })
    expect(reopened.gateways[0]).toMatchObject({ x1: 0, y1: 1, x2: 2, y2: 1 })
    const rules = entries.find(item => item.name === 'ruleset.json')
    if (rules === undefined) throw new Error('reopened fixture lost ruleset.json')
    expect(new TextDecoder().decode(await extractZipArchiveEntry(output, rules))).toBe(
      '{"type":"skirmish"}',
    )
  })

  it('fails closed for exact last-wins duplicates and case-fold aliases', async () => {
    for (const alias of [ENTRY, 'multiplay/maps/2c-fixture/Game.map']) {
      const source = fixture([{ name: alias, bytes: gameMapFixture() }])
      const validation = await writer().validate(change(source.archive, source.map, []))
      expect(validation.valid).toBe(false)
      expect(validation.diagnostics[0]?.message).toMatch(/duplicate|case-fold|last-wins/iu)
    }
  })

  it('fails closed when any archive entry is encrypted', async () => {
    const source = fixture([
      { name: 'multiplay/maps/2c-fixture/secret.bin', bytes: new Uint8Array([1]), flags: 1 },
    ])
    const validation = await writer().validate(change(source.archive, source.map, []))
    expect(validation.valid).toBe(false)
    expect(validation.diagnostics[0]?.message).toMatch(/encrypted/iu)
  })

  it('fails closed for unsupported target compression and ZIP64 sentinels', async () => {
    const map = gameMapFixture()
    const unsupported = storedZip([{ name: ENTRY, bytes: map, method: 99 }])
    const compression = await writer().validate(change(unsupported, map, []))
    expect(compression.valid).toBe(false)
    expect(compression.diagnostics[0]?.message).toMatch(/compression method|unsupported/iu)

    const source = fixture()
    const zip64 = source.archive.slice()
    new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength).setUint32(
      zip64.byteLength - 22 + 16,
      0xffffffff,
      true,
    )
    const zip64Validation = await writer().validate(change(zip64, source.map, []))
    expect(zip64Validation.valid).toBe(false)
    expect(zip64Validation.diagnostics[0]?.message).toMatch(/ZIP64|central directory/iu)
  })

  it('binds the whole archive and nested entry digests independently', async () => {
    const source = fixture()
    const wrongArchive = change(source.archive, source.map, []) as unknown as {
      semanticIntent: Record<string, unknown>
    }
    wrongArchive.semanticIntent.sourceContentDigest = `sha256:${'1'.repeat(64)}`
    expect((await writer().validate(wrongArchive as never)).valid).toBe(false)

    const wrongEntry = change(source.archive, source.map, []) as unknown as {
      semanticIntent: Record<string, unknown>
    }
    wrongEntry.semanticIntent.sourceEntryContentDigest = `sha256:${'2'.repeat(64)}`
    expect((await writer().validate(wrongEntry as never)).valid).toBe(false)
  })

  it('snapshots caller-owned update objects immutably', async () => {
    const source = fixture()
    const target = change(source.archive, source.map, []).targets[0]
    if (target === undefined) throw new Error('fixture Save As target is absent')
    const update = { kind: 'set-tile-v1', index: 0, texture: 0x1234 }
    const snapshot = await snapshotWarzoneWzGameMap({
      sourceBytes: source.archive,
      entryPath: ENTRY,
      updates: [update],
      target,
      archiveName: 'immutable.wz',
      budget,
    })
    update.texture = 0x4321
    const intent = snapshot.semanticIntent as {
      gameMapEdit: { updates: readonly { texture: number }[] }
    }
    expect(intent.gameMapEdit.updates[0]?.texture).toBe(0x1234)
    expect(Object.isFrozen(intent.gameMapEdit.updates[0])).toBe(true)
  })

  it('enforces complete-source scalar budgets and observes cancellation', async () => {
    const source = fixture([{ name: 'opaque.bin', bytes: new Uint8Array(1_000_000).fill(0x5a) }])
    const tooSmall = { ...budget, maxScalarBytes: source.archive.byteLength - 1 }
    expect((await writer(tooSmall).validate(change(source.archive, source.map, []))).valid).toBe(
      false,
    )

    const controller = new AbortController()
    const pending = writer().plan(change(source.archive, source.map, []), controller.signal)
    globalThis.setTimeout(() => controller.abort(), 0)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('requires the exact host-attested provider identity', () => {
    expect(() =>
      createProvider(
        {
          contract: 'common.edit/writer',
          major: 1,
          offerId: 'warzone2100-wz-game-map-source',
        } as never,
        { ...context(), providerIdentity: undefined },
      ),
    ).toThrow(/host-attested provider identity/iu)
  })
})
