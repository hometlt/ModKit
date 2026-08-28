import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { createCodec as createImgCodec } from '../src/warzone-img/codec.js'
import { createCodec as createLevCodec } from '../src/warzone-lev/codec.js'
import { createCodec as createWrfCodec } from '../src/warzone-wrf/codec.js'
import { createCodec as createMapCodec } from '../src/warzone2100-map/codec.js'
import { warzone2100 } from '../src/linked.js'

const encoder = new TextEncoder()
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('legacy Warzone codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('legacy Warzone codecs have no foreign service dependency')
    },
  },
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://warzone/${name}`
  const revisionName = name.replaceAll(/[^A-Za-z0-9.-]/gu, '-')
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:warzone-${revisionName}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: 'content', revision: source.revision }],
      compositionFingerprint: `warzone-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

function gameMap(): Uint8Array {
  const bytes = new Uint8Array(36)
  bytes.set(encoder.encode('map '), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 10, true)
  view.setUint32(8, 2, true)
  view.setUint32(12, 2, true)
  for (let offset = 16; offset < 28; offset += 3) {
    view.setUint16(offset, 0, true)
    view.setUint8(offset + 2, offset - 15)
  }
  view.setUint32(28, 1, true)
  view.setUint32(32, 0, true)
  return bytes
}

interface Case {
  readonly id: string
  readonly name: string
  readonly bytes: Uint8Array
  readonly createCodec: (context: ContributionContext) => Codec | Promise<Codec>
  readonly expected: Readonly<Record<string, unknown>>
}

const cases: readonly Case[] = [
  {
    id: 'org.modkitx/warzone-img',
    name: 'images/frontend.img',
    bytes: encoder.encode('0, 0, icon.png\n4, -2, cursor.png\n'),
    createCodec: createImgCodec,
    expected: { format: 'warzone-img', records: 2, sprites: 2 },
  },
  {
    id: 'org.modkitx/warzone-lev',
    name: 'gamedesc.lev',
    bytes: encoder.encode(
      'level "Skirmish"\nplayers 2\ntype 14\ngame "multiplay/maps/fixture.gam"\ndata "wrf/basic.wrf"\n',
    ),
    createCodec: createLevCodec,
    expected: { format: 'warzone-lev', records: 1, levels: 1 },
  },
  {
    id: 'org.modkitx/warzone-wrf',
    name: 'wrf/basic.wrf',
    bytes: encoder.encode('directory "stats"\nfile IMD "body.pie"\nfile WAV "select.ogg"\n'),
    createCodec: createWrfCodec,
    expected: { format: 'warzone-wrf', records: 2, resources: 2 },
  },
  {
    id: 'org.modkitx/warzone2100-map',
    name: 'multiplay/maps/fixture/game.map',
    bytes: gameMap(),
    createCodec: createMapCodec,
    expected: {
      format: 'warzone2100-map',
      kind: 'terrain',
      version: 10,
      width: 2,
      height: 2,
      tiles: 4,
      gateways: 0,
      minimumHeight: 2,
      maximumHeight: 20,
    },
  },
]

describe('Warzone legacy codecs in the final MK3 owner', () => {
  it('links all four migrated manifests and their trusted modules from the final owner', () => {
    const ids = [...warzone2100.input.documents.values()].map(document => document.id)
    expect(ids).toEqual(expect.arrayContaining(cases.map(fixture => fixture.id)))
    expect(warzone2100.excluded).toEqual([])
  })

  for (const fixture of cases) {
    it(`opens and inspects ${fixture.id} through its ordinary codec session`, async () => {
      const codec = await fixture.createCodec(context)
      const session = await codec.open(inputFor(fixture.name, fixture.bytes), 'full', budget)
      try {
        const descriptor = await session.descriptor()
        expect(descriptor.identity.codecId).toBe(fixture.id)
        expect(descriptor.operations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'view.inspect', state: 'available' }),
            expect.objectContaining({ id: 'asset.validate', state: 'available' }),
            expect.objectContaining({ id: 'export.raw', state: 'available' }),
          ]),
        )
        const inspected = await session.operations().invoke('inspect', null)
        expect(inspected).toMatchObject({
          state: 'ok',
          output: { kind: 'json', value: fixture.expected },
        })
        proves({
          contributionId: fixture.id,
          operation: 'inspect',
          note: 'the final Warzone owner opens and inspects this migrated format',
        })
      } finally {
        await session.dispose()
      }
    })
  }
})
