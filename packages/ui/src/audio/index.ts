/**
 * AudioStage — MK2 `modkit.audioPreview` parity over the audio-media contract.
 *
 * The codec supplies track facts and a bounded encoded representation. The browser fallback uses
 * its platform decoder; a separately selected provider may expose PCM without coupling this viewer
 * to MP3, Vorbis, Opus, or any native library.
 */
import type { AnyDescriptor, AudioMediaSource, MetadataGroup, ViewerModule } from '@modkit/sdk'
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
import { collectEncodedMedia } from '../media/encoded.js'
import { type UiLocalizer } from '../localization/index.js'
import { AUDIO_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const AUDIO_MAXIMUM_BYTES = 96 * 1024 * 1024
export const WAVEFORM_BUCKETS = 900

/** Ceiling on codec-decoded PCM held in memory: ten minutes of 48 kHz stereo. */
export const AUDIO_MAXIMUM_PCM_FRAMES = 10 * 60 * 48_000
/** One codec PCM request; a long file arrives as several of these rather than one huge one. */
/*
 * One codec PCM request.
 *
 * Large again now that a window is ONE interleaved buffer rather than one buffer per channel: the
 * cost of a window is a single payload, so fewer, larger windows beat many small ones. 262 144
 * frames is about six seconds of 44 100 Hz audio, so a game's UI sound crosses in one request.
 */
export const AUDIO_PCM_WINDOW_FRAMES = 1 << 18

/** Playback rates the transport cycles through, matching the MK2 audio preview. */
export const AUDIO_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2])

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

function audioContextConstructor(): typeof AudioContext | undefined {
  return (
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  )
}

/**
 * Pull the whole track from the codec's own PCM method, one bounded window at a time.
 *
 * This is the path StarCraft II's UI sounds need: they are IMA ADPCM inside RIFF, which no browser
 * decodes, so "let the platform play it" was silence with a waveform of zeros. The codec decodes;
 * this assembles.
 */
export async function collectCodecPcm(
  source: AudioMediaSource,
  trackId: string,
  signal?: AbortSignal,
  onFrames: (frames: number) => void = () => undefined,
): Promise<{ readonly sampleRate: number; readonly channels: readonly Float32Array[] }> {
  if (source.readPcm === undefined) throw new TypeError('this source exposes no PCM')
  const windows: { readonly samples: Float32Array; readonly frameCount: number }[] = []
  let sampleRate = 0
  let channelCount = 0
  let frames = 0
  /*
   * Bounded by window count as well as by frames. A source that answers every request with the
   * same window — ignoring `fromFrame` — would otherwise spin here forever, and a viewer that
   * hangs is worse than one that says what went wrong: the stage would sit in "loading" with no
   * reason to show.
   */
  const maximumWindows = Math.ceil(AUDIO_MAXIMUM_PCM_FRAMES / AUDIO_PCM_WINDOW_FRAMES) + 1
  for (let from = 0; frames < AUDIO_MAXIMUM_PCM_FRAMES;) {
    if (windows.length >= maximumWindows) {
      throw new TypeError(
        `the codec returned ${windows.length} PCM windows without reaching the end of the track`,
      )
    }
    const block = await source.readPcm(
      {
        trackId,
        fromFrame: BigInt(from),
        frameCount: Math.min(AUDIO_PCM_WINDOW_FRAMES, AUDIO_MAXIMUM_PCM_FRAMES - frames),
        maxBytes: AUDIO_MAXIMUM_BYTES,
      },
      signal,
    )
    if (block.frameCount === 0) break
    /*
     * Every window must be the window that was asked for.
     *
     * Paging trusts fromFrame to advance. A source answering every request with the start of the
     * track would look like progress — the frame total climbs — while the same seconds arrive over
     * and over, and collection would only end at the window ceiling, minutes later. That is a wrong
     * answer, so it is refused by name rather than assembled into a track that is not the file.
     */
    if (block.fromFrame !== BigInt(from)) {
      throw new TypeError(
        `the codec answered from frame ${String(block.fromFrame)} when frame ${from} was requested`,
      )
    }
    if (!Number.isSafeInteger(block.frameCount) || block.frameCount < 0) {
      throw new TypeError(`the codec reported ${String(block.frameCount)} PCM frames`)
    }
    if (!Number.isSafeInteger(block.channelCount) || block.channelCount <= 0) {
      throw new TypeError(`the codec reported ${String(block.channelCount)} channels`)
    }
    if (block.samples.length !== block.frameCount * block.channelCount) {
      throw new TypeError(
        `the codec sent ${block.samples.length} samples for ${block.frameCount} frames of ` +
          `${block.channelCount} channels`,
      )
    }
    sampleRate = block.sampleRate
    channelCount = block.channelCount
    windows.push({ samples: block.samples, frameCount: block.frameCount })
    frames += block.frameCount
    from += block.frameCount
    onFrames(frames)
  }
  if (frames === 0 || sampleRate <= 0) throw new TypeError('the codec decoded no PCM frames')
  // De-interleave once, at the end: the wire carried one buffer per window, this splits the track.
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
  let offset = 0
  for (const window of windows) {
    for (let frame = 0; frame < window.frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const target = channels[channel]
        if (target !== undefined) {
          target[offset + frame] = window.samples[frame * channelCount + channel] as number
        }
      }
    }
    offset += window.frameCount
  }
  return { sampleRate, channels }
}

