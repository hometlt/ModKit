import type { VideoMediaSource, ViewerModule } from '@modkitx-x3/sdk'
import { collectEncodedMedia } from '../media/encoded.js'
import { type UiLocalizer } from '../localization/index.js'
import { VIDEO_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
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

export const VIDEO_MAXIMUM_BYTES = 256 * 1024 * 1024

export interface VideoViewerOptions {
  readonly localizer?: UiLocalizer
}

export function createVideoViewer(options: VideoViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, VIDEO_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.video'))
      const stage = element(root, 'div', { part: 'video' })
      const readout = element(stage, 'output', { part: 'video.readout' })
      const player = element(stage, 'video', { part: 'video.player' }) as HTMLVideoElement
      player.controls = true
      player.preload = 'metadata'

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/video-media-source',
      )
      if (lease === undefined) throw new TypeError('video binding is unavailable')
      scope.lease(lease)

      setState(stage, ['loading'])
      try {
        const source = lease.value as VideoMediaSource
        const [info, encoded] = await Promise.all([
          source.info(scope.signal),
          source.encoded(scope.signal),
        ])
        const media = await collectEncodedMedia(encoded, VIDEO_MAXIMUM_BYTES, scope.signal)
        const objectUrl = URL.createObjectURL(
          new Blob([media.bytes as BlobPart], { type: media.mediaType }),
        )
        player.src = objectUrl
        scope.cleanup(() => URL.revokeObjectURL(objectUrl))
        setViewerText(
          readout,
          localizer.text('viewer.videoSummary', {
            video: info.tracks.filter(track => track.kind === 'video').length,
            audio: info.tracks.filter(track => track.kind === 'audio').length,
            duration:
              info.durationMs === 'unknown'
                ? localizer.text('viewer.durationUnknown')
                : `${info.durationMs} ms`,
          }),
        )
        setState(stage, [])
      } catch (error) {
        setState(stage, ['error'])
        player.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.videoPlayError', {
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

export const videoViewer: ViewerModule = createVideoViewer()
