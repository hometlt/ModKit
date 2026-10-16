import { describe, expect, it } from 'vitest'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneFrame,
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