async function loadWaveform(
  source: AudioMediaSource,
  signal?: AbortSignal,
  onPhase: (phase: string) => void = () => undefined,
): Promise<{
  readonly model: WaveformModel
  readonly encoded?: { readonly mediaType: string; readonly bytes: Uint8Array }
  readonly buffer: AudioBuffer
  readonly context: AudioContext
  readonly decodedBy: 'codec-pcm' | 'platform-decoder'
}> {
  /*
   * Ask what this is BEFORE fetching anything.
   *
   * The old order took the `encoded` lease first and then called `info`, which left the installed
   * audio stage stuck in "loading" forever with the phase readout pointing straight at `info`.
   * Asking first is also the honest shape: when the codec decodes the samples itself, the encoded
   * bytes are never needed, and materialising up to 96 MiB to throw away was always waste.
   */
  onPhase('info')
  const info = await source.info(signal)
  const AudioContextCtor = audioContextConstructor()
  if (AudioContextCtor === undefined) throw new TypeError('no platform audio decoder is available')
  const context = new AudioContextCtor()
  let disposed = false
  try {
    /*
     * Prefer the codec. `pcmAccess` means the codec claims it can decode these samples itself, and
     * the platform decoder is the fallback for the formats it cannot — not the other way round.
     */
    const track = info.tracks.find(item => item.selected) ?? info.tracks[0]
    let buffer: AudioBuffer
    let decodedBy: 'codec-pcm' | 'platform-decoder'
    let encodedMedia: { readonly mediaType: string; readonly bytes: Uint8Array } | undefined
    let sizeBytes: number
    if (info.pcmAccess && source.readPcm !== undefined && track !== undefined) {
      onPhase('codec-pcm')
      const pcm = await collectCodecPcm(source, track.id, signal, frames =>
        onPhase(`codec-pcm:${frames}`),
      )
      const frames = pcm.channels[0]?.length ?? 0
      buffer = context.createBuffer(Math.max(1, pcm.channels.length), frames, pcm.sampleRate)
      for (const [index, channel] of pcm.channels.entries()) {
        // `copyToChannel` is typed for a plain ArrayBuffer; the codec’s arrays are ArrayBufferLike.
        buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index)
      }
      // Decoded size: the encoded file is never fetched on this path, so it cannot be reported.
      sizeBytes = frames * Math.max(1, pcm.channels.length) * 4
      decodedBy = 'codec-pcm'
    } else {
      onPhase('encoded')
      const lease = await source.encoded(undefined, signal)
      const media = await collectEncodedMedia(lease, AUDIO_MAXIMUM_BYTES, signal)
      encodedMedia = { mediaType: media.mediaType, bytes: media.bytes }
      sizeBytes = media.bytes.byteLength
      onPhase('platform-decode')
      buffer = await context.decodeAudioData(media.bytes.slice().buffer as ArrayBuffer)
      decodedBy = 'platform-decoder'
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index),
    )
    onPhase('ready')
    disposed = true
    return {
      model: {
        peaks: computePeaks(channels, WAVEFORM_BUCKETS),
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
        bytes: sizeBytes,
      },
      ...(encodedMedia === undefined ? {} : { encoded: encodedMedia }),
      buffer,
      context,
      decodedBy,
    }
  } finally {
    // The context is handed to the caller on success; only a failure closes it here.
    if (!disposed) await context.close()
  }
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export interface AudioViewerOptions {
  readonly localizer?: UiLocalizer
}

