/**
 * What the model stage sends to a resolved `common.render/scene-3d` provider.
 *
 * DOM-free on purpose, for the reason `./orbit.ts` gives at the top of its own file: the camera
 * maths is shared between the built-in 2D fallback and whatever provider the host resolved, and a
 * scene assembled here can be asserted in Node against the same headless provider the product
 * ships. Nothing in this file knows what a canvas is.
 *
 * The scene is assembled from what the model data sources already publish — geometry from
 * `common.view/model-scene-source`, colours and texture slots from
 * `common.view/model-material-source`, rest poses from `common.view/model-skeleton-source`. No
 * facet is invented and none is required: a codec that publishes only geometry gets a shaded grey
 * model, which is still the thing the parity gap is about.
 */

import type {
  ModelUpAxis,
  ModelBoneBinding,
  ModelBounds,
  ModelMaterialRef,
  ModelPrimitive,
  SceneRenderRequest,
  SceneRendererColor,
  SceneRendererDirectionalLight,
  SceneRendererMaterial,
  SceneRendererMaterialContext,
  SceneRendererTexture,
  SceneRendererPrimitive,
} from '@modkit/sdk'
import { createModelSceneSampler } from '@modkit/scene/model'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'

import type { OrbitBasis } from './orbit.js'

export type Vector3 = readonly [number, number, number]

/** Vertical field of view of the perspective camera, in radians. */
export const MODEL_FIELD_OF_VIEW = 0.8

/**
 * Neutral surface colour for a primitive whose material publishes no colour of its own.
 *
 * The same value both shipped providers already use for an unmatched `materialId`, restated here
 * so the fallback is one number rather than a coincidence between two files.
 */
export const MODEL_DEFAULT_BASE_COLOR: SceneRendererColor = Object.freeze([0.78, 0.8, 0.84, 1])

/** What a textured material modulates its texels by: nothing. */
export const MODEL_TEXTURED_BASE_COLOR: SceneRendererColor = Object.freeze([1, 1, 1, 1])

/**
 * The key light, in view-independent world space.
 *
 * Fixed rather than head-mounted: a light that follows the camera hides exactly the thing shading
 * is for, because every face the user can see is then lit identically and the silhouette carries
 * all the information again. Off-axis and above, so turning the model changes what it looks like.
 */
export const MODEL_KEY_LIGHT: SceneRendererDirectionalLight = Object.freeze({
  direction: Object.freeze([0.35, 0.72, 0.6]) as Vector3,
  color: Object.freeze([1, 1, 1, 1]) as SceneRendererColor,
  ambient: 0.28,
})

/**
 * The rotation that brings a publisher's up axis onto the viewer's.
 *
 * The orbit controller works in y-up viewer space by construction, so a z-up model is turned once,
 * here, rather than every consumer inventing its own correction. `+y` needs no rotation and
 * returns undefined so nothing is multiplied for the common case.
 *
 * Column-major, like every other matrix in this contract: it maps (x, y, z) to (x, z, -y).
 */
export function upAxisCorrection(upAxis: ModelUpAxis | undefined): Float32Array | undefined {
  if (upAxis !== '+z') return undefined
  return Float32Array.from([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
}

/** Apply a world correction to a primitive, composing with any transform it already carries. */
export function orientPrimitive(
  primitive: SceneRendererPrimitive,
  correction: Float32Array | undefined,
): SceneRendererPrimitive {
  if (correction === undefined) return primitive
  const existing = primitive.transform
  if (existing === undefined) return { ...primitive, transform: correction }
  const out = new Float32Array(16)
  for (let row = 0; row < 4; row += 1)
    for (let column = 0; column < 4; column += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1)
        sum += (correction[k * 4 + row] ?? 0) * (existing[column * 4 + k] ?? 0)
      out[column * 4 + row] = sum
    }
  return { ...primitive, transform: out }
}

export interface ModelFraming {
  readonly center: Vector3
  /** Radius of the bounding sphere. Never zero: a degenerate model still needs a camera. */
  readonly radius: number
}

const finite = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function boundsFraming(bounds: ModelBounds): ModelFraming | undefined {
  const { min, max } = bounds
  if (!min.every(finite) || !max.every(finite)) return undefined
  const center: Vector3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
  return radius > 0 ? { center, radius } : { center, radius: 1 }
}

/**
 * Where to point the camera, from the primitive's own declared bounds or its positions.
 *
 * The declared bounds are preferred because a codec that computed them knows about geometry this
 * page did not download; the positions are the fallback for a codec that publishes none. A
 * primitive with no usable vertex at all frames the unit sphere rather than producing NaN, which
 * is what a camera matrix full of NaN would do to every provider downstream.
 */
export function framePrimitive(primitive: ModelPrimitive): ModelFraming {
  if (primitive.bounds !== undefined) {
    const framing = boundsFraming(primitive.bounds)
    if (framing !== undefined) return framing
  }
  const positions = primitive.positions
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index] as number
    const y = positions[index + 1] as number
    const z = positions[index + 2] as number
    if (!finite(x) || !finite(y) || !finite(z)) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  if (minX > maxX) return { center: [0, 0, 0], radius: 1 }
  return (
    boundsFraming({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }) ?? {
      center: [0, 0, 0],
      radius: 1,
    }
  )
}

