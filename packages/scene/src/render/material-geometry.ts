import type {
  SceneRendererCamera,
  SceneRendererDiagnostic,
  SceneRendererDirectionalLight,
  SceneRendererPrimitive,
} from '@modkit/sdk/renderer'
import { multiplyMat4 } from '@modkit/codec-kit/model-math/sequence-pose'
import { snapshotEyePosition } from '../materials/environment.js'
import { invertMaterialFrame } from '../materials/frame.js'
import { materialSkinOf } from './material-skin.js'
import { primitiveVertexTints } from './tint.js'
import type {
  StandardMaterialDefines,
  Vec2,
  Vec3,
  Vec4,
} from '@modkit/codec-kit/model-math/standard-material-glsl'

export interface MaterialWorldLighting {
  readonly lightDirection: Vec3
  /** Camera origin derived from the view matrix; independent of the environment observer. */
  readonly eyePosition: Vec3
  readonly viewDirection: Vec3
  readonly orthographic: boolean
}

export interface MaterialVertex {
  /** Actual scene-world geometry for explicit material policies, independent of UV frames. */
  readonly environment?: {
    readonly position: Vec3
    readonly normal: Vec3
    readonly tangent: Vec3
    readonly bitangent: Vec3
    /** Constant inverse-transpose columns mapping object directions into world space. */
    readonly objectNormalMatrix: Float32Array
    /** Unnormalized world-space vector. Fragment interpolation precedes normalization. */
    readonly eyeToVertex?: Vec3
    /** Constant across the draw, with perspective eye vectors evaluated per fragment. */
    readonly worldLighting?: MaterialWorldLighting
  }
  readonly uv: readonly Vec2[]
  readonly modelPosition: Vec3
  readonly modelNormal: Vec3
  readonly worldPosition: Vec3
  readonly worldNormal: Vec3
  readonly viewPosition: Vec3
  readonly viewNormal: Vec3
  readonly lightDirection: Vec3
  readonly halfVector: Vec3
  readonly viewDirection: Vec3
  readonly clip: Vec4
  readonly color: Vec4
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const value = (array: ArrayLike<number>, index: number) => {
  const result = array[index]
  if (result === undefined || !Number.isFinite(result))
    throw new TypeError('invalid material geometry component')
  return result
}
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const unit = (a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 => {
  const length = Math.hypot(...a)
  return length > 1e-9 ? [a[0] / length, a[1] / length, a[2] / length] : fallback
}
const read3 = (array: Float32Array, index: number): Vec3 => [
  value(array, index * 3),
  value(array, index * 3 + 1),
  value(array, index * 3 + 2),
]
const read4 = (array: Float32Array, index: number): Vec4 => [
  value(array, index * 4),
  value(array, index * 4 + 1),
  value(array, index * 4 + 2),
  value(array, index * 4 + 3),
]
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const tangentFallback = (normal: Vec3): Vec3 =>
  unit(cross(Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], normal), [1, 0, 0])

/**
 * A triangle's face normal, tangent and bitangent: from its edges and the UV deltas at its corners
 * (`a`, `b`, `c`: the corners' offsets in `uv`), or the face's fallback frame without UVs or with a
 * degenerate UV determinant (`degenerate`).
 */
function triangleTangentFrame(
  p: Vec3,
  q: Vec3,
  r: Vec3,
  uv: ArrayLike<number> | undefined,
  a: number,
  b: number,
  c: number,
): Readonly<{ face: Vec3; tangent: Vec3; bitangent: Vec3; degenerate: boolean }> {
  const e1 = subtract(q, p),
    e2 = subtract(r, p),
    face = unit(cross(e1, e2))
  let tangent: Vec3 = tangentFallback(face),
    bitangent: Vec3 = cross(face, tangent)
  if (uv === undefined) return { face, tangent, bitangent, degenerate: false }
  const u1 = value(uv, b) - value(uv, a),
    v1 = value(uv, b + 1) - value(uv, a + 1),
    u2 = value(uv, c) - value(uv, a),
    v2 = value(uv, c + 1) - value(uv, a + 1),
    determinant = u1 * v2 - u2 * v1
  if (!(Math.abs(determinant) > 1e-9)) return { face, tangent, bitangent, degenerate: true }
  tangent = [
    (e1[0] * v2 - e2[0] * v1) / determinant,
    (e1[1] * v2 - e2[1] * v1) / determinant,
    (e1[2] * v2 - e2[2] * v1) / determinant,
  ]
  bitangent = [
    (e2[0] * u1 - e1[0] * u2) / determinant,
    (e2[1] * u1 - e1[1] * u2) / determinant,
    (e2[2] * u1 - e1[2] * u2) / determinant,
  ]
  return { face, tangent, bitangent, degenerate: false }
}

/** `tangent` made orthogonal to `normal`, with the handedness `bitangent` gives it (glTF TANGENT.w). */
function orthogonalTangent(normal: Vec3, tangent: Vec3, bitangent: Vec3): Vec4 {
  const n = unit(normal),
    nt = dot(n, tangent),
    along = unit(
      [tangent[0] - n[0] * nt, tangent[1] - n[1] * nt, tangent[2] - n[2] * nt],
      tangentFallback(n),
    )
  return [...along, dot(cross(n, along), bitangent) < 0 ? -1 : 1]
}

/**
 * The normal and tangent the material path gives each corner of the triangle `a`, `b`, `c` (vertex
 * indices) of a primitive it expands for want of them (prepareMaterialGeometry): the face normal
 * as float32, and the UV tangent made orthogonal to it with its handedness. A caller whose triangles
 * share their frame, as the two of a flat quad do, can give its vertices these instead.
 */
export function materialTriangleFrame(
  positions: Float32Array,
  uv: ArrayLike<number> | undefined,
  a: number,
  b: number,
  c: number,
): Readonly<{ normal: Vec3; tangent: Vec4 }> {
  const { face, tangent, bitangent } = triangleTangentFrame(
    read3(positions, a),
    read3(positions, b),
    read3(positions, c),
    uv,
    a * 2,
    b * 2,
    c * 2,
  )
  const normal: Vec3 = [Math.fround(face[0]), Math.fround(face[1]), Math.fround(face[2])]
  return { normal, tangent: orthogonalTangent(normal, tangent, bitangent) }
}

/**
 * Tangents of an indexed mesh, per vertex: a skin keeps its vertices, whose joints and weights are
 * theirs, so its bind pose takes each triangle's frame summed at its corners and made orthogonal to
 * the vertex's own normal there, instead of expanding into triangles of their own.
 */
function vertexTangents(
  positions: Float32Array,
  normals: Float32Array,
  uv: ArrayLike<number> | undefined,
  triangles: Uint32Array,
): Float32Array {
  const count = positions.length / 3
  const tangentSums = new Float64Array(count * 3),
    bitangentSums = new Float64Array(count * 3)
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = value(triangles, i),
      b = value(triangles, i + 1),
      c = value(triangles, i + 2)
    const frame = triangleTangentFrame(
      read3(positions, a),
      read3(positions, b),
      read3(positions, c),
      uv,
      a * 2,
      b * 2,
      c * 2,
    )
    for (const corner of [a, b, c])
      for (let axis = 0; axis < 3; axis++) {
        const at = corner * 3 + axis
        tangentSums[at] = tangentSums[at]! + frame.tangent[axis]!
        bitangentSums[at] = bitangentSums[at]! + frame.bitangent[axis]!
      }
  }
  const tangents = new Float32Array(count * 4)
  for (let vertex = 0; vertex < count; vertex++) {
    const sum = (sums: Float64Array): Vec3 => [
      sums[vertex * 3]!,
      sums[vertex * 3 + 1]!,
      sums[vertex * 3 + 2]!,
    ]
    tangents.set(
      orthogonalTangent(read3(normals, vertex), sum(tangentSums), sum(bitangentSums)),
      vertex * 4,
    )
  }
  return tangents
}
export function point(matrix: Float32Array, vector: Vec3, w: number): Vec4 {
  const component = (row: number) =>
    value(matrix, row) * vector[0] +
    value(matrix, row + 4) * vector[1] +
    value(matrix, row + 8) * vector[2] +
    value(matrix, row + 12) * w
  return [component(0), component(1), component(2), component(3)]
}
const xyz = (v: Vec4): Vec3 => [v[0], v[1], v[2]]
function affine(matrix: Float32Array | undefined, name: string) {
  const result = matrix ?? IDENTITY
  if (
    !(result instanceof Float32Array) ||
    result.length !== 16 ||
    !result.every(Number.isFinite) ||
    result[3] !== 0 ||
    result[7] !== 0 ||
    result[11] !== 0 ||
    result[15] !== 1
  )
    throw new TypeError(`${name} must be a finite affine matrix`)
  return result
}

