import type { JsonValue, Lease, ModelResourceAsset } from '@modkit/sdk'
import type {
  SceneRenderRequest,
  SceneRendererPrimitive,
  SceneRendererMaterial,
  SceneRendererTexture,
  SceneRendererDiagnostic,
} from '@modkit/sdk/renderer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmAnimationClips } from '@modkit/uv/model/animation-clips'
import { modelPrimitiveByteLength } from '@modkit/codec-kit/model/geometry'
import {
  multiplyMaterialFrames,
  invertMaterialFrame,
  IDENTITY_MATERIAL_FRAME,
} from '../materials/frame.js'
import type { UvmModelParticleDraw } from './effect-particles.js'
import type { UvmFrameOptions, PreparedUvmRender } from './render.js'

export type ModelParticleInstance = UvmModelParticleDraw & { readonly transform: readonly number[] }
const multiplyFrames = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Float32Array.from(multiplyMaterialFrames(Array.from(a), Array.from(b)))

/** Column-major product for camera projection chains. Unlike material frames, the left operand
 * may be projective; inputs and the float32 result are still bounded before publication. */
const multiplyMatrix4 = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== 16 || b.length !== 16)
    throw new TypeError('model particle camera matrices must contain 16 components')
  const output = new Float32Array(16)
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let value = 0
      for (let index = 0; index < 4; index++)
        value += (a[index * 4 + row] ?? Number.NaN) * (b[column * 4 + index] ?? Number.NaN)
      if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
        throw new RangeError('model particle camera matrix exceeds float32')
      output[column * 4 + row] = value
    }
  return output
}

/** Pinned callback basis/size in simulation coordinates, followed by its common world frame. */
export function modelParticleMatrix(instance: ModelParticleInstance): Float32Array {
  let local: readonly number[] = [
    ...instance.right.map(x => x * instance.scale[0]),
    0,
    ...instance.up.map(x => x * instance.scale[1]),
    0,
    ...instance.forward.map(x => x * instance.scale[2]),
    0,
    ...instance.position,
    1,
  ]
  if (instance.swapYZ) {
    // Pinned Three effect consumer uses +90 degrees around X, not a mirrored axis exchange.
    const cosine = Math.cos(Math.PI * 0.5)
    local = multiplyMaterialFrames(local, [
      1,
      0,
      0,
      0,
      0,
      cosine,
      1,
      0,
      0,
      -1,
      cosine,
      0,
      0,
      0,
      0,
      1,
    ])
  }
  const matrix = multiplyFrames(instance.transform, local)
  if (!matrix.every(Number.isFinite))
    throw new RangeError('model particle matrix exceeds finite range')
  return matrix
}

