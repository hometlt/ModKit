import type { VectorSceneSource, ViewerModule } from '@modkitx-x3/sdk'
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

export const VECTOR_MAXIMUM_TEXT_BYTES = 32 * 1024 * 1024

export const vectorViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Vector viewer')
    const stage = element(root, 'div', { part: 'vector' })
    const readout = element(stage, 'output', { part: 'vector.readout' })
    const image = element(stage, 'img', { part: 'vector.image' }) as HTMLImageElement
    image.alt = 'Vector scene preview'

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
        `${info.nodes} nodes · ${info.paths} paths · ${info.shapes} shapes · ${info.textNodes} text nodes`,
      )
      setState(stage, [])
    } catch (error) {
      setState(stage, ['error'])
      image.remove()
      element(stage, 'p', {
        part: 'viewer.empty',
        text: `The vector scene cannot be rendered safely: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }

    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})
