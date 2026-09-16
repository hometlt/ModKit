import type {
  SceneRendererMaterial,
  SceneRendererMaterialContext,
  SceneRendererTexture,
  SceneRendererDiagnostic,
} from '@modkit/sdk/renderer'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { textureNormalFormat } from '../materials/normal-maps.js'
import { UnsupportedCubeCoordinatesError } from '../materials/cube-maps.js'
import { snapshotEnvironment } from '../materials/environment.js'
import type { NormalMapFormat } from '@modkit/codec-kit/legacy/models/material'
import {
  createStandardMaterialPrograms,
  RENDER_MATERIAL_SHADER,
  type StandardMaterialProgram,
} from '../materials/index.js'

export interface SceneMaterialPrograms {
  readonly passes: readonly StandardMaterialProgram[]
  readonly textures: ReadonlyMap<string, SceneRendererTexture>
}

const MATERIAL_BUDGET = { maxDepth: 128, maxNodes: 1_000_000, maxBytes: 64 * 1024 * 1024 }

/** Shared CPU/GPU interpretation of shader identity, playback and already acquired resources. */
export function prepareSceneMaterialPrograms(
  materials: readonly SceneRendererMaterial[],
  textures: ReadonlyMap<string, SceneRendererTexture>,
  context: SceneRendererMaterialContext | undefined,
  diagnostics: SceneRendererDiagnostic[],
  signal?: AbortSignal,
): ReadonlyMap<string, SceneMaterialPrograms> {
  const environment = snapshotEnvironment(context?.environment)
  if (context !== undefined) {
    for (const value of [context.time, context.sequenceTime])
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        throw new TypeError('material time must be finite and nonnegative')
    if (
      context.sequenceIndex !== undefined &&
      (!Number.isSafeInteger(context.sequenceIndex) ||
        context.sequenceIndex < 0 ||
        context.sequenceIndex > 0xffffffff)
    )
      throw new TypeError('invalid material sequence index')
    for (const [vector, size] of [
      [context.teamColor, 3],
      [context.ambient, 4],
    ] as const)
      if (
        vector !== undefined &&
        (!Array.isArray(vector) ||
          vector.length !== size ||
          vector.some(value => !Number.isFinite(value) || value < 0 || value > 1))
      )
        throw new TypeError('invalid material lighting')
  }
  for (const texture of textures.values())
    if (texture.filter !== undefined && texture.filter !== 'nearest' && texture.filter !== 'linear')
      throw new TypeError('invalid material texture filter')
  const ids = new Set<string>()
  for (const material of materials) {
    if (typeof material.id !== 'string' || !material.id || ids.has(material.id))
      throw new TypeError('material ids must be unique and nonempty')
    ids.add(material.id)
  }
  const parameters = snapshotJson(
    materials.map(material => material.shader?.parameters ?? null),
    MATERIAL_BUDGET,
    signal,
  )
  if (!Array.isArray(parameters)) throw new TypeError('invalid material parameters')
  const results = new Map<string, SceneMaterialPrograms>()
  for (const [index, material] of materials.entries()) {
    signal?.throwIfAborted()
    if (material.context !== undefined) {
      const { context: instanceContext, ...plain } = material
      const prepared = prepareSceneMaterialPrograms(
        [plain],
        textures,
        context?.sceneLighting === true && instanceContext.sceneLighting === undefined
          ? { ...instanceContext, sceneLighting: true }
          : instanceContext,
        diagnostics,
        signal,
      )
      const program = prepared.get(material.id)
      if (program !== undefined) results.set(material.id, program)
      continue
    }
    if (material.simpleEffect !== undefined) {
      const resource = material.simpleEffect.textureResource
      if (
        resource !== undefined &&
        !material.textureBindings?.some(binding => binding.resourceId === resource)
      )
        diagnostics.push({
          severity: 'warning',
          code: 'common.scene/simple-effect-texture-unresolved',
          message: `Material ${material.id}: simple-effect texture ${resource} was not acquired; drawing its untextured RGBA.`,
        })
      continue
    }
    if (material.shader === undefined) continue
    if (material.shader.id !== RENDER_MATERIAL_SHADER) {
      diagnostics.push({
        severity: 'warning',
        code: 'common.scene/material-shader-unsupported',
        message: `Material ${material.id} uses unsupported shader ${material.shader.id}; rendering its base-color fallback.`,
      })
      continue
    }
    const sampler = createStandardMaterialPrograms(parameters[index], {
      budget: MATERIAL_BUDGET,
      ...(signal === undefined ? {} : { signal }),
    })
    const bound = new Map<string, SceneRendererTexture>(),
      bindings = new Map<string, string>()
    for (const binding of material.textureBindings ?? []) {
      if (
        typeof binding.resourceId !== 'string' ||
        !binding.resourceId ||
        typeof binding.textureId !== 'string' ||
        !binding.textureId ||
        bindings.has(binding.resourceId)
      )
        throw new TypeError(
          `material ${material.id} texture bindings must have unique nonempty resource ids`,
        )
      bindings.set(binding.resourceId, binding.textureId)
    }
    let missing = false
    for (const resource of sampler.resources) {
      const texture = textures.get(bindings.get(resource) ?? '')
      if (texture === undefined) {
        missing = true
        diagnostics.push({
          severity: 'warning',
          code: 'common.scene/material-texture-unresolved',
          message: `Material ${material.id} requires ${resource}; rendering its base-color fallback until its textures resolve.`,
        })
      } else bound.set(resource, texture)
    }
    if (missing) continue
    const normalMapFormats = new Map<string, NormalMapFormat>()
    for (const [id, texture] of bound) {
      const format = textureNormalFormat(texture)
      if (format !== undefined) normalMapFormats.set(id, format)
    }
    let passes: readonly StandardMaterialProgram[]
    try {
      passes = sampler.sample(
        {
          time: context?.time ?? 0,
          ...(context?.sequenceTime === undefined ? {} : { sequenceTime: context.sequenceTime }),
          ...(context?.sequenceIndex === undefined ? {} : { sequenceIndex: context.sequenceIndex }),
        },
        {
          normalMapFormats,
          textureDimensions: new Map(
            [...bound].map(([id, texture]) => [id, texture.dimension ?? '2d']),
          ),
          ...(environment === undefined ? {} : { environment }),
          ...(context?.teamColor === undefined ? {} : { teamColor: context.teamColor }),
          ...(context?.ambient === undefined ? {} : { ambient: context.ambient }),
          ...(context?.sceneLighting === true ? { sceneLighting: true } : {}),
          ...(context?.teamColorIntensity === undefined
            ? {}
            : { teamColorIntensity: context.teamColorIntensity }),
        },
        signal,
      )
    } catch (error) {
      if (!(error instanceof UnsupportedCubeCoordinatesError)) throw error
      diagnostics.push({
        severity: 'warning',
        code: 'common.scene/material-feature-unrendered',
        message: `Material ${material.id}: ${error.message}; rendering its base-color fallback.`,
      })
      continue
    }
    for (const pass of passes)
      for (const message of pass.diagnostics)
        diagnostics.push({
          severity: 'warning',
          code: 'common.scene/material-feature-unrendered',
          message: `Material ${material.id}: ${message}`,
        })
    results.set(material.id, Object.freeze({ passes, textures: bound }))
  }
  return results
}

