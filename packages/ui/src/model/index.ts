import type {
  Lease,
  ModelAnimationClip,
  ModelBoneBinding,
  ModelCollisionVolume,
  ModelMaterialRef,
  ModelPrimitive,
  ModelResourceRef,
  ModelSceneSource,
  ModelSocketRef,
  RasterResourcePort,
  SceneRenderer,
  SceneRendererPrimitive,
  SceneRendererPort,
  SceneRendererTexture,
  ViewerModule,
} from '@modkit/sdk'
import { createModelSceneSampler } from '@modkit/scene/model'
import { loadModelStage, readModelRecords, MODEL_MAXIMUM_RECORDS } from './source.js'
export {
  loadModelStage,
  MODEL_MAXIMUM_PRIMITIVE_BYTES,
  MODEL_MAXIMUM_PRIMITIVES,
} from './source.js'
export type { ModelStageModel } from './source.js'
import { createMediaShell } from '../media-shell/index.js'
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
import { createOrbitController } from './orbit.js'
import { createViewGizmo } from './gizmo.js'
import {
  framePrimitives,
  MODEL_KEY_LIGHT,
  modelCamera,
  modelSceneRequest,
  multiply4x4,
  projectPoint,
  sceneMaterials,
  type SkeletonJoint,
} from './scene.js'
import { type UiLocalizer, type UiMessageKey } from '../localization/index.js'
import { MODEL_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** Duration exposed by the generic player, including finite independent channel cycles. */
export function modelAnimationPlaybackDuration(clip: ModelAnimationClip | undefined): number {
  if (clip === undefined) return 0
  let duration = clip.durationSeconds ?? 0
  if (clip.repeatCount !== undefined && clip.repeatCount > 0)
    duration = Math.max(duration, duration * clip.repeatCount)
  for (const channel of clip.channels) {
    if (
      channel.concurrent === true &&
      channel.wrapSeconds !== undefined &&
      channel.repeatCount !== undefined &&
      channel.repeatCount > 0
    )
      duration = Math.max(duration, channel.wrapSeconds * channel.repeatCount)
  }
  return duration
}

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
  framePrimitives,
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
 * Complete bounded optional facets, shared by the renderer and the shorter details list.
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
        request: { readonly limit: number; readonly cursor?: string },
        abort?: AbortSignal,
      ) => Promise<{
        readonly items: readonly unknown[]
        readonly nextCursor?: string
      }>
    >
    const method = source[FACET_PAGE_METHOD[contract]]
    if (method === undefined) continue
    const items = await readModelRecords(
      (request, abort) => method.call(source, request, abort),
      MODEL_MAXIMUM_RECORDS,
      signal,
    )
    pages.set(contract, { items, truncated: false })
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
        items: Object.freeze(
          page.items
            .slice(0, MODEL_FACET_DETAIL_LIMIT)
            .map(item => facetItem(contract, item, localizer)),
        ),
        truncated: page.truncated || page.items.length > MODEL_FACET_DETAIL_LIMIT,
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

/** The fallback draws the same complete posed scene and camera as a renderer provider. */
function drawPrimitive(
  canvas: HTMLCanvasElement,
  primitive: SceneRendererPrimitive,
  viewProjection: Float32Array,
): void {
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')
  const positions = primitive.positions
  if (positions.length % 3 !== 0 || !positions.every(Number.isFinite))
    throw new TypeError('model primitive positions are malformed')
  const matrix =
    primitive.transform === undefined
      ? viewProjection
      : multiply4x4(viewProjection, primitive.transform)
  const point = (vertex: number): readonly [number, number] | undefined =>
    projectPoint(
      matrix,
      [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!],
      { width: canvas.width, height: canvas.height },
    )
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
    if (a === undefined || b === undefined) return
    context.beginPath()
    context.moveTo(a[0], a[1])
    context.lineTo(b[0], b[1])
    context.stroke()
  }
  const triangle = (first: number, second: number, third: number): void => {
    const a = point(first)
    const b = point(second)
    const c = point(third)
    if (a === undefined || b === undefined || c === undefined) return
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
      if (value === undefined) continue
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
    descriptor: import('@modkit/sdk').AnyDescriptor,
    references: readonly ModelResourceRef[],
    signal?: AbortSignal,
  ) => Promise<ReadonlyMap<string, SceneRendererTexture>>
}

/**
 * Resolve the texture references a model published through a subject-bound raster port.
 *
 * The viewer never turns a logical id into a URI. The host owns lookup and image codec selection;
 * this helper only validates and repacks the bounded RGBA surfaces it receives.
 */
