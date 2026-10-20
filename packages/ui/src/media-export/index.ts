/**
 * Media export of a world: a map, a cutscene, a replay preview or a model shown as a world of one
 * object, rendered into an image, an animation, a set of frames or a sprite sheet
 * (`MediaExportRequest` in `@modkit/sdk`).
 *
 * Owners and route. The world source publishes what is there and, when it samples time itself
 * (cutscenes, replays), each moment through `frame(timeMs)`; `inspectCandidateWorld` and
 * `candidateWorldWebGlInput` (the world viewer's own reading) turn it into renderer input; the scene's
 * `createWorldWebGlPlan` + `renderWorldHeadless` draw it on the CPU — the drawing MCP `world_scene`
 * renders too. Objects animate on the world clock (`timeSeconds`) with the clip the world selected
 * for them, or with a clip the request names (`animations`), applied as the object's
 * `presentationAnimation` so the renderer's own clip matching chooses it. Encoding belongs to the
 * format's module and arrives as a `MediaEncoder`; this module writes only what needs no codec of
 * its own: frame sets and sprite sheets as ZIPs of PNGs (codec-kit raster + ZIP writer).
 *
 * Bounds: at most `MEDIA_EXPORT_LIMITS.maxFrames` frames and `maxPixels` pixels over all frames are
 * drawn and held before encoding (the host encoder's own window); one sheet is at most
 * `maxSheetEdge` pixels a side. Every frame is drawn from the same inspected world, so models and
 * textures are acquired once per export.
 * Composition is selected before model acquisition: terrain keeps cliff/ramp presentation pieces,
 * all keeps placed objects too. Water is independent; the same selection applies to sampled frames.
 *
 * Limits of this profile: no audio (clip sound events are only counted, `MediaTimelineReport`),
 * no blending between named clips, the CPU renderer's lighting (no shadows or tone mapping, as MCP
 * renders), and a camera `default` that is the world's own only when its frames carry one.
 */
import type {
  MediaAnimationChoice,
  MediaCamera,
  MediaClipSummary,
  MediaEncodeRequest,
  MediaEncoder,
  MediaExportReceipt,
  MediaExportRequest,
  MediaFormatOffer,
  MediaOrbitPose,
  MediaSpriteSheetLayout,
  MediaTimelineReport,
  ModelAnimationClip,
} from '@modkit/sdk'
import type {
  CandidateWorldSceneSource,
  WorldSceneFrame,
  WorldSceneModelResult,
  WorldSceneObjectItem,
} from '@modkit/sdk/maps'
import { encodePng, encodeTga } from '@modkit/codec-kit/raster'
import { createZipArchive } from '@modkit/codec-kit/container/zip'
import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlPlan,
  renderWorldHeadless,
  worldGlb,
  worldModelAnimation,
  worldObjectModelResources,
  type WorldWebGlCamera,
  type WorldWebGlFrame,
  type WorldWebGlInput,
} from '@modkit/scene/world'
import {
  WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
  WORLD_VIEWER_MAX_LAYERS,
  candidateWorldWebGlInput,
  inspectCandidateWorld,
  worldModelAssetStatus,
  type CandidateWorldViewerModel,
  type WorldOverlayFacet,
} from '../world/index.js'

export const MEDIA_EXPORT_LIMITS = Object.freeze({
  /** Frames drawn for one file (the host's ffmpeg encoder admits 300). */
  maxFrames: 300,
  /** Pixels over all drawn frames, held as RGBA8 until encoded (256 MiB). */
  maxPixels: 64_000_000,
  minEdge: 16,
  maxEdge: 2048,
  maxSheetEdge: 8192,
  maxFps: 50,
  /** A request without a duration plays the longest selected clip, at most this long. */
  maxDefaultDurationMs: 10_000,
  /** One page of a world source read. */
  maxPageItems: 1_024,
})

const ALL_OVERLAYS: readonly WorldOverlayFacet[] = ['regions', 'navigation', 'gateways']

export class MediaExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'MediaExportError'
  }
}

const refuse = (code: string, message: string): never => {
  throw new MediaExportError(`x3.media/${code}`, message)
}

// ---------------------------------------------------------------------------------------------
// encoders this module owns: frames and sheets as ZIPs of PNG, PNG and TGA themselves

const zipBudget = (files: number, bytes: number) => ({
  maxNodes: files + 1,
  maxInputBytes: BigInt(bytes) + 1_048_576n,
})

