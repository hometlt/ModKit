import { describe, expect, it } from 'vitest'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneFrame,
  WorldSceneItem,
  WorldSceneLayerItem,
} from '@modkit/sdk/maps'
import type { MediaEncoder, MediaExportRequest } from '@modkit/sdk'
import {
  builtInMediaEncoders,
  inspectWorldMedia,
  renderWorldMedia,
  MediaExportError,
} from '@modkit/ui/media-export'

const snapshotId = 'media-snapshot'
const info: CandidateWorldSceneInfo = Object.freeze({
  contract: 'example.publisher/world-source',
  major: 1,
  maturity: 'publisher-candidate',
  snapshotId,
  mapId: 'media-world',
  coordinateSpaces: Object.freeze([]),
  crossSpaceTransforms: Object.freeze([]),
  bounds: Object.freeze([]),
  facets: Object.freeze([]),
  provenance: Object.freeze([]),
  unknownFacets: Object.freeze([]),
  lossPolicy: 'explicit-partial',
  complete: true,
})

/** An empty world; with `sampled`, one that samples time itself (a cutscene, a replay). */
function world(sampled?: number[]): CandidateWorldSceneSource {
  return {
    contract: info.contract,
    major: 1,
    snapshotId,
    info: async () => info,
    page: async request => ({ snapshotId, facet: request.facet, state: 'available', items: [] }),
    ...(sampled === undefined
      ? {}
      : {
          frame: async (timeMs: number): Promise<WorldSceneFrame> => {
            sampled.push(timeMs)
            return { snapshotId, timeMs, objects: [], diagnostics: [], complete: true }
          },
        }),
  } as CandidateWorldSceneSource
}

const request = (fields: Partial<MediaExportRequest> & { format: string }): MediaExportRequest => ({
  schemaVersion: 1,
  width: 16,
  height: 16,
  ...fields,
})

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

/** A ground patch, a cliff piece, a distant placed object and one water surface. */
function compositionWorld(calls: string[], sampled = false): CandidateWorldSceneSource {
  const objects = ['wall', 'tree'].map((id, index) => ({
    facet: 'objects' as const, id, layerId: 'objects', coordinateSpaceId: 'uvw', kind: 'doodad' as const,
    objectId: index + 1, resourceId: id, position: { x: index * 10, y: 0, z: 0 },
    uvwPosition: { x: index * 10, y: 0, z: 0 },
    ...(id === 'wall' ? { derivedFrom: 'cliffs' as const } : {}),
  }))
  const items: WorldSceneItem[] = [
    ...Array.from({ length: 4 }, (_, index) => ({
      facet: 'terrain' as const, id: `terrain:${index}`, layerId: 'terrain',
      coordinateSpaceId: 'height-grid', lod: 'exact' as const, x: index % 2, y: Math.floor(index / 2),
      heightBase: 0, heightAdjustment: 0, mask: 0,
      uvwPosition: { x: index % 2, y: 0, z: -Math.floor(index / 2) },
    })), ...objects,
    ...['wall', 'tree'].map(id => ({ facet: 'resources' as const, id, layerId: 'resources',
      kind: 'uvm' as const, resolved: true, objectIds: [id] })),
    { facet: 'water', id: 'water', layerId: 'water', coordinateSpaceId: 'uvw', zoneId: 0,
      templateId: 'water', minimum: { x: 0, y: 0 }, maximum: { x: 1, y: 1 }, elevation: .5,
      uvwMinimum: { x: 0, z: -1 }, uvwMaximum: { x: 1, z: 0 }, uvwElevation: .5 },
  ]
  const layers = ['terrain', 'objects', 'resources', 'water'].map(kind => ({
    facet: 'layers', id: kind, layerId: kind, kind, state: 'available', lods: ['exact'],
    itemCount: items.filter(item => item.facet === kind).length,
  })) as WorldSceneLayerItem[]
  return { ...world(),
    page: async request => ({ snapshotId, facet: request.facet, state: 'available',
      items: request.facet === 'layers' ? layers : items.filter(item => item.facet === request.facet) }),
    model: async id => {
      calls.push(id)
      return { state: 'converted', sourceKey: id, complete: true, diagnostics: [], meshes: [], nodes: [],
        primitives: [{ id, topology: 'triangles',
          positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) }] }
    },
    ...(sampled ? { frame: async (timeMs: number) => ({ snapshotId, timeMs, objects,
      diagnostics: [], complete: true }) } : {}),
  }
}