/** Frame all instances in scene coordinates, including authored node transforms. */
export function framePrimitives(primitives: readonly SceneRendererPrimitive[]): ModelFraming {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const primitive of primitives)
    for (let i = 0; i < primitive.positions.length; i += 3) {
      const x = primitive.positions[i]!,
        y = primitive.positions[i + 1]!,
        z = primitive.positions[i + 2]!
      const matrix = primitive.transform
      for (let axis = 0; axis < 3; axis++) {
        const value =
          matrix === undefined
            ? primitive.positions[i + axis]!
            : matrix[axis]! * x + matrix[4 + axis]! * y + matrix[8 + axis]! * z + matrix[12 + axis]!
        if (!Number.isFinite(value)) throw new TypeError('invalid model framing positions')
        min[axis] = Math.min(min[axis]!, value)
        max[axis] = Math.max(max[axis]!, value)
      }
    }
  return boundsFraming({ min, max }) ?? { center: [0, 0, 0], radius: 1 }
}

const dot = (left: Vector3, right: Vector3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2]

export interface CameraPlacement {
  readonly eye: Vector3
  readonly framing: ModelFraming
  /** Column-major world-to-view matrix consumed by material lighting and Fresnel. */
  readonly viewMatrix: Float32Array
  /** Column-major 4x4, exactly what `SceneRendererCamera.viewProjection` is defined to be. */
  readonly viewProjection: Float32Array
}

/**
 * A perspective camera for the current orbit pose.
 *
 * Perspective here where the 2D fallback is orthographic, and both are deliberate: the fallback
 * draws a wireframe, which reads better without foreshortening, while a shaded model without
 * perspective looks like a technical drawing of itself. The two paths share the *pose*, so
 * switching backends turns the same model the same way.
 */
export function modelCamera(
  framing: ModelFraming,
  basis: OrbitBasis,
  distanceScale: number,
  viewport: { readonly width: number; readonly height: number },
): CameraPlacement {
  const radius = framing.radius > 0 && Number.isFinite(framing.radius) ? framing.radius : 1
  // Distance that just contains the bounding sphere, then the pose's own multiplier on top of it.
  const distance = (radius / Math.sin(MODEL_FIELD_OF_VIEW / 2)) * Math.max(0.15, distanceScale)
  const { right, up, backward } = basis
  const eye: Vector3 = [
    framing.center[0] + backward[0] * distance,
    framing.center[1] + backward[1] * distance,
    framing.center[2] + backward[2] * distance,
  ]
  const aspect = viewport.height <= 0 ? 1 : viewport.width / viewport.height
  const focal = 1 / Math.tan(MODEL_FIELD_OF_VIEW / 2)
  const near = Math.max(distance - radius, radius * 0.001, 1e-4)
  const far = distance + radius * 2 + near
  const rightAxis = right as Vector3
  const upAxis = up as Vector3
  const backwardAxis = backward as Vector3

  // view (world → camera), right-handed, camera looking down its own -Z
  const view = new Float32Array(16)
  view[0] = rightAxis[0]
  view[4] = rightAxis[1]
  view[8] = rightAxis[2]
  view[12] = -dot(rightAxis, eye)
  view[1] = upAxis[0]
  view[5] = upAxis[1]
  view[9] = upAxis[2]
  view[13] = -dot(upAxis, eye)
  view[2] = backwardAxis[0]
  view[6] = backwardAxis[1]
  view[10] = backwardAxis[2]
  view[14] = -dot(backwardAxis, eye)
  view[15] = 1

  const projection = new Float32Array(16)
  projection[0] = focal / (aspect === 0 ? 1 : aspect)
  projection[5] = focal
  projection[10] = (far + near) / (near - far)
  projection[11] = -1
  projection[14] = (2 * far * near) / (near - far)

  return { eye, framing, viewMatrix: view, viewProjection: multiply4x4(projection, view) }
}

/** Column-major 4x4 product, `left * right`, in the layout every provider already reads. */
export function multiply4x4(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0
      for (let index = 0; index < 4; index += 1) {
        value += (left[index * 4 + row] as number) * (right[column * 4 + index] as number)
      }
      out[column * 4 + row] = value
    }
  }
  return out
}

