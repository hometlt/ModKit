import type {
  Lease,
  ModelPrimitive,
  ModelSceneInfo,
  ModelSceneSource,
  ViewerModule,
} from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { createOrbitController, type OrbitBasis } from './orbit.js'
import { createViewGizmo } from './gizmo.js'

export {
  createOrbitController,
  type OrbitBasis,
  type OrbitController,
  type OrbitPose,
  type ViewAxis,
} from './orbit.js'
export { createViewGizmo, GIZMO_SIZE, type ViewGizmo, type ViewGizmoOptions } from './gizmo.js'

export const MODEL_MAXIMUM_PRIMITIVE_BYTES = 64 * 1024 * 1024

/**
 * The optional model facets this stage will read when a subject publishes them.
 *
 * Listed as contract ids and read through one loop: the stage calls `info()` on whatever turned up
 * and prints the counts. There is no `if (format === …)` anywhere in this file, which is the point
 * — a facet contract with a generic consumer is what §2.7 asks for before a candidate can be
 * admitted, and one viewer reading five different codecs' facets the same way is that consumer.
 */
export const MODEL_FACET_CONTRACTS = Object.freeze([
  'common.view/model-resource-refs-source',
  'common.view/model-skeleton-source',
  'common.view/model-animation-source',
  'common.view/model-collision-source',
  'common.view/model-material-source',
] as const)

/** Facet id → the one count worth putting on a single readout line. */
const FACET_READOUT: Readonly<Record<string, { label: string; key: string }>> = Object.freeze({
  'common.view/model-resource-refs-source': { label: 'resources', key: 'references' },
  'common.view/model-skeleton-source': { label: 'bones', key: 'bindings' },
  'common.view/model-animation-source': { label: 'clips', key: 'clips' },
  'common.view/model-collision-source': { label: 'collision', key: 'volumes' },
  'common.view/model-material-source': { label: 'materials', key: 'materials' },
})

export interface ModelStageModel {
  readonly info: ModelSceneInfo
  readonly primitive?: ModelPrimitive
}

/**
 * Read every published facet's `info()` and render it as text.
 *
 * A facet the subject does not publish has no binding, so it is simply absent from the line — the
 * viewer never says "0 clips" for a format that has no animation plane at all, which would be
 * indistinguishable from a format whose animations it failed to read.
 */
export async function readModelFacets(
  sources: Parameters<typeof unknownSourceLease>[0],
  slot: Parameters<typeof unknownSourceLease>[1],
  // structural on purpose: the only thing this needs from a mount scope is somewhere to park the
  // leases it opens, which lets the loop be exercised without a DOM
  scope: { lease(lease: Lease<unknown>): Lease<unknown> },
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const parts: string[] = []
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease(sources, slot, contract)
    if (lease === undefined) continue
    scope.lease(lease)
    const readout = FACET_READOUT[contract]
    const source = lease.value as { info(abort?: AbortSignal): Promise<Record<string, unknown>> }
    const info = await source.info(signal)
    const value = info[readout?.key ?? '']
    if (typeof value === 'number') parts.push(`${value} ${readout?.label ?? contract}`)
  }
  return parts
}

export async function loadModelStage(
  source: ModelSceneSource,
  signal?: AbortSignal,
): Promise<ModelStageModel> {
  const [info, meshes] = await Promise.all([
    source.info(signal),
    source.meshes({ limit: 1 }, signal),
  ])
  const primitiveId = meshes.items[0]?.primitiveIds[0]
  const primitive =
    primitiveId === undefined || source.primitive === undefined
      ? undefined
      : await source.primitive(primitiveId, { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES }, signal)
  return { info, ...(primitive === undefined ? {} : { primitive }) }
}

/**
 * Orthographic wireframe projection along the camera's view direction.
 *
 * Orthographic, not perspective, on purpose: this is the built-in fallback stage that runs when no
 * GPU renderer provider is resolved, and a wireframe with no depth cue reads better without
 * foreshortening. A provider that wants a perspective camera drives the same `OrbitController`.
 */
