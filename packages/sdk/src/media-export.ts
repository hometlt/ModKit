/**
 * Media export: one request shape for rendering any subject that publishes a world — a map, a
 * cutscene, a replay preview, or a model shown as a world of one object — into an image, an
 * animation, a frame set or a sprite sheet, and the receipt of what that render kept.
 *
 * Owners. Time sampling and drawing stay with the world source and the scene renderer
 * (`common.view/world-scene-source`, its optional `frame(timeMs)`, `@modkit/scene/world`); the
 * orchestration that turns a request into frames is `@modkit/ui/media-export`; every encoded format
 * is owned by its format module (PNG/TGA by codec-kit, GIF/WebP/JPEG by the images extension, OGV by
 * the video extension) and reaches the orchestration as a `MediaEncoder`. A host that runs ffmpeg
 * (`@modkit/host/node`) backs the lossy ones; a host without it simply offers fewer formats.
 *
 * Not here: audio (a sound track needs a shared time line and mixer, which no owner has yet; clip
 * events that name sounds are reported by `MediaTimelineReport`, not played), and native sprite
 * formats (SHP, GRP, R16): those are written by their game's own writer from a `sprite-sheet`.
 */

/** What a format holds: one image, a timed animation, independent frames, or a direction × frame sheet. */
export type MediaKind = 'still' | 'animation' | 'frames' | 'sprite-sheet'

/** One format an application can encode, as data: callers list them, requests name `id`. */
export interface MediaFormatOffer {
  /** Request and file name id: `png`, `gif`, `webp`, `ogv`, `png-frames`, `sprite-sheet`, … */
  readonly id: string
  readonly label: string
  readonly kind: MediaKind
  /** With the dot: `.png`, `.zip`. */
  readonly extension: string
  readonly mediaType: string
  /** Keeps transparency; a transparent background is otherwise flattened (and the receipt says so). */
  readonly alpha: boolean
  readonly lossy: boolean
  /** Width and height must be even (yuv420 video). */
  readonly evenDimensions?: boolean
  /** How the format stores frame timing: GIF in centiseconds, WebP in milliseconds, video by rate. */
  readonly timing?: 'frame-rate' | 'centisecond' | 'millisecond'
  /** The most frames one file of this format may hold in this application. */
  readonly maxFrames?: number
}

/** Pixels handed to an encoder: RGBA8, rows top to bottom, `width * height * 4` bytes per frame. */
export interface MediaEncodeRequest {
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly frames: readonly Uint8Array[]
  /** The largest file the caller accepts; an encoder refuses rather than truncates. */
  readonly maxBytes: number
  /** 0..100, for lossy formats; absent uses the format's own default. */
  readonly quality?: number
  readonly signal?: AbortSignal
}

/** A format and the code that writes it; the code belongs to the format's owner. */
export interface MediaEncoder {
  readonly offer: MediaFormatOffer
  encode(request: MediaEncodeRequest): Promise<Uint8Array>
}

/**
 * Where the eye is. Angles in radians, `zoom` and `target` as the world viewer measures them
 * (`WorldWebGlCamera`: target offsets the world's centre, zoom divides its frame radius).
 * - `default`: the world's own camera when it has one (a cutscene, a game view), else the viewer's.
 * - `source`: the world's own camera, refused when it publishes none.
 * - `fixed`: one orbit pose for every frame.
 * - `orbit`: turns `turns` times around the target over the animation (a still uses the start).
 * - `directions`: `count` evenly spaced azimuths, every one rendered at every frame time — the camera
 *   of a sprite sheet (8, 16 or 32 facings of a unit); the frame is pinned at rest so every facing
 *   and every frame keeps one scale.
 */
export type MediaCamera =
  | Readonly<{ kind: 'default' }>
  | Readonly<{ kind: 'source' }>
  | Readonly<{ kind: 'fixed' } & MediaOrbitPose>
  | Readonly<{ kind: 'orbit'; turns?: number } & MediaOrbitPose>
  | Readonly<{ kind: 'directions'; count: number; startAzimuth?: number } & MediaOrbitPose>

