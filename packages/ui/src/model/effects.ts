/**
 * The model's own effects — particles, ribbons, projector decals, model particles — as a layer of
 * the frame the model stage draws (plan WC6).
 *
 * The stage draws the model from its facets, in the publisher's units. Effects are simulated by the
 * scene over the codec's UVM (`createUvmFramePreparer`), whose frame lies in metres under one
 * `uv:units` scale node. This file turns one into the other and nothing more: the camera goes into
 * the frame's space, the effect primitives come back out of it, and their materials and textures
 * join the stage's request under names of their own. DOM-free, so it is asserted in Node.
 */
import type {
  RasterResourcePort,
  RasterResourceRequest,
  RasterResourceResult,
  ResourceBudget,
  SceneRenderRequest,
  SceneRendererMaterial,
  SceneRendererPrimitive,
} from '@modkit/sdk'

import { multiply4x4, type CameraPlacement, type ModelFraming } from './scene.js'

/** The frame preparer's budget: a frame and its decoded inputs, sized for a 4K viewport. */
export const MODEL_EFFECT_BUDGET: ResourceBudget = Object.freeze({
  maxInputBytes: 512n * 1024n * 1024n,
  maxScalarBytes: 512 * 1024 * 1024,
  maxNodes: 1_000_000,
  maxDepth: 96,
  maxDiagnostics: 256,
})

/**
 * Seconds the effects of a model shown at rest run before they start over.
 *
 * ponytail: the scene simulates an effect from its start on every frame, up to 60 s back, so an
 * endless clock would make every frame as dear as the longest; a looping one keeps it to this many
 * seconds. Drop the loop once the frame preparer carries simulations from frame to frame.
 */
export const MODEL_EFFECT_LOOP_SECONDS = 10

/** What a prepared UVM frame gives the stage (`PreparedUvmRender` of `@modkit/scene/uvm/render`). */
export interface ModelEffectFrame {
  readonly request: SceneRenderRequest
  readonly metersPerSourceUnit: number
  readonly effectPrimitiveIds: readonly string[]
}

/** The stage's framing in the frame's space: the same model, `metersPerSourceUnit` times larger. */
export function effectFraming(framing: ModelFraming, metersPerSourceUnit: number): ModelFraming {
  const scale = metersPerSourceUnit
  return {
    center: [framing.center[0] * scale, framing.center[1] * scale, framing.center[2] * scale],
    radius: framing.radius * scale,
  }
}

/** The render request a frame preparer reads: the camera in the frame's space, the clip and time. */
export function modelEffectRequest(options: {
  readonly camera: CameraPlacement
  readonly viewport: { readonly width: number; readonly height: number }
  readonly time: number
  readonly clipId?: string
  readonly teamColor?: readonly [number, number, number]
}) {
  return {
    schemaVersion: 1,
    viewport: { width: options.viewport.width, height: options.viewport.height },
    camera: {
      viewProjection: Array.from(options.camera.viewProjection),
      viewMatrix: Array.from(options.camera.viewMatrix),
      eyePosition: [...options.camera.eye],
    },
    time: options.time,
    ...(options.clipId === undefined ? {} : { clipId: options.clipId }),
    ...(options.teamColor === undefined
      ? {}
      : { materialContext: { teamColor: [...options.teamColor] } }),
  }
}

/**
 * The stage's request with the effects of a prepared frame added: the effect primitives moved from
 * metres into the stage's source units, and the materials and textures they draw with renamed
 * (`effect:<id>`) so none can stand in for one of the stage's own.
 */
