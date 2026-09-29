import type {
  AnyDescriptor,
  CommitCoordinator,
  EditAuthorizationPort,
  JsonValue,
  Lease,
  ModelAnimationClip,
  ModelBoneBinding,
  ModelCollisionVolume,
  ModelCameraRef,
  ModelEffectRef,
  ModelLightRef,
  ModelNodeBehaviourRef,
  ModelPhysicsRef,
  ModelMaterialRef,
  ModelPrimitive,
  ModelResourceRef,
  ModelSceneSource,
  ModelSocketRef,
  OperationSession,
  RasterResourcePort,
  SceneRenderer,
  SceneRendererPrimitive,
  SceneRendererPort,
  SceneRendererTexture,
  ViewerModule,
} from '@modkit/sdk'
import { createModelSceneSampler } from '@modkit/scene/model'
import { loadModelStage, readModelRecords, MODEL_MAXIMUM_RECORDS } from './source.js'
import { orientPrimitive, upAxisCorrection } from './scene.js'
export {
  loadModelStage,
  MODEL_MAXIMUM_PRIMITIVE_BYTES,
  MODEL_MAXIMUM_PRIMITIVES,
} from './source.js'
export type { ModelStageModel } from './source.js'
import { createMediaShell, mountContributedSections } from '../media-shell/index.js'
import { PART_ATTRIBUTE } from '../parts.js'
import { commitOperationWrite } from '../field-write/index.js'
import { exportOffer, type EditOperationForm } from '../field-editor/index.js'
import type { ImageExportFile, ImageExportOutcome, ImageSidebarSection } from '../image/index.js'
import { convertedFileName } from '../image/index.js'
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

/**
 * The operation a clip rename goes through.
 *
 * It is the common field write, not a model-specific one: a viewer that invented its own rename
 * operation would only work for the codecs that had implemented it.
 */
const CLIP_RENAME_OPERATION = 'edit.field'

/**
 * The operation a model conversion goes through.
 *
 * An image offers its `export.convert` presets; a model offers the native encodings its codec
 * declares. Both are the same shape — a non-mutating operation whose input schema lists the
 * targets — so both are read with the same helper and drawn the same way.
 */
const MODEL_CONVERT_OPERATION = 'model.export-native'

/**
 * Every model codec publishes its model as UVM (`model.export-uvm`), with no presets of its own: it
 * is offered beside the codec's native encodings, with the input the host's own UVM export sends.
 */
const MODEL_UVM_OPERATION = 'model.export-uvm'
const UVM_EXPORT_INPUT = Object.freeze({ schemaVersion: 1 })
const UVM_WRITES = Object.freeze({
  format: Object.freeze({ id: 'uvm', label: 'UVM' }),
  extension: '.uvm',
  mediaType: 'model/gltf-binary; profile=uvm-1.0',
})

export interface ModelConversionPreset {
  readonly form: EditOperationForm
  readonly input: JsonValue
}

/**
 * The conversion presets a model codec publishes, as data a menu or a button can use.
 *
 * A form that declares no write target is not a conversion — it is some other preset of the same
 * operation — and is left out rather than guessed at from its input.
 */
export function modelConversions(descriptor: AnyDescriptor): readonly ModelConversionPreset[] {
  const native = exportOffer(descriptor, MODEL_CONVERT_OPERATION).flatMap(form => {
    if (form.writes === undefined) return []
    try {
      return [{ form, input: form.build(new Map()) }]
    } catch {
      return []
    }
  })
  const uvm = descriptor.operations.find(
    item => item.id === MODEL_UVM_OPERATION && item.state === 'available' && !item.mutatesSource,
  )
  if (uvm === undefined) return native
  const form: EditOperationForm = Object.freeze({
    id: 'uvm',
    label: 'UVM',
    operationId: MODEL_UVM_OPERATION,
    handlerId: uvm.handlerId,
    summary: 'UVM',
    fields: Object.freeze([]),
    writes: UVM_WRITES,
    build: () => UVM_EXPORT_INPUT,
  })
  return [...native, { form, input: UVM_EXPORT_INPUT }]
}

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
  'common.view/model-effect-source',
  'common.view/model-light-source',
  'common.view/model-camera-source',
  'common.view/model-physics-source',
  'common.view/model-node-behaviour-source',
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
    'common.view/model-effect-source': { labelKey: 'viewer.modelEffects', key: 'effects' },
    'common.view/model-light-source': { labelKey: 'viewer.modelLights', key: 'lights' },
    'common.view/model-camera-source': { labelKey: 'viewer.modelCameras', key: 'cameras' },
    'common.view/model-physics-source': { labelKey: 'viewer.modelPhysics', key: 'bodies' },
    'common.view/model-node-behaviour-source': {
      labelKey: 'viewer.modelBehaviours',
      key: 'behaviours',
    },
  })