const PNG_ENCODER: MediaEncoder = Object.freeze({
  offer: Object.freeze({
    id: 'png',
    label: 'PNG',
    kind: 'still',
    extension: '.png',
    mediaType: 'image/png',
    alpha: true,
    lossy: false,
  }),
  encode: (request: MediaEncodeRequest) =>
    encodePng(request.width, request.height, request.frames[0]!, request.signal),
})

const TGA_ENCODER: MediaEncoder = Object.freeze({
  offer: Object.freeze({
    id: 'tga',
    label: 'TGA',
    kind: 'still',
    extension: '.tga',
    mediaType: 'image/x-tga',
    alpha: true,
    lossy: false,
  }),
  encode: async (request: MediaEncodeRequest) =>
    encodeTga({ width: request.width, height: request.height, pixels: request.frames[0]! }),
})

const PNG_FRAMES_ENCODER: MediaEncoder = Object.freeze({
  offer: Object.freeze({
    id: 'png-frames',
    label: 'PNG frames (ZIP)',
    kind: 'frames',
    extension: '.zip',
    mediaType: 'application/zip',
    alpha: true,
    lossy: false,
    maxFrames: MEDIA_EXPORT_LIMITS.maxFrames,
  }),
  async encode(request: MediaEncodeRequest) {
    const files: (readonly [string, Uint8Array])[] = []
    let bytes = 0
    for (const [index, frame] of request.frames.entries()) {
      const png = await encodePng(request.width, request.height, frame, request.signal)
      bytes += png.byteLength
      if (bytes > request.maxBytes)
        refuse('output-too-large', `the frames exceed ${request.maxBytes} bytes`)
      files.push([`frame-${String(index).padStart(4, '0')}.png`, png])
    }
    return createZipArchive(files, zipBudget(files.length, bytes))
  },
})

/** The sheet itself is assembled by renderWorldMedia (it needs the layout); this offer names it. */
const SPRITE_SHEET_ENCODER: MediaEncoder = Object.freeze({
  offer: Object.freeze({
    id: 'sprite-sheet',
    label: 'Sprite sheet (PNG + JSON in a ZIP)',
    kind: 'sprite-sheet',
    extension: '.zip',
    mediaType: 'application/zip',
    alpha: true,
    lossy: false,
    maxFrames: MEDIA_EXPORT_LIMITS.maxFrames,
  }),
  encode: async () =>
    refuse(
      'sheet-direct',
      'a sprite sheet is assembled by renderWorldMedia, not encoded frame by frame',
    ),
})

/** The world's scene as glTF; written by renderWorldMedia from the plan (`worldGlb`), not from frames. */
const GLB_ENCODER: MediaEncoder = Object.freeze({
  offer: Object.freeze({
    id: 'glb',
    label: 'glTF binary (3D scene)',
    kind: 'scene',
    extension: '.glb',
    mediaType: 'model/gltf-binary',
    alpha: true,
    lossy: false,
  }),
  encode: async () =>
    refuse('scene-direct', 'a glTF scene is written by renderWorldMedia, not encoded from frames'),
})

/** Formats that need no codec beyond codec-kit; an application adds its format modules' encoders. */
export function builtInMediaEncoders(): readonly MediaEncoder[] {
  return Object.freeze([PNG_ENCODER, TGA_ENCODER, PNG_FRAMES_ENCODER, SPRITE_SHEET_ENCODER, GLB_ENCODER])
}

/** Edge of the baked ground of a `scene` export when the request names none smaller (renderer ceiling). */
const SCENE_TEXTURE_EDGE = 4096

// ---------------------------------------------------------------------------------------------
// reading a world once

async function inspect(
  world: CandidateWorldSceneSource,
  signal?: AbortSignal,
  budget: Readonly<{ maxModelBytes: number; bytesPerModel: number; textureBytesPerModel: number }> | undefined = undefined,
  request?: MediaExportRequest,
) {
  // a map preview first shows its world before the catalog answers; an export draws the answered one
  if (world.refined !== undefined) await world.refined(signal)
  return inspectCandidateWorld(world, {
    maxLayers: WORLD_VIEWER_MAX_LAYERS,
    maxItemsPerLayer: WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
    maxPageItems: MEDIA_EXPORT_LIMITS.maxPageItems,
    ...(budget === undefined ? {} : budget),
    ...(request?.content !== 'terrain' && request?.derivedFrom === undefined
      ? {}
      : { objectFilter: (item: WorldSceneObjectItem) => keepsMediaObject(item, request!) }),
    ...(signal === undefined ? {} : { signal }),
  })
}

