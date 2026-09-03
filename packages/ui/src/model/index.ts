import type {
  Lease,
  ModelAnimationClip,
  ModelBoneBinding,
  ModelCollisionVolume,
  ModelMaterialRef,
  ModelPrimitive,
  ModelResourceRef,
  ModelSceneInfo,
  ModelSceneSource,
  ModelSocketRef,
  SceneRenderer,
  SceneRendererPort,
  SceneRendererTexture,
  ViewerModule,
} from '@modkit/sdk'
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
import {
  framePrimitive,
  MODEL_KEY_LIGHT,
  modelCamera,
  modelSceneRequest,
  projectPoint,
  sceneMaterials,
  skeletonJoints,
  type SkeletonJoint,
} from './scene.js'
import { type UiLocalizer, type UiMessageKey } from '../localization/index.js'
import { MODEL_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export {
  createOrbitController,
  type OrbitBasis,
  type OrbitController,
  type OrbitPose,
  type ViewAxis,
} from './orbit.js'
export { createViewGizmo, GIZMO_SIZE, type ViewGizmo, type ViewGizmoOptions } from './gizmo.js'
export {
  baseColorResourceOf,
  framePrimitive,
  materialColorFor,
  MODEL_DEFAULT_BASE_COLOR,
  MODEL_FIELD_OF_VIEW,
  MODEL_KEY_LIGHT,
  modelCamera,
  modelSceneRequest,
  multiply4x4,
  projectPoint,
  sceneMaterials,
  skeletonJoints,
  type CameraPlacement,
  type ModelFraming,
  type ModelSceneMaterials,
  type ModelSceneRequestOptions,
  type SkeletonJoint,
  type Vector3,
} from './scene.js'

/**
 * The backend name published as `data-model-renderer`, keyed by the provider's `rendererId`.
 *
 * A *class* of backend rather than a provider identity, because that is the distinction an
 * installed-product probe and a theme both care about: "this is a shaded GPU frame" against "this
 * is the 2D fallback". The exact provider is published beside it as `data-model-renderer-id`, so
 * nothing is lost — a third-party renderer is reported as `provider` here and by its own id there.
 *
 * `wireframe` is deliberately the value the built-in 2D path has always used. Three applications'
 * smoke tests and `packages/ui/test/browser-e2e.test.ts` select on it, and the fallback is a
 * permanent tier of this viewer, not a legacy path awaiting removal.
 */
export const MODEL_RENDERER_BACKENDS: Readonly<Record<string, string>> = Object.freeze({
  'modkit.browser-webgl': 'webgl2',
  'modkit.headless': 'cpu-raster',
})

/** The 2D fallback's backend name; see `MODEL_RENDERER_BACKENDS`. */
export const MODEL_WIREFRAME_BACKEND = 'wireframe'

export function modelRendererBackend(rendererId: string): string {
  return MODEL_RENDERER_BACKENDS[rendererId] ?? 'provider'
}

export const MODEL_MAXIMUM_PRIMITIVE_BYTES = 64 * 1024 * 1024
export const MODEL_MAXIMUM_PRIMITIVES = 4096
const MODEL_FACET_DETAIL_LIMIT = 64

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
  'common.view/model-socket-source',
] as const)

/** Facet id → the one count worth putting on a single readout line. */
const FACET_READOUT: Readonly<Record<string, { labelKey: UiMessageKey; key: string }>> =
  Object.freeze({
    'common.view/model-resource-refs-source': {
      labelKey: 'viewer.modelResources',
      key: 'references',
    },
    'common.view/model-skeleton-source': { labelKey: 'viewer.modelBones', key: 'bindings' },
    'common.view/model-animation-source': { labelKey: 'viewer.modelClips', key: 'clips' },
    'common.view/model-collision-source': { labelKey: 'viewer.modelCollision', key: 'volumes' },
    'common.view/model-material-source': { labelKey: 'viewer.modelMaterials', key: 'materials' },
    'common.view/model-socket-source': { labelKey: 'viewer.modelSockets', key: 'sockets' },
  })

