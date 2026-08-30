import type { TransportSnapshot, TransportSource, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  invokeOperation,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type UiLocalizationOptions } from '../localization/index.js'
import { TRANSPORT_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export class TransportModel {
  constructor(readonly source: TransportSource) {}
  snapshot(signal?: AbortSignal) {
    return this.source.snapshot(signal)
  }
  events(signal?: AbortSignal) {
    return this.source.events(signal)
  }
}

export function createTransportViewer(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TRANSPORT_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.transport'))
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/transport-source',
      )
      if (lease === undefined) throw new TypeError('transport binding is unavailable')
      scope.lease(lease)
      const model = new TransportModel(lease.value as TransportSource)
      const status = element(root, 'output', {
        text: localizer.text('viewer.loading'),
        part: 'transport.status',
      })
      const controls = element(root, 'div', {
        className: 'modkit-viewer__transport',
        part: 'transport.controls',
      })
      let descriptor = args.descriptor
      let snapshot: TransportSnapshot

      const render = (value: TransportSnapshot) => {
        snapshot = value
        controls.replaceChildren()
        setViewerText(status, `${value.state} · ${value.positionMs} / ${value.durationMs} ms`)
        const commands = [
          [localizer.text('viewer.playPause'), value.controls.playPause, null],
          [localizer.text('viewer.seekStart'), value.controls.seek, { positionMs: 0 }],
          [localizer.text('viewer.normalSpeed'), value.controls.setRate, { rate: 1 }],
        ] as const
        for (const [label, operation, input] of commands) {
          if (operation === undefined) continue
          const button = element(controls, 'button', {
            text: label,
            part: 'transport.button',
          }) as HTMLButtonElement
          button.type = 'button'
          const invoke = async () => {
            const result = await invokeOperation(descriptor, args.operations, operation, input, {
              signal: scope.signal,
            })
            setViewerText(
              status,
              result.state === 'ok'
                ? localizer.text('viewer.operationComplete', { label })
                : result.reason,
            )
          }
          button.addEventListener('click', invoke)
          scope.cleanup(() => button.removeEventListener('click', invoke))
        }
        for (const track of value.tracks) {
          const item = element(controls, 'span', {
            text: track.label ?? track.id,
            part: 'transport.track',
          })
          item.setAttribute('role', 'status')
          item.dataset['selected'] = String(track.selected)
        }
      }

      render(await model.snapshot(scope.signal))
      const consume = async () => {
        try {
          for await (const event of model.events(scope.signal)) {
            if (event.kind === 'snapshot') render(event.snapshot)
            else setViewerText(status, event.diagnostic.message)
          }
        } catch (error) {
          if (!scope.signal.aborted) throw error
        }
      }
      void consume()
      return createViewerMount(root, scope, args, update => {
        descriptor = update.descriptor
        root.dataset['revision'] = descriptor.revision
        render(snapshot)
      })
    },
  })
}

export const transportViewer: ViewerModule = createTransportViewer()

export default transportViewer