/** Inverse-transpose direction matrix, without dividing by determinant magnitude. Normalization
 * removes that magnitude; the cofactor form also has a defined rank-two flattening behavior. */
function normalMatrix(matrix: Float32Array): { matrix: Float32Array; sign: number } {
  const a: Vec3 = [value(matrix, 0), value(matrix, 1), value(matrix, 2)],
    b: Vec3 = [value(matrix, 4), value(matrix, 5), value(matrix, 6)],
    c: Vec3 = [value(matrix, 8), value(matrix, 9), value(matrix, 10)]
  const columns = [cross(b, c), cross(c, a), cross(a, b)],
    sign = dot(a, columns[0] ?? [0, 0, 0]) < 0 ? -1 : 1
  return { matrix: Float32Array.from(columns.flat(), component => component * sign), sign }
}
const normal = (matrix: Float32Array, vector: Vec3) =>
  unit([
    value(matrix, 0) * vector[0] + value(matrix, 3) * vector[1] + value(matrix, 6) * vector[2],
    value(matrix, 1) * vector[0] + value(matrix, 4) * vector[1] + value(matrix, 7) * vector[2],
    value(matrix, 2) * vector[0] + value(matrix, 5) * vector[1] + value(matrix, 8) * vector[2],
  ])

function lightingVector(vector: Vec3): Vec3 {
  const captured: Vec3 = [vector[0], vector[1], vector[2]]
  if (
    captured.some(
      component => !Number.isFinite(component) || !Number.isFinite(Math.fround(component)),
    )
  )
    throw new TypeError('world lighting requires finite float32 vectors')
  const result: Vec3 = [
    Math.fround(captured[0]),
    Math.fround(captured[1]),
    Math.fround(captured[2]),
  ]
  return Object.freeze(result)
}