/** Cliff/ramp presentation pieces belong to terrain; legacy source filters further narrow it. */
function keepsMediaObject(item: WorldSceneObjectItem, request: MediaExportRequest): boolean {
  return (request.content !== 'terrain' || item.derivedFrom === 'cliffs') &&
    (request.derivedFrom === undefined || request.derivedFrom.includes(item.derivedFrom ?? ''))
}

/** Apply composition to static and sampled items through the viewer's existing world input. */
function mediaWorldInput(
  model: CandidateWorldViewerModel, request: MediaExportRequest,
  hidden: ReadonlySet<WorldOverlayFacet>, frame?: WorldSceneFrame,
): WorldWebGlInput {
  const base = candidateWorldWebGlInput(model, hidden, frame)
  return { ...base, items: base.items.filter(item =>
    (request.includeWater !== false || item.facet !== 'water') &&
    (item.facet !== 'objects' || keepsMediaObject(item, request))) }
}

/**
 * Model budgets of a scene export: a glTF keeps every texture a model draws with, where a picture of
 * the world shares a small preview budget (a model with many textures then loses its last ones to it).
 * Larger shares stop the world from batching its static models; this one keeps the batches.
 */
const SCENE_MODEL_BUDGET = Object.freeze({
  maxModelBytes: 4 * 1024 * 1024 * 1024,
  bytesPerModel: 12 * 1024 * 1024,
  textureBytesPerModel: 8 * 1024 * 1024,
})

const objectItems = (model: CandidateWorldViewerModel): WorldSceneObjectItem[] =>
  model.layers.flatMap(layer =>
    layer.page.items.filter((item): item is WorldSceneObjectItem => item.facet === 'objects'),
  )

const convertedModel = (model: CandidateWorldViewerModel, item: WorldSceneObjectItem) => {
  for (const id of worldObjectModelResources(item)) {
    const result = model.models?.get(id)
    if (result?.state === 'converted') return { id, result }
  }
  return undefined
}

const clipSeconds = (clip: ModelAnimationClip): number | undefined =>
  clip.durationSeconds ??
  (clip.frameRate !== undefined && clip.frameRate > 0 ? clip.frames / clip.frameRate : undefined)

/** A clip that moves something; `alwaysActive` sequences and empty clips are not choices. */
const playable = (clip: ModelAnimationClip) => clip.channels.length > 0

/** Words of a requested name all present in the clip's name, as the world viewer's matching asks. */
function clipMatches(clip: ModelAnimationClip, requested: string): boolean {
  const words = new Set(
    clip.name
      .toLowerCase()
      .split(/[\s_]+/u)
      .filter(Boolean),
  )
  return requested
    .toLowerCase()
    .split(/[\s_]+/u)
    .filter(Boolean)
    .every(word => words.has(word))
}

const isSoundEvent = (event: NonNullable<ModelAnimationClip['events']>[number]) =>
  /^(snd|sound)/iu.test(event.name) ||
  (typeof event.payload?.['kind'] === 'string' && /^snd$/iu.test(event.payload['kind']))

function clipSummary(clip: ModelAnimationClip): MediaClipSummary {
  const seconds = clipSeconds(clip)
  const events = clip.events ?? []
  return Object.freeze({
    name: clip.name,
    ...(seconds === undefined ? {} : { durationSeconds: seconds }),
    ...(clip.loop === undefined && clip.looping === undefined
      ? {}
      : {
          loop:
            clip.loop !== undefined
              ? clip.loop === 'loop' || clip.loop === 'ping-pong'
              : clip.looping === true,
        }),
    events: events.length,
    soundEvents: events.filter(isSoundEvent).length,
  })
}

/**
 * What of the world moves: which models its objects use, their clips (with the clip the world plays
 * on them now) and whether the source samples time and carries a camera.
 */