/** Project a world point to pixels, or `undefined` when it falls behind the camera. */
export function projectPoint(
  viewProjection: Float32Array,
  point: Vector3,
  viewport: { readonly width: number; readonly height: number },
): readonly [number, number] | undefined {
  const x = point[0]
  const y = point[1]
  const z = point[2]
  const clipX =
    (viewProjection[0] as number) * x +
    (viewProjection[4] as number) * y +
    (viewProjection[8] as number) * z +
    (viewProjection[12] as number)
  const clipY =
    (viewProjection[1] as number) * x +
    (viewProjection[5] as number) * y +
    (viewProjection[9] as number) * z +
    (viewProjection[13] as number)
  const clipW =
    (viewProjection[3] as number) * x +
    (viewProjection[7] as number) * y +
    (viewProjection[11] as number) * z +
    (viewProjection[15] as number)
  if (!Number.isFinite(clipW) || clipW <= 1e-6) return undefined
  const ndcX = clipX / clipW
  const ndcY = clipY / clipW
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return undefined
  return [(ndcX * 0.5 + 0.5) * viewport.width, (1 - (ndcY * 0.5 + 0.5)) * viewport.height]
}

// ---------------------------------------------------------------------------------------------
// materials

/**
 * A deterministic colour for a material that declares none.
 *
 * Every format in this workspace publishes material *identity* — a name, a blend mode, layer
 * slots — and none publishes a base colour, which is why the first version of this contract could
 * only ever draw one grey. Giving each material id its own hue is not a claim about the artist's
 * intent: it is the difference between a model whose submeshes can be told apart and a grey blob,
 * and it is stable, so the same material is the same colour on every open. A codec that starts
 * publishing real colours displaces this without the viewer changing.
 */
export function materialColorFor(id: string): SceneRendererColor {
  let hash = 2_166_136_261
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16_777_619) >>> 0
  }
  const hue = (hash % 3600) / 3600
  // Kept pale and desaturated: shading has to survive on top of it, and a saturated palette would
  // read as "the viewer chose these colours" rather than as lit geometry.
  const [red, green, blue] = hueToRgb(hue, 0.28, 0.72)
  return [red, green, blue, 1]
}

function hueToRgb(hue: number, saturation: number, lightness: number): Vector3 {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue * 6
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const match = lightness - chroma / 2
  const table: readonly Vector3[] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ]
  const base = table[Math.min(5, Math.floor(sector))] ?? table[0]
  const rgb = base as Vector3
  return [rgb[0] + match, rgb[1] + match, rgb[2] + match]
}

/**
 * The layer slots a base-colour texture may live in, most specific first.
 *
 * Publisher-qualified spellings, compared with punctuation and case removed: `slot` is documented
 * as the publisher's own vocabulary, and M3's `diffuse`, a glTF `baseColor` and an OBJ `map_Kd`
 * mean the same surface without agreeing on how to write it.
 */
const BASE_COLOR_SLOTS: readonly string[] = Object.freeze([
  'diffuse',
  'basecolor',
  'albedo',
  'color',
  'colour',
  'mapkd',
])

const slotKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '')

/**
 * The resource a material's base-colour layer names, when it names one.
 *
 * Every layer in the slot is considered, not just the first: a material may declare the same slot
 * more than once — a declared-but-unbound layer beside a bound one is normal in M3 — and stopping
 * at the first match would report a texture-less material for a model that has one.
 */
export function baseColorResourceOf(material: ModelMaterialRef): string | undefined {
  const layers = material.layers ?? []
  for (const slot of BASE_COLOR_SLOTS) {
    for (const layer of layers) {
      if (slotKey(layer.slot) === slot && layer.resourceId !== undefined) return layer.resourceId
    }
  }
  return undefined
}

export interface ModelSceneMaterials {
  readonly materials: readonly SceneRendererMaterial[]
  readonly textures: readonly SceneRendererTexture[]
}

/**
 * Renderer materials for the material facet this subject published, plus whatever texels resolved.
 *
 * `textures` is keyed by the *resource* id the material layer names, so a texture that failed to
 * decode is simply absent and its material keeps its base colour — the renderer reports the
 * dangling reference and still draws the model, which is the §4.2 shape: a named degradation
 * rather than an empty frame.
 */