function lightingDirection(vector: Vec3): Vec3 {
  const captured = lightingVector(vector),
    magnitude = Math.hypot(...captured)
  return lightingVector(
    magnitude === 0
      ? [0, 0, 1]
      : [captured[0] / magnitude, captured[1] / magnitude, captured[2] / magnitude],
  )
}

function worldLightingInputs(
  view: Float32Array,
  light: SceneRendererDirectionalLight | undefined,
  orthographic: boolean,
): MaterialWorldLighting {
  let inverse: Float32Array
  try {
    inverse = Float32Array.from(invertMaterialFrame(Array.from(view)))
  } catch (cause) {
    throw new TypeError('world shading requires an invertible float32 view transform', { cause })
  }
  return Object.freeze({
    lightDirection: lightingDirection(light?.direction ?? [0, 0, 1]),
    eyePosition: lightingVector(xyz(point(inverse, [0, 0, 0], 1))),
    viewDirection: lightingDirection(xyz(point(inverse, [0, 0, 1], 0))),
    orthographic,
  })
}

/** A draw's validated model matrix (identity when it has none). */
export function materialModelMatrix(primitive: SceneRendererPrimitive): Float32Array {
  return affine(primitive.transform, 'model transform')
}

/** Inverse-transpose direction matrix of a model matrix and its determinant sign (see `normalMatrix`). */
export function materialNormalMatrix(matrix: Float32Array): { matrix: Float32Array; sign: number } {
  return normalMatrix(matrix)
}

/**
 * Whether a model matrix mirrors what it places: the sign of materialNormalMatrix, a·(b×c) of its
 * columns in the same arithmetic, without making the matrix (a draw asks it every frame).
 */
export function materialMirrors(matrix: Float32Array): boolean {
  const a0 = value(matrix, 0),
    a1 = value(matrix, 1),
    a2 = value(matrix, 2)
  const b0 = value(matrix, 4),
    b1 = value(matrix, 5),
    b2 = value(matrix, 6)
  const c0 = value(matrix, 8),
    c1 = value(matrix, 9),
    c2 = value(matrix, 10)
  return a0 * (b1 * c2 - b2 * c1) + a1 * (b2 * c0 - b0 * c2) + a2 * (b0 * c1 - b1 * c0) < 0
}

/** The camera- and light-dependent part of `materialGeometry`: one per frame for every draw. */
export function materialFrameGeometry(
  camera: SceneRendererCamera,
  light?: SceneRendererDirectionalLight,
  worldShading = false,
) {
  const view = affine(camera.viewMatrix, 'view transform')
  const lightDirection = unit(xyz(point(view, unit(light?.direction ?? [0, 0, 1]), 0)))
  const orthographic =
    camera.viewProjection[3] === 0 &&
    camera.viewProjection[7] === 0 &&
    camera.viewProjection[11] === 0
  const worldLighting = worldShading ? worldLightingInputs(view, light, orthographic) : undefined
  return {
    view,
    lightDirection,
    orthographic,
    ...(worldLighting === undefined ? {} : { worldLighting }),
  }
}

