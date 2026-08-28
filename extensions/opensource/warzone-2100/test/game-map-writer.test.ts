import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ChangeSet,
  type ContributionContext,
  type ResourceBudget,
  type Writer,
} from '@modkitx-x3/sdk'
import { createProvider as createMapProvider } from '../src/map-provider.js'
import { parseWarzoneGameMap } from '../src/warzone2100-map/format.js'
import {
  WARZONE_GAME_MAP_WRITE_INTENT,
  writeWarzoneGameMap,
} from '../src/warzone2100-map/writer.js'

const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  providerIdentity: {
    providerId: 'org.modkitx.opensource/warzone2100-map-semantic',
    providerVersion: '0.1.0',
    artifactDigest: `sha256:${'0'.repeat(64)}`,
  },
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('game.map writer has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('game.map writer has no foreign service dependency')
    },
  },
}

function fixture(version = 10): Uint8Array {
  const width = 3
  const height = 2
  const tileBytes = version >= 40 ? 4 : 3
  const gatewayOffset = 16 + width * height * tileBytes
  const bytes = new Uint8Array(gatewayOffset + 8 + 4 + 5)
  bytes.set([0x6d, 0x61, 0x70, 0x7f])
  const view = new DataView(bytes.buffer)
  view.setUint32(4, version, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  for (let index = 0; index < width * height; index += 1) {
    const offset = 16 + index * tileBytes
    view.setUint16(offset, 100 + index, true)
    if (version >= 40) view.setUint16(offset + 2, 2 + index * 2, true)
    else view.setUint8(offset + 2, 1 + index)
  }
  view.setUint32(gatewayOffset, 1, true)
  view.setUint32(gatewayOffset + 4, 1, true)
  bytes.set([0, 0, 2, 0], gatewayOffset + 8)
  bytes.set([0xde, 0xad, 0xbe, 0xef, 0x42], gatewayOffset + 12)
  return bytes
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function intent(
  bytes: Uint8Array,
  updates: readonly unknown[],
  sourceContentDigest = digest(bytes),
) {
  return {
    kind: WARZONE_GAME_MAP_WRITE_INTENT.kind,
    sourceComplete: true,
    sourceContentDigest,
    unknownDataPolicy: WARZONE_GAME_MAP_WRITE_INTENT.unknownDataPolicy,
    updates,
  }
}

function changeFor(
  bytes: Uint8Array,
  updates: readonly unknown[],
  options: { readonly intentDigest?: string; readonly revisionDigest?: string } = {},
): ChangeSet {
  const sourceDigest = options.intentDigest ?? digest(bytes)
  const revisionDigest = options.revisionDigest ?? sourceDigest
  const revision = revisionId(`content-hash.${revisionDigest}`)
  const source = { id: 'fixture-source', uri: 'memory://warzone/game.map' }
  return {
    targets: [
      {
        targetId: 'content',
        subjectUri: source.uri,
        ownerSource: source,
        semanticPath: [],
        expectedRevision: {
          bindings: { content: revision },
          compositionFingerprint: 'warzone-game-map-fixture',
        },
      },
    ],
    edits: [
      {
        operation: 'replace',
        targetId: 'content',
        source,
        payload: { kind: 'inline', bytes },
      },
    ],
    semanticIntent: intent(bytes, updates, sourceDigest),
    provenance: { actor: 'user', note: 'Warzone game.map preserving writer fixture' },
  }
}

async function writer(writerContext: ContributionContext = context): Promise<Writer> {
  const lease = createMapProvider(
    {
      contract: 'common.edit/writer',
      major: 1,
      offerId: 'warzone2100-game-map-source',
    } as never,
    writerContext,
  )
  return lease.value as Writer
}

describe('Warzone 2100 preserving game.map writer', () => {
  it('returns fresh byte-identical bytes for an unchanged complete source', async () => {
    const source = fixture()
    const before = source.slice()
    const output = await writeWarzoneGameMap(source, intent(source, []), budget)
    expect(output).not.toBe(source)
    expect(output).toEqual(source)
    expect(source).toEqual(before)
    const reopened = parseWarzoneGameMap(output, budget)
    expect(reopened).toMatchObject({
      version: 10,
      width: 3,
      height: 2,
      tileCount: 6,
      gatewayCount: 1,
      trailingBytes: 5,
    })

    const nodeBuffer = Buffer.from(source)
    const bufferOutput = await writeWarzoneGameMap(nodeBuffer, intent(nodeBuffer, []), budget)
    bufferOutput[3] ^= 0xff
    expect(nodeBuffer[3]).toBe(0x7f)
  })

  it.each([10, 40])(
    'changes typed tile and existing-gateway fields in v%s and preserves every opaque byte',
    async version => {
      const source = fixture(version)
      const before = source.slice()
      const sourceMap = parseWarzoneGameMap(source, budget)
      const output = await writeWarzoneGameMap(
        source,
        intent(source, [
          { kind: 'set-tile-v1', index: 2, texture: 0xabcd, height: 200 },
          { kind: 'set-gateway-v1', index: 0, x1: 1, y1: 0, x2: 1, y2: 1 },
        ]),
        budget,
      )
      const reopened = parseWarzoneGameMap(output, budget)
      expect(reopened.tiles[2]).toMatchObject({ texture: 0xabcd, height: 200 })
      expect(reopened.gateways[0]).toMatchObject({ x1: 1, y1: 0, x2: 1, y2: 1 })
      expect(output[3]).toBe(0x7f)
      expect(output.slice(sourceMap.semanticEnd)).toEqual(source.slice(sourceMap.semanticEnd))
      expect(source).toEqual(before)
    },
  )

  it('validates, plans fresh bytes, and leaves write permission plus atomic commit to the host', async () => {
    const source = fixture(40)
    const mapWriter = await writer()
    const change = changeFor(source, [{ kind: 'set-tile-v1', index: 0, height: 510 }])
    expect(await mapWriter.validate(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await mapWriter.plan(change)
    expect(plan).toMatchObject({
      semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
      fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      diagnostics: [],
    })
    const edit = plan.edits[0]
    if (edit?.operation !== 'replace' || edit.payload.kind !== 'inline') {
      throw new Error('game.map writer did not return an inline replacement artifact')
    }
    expect(edit.payload.bytes).not.toBe(source)
    expect(parseWarzoneGameMap(edit.payload.bytes, budget).tiles[0]?.height).toBe(510)

    const manifest = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'contributions', 'provider-map.json'), 'utf8'),
    ) as { runtimeVariants: readonly { requestedPermissionClasses: readonly string[] }[] }
    expect(manifest.runtimeVariants.map(item => item.requestedPermissionClasses)).toEqual([[], []])
  })

  it('refuses an absent or mismatched host-attested provider identity', () => {
    const selection = {
      contract: 'common.edit/writer',
      major: 1,
      offerId: 'warzone2100-game-map-source',
    } as never
    const unattested: ContributionContext = {
      budgets: context.budgets,
      diagnostics: context.diagnostics,
      contracts: context.contracts,
    }
    expect(() => createMapProvider(selection, unattested)).toThrow(/host-attested/iu)
    if (context.providerIdentity === undefined)
      throw new Error('fixture provider identity is absent')
    expect(() =>
      createMapProvider(selection, {
        ...context,
        providerIdentity: { ...context.providerIdentity, providerId: 'org.example/substitute' },
      }),
    ).toThrow(/host-attested/iu)
  })

  it('fails malformed edits, unsupported mutation scope, budgets and cancellation closed', async () => {
    const source = fixture()
    const mapWriter = await writer()
    const invalid = [
      [{ kind: 'set-tile-v1', index: 6, height: 2 }],
      [{ kind: 'set-tile-v1', index: 0, height: 3 }],
      [{ kind: 'set-tile-v1', index: 0, height: 512 }],
      [{ kind: 'set-tile-v1', index: 0, height: 2, opaque: true }],
      [
        { kind: 'set-tile-v1', index: 0, height: 2 },
        { kind: 'set-tile-v1', index: 0, texture: 1 },
      ],
      [{ kind: 'set-gateway-v1', index: 0, x1: 0, y1: 0, x2: 2, y2: 1 }],
      [{ kind: 'resize-map-v1', width: 4, height: 4 }],
    ]
    for (const updates of invalid) {
      const validation = await mapWriter.validate(changeFor(source, updates))
      expect(validation.valid).toBe(false)
      expect(validation.diagnostics).toHaveLength(1)
    }

    const constrained = await writer({ ...context, budgets: { ...budget, maxNodes: 5 } })
    await expect(constrained.validate(changeFor(source, []))).resolves.toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('maxNodes') })],
    })

    const malformed = source.slice(0, source.byteLength - 7)
    await expect(mapWriter.validate(changeFor(malformed, []))).resolves.toMatchObject({
      valid: false,
    })

    const futureVersion = source.slice()
    new DataView(futureVersion.buffer).setUint32(4, 41, true)
    await expect(mapWriter.validate(changeFor(futureVersion, []))).resolves.toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('version') })],
    })

    const excessiveHeight = fixture(40)
    new DataView(excessiveHeight.buffer).setUint16(18, 511, true)
    await expect(mapWriter.validate(changeFor(excessiveHeight, []))).resolves.toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('510') })],
    })

    const unknownIntentField = changeFor(source, [])
    await expect(
      mapWriter.validate({
        ...unknownIntentField,
        semanticIntent: { ...intent(source, []), resize: { width: 4, height: 4 } },
      }),
    ).resolves.toMatchObject({ valid: false })

    const controller = new AbortController()
    controller.abort()
    await expect(mapWriter.validate(changeFor(source, []), controller.signal)).rejects.toThrow(
      /abort|cancel/iu,
    )
  })

  it('enforces positive scalar budgets and both inline byte ceilings', async () => {
    const source = fixture()
    for (const constrainedBudget of [
      { ...budget, maxScalarBytes: 0 },
      { ...budget, maxScalarBytes: source.byteLength - 1 },
      { ...budget, maxInputBytes: BigInt(source.byteLength - 1) },
    ]) {
      const constrained = await writer({ ...context, budgets: constrainedBudget })
      const validation = await constrained.validate(changeFor(source, []))
      expect(validation.valid).toBe(false)
      expect(validation.diagnostics).toHaveLength(1)
    }
  })

  it('binds the entire inline source digest to the content revision', async () => {
    const original = fixture()
    const other = original.slice()
    other[3] ^= 0xff
    const mapWriter = await writer()

    const wrongIntentDigest = digest(original)
    await expect(
      mapWriter.validate(
        changeFor(other, [], {
          intentDigest: wrongIntentDigest,
          revisionDigest: wrongIntentDigest,
        }),
      ),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('inline source') })],
    })

    await expect(
      mapWriter.validate(
        changeFor(other, [], {
          intentDigest: digest(other),
          revisionDigest: digest(original),
        }),
      ),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: [
        expect.objectContaining({ message: expect.stringContaining('expectedRevision') }),
      ],
    })
  })

  it('observes cancellation after a long write has started', async () => {
    const width = 256
    const height = 256
    const source = new Uint8Array(16 + width * height * 3 + 8)
    source.set([0x6d, 0x61, 0x70, 0x20])
    const view = new DataView(source.buffer)
    view.setUint32(4, 10, true)
    view.setUint32(8, width, true)
    view.setUint32(12, height, true)
    view.setUint32(16 + width * height * 3, 1, true)
    view.setUint32(16 + width * height * 3 + 4, 0, true)
    const controller = new AbortController()
    const mapWriter = await writer()
    const pending = mapWriter.plan(changeFor(source, []), controller.signal)
    globalThis.setTimeout(() => controller.abort(), 0)
    await expect(pending).rejects.toThrow(/abort|cancel/iu)
  })
})