export async function inspectWorldMedia(
  world: CandidateWorldSceneSource,
  options: { readonly formats?: readonly MediaFormatOffer[]; readonly signal?: AbortSignal } = {},
): Promise<MediaTimelineReport> {
  const model = await inspect(world, options.signal)
  const objects = objectItems(model)
  const byModel = new Map<
    string,
    { objects: number; playing?: string; result: WorldSceneModelResult }
  >()
  let animatedObjects = 0
  for (const item of objects) {
    const found = convertedModel(model, item)
    if (found === undefined) {
      for (const id of worldObjectModelResources(item)) {
        const result = model.models?.get(id)
        if (result !== undefined && !byModel.has(id)) byModel.set(id, { objects: 0, result })
        if (result !== undefined) byModel.get(id)!.objects++
      }
      continue
    }
    const entry = byModel.get(found.id) ?? { objects: 0, result: found.result }
    entry.objects++
    const clip = worldModelAnimation(
      found.result as Extract<WorldSceneModelResult, { state: 'converted' }>,
      item,
    )
    if (clip !== undefined && clip.channels.length > 0) {
      animatedObjects++
      entry.playing ??= clip.name
    }
    byModel.set(found.id, entry)
  }
  let sourceCamera = false
  if (world.frame !== undefined) {
    const first = await world.frame(0, options.signal).catch(() => undefined)
    sourceCamera = first?.camera !== undefined || first?.modelCamera !== undefined
  }
  const status = worldModelAssetStatus(model)
  return Object.freeze({
    schemaVersion: 1,
    animated: animatedObjects > 0 || world.frame !== undefined,
    sampledTime: world.frame !== undefined,
    sourceCamera,
    objects: objects.length,
    animatedObjects,
    models: Object.freeze(
      [...byModel].map(([resourceId, entry]) =>
        Object.freeze({
          resourceId,
          state: entry.result.state,
          objects: entry.objects,
          ...(entry.playing === undefined ? {} : { playing: entry.playing }),
          clips: Object.freeze(
            entry.result.state === 'converted'
              ? (entry.result.animations ?? []).filter(playable).map(clipSummary)
              : [],
          ),
        }),
      ),
    ),
    formats: Object.freeze([...(options.formats ?? [])]),
    complete: model.info.complete && !status.partial,
  })
}

// ---------------------------------------------------------------------------------------------
// rendering

export interface WorldMediaResult {
  readonly bytes: Uint8Array
  readonly receipt: MediaExportReceipt
  readonly diagnostics: readonly Readonly<{ code: string; message: string; severity: string }>[]
}

export interface WorldMediaOptions {
  /** The largest file to write (default 64 MiB, the host ffmpeg encoder's ceiling). */
  readonly maxBytes?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (done: number, total: number) => void
}

function checkRequest(request: MediaExportRequest, offer: MediaFormatOffer) {
  const L = MEDIA_EXPORT_LIMITS
  for (const [name, value] of [
    ['width', request.width],
    ['height', request.height],
  ] as const)
    if (!Number.isSafeInteger(value) || value < L.minEdge || value > L.maxEdge)
      refuse('invalid-size', `${name} must be an integer from ${L.minEdge} to ${L.maxEdge}`)
  if (offer.evenDimensions === true && (request.width % 2 !== 0 || request.height % 2 !== 0))
    refuse('invalid-size', `${offer.label} needs an even width and height`)
  const fps = request.fps ?? 12
  if (!Number.isFinite(fps) || fps < 1 || fps > L.maxFps)
    refuse('invalid-fps', `fps must be from 1 to ${L.maxFps}`)
  if (
    request.durationMs !== undefined &&
    (!Number.isFinite(request.durationMs) ||
      request.durationMs <= 0 ||
      request.durationMs > 600_000)
  )
    refuse('invalid-duration', 'durationMs must be positive and at most 600000')
  if (request.startMs !== undefined && (!Number.isFinite(request.startMs) || request.startMs < 0))
    refuse('invalid-start', 'startMs must be a nonnegative number')
  const camera = request.camera
  if (
    camera?.kind === 'directions' &&
    (!Number.isSafeInteger(camera.count) || camera.count < 1 || camera.count > 64)
  )
    refuse('invalid-camera', 'directions.count must be an integer from 1 to 64')
  if (camera?.kind === 'orbit' && camera.turns !== undefined && !Number.isFinite(camera.turns))
    refuse('invalid-camera', 'orbit.turns must be finite')
  if (
    Array.isArray(request.background) &&
    (request.background.length !== 3 ||
      request.background.some(value => !Number.isFinite(value) || value < 0 || value > 1))
  )
    refuse('invalid-background', 'background is "transparent" or three numbers from 0 to 1')
  return fps
}