/** Both providers consume these same matrices and vertex-space conventions. */
export function materialGeometry(
  primitive: SceneRendererPrimitive,
  camera: SceneRendererCamera,
  light?: SceneRendererDirectionalLight,
  worldToMaterial?: readonly number[],
  environmentEnabled = false,
  worldShading = false,
) {
  const model = affine(primitive.transform, 'model transform')
  const { view, lightDirection, orthographic, worldLighting } = materialFrameGeometry(
    camera,
    light,
    worldShading,
  )
  const modelView = new Float32Array(16)
  multiplyMat4(modelView, 0, view, 0, model, 0)
  if (!modelView.every(Number.isFinite)) throw new TypeError('model/view transform exceeds float32')
  const materialWorld = new Float32Array(16)
  multiplyMat4(
    materialWorld,
    0,
    worldToMaterial === undefined ? IDENTITY : Float32Array.from(worldToMaterial),
    0,
    model,
    0,
  )
  if (!materialWorld.every(Number.isFinite))
    throw new TypeError('material world transform exceeds float32')
  const worldNormal = normalMatrix(materialWorld),
    viewNormal = normalMatrix(modelView)
  const environmentNormal = environmentEnabled || worldShading ? normalMatrix(model) : undefined
  const environmentEye = snapshotEyePosition(camera.eyePosition)
  if (environmentNormal !== undefined && !environmentNormal.matrix.every(Number.isFinite))
    throw new TypeError('scene world normal matrix exceeds float32')
  return {
    model,
    modelView,
    materialWorld,
    worldNormal: worldNormal.matrix,
    viewNormal: viewNormal.matrix,
    orientation: viewNormal.sign,
    lightDirection,
    orthographic,
    ...(worldLighting === undefined ? {} : { worldLighting }),
    ...(environmentNormal === undefined
      ? {}
      : {
          environmentNormalMatrix: environmentNormal.matrix,
          environmentOrientation: environmentNormal.sign,
        }),
    vertex(index: number): MaterialVertex {
      if (primitive.normals === undefined || primitive.tangents === undefined)
        throw new TypeError('material geometry requires prepared normals and tangents')
      const position = read3(primitive.positions, index),
        sourceNormal = unit(read3(primitive.normals, index)),
        sourceTangent = read4(primitive.tangents, index)
      const world = point(model, position, 1),
        inView = xyz(point(modelView, position, 1)),
        n = normal(viewNormal.matrix, sourceNormal)
      const tangent = xyz(
          point(modelView, [sourceTangent[0], sourceTangent[1], sourceTangent[2]], 0),
        ),
        nt = dot(n, tangent)
      const t = unit(
        [tangent[0] - n[0] * nt, tangent[1] - n[1] * nt, tangent[2] - n[2] * nt],
        tangentFallback(n),
      )
      const handedness = (sourceTangent[3] < 0 ? -1 : 1) * viewNormal.sign,
        bitangent = cross(n, t)
      const b: Vec3 = [
        bitangent[0] * handedness,
        bitangent[1] * handedness,
        bitangent[2] * handedness,
      ]
      const tangentSpace = (v: Vec3): Vec3 => [dot(v, t), dot(v, b), dot(v, n)]
      const eye = orthographic ? ([0, 0, 1] as const) : unit([-inView[0], -inView[1], -inView[2]])
      const half = unit([
        eye[0] + lightDirection[0],
        eye[1] + lightDirection[1],
        eye[2] + lightDirection[2],
      ])
      let environment: MaterialVertex['environment']
      if (environmentNormal !== undefined) {
        const position = xyz(world)
        const n = normal(environmentNormal.matrix, sourceNormal)
        const tangent = xyz(point(model, [sourceTangent[0], sourceTangent[1], sourceTangent[2]], 0))
        const nt = dot(n, tangent)
        const t = unit(
          [tangent[0] - n[0] * nt, tangent[1] - n[1] * nt, tangent[2] - n[2] * nt],
          tangentFallback(n),
        )
        const handedness = (sourceTangent[3] < 0 ? -1 : 1) * environmentNormal.sign
        const bitangent = cross(n, t)
        environment = {
          position,
          normal: n,
          tangent: t,
          bitangent: [
            bitangent[0] * handedness,
            bitangent[1] * handedness,
            bitangent[2] * handedness,
          ],
          objectNormalMatrix: environmentNormal.matrix,
          ...(environmentEye === undefined
            ? {}
            : { eyeToVertex: subtract(position, environmentEye) }),
          ...(worldLighting === undefined ? {} : { worldLighting }),
        }
      }
      return {
        ...(environment === undefined ? {} : { environment }),
        uv: [0, 1, 2, 3].map(set => {
          const buffer =
            primitive.textureCoordinateSets?.find(candidate => candidate.set === set)
              ?.coordinates ?? (set === 0 ? primitive.textureCoordinates : undefined)
          return buffer === undefined
            ? [0, 0]
            : [value(buffer, index * 2), value(buffer, index * 2 + 1)]
        }),
        modelPosition: position,
        modelNormal: sourceNormal,
        worldPosition: xyz(point(materialWorld, position, 1)),
        worldNormal: normal(worldNormal.matrix, sourceNormal),
        viewPosition: orthographic ? [0, 0, -1] : inView,
        viewNormal: n,
        lightDirection: tangentSpace(lightDirection),
        halfVector: tangentSpace([-half[0], -half[1], -half[2]]),
        viewDirection: tangentSpace(eye),
        clip: point(camera.viewProjection, xyz(world), world[3]),
        color: primitive.colors === undefined ? [1, 1, 1, 1] : read4(primitive.colors, index),
      }
    },
  }
}

export interface MaterialGeometryPreparationOptions {
  /** Select the UV set only when tangents are missing. Omission preserves the UV0 fallback. */
  readonly texCoord?: number
  readonly diagnostics?: SceneRendererDiagnostic[]
}

/**
 * Vertex arrays found finite, and the largest value of index arrays. A primitive's arrays are
 * immutable snapshots (prepared geometry is kept by them as well), and an animated model prepares
 * its geometry every frame while keeping most of them: a skin gets new positions, normals and
 * tangents, but keeps its texture coordinates, colors and indices, which are then not read again.
 */
const finiteArrays = new WeakSet<Float32Array>()
const largestIndices = new WeakMap<Uint32Array, number>()

/** Index of a float32's high 16 bits in its two halves: 1 on little-endian platforms. */
const HIGH_HALF = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1 ? 1 : 0