/**
 * The sidebar MK2 had, restated over the facets MK3 publishes.
 *
 * MK2 showed twenty-seven named lists - Particles apart from Ribbons apart from Forces, Turrets
 * apart from Billboards - and a reader looking for a model's turrets should not have to scan an
 * "Effects (12)" list to find them. The facet is the source; `kind` is how one facet's records
 * split into the lists the format's own vocabulary names.
 *
 * A section whose facet is absent, or whose records are all of another kind, is not rendered: an
 * empty list says a model has no lights, which is a different claim from a codec not publishing
 * them.
 *
 * The list, and its order, is MK2's. Four of its lists — Ribbon Splines, Particle Copies, Shadow
 * Boxes, Cloth Constraints — are named here with the `kind` their records would carry although no
 * codec publishes one yet: they are the native vocabulary a reader of an M3 looks for, and stating
 * them costs nothing while they are empty and costs a forgotten edit later if left out.
 */
const MODEL_PANEL_SECTIONS: readonly {
  readonly id: string
  readonly title: string
  readonly contract: (typeof MODEL_FACET_CONTRACTS)[number]
  readonly kind?: string
  readonly icon: string
}[] = Object.freeze([
  {
    id: 'meshes',
    title: 'Meshes',
    contract: 'common.view/model-material-source',
    icon: 'symbol-method',
  },
  {
    id: 'materials',
    title: 'Materials',
    contract: 'common.view/model-material-source',
    icon: 'paintcan',
  },
  {
    id: 'resources',
    title: 'Resources',
    contract: 'common.view/model-resource-refs-source',
    icon: 'file-media',
  },
  {
    id: 'bones',
    title: 'Bones',
    contract: 'common.view/model-skeleton-source',
    icon: 'type-hierarchy',
  },
  {
    id: 'animations',
    title: 'Animations',
    contract: 'common.view/model-animation-source',
    icon: 'play',
  },
  {
    id: 'attachments',
    title: 'Attachments',
    contract: 'common.view/model-socket-source',
    icon: 'pinned',
  },
  {
    id: 'hit-volumes',
    title: 'Hit Volumes',
    contract: 'common.view/model-collision-source',
    icon: 'shield',
  },
  { id: 'lights', title: 'Lights', contract: 'common.view/model-light-source', icon: 'lightbulb' },
  {
    id: 'turrets',
    title: 'Turrets',
    contract: 'common.view/model-node-behaviour-source',
    kind: 'turret',
    icon: 'target',
  },
  {
    id: 'cameras',
    title: 'Cameras',
    contract: 'common.view/model-camera-source',
    icon: 'device-camera',
  },
  {
    id: 'ribbons',
    title: 'Ribbons',
    contract: 'common.view/model-effect-source',
    kind: 'ribbon',
    icon: 'sparkle',
  },
  {
    id: 'ribbon-splines',
    title: 'Ribbon Splines',
    contract: 'common.view/model-effect-source',
    kind: 'ribbon-spline',
    icon: 'sparkle',
  },
  {
    id: 'particles',
    title: 'Particles',
    contract: 'common.view/model-effect-source',
    kind: 'particle',
    icon: 'sparkle',
  },
  {
    id: 'particle-copies',
    title: 'Particle Copies',
    contract: 'common.view/model-effect-source',
    kind: 'particle-copy',
    icon: 'sparkle',
  },
  {
    id: 'projections',
    title: 'Projections',
    contract: 'common.view/model-effect-source',
    kind: 'projection',
    icon: 'sparkle',
  },
  {
    id: 'forces',
    title: 'Forces',
    contract: 'common.view/model-effect-source',
    kind: 'force',
    icon: 'sparkle',
  },
  {
    id: 'billboards',
    title: 'Billboards',
    contract: 'common.view/model-node-behaviour-source',
    kind: 'billboard',
    icon: 'target',
  },
  {
    id: 'warps',
    title: 'Warps',
    contract: 'common.view/model-effect-source',
    kind: 'warp',
    icon: 'sparkle',
  },
  {
    id: 'shadow-boxes',
    title: 'Shadow Boxes',
    contract: 'common.view/model-effect-source',
    kind: 'shadow-box',
    icon: 'sparkle',
  },
  {
    id: 'rigid-bodies',
    title: 'Rigid Bodies',
    contract: 'common.view/model-physics-source',
    kind: 'rigid-body',
    icon: 'circuit-board',
  },
  {
    id: 'physics-shapes',
    title: 'Physics Shapes',
    contract: 'common.view/model-physics-source',
    kind: 'shape',
    icon: 'circuit-board',
  },
  {
    id: 'physics-joints',
    title: 'Physics Joints',
    contract: 'common.view/model-physics-source',
    kind: 'joint',
    icon: 'circuit-board',
  },
  {
    id: 'physics-cloths',
    title: 'Physics Cloths',
    contract: 'common.view/model-physics-source',
    kind: 'cloth',
    icon: 'circuit-board',
  },
  {
    id: 'cloth-constraints',
    title: 'Cloth Constraints',
    contract: 'common.view/model-physics-source',
    kind: 'cloth-constraint',
    icon: 'circuit-board',
  },
  {
    id: 'ik',
    title: 'Inverse Kinematics',
    contract: 'common.view/model-node-behaviour-source',
    kind: 'ik',
    icon: 'target',
  },
])

