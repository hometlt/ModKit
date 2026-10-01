/**
 * AudioStage — MK2 `modkit.audioPreview` parity over the audio-media contract.
 *
 * The codec supplies track facts and a bounded encoded representation. The browser fallback uses
 * its platform decoder; a separately selected provider may expose PCM without coupling this viewer
 * to MP3, Vorbis, Opus, or any native library.
 */
import type {
  AnyDescriptor,
  AudioMediaInfo,
  AudioMediaSource,
  AudioTrackInfo,
  MetadataGroup,
  ViewerModule,
} from '@modkit/sdk'
import {
  createMediaShell,
  mountContributedSections,
  type MediaShellContribution,
  mediaFacts,
} from '../media-shell/index.js'
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
): Promise<{
  readonly sampleRate: number
  readonly channels: readonly Float32Array[]
  /** Collection stopped at `AUDIO_MAXIMUM_PCM_FRAMES`: the track may go on past what is held. */
  readonly truncated: boolean
}> {
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
  return { sampleRate, channels, truncated: frames >= AUDIO_MAXIMUM_PCM_FRAMES }
}

/** One track, decoded into the viewer's AudioContext. */
interface LoadedTrack {
  readonly model: WaveformModel
  readonly buffer: AudioBuffer
  readonly decodedBy: 'codec-pcm' | 'platform-decoder'
  /** What the platform decoded, when it did: the codec PCM path never fetches encoded bytes. */
  readonly mediaType?: string
  /** The codec had more frames than the viewer keeps; only the start of the track is loaded. */
  readonly truncated: boolean
}

async function loadTrack(
  source: AudioMediaSource,
  info: AudioMediaInfo,
  track: AudioTrackInfo | undefined,
  context: AudioContext,
  signal: AbortSignal,
  onPhase: (phase: string) => void,
): Promise<LoadedTrack> {
  let buffer: AudioBuffer
  let decodedBy: 'codec-pcm' | 'platform-decoder'
  let mediaType: string | undefined
  let sizeBytes: number
  let truncated = false
  /*
   * Prefer the codec. `pcmAccess` means the codec claims it can decode these samples itself, and
   * the platform decoder is the fallback for the formats it cannot — not the other way round.
   */
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
    truncated = pcm.truncated
  } else {
    onPhase('encoded')
    const lease = await source.encoded(track?.id, signal)
    const media = await collectEncodedMedia(lease, AUDIO_MAXIMUM_BYTES, signal)
    mediaType = media.mediaType
    sizeBytes = media.bytes.byteLength
    onPhase('platform-decode')
    buffer = await context.decodeAudioData(media.bytes.slice().buffer as ArrayBuffer)
    decodedBy = 'platform-decoder'
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  )
  onPhase('ready')
  return {
    model: {
      peaks: computePeaks(channels, WAVEFORM_BUCKETS),
      duration: buffer.duration,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      bytes: sizeBytes,
    },
    buffer,
    decodedBy,
    ...(mediaType === undefined ? {} : { mediaType }),
    truncated,
  }
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/** One line per track of a bank or a container: its number, codec, layout, bitrate and language. */
export function audioTrackLine(track: AudioTrackInfo, index: number): string {
  return [
    `#${index + 1}`,
    track.codec,
    track.channels === 'unknown' ? undefined : `${track.channels} ch`,
    track.sampleRate === 'unknown' ? undefined : `${(track.sampleRate / 1000).toFixed(1)} kHz`,
    track.bitrateKbps === undefined ? undefined : `${track.bitrateKbps} kbps`,
    track.language,
  ]
    .filter(item => item !== undefined)
    .join(' · ')
}

export interface AudioViewerOptions {
  readonly localizer?: UiLocalizer
  /**
   * Extra sidebar sections after the facts, e.g. the codec's conversions. They are mounted even
   * when this view cannot play the stream: a codec may convert what the player cannot decode.
   */
  readonly sections?: readonly MediaShellContribution[]
}

