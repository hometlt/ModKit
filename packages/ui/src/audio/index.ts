/**
 * AudioStage — MK2 `modkit.audioPreview` parity over the audio-media contract.
 *
 * The codec supplies track facts and a bounded encoded representation. The browser fallback uses
 * its platform decoder; a separately selected provider may expose PCM without coupling this viewer
 * to MP3, Vorbis, Opus, or any native library.
 */
import type { AudioMediaSource, ViewerModule } from '@modkitx-x3/sdk'
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
import { collectEncodedMedia } from '../media/encoded.js'
import { type UiLocalizer } from '../localization/index.js'
import { AUDIO_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const AUDIO_MAXIMUM_BYTES = 96 * 1024 * 1024
export const WAVEFORM_BUCKETS = 900

export interface WaveformModel {
  /** One min/max pair per bucket, in [-1, 1]. Never the sample buffer itself. */
  readonly peaks: Float32Array
  readonly duration: number
  readonly channels: number
  readonly sampleRate: number
  readonly bytes: number
}

/** Reduce decoded samples to bucket extremes; the buffer is released immediately after. */
export function computePeaks(channelData: readonly Float32Array[], buckets: number): Float32Array {
  const frames = channelData[0]?.length ?? 0
  const peaks = new Float32Array(buckets * 2)
  if (frames === 0) return peaks
  const step = Math.max(1, Math.floor(frames / buckets))
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = bucket * step
    const to = Math.min(frames, from + step)
    let minimum = 0
    let maximum = 0
    for (const channel of channelData) {
      for (let at = from; at < to; at += 1) {
        const value = channel[at] as number
        if (value < minimum) minimum = value
        if (value > maximum) maximum = value
      }
    }
    peaks[bucket * 2] = minimum
    peaks[bucket * 2 + 1] = maximum
  }
  return peaks
}

async function loadWaveform(
  source: AudioMediaSource,
  signal?: AbortSignal,
): Promise<{
  readonly model: WaveformModel
  readonly mediaType: string
  readonly bytes: Uint8Array
}> {
  const encoded = await source.encoded(undefined, signal)
  const media = await collectEncodedMedia(encoded, AUDIO_MAXIMUM_BYTES, signal)
  const AudioContextCtor =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (AudioContextCtor === undefined) throw new TypeError('no platform audio decoder is available')
  const context = new AudioContextCtor()
  try {
    const copy = media.bytes.slice().buffer as ArrayBuffer
    const buffer = await context.decodeAudioData(copy)
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index),
    )
    return {
      model: {
        peaks: computePeaks(channels, WAVEFORM_BUCKETS),
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
        bytes: media.bytes.byteLength,
      },
      mediaType: media.mediaType,
      bytes: media.bytes,
    }
  } finally {
    await context.close()
  }
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export interface AudioViewerOptions {
  readonly localizer?: UiLocalizer
}

export function createAudioViewer(options: AudioViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, AUDIO_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.audio'))
      const stage = element(root, 'div', { part: 'audio' })
      const toolbar = element(stage, 'div', { part: 'audio.toolbar', role: 'toolbar' })
      toolbar.setAttribute('aria-label', localizer.text('viewer.audioControls'))
      const readout = element(stage, 'output', { part: 'audio.readout' })
      const canvas = element(stage, 'canvas', { part: 'audio.waveform' }) as HTMLCanvasElement
      canvas.setAttribute('role', 'img')
      const player = element(stage, 'audio', { part: 'audio.player' }) as HTMLAudioElement
      player.controls = true

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/audio-media-source',
      )
      if (lease === undefined) throw new TypeError('audio binding is unavailable')
      scope.lease(lease)

      let model: WaveformModel | undefined
      let cursor = 0

      const context = canvas.getContext('2d')
      if (context === null) throw new TypeError('2d canvas context is unavailable')

      const paint = (): void => {
        if (model === undefined) return
        const box = stage.getBoundingClientRect()
        const width = Math.max(160, Math.round(box.width - 16))
        const height = 120
        canvas.width = width
        canvas.height = height
        const styles = getComputedStyle(root)
        const ink = styles.getPropertyValue('--mk-chart-categorical-1').trim() || '#4daafc'
        const ground = styles.getPropertyValue('--mk-color-sunken').trim() || '#181818'
        const guide = styles.getPropertyValue('--mk-color-border').trim() || '#2b2b2b'
        context.fillStyle = ground
        context.fillRect(0, 0, width, height)
        context.strokeStyle = guide
        context.beginPath()
        context.moveTo(0, height / 2)
        context.lineTo(width, height / 2)
        context.stroke()
        context.fillStyle = ink
        const buckets = model.peaks.length / 2
        for (let x = 0; x < width; x += 1) {
          const bucket = Math.min(buckets - 1, Math.floor((x / width) * buckets))
          const minimum = model.peaks[bucket * 2] as number
          const maximum = model.peaks[bucket * 2 + 1] as number
          const top = (1 - maximum) * (height / 2)
          const bottom = (1 - minimum) * (height / 2)
          context.fillRect(x, top, 1, Math.max(1, bottom - top))
        }
        if (cursor > 0 && model.duration > 0) {
          context.fillStyle = styles.getPropertyValue('--mk-color-accent').trim() || '#0078d4'
          context.fillRect(Math.round((cursor / model.duration) * width), 0, 2, height)
        }
        setViewerText(
          readout,
          localizer.text('viewer.audioSummary', {
            position: clock(cursor),
            duration: clock(model.duration),
            channels: model.channels,
            rate: (model.sampleRate / 1000).toFixed(1),
            size: (model.bytes / 1024).toFixed(0),
          }),
        )
      }

      canvas.addEventListener('click', event => {
        if (model === undefined) return
        const box = canvas.getBoundingClientRect()
        cursor = ((event.clientX - box.left) / box.width) * model.duration
        paint()
      })

      setState(stage, ['loading'])
      try {
        const loaded = await loadWaveform(lease.value as AudioMediaSource, scope.signal)
        model = loaded.model
        const objectUrl = URL.createObjectURL(
          new Blob([loaded.bytes as BlobPart], { type: loaded.mediaType }),
        )
        player.src = objectUrl
        scope.cleanup(() => URL.revokeObjectURL(objectUrl))
        setState(stage, [])
        paint()
      } catch (error) {
        setState(stage, ['error'])
        canvas.remove()
        player.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.audioDecodeError', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        })
      }

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
        paint()
      })
    },
  })
}

export const audioViewer: ViewerModule = createAudioViewer()
