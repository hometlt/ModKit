/**
 * Playback stage: one transport, the positions its world source publishes at the current position,
 * and the participants, measured series and events of its optional timeline — all following the
 * same transport snapshot. Format-neutral: a replay, a cutscene or a recorded simulation publish
 * the same two contracts.
 */
import type {
  AnyDescriptor,
  TransportSnapshot,
  TransportSource,
  TransportTimeline,
  TransportTimelineMarker,
  ViewerModule,
} from '@modkit/sdk'
import type {
  CandidateWorldSceneSource,
  WorldSceneFacetBounds,
  WorldSceneObjectItem,
} from '@modkit/sdk/maps'
import { WORLD_SCENE_SOURCE_CONTRACT } from '@modkit/sdk/maps'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  invokeOperation,
  setPart,
  setState,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import type { UiLocalizationOptions } from '../localization/index.js'
import { TRANSPORT_PLAYBACK_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const PLAYBACK_MAX_MARKERS = 2_000
export const PLAYBACK_MAX_SERIES_POINTS = 400
export const PLAYBACK_MAX_OBJECTS = 4_096
export const PLAYBACK_RATES: readonly number[] = Object.freeze([0.5, 1, 2, 4, 8, 16])
/** The ←/→ step, as MK2's player: five seconds of the recording. */
export const PLAYBACK_SEEK_STEP_MS = 5_000
const PAGE_LIMIT = 1_024
const MAP_SIZE = 480
const GRID_CELLS = 16
const CHART_WIDTH = 240
const CHART_HEIGHT = 64
const SVG_NS = 'http://www.w3.org/2000/svg'

export function formatPlaybackTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`
}

/** Index of the last marker at or before `positionMs`, or -1. Markers are ordered by position. */
export function markerIndexAt(
  markers: readonly TransportTimelineMarker[],
  positionMs: number,
): number {
  let low = 0
  let high = markers.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (markers[middle]!.positionMs <= positionMs) low = middle + 1
    else high = middle
  }
  return low - 1
}

/** A localized name for a source token, or the source's own label when the token is unknown. */
function known(text: string, key: string, label: string): string {
  return text === key ? label : text
}

export interface PlaybackWorldFrame {
  readonly snapshotId: string
  readonly bounds: { minimumX: number; maximumX: number; minimumY: number; maximumY: number }
  readonly objects: readonly WorldSceneObjectItem[]
  readonly complete: boolean
}

/**
 * One consistent read of the object layer. Identity comes from `info()`: a source that crossed an
 * execution boundary has no live `snapshotId` property to compare with.
 */
export async function readPlaybackWorld(
  source: CandidateWorldSceneSource,
  signal?: AbortSignal,
): Promise<PlaybackWorldFrame | undefined> {
  const info = await source.info(signal)
  const layer = info.facets.find(
    facet => facet.facet === 'objects' && facet.state !== 'unavailable',
  )
  if (layer === undefined) return undefined
  const extent = info.bounds.find((bound: WorldSceneFacetBounds) => bound.facet === 'objects')
  const bounds =
    extent?.x.state === 'known' && extent.y.state === 'known'
      ? {
          minimumX: extent.x.minimum,
          maximumX: extent.x.maximum,
          minimumY: extent.y.minimum,
          maximumY: extent.y.maximum,
        }
      : undefined
  const objects: WorldSceneObjectItem[] = []
  let cursor: string | undefined
  let complete = true
  do {
    const limit = Math.min(PAGE_LIMIT, PLAYBACK_MAX_OBJECTS - objects.length)
    if (limit <= 0) {
      complete = false
      break
    }
    const page = await source.page(
      {
        facet: 'objects',
        layerId: layer.layerId,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    )
    // The source moved on between info() and this page: the caller reads again on the next tick.
    if (page.snapshotId !== info.snapshotId) return undefined
    if (page.state !== 'available') complete = false
    for (const item of page.items) if (item.facet === 'objects') objects.push(item)
    if (page.nextCursor !== undefined && page.nextCursor === cursor) break
    cursor = page.nextCursor
  } while (cursor !== undefined)
  const fallback = objects.reduce(
    (range, item) => ({
      minimumX: Math.min(range.minimumX, item.position.x),
      maximumX: Math.max(range.maximumX, item.position.x),
      minimumY: Math.min(range.minimumY, item.position.y),
      maximumY: Math.max(range.maximumY, item.position.y),
    }),
    { minimumX: 0, maximumX: 1, minimumY: 0, maximumY: 1 },
  )
  return { snapshotId: info.snapshotId, bounds: bounds ?? fallback, objects, complete }
}

function drawPlaybackMap(
  canvas: HTMLCanvasElement,
  frame: PlaybackWorldFrame,
  colors: ReadonlyMap<string, string>,
): void {
  const styles = canvas.ownerDocument.defaultView?.getComputedStyle(canvas)
  const token = (name: string, fallback: string) =>
    styles?.getPropertyValue(name).trim() || fallback
  const { minimumX, maximumX, minimumY, maximumY } = frame.bounds
  // A neutral grid sized from the published bounds, padded so edge units stay visible.
  const pad = Math.max(maximumX - minimumX, maximumY - minimumY, 1) * 0.04
  const spanX = maximumX - minimumX + pad * 2 || 1
  const spanY = maximumY - minimumY + pad * 2 || 1
  const scale = MAP_SIZE / Math.max(spanX, spanY)
  canvas.width = Math.max(1, Math.round(spanX * scale))
  canvas.height = Math.max(1, Math.round(spanY * scale))
  const context = canvas.getContext('2d')
  if (context === null) return
  context.fillStyle = token('--mk-color-canvas-bg', '#1e1e1e')
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = token('--mk-color-canvas-grid', '#2b2b2b')
  context.lineWidth = 1
  context.beginPath()
  for (let index = 0; index <= GRID_CELLS; index += 1) {
    const x = Math.round((index / GRID_CELLS) * canvas.width) + 0.5
    const y = Math.round((index / GRID_CELLS) * canvas.height) + 0.5
    context.moveTo(x, 0)
    context.lineTo(x, canvas.height)
    context.moveTo(0, y)
    context.lineTo(canvas.width, y)
  }
  context.stroke()
  const neutral = token('--mk-color-fg-muted', '#8b8b8b')
  for (const item of frame.objects) {
    // World Y grows up; canvas Y grows down.
    const x = (item.position.x - minimumX + pad) * scale
    const y = canvas.height - (item.position.y - minimumY + pad) * scale
    context.fillStyle = colors.get(String(item.player ?? '')) ?? neutral
    context.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
}

function svg<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const node = parent.ownerDocument.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  parent.append(node)
  return node
}

export interface PlaybackViewerOptions extends UiLocalizationOptions {
  /** Shows the same subject in the host's 3D world view, which follows this transport. */
  readonly openWorld?: () => void
}

/**
 * What a key asks of the transport: Space toggles, ←/→ step, clamped to the recording. Keys aimed
 * at a control (the slider, the rate, a button) and chords belong to the control or the host.
 */
export function playbackKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'> & {
    readonly target: unknown
  },
  snapshot: Pick<TransportSnapshot, 'positionMs' | 'durationMs'>,
):
  { readonly kind: 'toggle' } | { readonly kind: 'seek'; readonly positionMs: number } | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey) return undefined
  const target = event.target as { closest?: (selector: string) => unknown } | null
  if (target?.closest?.('input, select, textarea, button') != null) return undefined
  if (event.key === ' ') return { kind: 'toggle' }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return undefined
  const step = event.key === 'ArrowRight' ? PLAYBACK_SEEK_STEP_MS : -PLAYBACK_SEEK_STEP_MS
  const end = typeof snapshot.durationMs === 'number' ? snapshot.durationMs : Infinity
  return { kind: 'seek', positionMs: Math.min(end, Math.max(0, snapshot.positionMs + step)) }
}

export function createPlaybackViewer(options: PlaybackViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TRANSPORT_PLAYBACK_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const [transportLease, worldLease] = await Promise.all([
        unknownSourceLease(args.sources, args.slot, 'common.view/transport-source'),
        unknownSourceLease(args.sources, args.slot, WORLD_SCENE_SOURCE_CONTRACT),
      ])
      if (transportLease === undefined) {
        await worldLease?.release()
        throw new TypeError('transport binding is unavailable')
      }
      scope.lease(transportLease)
      if (worldLease !== undefined) scope.lease(worldLease)
      const transport = transportLease.value as TransportSource
      const world = worldLease?.value as CandidateWorldSceneSource | undefined
      let descriptor: AnyDescriptor = args.descriptor

      const root = createSurface(args.container, localizer.text('viewer.playback'))
      const stage = element(root, 'div', { part: 'playback' })
      const bar = element(stage, 'div', { part: 'playback.bar' })
      const play = element(bar, 'button', { part: 'transport.button' }) as HTMLButtonElement
      play.type = 'button'
      const time = element(bar, 'output', { part: 'playback.time' })
      const seek = element(bar, 'input', { part: 'playback.seek' }) as HTMLInputElement
      seek.type = 'range'
      seek.min = '0'
      seek.step = 'any'
      seek.setAttribute('aria-label', localizer.text('viewer.playbackSeek'))
      const rate = element(bar, 'select', { part: 'playback.rate' }) as HTMLSelectElement
      rate.setAttribute('aria-label', localizer.text('viewer.playbackRate'))
      for (const value of PLAYBACK_RATES) {
        const option = element(rate, 'option', { text: `${value}×` }) as HTMLOptionElement
        option.value = String(value)
      }
      // How many objects the map shows at this moment, as MK2's player counted its units.
      const units = element(bar, 'output', { part: 'playback.units' })
      units.hidden = world === undefined
      const openWorld = options.openWorld
      if (openWorld !== undefined && world !== undefined) {
        const show3d = element(bar, 'button', {
          part: 'transport.button',
          text: localizer.text('viewer.playbackWorld'),
        }) as HTMLButtonElement
        show3d.type = 'button'
        show3d.title = localizer.text('viewer.playbackWorldTitle')
        show3d.addEventListener('click', () => openWorld())
      }
      const status = element(stage, 'output', { part: 'transport.status' })

      const body = element(stage, 'div', { part: 'playback.body' })
      const mapSection = element(body, 'section', { part: 'playback.map' })
      const canvas = element(mapSection, 'canvas') as HTMLCanvasElement
      canvas.width = MAP_SIZE
      canvas.height = MAP_SIZE
      canvas.setAttribute('role', 'img')
      const note = element(mapSection, 'p', {
        part: 'playback.note',
        text: localizer.text(
          world === undefined ? 'viewer.playbackNoWorld' : 'viewer.playbackNoTimeline',
        ),
      })
      canvas.hidden = world === undefined
      const side = element(body, 'div', { part: 'playback.side' })
      const participantList = element(side, 'ul', { part: 'playback.participants' })
      participantList.setAttribute('aria-label', localizer.text('viewer.playbackParticipants'))
      const charts = element(side, 'section', { part: 'playback.charts' })
      charts.setAttribute('aria-label', localizer.text('viewer.playbackCharts'))
      // Which kinds of events the list shows: production alone reads as a build order.
      const kinds = element(side, 'div', { part: 'playback.kinds' })
      kinds.setAttribute('role', 'group')
      kinds.setAttribute('aria-label', localizer.text('viewer.playbackKinds'))
      const hiddenKinds = new Set<string>()
      const eventList = element(side, 'ol', { part: 'playback.events' })
      eventList.setAttribute('aria-label', localizer.text('viewer.playbackEvents'))

      let snapshot: TransportSnapshot = await transport.snapshot(scope.signal)
      let timeline: TransportTimeline | undefined
      const colors = new Map<string, string>()
      const playheads: SVGLineElement[] = []
      let eventItems: HTMLElement[] = []
      let activeEvent = -1
      let seeking = false

      const duration = () => (typeof snapshot.durationMs === 'number' ? snapshot.durationMs : 0)
      const invoke = async (
        operation: string | undefined,
        input: Record<string, number> | null,
      ) => {
        if (operation === undefined) return
        const result = await invokeOperation(descriptor, args.operations, operation, input, {
          signal: scope.signal,
        })
        setViewerText(status, result.state === 'ok' ? '' : result.reason)
      }

      const renderTransport = () => {
        const playing = snapshot.state === 'playing'
        setViewerText(play, localizer.text(playing ? 'viewer.pause' : 'viewer.play'))
        play.setAttribute('aria-pressed', String(playing))
        play.disabled = snapshot.controls.playPause === undefined
        seek.disabled = !snapshot.seekable || snapshot.controls.seek === undefined
        rate.disabled = snapshot.controls.setRate === undefined
        seek.max = String(duration())
        if (!seeking) seek.value = String(snapshot.positionMs)
        if (!PLAYBACK_RATES.includes(snapshot.rate)) {
          const option = element(rate, 'option', { text: `${snapshot.rate}×` }) as HTMLOptionElement
          option.value = String(snapshot.rate)
        }
        rate.value = String(snapshot.rate)
        setViewerText(
          time,
          localizer.text('viewer.playbackTime', {
            position: formatPlaybackTime(snapshot.positionMs),
            duration: formatPlaybackTime(duration()),
          }),
        )
        const fraction = duration() > 0 ? Math.min(1, snapshot.positionMs / duration()) : 0
        for (const line of playheads) {
          const x = String(fraction * CHART_WIDTH)
          line.setAttribute('x1', x)
          line.setAttribute('x2', x)
        }
        const index =
          timeline === undefined ? -1 : markerIndexAt(timeline.markers, snapshot.positionMs)
        if (index !== activeEvent) {
          const previous = eventItems[activeEvent]
          if (previous !== undefined) {
            setState(previous, [])
            previous.removeAttribute('aria-current')
          }
          activeEvent = index
          const item = eventItems[index]
          if (item !== undefined) {
            setState(item, ['active'])
            item.setAttribute('aria-current', 'true')
            item.scrollIntoView?.({ block: 'nearest' })
          }
        }
      }

      const renderTimeline = (value: TransportTimeline) => {
        timeline = value
        colors.clear()
        participantList.replaceChildren()
        for (const participant of value.participants) {
          if (participant.color !== undefined) colors.set(participant.id, participant.color)
          const item = element(participantList, 'li', { part: 'playback.participant' })
          const swatch = element(item, 'span', { part: 'playback.swatch' })
          swatch.setAttribute('aria-hidden', 'true')
          if (participant.color !== undefined) swatch.style.backgroundColor = participant.color
          const facts = [
            participant.group,
            participant.outcome === undefined
              ? undefined
              : localizer.text(`viewer.playbackOutcome.${participant.outcome}`),
            ...participant.facts.map(
              fact =>
                `${known(localizer.text(`viewer.playbackFact.${fact.id}`), `viewer.playbackFact.${fact.id}`, fact.label)} ${fact.value}`,
            ),
          ].filter((part): part is string => part !== undefined && part !== '')
          element(item, 'strong', { text: participant.label })
          element(item, 'span', { text: facts.join(' · ') })
        }

        charts.replaceChildren()
        playheads.length = 0
        const metrics = [...new Set(value.series.map(series => series.metric))]
        for (const metric of metrics) {
          const group = value.series.filter(series => series.metric === metric)
          const figure = element(charts, 'figure', { part: 'playback.chart' })
          const label = known(
            localizer.text(`viewer.playbackMetric.${metric}`),
            `viewer.playbackMetric.${metric}`,
            group[0]!.label,
          )
          element(figure, 'figcaption', { text: label })
          const chart = svg(figure, 'svg', {
            viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
            role: 'img',
            'aria-label': label,
            preserveAspectRatio: 'none',
          })
          const maximum = Math.max(
            1,
            ...group.flatMap(series => series.points.filter((_, index) => index % 2 === 1)),
          )
          const end = Math.max(1, duration())
          for (const series of group) {
            const points: string[] = []
            for (let index = 0; index + 1 < series.points.length; index += 2) {
              const x = (series.points[index]! / end) * CHART_WIDTH
              const y =
                CHART_HEIGHT - (series.points[index + 1]! / maximum) * (CHART_HEIGHT - 2) - 1
              points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
            }
            svg(chart, 'polyline', {
              points: points.join(' '),
              fill: 'none',
              stroke: colors.get(series.participantId ?? '') ?? 'currentColor',
              'stroke-width': '1.5',
              'vector-effect': 'non-scaling-stroke',
            })
          }
          const playhead = svg(chart, 'line', {
            y1: '0',
            y2: String(CHART_HEIGHT),
            x1: '0',
            x2: '0',
          })
          setPart(playhead, 'playback.playhead')
          playheads.push(playhead)
        }

        eventList.replaceChildren()
        activeEvent = -1
        const kindLabel = (kind: string) =>
          known(
            localizer.text(`viewer.playbackEvent.${kind}`),
            `viewer.playbackEvent.${kind}`,
            kind,
          )
        eventItems = value.markers.map(marker => {
          const item = element(eventList, 'li', { part: 'playback.event' })
          item.hidden = hiddenKinds.has(marker.kind)
          const button = element(item, 'button', {
            text: `${formatPlaybackTime(marker.positionMs)} ${kindLabel(marker.kind)} ${marker.label}`,
          }) as HTMLButtonElement
          button.type = 'button'
          const swatch = colors.get(marker.participantId ?? '')
          if (swatch !== undefined) item.style.borderInlineStartColor = swatch
          button.addEventListener('click', () => {
            void invoke(snapshot.controls.seek, { positionMs: marker.positionMs })
          })
          return item
        })
        kinds.replaceChildren()
        const present = [...new Set(value.markers.map(marker => marker.kind))]
        for (const kind of present) {
          const label = element(kinds, 'label', { part: 'playback.kind' })
          const box = element(label, 'input') as HTMLInputElement
          box.type = 'checkbox'
          box.checked = !hiddenKinds.has(kind)
          label.append(kindLabel(kind))
          box.addEventListener('change', () => {
            if (box.checked) hiddenKinds.delete(kind)
            else hiddenKinds.add(kind)
            value.markers.forEach((marker, index) => {
              const item = eventItems[index]
              if (item !== undefined) item.hidden = hiddenKinds.has(marker.kind)
            })
          })
        }
        kinds.hidden = present.length < 2
        const notes = [
          world === undefined ? localizer.text('viewer.playbackNoWorld') : '',
          value.fidelity === 'sampled' ? localizer.text('viewer.playbackSampled') : '',
          value.complete ? '' : localizer.text('viewer.playbackTruncated'),
        ].filter(text => text !== '')
        setViewerText(note, notes.join(' '))
      }

      // Redraws never overlap: a tick that lands mid-read is folded into one follow-up read.
      let drawing = false
      let dirty = false
      const redrawMap = async () => {
        if (world === undefined) return
        if (drawing) {
          dirty = true
          return
        }
        drawing = true
        try {
          do {
            dirty = false
            const frame = await readPlaybackWorld(world, scope.signal)
            if (frame === undefined || scope.signal.aborted) continue
            drawPlaybackMap(canvas, frame, colors)
            setViewerText(
              units,
              localizer.text('viewer.playbackUnits', { count: frame.objects.length }),
            )
            canvas.setAttribute(
              'aria-label',
              localizer.text('viewer.playbackMap', {
                time: formatPlaybackTime(snapshot.positionMs),
                count: frame.objects.length,
              }),
            )
            setState(mapSection, frame.complete ? [] : ['truncated'])
          } while (dirty && !scope.signal.aborted)
        } catch (error) {
          if (scope.signal.aborted) return
          setState(mapSection, ['error'])
          setViewerText(status, error instanceof Error ? error.message : String(error))
        } finally {
          drawing = false
        }
      }

      const onPlay = () => void invoke(snapshot.controls.playPause, null)
      const onSeekInput = () => {
        seeking = true
      }
      const onSeekChange = () => {
        seeking = false
        void invoke(snapshot.controls.seek, { positionMs: Number(seek.value) })
      }
      const onRate = () => void invoke(snapshot.controls.setRate, { rate: Number(rate.value) })
      const onKey = (event: KeyboardEvent) => {
        const action = playbackKeyAction(event, snapshot)
        if (action === undefined) return
        event.preventDefault()
        if (action.kind === 'toggle') onPlay()
        else void invoke(snapshot.controls.seek, { positionMs: action.positionMs })
      }
      // Focus anywhere in the stage (a click on the map) takes the keys; a page holds many stages.
      stage.tabIndex = 0
      play.addEventListener('click', onPlay)
      seek.addEventListener('input', onSeekInput)
      seek.addEventListener('change', onSeekChange)
      rate.addEventListener('change', onRate)
      stage.addEventListener('keydown', onKey)
      scope.cleanup(() => {
        play.removeEventListener('click', onPlay)
        seek.removeEventListener('input', onSeekInput)
        seek.removeEventListener('change', onSeekChange)
        rate.removeEventListener('change', onRate)
        stage.removeEventListener('keydown', onKey)
      })

      if (typeof transport.timeline === 'function') {
        setState(side, ['loading'])
        try {
          renderTimeline(
            await transport.timeline(
              { maxMarkers: PLAYBACK_MAX_MARKERS, maxSeriesPoints: PLAYBACK_MAX_SERIES_POINTS },
              scope.signal,
            ),
          )
          setState(side, [])
        } catch (error) {
          if (scope.signal.aborted) throw error
          setState(side, ['error'])
          setViewerText(status, error instanceof Error ? error.message : String(error))
        }
      } else {
        setState(side, ['empty'])
      }
      renderTransport()
      await redrawMap()

      void (async () => {
        try {
          for await (const event of transport.events(scope.signal)) {
            if (event.kind === 'diagnostic') {
              setViewerText(status, event.diagnostic.message)
              continue
            }
            const moved = event.snapshot.positionMs !== snapshot.positionMs
            snapshot = event.snapshot
            renderTransport()
            if (moved) void redrawMap()
          }
        } catch (error) {
          if (!scope.signal.aborted)
            setViewerText(status, error instanceof Error ? error.message : String(error))
        }
      })()

      return createViewerMount(root, scope, args, update => {
        descriptor = update.descriptor
        root.dataset['revision'] = descriptor.revision
        renderTransport()
      })
    },
  })
}

export const playbackViewer: ViewerModule = createPlaybackViewer()

export default playbackViewer
