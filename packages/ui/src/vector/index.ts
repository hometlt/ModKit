import type { VectorSceneSource, ViewerModule } from '@modkit/sdk'
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
import { type UiLocalizer } from '../localization/index.js'
import { VECTOR_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const VECTOR_MAXIMUM_TEXT_BYTES = 32 * 1024 * 1024

export interface VectorViewerOptions {
  readonly localizer?: UiLocalizer
}

export function createVectorViewer(options: VectorViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, VECTOR_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.vector'))
      const stage = element(root, 'div', { part: 'vector' })
      const readout = element(stage, 'output', { part: 'vector.readout' })
      const image = element(stage, 'img', { part: 'vector.image' }) as HTMLImageElement
      image.alt = localizer.text('viewer.vectorPreview')

      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/vector-scene-source',
      )
      if (lease === undefined) throw new TypeError('vector binding is unavailable')
      scope.lease(lease)

      setState(stage, ['loading'])
      try {
        const source = lease.value as VectorSceneSource
        const [info, document] = await Promise.all([
          source.info(scope.signal),
          source.document(scope.signal),
        ])
        if (document.profile !== 'uvg.secure-static.v1') {
          throw new TypeError(`unsupported vector security profile ${document.profile}`)
        }
        const textBytes = new TextEncoder().encode(document.text).byteLength
        if (textBytes > VECTOR_MAXIMUM_TEXT_BYTES) {
          throw new RangeError(`vector document exceeds the stage budget: ${textBytes} bytes`)
        }
        const objectUrl = URL.createObjectURL(
          new Blob([document.text], { type: `${document.mediaType};charset=utf-8` }),
        )
        image.src = objectUrl
        scope.cleanup(() => URL.revokeObjectURL(objectUrl))
        setViewerText(
          readout,
          localizer.text('viewer.vectorSummary', {
            nodes: info.nodes,
            paths: info.paths,
            shapes: info.shapes,
            text: info.textNodes,
          }),
        )
        setState(stage, [])
      } catch (error) {
        setState(stage, ['error'])
        image.remove()
        element(stage, 'p', {
          part: 'viewer.empty',
          text: localizer.text('viewer.vectorError', {
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

export const vectorViewer: ViewerModule = createVectorViewer()