/** Objects a choice names: by id, by model resource, or every object whose model has the clip. */
function chosenItems(
  model: CandidateWorldViewerModel,
  choices: readonly MediaAnimationChoice[],
): {
  readonly byObject: ReadonlyMap<number, MediaAnimationChoice>
  readonly unmatched: readonly string[]
} {
  const byObject = new Map<number, MediaAnimationChoice>()
  const unmatched: string[] = []
  const objects = objectItems(model)
  for (const choice of choices) {
    let matched = 0
    for (const item of objects) {
      if (choice.objectId !== undefined && item.objectId !== choice.objectId) continue
      if (
        choice.resourceId !== undefined &&
        !worldObjectModelResources(item).includes(choice.resourceId)
      )
        continue
      const found = convertedModel(model, item)
      if (found === undefined || found.result.state !== 'converted') continue
      if (
        !(found.result.animations ?? []).some(
          clip => playable(clip) && clipMatches(clip, choice.clip),
        )
      )
        continue
      byObject.set(item.objectId, choice)
      matched++
    }
    if (matched === 0)
      unmatched.push(
        `${choice.clip}${choice.objectId === undefined ? '' : ` on object ${choice.objectId}`}${choice.resourceId === undefined ? '' : ` on ${choice.resourceId}`}`,
      )
  }
  return { byObject, unmatched }
}

/** Renderer input with the requested clips set as each chosen object's presentation animation. */
function withChoices(
  input: WorldWebGlInput,
  byObject: ReadonlyMap<number, MediaAnimationChoice>,
): WorldWebGlInput {
  if (byObject.size === 0) return input
  return {
    ...input,
    items: input.items.map(item => {
      if (item.facet !== 'objects') return item
      const choice = byObject.get(item.objectId)
      if (choice === undefined) return item
      return {
        ...item,
        presentationAnimation: Object.freeze({
          name: choice.clip,
          groups: Object.freeze([]),
          loop: choice.loop ?? true,
          speed: choice.speed ?? 1,
        }),
      }
    }),
  }
}

/** The longest clip the drawn objects play, in milliseconds (with the requested choices applied). */
function playedDurationMs(
  model: CandidateWorldViewerModel,
  byObject: ReadonlyMap<number, MediaAnimationChoice>,
): number | undefined {
  let longest: number | undefined
  for (const item of objectItems(model)) {
    const found = convertedModel(model, item)
    if (found === undefined || found.result.state !== 'converted') continue
    const choice = byObject.get(item.objectId)
    const clip =
      choice === undefined
        ? worldModelAnimation(found.result, item)
        : (found.result.animations ?? []).find(
            candidate => playable(candidate) && clipMatches(candidate, choice.clip),
          )
    const seconds = clip === undefined || clip.channels.length === 0 ? undefined : clipSeconds(clip)
    if (seconds !== undefined && seconds > 0) {
      const ms = (seconds * 1000) / (choice?.speed ?? 1)
      longest = longest === undefined ? ms : Math.max(longest, ms)
    }
  }
  return longest === undefined
    ? undefined
    : Math.min(longest, MEDIA_EXPORT_LIMITS.maxDefaultDurationMs)
}

function orbitCamera(
  pose: MediaOrbitPose,
  azimuth: number,
  frame: WorldWebGlFrame | undefined,
): WorldWebGlCamera {
  return Object.freeze({
    azimuth,
    elevation: pose.elevation ?? DEFAULT_WORLD_WEBGL_CAMERA.elevation,
    zoom: pose.zoom ?? DEFAULT_WORLD_WEBGL_CAMERA.zoom,
    target: pose.target ?? DEFAULT_WORLD_WEBGL_CAMERA.target,
    ...(pose.projection === undefined ? {} : { projection: pose.projection }),
    ...(pose.fieldOfView === undefined ? {} : { fieldOfView: pose.fieldOfView }),
    ...(frame === undefined ? {} : { frame }),
  })
}