export async function resolveModelViewerTextures(
  port: RasterResourcePort,
  references: readonly ModelResourceRef[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, SceneRendererTexture>> {
  const maximumBytes = 64 * 1024 * 1024
  let remaining = maximumBytes
  let index = 0
  const textures = new Map<string, SceneRendererTexture>()
  for (const reference of references) {
    signal?.throwIfAborted()
    if (reference.role !== 'texture' || textures.has(reference.id) || remaining <= 0) continue
    const textureId = `model-texture-${index++}`
    const result = await port.read(
      {
        kind: 'logical',
        requirement: {
          id: textureId,
          logicalId: reference.id,
          role: 'texture',
          scopes: [
            'sibling-directory',
            'workspace-dependency-layer',
            'current-mount',
            'enclosing-container',
          ],
        },
        maxBytes: remaining,
        selection: { face: 'all' },
      },
      signal,
    )
    signal?.throwIfAborted()
    if (result.state === 'unresolved') continue
    const faces = result.info.faces ?? 1
    if (faces !== 1 && faces !== 6) continue
    if (faces === 6 && result.info.width !== result.info.height) continue
    const surfaces =
      result.state === 'decoded-surfaces'
        ? result.surfaces
        : [
            {
              subresource: { frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 },
              region: result.region,
            },
          ]
    const faceBytes = result.info.width * result.info.height * 4
    const byteLength = faceBytes * faces
    if (surfaces.length !== faces || byteLength > remaining) continue
    const rgba = new Uint8Array(byteLength)
    let valid = true
    for (const [face, surface] of surfaces.entries()) {
      const selected = surface.subresource
      const region = surface.region
      if (
        selected.face !== face ||
        selected.frame !== 0 ||
        selected.mipLevel !== 0 ||
        selected.layer !== 0 ||
        selected.slice !== 0 ||
        region.width !== result.info.width ||
        region.height !== result.info.height ||
        region.pixelFormat !== 'rgba8' ||
        region.rowStride < region.width * 4 ||
        region.rowStride * (region.height - 1) + region.width * 4 > region.pixels.length
      ) {
        valid = false
        break
      }
      for (let row = 0; row < region.height; row += 1) {
        const sourceOffset = row * region.rowStride
        const targetOffset = face * faceBytes + row * region.width * 4
        rgba.set(
          region.pixels.subarray(sourceOffset, sourceOffset + region.width * 4),
          targetOffset,
        )
      }
    }
    if (!valid) continue
    remaining -= byteLength
    textures.set(reference.id, {
      id: textureId,
      width: result.info.width,
      height: result.info.height,
      rgba,
      ...(faces === 6 ? { dimension: 'cube' as const } : {}),
      ...(result.info.channelLayout === undefined
        ? {}
        : { channelLayout: result.info.channelLayout }),
      ...(result.info.compression === undefined ? {} : { compression: result.info.compression }),
    })
  }
  return textures
}

export function createModelViewer(options: ModelViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, MODEL_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.model'))
      /*
       * The shared media shell, as in the image, video and audio views: siblings on the left, the
       * scene as the whole render area, and what the model declares as sidebar sections.
       */
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'model' })
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
        // What the scene declares, as sidebar sections rather than a panel over the render area.
        const body = shell.section('model', localizer.text('viewer.model'), {
          icon: 'symbol-misc',
        }).body
        const list = element(body, 'dl', { part: 'image.metadata' })
        for (const [label, value] of [
          [localizer.text('viewer.modelMeshCount'), String(model.info.meshes)],
          [localizer.text('viewer.modelMaterialCount'), String(model.info.materials)],
          [localizer.text('viewer.modelAnimationCount'), String(model.info.animations)],
        ] as const) {
          const row = element(list, 'div', { part: 'metadata.row' })
          element(row, 'dt', { text: label, part: 'metadata.label' })
          setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 64)
        }
        for (const detail of facetDetails) {
          const section = shell.section(
            `facet:${detail.label}`,
            `${detail.label} (${detail.items.length}${detail.truncated ? '+' : ''})`,
            { icon: 'list-tree', collapsed: true },
          )
          const items = element(section.body, 'ul', { part: 'model.facet-list' })
          for (const item of detail.items) {
            element(items, 'li', { part: 'model.facet-item', text: item })
          }
        }
        args.status?.set([
          {
            id: 'scene',
            icon: 'symbol-misc',
            text: localizer.text('viewer.modelSceneCounts', {
              meshes: model.info.meshes,
              materials: model.info.materials,
              animations: model.info.animations,
            }),
            align: 'start',
          },
        ])
        scope.cleanup(() => args.status?.clear())
        if (model.primitive === undefined) {
          canvas.remove()
          gizmo.destroy()
          toolbar.remove()
          element(stage, 'p', {
            part: 'viewer.empty',
            text: localizer.text('viewer.modelGeometryUnavailable'),
          })
        } else {
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
          const clips = (facetPages.get('common.view/model-animation-source')?.items ??
            []) as readonly ModelAnimationClip[]
          const projection = { ...model, skeleton: boneBindings }
          let player = createModelSceneSampler(projection, { signal: scope.signal })
          let scene = player.sample(0, scope.signal)
          let selectedPrimitive: string | undefined
          let activeClip: ModelAnimationClip | undefined
          let timeSeconds = 0
          const restFraming = framePrimitives(scene.primitives)
          const playbackStatus = element(stage, 'output', { part: 'model.playback-status' })
          const showDiagnostics = () => {
            setViewerText(playbackStatus, player.diagnostics.map(item => item.message).join(' '))
            canvas.setAttribute(
              'data-model-pose-diagnostics',
              player.diagnostics.map(item => item.code).join(' '),
            )
          }
          showDiagnostics()
          let texels: ReadonlyMap<string, SceneRendererTexture> = new Map()
          if (options.textures !== undefined && provider !== undefined && resourceRefs.length > 0) {
            texels = await options
              .textures(args.descriptor, resourceRefs, scope.signal)
              .catch(() => new Map<string, SceneRendererTexture>())
          }
          const surfaces = sceneMaterials(materialRefs, texels, true)
          canvas.setAttribute('data-model-textures', String(surfaces.textures.length))
          canvas.setAttribute('data-model-skeleton', String(scene.joints.length))
          let skeletonVisible = scene.joints.length > 0

          const framing = () => restFraming

          /*
           * One draw at a time. `render` is asynchronous — it may cross a worker boundary — while
           * the orbit controller emits synchronously on every pointer move, so without a token the
           * frames could land out of order and the model would jump backwards while being dragged.
           */
          let generation = 0
          const drawWireframe = (): void => {
            canvas.width = viewport.width
            canvas.height = viewport.height
            const placement = modelCamera(
              framing(),
              camera.basis(),
              camera.pose.distanceScale,
              viewport,
            )
            for (const primitive of scene.primitives)
              if (selectedPrimitive === undefined || primitive.id === selectedPrimitive)
                drawPrimitive(canvas, primitive, placement.viewProjection)
            const context = canvas.getContext('2d')
            if (context !== null && skeletonVisible)
              drawSkeleton(
                context,
                scene.joints,
                placement.viewProjection,
                viewport,
                themeColor(canvas, '--mk-chart-categorical-3', '#f0a04b'),
              )
            canvas.setAttribute('data-model-animation-time', String(timeSeconds))
          }
          let renderBusy = false
          let redrawPending = false
          let pendingFrame: Promise<void> | undefined
          const redraw = (): void => {
            const pose = camera.pose
            gizmo.update(pose.yaw, pose.pitch)
            const request = generation
            if (scope.signal.aborted) return
            if (renderBusy) {
              redrawPending = true
              return
            }
            try {
              scene = player.sample(timeSeconds, scope.signal)
            } catch (error) {
              setViewerText(playbackStatus, error instanceof Error ? error.message : String(error))
              canvas.setAttribute('data-model-pose-diagnostics', 'common.model/pose-failed')
              return
            }
            const drawnTime = timeSeconds
            const joints = scene.joints
            const primitives = scene.primitives.filter(
              item => selectedPrimitive === undefined || item.id === selectedPrimitive,
            )
            canvas.setAttribute('data-model-primitives', String(primitives.length))
            canvas.setAttribute('data-model-skeleton', String(joints.length))
            if (provider === undefined) {
              drawWireframe()
              return
            }
            const placement = modelCamera(framing(), camera.basis(), pose.distanceScale, viewport)
            const renderer = provider
            renderBusy = true
            pendingFrame = (async () => {
              try {
                const frame = await renderer.render(
                  modelSceneRequest({
                    primitives,
                    camera: placement,
                    viewport,
                    materials: surfaces.materials,
                    textures: surfaces.textures,
                    clearColor: [0, 0, 0, 0],
                    light: MODEL_KEY_LIGHT,
                    materialContext: {
                      time: drawnTime,
                      sequenceTime: drawnTime,
                      ...(activeClip?.sequenceIndex === undefined
                        ? {}
                        : { sequenceIndex: activeClip.sequenceIndex }),
                    },
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
                canvas.setAttribute('data-model-animation-time', String(drawnTime))
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
                /*
                 * The id goes with the backend. Leaving it would name a provider that is no longer
                 * drawing anything, which is exactly the kind of stale evidence an installed probe
                 * would read as a success. `…-status="failed"` is what says one was tried.
                 */
                canvas.removeAttribute('data-model-renderer-id')
                canvas.setAttribute('data-model-renderer-status', 'failed')
                canvas.setAttribute('data-model-renderer-diagnostic', 'x3.ui/renderer-frame-failed')
                canvas.setAttribute(
                  'data-model-renderer-detail',
                  error instanceof Error ? error.message : String(error),
                )
                canvas.setAttribute('data-model-textures', '0')
                drawWireframe()
              } finally {
                renderBusy = false
                if (redrawPending && !scope.signal.aborted) {
                  redrawPending = false
                  redraw()
                }
              }
            })()
          }
          scope.cleanup(async () => {
            await pendingFrame
          })
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
          if (scene.joints.length > 0) {
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

          if (model.primitiveIds.length > 1) {
            const selector = element(toolbar, 'select', {
              part: 'model.primitive-selector',
            }) as HTMLSelectElement
            selector.setAttribute('aria-label', localizer.text('viewer.modelPrimitive'))
            const all = element(selector, 'option', {
              text: localizer.text('viewer.modelAllPrimitives'),
            }) as HTMLOptionElement
            all.value = ''
            for (const id of model.primitiveIds) {
              const option = element(selector, 'option', { text: id }) as HTMLOptionElement
              option.value = id
            }
            selector.addEventListener(
              'change',
              () => {
                generation++
                selectedPrimitive = selector.value || undefined
                redraw()
              },
              { signal: scope.signal },
            )
          }
          if (clips.length > 0) {
            const selector = element(toolbar, 'select', {
              part: 'model.animation-selector',
            }) as HTMLSelectElement
            selector.setAttribute('aria-label', localizer.text('viewer.modelAnimation'))
            const rest = element(selector, 'option', {
              text: localizer.text('viewer.modelRestPose'),
            }) as HTMLOptionElement
            rest.value = ''
            for (const clip of clips) {
              const option = element(selector, 'option', { text: clip.name }) as HTMLOptionElement
              option.value = clip.id
            }
            const seek = element(toolbar, 'input', {
              part: 'model.animation-seek',
            }) as HTMLInputElement
            seek.type = 'range'
            seek.min = '0'
            seek.max = '0'
            seek.step = '0.001'
            seek.value = '0'
            seek.disabled = true
            seek.setAttribute('aria-label', localizer.text('viewer.modelAnimationTime'))
            let frameId = 0
            let playing = false
            let duration = 0
            let startedAt = 0
            const toggle = button('▶', localizer.text('viewer.playPause'), () => {
              if (duration <= 0) return
              playing = !playing
              if (playing) {
                if (timeSeconds >= duration) timeSeconds = 0
                startedAt = performance.now() - timeSeconds * 1000
                frameId = requestAnimationFrame(tick)
              } else cancelAnimationFrame(frameId)
              toggle.setAttribute('aria-pressed', String(playing))
            })
            toggle.setAttribute('aria-pressed', 'false')
            const stop = () => {
              playing = false
              cancelAnimationFrame(frameId)
              toggle.setAttribute('aria-pressed', 'false')
            }
            const tick = (now: number) => {
              if (!playing || scope.signal.aborted) return
              timeSeconds = Math.min(duration, (now - startedAt) / 1000)
              seek.value = String(timeSeconds)
              redraw()
              if (timeSeconds < duration) frameId = requestAnimationFrame(tick)
              else stop()
            }
            selector.addEventListener(
              'change',
              () => {
                stop()
                try {
                  const clip = clips.find(item => item.id === selector.value)
                  const nextPlayer = createModelSceneSampler(projection, {
                    signal: scope.signal,
                    ...(clip === undefined ? {} : { clip }),
                  })
                  player = nextPlayer
                  activeClip = clip
                  duration = modelAnimationPlaybackDuration(clip)
                  timeSeconds = 0
                  generation++
                  seek.max = String(duration)
                  seek.value = '0'
                  seek.disabled = duration <= 0
                  canvas.setAttribute('data-model-animation', clip?.id ?? '')
                  showDiagnostics()
                  redraw()
                } catch (error) {
                  setViewerText(
                    playbackStatus,
                    error instanceof Error ? error.message : String(error),
                  )
                }
              },
              { signal: scope.signal },
            )
            seek.addEventListener(
              'input',
              () => {
                stop()
                generation++
                timeSeconds = Number(seek.value)
                redraw()
              },
              { signal: scope.signal },
            )
            scope.cleanup(stop)
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
