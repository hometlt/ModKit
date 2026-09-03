import { SCENE_RENDERER_CONTRACT } from '@modkit/sdk/renderer'

const RENDERER_ID = 'modkit.headless'
const DEFAULT_COLOR = Object.freeze([0.78, 0.8, 0.84, 1])
const DEFAULT_CLEAR_COLOR = Object.freeze([0, 0, 0, 0])
const MAX_DIMENSION = 4_096
const MAX_PIXELS = 16_777_216

const recordOf = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined

const nonEmptyString = value => typeof value === 'string' && value.trim().length > 0

function dimension(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DIMENSION) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${MAX_DIMENSION}`)
  }
  return value
}

function matrix(value, label) {
  if (!(value instanceof Float32Array) || value.length !== 16 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must be a finite 4x4 Float32Array`)
  }
  return value
}

function color(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(component =>
      typeof component === 'number' && Number.isFinite(component)
        ? component >= 0 && component <= 1
        : false,
    )
  ) {
    throw new TypeError(`${label} must contain four finite components in the range 0..1`)
  }
  return value
}

const byte = value => Math.round(value * 255)

function clearFrame(rgba, clearColor) {
  const red = byte(clearColor[0])
  const green = byte(clearColor[1])
  const blue = byte(clearColor[2])
  const alpha = byte(clearColor[3])
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = red
    rgba[offset + 1] = green
    rgba[offset + 2] = blue
    rgba[offset + 3] = alpha
  }
}

function multiplyPoint(transform, x, y, z, w) {
  return [
    transform[0] * x + transform[4] * y + transform[8] * z + transform[12] * w,
    transform[1] * x + transform[5] * y + transform[9] * z + transform[13] * w,
    transform[2] * x + transform[6] * y + transform[10] * z + transform[14] * w,
    transform[3] * x + transform[7] * y + transform[11] * z + transform[15] * w,
  ]
}

function screenVertex(positions, index, model, viewProjection, width, height) {
  const offset = index * 3
  const x = positions[offset]
  const y = positions[offset + 1]
  const z = positions[offset + 2]
  if (x === undefined || y === undefined || z === undefined) return undefined
  const world = model === undefined ? [x, y, z, 1] : multiplyPoint(model, x, y, z, 1)
  const clip = multiplyPoint(viewProjection, world[0], world[1], world[2], world[3])
  const clipW = clip[3]
  if (clipW === undefined || !Number.isFinite(clipW) || Math.abs(clipW) < 0.000_001) {
    return undefined
  }
  const ndcX = clip[0] / clipW
  const ndcY = clip[1] / clipW
  const ndcZ = clip[2] / clipW
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY) || !Number.isFinite(ndcZ)) {
    return undefined
  }
  return {
    x: (ndcX * 0.5 + 0.5) * (width - 1),
    y: (1 - (ndcY * 0.5 + 0.5)) * (height - 1),
    z: ndcZ,
    /* Reciprocal clip w, kept per vertex so attributes interpolate perspective-correctly. */
    invW: 1 / clipW,
    world: [world[0], world[1], world[2]],
  }
}

const edge = (a, b, x, y) => (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)

/** Model-space direction transformed by the upper 3x3 of a column-major model matrix. */
function transformDirection(model, x, y, z) {
  if (model === undefined) return [x, y, z]
  return [
    model[0] * x + model[4] * y + model[8] * z,
    model[1] * x + model[5] * y + model[9] * z,
    model[2] * x + model[6] * y + model[10] * z,
  ]
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  return length < 1e-9 ? undefined : [vector[0] / length, vector[1] / length, vector[2] / length]
}

/** Geometric normal of a world-space triangle, for geometry that publishes no normals. */
function faceNormal(first, second, third) {
  const ax = second.world[0] - first.world[0]
  const ay = second.world[1] - first.world[1]
  const az = second.world[2] - first.world[2]
  const bx = third.world[0] - first.world[0]
  const by = third.world[1] - first.world[1]
  const bz = third.world[2] - first.world[2]
  return normalize([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx])
}

/**
 * Lambert term for one surface normal.
 *
 * Two-sided on purpose: game meshes are full of triangles whose winding does not agree with their
 * intended facing, and a one-sided term would render half of a real model black. `abs` costs the
 * ability to distinguish inside from outside, which this renderer never had anyway.
 */
function lambert(normal, light) {
  const cosine = Math.abs(
    normal[0] * light.direction[0] +
      normal[1] * light.direction[1] +
      normal[2] * light.direction[2],
  )
  return Math.min(1, light.ambient + (1 - light.ambient) * cosine)
}

