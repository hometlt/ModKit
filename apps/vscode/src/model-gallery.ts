/**
 * Model thumbnails for the existing explorer gallery. A native model exports through its own
 * nonmutating operation; the common UVM preparer, UI camera and Host renderer own interpretation
 * and drawing. No game, filesystem lookup, model parser or material projector lives here.
 */
import type { SubjectOpener } from '@modkit/host'
import type { JsonValue, ResourceBudget, SceneRendererPort } from '@modkit/sdk'
import { createUvmFramePreparer } from '@modkit/scene/uvm/render'
import { createOrbitController, framePrimitives, modelCamera } from '@modkit/ui/model'
import type { GalleryThumbnail } from './image-gallery.js'

export interface ModelGalleryOptions {
  readonly renderers: SceneRendererPort
  /** A separate bounded preparation stage, not a replacement for the subject's open budget. */
  readonly budget: ResourceBudget
}

/** Bounded UVM preparation and renderer activation after the native subject has exported. */
export const MODEL_GALLERY_BUDGET: ResourceBudget = Object.freeze({
  maxInputBytes: 100n * 1024n * 1024n,
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: 100 * 1024 * 1024,
  maxDiagnostics: 1_000,
  deadlineMs: 30_000,
})

/** Render the default visible rest scene; unavailable export/provider leaves a named gallery row. */
export async function renderModelGalleryThumbnail(
  opened: Awaited<ReturnType<SubjectOpener>>,
  options: ModelGalleryOptions,
  maxEdge: number,
  signal?: AbortSignal,
): Promise<GalleryThumbnail | undefined> {
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 1 || maxEdge > 512)
    throw new RangeError('model thumbnail edge must be an integer between 1 and 512')
  signal?.throwIfAborted()
  const session = opened.session
  if (session === undefined) return undefined
  const descriptor = await session.descriptor()
  if (!descriptor.dataSources.some(source => source.contract === 'common.view/model-scene-source'))
    return undefined
  const operation = descriptor.operations.find(
    item => item.id === 'model.export-uvm' && item.state === 'available' && item.mutatesSource === false,
  )
  if (operation === undefined) return undefined
  const exported = await session
    .operations()
    .invoke(
      operation.handlerId,
      { schemaVersion: 1 },
      signal === undefined ? undefined : { signal },
    )
  signal?.throwIfAborted()
  if (exported.state !== 'ok' || exported.output.kind !== 'bytes') return undefined
  const bytes = exported.output.value
  if (
    bytes.byteLength === 0 ||
    BigInt(bytes.byteLength) > BigInt(options.budget.maxInputBytes) ||
    bytes.byteLength > options.budget.maxScalarBytes
  )
    return undefined
  const viewport = { width: maxEdge, height: maxEdge }
  const orbit = createOrbitController()
  const request = (framing: ReturnType<typeof framePrimitives>): JsonValue => {
    const camera = modelCamera(framing, orbit.basis(), orbit.pose.distanceScale, viewport)
    return {
      schemaVersion: 1,
      viewport,
      camera: {
        viewProjection: Array.from(camera.viewProjection),
        viewMatrix: Array.from(camera.viewMatrix),
        eyePosition: [...camera.eye],
      },
      lighting: 'material',
      clearColor: [0, 0, 0, 0],
    }
  }
  const preparer = createUvmFramePreparer(bytes, {
    budget: options.budget,
    ...(opened.rasterResources === undefined ? {} : { rasterResources: opened.rasterResources }),
    ...(signal === undefined ? {} : { signal }),
  })
  try {
    // Frame the sampled scene in metres, including static skin frames and default visibility.
    // Preparing again supplies the final camera to billboards and camera-dependent materials.
    const seed = await preparer.prepare(request(framePrimitives([])), signal)
    const frame = await preparer.prepare(
      request(framePrimitives(seed.request.scene.primitives)),
      signal,
    )
    signal?.throwIfAborted()
    const acquired = await options.renderers.acquire({
      outputKind: 'rgba8',
      ...(signal === undefined ? {} : { signal }),
    })
    if (acquired.state !== 'resolved') return undefined
    try {
      signal?.throwIfAborted()
      const rendered = await acquired.lease.renderer.render(frame.request)
      signal?.throwIfAborted()
      if (
        rendered.outputKind !== 'rgba8' ||
        rendered.width !== maxEdge ||
        rendered.height !== maxEdge ||
        !(rendered.rgba instanceof Uint8Array) ||
        rendered.rgba.byteLength !== maxEdge * maxEdge * 4
      )
        throw new TypeError('model thumbnail renderer returned an invalid RGBA frame')
      return { width: maxEdge, height: maxEdge, rgba: new Uint8Array(rendered.rgba) }
    } finally {
      await acquired.lease.release()
    }
  } finally {
    preparer.dispose()
  }
}
