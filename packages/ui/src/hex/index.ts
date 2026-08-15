import type { ByteRangeSource, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export const HEX_WINDOW_BYTES = 4096

export interface HexWindow {
  readonly offset: bigint
  readonly bytes: Uint8Array
  readonly text: string
}

export class HexWindowModel {
  constructor(readonly source: ByteRangeSource) {}

  async read(offset: bigint, signal?: AbortSignal): Promise<HexWindow> {
    if (offset < 0n) throw new RangeError('hex offset must be non-negative')
    const size = await this.source.size()
    if (offset > size) throw new RangeError('hex offset exceeds source size')
    const length = Number(
      size - offset > BigInt(HEX_WINDOW_BYTES) ? HEX_WINDOW_BYTES : size - offset,
    )
    const bytes = await this.source.read(offset, length, signal)
    const lines: string[] = []
    for (let index = 0; index < bytes.length; index += 16) {
      const chunk = bytes.slice(index, index + 16)
      const address = (offset + BigInt(index)).toString(16).padStart(16, '0')
      const hex = [...chunk].map(value => value.toString(16).padStart(2, '0')).join(' ')
      const ascii = [...chunk]
        .map(value => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'))
        .join('')
      lines.push(`${address}  ${hex.padEnd(47)}  ${ascii}`)
    }
    return { offset, bytes, text: lines.join('\n') }
  }
}

export const hexViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Hex viewer')
    const lease = await unknownSourceLease(args.sources, args.slot, 'common.view/byte-range-source')
    if (lease === undefined) throw new TypeError('hex binding is unavailable')
    scope.lease(lease)
    const model = new HexWindowModel(lease.value as ByteRangeSource)
    const controls = element(root, 'div', { className: 'modkit-viewer__toolbar' })
    const offset = element(controls, 'input') as HTMLInputElement
    offset.type = 'text'
    offset.inputMode = 'numeric'
    offset.value = '0'
    offset.setAttribute('aria-label', 'Byte offset')
    const go = element(controls, 'button', { text: 'Go' }) as HTMLButtonElement
    go.type = 'button'
    const content = element(root, 'pre', { className: 'modkit-viewer__hex' })
    content.tabIndex = 0

    const render = async () => {
      const value = /^(?:0x)?[0-9a-f]+$/iu.test(offset.value.trim())
        ? BigInt(offset.value.trim())
        : -1n
      const window = await model.read(value, scope.signal)
      setViewerText(content, window.text)
      content.dataset['offset'] = window.offset.toString(10)
    }
    await render()
    go.addEventListener('click', render)
    scope.cleanup(() => go.removeEventListener('click', render))
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})

export default hexViewer
