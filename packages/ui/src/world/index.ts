/** Bounded, game-neutral inspection harness for publisher-qualified world candidates. */

import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneLayerItem,
  WorldScenePage,
} from '@modkitx-x3/sdk/maps'

export interface CandidateWorldViewerOptions {
  readonly maxLayers: number
  readonly maxItemsPerLayer: number
  readonly signal?: AbortSignal
}

export interface CandidateWorldViewerLayer {
  readonly layer: WorldSceneLayerItem
  readonly page: WorldScenePage
}

export interface CandidateWorldViewerModel {
  readonly contract: string
  readonly major: 1
  readonly snapshotId: string
  readonly info: CandidateWorldSceneInfo
  readonly layers: readonly CandidateWorldViewerLayer[]
  readonly nextLayerCursor?: string
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

/**
 * Reads one bounded page per advertised layer and never branches on game, publisher or format.
 * The harness is structural only; it is not a registered common.view contribution.
 */
export async function inspectCandidateWorld(
  source: CandidateWorldSceneSource,
  options: CandidateWorldViewerOptions,
): Promise<CandidateWorldViewerModel> {
  const maxLayers = positiveLimit(options.maxLayers, 'maxLayers')
  const maxItemsPerLayer = positiveLimit(options.maxItemsPerLayer, 'maxItemsPerLayer')
  options.signal?.throwIfAborted()
  const info = await source.info(options.signal)
  if (
    source.contract !== info.contract ||
    source.major !== info.major ||
    source.snapshotId !== info.snapshotId ||
    info.maturity !== 'publisher-candidate'
  ) {
    throw new TypeError('world candidate identity changed between source and info')
  }
  const layerPage = await source.page({ facet: 'layers', limit: maxLayers }, options.signal)
  const layers = layerPage.items.filter(
    (item): item is WorldSceneLayerItem => item.facet === 'layers',
  )
  if (layers.length !== layerPage.items.length) {
    throw new TypeError('world layers page contains a non-layer item')
  }
  const inspected = await Promise.all(
    layers.map(async layer => {
      options.signal?.throwIfAborted()
      const lod = layer.lods.includes('sampled') ? 'sampled' : layer.lods[0]
      const page = await source.page(
        {
          facet: layer.kind,
          layerId: layer.layerId,
          ...(lod === undefined ? {} : { lod }),
          limit: maxItemsPerLayer,
        },
        options.signal,
      )
      return Object.freeze({ layer, page })
    }),
  )
  return Object.freeze({
    contract: source.contract,
    major: source.major,
    snapshotId: source.snapshotId,
    info,
    layers: Object.freeze(inspected),
    ...(layerPage.nextCursor === undefined ? {} : { nextLayerCursor: layerPage.nextCursor }),
  })
}