/** MK2's eight team colours, as the quick picks beside the custom swatch. */
const MODEL_TEAM_COLOR_PRESETS: readonly string[] = Object.freeze([
  '#d9140f',
  '#2563eb',
  '#16a34a',
  '#facc15',
  '#9333ea',
  '#06b6d4',
  '#f97316',
  '#e5e7eb',
])

/** A record's own fields, in its own words, as the key/value rows MK2 showed. */
function modelRecordRows(record: unknown): readonly (readonly [string, string])[] {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return []
  const rows: [string, string][] = []
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue
    if (key === 'properties' && Array.isArray(value)) {
      // A codec's own extra fields are already key/value; they read as rows like any other.
      for (const entry of value) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
        const property = entry as { key?: unknown; value?: unknown }
        if (typeof property.key !== 'string') continue
        rows.push([property.key, describeModelValue(property.value)])
      }
      continue
    }
    rows.push([key, describeModelValue(value)])
  }
  return rows
}

function describeModelValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value))
    return value
      .map(item => (typeof item === 'number' ? Number(item.toFixed(4)) : describeModelValue(item)))
      .join(', ')
  if (typeof value === 'number') return String(Number(value.toFixed(4)))
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
  if (contract === 'common.view/model-light-source') {
    const item = value as ModelLightRef
    return `${short(item.name ?? item.id)} · ${item.kind} · ${item.nodeId ?? '—'}`
  }
  if (contract === 'common.view/model-camera-source') {
    const item = value as ModelCameraRef
    const fov =
      item.fieldOfViewRadians === undefined
        ? '—'
        : `${((item.fieldOfViewRadians * 180) / Math.PI).toFixed(1)}°`
    return `${short(item.name ?? item.id)} · ${fov} · ${item.nodeId ?? '—'}`
  }
  if (contract === 'common.view/model-physics-source') {
    const item = value as ModelPhysicsRef
    return `${short(item.name ?? item.id)} · ${item.kind}${item.shape === undefined ? '' : ` · ${item.shape}`} · ${item.nodeId ?? '—'}`
  }
  if (contract === 'common.view/model-node-behaviour-source') {
    const item = value as ModelNodeBehaviourRef
    const spans = item.nodeIds === undefined ? '' : ` · ${String(item.nodeIds.length)}`
    return `${short(item.name ?? item.id)} · ${item.kind} · ${item.nodeId ?? '—'}${spans}`
  }
  if (contract === 'common.view/model-effect-source') {
    const item = value as ModelEffectRef
    // Kind, where it rides, and how many of its own settings it carries — the three things that
    // distinguish one emitter from another without printing seventy-odd parameters in a list.
    return `${short(item.name ?? item.id)} · ${item.kind} · ${item.nodeId ?? '—'} · ${localizer.text('viewer.modelEffectProperties', { count: item.properties?.length ?? 0 })}`
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
  'common.view/model-effect-source': 'effects',
  'common.view/model-light-source': 'lights',
  'common.view/model-camera-source': 'cameras',
  'common.view/model-physics-source': 'bodies',
  'common.view/model-node-behaviour-source': 'behaviours',
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

/** Fallback frame size, used until the canvas has been laid out. */
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

/**
 * The host's file writer, reused rather than redeclared.
 *
 * It is the same writer the image view is given: one host capability, one type. A parallel
 * model-shaped copy would only force every host to adapt twice for the same job.
 */
export type { ImageExportFile as ModelExportFile } from '../image/index.js'
export type { ImageExportOutcome as ModelExportOutcome } from '../image/index.js'

export interface ModelViewerOptions {
  /**
   * How this host writes converted files, when it can. A host that omits it gets a conversion
   * control that says why it is disabled rather than a button that quietly does nothing — the same
   * rule the image view follows.
   */
  readonly exportBytes?: (
    files: readonly ImageExportFile[],
    signal?: AbortSignal | undefined,
  ) => Promise<ImageExportOutcome>
  /** Base name the converted file is derived from; the host usually supplies the subject name. */
  readonly exportBaseName?: (descriptor: AnyDescriptor) => string
  readonly localizer?: UiLocalizer
  /**
   * Sidebar sections the host contributes, beside the ones the model declares for itself.
   *
   * The same route the image view takes: MK2 showed a model's codec operations and its document
   * tree as separate tabs, and a host that wants them here mounts them as sections rather than the
   * viewer reaching for panels it does not own.
   */
  readonly sections?: readonly ImageSidebarSection[]
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
  /*
   * Each texture gets its share of the budget and comes as its most detailed mip that fits: one
   * 4096² texture (64 MiB at mip 0) took the whole budget and left the model's other maps out.
   */
  const wanted = new Set(references.filter(item => item.role === 'texture').map(item => item.id))
  const share = Math.max(4 * 1024 * 1024, Math.floor(maximumBytes / Math.max(1, wanted.size)))
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
        maxBytes: Math.min(remaining, share),
        selection: { face: 'all', mipLevel: 'fit' },
      },
      signal,
    )
    signal?.throwIfAborted()
    // Blocks come only for `compressedFormats`, which this reader does not ask for.
    if (result.state === 'unresolved' || result.state === 'compressed') continue
    const faces = result.info.faces ?? 1
    if (faces !== 1 && faces !== 6) continue
    if (faces === 6 && result.info.width !== result.info.height) continue
    const surfaces =
      result.state === 'decoded-surfaces'
        ? result.surfaces
        : [
            {
              subresource: result.subresource ?? {
                frame: 0,
                mipLevel: 0,
                layer: 0,
                face: 0,
                slice: 0,
              },
              region: result.region,
            },
          ]
    // The mip the host chose: every face is that one level, of that level's size.
    const chosen = surfaces[0]
    if (chosen === undefined) continue
    const { width, height } = chosen.region
    const mipLevel = chosen.subresource.mipLevel
    const faceBytes = width * height * 4
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
        selected.mipLevel !== mipLevel ||
        selected.layer !== 0 ||
        selected.slice !== 0 ||
        region.width !== width ||
        region.height !== height ||
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
      width,
      height,
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

