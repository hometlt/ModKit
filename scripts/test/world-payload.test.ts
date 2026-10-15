import { describe, expect, it } from 'vitest'
import { encodeWorldPayload, worldRenderSource } from '../lib/world-payload.mjs'
import { reviveWorldPayload } from '../lib/world-payload-revive.mjs'
import { createWorldLatticePlan } from '../../packages/ui/src/world/lattice.js'

/** The bytes world.bin would hold. */
function binaryOf(chunks: readonly Uint8Array[], byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

describe('world payload', () => {
  it('retains sibling layer identities so overview space selection keeps objects and picking', () => {
    const overview = {
      provenance: { method: 'fixture', quality: 'derived', complete: true },
      raster: { columns: 1, rows: 1, origin: [0, 0], columnStep: [1, 0], rowStep: [0, 1],
        elevation: [[[1, 0]]], palette: [{ value: 0, color: [0, 0, 0] }, { value: 1, color: [255, 255, 255] }] },
      lines: [], markers: [],
    }
    const ground = { facet: 'layers', id: 'ground', layerId: 'ground', kind: 'terrain', spaceId: 'main', latticeOverview: overview }
    const objects = { facet: 'layers', id: 'objects', layerId: 'objects', kind: 'objects', spaceId: 'main' }
    const object = { facet: 'objects', id: 'unit', layerId: 'objects', kind: 'unit', objectId: 7,
      position: { x: 0.5, y: 0, z: 0.5 }, uvwPosition: { x: 0.5, y: 0, z: 0.5 } }
    const source = worldRenderSource({ layers: [
      { layer: ground, page: { items: [] } }, { layer: objects, page: { items: [object] } },
    ], models: new Map() })
    expect(source.items).toEqual([ground, objects, object])
    const plan = createWorldLatticePlan(source.items, 'main', 'overview')
    expect(plan.publishedOverview).toEqual(overview)
    expect(plan.objects.map(item => item.objectId)).toEqual([7])
  })

  it('reads back as written: shared arrays stay one object, each starts 8-byte aligned', () => {
    const positions = Float32Array.of(0, 1, 2)
    const value = {
      odd: Uint8Array.of(7),
      a: { positions, revision: 9n },
      b: { positions },
      models: new Map([['m', { indices: Uint32Array.of(0, 1, 2), gone: undefined }]]),
    }
    const { json, chunks, byteLength } = encodeWorldPayload(value)
    const parsed = JSON.parse(json)
    expect(parsed.a.positions).toEqual({ $typed: 'Float32Array', offset: 8, byteLength: 12 })
    expect(parsed.b.positions).toEqual(parsed.a.positions)
    const read = reviveWorldPayload(parsed, binaryOf(chunks, byteLength)) as {
      readonly a: { readonly positions: Float32Array; readonly revision: bigint }
      readonly b: { readonly positions: Float32Array }
      readonly models: Map<string, { readonly indices: Uint32Array }>
    }
    expect(read.a.positions).toBe(read.b.positions)
    expect([...read.a.positions]).toEqual([0, 1, 2])
    expect(read.a.revision).toBe(9n)
    expect([...read.models.get('m')!.indices]).toEqual([0, 1, 2])
    expect(read.models.get('m')).not.toHaveProperty('gone')
  })

  it('keeps what the renderer draws from an inspected world', () => {
    const effects = new TextEncoder().encode('{"extensionsUsed":["UV_game_effects"]}')
    const source = worldRenderSource(
      {
        layers: [
          {
            layer: { materials: ['ground'], waterMaterials: ['sea'] },
            page: {
              items: [
                { facet: 'resources' },
                { facet: 'terrain' },
                { facet: 'objects', catalog: { entity: 'Unit/Marine' } },
                { facet: 'objects', derivedFrom: 'cliffs' },
              ],
            },
          },
        ],
        models: new Map([
          ['geyser', { state: 'converted', uvmBytes: effects }],
          ['rock', { state: 'converted', uvmBytes: Uint8Array.of(1, 2) }],
          ['lost', { state: 'unresolved' }],
        ]),
        info: {
          players: [
            { id: 1, color: [1, 0, 0] },
            {
              id: 2,
              colorRamp: [
                [0, 0, 0],
                [0, 0, 1],
              ],
            },
            { id: 3 },
          ],
        },
      },
      { objects: item => item.derivedFrom === 'cliffs' },
    )
    expect(source.items).toEqual([
      { facet: 'terrain' },
      { facet: 'objects', derivedFrom: 'cliffs' },
    ])
    expect([...source.models.keys()]).toEqual(['geyser', 'rock'])
    expect(source.models.get('geyser')?.uvmBytes).toBe(effects)
    expect(source.models.get('rock')?.uvmBytes).toBeUndefined()
    expect(source.terrainMaterials).toEqual(['ground'])
    expect(source.waterMaterials).toEqual(['sea'])
    // house colours draw headless as in the viewer
    expect([...source.teamColors]).toEqual([[1, [1, 0, 0]]])
    expect([...source.teamRamps]).toEqual([
      [
        2,
        [
          [0, 0, 0],
          [0, 0, 1],
        ],
      ],
    ])
  })
})