/** Nearest-neighbour sample, in the texture's own top-left-origin space. */
function sampleTexture(texture, u, v) {
  const wrap = (value, extent, mode) => {
    if (!Number.isFinite(value)) return 0
    if (mode === 'clamp') return Math.min(extent - 1, Math.max(0, Math.floor(value * extent)))
    const index = Math.floor(value * extent) % extent
    return index < 0 ? index + extent : index
  }
  const x = wrap(u, texture.width, texture.wrapU ?? 'repeat')
  const y = wrap(v, texture.height, texture.wrapV ?? 'repeat')
  const offset = (y * texture.width + x) * 4
  return [
    (texture.rgba[offset] ?? 255) / 255,
    (texture.rgba[offset + 1] ?? 255) / 255,
    (texture.rgba[offset + 2] ?? 255) / 255,
    (texture.rgba[offset + 3] ?? 255) / 255,
  ]
}

function rasterizeTriangle(context, vertices, surface, uvs, normals) {
  const [first, second, third] = vertices
  const area = edge(first, second, third.x, third.y)
  if (!Number.isFinite(area) || Math.abs(area) < 0.000_001) return 0
  const minimumX = Math.max(0, Math.floor(Math.min(first.x, second.x, third.x)))
  const maximumX = Math.min(context.width - 1, Math.ceil(Math.max(first.x, second.x, third.x)))
  const minimumY = Math.max(0, Math.floor(Math.min(first.y, second.y, third.y)))
  const maximumY = Math.min(context.height - 1, Math.ceil(Math.max(first.y, second.y, third.y)))
  const base = surface.baseColor
  const light = context.light
  const shaded = light !== undefined && surface.shading === 'lambert'
  /*
   * Per-vertex normals when the primitive published them, one face normal otherwise. Computed once
   * per triangle rather than per fragment: a flat-shaded triangle needs one, and a smooth-shaded
   * one needs the three it already has.
   */
  const flatNormal = shaded && normals === undefined ? faceNormal(first, second, third) : undefined
  const flatShade = flatNormal === undefined ? 1 : lambert(flatNormal, light)
  const alpha = byte(base[3])
  let fragments = 0
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const sampleX = x + 0.5
      const sampleY = y + 0.5
      const firstWeight = edge(second, third, sampleX, sampleY) / area
      const secondWeight = edge(third, first, sampleX, sampleY) / area
      const thirdWeight = edge(first, second, sampleX, sampleY) / area
      if (firstWeight < 0 || secondWeight < 0 || thirdWeight < 0) continue
      const sampleDepth = firstWeight * first.z + secondWeight * second.z + thirdWeight * third.z
      const pixel = y * context.width + x
      if (sampleDepth >= context.depth[pixel]) continue
      context.depth[pixel] = sampleDepth
      let red = base[0]
      let green = base[1]
      let blue = base[2]
      if (surface.texture !== undefined && uvs !== undefined) {
        // perspective-correct: interpolate attribute/w and 1/w, then divide
        const invW =
          firstWeight * first.invW + secondWeight * second.invW + thirdWeight * third.invW
        if (invW > 1e-9) {
          const u =
            (firstWeight * uvs[0][0] * first.invW +
              secondWeight * uvs[1][0] * second.invW +
              thirdWeight * uvs[2][0] * third.invW) /
            invW
          const v =
            (firstWeight * uvs[0][1] * first.invW +
              secondWeight * uvs[1][1] * second.invW +
              thirdWeight * uvs[2][1] * third.invW) /
            invW
          const texel = sampleTexture(surface.texture, u, v)
          red *= texel[0]
          green *= texel[1]
          blue *= texel[2]
        }
      }
      let shade = flatShade
      if (shaded && normals !== undefined) {
        const smooth = normalize([
          firstWeight * normals[0][0] + secondWeight * normals[1][0] + thirdWeight * normals[2][0],
          firstWeight * normals[0][1] + secondWeight * normals[1][1] + thirdWeight * normals[2][1],
          firstWeight * normals[0][2] + secondWeight * normals[1][2] + thirdWeight * normals[2][2],
        ])
        shade = smooth === undefined ? 1 : lambert(smooth, light)
      }
      if (shaded) {
        red *= shade * light.color[0]
        green *= shade * light.color[1]
        blue *= shade * light.color[2]
      }
      const offset = pixel * 4
      context.frame[offset] = byte(Math.min(1, Math.max(0, red)))
      context.frame[offset + 1] = byte(Math.min(1, Math.max(0, green)))
      context.frame[offset + 2] = byte(Math.min(1, Math.max(0, blue)))
      context.frame[offset + 3] = alpha
      fragments += 1
    }
  }
  return fragments
}

