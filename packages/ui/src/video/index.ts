import type { AnyDescriptor, MetadataGroup, VideoMediaSource, ViewerModule } from '@modkit/sdk'
import { collectEncodedMedia } from '../media/encoded.js'
import {
  createMediaShell,
  mountContributedSections,
  type MediaShellContribution,
} from '../media-shell/index.js'
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

function facts(parent: HTMLElement, rows: readonly (readonly [string, string])[]): void {
  const list = element(parent, 'dl', { part: 'image.metadata' })
  for (const [label, value] of rows) {
    const row = element(list, 'div', { part: 'metadata.row' })
    element(row, 'dt', { text: label, part: 'metadata.label' })
    setViewerText(element(row, 'dd', { part: 'metadata.value' }), value, 512)
  }
}

export function createVideoViewer(options: VideoViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, VIDEO_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.video'))
      /*
       * The same shell the image view uses: a gallery of the siblings on the left, the player as
       * the whole render area, and the facts as sidebar sections — one layout for every media type.
       */
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...(args.gallery === undefined ? {} : { gallery: args.gallery }),
      })
      root.append(shell.root)
      scope.cleanup(() => shell.destroy())
      if (args.gallery !== undefined) void shell.refreshGallery(scope.signal).catch(() => undefined)
      const stage = element(shell.stage, 'div', { part: 'video' })
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
        const duration =
          info.durationMs === 'unknown'
            ? localizer.text('viewer.durationUnknown')
            : `${info.durationMs} ms`
        const videoTracks = info.tracks.filter(track => track.kind === 'video')
        const audioTracks = info.tracks.filter(track => track.kind === 'audio')
        setViewerText(
          readout,
          localizer.text('viewer.videoSummary', {
            video: videoTracks.length,
            audio: audioTracks.length,
            duration,
          }),
        )
        // Facts in the sidebar, identity in the host status bar: the image view's arrangement.
        const rows: readonly (readonly [string, string])[] = [
          [localizer.text('viewer.videoTracks'), String(videoTracks.length)],
          [localizer.text('viewer.audioTracks'), String(audioTracks.length)],
          [localizer.text('viewer.duration'), duration],
          [localizer.text('viewer.mediaType'), media.mediaType],
        ]
        facts(
          shell.section('video', localizer.text('viewer.video'), { icon: 'device-camera-video' })
            .body,
          rows,
        )
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
          {
            id: 'duration',
            icon: 'watch',
            text: duration,
            align: 'start',
          },
          {
            id: 'tracks',
            icon: 'layers',
            text: localizer.text('viewer.videoTrackCount', {
              video: videoTracks.length,
              audio: audioTracks.length,
            }),
            align: 'start',
          },
        ])
        scope.cleanup(() => args.status?.clear())
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

      mountContributedSections(shell, options.sections, args, unmount => scope.cleanup(unmount))

      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const videoViewer: ViewerModule = createVideoViewer()
