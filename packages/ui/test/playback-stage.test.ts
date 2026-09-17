import { describe, expect, it } from 'vitest'
import type { CandidateWorldSceneSource, WorldScenePageRequest } from '@modkit/sdk/maps'
import {
  formatPlaybackTime,
  inspectCandidateWorld,
  markerIndexAt,
  readPlaybackWorld,
} from '@modkit/ui'

/** A timed world like a replay's: its frame follows a movable position, pinned by info(). */
function movingWorld(units: number) {
  let position = 0
  let pinned = 0
  const snapshotId = () => `fixture:${pinned}`
  const source = {
    contract: 'common.view/world-scene-source',
    major: 1 as const,
    get snapshotId() {
      return snapshotId()
    },
    async info() {
      pinned = position
      return {
        contract: 'common.view/world-scene-source',
        major: 1 as const,
        maturity: 'publisher-candidate' as const,
        snapshotId: snapshotId(),
        mapId: 'fixture',
        coordinateSpaces: [],
        crossSpaceTransforms: [],
        bounds: [
          {
            facet: 'objects' as const,
            coordinateSpaceId: 'space',
            x: { state: 'known' as const, minimum: 0, maximum: 100 },
            y: { state: 'known' as const, minimum: 10, maximum: 50 },
            z: { state: 'known' as const, minimum: 0, maximum: 0 },
          },
        ],
        facets: [
          {
            facet: 'objects' as const,
            layerId: 'units',
            state: 'available' as const,
            itemCount: units,
            lods: ['sampled'],
          },
        ],
        provenance: [],
        unknownFacets: [],
        lossPolicy: 'explicit-partial' as const,
        complete: false,
      }
    },
    async page(request: WorldScenePageRequest) {
      if (request.facet === 'layers')
        return {
          snapshotId: snapshotId(),
          facet: 'layers' as const,
          state: 'available' as const,
          items: [
            {
              facet: 'layers' as const,
              id: 'layer:units',
              layerId: 'units',
              kind: 'objects' as const,
              state: 'available' as const,
              itemCount: units,
              lods: ['sampled'],
            },
          ],
        }
      const offset = Number(request.cursor ?? 0)
      const count = Math.min(request.limit, units - offset)
      return {
        snapshotId: snapshotId(),
        facet: 'objects' as const,
        state: 'available' as const,
        items: Array.from({ length: count }, (_, index) => ({
          facet: 'objects' as const,
          id: `unit:${offset + index}`,
          layerId: 'units',
          coordinateSpaceId: 'space',
          kind: 'unit' as const,
          objectId: offset + index,
          position: { x: pinned + offset + index, y: 20, z: 0 },
          player: 1,
        })),
        ...(offset + count < units ? { nextCursor: String(offset + count) } : {}),
      }
    },
  }
  return {
    source: source as unknown as CandidateWorldSceneSource,
    move(to: number) {
      position = to
    },
  }
}

/** What a source looks like after crossing the capability RPC: methods, no fields. */
const remote = (source: CandidateWorldSceneSource) =>
  ({
    info: (signal?: AbortSignal) => source.info(signal),
    page: (request: WorldScenePageRequest, signal?: AbortSignal) => source.page(request, signal),
  }) as unknown as CandidateWorldSceneSource

describe('playback stage model', () => {
  it('formats positions and finds the event at a position', () => {
    expect(formatPlaybackTime(0)).toBe('0:00')
    expect(formatPlaybackTime(61_999)).toBe('1:01')
    expect(formatPlaybackTime(3_725_000)).toBe('1:02:05')
    const markers = [100, 200, 200, 900].map(positionMs => ({
      positionMs,
      kind: 'unit-born',
      label: 'x',
    }))
    expect(markerIndexAt(markers, 0)).toBe(-1)
    expect(markerIndexAt(markers, 100)).toBe(0)
    expect(markerIndexAt(markers, 250)).toBe(2)
    expect(markerIndexAt(markers, 10_000)).toBe(3)
    expect(markerIndexAt([], 10)).toBe(-1)
  })

  it('reads one pinned, paged frame of a moving world across a boundary', async () => {
    const world = movingWorld(1_500)
    world.move(40)
    const frame = await readPlaybackWorld(remote(world.source))
    expect(frame).toMatchObject({
      snapshotId: 'fixture:40',
      bounds: { minimumX: 0, maximumX: 100, minimumY: 10, maximumY: 50 },
      complete: true,
    })
    expect(frame?.objects).toHaveLength(1_500)
    expect(frame?.objects[0]?.position.x).toBe(40)

    // The transport moved between info() and a page: the stale read is dropped, not drawn.
    const racing = movingWorld(4)
    const source = racing.source
    const wrapped = {
      info: async (signal?: AbortSignal) => {
        const info = await source.info(signal)
        racing.move(99)
        await source.info(signal)
        return info
      },
      page: source.page.bind(source),
    } as unknown as CandidateWorldSceneSource
    expect(await readPlaybackWorld(wrapped)).toBeUndefined()
  })

  it('lets the world stage inspect a timed world whose identity only info() carries', async () => {
    const world = movingWorld(3)
    world.move(7)
    const model = await inspectCandidateWorld(remote(world.source), {
      maxLayers: 4,
      maxItemsPerLayer: 16,
    })
    expect(model.snapshotId).toBe('fixture:7')
    expect(model.layers[0]?.page.items).toHaveLength(3)
    // A local source still has to agree with its own info().
    const local = movingWorld(1)
    const drifting = Object.create(local.source, {
      snapshotId: { value: 'other' },
    }) as CandidateWorldSceneSource
    await expect(
      inspectCandidateWorld(drifting, { maxLayers: 4, maxItemsPerLayer: 16 }),
    ).rejects.toThrow(/identity changed/u)
  })
})
