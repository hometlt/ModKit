/**
 * Shared model-processing coordinator: public model facets, viewer texture resolution and rest
 * pose sampling feed Scene voxelization or the same CPU renderer as the model viewer. Sources
 * remain leased until processing finishes. No archive/file access, private texture decoder,
 * animation selection or game semantics. Voxel limitations are returned in the Scene receipt.
 */
import type {
  AssetSession,
  Lease,
  ModelSceneSource,
  ModelMaterialSource,
  ModelResourceRefsSource,
  ModelSkeletonSource,
  RasterResourcePort,
  ByteRangeSource,
} from '@modkit/sdk'
import { createModelSceneSampler, voxelizeScene, readGltfModelSurfaces } from '@modkit/scene/model'
import { renderHeadless } from '@modkit/scene/render/headless'
import { encodePng } from '@modkit/codec-kit/raster'
import {
  loadModelStage,
  resolveModelViewerTextures,
  sceneMaterials,
  framePrimitives,
  createOrbitController,
  modelCamera,
  modelSceneRequest,
  MODEL_KEY_LIGHT,
} from '../model/index.js'
import { readModelRecords } from '../model/source.js'
import { orientPrimitive, upAxisCorrection } from '../model/scene.js'

export type ModelProcessingRequest =
  | { readonly view: 'info' }
  | {
      readonly view: 'render'
      readonly width: number
      readonly height: number
      readonly yaw: number
      readonly pitch: number
    }
  | { readonly view: 'voxelize'; readonly region: 'all' | 'southwest'; readonly resolution: number }

/** One bounded rest-pose operation; releases every optional facet even on refusal or cancellation. */
export async function processModelScene(
  session: AssetSession,
  raster: RasterResourcePort | undefined,
  request: ModelProcessingRequest,
  identity: { assetId: string; revision: string; maxBytes: number },
  signal: AbortSignal,
) {
  const leases: Lease<unknown>[] = []
  const descriptor = await session.descriptor()
  async function acquire<T>(
    contract:
      | 'common.view/model-scene-source'
      | 'common.view/model-material-source'
      | 'common.view/model-resource-refs-source'
      | 'common.view/model-skeleton-source'
      | 'common.view/byte-range-source',
  ): Promise<T | undefined> {
    if (!descriptor.dataSources.some(o => o.contract === contract && o.major === 1))
      return undefined
    const lease = await session.dataSource(contract, 1)
    leases.push(lease)
    return lease.value as T
  }
  try {
    const source = await acquire<ModelSceneSource>('common.view/model-scene-source')
    if (source === undefined) throw new TypeError('subject has no model scene')
    const model = await loadModelStage(source, signal)
    const skeleton = await acquire<ModelSkeletonSource>('common.view/model-skeleton-source')
    const bindings =
      skeleton === undefined
        ? []
        : await readModelRecords((page, s) => skeleton.bindings(page, s), 65536, signal)
    const sample = createModelSceneSampler({ ...model, skeleton: bindings }, { signal }).sample(
      0,
      signal,
    )
    const correction = upAxisCorrection(model.info.upAxis, model.info.handedness)
    const primitives =
      correction === undefined
        ? sample.primitives
        : sample.primitives.map(p => orientPrimitive(p, correction))
    const framing = framePrimitives(primitives)
    if (request.view === 'info')
      return {
        data: {
          info: model.info,
          framing,
          voxelization: {
            regions: ['all', 'southwest'],
            resolution: { minimum: 2, maximum: 128 },
            surfaceOnly: true,
          },
        },
        diagnostics: sample.diagnostics,
      }
    const materialSource = await acquire<ModelMaterialSource>('common.view/model-material-source')
    let materialRefs =
      materialSource === undefined
        ? []
        : await readModelRecords((page, s) => materialSource.materials(page, s), 65536, signal)
    const resourceSource = await acquire<ModelResourceRefsSource>(
      'common.view/model-resource-refs-source',
    )
    const refs =
      resourceSource === undefined
        ? []
        : await readModelRecords((page, s) => resourceSource.references(page, s), 65536, signal)
    const diagnostics = [...sample.diagnostics]
    const needsGltfSurfaces =
      model.info.materials > 0 &&
      (materialSource === undefined ||
        model.info.textures > refs.filter(ref => ref.role === 'texture').length)
    let textures =
      raster === undefined || needsGltfSurfaces
        ? new Map()
        : await resolveModelViewerTextures(raster, refs, signal, (id, reason) =>
            diagnostics.push({
              code: 'x3.model/texture-unresolved',
              message: `${id}: ${reason}`,
              severity: 'warning',
            }),
          )
    if (needsGltfSurfaces) {
      const bytesSource = await acquire<ByteRangeSource>('common.view/byte-range-source')
      if (bytesSource === undefined)
        throw new TypeError('model materials unavailable through public facets')
      const size = await bytesSource.size()
      if (size < 1n || size > 64n * 1024n ** 2n)
        throw new RangeError('static model container exceeds 64MiB')
      const bytes = new Uint8Array(Number(size))
      for (let offset = 0; offset < bytes.length; offset += 1024 ** 2) {
        signal.throwIfAborted()
        const length = Math.min(1024 ** 2, bytes.length - offset)
        const part = await bytesSource.read(BigInt(offset), length, signal)
        if (part.length !== length) throw new TypeError('incomplete static model container read')
        bytes.set(part, offset)
      }
      const surfaces = await readGltfModelSurfaces(bytes, raster, signal)
      materialRefs = surfaces.materials
      textures = surfaces.textures
    }
    if (raster === undefined && refs.some(r => r.role === 'texture'))
      throw new TypeError('model texture resolution unavailable')
    if (diagnostics.some(d => d.code === 'x3.model/texture-unresolved'))
      throw new TypeError('model textures unresolved; refusing colourless processing')
    const surfaces = sceneMaterials(materialRefs, textures, true)
    if (request.view === 'voxelize') {
      const result = await voxelizeScene(
        { primitives, materials: surfaces.materials, textures: surfaces.textures },
        { ...request, ...identity, signal },
      )
      return { bytes: result.bytes, data: result.receipt, diagnostics }
    }
    const orbit = createOrbitController({ yaw: request.yaw, pitch: request.pitch })
    const viewport = { width: request.width, height: request.height }
    const camera = modelCamera(framing, orbit.basis(), 1, viewport)
    const frame = await renderHeadless(
      modelSceneRequest({
        primitives,
        camera,
        viewport,
        ...surfaces,
        light: MODEL_KEY_LIGHT,
        clearColor: [0.035, 0.045, 0.065, 1],
        signal,
      }),
    )
    return {
      bytes: await encodePng(frame.width, frame.height, frame.rgba, signal),
      data: {
        ...viewport,
        yaw: request.yaw,
        pitch: request.pitch,
        framing,
        renderer: 'modkit-scene-cpu',
      },
      diagnostics: [...diagnostics, ...frame.diagnostics],
    }
  } finally {
    await Promise.allSettled(leases.map(lease => lease.release()))
  }
}