// An animated model prepares its geometry every frame: plain loops, not a callback per element.
// A float32 is not finite exactly when all its exponent bits are set. Reading the high half of each
// value as a 16-bit integer never boxes a number, where a float read in code the engine has not
// optimized allocates one per element (~11 MiB a frame on Amphion).
function allFinite(values: Float32Array): boolean {
  if (finiteArrays.has(values)) return true
  const halves = new Uint16Array(values.buffer, values.byteOffset, values.length * 2)
  for (let index = HIGH_HALF; index < halves.length; index += 2)
    if ((halves[index]! & 0x7f80) === 0x7f80) return false
  finiteArrays.add(values)
  return true
}

/** Every value is below `count` (unsigned indices are integers and not negative). */
function allBelow(indices: Uint32Array, count: number): boolean {
  let largest = largestIndices.get(indices)
  if (largest === undefined) {
    largest = -1
    for (let index = 0; index < indices.length; index++)
      if (indices[index]! > largest) largest = indices[index]!
    largestIndices.set(indices, largest)
  }
  return largest < count
}

/** Generate missing flat normals and UV tangents once, shared by CPU and GPU. Supplied shading
 * attributes stay authored. Expanded renderer geometry carries no second skin binding. */
export function prepareMaterialGeometry(
  primitive: SceneRendererPrimitive,
  maxBytes: number,
  options?: MaterialGeometryPreparationOptions,
): SceneRendererPrimitive {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError('invalid material geometry byte budget')
  const requestedTexCoord = options?.texCoord
  if (
    requestedTexCoord !== undefined &&
    (!Number.isInteger(requestedTexCoord) || requestedTexCoord < 0 || requestedTexCoord > 4)
  )
    throw new TypeError('tangent generation texCoord must be an integer from 0 to 4')
  if (
    !(primitive.positions instanceof Float32Array) ||
    primitive.positions.length % 3 !== 0 ||
    !allFinite(primitive.positions)
  )
    throw new TypeError('invalid material positions')
  const count = primitive.positions.length / 3
  if (
    primitive.indices !== undefined &&
    (!(primitive.indices instanceof Uint32Array) || !allBelow(primitive.indices, count))
  )
    throw new TypeError('material geometry index is out of range')
  for (const [buffer, width] of [
    [primitive.normals, 3],
    [primitive.tangents, 4],
    [primitive.colors, 4],
    [primitive.textureCoordinates, 2],
  ] as const)
    if (
      buffer !== undefined &&
      (!(buffer instanceof Float32Array) || buffer.length !== count * width || !allFinite(buffer))
    )
      throw new TypeError('invalid material vertex attributes')
  const skin = materialSkinOf(primitive)
  if (
    skin !== undefined &&
    (primitive.normals === undefined ||
      skin.joints.length !== count * 4 ||
      skin.weights.length !== count * 4 ||
      !allFinite(skin.weights))
  )
    throw new TypeError('invalid material skin')
  const vertexTints = primitiveVertexTints(primitive)
  if (
    vertexTints !== undefined &&
    (!(vertexTints instanceof Float32Array) ||
      vertexTints.length !== count * 4 ||
      !allFinite(vertexTints))
  )
    throw new TypeError('invalid material vertex tints')
  const uvSets = new Set<number>()
  for (const set of primitive.textureCoordinateSets ?? []) {
    if (!Number.isInteger(set.set) || set.set < 0 || set.set > 4 || uvSets.has(set.set))
      throw new TypeError('invalid or duplicate material UV set')
    uvSets.add(set.set)
    if (
      !(set.coordinates instanceof Float32Array) ||
      set.coordinates.length !== count * 2 ||
      !allFinite(set.coordinates)
    )
      throw new TypeError('invalid material UV attributes')
  }
  if (primitive.normals !== undefined && primitive.tangents !== undefined) return primitive
  const texCoord = requestedTexCoord ?? 0
  const uv =
    primitive.tangents === undefined
      ? (primitive.textureCoordinateSets?.find(set => set.set === texCoord)?.coordinates ??
        (texCoord === 0 ? primitive.textureCoordinates : undefined))
      : undefined
  if (primitive.tangents === undefined && requestedTexCoord !== undefined && uv === undefined)
    throw new TypeError(
      `primitive ${primitive.id} lacks TEXCOORD_${texCoord} for tangent generation`,
    )
  const order = primitive.indices,
    length = order?.length ?? count
  const triangleCount =
    primitive.topology === 'triangles'
      ? Math.floor(length / 3)
      : primitive.topology === 'triangle-strip' || primitive.topology === 'triangle-fan'
        ? Math.max(0, length - 2)
        : 0
  const width =
    10 +
    (primitive.colors ? 4 : 0) +
    (primitive.textureCoordinates ? 2 : 0) +
    (primitive.textureCoordinateSets?.length ?? 0) * 2
  if (triangleCount * 3 * (width * 4 + 4) > maxBytes)
    throw new RangeError('prepared material geometry exceeds byte budget')
  const triangles = new Uint32Array(triangleCount * 3)
  let cursor = 0
  const append = (a: number, b: number, c: number) => {
    triangles[cursor++] = order?.[a] ?? a
    triangles[cursor++] = order?.[b] ?? b
    triangles[cursor++] = order?.[c] ?? c
  }
  if (primitive.topology === 'triangles')
    for (let i = 0; i + 2 < length; i += 3) append(i, i + 1, i + 2)
  else if (primitive.topology === 'triangle-strip')
    for (let i = 0; i + 2 < length; i++) {
      if (i % 2) append(i + 1, i, i + 2)
      else append(i, i + 1, i + 2)
    }
  else if (primitive.topology === 'triangle-fan')
    for (let i = 1; i + 1 < length; i++) append(0, i, i + 1)
  else return primitive
  if (!allBelow(triangles, count)) throw new TypeError('material geometry index is out of range')
  if (skin !== undefined)
    return Object.freeze({
      ...primitive,
      tangents: vertexTangents(primitive.positions, primitive.normals!, uv, triangles),
    })
  // One expansion per source array: UV sets that share coordinates (a sprite's UV0-3) share the
  // expanded array too, and with it one GPU buffer.
  const expanded = new Map<Float32Array, Float32Array>()
  const expand = (source: Float32Array, width: number) => {
    const kept = expanded.get(source)
    if (kept !== undefined && kept.length === triangles.length * width) return kept
    const output = new Float32Array(triangles.length * width)
    for (let target = 0; target < triangles.length; target++) {
      const from = triangles[target]! * width,
        to = target * width
      for (let component = 0; component < width; component++)
        output[to + component] = source[from + component]!
    }
    expanded.set(source, output)
    return output
  }
  const positions = expand(primitive.positions, 3),
    normals = primitive.normals
      ? expand(primitive.normals, 3)
      : new Float32Array(triangles.length * 3),
    tangents = primitive.tangents
      ? expand(primitive.tangents, 4)
      : new Float32Array(triangles.length * 4)
  let degenerateTriangles = 0
  for (let i = 0; i < triangles.length; i += 3) {
    const { face, tangent, bitangent, degenerate } = triangleTangentFrame(
      read3(positions, i),
      read3(positions, i + 1),
      read3(positions, i + 2),
      uv,
      value(triangles, i) * 2,
      value(triangles, i + 1) * 2,
      value(triangles, i + 2) * 2,
    )
    if (degenerate) degenerateTriangles++
    for (let j = i; j < i + 3; j++) {
      if (primitive.normals === undefined) normals.set(face, j * 3)
      if (primitive.tangents === undefined)
        tangents.set(orthogonalTangent(read3(normals, j), tangent, bitangent), j * 4)
    }
  }
  if (requestedTexCoord !== undefined && degenerateTriangles > 0)
    options?.diagnostics?.push({
      severity: 'warning',
      code: 'common.scene/tangent-generation-degenerate-uv',
      message: `Tangent generation for TEXCOORD_${texCoord} used geometric fallback for ${degenerateTriangles} triangle(s) with a degenerate UV determinant.`,
      primitiveId: primitive.id,
    })
  const expandedPrimitive: SceneRendererPrimitive & { readonly vertexTints?: Float32Array } = {
    id: primitive.id,
    topology: 'triangles',
    positions,
    normals,
    tangents,
    ...(vertexTints === undefined ? {} : { vertexTints: expand(vertexTints, 4) }),
    ...(primitive.materialId === undefined ? {} : { materialId: primitive.materialId }),
    ...(primitive.transform === undefined ? {} : { transform: primitive.transform }),
    ...(primitive.depthBias === undefined ? {} : { depthBias: primitive.depthBias }),
    // the instance's colour and fade stay with the expanded triangles
    ...(primitive.tint === undefined ? {} : { tint: primitive.tint }),
    ...(primitive.colors === undefined ? {} : { colors: expand(primitive.colors, 4) }),
    ...(primitive.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: expand(primitive.textureCoordinates, 2) }),
    ...(primitive.textureCoordinateSets === undefined
      ? {}
      : {
          textureCoordinateSets: primitive.textureCoordinateSets.map(set => ({
            set: set.set,
            coordinates: expand(set.coordinates, 2),
          })),
        }),
  }
  return expandedPrimitive
}