/** Cameras per frame time: one row per direction (one row for every camera but `directions`). */
function cameraRows(
  camera: MediaCamera,
  frames: number,
): readonly ((
  index: number,
  input: WorldWebGlInput,
  frame: WorldWebGlFrame | undefined,
) => WorldWebGlCamera)[] {
  switch (camera.kind) {
    case 'default':
      return [
        (_, input, frame) =>
          input.camera ?? orbitCamera({}, DEFAULT_WORLD_WEBGL_CAMERA.azimuth, frame),
      ]
    case 'source':
      return [
        (_, input) =>
          input.camera ??
          refuse(
            'no-source-camera',
            'this world carries no camera of its own; ask for fixed, orbit or directions',
          ),
      ]
    case 'fixed':
      return [
        (_, __, frame) =>
          orbitCamera(camera, camera.azimuth ?? DEFAULT_WORLD_WEBGL_CAMERA.azimuth, frame),
      ]
    case 'orbit': {
      const start = camera.azimuth ?? DEFAULT_WORLD_WEBGL_CAMERA.azimuth
      const turns = camera.turns ?? 1
      return [
        (index, _, frame) =>
          orbitCamera(camera, start + (2 * Math.PI * turns * index) / Math.max(1, frames), frame),
      ]
    }
    case 'directions': {
      const start = camera.startAzimuth ?? camera.azimuth ?? 0
      return Array.from(
        { length: camera.count },
        (_, direction) =>
          (_index: number, _input: WorldWebGlInput, frame: WorldWebGlFrame | undefined) =>
            // clockwise seen from above, as game sprite facings are numbered
            orbitCamera(
              { projection: 'orthographic', ...camera },
              start - (2 * Math.PI * direction) / camera.count,
              frame,
            ),
      )
    }
  }
}

const clearColorOf = (
  background: MediaExportRequest['background'],
): readonly [number, number, number, number] =>
  background === 'transparent'
    ? [0, 0, 0, 0]
    : background === undefined
      ? [0, 0, 0, 1]
      : [background[0], background[1], background[2], 1]

/**
 * Renders `request` from `world` and encodes it with the request's format among `encoders`.
 * Models and textures are read once; every frame samples the world at its own moment.
 */
