import type { VideoMediaSource, ViewerModule } from '@modkitx-x3/sdk'
import { collectEncodedMedia } from '../media/encoded.js'
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

export const videoViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Video viewer')
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
        `${info.tracks.filter(track => track.kind === 'video').length} video · ${
          info.tracks.filter(track => track.kind === 'audio').length
        } audio · ${info.durationMs === 'unknown' ? 'duration unknown' : `${info.durationMs} ms`}`,
      )
      setState(stage, [])
    } catch (error) {
      setState(stage, ['error'])
      player.remove()
      element(stage, 'p', {
        part: 'viewer.empty',
        text: `The platform cannot play this video representation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }

    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})