/**
 * Placement from attributes: four model-matrix columns (codec-kit's instancing names) that an
 * instanced draw feeds per instance and a single draw sets as constant attribute values. Both then
 * run the same arithmetic, so coplanar parts of instanced and single draws keep equal depths. The
 * frames `materialGeometry` computes on the CPU are derived here: the cofactor normal matrices and
 * determinant signs of model-view, material-world and model.
 */
const PLACEMENT_DECLARATIONS = `uniform mat4 u_view, u_worldToMaterial;
in vec4 a_instanceMatrix0, a_instanceMatrix1, a_instanceMatrix2, a_instanceMatrix3;
mat3 sceneCofactor(mat3 m){return mat3(cross(m[1],m[2]),cross(m[2],m[0]),cross(m[0],m[1]));}
float sceneOrientationOf(mat3 m){return dot(m[0],cross(m[1],m[2]))<0.0?-1.0:1.0;}
`

function placementLocals(worldGeometry: boolean): string {
  return `
  mat4 model=mat4(a_instanceMatrix0,a_instanceMatrix1,a_instanceMatrix2,a_instanceMatrix3);
  mat4 modelView=u_view*model,materialWorld=u_worldToMaterial*model;
  float orientation=sceneOrientationOf(mat3(modelView));
  mat3 viewNormalMatrix=sceneCofactor(mat3(modelView))*orientation;
  mat3 worldNormalMatrix=sceneCofactor(mat3(materialWorld))*sceneOrientationOf(mat3(materialWorld));${worldGeometry ? '\n  float objectOrientation=sceneOrientationOf(mat3(model));\n  mat3 objectNormalMatrix=sceneCofactor(mat3(model))*objectOrientation;' : ''}`
}