export async function renderWorldMedia(
  world: CandidateWorldSceneSource,
  request: MediaExportRequest,
  encoders: readonly MediaEncoder[],
  options: WorldMediaOptions = {},
): Promise<WorldMediaResult> {
  if (request.schemaVersion !== 1) refuse('invalid-request', 'schemaVersion must be 1')
  if (request.content !== undefined && request.content !== 'all' && request.content !== 'terrain')
    refuse('invalid-request', 'content must be all or terrain')
  if (request.includeWater !== undefined && typeof request.includeWater !== 'boolean')
    refuse('invalid-request', 'includeWater must be a boolean')
  const encoder = encoders.find(item => item.offer.id === request.format)
  if (encoder === undefined)
    refuse(
      'unknown-format',
      `no encoder for «${request.format}»; offered: ${encoders.map(item => item.offer.id).join(', ')}`,
    )
  const offer = encoder!.offer
  if (offer.kind === 'scene') return worldScene(world, request, offer, options)
  const fps = checkRequest(request, offer)
  const signal = options.signal
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const model = await inspect(world, signal, undefined, request)
  const { byObject, unmatched } = chosenItems(model, request.animations ?? [])
  const still = offer.kind === 'still'
  const startMs = request.startMs ?? 0
  const durationMs = still ? 0 : (request.durationMs ?? playedDurationMs(model, byObject) ?? 1000)
  const frames = still ? 1 : Math.max(1, Math.round((durationMs * fps) / 1000))
  const camera: MediaCamera =
    request.camera ??
    (offer.kind === 'sprite-sheet' ? { kind: 'directions', count: 8 } : { kind: 'default' })
  const rows = cameraRows(camera, frames)
  const drawn = frames * rows.length
  const limit = offer.maxFrames ?? MEDIA_EXPORT_LIMITS.maxFrames
  if (drawn > limit)
    refuse('too-many-frames', `${drawn} frames exceed the ${limit} ${offer.label} admits`)
  if (drawn * request.width * request.height > MEDIA_EXPORT_LIMITS.maxPixels)
    refuse(
      'too-many-pixels',
      `${drawn} frames of ${request.width}×${request.height} exceed ${MEDIA_EXPORT_LIMITS.maxPixels} pixels`,
    )
  if (
    offer.kind === 'sprite-sheet' &&
    (frames * request.width > MEDIA_EXPORT_LIMITS.maxSheetEdge ||
      rows.length * request.height > MEDIA_EXPORT_LIMITS.maxSheetEdge)
  )
    refuse(
      'sheet-too-large',
      `a ${frames}×${rows.length} sheet of ${request.width}×${request.height} cells exceeds ${MEDIA_EXPORT_LIMITS.maxSheetEdge} pixels a side`,
    )
  const hidden = new Set(ALL_OVERLAYS.filter(facet => !(request.overlays ?? []).includes(facet)))
  const clearColor = clearColorOf(request.background)
  const diagnostics: { code: string; message: string; severity: string }[] = []
  const seen = new Set<string>()
  const record = (
    items: readonly {
      readonly code: string
      readonly message: string
      readonly severity: string
    }[],
  ) => {
    for (const item of items) {
      const key = `${item.code}\u0000${item.message}`
      if (seen.has(key) || diagnostics.length >= 200) continue
      seen.add(key)
      diagnostics.push({ code: item.code, message: item.message, severity: item.severity })
    }
  }
  let complete = model.info.complete
  // the frame a camera's target and zoom are measured in, pinned from the first plan so that a turn,
  // a facing or a moving model never rescales the picture
  let pinned: WorldWebGlFrame | undefined
  const times = Array.from({ length: frames }, (_, index) => startMs + (index * 1000) / fps)
  const pictures: Uint8Array[][] = rows.map(() => [])
  for (const [index, at] of times.entries()) {
    signal?.throwIfAborted()
    let sampled: WorldSceneFrame | undefined
    if (world.frame !== undefined) {
      sampled = await world.frame(at, signal)
      if (!sampled.complete) complete = false
      record(sampled.diagnostics)
    }
    const base = mediaWorldInput(model, request, hidden, sampled)
    const input = withChoices(
      sampled === undefined ? { ...base, timeSeconds: at / 1000 } : base,
      byObject,
    )
    for (const [row, cameraOf] of rows.entries()) {
      const view = cameraOf(index, input, pinned)
      const plan = createWorldWebGlPlan({ ...input, camera: view })
      if (pinned === undefined && view.source === undefined && camera.kind !== 'default') {
        pinned = plan.stats.frame
      }
      const frame = await renderWorldHeadless(plan, {
        width: request.width,
        height: request.height,
        camera:
          view.source === undefined && pinned !== undefined ? { ...view, frame: pinned } : view,
        clearColor,
        ...(signal === undefined ? {} : { signal }),
      })
      record(frame.diagnostics)
      pictures[row]!.push(frame.rgba)
      options.onProgress?.(index * rows.length + row + 1, drawn)
    }
  }
  const status = worldModelAssetStatus(model)
  if (status.partial) complete = false
  let bytes: Uint8Array
  let sheet: MediaSpriteSheetLayout | undefined
  if (offer.kind === 'sprite-sheet') {
    const built = await spriteSheet(pictures, request.width, request.height, times, camera, signal)
    sheet = built.layout
    bytes = createZipArchive(
      [
        ['sprite-sheet.png', built.png],
        [
          'sprite-sheet.json',
          new TextEncoder().encode(`${JSON.stringify(built.layout, null, 1)}\n`),
        ],
      ],
      zipBudget(2, built.png.byteLength + 1_048_576),
    )
  } else {
    bytes = await encoder!.encode({
      width: request.width,
      height: request.height,
      fps,
      frames: rows.length === 1 ? pictures[0]! : pictures.flat(),
      maxBytes,
      ...(request.quality === undefined ? {} : { quality: request.quality }),
      ...(signal === undefined ? {} : { signal }),
    })
  }
  if (bytes.byteLength > maxBytes)
    refuse(
      'output-too-large',
      `the ${offer.label} file has ${bytes.byteLength} bytes, more than ${maxBytes}`,
    )
  if (request.background === 'transparent' && !offer.alpha)
    record([
      {
        code: 'x3.media/alpha-flattened',
        message: `${offer.label} keeps no transparency; the background is flattened`,
        severity: 'information',
      },
    ])
  const animatedObjects = objectItems(model).filter(item => {
    const found = convertedModel(model, item)
    if (found === undefined || found.result.state !== 'converted') return false
    if (byObject.has(item.objectId)) return true
    const clip = worldModelAnimation(found.result, item)
    return clip !== undefined && clip.channels.length > 0
  }).length
  return Object.freeze({
    bytes,
    diagnostics: Object.freeze(diagnostics),
    receipt: Object.freeze({
      format: offer.id,
      content: request.content ?? 'all',
      includeWater: request.includeWater ?? true,
      mediaType: offer.mediaType,
      extension: offer.extension,
      width: request.width,
      height: request.height,
      frames,
      fps,
      startMs,
      durationMs: still ? 0 : (frames * 1000) / fps,
      camera: camera.kind,
      ...(camera.kind === 'directions' ? { directions: camera.count } : {}),
      alpha: offer.alpha && request.background === 'transparent',
      audio: false,
      ...(offer.timing === undefined ? {} : { timing: offer.timing }),
      animatedObjects,
      unmatchedAnimations: Object.freeze(unmatched),
      models: Object.freeze({ total: status.total, converted: status.converted }),
      ...(sheet === undefined ? {} : { sheet }),
      complete,
    }),
  })
}