export interface ModelStageModel {
  readonly info: ModelSceneInfo
  readonly primitiveIds: readonly string[]
  readonly primitive?: ModelPrimitive
}

export interface ModelFacetDetail {
  readonly contract: (typeof MODEL_FACET_CONTRACTS)[number]
  readonly label: string
  readonly items: readonly string[]
  readonly truncated: boolean
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
  localizer: UiLocalizer = withEnglishUiFallback(undefined, MODEL_FALLBACK_MESSAGES),
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
    if (typeof value === 'number') {
      parts.push(`${value} ${readout === undefined ? contract : localizer.text(readout.labelKey)}`)
    }
  }
  return parts
}

export async function loadModelStage(
  source: ModelSceneSource,
  signal?: AbortSignal,
): Promise<ModelStageModel> {
  const info = await source.info(signal)
  const primitiveIds: string[] = []
  let cursor: string | undefined
  do {
    const page = await source.meshes(
      {
        limit: Math.min(256, MODEL_MAXIMUM_PRIMITIVES - primitiveIds.length),
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    )
    for (const mesh of page.items) {
      for (const id of mesh.primitiveIds) {
        if (primitiveIds.length >= MODEL_MAXIMUM_PRIMITIVES) break
        primitiveIds.push(id)
      }
    }
    cursor = primitiveIds.length >= MODEL_MAXIMUM_PRIMITIVES ? undefined : page.nextCursor
  } while (cursor !== undefined)
  const primitiveId = primitiveIds[0]
  const primitive =
    primitiveId === undefined || source.primitive === undefined
      ? undefined
      : await source.primitive(primitiveId, { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES }, signal)
  return {
    info,
    primitiveIds: Object.freeze(primitiveIds),
    ...(primitive === undefined ? {} : { primitive }),
  }
}

function short(value: unknown): string {
  const text = String(value ?? '').trim()
  return text.length <= 160 ? text : `${text.slice(0, 157)}…`
}

function facetItem(
  contract: ModelFacetDetail['contract'],
  value: unknown,
  localizer: UiLocalizer,
): string {
  if (contract === 'common.view/model-resource-refs-source') {
    const item = value as ModelResourceRef
    return `${short(item.id)} · ${item.role} · ${item.provenance}`
  }
  if (contract === 'common.view/model-skeleton-source') {
    const item = value as ModelBoneBinding
    const parent = item.parentBoneIndex === undefined ? '?' : (item.parentBoneIndex ?? 'root')
    return `#${item.boneIndex} ${short(item.boneName ?? localizer.text('viewer.modelUnnamed'))} · ${localizer.text('viewer.modelParent', { parent })} · ${item.flagNames?.join(', ') || localizer.text('viewer.modelNoNamedFlags')}`
  }
  if (contract === 'common.view/model-animation-source') {
    const item = value as ModelAnimationClip
    const samples = item.channels.reduce(
      (total, channel) => total + (channel.samples?.length ?? 0),
      0,
    )
    return `${short(item.name)} · ${localizer.text('viewer.modelClipDetail', {
      frames: item.frames,
      channels: item.channels.length,
      samples,
    })}`
  }
  if (contract === 'common.view/model-collision-source') {
    const item = value as ModelCollisionVolume
    return `${short(item.id)} · ${item.kind} · ${item.origin}`
  }
  if (contract === 'common.view/model-material-source') {
    const item = value as ModelMaterialRef
    return `${short(item.name ?? item.id)} · ${item.type ?? localizer.text('viewer.modelMaterial')} · ${item.blendMode ?? localizer.text('viewer.modelBlendUnknown')} · ${localizer.text('viewer.modelLayers', { count: item.layers?.length ?? 0 })}`
  }
  const item = value as ModelSocketRef
  return `${short(item.sourceName ?? item.id)} · ${item.role} · ${item.nodeId}`
}

/** Facet id → the page method that enumerates it. */
const FACET_PAGE_METHOD: Readonly<Record<ModelFacetDetail['contract'], string>> = Object.freeze({
  'common.view/model-resource-refs-source': 'references',
  'common.view/model-skeleton-source': 'bindings',
  'common.view/model-animation-source': 'clips',
  'common.view/model-collision-source': 'volumes',
  'common.view/model-material-source': 'materials',
  'common.view/model-socket-source': 'sockets',
})

export interface ModelFacetPage {
  readonly items: readonly unknown[]
  readonly truncated: boolean
}

/**
 * One bounded page of every optional facet the subject published, as data.
 *
 * Read once and shared, because two consumers now want the same records: the details list renders
 * them as text, and the stage renders materials as colours and bone rest poses as an overlay.
 * Leasing each source twice would double the RPC round trips for a facet a codec computes lazily,
 * and — worse — could show a list and a drawing built from two different reads.
 */
export async function readModelFacetPages(
  sources: Parameters<typeof unknownSourceLease>[0],
  slot: Parameters<typeof unknownSourceLease>[1],
  scope: { lease(lease: Lease<unknown>): Lease<unknown> },
  signal?: AbortSignal,
): Promise<ReadonlyMap<(typeof MODEL_FACET_CONTRACTS)[number], ModelFacetPage>> {
  const pages = new Map<(typeof MODEL_FACET_CONTRACTS)[number], ModelFacetPage>()
  for (const contract of MODEL_FACET_CONTRACTS) {
    const lease = await unknownSourceLease(sources, slot, contract)
    if (lease === undefined) continue
    scope.lease(lease)
    const source = lease.value as Record<
      string,
      (
        request: { readonly limit: number },
        abort?: AbortSignal,
      ) => Promise<{
        readonly items: readonly unknown[]
        readonly nextCursor?: string
      }>
    >
    const page = await source[FACET_PAGE_METHOD[contract]]?.(
      { limit: MODEL_FACET_DETAIL_LIMIT },
      signal,
    )
    if (page === undefined) continue
    pages.set(contract, { items: page.items, truncated: page.nextCursor !== undefined })
  }
  return pages
}

/** Render already-read facet pages as the text list the details panel shows. */
export function describeModelFacetPages(
  pages: ReadonlyMap<(typeof MODEL_FACET_CONTRACTS)[number], ModelFacetPage>,
  localizer: UiLocalizer = withEnglishUiFallback(undefined, MODEL_FALLBACK_MESSAGES),
): readonly ModelFacetDetail[] {
  const details: ModelFacetDetail[] = []
  for (const contract of MODEL_FACET_CONTRACTS) {
    const page = pages.get(contract)
    if (page === undefined) continue
    const readout = FACET_READOUT[contract]
    details.push(
      Object.freeze({
        contract,
        label: readout === undefined ? contract : localizer.text(readout.labelKey),
        items: Object.freeze(page.items.map(item => facetItem(contract, item, localizer))),
        truncated: page.truncated,
      }),
    )
  }
  return Object.freeze(details)
}

/** Read a small, bounded detail page for every optional model facet. */
export async function readModelFacetDetails(
  sources: Parameters<typeof unknownSourceLease>[0],
  slot: Parameters<typeof unknownSourceLease>[1],
  scope: { lease(lease: Lease<unknown>): Lease<unknown> },
  signal?: AbortSignal,
  localizer: UiLocalizer = withEnglishUiFallback(undefined, MODEL_FALLBACK_MESSAGES),
): Promise<readonly ModelFacetDetail[]> {
  return describeModelFacetPages(await readModelFacetPages(sources, slot, scope, signal), localizer)
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
  const width = MODEL_STAGE_WIDTH
  const height = MODEL_STAGE_HEIGHT
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

/** Pixel size of the frame this stage asks a provider for, and of its own 2D canvas. */
const MODEL_STAGE_WIDTH = 720
const MODEL_STAGE_HEIGHT = 480

/**
 * Bones over the frame, drawn by this stage rather than by the backend.
 *
 * Deliberately an overlay and not scene geometry: the draft scene contract requires overlays to be
 * switchable independently of the backend and requires the 2D fallback to be able to draw the
 * skeleton, and a bone drawn as scene geometry would be neither — it would vanish with the
 * renderer and be depth-tested against the mesh that hides it.
 */
function drawSkeleton(
  context: CanvasRenderingContext2D,
  joints: readonly SkeletonJoint[],
  viewProjection: Float32Array,
  viewport: { readonly width: number; readonly height: number },
  stroke: string,
): number {
  const projected = joints.map(joint => projectPoint(viewProjection, joint.position, viewport))
  context.save()
  context.strokeStyle = stroke
  context.fillStyle = stroke
  context.lineWidth = 1.5
  let drawn = 0
  for (const [index, joint] of joints.entries()) {
    const point = projected[index]
    if (point === undefined) continue
    drawn += 1
    context.beginPath()
    context.arc(point[0], point[1], 2.5, 0, Math.PI * 2)
    context.fill()
    const parent = joint.parent === undefined ? undefined : projected[joint.parent]
    if (parent === undefined) continue
    context.beginPath()
    context.moveTo(parent[0], parent[1])
    context.lineTo(point[0], point[1])
    context.stroke()
  }
  context.restore()
  return drawn
}

/** Read a CSS custom property off the canvas, so the overlay follows a live theme change. */
function themeColor(canvas: HTMLCanvasElement, token: string, fallback: string): string {
  return getComputedStyle(canvas).getPropertyValue(token).trim() || fallback
}

export interface ModelViewerOptions {
  readonly localizer?: UiLocalizer
  /**
   * Where this stage asks for a `common.render/scene-3d` provider.
   *
   * A host capability, not a viewer one — the same reason `createImageViewer` takes its export
   * writer from the host: only the application knows which realm this viewer runs in, what it is
   * allowed to activate there, and whether that realm has a GPU. Absent, or answering
   * `unresolved`, the stage draws its own 2D wireframe and says which of the two happened. It
   * never crashes and never shows an empty frame.
   */
  readonly renderer?: SceneRendererPort
  /**
   * Decoded base-colour texels, keyed by the `ModelResourceRef.id` a material layer names.
   *
   * Supplied by the host for the same reason as the port: resolving a texture reference means
   * opening another subject, which is a host-owned resource session, and a viewer that built a URI
   * of its own would be crossing the line block 9 drew. Absent, materials draw their own colour and
   * the model is shaded but untextured — stated as `data-model-textures="0"` rather than implied.
   */
  readonly textures?: (
    references: readonly ModelResourceRef[],
    signal?: AbortSignal,
  ) => Promise<ReadonlyMap<string, SceneRendererTexture>>
}

export function createModelViewer(options: ModelViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.model'))
      const stage = element(root, 'div', { part: 'model' })
      const readout = element(stage, 'output', { part: 'model.readout' })

      const toolbar = element(stage, 'div', { part: 'model.toolbar', role: 'toolbar' })
      toolbar.setAttribute('aria-label', localizer.text('viewer.modelView'))

      const canvas = element(stage, 'canvas', { part: 'model.canvas' }) as HTMLCanvasElement
      canvas.setAttribute('role', 'img')
      /*
       * Stable machine evidence for installed-product probes; localized readout text must not be
       * used to infer any of it.
       *
       * `wireframe` is the value until a provider has actually answered, so a probe that catches
       * the stage mid-mount reads the path that is really drawing rather than one that might be.
       * `data-model-renderer` is the backend *class* (`wireframe`, `webgl2`, …),
       * `data-model-renderer-id` the provider's own id, and `data-model-renderer-status` why this
       * path and not the other — `unavailable` (this host offers no port), `unresolved` (it does
       * and nothing matched), `failed` (a provider was resolved and its frame threw), `resolved`.
       */
      canvas.setAttribute('data-model-renderer', MODEL_WIREFRAME_BACKEND)
      canvas.setAttribute('data-model-renderer-status', 'unavailable')
      // Focusable so the orbit keyboard bindings are reachable without a pointer (C-15).
      canvas.tabIndex = 0

      const camera = createOrbitController()
      const gizmo = createViewGizmo(stage, { localizer, onAxis: axis => camera.snapTo(axis) })

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/model-scene-source',
      )
      if (lease === undefined) throw new TypeError('model binding is unavailable')
      scope.lease(lease)

      setState(stage, ['loading'])
      try {
        const sceneSource = lease.value as ModelSceneSource
        const model = await loadModelStage(sceneSource, scope.signal)
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
        const [facets, facetPages] = await Promise.all([
          readModelFacets(args.sources, args.slot, scope, scope.signal, localizer),
          readModelFacetPages(args.sources, args.slot, scope, scope.signal),
        ])
        const facetDetails = describeModelFacetPages(facetPages, localizer)
        setViewerText(
          readout,
          localizer.text('viewer.modelSummary', {
            nodes: model.info.nodes,
            meshes: model.info.meshes,
            primitives: model.info.primitives,
            materials: model.info.materials,
            animations: model.info.animations,
            facets: facets.length === 0 ? '' : ` · ${facets.join(' · ')}`,
          }),
        )
        if (facetDetails.length > 0) {
          const panel = element(stage, 'section', { part: 'model.facets' })
          panel.setAttribute('aria-label', localizer.text('viewer.modelDetails'))
          for (const detail of facetDetails) {
            const group = element(panel, 'details', { part: 'model.facet' })
            element(group, 'summary', {
              part: 'model.facet-summary',
              text: `${detail.label} (${detail.items.length}${detail.truncated ? '+' : ''})`,
            })
            const list = element(group, 'ul', { part: 'model.facet-list' })
            for (const item of detail.items) {
              element(list, 'li', { part: 'model.facet-item', text: item })
            }
          }
        }
        if (model.primitive === undefined) {
          canvas.remove()
          gizmo.destroy()
          toolbar.remove()
          element(stage, 'p', {
            part: 'viewer.empty',
            text: localizer.text('viewer.modelGeometryUnavailable'),
          })
        } else {
          let primitive = model.primitive
          const viewport = { width: MODEL_STAGE_WIDTH, height: MODEL_STAGE_HEIGHT }

          /*
           * The renderer, asked for once per mount through the host's port.
           *
           * A refusal is not an error: this same viewer runs in a page that composed a GPU realm
           * and in a bridge realm that holds no host authority at all, and the second case is a
           * declared degradation tier rather than a fault. Whichever answer comes back, the reason
           * lands on the canvas as machine-readable evidence.
           */
          let provider: SceneRenderer | undefined
          if (options.renderer !== undefined) {
            try {
              const acquisition = await options.renderer.acquire({
                outputKind: 'rgba8',
                signal: scope.signal,
              })
              if (acquisition.state === 'resolved') {
                provider = acquisition.lease.renderer
                scope.cleanup(() => acquisition.lease.release())
                canvas.setAttribute(
                  'data-model-renderer',
                  modelRendererBackend(provider.rendererId),
                )
                canvas.setAttribute('data-model-renderer-id', provider.rendererId)
                canvas.setAttribute('data-model-renderer-status', 'resolved')
              } else {
                canvas.setAttribute('data-model-renderer-status', 'unresolved')
                const reason = acquisition.diagnostics.at(-1)
                if (reason !== undefined) {
                  canvas.setAttribute('data-model-renderer-diagnostic', reason.code)
                }
              }
            } catch (error) {
              canvas.setAttribute('data-model-renderer-status', 'unresolved')
              canvas.setAttribute('data-model-renderer-diagnostic', 'x3.ui/renderer-acquire-threw')
              canvas.setAttribute(
                'data-model-renderer-detail',
                error instanceof Error ? error.message : String(error),
              )
            }
          }

          /*
           * Materials, textures and bones from the facets this subject published — read once, above,
           * for both the details list and this stage. A codec that publishes none of them still gets
           * a shaded model in the neutral surface colour, which is the parity gap this closes; a
           * codec that publishes materials gets one colour per material id.
           */
          const materialRefs = (facetPages.get('common.view/model-material-source')?.items ??
            []) as readonly ModelMaterialRef[]
          const resourceRefs = (facetPages.get('common.view/model-resource-refs-source')?.items ??
            []) as readonly ModelResourceRef[]
          const boneBindings = (facetPages.get('common.view/model-skeleton-source')?.items ??
            []) as readonly ModelBoneBinding[]
          const joints = skeletonJoints(boneBindings)
          let texels: ReadonlyMap<string, SceneRendererTexture> = new Map()
          if (options.textures !== undefined && provider !== undefined && resourceRefs.length > 0) {
            texels = await options
              .textures(resourceRefs, scope.signal)
              .catch(() => new Map<string, SceneRendererTexture>())
          }
          const surfaces = sceneMaterials(materialRefs, texels, true)
          canvas.setAttribute('data-model-textures', String(surfaces.textures.length))
          canvas.setAttribute('data-model-skeleton', String(joints.length))
          let skeletonVisible = joints.length > 0

          const framing = () => framePrimitive(primitive)

          /*
           * One draw at a time. `render` is asynchronous — it may cross a worker boundary — while
           * the orbit controller emits synchronously on every pointer move, so without a token the
           * frames could land out of order and the model would jump backwards while being dragged.
           */
          let generation = 0
          const drawWireframe = (): void => {
            const pose = camera.pose
            drawPrimitive(canvas, primitive, camera.basis(), pose.distanceScale)
            const context = canvas.getContext('2d')
            if (context !== null && skeletonVisible && joints.length > 0) {
              const placement = modelCamera(framing(), camera.basis(), pose.distanceScale, viewport)
              drawSkeleton(
                context,
                joints,
                placement.viewProjection,
                viewport,
                themeColor(canvas, '--mk-chart-categorical-3', '#f0a04b'),
              )
            }
          }
          const redraw = (): void => {
            const pose = camera.pose
            gizmo.update(pose.yaw, pose.pitch)
            const request = ++generation
            if (provider === undefined) {
              drawWireframe()
              return
            }
            const placement = modelCamera(framing(), camera.basis(), pose.distanceScale, viewport)
            const renderer = provider
            void (async () => {
              try {
                const frame = await renderer.render(
                  modelSceneRequest({
                    primitive,
                    camera: placement,
                    viewport,
                    materials: surfaces.materials,
                    textures: surfaces.textures,
                    clearColor: [0, 0, 0, 0],
                    light: MODEL_KEY_LIGHT,
                    signal: scope.signal,
                  }),
                )
                if (request !== generation || scope.signal.aborted) return
                const context = canvas.getContext('2d')
                if (context === null) throw new TypeError('2d canvas context is unavailable')
                const expected = frame.width * frame.height * 4
                if (frame.rgba.length !== expected) {
                  throw new TypeError(
                    `renderer returned ${frame.rgba.length} bytes for a ${frame.width}x${frame.height} frame`,
                  )
                }
                canvas.width = frame.width
                canvas.height = frame.height
                /*
                 * Copied rather than wrapped: the frame's buffer may be a `SharedArrayBuffer` that
                 * a worker still owns, and `ImageData` requires a plain one. A memcpy of the frame
                 * is far below the cost of producing it.
                 */
                const pixels = new Uint8ClampedArray(expected)
                pixels.set(frame.rgba)
                context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0)
                if (skeletonVisible && joints.length > 0) {
                  drawSkeleton(
                    context,
                    joints,
                    placement.viewProjection,
                    { width: frame.width, height: frame.height },
                    themeColor(canvas, '--mk-chart-categorical-3', '#f0a04b'),
                  )
                }
              } catch (error) {
                if (scope.signal.aborted) return
                /*
                 * A provider that resolved and then could not draw is the one case where the
                 * degradation has to be permanent: retrying it on every pointer move would spend
                 * the user's frame budget failing. The fallback takes over for the rest of the
                 * mount and says which provider dropped out and why.
                 */
                provider = undefined
                canvas.setAttribute('data-model-renderer', MODEL_WIREFRAME_BACKEND)
                canvas.setAttribute('data-model-renderer-status', 'failed')
                canvas.setAttribute('data-model-renderer-diagnostic', 'x3.ui/renderer-frame-failed')
                canvas.setAttribute(
                  'data-model-renderer-detail',
                  error instanceof Error ? error.message : String(error),
                )
                canvas.setAttribute('data-model-textures', '0')
                drawWireframe()
              }
            })()
          }
          scope.cleanup(camera.onChange(redraw))
          camera.attach(canvas, scope.signal)

          const button = (label: string, title: string, run: () => void): HTMLElement => {
            const node = element(toolbar, 'button', { part: 'operations.button', text: label })
            node.setAttribute('type', 'button')
            node.title = title
            node.addEventListener('click', run, { signal: scope.signal })
            return node
          }
          button(localizer.text('viewer.reset'), localizer.text('viewer.resetCamera'), () =>
            camera.reset(),
          )
          button('−', localizer.text('viewer.zoomOut'), () => camera.zoom(1))
          button('+', localizer.text('viewer.zoomIn'), () => camera.zoom(-1))
          if (joints.length > 0) {
            const toggle = button(
              localizer.text('viewer.modelBones'),
              localizer.text('viewer.modelSkeletonOverlay'),
              () => {
                skeletonVisible = !skeletonVisible
                toggle.setAttribute('aria-pressed', String(skeletonVisible))
                canvas.setAttribute('data-model-skeleton-visible', String(skeletonVisible))
                redraw()
              },
            )
            toggle.setAttribute('aria-pressed', String(skeletonVisible))
            canvas.setAttribute('data-model-skeleton-visible', String(skeletonVisible))
          }

          if (model.primitiveIds.length > 1 && sceneSource.primitive !== undefined) {
            const selector = element(toolbar, 'select', {
              part: 'model.primitive-selector',
            }) as HTMLSelectElement
            selector.setAttribute('aria-label', localizer.text('viewer.modelPrimitive'))
            for (const id of model.primitiveIds) {
              const option = element(selector, 'option', { text: id }) as HTMLOptionElement
              option.value = id
            }
            let selection = 0
            selector.addEventListener(
              'change',
              async () => {
                const request = ++selection
                selector.disabled = true
                try {
                  const selected = await sceneSource.primitive?.(
                    selector.value,
                    { maxBytes: MODEL_MAXIMUM_PRIMITIVE_BYTES },
                    scope.signal,
                  )
                  if (selected !== undefined && request === selection) {
                    primitive = selected
                    redraw()
                  }
                } finally {
                  if (request === selection) selector.disabled = false
                }
              },
              { signal: scope.signal },
            )
          }

          scope.cleanup(() => gizmo.destroy())
          redraw()
        }
        setState(stage, [])
      } catch (error) {
        setState(stage, ['error'])
        canvas.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.modelError', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        })
      }

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const modelViewer: ViewerModule = createModelViewer()