function textureTable(textures) {
  const table = new Map()
  for (const texture of textures ?? []) {
    if (!nonEmptyString(texture.id) || table.has(texture.id)) {
      throw new TypeError('renderer textures must have unique non-empty ids')
    }
    const width = dimension(texture.width, `texture ${texture.id} width`)
    const height = dimension(texture.height, `texture ${texture.id} height`)
    if (!(texture.rgba instanceof Uint8Array) || texture.rgba.length !== width * height * 4) {
      throw new TypeError(`texture ${texture.id} must carry width * height * 4 RGBA8 bytes`)
    }
    table.set(texture.id, texture)
  }
  return table
}

/**
 * Materials as this renderer needs them: a colour, an optional resolved texture, a shading model.
 *
 * A material naming a texture the scene did not carry keeps its base colour and produces a
 * diagnostic — the reference is a fact about the model, and dropping the primitive would turn a
 * missing file into a missing mesh.
 */
function materialSurfaces(materials, textures, diagnostics) {
  const surfaces = new Map()
  for (const material of materials ?? []) {
    if (!nonEmptyString(material.id) || surfaces.has(material.id)) {
      throw new TypeError('renderer materials must have unique non-empty ids')
    }
    const shading = material.shading ?? 'unlit'
    if (shading !== 'unlit' && shading !== 'lambert') {
      throw new TypeError(`material ${material.id} declares an unknown shading model`)
    }
    let texture
    if (material.baseColorTexture !== undefined) {
      texture = textures.get(material.baseColorTexture)
      if (texture === undefined) {
        diagnostics.push(
          Object.freeze({
            severity: 'warning',
            code: 'modkit.headless/texture-missing',
            message: `material ${material.id} names texture ${material.baseColorTexture}, which the scene did not carry`,
          }),
        )
      }
    }
    surfaces.set(
      material.id,
      Object.freeze({
        baseColor: color(material.baseColor, `material ${material.id} baseColor`),
        shading,
        ...(texture === undefined ? {} : { texture }),
      }),
    )
  }
  return surfaces
}

const DEFAULT_SURFACE = Object.freeze({ baseColor: DEFAULT_COLOR, shading: 'unlit' })

/** Normalised light, or `undefined` for a scene that declared none — which means unlit. */
function sceneLight(value) {
  if (value === undefined) return undefined
  const record = recordOf(value)
  if (record === undefined) throw new TypeError('scene light must be an object')
  const direction = normalize(
    Array.isArray(record.direction) ? record.direction : [Number.NaN, Number.NaN, Number.NaN],
  )
  if (direction === undefined) {
    throw new TypeError('scene light direction must be a finite non-zero xyz vector')
  }
  const ambient = record.ambient ?? 0.25
  if (typeof ambient !== 'number' || !Number.isFinite(ambient) || ambient < 0 || ambient > 1) {
    throw new TypeError('scene light ambient must be a number in the range 0..1')
  }
  return Object.freeze({
    direction,
    ambient,
    color: color(record.color ?? [1, 1, 1, 1], 'scene light color'),
  })
}

function triangleElements(topology, elementCount) {
  if (topology === 'triangles') {
    return Array.from({ length: Math.floor(elementCount / 3) }, (_, index) => {
      const first = index * 3
      return [first, first + 1, first + 2]
    })
  }
  if (topology === 'triangle-strip') {
    return Array.from({ length: Math.max(0, elementCount - 2) }, (_, index) =>
      index % 2 === 0 ? [index, index + 1, index + 2] : [index + 1, index, index + 2],
    )
  }
  if (topology === 'triangle-fan') {
    return Array.from({ length: Math.max(0, elementCount - 2) }, (_, index) => [
      0,
      index + 1,
      index + 2,
    ])
  }
  return undefined
}