export function withModelEffectLayer(
  request: SceneRenderRequest,
  frame: ModelEffectFrame,
): SceneRenderRequest {
  const wanted = new Set(frame.effectPrimitiveIds)
  const named = (id: string) => `effect:${id}`
  const shrink = 1 / frame.metersPerSourceUnit
  const unscale = Float32Array.from([shrink, 0, 0, 0, 0, shrink, 0, 0, 0, 0, shrink, 0, 0, 0, 0, 1])
  const primitives: SceneRendererPrimitive[] = frame.request.scene.primitives
    .filter(primitive => wanted.has(primitive.id))
    .map(primitive => ({
      ...primitive,
      id: named(primitive.id),
      transform:
        primitive.transform === undefined ? unscale : multiply4x4(unscale, primitive.transform),
      ...(primitive.materialId === undefined ? {} : { materialId: named(primitive.materialId) }),
    }))
  const materialIds = new Set(primitives.map(primitive => primitive.materialId))
  const materials: SceneRendererMaterial[] = (frame.request.scene.materials ?? [])
    .filter(material => materialIds.has(named(material.id)))
    .map(material => ({
      ...material,
      id: named(material.id),
      ...(material.baseColorTexture === undefined
        ? {}
        : { baseColorTexture: named(material.baseColorTexture) }),
      ...(material.textureBindings === undefined
        ? {}
        : {
            textureBindings: material.textureBindings.map(binding => ({
              ...binding,
              textureId: named(binding.textureId),
            })),
          }),
    }))
  const textureIds = new Set(
    materials.flatMap(material => [
      ...(material.baseColorTexture === undefined ? [] : [material.baseColorTexture]),
      ...(material.textureBindings ?? []).map(binding => binding.textureId),
    ]),
  )
  const textures = (frame.request.scene.textures ?? [])
    .filter(texture => textureIds.has(named(texture.id)))
    .map(texture => ({ ...texture, id: named(texture.id) }))
  if (primitives.length === 0) return request
  return {
    ...request,
    scene: {
      ...request.scene,
      primitives: [...request.scene.primitives, ...primitives],
      materials: [...(request.scene.materials ?? []), ...materials],
      textures: [...(request.scene.textures ?? []), ...textures],
    },
  }
}

/**
 * Retains successful logical textures and shares their root-owned in-flight reads across frames.
 * Unresolved reads can be retried; cancelling one frame only ends that frame's wait.
 */
export function rememberingRasterPort(
  port: RasterResourcePort,
  signal: AbortSignal,
): RasterResourcePort {
  const read = new Map<string, Promise<RasterResourceResult>>()
  if (!signal.aborted) signal.addEventListener('abort', () => read.clear(), { once: true })
  return {
    async read(request: RasterResourceRequest, callerSignal?: AbortSignal) {
      signal.throwIfAborted()
      callerSignal?.throwIfAborted()
      // an embedded image is the caller's own bytes; only a named resource is worth keeping
      let answer: Promise<RasterResourceResult>
      if (request.kind !== 'logical') {
        const combined =
          callerSignal === undefined ? signal : AbortSignal.any([signal, callerSignal])
        answer = port.read(request, combined)
      } else {
        const { kind, requirement, maxBytes, selection, compressedFormats } = request
        const key = JSON.stringify({ kind, requirement, maxBytes, selection, compressedFormats })
        const kept = read.get(key)
        if (kept !== undefined) answer = kept
        else {
          answer = port.read(request, signal)
          if (!signal.aborted) read.set(key, answer)
          const pending = answer
          const forget = () => {
            if (read.get(key) === pending) read.delete(key)
          }
          void answer.then(value => {
            if (signal.aborted || value.state === 'unresolved') forget()
          }, forget)
        }
      }
      let cleanup = () => {}
      try {
        const value = await new Promise<RasterResourceResult>((resolve, reject) => {
          const onAbort = () => reject(signal.aborted ? signal.reason : callerSignal?.reason)
          signal.addEventListener('abort', onAbort, { once: true })
          callerSignal?.addEventListener('abort', onAbort, { once: true })
          cleanup = () => {
            signal.removeEventListener('abort', onAbort)
            callerSignal?.removeEventListener('abort', onAbort)
          }
          // Observe the provider even when it ignores cancellation and settles after our waiter.
          void answer.then(resolve, reject)
          if (signal.aborted || callerSignal?.aborted) onAbort()
        })
        signal.throwIfAborted()
        callerSignal?.throwIfAborted()
        return value
      } finally {
        cleanup()
      }
    },
  }
}