/** The document path whose value is a clip's name, for a subject that stores clips as UVM does. */
export function clipNamePath(clip: ModelAnimationClip, ordinal: number): readonly string[] {
  // `sequenceIndex` is the clip's own key where a publisher states one; otherwise its position in
  // the published order, which is the order the document lists animations in.
  const index = Number.isSafeInteger(clip.sequenceIndex) ? (clip.sequenceIndex as number) : ordinal
  return ['animations', String(index), 'name']
}

interface ClipRenameOptions {
  readonly localizer: UiLocalizer
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly commit?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
  readonly selector: HTMLSelectElement
  readonly clips: readonly ModelAnimationClip[]
  readonly signal?: AbortSignal
}

/**
 * Rename the selected clip, beside the selector that chose it.
 *
 * Offered only when the subject declares the field-write operation *and* the host granted a commit
 * route: a control that accepts a name, reports success and saves nothing is worse than no control,
 * so its absence is deliberate rather than a missing feature.
 *
 * The write itself is the ordinary field write every editable tree row uses — the viewer names the
 * path, the codec turns it into an edit plan, the host commits it.
 */
export function canRenameClips(route: {
  readonly descriptor: AnyDescriptor
  readonly commit?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
}): boolean {
  const operation = route.descriptor.operations.find(
    (candidate: { readonly id: string }) => candidate.id === CLIP_RENAME_OPERATION,
  )
  if (operation === undefined || operation.state !== 'available') return false
  // Without both ports the write cannot land, and a control that cannot save is worse than none.
  return route.commit !== undefined && route.authorization !== undefined
}

