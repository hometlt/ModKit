import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ContributionContext,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { createCodec } from '../src/warzone-wz/codec.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
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
      throw new Error('WZ codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('WZ codec has no foreign service dependency')
    },
  },
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}

interface Part {
  readonly name: string
  readonly body: string
  readonly method?: 0 | 8
}

function zip(parts: readonly Part[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let localOffset = 0
  for (const part of parts) {
    const name = encoder.encode(part.name)
    const body = encoder.encode(part.body)
    const method = part.method ?? 0
    const packed = method === 8 ? deflateRawSync(body) : body
    const crc = crc32(body)
    const local = new Uint8Array(30 + name.byteLength + packed.byteLength)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, method, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, packed.byteLength, true)
    localView.setUint32(22, body.byteLength, true)
    localView.setUint16(26, name.byteLength, true)
    local.set(name, 30)
    local.set(packed, 30 + name.byteLength)
    locals.push(local)

    const central = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, method, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, packed.byteLength, true)
    centralView.setUint32(24, body.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, localOffset, true)
    central.set(name, 46)
    centrals.push(central)
    localOffset += local.byteLength
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(localOffset + centralSize + 22)
  let offset = 0
  for (const local of locals) {
    output.set(local, offset)
    offset += local.byteLength
  }
  for (const central of centrals) {
    output.set(central, offset)
    offset += central.byteLength
  }
  const eocd = new DataView(output.buffer, offset, 22)
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, parts.length, true)
  eocd.setUint16(10, parts.length, true)
  eocd.setUint32(12, centralSize, true)
  eocd.setUint32(16, localOffset, true)
  return output
}

function inputFor(bytes: Uint8Array): AssetInput {
  const uri = 'memory://warzone/data/mp.wz'
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:wz-last-wins'),
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
      compositionFingerprint: 'wz-last-wins',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

describe('Warzone WZ final MK3 codec', () => {
  it('extracts Deflate entries and exposes only the last repeated path', async () => {
    const bytes = zip([
      {
        name: 'ruleset.json',
        body: JSON.stringify({ tag: 'mp', type: 'SKIRMISH', name: 'Fixture skirmish' }),
        method: 8,
      },
      { name: 'stats/structures.json', body: '{"revision":"old"}', method: 8 },
      { name: 'stats/structures.json', body: '{"revision":"new"}', method: 8 },
    ])
    const session = await (await createCodec(context)).open(inputFor(bytes), 'full', budget)
    try {
      const inspected = await session.operations().invoke('inspect', null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
        throw new Error('WZ inspect operation did not return JSON')
      }
      expect(inspected.output.value).toMatchObject({
        format: 'warzone-wz',
        kind: 'skirmish-ruleset',
        physicalEntries: 3,
        entries: 2,
        shadowedEntries: 1,
        ruleset: { tag: 'mp', type: 'SKIRMISH', name: 'Fixture skirmish' },
      })
      const lease = await session.dataSource('common.view/namespace-entry-source', 1)
      const namespace = lease.value as NamespaceEntrySource
      const page = await namespace.list('', { limit: 10 })
      const structures = page.items.filter(item => item.path === 'stats/structures.json')
      expect(structures).toHaveLength(1)
      expect(structures[0]?.id).toBe('entry-2')
      const extracted = await session.operations().invoke('extract-entry', {
        entryId: structures[0]?.id,
      })
      expect(extracted).toMatchObject({ state: 'ok', output: { kind: 'bytes' } })
      if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
        throw new Error('effective WZ entry was not extracted')
      }
      expect(decoder.decode(extracted.output.value)).toBe('{"revision":"new"}')
      await lease.release()
      proves({
        contributionId: 'org.modkitx/warzone-wz',
        operation: 'inspect',
        note: 'the final owner reads ruleset.json and applies the last-entry-wins WZ overlay',
      })
      proves({
        contributionId: 'org.modkitx/warzone-wz',
        operation: 'read',
        note: 'the final owner extracts an effective Deflate-compressed package entry',
      })
    } finally {
      await session.dispose()
    }
  })
})