/**
 * Skinning on the GPU (see ModelSceneSkin): each vertex blends four matrices of its draw's palette,
 * read from a float texture of four texels a matrix from the palette's first texel. The weights
 * arrive over their sum, and an influence without weight names the identity, as the CPU kernel
 * skips it; normals and tangents take the blend's upper 3x3, their length left to the stage. With
 * the placement from attributes the first texel is one too, `a_instanceSkinBase`: per instance, so
 * placements of one mesh in different poses draw at once (TASK_CORE_RTS_PREVIEW_RENDER C5), and a
 * constant value for a single draw, as its model matrix; otherwise the uniform `u_skinBase`.
 */
function skinDeclarations(placementAttributes: boolean): string {
  const base = placementAttributes ? 'int(a_instanceSkinBase+0.5)' : 'u_skinBase'
  return `in vec4 a_skinJoints, a_skinWeights;
uniform highp sampler2D u_skinPalette;
${placementAttributes ? 'in float a_instanceSkinBase;' : 'uniform int u_skinBase;'}
mat4 skinMatrix(float joint){int texel=${base}+int(joint)*4,width=textureSize(u_skinPalette,0).x;ivec2 at=ivec2(texel%width,texel/width);
  return mat4(texelFetch(u_skinPalette,at,0),texelFetch(u_skinPalette,at+ivec2(1,0),0),texelFetch(u_skinPalette,at+ivec2(2,0),0),texelFetch(u_skinPalette,at+ivec2(3,0),0));}
`
}
const SKIN_LOCALS = `
  mat4 skin=skinMatrix(a_skinJoints.x)*a_skinWeights.x+skinMatrix(a_skinJoints.y)*a_skinWeights.y+skinMatrix(a_skinJoints.z)*a_skinWeights.z+skinMatrix(a_skinJoints.w)*a_skinWeights.w;
  vec3 skinPosition=(skin*vec4(a_position,1.0)).xyz,skinNormal=mat3(skin)*a_normal;
  vec4 skinTangent=vec4(mat3(skin)*a_tangent.xyz,a_tangent.w);`

/** Scene vertex stage for the shared fragment contract: normalized inverse-transpose normals,
 * tangent-space lighting, and explicit camera frames. Native shader builders remain immutable.
 * `placementAttributes` takes the model matrix from attributes (see PLACEMENT_DECLARATIONS);
 * without it the stage reads the per-draw matrices from uniforms. `skinned` poses the vertices by
 * the draw's skin first (see skinDeclarations); `tinted` hands each vertex's tint to the fragment
 * stage, flat (see primitiveVertexTints). */