function mountClipRename(
  toolbar: HTMLElement,
  options: ClipRenameOptions,
): (() => void) | undefined {
  if (!canRenameClips(options)) return undefined

  const field = element(toolbar, 'input', { part: 'model.animation-name' }) as HTMLInputElement
  field.type = 'text'
  field.disabled = true
  field.setAttribute('aria-label', options.localizer.text('viewer.modelAnimationName'))
  const status = element(toolbar, 'output', { part: 'model.animation-name-status' })

  const selectedClip = (): { clip: ModelAnimationClip; ordinal: number } | undefined => {
    const ordinal = options.clips.findIndex(candidate => candidate.id === options.selector.value)
    const clip = options.clips[ordinal]
    return clip === undefined ? undefined : { clip, ordinal }
  }

  const syncToSelection = () => {
    const selected = selectedClip()
    field.disabled = selected === undefined
    field.value = selected?.clip.name ?? ''
    status.textContent = ''
  }
  syncToSelection()
  options.selector.addEventListener('change', syncToSelection, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  const rename = async () => {
    const selected = selectedClip()
    const name = field.value.trim()
    if (selected === undefined || name === '' || name === selected.clip.name) {
      syncToSelection()
      return
    }
    field.disabled = true
    status.textContent = options.localizer.text('viewer.modelAnimationRenaming')
    const refusal = await commitOperationWrite(
      {
        descriptor: options.descriptor,
        operations: options.operations,
        ...(options.commit === undefined ? {} : { commit: options.commit }),
        ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
      },
      CLIP_RENAME_OPERATION,
      {
        groupId: 'tree',
        path: [...clipNamePath(selected.clip, selected.ordinal)],
        key: 'name',
        value: name,
      } as JsonValue,
      options.signal,
    )
    field.disabled = false
    if (refusal !== undefined) {
      status.textContent = refusal
      return
    }
    status.textContent = ''
    // The selector label follows the committed name; the host reopens the subject for the rest.
    const option = [...options.selector.options].find(
      candidate => candidate.value === selected.clip.id,
    )
    if (option !== undefined) option.text = name
  }

  field.addEventListener('change', () => void rename(), {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return () => {
    field.remove()
    status.remove()
  }
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
        /*
         * MK2's five control sections, created before anything the document declares.
         *
         * Every one of these controls already existed; they lived in a strip over the render area,
         * which is the arrangement MK2 moved away from — a toolbar has room for a row of buttons
         * and no room for a labelled field, so «Model scale» and the team colour had nowhere to go
         * and were simply absent. They are created here, empty, so the panel reads in MK2's order
         * whatever order the controls below happen to be built in; each is removed at the end if
         * nothing put a control in it, because an empty «Export» would claim a writer this host
         * did not grant.
         */
        const panel = {
          rendering: shell.section('rendering', localizer.text('viewer.modelRendering'), {
            icon: 'device-camera-video',
            collapsed: false,
          }),
          animation: shell.section('animation', localizer.text('viewer.modelAnimation'), {
            icon: 'play',
            collapsed: false,
          }),
          editing: shell.section('editing', localizer.text('viewer.modelEditing'), {
            icon: 'edit',
          }),
          teamColor: shell.section('team-color', localizer.text('viewer.modelTeamColor'), {
            icon: 'symbol-color',
          }),
          export: shell.section('export', localizer.text('viewer.modelExport'), {
            icon: 'export',
          }),
        }
        const controlRow = (
          section: (typeof panel)['rendering'],
          label: string,
        ): { readonly row: HTMLElement; readonly field: HTMLElement } => {
          const grid =
            section.body.querySelector<HTMLElement>(`[${PART_ATTRIBUTE}="model.controls"]`) ??
            element(section.body, 'div', { part: 'model.controls' })
          const row = element(grid, 'div', { part: 'model.control-row' })
          element(row, 'span', { text: label, part: 'model.control-label' })
          return { row, field: element(row, 'span', { part: 'model.control-field' }) }
        }

        // What the scene declares, as sidebar sections rather than a panel over the render area.
        const body = shell.section('properties', localizer.text('viewer.modelProperties'), {
          icon: 'symbol-misc',
          collapsed: false,
        }).body
        const list = element(body, 'dl', { part: 'image.metadata' })
        /*
         * Everything `ModelSceneInfo` states, not the three counts this used to pick out.
         *
         * `upAxis` decides whether the model is drawn on its side and `geometryAccess` decides
         * whether it is drawn at all — a reader who cannot see either has no way to tell a
         * metadata-only source from a broken one.
         */
        for (const [label, value] of [
          [localizer.text('viewer.modelSceneCount'), String(model.info.scenes)],
          [localizer.text('viewer.modelNodeCount'), String(model.info.nodes)],
          [localizer.text('viewer.modelMeshCount'), String(model.info.meshes)],
          [localizer.text('viewer.modelPrimitiveCount'), String(model.info.primitives)],
          [localizer.text('viewer.modelMaterialCount'), String(model.info.materials)],
          [localizer.text('viewer.modelTextureCount'), String(model.info.textures)],
          [localizer.text('viewer.modelAnimationCount'), String(model.info.animations)],
          [localizer.text('viewer.modelUpAxis'), model.info.upAxis ?? '+y'],
          [localizer.text('viewer.modelGeometryAccess'), model.info.geometryAccess],
        ] as const) {
          const row = element(list, 'div', { part: 'metadata.row' })
          element(row, 'dt', { text: label, part: 'metadata.label' })
          setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 64)
        }
        if (model.info.bounds !== undefined) {
          const bounds = model.info.bounds
          const boundsList = element(
            shell.section('bounds', localizer.text('viewer.modelBounds'), {
              icon: 'symbol-ruler',
              collapsed: true,
            }).body,
            'dl',
            { part: 'image.metadata' },
          )
          const extent = bounds.max.map((value, axis) => value - (bounds.min[axis] ?? 0))
          for (const [label, value] of [
            [localizer.text('viewer.modelBoundsMinimum'), describeModelValue(bounds.min)],
            [localizer.text('viewer.modelBoundsMaximum'), describeModelValue(bounds.max)],
            [localizer.text('viewer.modelBoundsExtent'), describeModelValue(extent)],
          ] as const) {
            const row = element(boundsList, 'div', { part: 'metadata.row' })
            element(row, 'dt', { text: label, part: 'metadata.label' })
            setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 160)
          }
        }
        mountContributedSections(shell, options.sections, args, unmount => scope.cleanup(unmount))
        /*
         * One section per list the format names, each row a field the record itself carries.
         * A record is shown as its own fields rather than as a rendered sentence, because the
         * reason to open Lights is to read a light's colour and the node it hangs on.
         */
        for (const spec of MODEL_PANEL_SECTIONS) {
          const page = facetPages.get(spec.contract)
          if (page === undefined) continue
          const records =
            spec.kind === undefined
              ? page.items
              : page.items.filter(
                  item =>
                    typeof item === 'object' &&
                    item !== null &&
                    (item as { kind?: unknown }).kind === spec.kind,
                )
          if (records.length === 0) continue
          const section = shell.section(spec.id, `${spec.title} (${records.length})`, {
            icon: spec.icon,
            collapsed: true,
          })
          for (const record of records) {
            const rows = modelRecordRows(record)
            if (rows.length === 0) continue
            const named = record as { name?: unknown; id?: unknown }
            const entry = element(section.body, 'details', { part: 'model.facet-item' })
            element(entry, 'summary', {
              text: String(
                (typeof named.name === 'string' && named.name !== '' ? named.name : undefined) ??
                  named.id ??
                  spec.title,
              ),
            })
            const list = element(entry, 'dl', { part: 'image.metadata' })
            for (const [key, value] of rows) {
              const row = element(list, 'div', { part: 'metadata.row' })
              element(row, 'dt', { text: key, part: 'metadata.label' })
              setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 160)
            }
          }
        }
        /*
         * MK2's last section: what each facet actually answered.
         *
         * `describeModelFacetPages` was already being computed and then thrown away, so a facet
         * that returned a truncated page — a model with more emitters than one page holds — looked
         * exactly like one that returned everything. The renderer's own outcome joins it further
         * down, where the provider is known.
         */
        const diagnostics = shell.section(
          'diagnostics',
          localizer.text('viewer.modelDiagnosticsSection'),
          { icon: 'warning', collapsed: true },
        )
        const diagnosticsList = element(diagnostics.body, 'dl', { part: 'image.metadata' })
        const diagnosticRow = (label: string, value: string): void => {
          const row = element(diagnosticsList, 'div', { part: 'metadata.row' })
          element(row, 'dt', { text: label, part: 'metadata.label' })
          setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 160)
        }
        for (const detail of facetDetails) {
          diagnosticRow(detail.label, detail.items.join(' · ') + (detail.truncated ? ' …' : ''))
        }
        /*
         * The footer MK2 had: what the model is made of, at a glance.
         *
         * Counts of meshes and materials say how a model is organised; vertices and triangles say
         * how big it is, and that is the number a reader wants before opening a section. Bones and
         * resources follow because a skinned model and a textured one behave differently in every
         * other surface.
         */
        const sceneTotals = model.primitives.reduce(
          (totals: { vertices: number; triangles: number }, primitive) => ({
            vertices: totals.vertices + Math.floor(primitive.positions.length / 3),
            triangles:
              totals.triangles +
              Math.floor((primitive.indices?.length ?? primitive.positions.length / 3) / 3),
          }),
          { vertices: 0, triangles: 0 },
        )
        const boneCount = facetPages.get('common.view/model-skeleton-source')?.items.length ?? 0
        const resourceCount =
          facetPages.get('common.view/model-resource-refs-source')?.items.length ?? 0
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
          {
            id: 'geometry',
            icon: 'symbol-method',
            text: `${sceneTotals.vertices} v · ${sceneTotals.triangles} tri`,
            align: 'start',
          },
          ...(boneCount === 0
            ? []
            : [
                {
                  id: 'rig',
                  icon: 'type-hierarchy',
                  text: `${boneCount} bones`,
                  align: 'start' as const,
                },
              ]),
          ...(resourceCount === 0
            ? []
            : [
                {
                  id: 'resources',
                  icon: 'file-media',
                  text: `${resourceCount} textures`,
                  align: 'start' as const,
                },
              ]),
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
          /*
           * The frame follows the canvas, because the canvas follows the panel.
           *
           * The element is laid out by flex - a VS Code editor column is rarely 3:2 - while the
           * backing store and the projection come from this viewport. Leaving it at a fixed size
           * meant the browser scaled a 3:2 frame into whatever box the panel gave it, and the
           * model came out stretched along one axis. It is measured instead, and re-measured
           * whenever the panel changes.
           */
          const viewport = { width: MODEL_STAGE_WIDTH, height: MODEL_STAGE_HEIGHT }
          const view = canvas.ownerDocument.defaultView
          const measureViewport = (): boolean => {
            const rect = canvas.getBoundingClientRect()
            // No layout yet, or a detached document: the fallback size is the honest answer.
            if (rect.width <= 0 || rect.height <= 0) return false
            /*
             * One scale for both axes, so the backing store keeps the box's shape.
             *
             * Clamping each axis to 2048 on its own is what made the model stretch: a 1308x968 box
             * at 2x wants 2616x1936, and capping only the width left a 2048x1936 buffer drawn into
             * a 4:3 box. The frame was correct and the browser scaled it wrong — which is why the
             * distortion followed the panel's shape and disappeared at small sizes. The cap is a
             * cost ceiling on the longest edge, so it applies to the whole measurement at once.
             */
            const density = Math.min(2, view?.devicePixelRatio ?? 1)
            const scale = Math.min(density, 2048 / rect.width, 2048 / rect.height)
            const width = Math.max(1, Math.round(rect.width * scale))
            const height = Math.max(1, Math.round(rect.height * scale))
            if (viewport.width === width && viewport.height === height) return false
            viewport.width = width
            viewport.height = height
            return true
          }

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
          /*
           * The publisher's up axis, applied once here.
           *
           * The orbit controller works in y-up viewer space by construction, so a z-up model —
           * StarCraft II, Warcraft III, Diablo III — has to be turned before it is framed or lit,
           * or it lies on its side and the key light rakes it from below. A publisher that states
           * nothing is read as y-up, which is what every consumer assumed before.
           */
          const correction = upAxisCorrection(model.info.upAxis)
          const orient = (sampled: ReturnType<typeof player.sample>) =>
            correction === undefined
              ? sampled
              : {
                  ...sampled,
                  primitives: sampled.primitives.map(one => orientPrimitive(one, correction)),
                }
          let player = createModelSceneSampler(projection, { signal: scope.signal })
          let scene = orient(player.sample(0, scope.signal))
          let selectedPrimitive: string | undefined
          let activeClip: ModelAnimationClip | undefined
          let timeSeconds = 0
          /*
           * The colour a team-coloured material layer resolves to, MK2's red by default.
           *
           * A model whose materials declare no team-colour layer is unaffected by this, which is
           * why the section is offered whenever a material facet was published rather than gated on
           * a capability query: the honest answer for such a model is that nothing changes, and
           * that is visible the moment the swatch is used.
           */
          let teamColor: readonly [number, number, number] = [0.851, 0.078, 0.059]
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
          /*
           * The two facts a reader of an untextured model needs, stated rather than inferred from
           * the picture: which renderer drew it, and how many of the textures it asked the host for
           * came back. `2 of 9` is a resolution problem; `0 of 0` is a model with no textures.
           */
          diagnosticRow(
            localizer.text('viewer.modelRendererLabel'),
            `${canvas.getAttribute('data-model-renderer') ?? ''} · ${canvas.getAttribute('data-model-renderer-status') ?? ''}${provider === undefined ? '' : ` · ${provider.rendererId}`}`,
          )
          diagnosticRow(
            localizer.text('viewer.modelTextureStatus'),
            `${surfaces.textures.length} / ${resourceRefs.filter(item => item.role === 'texture').length}`,
          )
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
            measureViewport()
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
            measureViewport()
            const pose = camera.pose
            gizmo.update(pose.yaw, pose.pitch)
            const request = generation
            if (scope.signal.aborted) return
            if (renderBusy) {
              redrawPending = true
              return
            }
            try {
              scene = orient(player.sample(timeSeconds, scope.signal))
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
            // Measured here as well as in the wireframe path: the first shaded frame used to be
            // projected for the 720x480 fallback and only corrected once the observer fired.
            measureViewport()
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
                      teamColor,
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

          const button = (
            parent: HTMLElement,
            label: string,
            title: string,
            run: () => void,
          ): HTMLElement => {
            const node = element(parent, 'button', { part: 'operations.button', text: label })
            node.setAttribute('type', 'button')
            node.title = title
            node.addEventListener('click', run, { signal: scope.signal })
            return node
          }
          const viewRow = controlRow(panel.rendering, localizer.text('viewer.modelView3d')).field
          button(
            viewRow,
            localizer.text('viewer.reset'),
            localizer.text('viewer.resetCamera'),
            () => camera.reset(),
          )
          button(viewRow, '−', localizer.text('viewer.zoomOut'), () => camera.zoom(1))
          button(viewRow, '+', localizer.text('viewer.zoomIn'), () => camera.zoom(-1))
          if (scene.joints.length > 0) {
            const toggle = button(
              viewRow,
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

          /*
           * The team colour, offered whenever this subject published materials at all.
           *
           * Which layers are team-coloured is the material's own business and the renderer's; the
           * viewer neither knows nor needs to. It states the colour and redraws — a model with no
           * such layer simply does not change, which is a truthful answer and a visible one.
           */
          if (materialRefs.length > 0) {
            const swatchRow = controlRow(
              panel.teamColor,
              localizer.text('viewer.modelTeamColorCustom'),
            )
            const picker = element(swatchRow.field, 'input', {
              part: 'model.team-color',
            }) as HTMLInputElement
            picker.type = 'color'
            picker.value = '#d9140f'
            picker.setAttribute('aria-label', localizer.text('viewer.modelTeamColorCustom'))
            const applyTeamColor = (hex: string): void => {
              const value = /^#([0-9a-f]{6})$/iu.exec(hex)?.[1]
              if (value === undefined) return
              teamColor = Object.freeze([
                Number.parseInt(value.slice(0, 2), 16) / 255,
                Number.parseInt(value.slice(2, 4), 16) / 255,
                Number.parseInt(value.slice(4, 6), 16) / 255,
              ] as [number, number, number])
              canvas.setAttribute('data-model-team-color', `#${value.toLowerCase()}`)
              generation++
              redraw()
            }
            picker.addEventListener('input', () => applyTeamColor(picker.value), {
              signal: scope.signal,
            })
            const presets = controlRow(
              panel.teamColor,
              localizer.text('viewer.modelTeamColorPresets'),
            ).field
            presets.setAttribute('role', 'group')
            for (const preset of MODEL_TEAM_COLOR_PRESETS) {
              const swatch = button(presets, '', preset, () => {
                picker.value = preset
                applyTeamColor(preset)
              })
              swatch.style.setProperty('background', preset)
              swatch.setAttribute('aria-label', preset)
            }
            canvas.setAttribute('data-model-team-color', '#d9140f')
          }

          if (model.primitiveIds.length > 1) {
            const selector = element(
              controlRow(panel.rendering, localizer.text('viewer.modelPrimitive')).field,
              'select',
              { part: 'model.primitive-selector' },
            ) as HTMLSelectElement
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
          const conversions = modelConversions(args.descriptor)
          if (conversions.length > 0) {
            const exportRow = controlRow(panel.export, localizer.text('viewer.modelConvert'))
            const convert = element(exportRow.field, 'select', {
              part: 'model.convert-selector',
            }) as HTMLSelectElement
            convert.setAttribute('aria-label', localizer.text('viewer.modelConvert'))
            const prompt = element(convert, 'option', {
              text: localizer.text('viewer.modelConvert'),
            }) as HTMLOptionElement
            prompt.value = ''
            for (const preset of conversions) {
              const option = element(convert, 'option', { text: preset.form.label })
              ;(option as HTMLOptionElement).value = preset.form.id
            }
            const convertStatus = element(exportRow.field, 'output', {
              part: 'model.convert-status',
            })
            const writeFiles = options.exportBytes
            if (writeFiles === undefined) {
              convert.disabled = true
              // The host granted no writer, so the control says why rather than doing nothing.
              convertStatus.textContent = localizer.text('viewer.modelConvertUnavailable')
            } else
              convert.addEventListener(
                'change',
                () => {
                  const preset = conversions.find(item => item.form.id === convert.value)
                  convert.value = ''
                  if (preset === undefined) return
                  convertStatus.textContent = localizer.text('viewer.modelConverting', {
                    preset: preset.form.label,
                  })
                  void (async () => {
                    try {
                      const result = await args.operations.invoke(
                        preset.form.handlerId,
                        preset.input,
                        { signal: scope.signal },
                      )
                      if (result.state !== 'ok') throw new Error(result.reason)
                      const output = result.output as { kind: string; value?: unknown }
                      if (output.kind !== 'bytes' || !(output.value instanceof Uint8Array))
                        throw new Error(`the codec answered ${output.kind}, not bytes`)
                      const base = options.exportBaseName?.(args.descriptor) ?? 'model'
                      const writes = preset.form.writes
                      if (writes === undefined)
                        throw new Error(`${preset.form.id} declares no write target`)
                      const outcome = await writeFiles(
                        [
                          {
                            name: convertedFileName(base, preset.form.id, writes.extension),
                            mediaType: writes.mediaType,
                            bytes: output.value,
                          },
                        ],
                        scope.signal,
                      )
                      convertStatus.textContent =
                        outcome.state === 'written'
                          ? localizer.text('viewer.modelConverted', { preset: preset.form.label })
                          : (outcome.reason ?? outcome.state)
                    } catch (error) {
                      convertStatus.textContent =
                        error instanceof Error ? error.message : String(error)
                    }
                  })()
                },
                { signal: scope.signal },
              )
          }
          if (clips.length > 0) {
            const sequenceField = controlRow(
              panel.animation,
              localizer.text('viewer.modelAnimation'),
            ).field
            const selector = element(sequenceField, 'select', {
              part: 'model.animation-selector',
            }) as HTMLSelectElement
            /*
             * The rename field goes to Editing, as it did in MK2: renaming a sequence changes the
             * document, which is a different act from choosing which one to watch.
             */
            const renameClip = mountClipRename(
              controlRow(panel.editing, localizer.text('viewer.modelAnimationRename')).field,
              {
                localizer,
                descriptor: args.descriptor,
                operations: args.operations,
                ...(args.commit === undefined ? {} : { commit: args.commit }),
                ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
                selector,
                clips,
                signal: scope.signal,
              },
            )
            if (renameClip !== undefined) scope.cleanup(renameClip)
            selector.setAttribute('aria-label', localizer.text('viewer.modelAnimation'))
            const rest = element(selector, 'option', {
              text: localizer.text('viewer.modelRestPose'),
            }) as HTMLOptionElement
            rest.value = ''
            for (const clip of clips) {
              const option = element(selector, 'option', { text: clip.name }) as HTMLOptionElement
              option.value = clip.id
            }
            const playbackField = controlRow(
              panel.animation,
              localizer.text('viewer.modelPlayback'),
            ).field
            const seek = element(
              controlRow(panel.animation, localizer.text('viewer.modelAnimationTime')).field,
              'input',
              { part: 'model.animation-seek' },
            ) as HTMLInputElement
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
            const toggle = button(playbackField, '▶', localizer.text('viewer.playPause'), () => {
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
          // The panel is resizable, and a frame drawn for the old width is the stretched one.
          const resizeObserver =
            typeof ResizeObserver === 'undefined'
              ? undefined
              : new ResizeObserver(() => {
                  if (measureViewport()) redraw()
                })
          resizeObserver?.observe(canvas)
          scope.cleanup(() => resizeObserver?.disconnect())
          redraw()
        }
        /*
         * What this subject actually offered, and nothing else.
         *
         * The five control sections are created up front so the panel keeps MK2's order whatever
         * order the controls are built in; the ones nothing filled are removed here. An empty
         * «Export» claims a writer the host did not grant, and an empty «Animation» claims a model
         * has sequences — both are worse than the section not being there.
         */
        for (const section of Object.values(panel)) {
          if (section.body.childElementCount === 0) section.root.remove()
        }
        // Every control moved into the panel; the strip over the render area has nothing left.
        if (toolbar.childElementCount === 0) toolbar.remove()
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