export interface MediaOrbitPose {
  readonly azimuth?: number
  readonly elevation?: number
  readonly zoom?: number
  readonly target?: readonly [number, number, number]
  readonly projection?: 'orthographic' | 'perspective'
  /** Vertical field of view of a perspective camera, radians. */
  readonly fieldOfView?: number
}

/**
 * A clip to play on objects of the world, by the clip's name (`Walk`, `Attack`, `Stand Work`, as
 * the model names it; matched the way the world viewer matches actor animation names).
 * Without `objectId` or `resourceId` it applies to every object whose model has such a clip.
 */
export interface MediaAnimationChoice {
  readonly clip: string
  readonly objectId?: number
  /** Every object drawn with this model resource. */
  readonly resourceId?: string
  readonly loop?: boolean
  /** Playback rate; 1 is the clip's own speed. */
  readonly speed?: number
}

export interface MediaExportRequest {
  readonly schemaVersion: 1
  /** A `MediaFormatOffer.id` the application offers. */
  readonly format: string
  readonly width: number
  readonly height: number
  /** First sampled moment, milliseconds of world time. */
  readonly startMs?: number
  /** Length of an animation, sprite sheet or frame set; absent, one second (or the clip's length). */
  readonly durationMs?: number
  /** Samples per second (default 12). */
  readonly fps?: number
  readonly camera?: MediaCamera
  /** `transparent`, or linear RGB 0..1; absent, the renderer's black. */
  readonly background?: 'transparent' | readonly [number, number, number]
  readonly animations?: readonly MediaAnimationChoice[]
  /**
   * Overlays the game does not draw stay off unless named here (`regions`, `navigation`,
   * `gateways`).
   */
  readonly overlays?: readonly ('regions' | 'navigation' | 'gateways')[]
  readonly quality?: number
}

/** Where every cell of a sprite sheet lies, so a game writer can cut it again. */
export interface MediaSpriteSheetLayout {
  readonly columns: number
  readonly rows: number
  readonly cellWidth: number
  readonly cellHeight: number
  /** Directions are rows (clockwise from `startAzimuth` seen from above), frames are columns. */
  readonly cells: readonly Readonly<{
    direction: number
    frame: number
    azimuth: number
    timeMs: number
    x: number
    y: number
  }>[]
}

export interface MediaExportReceipt {
  readonly format: string
  readonly mediaType: string
  readonly extension: string
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly fps: number
  readonly startMs: number
  readonly durationMs: number
  readonly camera: MediaCamera['kind']
  readonly directions?: number
  readonly alpha: boolean
  readonly audio: false
  readonly timing?: MediaFormatOffer['timing']
  /** Objects drawn with a clip, and the choices that matched no object. */
  readonly animatedObjects: number
  readonly unmatchedAnimations: readonly string[]
  readonly models: Readonly<{ total: number; converted: number }>
  readonly sheet?: MediaSpriteSheetLayout
  /** False when layers were cut, models failed or sampled frames were partial. */
  readonly complete: boolean
}

/** One clip of a model, as a media request can name it. */
export interface MediaClipSummary {
  readonly name: string
  readonly durationSeconds?: number
  readonly loop?: boolean
  /** Clip events whose name or payload says they play a sound (`SND…` in Warcraft III). */
  readonly soundEvents: number
  readonly events: number
}

/**
 * What of a world moves, before rendering it: a map is not still when its doodads idle, its water
 * scrolls or a cutscene samples it over time. `media-info` answers with this.
 */
export interface MediaTimelineReport {
  readonly schemaVersion: 1
  /** Some object plays a clip, water scrolls, or the source samples time. */
  readonly animated: boolean
  /** The source samples moments itself (`frame(timeMs)`: cutscenes, replays). */
  readonly sampledTime: boolean
  /** The source carries its own camera in its frames. */
  readonly sourceCamera: boolean
  readonly objects: number
  readonly animatedObjects: number
  readonly models: readonly Readonly<{
    resourceId: string
    state: 'converted' | 'unresolved'
    objects: number
    /** The clip the world plays on these objects, when one is selected. */
    playing?: string
    clips: readonly MediaClipSummary[]
  }>[]
  readonly formats: readonly MediaFormatOffer[]
  readonly complete: boolean
}