/** Sample one acquired RGBA surface. Game material samplers own wrap; filter defaults to linear. */
export function sampleMaterialTexture(
  texture: SceneRendererTexture,
  u: number,
  v: number,
  wrapU: 'repeat' | 'clamp',
  wrapV: 'repeat' | 'clamp',
): readonly [number, number, number, number] {
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new TypeError('material UV must be finite')
  const address = (index: number, size: number, wrap: string) =>
    wrap === 'clamp' ? Math.max(0, Math.min(size - 1, index)) : ((index % size) + size) % size
  const texel = (x: number, y: number): readonly [number, number, number, number] => {
    const offset =
      (address(y, texture.height, wrapV) * texture.width + address(x, texture.width, wrapU)) * 4
    return [
      (texture.rgba[offset] ?? 0) / 255,
      (texture.rgba[offset + 1] ?? 0) / 255,
      (texture.rgba[offset + 2] ?? 0) / 255,
      (texture.rgba[offset + 3] ?? 0) / 255,
    ]
  }
  if (texture.filter === 'nearest')
    return texel(Math.floor(u * texture.width), Math.floor(v * texture.height))
  const x = u * texture.width - 0.5,
    y = v * texture.height - 0.5,
    left = Math.floor(x),
    top = Math.floor(y),
    fx = x - left,
    fy = y - top
  const a = texel(left, top),
    b = texel(left + 1, top),
    c = texel(left, top + 1),
    d = texel(left + 1, top + 1)
  const sample = (channel: 0 | 1 | 2 | 3) =>
    (a[channel] * (1 - fx) + b[channel] * fx) * (1 - fy) +
    (c[channel] * (1 - fx) + d[channel] * fx) * fy
  return [sample(0), sample(1), sample(2), sample(3)]
}