/**
 * The world at its first moment as one glTF binary: the plan the CPU renderer draws, written by the
 * scene's `worldGlb` (ground baked into one texture of `width` pixels a side, at most 4096).
 */
async function worldScene(
  world: CandidateWorldSceneSource,
  request: MediaExportRequest,
  offer: MediaFormatOffer,
  options: WorldMediaOptions,
): Promise<WorldMediaResult> {
  const edge = Math.max(request.width, request.height)
  if (!Number.isSafeInteger(edge) || edge < MEDIA_EXPORT_LIMITS.minEdge || edge > SCENE_TEXTURE_EDGE)
    refuse('invalid-size', `the ground texture edge must be an integer from ${MEDIA_EXPORT_LIMITS.minEdge} to ${SCENE_TEXTURE_EDGE}`)
  const signal = options.signal
  const model = await inspect(world, signal, SCENE_MODEL_BUDGET, request)
  const hidden = new Set(ALL_OVERLAYS.filter(facet => !(request.overlays ?? []).includes(facet)))
  const base = mediaWorldInput(model, request, hidden)
  const plan = createWorldWebGlPlan({ ...base, timeSeconds: (request.startMs ?? 0) / 1000 })
  const written = await worldGlb(plan, {
    terrainTextureSize: edge,
    maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal }),
  })
  const status = worldModelAssetStatus(model)
  return Object.freeze({
    bytes: written.bytes,
    diagnostics: Object.freeze([
      {
        code: 'x3.media/scene-written',
        message: `${written.stats.meshes} meshes, ${written.stats.triangles} triangles, ${written.stats.materials} materials, ${written.stats.images} images`,
        severity: 'information',
      },
      ...written.diagnostics,
    ]),
    receipt: Object.freeze({
      format: offer.id,
      content: request.content ?? 'all',
      includeWater: request.includeWater ?? true,
      mediaType: offer.mediaType,
      extension: offer.extension,
      width: edge,
      height: edge,
      frames: 1,
      fps: 1,
      startMs: request.startMs ?? 0,
      durationMs: 0,
      camera: 'default',
      alpha: true,
      audio: false,
      animatedObjects: 0,
      unmatchedAnimations: Object.freeze([]),
      models: Object.freeze({ total: status.total, converted: status.converted }),
      complete: model.info.complete && !status.partial,
    }),
  })
}

/** Directions as rows, frame times as columns, one PNG, and where each cell is. */
async function spriteSheet(
  pictures: readonly (readonly Uint8Array[])[],
  width: number,
  height: number,
  times: readonly number[],
  camera: MediaCamera,
  signal?: AbortSignal,
): Promise<{ png: Uint8Array; layout: MediaSpriteSheetLayout }> {
  const columns = times.length
  const rows = pictures.length
  const sheetWidth = columns * width
  const pixels = new Uint8Array(sheetWidth * rows * height * 4)
  const cells: MediaSpriteSheetLayout['cells'][number][] = []
  const start = camera.kind === 'directions' ? (camera.startAzimuth ?? camera.azimuth ?? 0) : 0
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cell = pictures[row]![column]!
      for (let y = 0; y < height; y++) {
        pixels.set(
          cell.subarray(y * width * 4, (y + 1) * width * 4),
          ((row * height + y) * sheetWidth + column * width) * 4,
        )
      }
      cells.push(
        Object.freeze({
          direction: row,
          frame: column,
          azimuth: camera.kind === 'directions' ? start - (2 * Math.PI * row) / rows : start,
          timeMs: times[column]!,
          x: column * width,
          y: row * height,
        }),
      )
    }
  }
  return {
    png: await encodePng(sheetWidth, rows * height, pixels, signal),
    layout: Object.freeze({
      columns,
      rows,
      cellWidth: width,
      cellHeight: height,
      cells: Object.freeze(cells),
    }),
  }
}