export function sceneMaterials(
  refs: readonly ModelMaterialRef[],
  textures: ReadonlyMap<string, SceneRendererTexture>,
  shaded: boolean,
): ModelSceneMaterials {
  const used = new Map<string, SceneRendererTexture>()
  const materials = refs.map((ref): SceneRendererMaterial => {
    const resourceId = baseColorResourceOf(ref)
    const texture = resourceId === undefined ? undefined : textures.get(resourceId)
    if (texture !== undefined) used.set(texture.id, texture)
    const bindings: { resourceId: string; textureId: string }[] = []
    const boundResources = new Set<string>()
    for (const layer of ref.layers ?? []) {
      if (layer.resourceId === undefined || boundResources.has(layer.resourceId)) continue
      const layerTexture = textures.get(layer.resourceId)
      if (layerTexture === undefined) continue
      boundResources.add(layer.resourceId)
      used.set(layerTexture.id, layerTexture)
      bindings.push({ resourceId: layer.resourceId, textureId: layerTexture.id })
    }
    return Object.freeze({
      id: ref.id,
      /*
       * A bound texture is the surface's own albedo, so it is shown at its own value. Modulating
       * it by the untextured grey made textured models darker than untextured ones — worst on the
       * dark textures where detail matters most.
       */
      // A stated factor multiplies the texture, or is the colour itself without one (glTF).
      baseColor:
        ref.baseColorFactor ??
        (texture === undefined ? materialColorFor(ref.id) : MODEL_TEXTURED_BASE_COLOR),
      ...(texture === undefined ? {} : { baseColorTexture: texture.id }),
      shading: shaded && ref.unlit !== true ? ('lambert' as const) : ('unlit' as const),
      ...(ref.doubleSided === undefined ? {} : { doubleSided: ref.doubleSided }),
      ...(ref.depthWrite === undefined ? {} : { depthWrite: ref.depthWrite }),
      ...(ref.priority === undefined ? {} : { priority: ref.priority }),
      ...(ref.alphaMode === undefined ? {} : { alphaMode: ref.alphaMode }),
      ...(ref.alphaCutoff === undefined ? {} : { alphaCutoff: ref.alphaCutoff }),
      ...(ref.shader === undefined ? {} : { shader: ref.shader }),
      ...(bindings.length === 0 ? {} : { textureBindings: Object.freeze(bindings) }),
    })
  })
  return Object.freeze({
    materials: Object.freeze(materials),
    textures: Object.freeze([...used.values()]),
  })
}

// ---------------------------------------------------------------------------------------------
// the request

export interface ModelSceneRequestOptions {
  readonly primitive?: SceneRendererPrimitive
  readonly primitives?: readonly SceneRendererPrimitive[]
  readonly camera: CameraPlacement
  readonly viewport: { readonly width: number; readonly height: number }
  readonly materials?: readonly SceneRendererMaterial[]
  readonly textures?: readonly SceneRendererTexture[]
  readonly clearColor?: SceneRendererColor
  readonly light?: SceneRendererDirectionalLight
  readonly materialContext?: SceneRendererMaterialContext
  readonly signal?: AbortSignal
}

/** One bounded render request. The provider does not retain any of it. */
export function modelSceneRequest(options: ModelSceneRequestOptions): SceneRenderRequest {
  if ((options.primitive === undefined) === (options.primitives === undefined))
    throw new TypeError('provide either one primitive or a complete primitive list')
  return {
    scene: {
      primitives: options.primitives ?? [options.primitive!],
      ...(options.materials === undefined || options.materials.length === 0
        ? {}
        : { materials: options.materials }),
      ...(options.textures === undefined || options.textures.length === 0
        ? {}
        : { textures: options.textures }),
      ...(options.light === undefined ? {} : { light: options.light }),
      ...(options.materialContext === undefined
        ? {}
        : { materialContext: options.materialContext }),
    },
    camera: {
      viewProjection: options.camera.viewProjection,
      viewMatrix: options.camera.viewMatrix,
      eyePosition: options.camera.eye,
    },
    viewport: options.viewport,
    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),
    outputKind: 'rgba8',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

// ---------------------------------------------------------------------------------------------
// skeleton overlay

export interface SkeletonJoint {
  readonly boneIndex: number
  readonly name: string | null
  readonly position: Vector3
  /** Index into the same array, when the parent was published and has a pose of its own. */
  readonly parent?: number
}

/** Joint positions use only explicit local TRS and parent bindings. Legacy restMatrix stays descriptive. */
export function skeletonJoints(bindings: readonly ModelBoneBinding[]): readonly SkeletonJoint[] {
  const hierarchyIds = [
    ...new Set(
      bindings.flatMap(binding =>
        typeof binding.hierarchyId === 'string' && binding.hierarchyId ? [binding.hierarchyId] : [],
      ),
    ),
  ]
  const joints: SkeletonJoint[] = []
  for (const hierarchyId of hierarchyIds) {
    const hierarchy = bindings.filter(binding => binding.hierarchyId === hierarchyId)
    const offset = joints.length
    const sampled = createModelSceneSampler({
      nodes: createModelSkeletonNodes(hierarchy, hierarchyId),
      meshes: [],
      primitives: [],
      skeleton: hierarchy,
    }).sample(0).joints
    joints.push(
      ...sampled.map(joint => ({
        ...joint,
        ...(joint.parent === undefined ? {} : { parent: joint.parent + offset }),
      })),
    )
  }
  return Object.freeze(joints)
}