/** `AnyDescriptor` also covers the unresolved arm, which carries no metadata. */
function metadataGroups(descriptor: AnyDescriptor): readonly MetadataGroup[] {
  return 'identity' in descriptor
    ? ((descriptor as { readonly metadata?: readonly MetadataGroup[] }).metadata ?? [])
    : []
}

function facts(parent: HTMLElement, rows: readonly (readonly [string, string])[]): void {
  const list = element(parent, 'dl', { part: 'image.metadata' })
  for (const [label, value] of rows) {
    const row = element(list, 'div', { part: 'metadata.row' })
    element(row, 'dt', { text: label, part: 'metadata.label' })
    setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 512)
  }
}

export function createAudioViewer(options: AudioViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, AUDIO_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.audio'))
      /*
       * The shared media shell, as in the image and video views: the siblings on the left, the
       * waveform and transport as the render area, the facts as sidebar sections.
       */
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'audio' })
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
      /*
       * Transport state. A viewer that only mounted `<audio controls>` could not play what the
       * platform cannot decode, and could not report what it was doing — so play/pause/rate are
       * explicit here and drive whichever engine actually holds the samples.
       */
      let audio: AudioContext | undefined
      let buffer: AudioBuffer | undefined
      let voice: AudioBufferSourceNode | undefined
      let rate = 1
      let playing = false
      let startedAt = 0
      let decodedBy: 'codec-pcm' | 'platform-decoder' | 'none' = 'none'

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
          `${localizer.text('viewer.audioSummary', {
            position: clock(cursor),
            duration: clock(model.duration),
            channels: model.channels,
            rate: (model.sampleRate / 1000).toFixed(1),
            size: (model.bytes / 1024).toFixed(0),
          })} · ${localizer.text('viewer.audioTransport', {
            state: localizer.text(playing ? 'viewer.audioPlaying' : 'viewer.audioPaused'),
            speed: rate.toFixed(2),
            decoder: decodedBy,
          })}`,
        )
        stage.dataset['transport'] = playing ? 'playing' : 'paused'
        stage.dataset['audioContext'] = audio?.state ?? 'none'
        stage.dataset['rate'] = rate.toFixed(2)
        stage.dataset['decoder'] = decodedBy
        stage.dataset['position'] = position().toFixed(3)
      }

      const position = (): number => {
        if (model === undefined) return 0
        if (!playing || audio === undefined) return cursor
        return Math.min(model.duration, cursor + (audio.currentTime - startedAt) * rate)
      }

      const stopVoice = (): void => {
        if (voice === undefined) return
        voice.onended = null
        try {
          voice.stop()
        } catch {
          // Already stopped; nothing to unwind.
        }
        voice.disconnect()
        voice = undefined
      }

      const pause = (): void => {
        if (!playing) return
        cursor = position()
        playing = false
        stopVoice()
        player.pause()
      }

      const play = (): void => {
        if (playing || model === undefined) return
        if (audio !== undefined && buffer !== undefined) {
          /*
           * Resume before starting, and say so when the platform refuses.
           *
           * A browser keeps an AudioContext suspended until a real user gesture. Starting a source
           * on a suspended context looks like playback - `playing` is true - while the clock never
           * moves and nothing is heard. Reporting the context state makes that visible instead of
           * leaving a silent player that claims to be playing.
           */
          void audio.resume().catch(() => undefined)
          const next = audio.createBufferSource()
          next.buffer = buffer
          next.playbackRate.value = rate
          next.connect(audio.destination)
          next.onended = () => {
            if (voice !== next) return
            playing = false
            cursor = 0
            voice = undefined
            paint()
          }
          startedAt = audio.currentTime
          next.start(0, Math.min(cursor, Math.max(0, buffer.duration - 0.001)))
          voice = next
        } else {
          player.playbackRate = rate
          player.currentTime = cursor
          void player.play().catch(() => undefined)
        }
        playing = true
      }

      const transportButton = (label: string, title: string, onClick: () => void): void => {
        const node = element(toolbar, 'button', {
          text: label,
          part: 'operations.button',
        }) as HTMLButtonElement
        node.type = 'button'
        node.title = title
        node.addEventListener('click', () => {
          onClick()
          paint()
        })
        scope.cleanup(() => node.replaceWith(node.cloneNode(true)))
      }

      transportButton('▶', localizer.text('viewer.audioPlay'), () => play())
      transportButton('⏸', localizer.text('viewer.audioPause'), () => pause())
      transportButton('⏮', localizer.text('viewer.audioRestart'), () => {
        pause()
        cursor = 0
      })
      transportButton('×', localizer.text('viewer.audioCycleRate'), () => {
        const index = AUDIO_RATES.indexOf(rate)
        rate = AUDIO_RATES[(index + 1) % AUDIO_RATES.length] ?? 1
        if (playing) {
          pause()
          play()
        } else if (voice === undefined) {
          player.playbackRate = rate
        }
      })

      canvas.addEventListener('click', event => {
        if (model === undefined) return
        const box = canvas.getBoundingClientRect()
        const wasPlaying = playing
        pause()
        cursor = ((event.clientX - box.left) / box.width) * model.duration
        if (wasPlaying) play()
        paint()
      })

      // The buffer engine has no `timeupdate` event, so the readout and the cursor are ticked here.
      const tick = setInterval(() => {
        if (playing) paint()
      }, 200)
      scope.cleanup(() => {
        clearInterval(tick)
        stopVoice()
        void audio?.close().catch(() => undefined)
      })

      setState(stage, ['loading'])
      stage.dataset['phase'] = 'loading'
      try {
        const loaded = await loadWaveform(lease.value as AudioMediaSource, scope.signal, phase => {
          stage.dataset['phase'] = phase
        })
        model = loaded.model
        audio = loaded.context
        buffer = loaded.buffer
        decodedBy = loaded.decodedBy
        /*
         * The native element stays for the formats the platform can play, so a person still gets
         * the editor's own controls. It is not the engine when the codec decoded the samples: a
         * player handed IMA ADPCM would show a control strip that plays nothing.
         */
        if (loaded.decodedBy === 'platform-decoder' && loaded.encoded !== undefined) {
          const objectUrl = URL.createObjectURL(
            new Blob([loaded.encoded.bytes as BlobPart], { type: loaded.encoded.mediaType }),
          )
          player.src = objectUrl
          scope.cleanup(() => URL.revokeObjectURL(objectUrl))
        } else {
          player.remove()
        }
        setState(stage, [])
        // The facts, once: they belong in the sidebar, not in a readout repainted every frame.
        const loadedModel = loaded.model
        facts(shell.section('audio', localizer.text('viewer.audio'), { icon: 'unmute' }).body, [
          [localizer.text('viewer.duration'), clock(loadedModel.duration)],
          [localizer.text('viewer.audioChannels'), String(loadedModel.channels)],
          [
            localizer.text('viewer.audioSampleRate'),
            `${(loadedModel.sampleRate / 1000).toFixed(1)} kHz`,
          ],
          [localizer.text('viewer.audioSize'), `${(loadedModel.bytes / 1024).toFixed(0)} KiB`],
          [localizer.text('viewer.audioDecoder'), loaded.decodedBy],
        ])
        for (const group of metadataGroups(args.descriptor)) {
          if (/^(identity|traits|detection)$/iu.test(group.id)) continue
          facts(
            shell.section(`metadata:${group.id}`, group.label, {
              icon: 'symbol-misc',
              collapsed: true,
            }).body,
            group.entries.map(entry => [entry.key, String(entry.value)] as const),
          )
        }
        args.status?.set([
          { id: 'duration', icon: 'watch', text: clock(loadedModel.duration), align: 'start' },
          {
            id: 'format',
            icon: 'unmute',
            text: `${loadedModel.channels} ch · ${(loadedModel.sampleRate / 1000).toFixed(1)} kHz`,
            align: 'start',
          },
        ])
        scope.cleanup(() => args.status?.clear())
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
