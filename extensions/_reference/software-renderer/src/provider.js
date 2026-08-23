import { SCENE_RENDERER_CONTRACT } from '@modkitx-x3/sdk/renderer'

const RENDERER_ID = 'reference.software'
const DEFAULT_COLOR = Object.freeze([0.8, 0.8, 0.8, 1])
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
  }
}

const edge = (a, b, x, y) => (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)

function rasterizeTriangle(frame, depth, width, height, vertices, materialColor) {
  const [first, second, third] = vertices
  const area = edge(first, second, third.x, third.y)
  if (!Number.isFinite(area) || Math.abs(area) < 0.000_001) return 0
  const minimumX = Math.max(0, Math.floor(Math.min(first.x, second.x, third.x)))
  const maximumX = Math.min(width - 1, Math.ceil(Math.max(first.x, second.x, third.x)))
  const minimumY = Math.max(0, Math.floor(Math.min(first.y, second.y, third.y)))
  const maximumY = Math.min(height - 1, Math.ceil(Math.max(first.y, second.y, third.y)))
  const red = byte(materialColor[0])
  const green = byte(materialColor[1])
  const blue = byte(materialColor[2])
  const alpha = byte(materialColor[3])
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
      const pixel = y * width + x
      if (sampleDepth >= depth[pixel]) continue
      depth[pixel] = sampleDepth
      const offset = pixel * 4
      frame[offset] = red
      frame[offset + 1] = green
      frame[offset + 2] = blue
      frame[offset + 3] = alpha
      fragments += 1
    }
  }
  return fragments
}

function materialColors(materials) {
  const colors = new Map()
  for (const material of materials ?? []) {
    if (!nonEmptyString(material.id) || colors.has(material.id)) {
      throw new TypeError('renderer materials must have unique non-empty ids')
    }
    colors.set(material.id, color(material.baseColor, `material ${material.id} baseColor`))
  }
  return colors
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
  if (primitive.topology !== 'triangles') {
    context.diagnostics.push(
      Object.freeze({
        severity: 'warning',
        code: 'reference.software/unsupported-topology',
        message: `software renderer skipped ${primitive.topology}`,
        primitiveId: primitive.id,
      }),
    )
    return
  }

  const vertexCount = primitive.positions.length / 3
  const order = primitive.indices
  const elementCount = order?.length ?? vertexCount
  const materialColor =
    primitive.materialId === undefined
      ? DEFAULT_COLOR
      : (context.materials.get(primitive.materialId) ?? DEFAULT_COLOR)
  for (let element = 0; element + 2 < elementCount; element += 3) {
    context.signal?.throwIfAborted()
    const firstIndex = order?.[element] ?? element
    const secondIndex = order?.[element + 1] ?? element + 1
    const thirdIndex = order?.[element + 2] ?? element + 2
    if (firstIndex >= vertexCount || secondIndex >= vertexCount || thirdIndex >= vertexCount) {
      throw new TypeError(`primitive ${primitive.id} contains an out-of-range index`)
    }
    const first = screenVertex(
      primitive.positions,
      firstIndex,
      model,
      context.viewProjection,
      context.width,
      context.height,
    )
    const second = screenVertex(
      primitive.positions,
      secondIndex,
      model,
      context.viewProjection,
      context.width,
      context.height,
    )
    const third = screenVertex(
      primitive.positions,
      thirdIndex,
      model,
      context.viewProjection,
      context.width,
      context.height,
    )
    if (first === undefined || second === undefined || third === undefined) continue
    context.triangles += 1
    context.fragments += rasterizeTriangle(
      context.frame,
      context.depth,
      context.width,
      context.height,
      [first, second, third],
      materialColor,
    )
  }
}

export async function renderSoftware(request) {
  request.signal?.throwIfAborted()
  if (request.outputKind !== 'rgba8') {
    throw new TypeError(`software renderer cannot produce ${request.outputKind}`)
  }
  const scene = recordOf(request.scene)
  if (scene === undefined || !Array.isArray(scene.primitives)) {
    throw new TypeError('software renderer requires a scene primitive array')
  }
  const camera = recordOf(request.camera)
  const viewport = recordOf(request.viewport)
  if (camera === undefined || viewport === undefined) {
    throw new TypeError('software renderer requires camera and viewport objects')
  }
  const width = dimension(viewport.width, 'viewport width')
  const height = dimension(viewport.height, 'viewport height')
  if (width * height > MAX_PIXELS) {
    throw new TypeError(`software renderer refuses more than ${MAX_PIXELS} output pixels`)
  }
  const viewProjection = matrix(camera.viewProjection, 'camera viewProjection')
  const clearColor = color(request.clearColor ?? DEFAULT_CLEAR_COLOR, 'clearColor')
  const frame = new Uint8Array(width * height * 4)
  const depth = new Float32Array(width * height)
  depth.fill(Number.POSITIVE_INFINITY)
  clearFrame(frame, clearColor)
  const context = {
    width,
    height,
    frame,
    depth,
    viewProjection,
    materials: materialColors(scene.materials),
    diagnostics: [],
    triangles: 0,
    fragments: 0,
    signal: request.signal,
  }
  for (const primitive of scene.primitives) {
    request.signal?.throwIfAborted()
    renderPrimitive(context, primitive)
  }
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
      render: renderSoftware,
    }),
    release: async () => undefined,
  })
}