export function sceneMaterialVertexSource(
  defines: StandardMaterialDefines,
  environmentEnabled = false,
  worldShading = false,
  placementAttributes = false,
  skinned = false,
  tinted = false,
): string {
  const worldGeometry = environmentEnabled || worldShading
  // The vertex as the stage reads it: its attributes, or its skinned pose.
  const position = skinned ? 'skinPosition' : 'a_position'
  const normal = skinned ? 'skinNormal' : 'a_normal'
  const tangent = skinned ? 'skinTangent' : 'a_tangent'
  const name = placementAttributes
    ? {
        model: 'model',
        modelView: 'modelView',
        materialWorld: 'materialWorld',
        worldNormal: 'worldNormalMatrix',
        viewNormal: 'viewNormalMatrix',
        orientation: 'orientation',
        objectNormal: 'objectNormalMatrix',
        objectOrientation: 'objectOrientation',
      }
    : {
        model: 'u_model',
        modelView: 'u_modelView',
        materialWorld: 'u_materialWorld',
        worldNormal: 'u_worldNormalMatrix',
        viewNormal: 'u_viewNormalMatrix',
        orientation: 'u_orientation',
        objectNormal: 'u_sceneWorldNormalMatrix',
        objectOrientation: 'u_sceneWorldOrientation',
      }
  return `#version 300 es
precision highp float;
${placementAttributes ? 'uniform mat4 u_viewProjection;' : 'uniform mat4 u_model, u_modelView, u_viewProjection, u_materialWorld;\nuniform mat3 u_worldNormalMatrix, u_viewNormalMatrix;'}
uniform vec3 u_lightDirection;
${defines.sceneLighting ? 'uniform vec3 u_sceneFillViewDirection0, u_sceneFillViewDirection1;\nout vec3 v_sceneFillDir0, v_sceneFillDir1;\nout vec3 v_sceneShadowWorld;' : ''}
${worldGeometry && !placementAttributes ? 'uniform mat3 u_sceneWorldNormalMatrix;\nuniform float u_sceneWorldOrientation;\n' : ''}uniform float ${placementAttributes ? '' : 'u_orientation, '}u_orthographic;
in vec3 a_position, a_normal; in vec4 a_tangent;
${skinned ? skinDeclarations(placementAttributes) : ''}${tinted ? 'in vec4 a_vertexTint; flat out vec4 v_vertexTint;\n' : ''}${Array.from({ length: defines.uvSetCount }, (_, i) => `in vec2 a_uv${i}; out vec2 v_uv${i};`).join('\n')}
${defines.usesVertexAlpha || defines.usesVertexColor ? 'in vec4 a_color; out vec4 v_vertexColor;' : ''}
out vec3 v_normal, v_lightDir, v_halfVec, v_viewDir, v_viewPosition, v_viewNormal;
out vec3 v_modelPosition, v_modelNormal, v_worldPosition, v_worldNormal;
out vec3 v_sceneWorldPosition;
${worldGeometry ? 'out vec3 v_sceneWorldNormal, v_sceneWorldTangent, v_sceneWorldBitangent;\n' : ''}out vec4 v_clipPosition;
vec3 unit(vec3 v,vec3 fallback){float len=length(v);return len>1e-9?v/len:fallback;}
${placementAttributes ? PLACEMENT_DECLARATIONS : ''}void main(){${placementAttributes ? placementLocals(worldGeometry) : ''}${skinned ? SKIN_LOCALS : ''}
  vec4 world=${name.model}*vec4(${position},1.0);
  v_sceneWorldPosition=world.xyz;
  vec3 view=(${name.modelView}*vec4(${position},1.0)).xyz;
  vec3 n=unit(${name.viewNormal}*${normal},vec3(0.0,0.0,1.0));
  vec3 rawT=mat3(${name.modelView})*${tangent}.xyz;
  vec3 fallback=unit(cross(abs(n.z)<0.9?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0),n),vec3(1.0,0.0,0.0));
  vec3 t=unit(rawT-n*dot(n,rawT),fallback);
  vec3 b=cross(n,t)*(${tangent}.w<0.0?-1.0:1.0)*${name.orientation};
  mat3 tbn=transpose(mat3(t,b,n));
  vec3 eye=u_orthographic>0.5?vec3(0.0,0.0,1.0):unit(-view,vec3(0.0,0.0,1.0));
  v_normal=vec3(0.0,0.0,1.0); v_lightDir=tbn*u_lightDirection;
${defines.sceneLighting ? '  v_sceneFillDir0=tbn*u_sceneFillViewDirection0; v_sceneFillDir1=tbn*u_sceneFillViewDirection1;\n  v_sceneShadowWorld=world.xyz;' : ''}
  v_halfVec=tbn*(-unit(eye+u_lightDirection,vec3(0.0,0.0,1.0))); v_viewDir=tbn*eye;
  v_viewPosition=u_orthographic>0.5?vec3(0.0,0.0,-1.0):view; v_viewNormal=n;
${
  worldGeometry
    ? `  vec3 sceneN=unit(${name.objectNormal}*${normal},vec3(0.0,0.0,1.0));
  vec3 sceneRawT=mat3(${name.model})*${tangent}.xyz;
  vec3 sceneFallback=unit(cross(abs(sceneN.z)<0.9?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0),sceneN),vec3(1.0,0.0,0.0));
  vec3 sceneT=unit(sceneRawT-sceneN*dot(sceneN,sceneRawT),sceneFallback);
  v_sceneWorldNormal=sceneN;v_sceneWorldTangent=sceneT;
  v_sceneWorldBitangent=cross(sceneN,sceneT)*(${tangent}.w<0.0?-1.0:1.0)*${name.objectOrientation};
`
    : ''
}  v_modelPosition=${position};v_modelNormal=unit(${normal},vec3(0.0,0.0,1.0));
  v_worldPosition=(${name.materialWorld}*vec4(${position},1.0)).xyz;v_worldNormal=unit(${name.worldNormal}*${normal},vec3(0.0,0.0,1.0));
  v_clipPosition=u_viewProjection*world;gl_Position=v_clipPosition;
  ${Array.from({ length: defines.uvSetCount }, (_, i) => `v_uv${i}=a_uv${i};`).join('\n')}
  ${defines.usesVertexAlpha || defines.usesVertexColor ? 'v_vertexColor=a_color;' : ''}${tinted ? '\n  v_vertexTint=a_vertexTint;' : ''}
}`
}