function drawPrimitive(
  canvas: HTMLCanvasElement,
  primitive: ModelPrimitive,
  basis: OrbitBasis,
  distanceScale: number,
): void {
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')
  const width = 720
  const height = 480
  canvas.width = width
  canvas.height = height
  context.clearRect(0, 0, width, height)
  const positions = primitive.positions
  if (positions.length < 3) return
  if (positions.length % 3 !== 0 || !positions.every(Number.isFinite)) {
    throw new TypeError('model primitive positions are malformed')
  }

  const { right, up } = basis
  // Project first, then fit: the extent depends on the pose, so a fixed XY box would make the model
  // swim in and out of frame as it turns.
  const flat = new Float64Array((positions.length / 3) * 2)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let index = 0, vertex = 0; index + 2 < positions.length; index += 3, vertex += 1) {
    const x = positions[index] as number
    const y = positions[index + 1] as number
    const z = positions[index + 2] as number
    const screenX = x * right[0] + y * right[1] + z * right[2]
    const screenY = x * up[0] + y * up[1] + z * up[2]
    flat[vertex * 2] = screenX
    flat[vertex * 2 + 1] = screenY
    minX = Math.min(minX, screenX)
    maxX = Math.max(maxX, screenX)
    minY = Math.min(minY, screenY)
    maxY = Math.max(maxY, screenY)
  }

  const extentX = Math.max(1e-9, maxX - minX)
  const extentY = Math.max(1e-9, maxY - minY)
  const margin = 16
  const fit = Math.min((width - margin * 2) / extentX, (height - margin * 2) / extentY)
  // `distanceScale` is a camera distance multiplier, so a larger value must shrink the model.
  const scale = fit / Math.max(0.15, distanceScale)
  const offsetX = width / 2 - ((minX + maxX) / 2) * scale
  const offsetY = height / 2 + ((minY + maxY) / 2) * scale
  const point = (vertex: number): readonly [number, number] => [
    offsetX + (flat[vertex * 2] as number) * scale,
    offsetY - (flat[vertex * 2 + 1] as number) * scale,
  ]
  const indices =
    primitive.indices ?? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
  const vertexCount = positions.length / 3
  if (indices.some(index => index >= vertexCount)) {
    throw new RangeError('model primitive index is outside the position buffer')
  }
  // A canvas cannot resolve `var()`, so the token is read from the surface and passed in as a
  // literal. Reading it per draw is what keeps the wireframe following a live theme change.
  const stroke =
    getComputedStyle(canvas).getPropertyValue('--mk-chart-categorical-1').trim() || '#4daafc'
  context.strokeStyle = stroke
  context.fillStyle = stroke
  context.lineWidth = 1
  const edge = (from: number, to: number): void => {
    const a = point(from)
    const b = point(to)
    context.beginPath()
    context.moveTo(a[0], a[1])
    context.lineTo(b[0], b[1])
    context.stroke()
  }
  const triangle = (first: number, second: number, third: number): void => {
    const a = point(first)
    const b = point(second)
    const c = point(third)
    context.beginPath()
    context.moveTo(a[0], a[1])
    context.lineTo(b[0], b[1])
    context.lineTo(c[0], c[1])
    context.closePath()
    context.stroke()
  }
  if (primitive.topology === 'points') {
    for (const vertex of indices) {
      const value = point(vertex)
      context.fillRect(value[0] - 1, value[1] - 1, 3, 3)
    }
  } else if (primitive.topology === 'lines') {
    for (let index = 0; index + 1 < indices.length; index += 2) {
      edge(indices[index] as number, indices[index + 1] as number)
    }
  } else if (primitive.topology === 'line-strip') {
    for (let index = 0; index + 1 < indices.length; index += 1) {
      edge(indices[index] as number, indices[index + 1] as number)
    }
  } else if (primitive.topology === 'triangles') {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      triangle(indices[index] as number, indices[index + 1] as number, indices[index + 2] as number)
    }
  } else if (primitive.topology === 'triangle-strip') {
    for (let index = 0; index + 2 < indices.length; index += 1) {
      triangle(indices[index] as number, indices[index + 1] as number, indices[index + 2] as number)
    }
  } else {
    for (let index = 1; index + 1 < indices.length; index += 1) {
      triangle(indices[0] as number, indices[index] as number, indices[index + 1] as number)
    }
  }
}