/** `AnyDescriptor` also covers the unresolved arm, which carries no metadata. */
function metadataGroups(descriptor: AnyDescriptor): readonly MetadataGroup[] {
  return 'identity' in descriptor
    ? ((descriptor as { readonly metadata?: readonly MetadataGroup[] }).metadata ?? [])
    : []
}

/** The container as its codec names it, with the media type the stream was read as. */
function containerOf(descriptor: AnyDescriptor, mediaType: string | undefined): string | undefined {
  const identity = 'identity' in descriptor ? descriptor.identity : undefined
  const type = mediaType ?? identity?.mediaType
  if (identity === undefined) return type
  return type === undefined ? identity.formatLabel : `${identity.formatLabel} (${type})`
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
      // Said once when a track is longer than the player keeps, instead of cutting it silently.
      const notice = element(stage, 'p', { part: 'audio.notice' })
      notice.hidden = true
      const failure = element(stage, 'p', { part: 'viewer.empty' })
      failure.hidden = true
      const canvas = element(stage, 'canvas', { part: 'audio.waveform' }) as HTMLCanvasElement
      canvas.setAttribute('role', 'img')

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/audio-media-source',
      )
      if (lease === undefined) throw new TypeError('audio binding is unavailable')
      scope.lease(lease)
      const source = lease.value as AudioMediaSource

      let model: WaveformModel | undefined
      let cursor = 0
      /*
       * Transport state, for ONE engine. Every track — decoded by the codec or by the platform —
       * plays from an AudioBuffer through one AudioContext and one gain, so the buttons, the
       * volume and the clock describe what is heard. A native `<audio>` beside it was a second,
       * independent player: both could play at once, at different positions.
       */
      let audio: AudioContext | undefined
      let gain: GainNode | undefined
      let buffer: AudioBuffer | undefined
      let voice: AudioBufferSourceNode | undefined
      let rate = 1
      let volume = 1
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
        stage.dataset['duration'] = model.duration.toFixed(3)
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
      }

      const play = (): void => {
        if (playing || model === undefined) return
        if (audio === undefined || gain === undefined || buffer === undefined) return
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
        next.connect(gain)
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
        }
      })
      // The volume the native player had, now on the one engine's gain.
      const volumeInput = element(toolbar, 'input') as HTMLInputElement
      volumeInput.type = 'range'
      volumeInput.min = '0'
      volumeInput.max = '1'
      volumeInput.step = '0.05'
      volumeInput.value = String(volume)
      volumeInput.title = localizer.text('viewer.audioVolume')
      volumeInput.setAttribute('aria-label', localizer.text('viewer.audioVolume'))
      volumeInput.addEventListener(
        'input',
        () => {
          volume = Number(volumeInput.value)
          if (gain !== undefined) gain.gain.value = volume
        },
        { signal: scope.signal },
      )

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
      let loading: AbortController | undefined
      scope.cleanup(() => {
        clearInterval(tick)
        loading?.abort()
        stopVoice()
        void audio?.close().catch(() => undefined)
      })

      const fail = (error: unknown): void => {
        setState(stage, ['error'])
        canvas.hidden = true
        failure.hidden = false
        setViewerText(
          failure,
          localizer.text('viewer.audioDecodeError', {
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      }

      // The facts come first in the sidebar; each track loaded refills them.
      const factsBody = shell.section('audio', localizer.text('viewer.audio'), {
        icon: 'unmute',
      }).body
      for (const group of metadataGroups(args.descriptor)) {
        if (/^(identity|traits|detection)$/iu.test(group.id)) continue
        mediaFacts(
          shell.section(`metadata:${group.id}`, group.label, {
            icon: 'symbol-misc',
            collapsed: true,
          }).body,
          group.entries.map(entry => [entry.key, String(entry.value)] as const),
        )
      }
      scope.cleanup(() => args.status?.clear())

      /** Decode one track into the engine; a later choice cancels a load still running. */
      const show = async (info: AudioMediaInfo, track: AudioTrackInfo | undefined) => {
        loading?.abort()
        const controller = new AbortController()
        loading = controller
        pause()
        cursor = 0
        model = undefined
        buffer = undefined
        setState(stage, ['loading'])
        stage.dataset['phase'] = 'loading'
        try {
          // One context for the viewer's life, made with the first track and kept for the next.
          if (audio === undefined) {
            const AudioContextCtor = audioContextConstructor()
            if (AudioContextCtor === undefined) {
              throw new TypeError('no platform audio decoder is available')
            }
            audio = new AudioContextCtor()
            gain = audio.createGain()
            gain.gain.value = volume
            gain.connect(audio.destination)
          }
          const loaded = await loadTrack(source, info, track, audio, controller.signal, phase => {
            if (loading === controller) stage.dataset['phase'] = phase
          })
          if (loading !== controller) return
          model = loaded.model
          buffer = loaded.buffer
          decodedBy = loaded.decodedBy
          setState(stage, [])
          canvas.hidden = false
          failure.hidden = true
          notice.hidden = !loaded.truncated
          if (loaded.truncated) {
            setViewerText(
              notice,
              localizer.text('viewer.audioTruncated', { duration: clock(loaded.model.duration) }),
            )
          }
          // The facts, once per track: they belong in the sidebar, not in the repainted readout.
          const container = containerOf(args.descriptor, loaded.mediaType)
          factsBody.replaceChildren()
          mediaFacts(factsBody, [
            [localizer.text('viewer.duration'), clock(loaded.model.duration)],
            [localizer.text('viewer.audioChannels'), String(loaded.model.channels)],
            [
              localizer.text('viewer.audioSampleRate'),
              `${(loaded.model.sampleRate / 1000).toFixed(1)} kHz`,
            ],
            ...(track === undefined
              ? []
              : [[localizer.text('viewer.audioCodec'), track.codec] as const]),
            ...(track?.bitrateKbps === undefined
              ? []
              : [[localizer.text('viewer.audioBitrate'), `${track.bitrateKbps} kbps`] as const]),
            ...(container === undefined
              ? []
              : [[localizer.text('viewer.audioContainer'), container] as const]),
            [localizer.text('viewer.audioSize'), `${(loaded.model.bytes / 1024).toFixed(0)} KiB`],
            [localizer.text('viewer.audioDecoder'), loaded.decodedBy],
          ])
          args.status?.set([
            { id: 'duration', icon: 'watch', text: clock(loaded.model.duration), align: 'start' },
            {
              id: 'format',
              icon: 'unmute',
              text: `${loaded.model.channels} ch · ${(loaded.model.sampleRate / 1000).toFixed(1)} kHz`,
              align: 'start',
            },
          ])
          paint()
        } catch (error) {
          if (loading === controller) fail(error)
        }
      }

      /*
       * Ask what this is BEFORE fetching anything.
       *
       * Taking the `encoded` lease first and calling `info` after left the installed audio stage
       * stuck in "loading" forever with the phase readout pointing straight at `info`. Asking first
       * is also the honest shape: when the codec decodes the samples itself, the encoded bytes are
       * never needed, and materialising up to 96 MiB to throw away was always waste.
       */
      setState(stage, ['loading'])
      stage.dataset['phase'] = 'info'
      try {
        const info = await source.info(scope.signal)
        const first = info.tracks.find(item => item.selected) ?? info.tracks[0]
        // A bank or a container with several streams: each one plays on its own (MK2's stream list).
        if (info.tracks.length > 1) {
          const select = element(toolbar, 'select') as HTMLSelectElement
          select.title = localizer.text('viewer.audioTracks')
          select.setAttribute('aria-label', localizer.text('viewer.audioTracks'))
          for (const [index, track] of info.tracks.entries()) {
            const option = element(select, 'option', {
              text: audioTrackLine(track, index),
            }) as HTMLOptionElement
            option.value = track.id
          }
          if (first !== undefined) select.value = first.id
          select.addEventListener(
            'change',
            () =>
              void show(
                info,
                info.tracks.find(track => track.id === select.value),
              ),
            { signal: scope.signal },
          )
        }
        await show(info, first)
      } catch (error) {
        fail(error)
      }

      mountContributedSections(shell, options.sections, args, unmount => scope.cleanup(unmount))

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
        paint()
      })
    },
  })
}

export const audioViewer: ViewerModule = createAudioViewer()