/** GLB document tables let the test check actual exported composition, not only its receipt. */
function glbDocument(bytes: Uint8Array) {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)))
}

/** Counts what an animation encoder is given, as the application's format modules would receive it. */
function recordingEncoder(seen: { frames: number; fps: number }[]): MediaEncoder {
  return {
    offer: {
      id: 'test-animation',
      label: 'Test',
      kind: 'animation',
      extension: '.bin',
      mediaType: 'application/octet-stream',
      alpha: true,
      lossy: false,
    },
    encode: async item => {
      seen.push({ frames: item.frames.length, fps: item.fps })
      return new Uint8Array([1, 2, 3])
    },
  }
}

describe('media export of a world', () => {
  it.each([
    { content: 'terrain' as const, includeWater: false },
    { content: 'terrain' as const, includeWater: true },
    { content: 'all' as const, includeWater: false },
    { content: 'all' as const, includeWater: true },
  ])('exports the selected GLB composition: $content, water=$includeWater', async selection => {
    const calls: string[] = []
    const result = await renderWorldMedia(compositionWorld(calls), request({ format: 'glb', ...selection }),
      builtInMediaEncoders(), { maxBytes: 1024 * 1024 })
    expect(calls.sort()).toEqual(selection.content === 'all' ? ['tree', 'wall'] : ['wall'])
    expect(result.receipt).toMatchObject({ ...selection, complete: true,
      models: { total: calls.length, converted: calls.length } })
    const document = glbDocument(result.bytes)
    expect(document.meshes.some((mesh: { name: string }) => mesh.name.startsWith('world/water-')))
      .toBe(selection.includeWater)
    const maximumX = Math.max(...document.meshes.flatMap((mesh: { primitives: { attributes: { POSITION: number } }[] }) =>
      mesh.primitives.map(primitive => document.accessors[primitive.attributes.POSITION].max[0])))
    expect(maximumX > 9).toBe(selection.content === 'all')
    expect(document.meshes.some((mesh: { name: string }) => mesh.name === 'world/terrain-baked')).toBe(true)
  })

  it('keeps previous default composition and intersects the legacy object filter', async () => {
    const calls: string[] = []
    const full = await renderWorldMedia(compositionWorld(calls), request({ format: 'glb' }), builtInMediaEncoders())
    expect(full.receipt).toMatchObject({ content: 'all', includeWater: true, complete: true })
    expect(calls.sort()).toEqual(['tree', 'wall'])
    calls.length = 0
    const filtered = await renderWorldMedia(compositionWorld(calls),
      request({ format: 'glb', content: 'terrain', derivedFrom: [] }), builtInMediaEncoders())
    expect(calls).toEqual([])
    expect(filtered.receipt.models).toEqual({ total: 0, converted: 0 })
  })

  it('applies terrain composition to sampled frames as well as the inspected objects', async () => {
    const selection = request({ format: 'png', content: 'terrain', includeWater: false })
    const staticResult = await renderWorldMedia(compositionWorld([]), selection, builtInMediaEncoders())
    const sampledResult = await renderWorldMedia(compositionWorld([], true), selection, builtInMediaEncoders())
    expect(sampledResult.bytes).toEqual(staticResult.bytes)
  })

  it('refuses invalid composition options', async () => {
    for (const fields of [{ content: 'rocks' }, { includeWater: 'false' }])
      await expect(renderWorldMedia(world(), request({ format: 'glb', ...fields } as never),
        builtInMediaEncoders())).rejects.toMatchObject({ code: 'x3.media/invalid-request' })
  })

  it('draws a still into PNG and TGA with a transparent background', async () => {
    const png = await renderWorldMedia(
      world(),
      request({ format: 'png', background: 'transparent' }),
      builtInMediaEncoders(),
    )
    expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(png.receipt).toMatchObject({
      format: 'png',
      frames: 1,
      durationMs: 0,
      alpha: true,
      audio: false,
      complete: true,
    })
    const tga = await renderWorldMedia(world(), request({ format: 'tga' }), builtInMediaEncoders())
    expect(tga.bytes.byteLength).toBe(18 + 16 * 16 * 4)
    expect(tga.receipt.alpha).toBe(false)
  })

  it('samples a world that keeps its own time at every frame and hands the encoder all of them', async () => {
    const sampled: number[] = []
    const seen: { frames: number; fps: number }[] = []
    const result = await renderWorldMedia(
      world(sampled),
      request({ format: 'test-animation', durationMs: 300, fps: 10, startMs: 1000 }),
      [recordingEncoder(seen)],
    )
    expect(sampled).toEqual([1000, 1100, 1200])
    expect(seen).toEqual([{ frames: 3, fps: 10 }])
    expect(result.receipt).toMatchObject({ frames: 3, startMs: 1000, durationMs: 300 })
    const report = await inspectWorldMedia(world([]))
    expect(report).toMatchObject({
      animated: true,
      sampledTime: true,
      sourceCamera: false,
      objects: 0,
    })
    expect((await inspectWorldMedia(world())).animated).toBe(false)
  })

  it('lays a sprite sheet out as directions by frame times, clockwise', async () => {
    const result = await renderWorldMedia(
      world(),
      request({
        format: 'sprite-sheet',
        durationMs: 200,
        fps: 10,
        camera: { kind: 'directions', count: 4 },
      }),
      builtInMediaEncoders(),
    )
    const sheet = result.receipt.sheet!
    expect(sheet).toMatchObject({ columns: 2, rows: 4, cellWidth: 16, cellHeight: 16 })
    expect(sheet.cells).toHaveLength(8)
    expect(sheet.cells[2]).toMatchObject({ direction: 1, frame: 0, x: 0, y: 16, timeMs: 0 })
    expect(sheet.cells[2]!.azimuth).toBeCloseTo(-Math.PI / 2)
    expect(text(result.bytes)).toContain('sprite-sheet.png')
    expect(text(result.bytes)).toContain('sprite-sheet.json')
    expect(result.receipt).toMatchObject({ camera: 'directions', directions: 4, frames: 2 })
  })

  it('reports a requested clip no object plays, and refuses what it cannot draw', async () => {
    const result = await renderWorldMedia(
      world(),
      request({ format: 'png', animations: [{ clip: 'Attack', objectId: 7 }] }),
      builtInMediaEncoders(),
    )
    expect(result.receipt.unmatchedAnimations).toEqual(['Attack on object 7'])
    const code = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (error: unknown) => (error instanceof MediaExportError ? error.code : String(error)),
      )
    await expect(
      code(renderWorldMedia(world(), request({ format: 'nope' }), builtInMediaEncoders())),
    ).resolves.toBe('x3.media/unknown-format')
    await expect(
      code(
        renderWorldMedia(
          world(),
          request({ format: 'png-frames', durationMs: 60_000, fps: 10 }),
          builtInMediaEncoders(),
        ),
      ),
    ).resolves.toBe('x3.media/too-many-frames')
    await expect(
      code(renderWorldMedia(world(), request({ format: 'png', width: 7 }), builtInMediaEncoders())),
    ).resolves.toBe('x3.media/invalid-size')
    await expect(
      code(
        renderWorldMedia(
          world(),
          request({ format: 'png', camera: { kind: 'source' } }),
          builtInMediaEncoders(),
        ),
      ),
    ).resolves.toBe('x3.media/no-source-camera')
  })
})