function renderPrimitive(context, primitive) {
  if (!nonEmptyString(primitive.id)) throw new TypeError('renderer primitive id must be non-empty')
  if (!(primitive.positions instanceof Float32Array) || primitive.positions.length % 3 !== 0) {
    throw new TypeError(`primitive ${primitive.id} positions must be an xyz Float32Array`)
  }
  if (primitive.indices !== undefined && !(primitive.indices instanceof Uint32Array)) {
    throw new TypeError(`primitive ${primitive.id} indices must be a Uint32Array`)
  }
  const model =
    primitive.transform === undefined
      ? undefined
      : matrix(primitive.transform, `primitive ${primitive.id} transform`)
  const vertexCount = primitive.positions.length / 3
  const order = primitive.indices
  const elementCount = order?.length ?? vertexCount
  const elements = triangleElements(primitive.topology, elementCount)
  if (elements === undefined) {
    context.diagnostics.push(
      Object.freeze({
        severity: 'warning',
        code: 'modkit.headless/unsupported-topology',
        message: `headless renderer skipped ${primitive.topology}`,
        primitiveId: primitive.id,
      }),
    )
    return
  }
  const surface =
    primitive.materialId === undefined
      ? DEFAULT_SURFACE
      : (context.materials.get(primitive.materialId) ?? DEFAULT_SURFACE)
  const uvBuffer =
    surface.texture === undefined || !(primitive.textureCoordinates instanceof Float32Array)
      ? undefined
      : primitive.textureCoordinates
  const normalBuffer =
    context.light === undefined ||
    surface.shading !== 'lambert' ||
    !(primitive.normals instanceof Float32Array) ||
    primitive.normals.length < primitive.positions.length
      ? undefined
      : primitive.normals
  for (const element of elements) {
    context.signal?.throwIfAborted()
    const indices = element.map(index => order?.[index] ?? index)
    if (indices.some(index => index >= vertexCount)) {
      throw new TypeError(`primitive ${primitive.id} contains an out-of-range index`)
    }
    const vertices = indices.map(index =>
      screenVertex(
        primitive.positions,
        index,
        model,
        context.viewProjection,
        context.width,
        context.height,
      ),
    )
    if (vertices.some(vertex => vertex === undefined)) continue
    const uvs =
      uvBuffer === undefined
        ? undefined
        : indices.map(index => [uvBuffer[index * 2] ?? 0, uvBuffer[index * 2 + 1] ?? 0])
    const normals =
      normalBuffer === undefined
        ? undefined
        : indices.map(index =>
            transformDirection(
              model,
              normalBuffer[index * 3] ?? 0,
              normalBuffer[index * 3 + 1] ?? 0,
              normalBuffer[index * 3 + 2] ?? 0,
            ),
          )
    context.triangles += 1
    context.fragments += rasterizeTriangle(context, vertices, surface, uvs, normals)
  }
}

/** Deterministic DOM-free implementation of the portable scene-renderer contract. */
export async function renderHeadless(request) {
  request.signal?.throwIfAborted()
  if (request.outputKind !== 'rgba8') {
    throw new TypeError(`headless renderer cannot produce ${request.outputKind}`)
  }
  const scene = recordOf(request.scene)
  const camera = recordOf(request.camera)
  const viewport = recordOf(request.viewport)
  if (scene === undefined || !Array.isArray(scene.primitives)) {
    throw new TypeError('headless renderer requires a scene primitive array')
  }
  if (camera === undefined || viewport === undefined) {
    throw new TypeError('headless renderer requires camera and viewport objects')
  }
  const width = dimension(viewport.width, 'viewport width')
  const height = dimension(viewport.height, 'viewport height')
  if (width * height > MAX_PIXELS) {
    throw new TypeError(`headless renderer refuses more than ${MAX_PIXELS} output pixels`)
  }
  const frame = new Uint8Array(width * height * 4)
  const depth = new Float32Array(width * height)
  depth.fill(Number.POSITIVE_INFINITY)
  clearFrame(frame, color(request.clearColor ?? DEFAULT_CLEAR_COLOR, 'clearColor'))
  const diagnostics = []
  const context = {
    width,
    height,
    frame,
    depth,
    viewProjection: matrix(camera.viewProjection, 'camera viewProjection'),
    materials: materialSurfaces(scene.materials, textureTable(scene.textures), diagnostics),
    light: sceneLight(scene.light),
    diagnostics,
    triangles: 0,
    fragments: 0,
    signal: request.signal,
  }
  for (const primitive of scene.primitives) renderPrimitive(context, primitive)
  return Object.freeze({
    outputKind: 'rgba8',
    width,
    height,
    rgba: frame,
    diagnostics: Object.freeze(context.diagnostics),
    statistics: Object.freeze({
      primitives: scene.primitives.length,
      triangles: context.triangles,
      fragments: context.fragments,
    }),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([SCENE_RENDERER_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== SCENE_RENDERER_CONTRACT || selection.major !== 1) {
    throw new TypeError(`unsupported renderer selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({
    value: Object.freeze({
      contract: SCENE_RENDERER_CONTRACT,
      rendererId: RENDERER_ID,
      outputKinds: Object.freeze(['rgba8']),
      render: renderHeadless,
    }),
    release: async () => undefined,
  })
}