/** One scoped acquisition per logical path per frame; draw preparation is sampled at each age. */
export async function composeModelParticles(
  instances: readonly ModelParticleInstance[],
  parent: SceneRenderRequest,
  options: UvmFrameOptions,
  depth: number,
  maxBytes: number,
  prepare: (
    bytes: Uint8Array,
    input: JsonValue,
    options: UvmFrameOptions,
    depth: number,
  ) => Promise<PreparedUvmRender>,
  purpose: {
    readonly id: string
    readonly label: string
    readonly prefix: string
  } = { id: 'model-particle', label: 'Model particles', prefix: 'model-particle' },
  parentGlobalTime?: number,
): Promise<{
  primitives: SceneRendererPrimitive[]
  materials: SceneRendererMaterial[]
  textures: SceneRendererTexture[]
  diagnostics: SceneRendererDiagnostic[]
  composedInstances: number
}> {
  const primitives: SceneRendererPrimitive[] = [],
    materials: SceneRendererMaterial[] = [],
    textures: SceneRendererTexture[] = [],
    diagnostics: SceneRendererDiagnostic[] = []
  let composedInstances = 0
  const warn = (message: string) => {
    if (diagnostics.length >= options.budget.maxDiagnostics)
      throw new RangeError('nested model diagnostics exceed budget')
    diagnostics.push({
      severity: 'warning',
      code: `common.uvm/${purpose.id}-unrendered`,
      message,
    })
  }
  if (instances.length === 0)
    return { primitives, materials, textures, diagnostics, composedInstances }
  if (instances.length > Math.min(128, options.budget.maxNodes))
    throw new RangeError('model particle instances exceed budget')
  if (options.modelResources === undefined) {
    warn(
      `${purpose.label} require a scoped model resource provider; the base scene is retained.`,
    )
    return { primitives, materials, textures, diagnostics, composedInstances }
  }
  if (depth >= 8) throw new RangeError('nested model render exceeds depth limit')
  let remaining = maxBytes
  const leases = new Map<string, Lease<ModelResourceAsset>>()
  const cap = Math.floor(remaining / (new Set(instances.map(instance => instance.path)).size + 1))
  try {
    for (const [ordinal, instance] of instances.entries()) {
      options.signal?.throwIfAborted()
      let lease = leases.get(instance.path)
      if (lease === undefined) {
        lease = await options.modelResources.acquire(
          {
            requirement: {
              id: `${purpose.id}:${instance.path}`,
              logicalId: instance.path,
              role: 'sidecar',
              scopes: [
                'sibling-directory',
                'workspace-dependency-layer',
                'current-mount',
                'enclosing-container',
              ],
            },
            maxBytes: Math.min(cap, remaining),
            metersPerSourceUnit: 1,
          },
          options.signal,
        )
        leases.set(instance.path, lease)
        options.signal?.throwIfAborted()
        const result = lease.value.result
        if (result.state === 'converted') {
          remaining -= result.bytes.byteLength
          diagnostics.push(
            ...result.diagnostics.map(item => ({
              code: item.code,
              message: item.message,
              severity: item.severity === 'hint' ? ('information' as const) : item.severity,
            })),
          )
          if (diagnostics.length > options.budget.maxDiagnostics)
            throw new RangeError('nested model diagnostics exceed budget')
        } else warn(result.diagnostics.map(item => item.message).join('; '))
      }
      const result = lease.value.result
      if (result.state !== 'converted') continue
      if (remaining <= 0) throw new RangeError('nested model acquisition exceeds byte budget')
      const parsed = readUvmContainer(result.bytes, {
        maxInputBytes: cap,
        maxJsonBytes: cap,
        maxNodes: options.budget.maxNodes,
        maxDepth: options.budget.maxDepth,
      })
      const catalog = readUvmAnimationClips(parsed.document)
      const clipId =
        catalog?.[0]?.id ??
        (Array.isArray(parsed.document['animations']) && parsed.document['animations'].length > 0
          ? 'animation-0'
          : undefined)
      const matrix = modelParticleMatrix(instance)
      const camera = {
        viewProjection: Array.from(multiplyMatrix4(parent.camera.viewProjection, matrix)),
        ...(parent.camera.viewMatrix === undefined
          ? {}
          : { viewMatrix: Array.from(multiplyFrames(parent.camera.viewMatrix, matrix)) }),
      }
      const eye = parent.camera.eyePosition
      const childEye =
        eye === undefined
          ? undefined
          : (() => {
              const inverse = invertMaterialFrame(Array.from(matrix))
              return [0, 1, 2].map(
                axis =>
                  (inverse[axis] ?? 0) * eye[0] +
                  (inverse[axis + 4] ?? 0) * eye[1] +
                  (inverse[axis + 8] ?? 0) * eye[2] +
                  (inverse[axis + 12] ?? 0),
              )
            })()
      const prepared = await prepare(
        result.bytes,
        {
          schemaVersion: 1,
          viewport: { ...parent.viewport },
          camera: { ...camera, ...(childEye === undefined ? {} : { eyePosition: childEye }) },
          time: instance.ageSeconds,
          ...(parentGlobalTime === undefined ? {} : { globalTime: parentGlobalTime }),
          ...(parent.scene.materialContext === undefined
            ? {}
            : {
                materialContext: {
                  ...(parent.scene.materialContext.teamColor === undefined
                    ? {}
                    : { teamColor: parent.scene.materialContext.teamColor }),
                  ...(parent.scene.materialContext.ambient === undefined
                    ? {}
                    : { ambient: parent.scene.materialContext.ambient }),
                  ...(parent.scene.materialContext.environment === undefined
                    ? {}
                    : { environment: parent.scene.materialContext.environment }),
                } as unknown as JsonValue,
              }),
          ...(clipId === undefined ? {} : { clipId }),
        },
        {
          ...options,
          modelResources: lease.value,
          rasterResources: { read: lease.value.readRaster.bind(lease.value) },
          budget: { ...options.budget, maxScalarBytes: remaining },
        },
        depth + 1,
      )
      const scene = prepared.request.scene
      composedInstances++
      const prefix = `${purpose.prefix}-${ordinal}/`
      const materialId = (id: string) => prefix + id
      const textureId = (id: string) => prefix + id
      const cost =
        scene.primitives.reduce(
          (sum, primitive) => sum + modelPrimitiveByteLength(primitive) + 1024,
          0,
        ) +
        (scene.textures ?? []).reduce(
          (sum, texture) => sum + (texture.rgba?.byteLength ?? 0) + 1024,
          0,
        ) +
        JSON.stringify(scene.materials ?? []).length * 2
      if (!Number.isSafeInteger(cost) || cost > remaining)
        throw new RangeError('nested model scene exceeds byte budget')
      remaining -= cost
      if (primitives.length + scene.primitives.length > options.budget.maxNodes)
        throw new RangeError('nested model primitives exceed budget')
      for (const primitive of scene.primitives)
        primitives.push({
          ...primitive,
          id: prefix + primitive.id,
          ...(primitive.materialId === undefined
            ? {}
            : { materialId: materialId(primitive.materialId) }),
          transform: multiplyFrames(matrix, primitive.transform ?? IDENTITY_MATERIAL_FRAME),
          tint: instance.color.map(
            (component, axis) => component * (primitive.tint?.[axis] ?? 1),
          ) as [number, number, number, number],
        })
      for (const material of scene.materials ?? [])
        materials.push({
          ...material,
          id: materialId(material.id),
          ...(material.context !== undefined || scene.materialContext === undefined
            ? {}
            : { context: scene.materialContext }),
          ...(material.baseColorTexture === undefined
            ? {}
            : { baseColorTexture: textureId(material.baseColorTexture) }),
          ...(material.textureBindings === undefined
            ? {}
            : {
                textureBindings: material.textureBindings.map(binding => ({
                  ...binding,
                  textureId: textureId(binding.textureId),
                })),
              }),
        })
      for (const texture of scene.textures ?? [])
        textures.push({ ...texture, id: textureId(texture.id) })
      diagnostics.push(...prepared.diagnostics)
      if (diagnostics.length > options.budget.maxDiagnostics)
        throw new RangeError('nested model diagnostics exceed budget')
    }
    return { primitives, materials, textures, diagnostics, composedInstances }
  } finally {
    const errors: unknown[] = []
    for (const lease of [...leases.values()].reverse())
      try {
        await lease.release()
      } catch (error) {
        errors.push(error)
      }
    if (errors.length) throw errors[0]
  }
}