export const modelViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Model viewer')
    const stage = element(root, 'div', { part: 'model' })
    const readout = element(stage, 'output', { part: 'model.readout' })

    const toolbar = element(stage, 'div', { part: 'model.toolbar', role: 'toolbar' })
    toolbar.setAttribute('aria-label', 'Model view')

    const canvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
    canvas.setAttribute('role', 'img')
    // Focusable so the orbit keyboard bindings are reachable without a pointer (C-15).
    canvas.tabIndex = 0

    const camera = createOrbitController()
    const gizmo = createViewGizmo(stage, { onAxis: axis => camera.snapTo(axis) })

    const lease = await unknownSourceLease(
      args.sources,
      args.slot,
      'common.view/model-scene-source',
    )
    if (lease === undefined) throw new TypeError('model binding is unavailable')
    scope.lease(lease)

    setState(stage, ['loading'])
    try {
      const model = await loadModelStage(lease.value as ModelSceneSource, scope.signal)
      /*
       * `animations` is part of `ModelSceneInfo` and was the one count this readout never showed,
       * so a scene with animation tracks read exactly like one without. It is stated even at zero:
       * "0 animations" is an answer, while silence is indistinguishable from a viewer that cannot
       * tell — which is the ambiguity the block-9 smoke ran into on a W3D with one track.
       */
      /*
       * The base scene counts, then whatever optional facets this subject published. The facet line
       * is read through the contracts alone — the same loop answers for a SAGE W3X, a Westwood VXL
       * and a Wavefront OBJ, which is what makes this a generic consumer rather than five readers.
       */
      const facets = await readModelFacets(args.sources, args.slot, scope, scope.signal)
      setViewerText(
        readout,
        `${model.info.nodes} nodes · ${model.info.meshes} meshes · ` +
          `${model.info.primitives} primitives · ${model.info.materials} materials · ` +
          `${model.info.animations} animations` +
          (facets.length === 0 ? '' : ` · ${facets.join(' · ')}`),
      )
      if (model.primitive === undefined) {
        canvas.remove()
        gizmo.destroy()
        toolbar.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: 'Scene metadata is available. A buffer resolver/renderer provider is required for geometry.',
        })
      } else {
        const primitive = model.primitive
        const redraw = (): void => {
          const pose = camera.pose
          drawPrimitive(canvas, primitive, camera.basis(), pose.distanceScale)
          gizmo.update(pose.yaw, pose.pitch)
        }
        scope.cleanup(camera.onChange(redraw))
        camera.attach(canvas, scope.signal)

        const button = (label: string, title: string, run: () => void): void => {
          const node = element(toolbar, 'button', { part: 'operations.button', text: label })
          node.setAttribute('type', 'button')
          node.title = title
          node.addEventListener('click', run, { signal: scope.signal })
        }
        button('Reset', 'Reset the camera to its default pose', () => camera.reset())
        button('−', 'Zoom out', () => camera.zoom(1))
        button('+', 'Zoom in', () => camera.zoom(-1))

        scope.cleanup(() => gizmo.destroy())
        redraw()
      }
      setState(stage, [])
    } catch (error) {
      setState(stage, ['error'])
      canvas.remove()
      element(stage, 'p', {
        part: 'viewer.empty',
        text: `The model scene cannot be rendered: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }

    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})
