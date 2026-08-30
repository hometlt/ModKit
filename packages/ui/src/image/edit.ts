/**
 * Image editing surface — MK2 `assetsTextureViewer` parity, as a reusable component.
 *
 * The design decisions that matter are carried over from MK2 rather than reinvented:
 *
 *  - **Tools rasterise onto a scratch mask, never onto the visible canvas.** Curves, line caps and
 *    anti-aliasing then come from the browser's own rasteriser instead of hand-rolled maths, and a
 *    live preview can be recomputed non-destructively on every pointer move.
 *  - **The mask is blended into pixel data, so a channel isolate can restrict the write to one byte
 *    per pixel.** That is the whole point of painting while a channel is isolated — normal-map and
 *    mask authoring. Erase is the documented exception: it always clears alpha in true RGBA space.
 *  - **Crop is an action, not a tool.** It is enabled once `select` has made a selection, matching
 *    how Photoshop, GIMP and Inkscape gate it.
 *
 * This component owns pixels and history only. It does not decode, encode or commit: a host wires
 * `onCommit` to the editor ports, so the same surface serves a PNG codec and a DDS codec alike.
 */
import { element, setPart, setState } from '../viewer/index.js'
import type { ImageChannel } from './index.js'
import { type UiLocalizer } from '../localization/index.js'
import { IMAGE_EDIT_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export type ImageTool =
  'select' | 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'gradient' | 'eyedropper'

export interface ImageRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

interface RectPatch {
  readonly kind: 'rect'
  readonly rect: ImageRect
  readonly before: Uint8ClampedArray
  readonly after: Uint8ClampedArray
}

interface FullPatch {
  readonly kind: 'full'
  readonly before: ImageData
  readonly after: ImageData
}

type Patch = RectPatch | FullPatch

/** MK2's depth. Deep enough for a painting session, bounded so a 4K texture cannot exhaust memory. */
export const IMAGE_UNDO_DEPTH = 100

const TOOLS: readonly { readonly id: ImageTool; readonly label: string }[] = Object.freeze([
  { id: 'select', label: '▭' },
  { id: 'brush', label: '✎' },
  { id: 'eraser', label: '⌫' },
  { id: 'line', label: '╱' },
  { id: 'rect', label: '▬' },
  { id: 'ellipse', label: '◯' },
  { id: 'fill', label: '🪣' },
  { id: 'gradient', label: '▤' },
  { id: 'eyedropper', label: '⊙' },
])

export interface ImageEditorOptions {
  readonly localizer?: UiLocalizer
  /** Starting pixels. The editor copies them; the caller keeps ownership of the original. */
  readonly source: ImageData
  /** Restrict writes to one channel. `rgb` composites normally. */
  readonly channel?: ImageChannel
  readonly colour?: string
  /** Called after every committed edit with the current pixels. */
  readonly onChange?: (pixels: ImageData) => void
  /** Wire to the host's editor ports. Absent means the surface is a scratchpad. */
  readonly onCommit?: (pixels: ImageData) => void | Promise<void>
}

export interface ImageEditor {
  readonly root: HTMLElement
  readonly pixels: ImageData
  tool: ImageTool
  channel: ImageChannel
  colour: string
  selection: ImageRect | undefined
  undo(): boolean
  redo(): boolean
  cropToSelection(): boolean
  /** Bind painting to a canvas showing the pixels. Returns a detach function. */
  attach(canvas: HTMLCanvasElement, signal?: AbortSignal): void
  destroy(): void
}

const clampInt = (value: number, low: number, high: number): number =>
  Math.min(Math.max(Math.round(value), low), high)

/** Channel index for a single-channel isolate, or `undefined` for normal RGB compositing. */
const channelIndex = (channel: ImageChannel): number | undefined =>
  channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : channel === 'a' ? 3 : undefined

function parseColour(colour: string): readonly [number, number, number, number] {
  const hex = colour.trim().replace('#', '')
  if (hex.length === 6 || hex.length === 8) {
    const value = Number.parseInt(hex.slice(0, 6), 16)
    const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha]
  }
  return [255, 255, 255, 255]
}

export function createImageEditor(host: HTMLElement, options: ImageEditorOptions): ImageEditor {
  const localizer = withEnglishUiFallback(options.localizer, IMAGE_EDIT_FALLBACK_MESSAGES)
  const document = host.ownerDocument
  // Own copy: the caller's ImageData may be a decoded view the codec still holds.
  let pixels = new ImageData(
    new Uint8ClampedArray(options.source.data),
    options.source.width,
    options.source.height,
  )
  /*
   * Read through these, never through a captured constant. `cropToSelection` replaces the buffer
   * with a smaller one, and any offset still computed from the original stride would index the
   * wrong row and silently corrupt the image on the next stroke.
   */
  const width = (): number => pixels.width
  const height = (): number => pixels.height

  const undoStack: Patch[] = []
  const redoStack: Patch[] = []

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = pixels.width
  maskCanvas.height = pixels.height
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (maskContext === null) throw new TypeError('2d canvas context is unavailable')

  const root = element(host, 'div', { part: 'imageedit' })
  const tools = element(root, 'div', { part: 'imageedit.tools', role: 'toolbar' })
  tools.setAttribute('aria-label', localizer.text('imageEdit.tools'))
  const optionsRow = element(root, 'div', { part: 'imageedit.options' })
  const actions = element(root, 'div', { part: 'imageedit.actions', role: 'toolbar' })
  actions.setAttribute('aria-label', localizer.text('imageEdit.actions'))
  const status = element(root, 'output', { part: 'imageedit.status' })

  const state = {
    tool: 'select' as ImageTool,
    channel: options.channel ?? ('rgb' as ImageChannel),
    colour: options.colour ?? '#ffffff',
    selection: undefined as ImageRect | undefined,
  }

  // ------------------------------------------------------------------ history
  const pushPatch = (patch: Patch): void => {
    undoStack.push(patch)
    if (undoStack.length > IMAGE_UNDO_DEPTH) undoStack.shift()
    redoStack.length = 0
    syncActions()
    options.onChange?.(pixels)
  }

  const applyRect = (rect: ImageRect, data: Uint8ClampedArray): void => {
    for (let row = 0; row < rect.h; row += 1) {
      const target = ((rect.y + row) * width() + rect.x) * 4
      pixels.data.set(data.subarray(row * rect.w * 4, (row + 1) * rect.w * 4), target)
    }
  }

  const readRect = (rect: ImageRect): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(rect.w * rect.h * 4)
    for (let row = 0; row < rect.h; row += 1) {
      const source = ((rect.y + row) * width() + rect.x) * 4
      out.set(pixels.data.subarray(source, source + rect.w * 4), row * rect.w * 4)
    }
    return out
  }

  // ------------------------------------------------------------------ blending
  /**
   * Blend an alpha-coverage mask into the pixels.
   *
   * `rgb` composites source-over. A single-channel isolate writes the tool colour's luminance into
   * that one byte and leaves the others untouched. `erase` ignores the isolate by design.
   */
  const blend = (rect: ImageRect, coverage: Uint8ClampedArray, erase: boolean): void => {
    const [red, green, blue, alpha] = parseColour(state.colour)
    const isolate = channelIndex(state.channel)
    const intensity = isolate === 3 ? alpha : Math.round(red * 0.299 + green * 0.587 + blue * 0.114)

    for (let row = 0; row < rect.h; row += 1) {
      for (let column = 0; column < rect.w; column += 1) {
        const cover = (coverage[(row * rect.w + column) * 4 + 3] as number) / 255
        if (cover === 0) continue
        const offset = ((rect.y + row) * width() + rect.x + column) * 4

        if (erase) {
          pixels.data[offset + 3] = Math.round((pixels.data[offset + 3] as number) * (1 - cover))
          continue
        }
        if (isolate !== undefined) {
          const previous = pixels.data[offset + isolate] as number
          pixels.data[offset + isolate] = Math.round(previous * (1 - cover) + intensity * cover)
          continue
        }
        const sourceAlpha = (alpha / 255) * cover
        for (const [index, value] of [red, green, blue].entries()) {
          const previous = pixels.data[offset + index] as number
          pixels.data[offset + index] = Math.round(
            previous * (1 - sourceAlpha) + value * sourceAlpha,
          )
        }
        const previousAlpha = (pixels.data[offset + 3] as number) / 255
        pixels.data[offset + 3] = Math.round(
          (sourceAlpha + previousAlpha * (1 - sourceAlpha)) * 255,
        )
      }
    }
  }

  /** Bounding box of a stroke, clamped to the image and to any active selection. */
  const strokeBounds = (
    from: readonly [number, number],
    to: readonly [number, number],
    pad: number,
  ): ImageRect => {
    let x0 = clampInt(Math.min(from[0], to[0]) - pad, 0, width())
    let y0 = clampInt(Math.min(from[1], to[1]) - pad, 0, height())
    let x1 = clampInt(Math.max(from[0], to[0]) + pad, 0, width())
    let y1 = clampInt(Math.max(from[1], to[1]) + pad, 0, height())
    const clip = state.selection
    if (clip !== undefined) {
      x0 = Math.max(x0, clip.x)
      y0 = Math.max(y0, clip.y)
      x1 = Math.min(x1, clip.x + clip.w)
      y1 = Math.min(y1, clip.y + clip.h)
    }
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
  }

  // ------------------------------------------------------------------ controls
  const toolButtons = new Map<ImageTool, HTMLElement>()
  for (const spec of TOOLS) {
    const node = element(tools, 'button', { part: 'imageedit.tool', text: spec.label })
    node.setAttribute('type', 'button')
    node.dataset['toolId'] = spec.id
    node.setAttribute('aria-pressed', String(spec.id === state.tool))
    node.title = localizer.text(`imageEdit.tool.${spec.id}`)
    node.addEventListener('click', () => {
      state.tool = spec.id
      for (const [id, button] of toolButtons) {
        button.setAttribute('aria-pressed', String(id === spec.id))
        setState(button, id === spec.id ? ['selected'] : [])
      }
      syncStatus()
    })
    toolButtons.set(spec.id, node)
  }
  setState(toolButtons.get('select') as HTMLElement, ['selected'])

  const swatch = element(optionsRow, 'input', { part: 'imageedit.swatch' }) as HTMLInputElement
  swatch.type = 'color'
  swatch.value = state.colour
  swatch.setAttribute('aria-label', localizer.text('imageEdit.colour'))
  swatch.addEventListener('input', () => {
    state.colour = swatch.value
  })

  const size = element(optionsRow, 'input', { part: 'imageedit.size' }) as HTMLInputElement
  size.type = 'range'
  size.min = '1'
  size.max = '64'
  size.value = '8'
  size.setAttribute('aria-label', localizer.text('imageEdit.brushSize'))

  const action = (
    id: 'undo' | 'redo' | 'crop' | 'apply',
    label: string,
    hint: string,
    run: () => void,
  ): HTMLButtonElement => {
    const node = element(actions, 'button', {
      part: 'imageedit.action',
      text: label,
    }) as HTMLButtonElement
    node.type = 'button'
    node.dataset['actionId'] = id
    node.title = hint
    node.addEventListener('click', run)
    return node
  }

  const undoButton = action(
    'undo',
    localizer.text('viewer.undo'),
    localizer.text('imageEdit.undoTitle'),
    () => void editor.undo(),
  )
  const redoButton = action(
    'redo',
    localizer.text('viewer.redo'),
    localizer.text('imageEdit.redoTitle'),
    () => void editor.redo(),
  )
  const cropButton = action(
    'crop',
    localizer.text('imageEdit.crop'),
    localizer.text('imageEdit.cropTitle'),
    () => void editor.cropToSelection(),
  )
  const commitButton = action(
    'apply',
    localizer.text('edit.apply'),
    localizer.text('imageEdit.applyTitle'),
    () => {
      void options.onCommit?.(pixels)
    },
  )

  function syncActions(): void {
    undoButton.disabled = undoStack.length === 0
    redoButton.disabled = redoStack.length === 0
    cropButton.disabled = state.selection === undefined
    commitButton.disabled = options.onCommit === undefined || undoStack.length === 0
    syncStatus()
  }

  function syncStatus(): void {
    const selection = state.selection
    status.textContent = [
      `${width()}×${height()}`,
      localizer.text('imageEdit.toolStatus', {
        tool: localizer.text(`imageEdit.tool.${state.tool}`),
      }),
      state.channel === 'rgb'
        ? 'RGB'
        : localizer.text('imageEdit.channelStatus', { channel: state.channel.toUpperCase() }),
      selection === undefined
        ? localizer.text('imageEdit.noSelection')
        : localizer.text('imageEdit.selectionStatus', {
            width: selection.w,
            height: selection.h,
            x: selection.x,
            y: selection.y,
          }),
      localizer.text('imageEdit.undoStatus', { count: undoStack.length }),
    ].join(' · ')
  }

  // ------------------------------------------------------------------ painting
  const paint = (
    from: readonly [number, number],
    to: readonly [number, number],
    committing: boolean,
  ): void => {
    const radius = Number(size.value) || 8
    const rect = strokeBounds(from, to, radius)
    if (rect.w === 0 || rect.h === 0) return

    maskContext.clearRect(0, 0, width(), height())
    maskContext.strokeStyle = '#ffffff'
    maskContext.fillStyle = '#ffffff'
    maskContext.lineWidth = radius
    maskContext.lineCap = 'round'
    maskContext.lineJoin = 'round'

    if (state.tool === 'brush' || state.tool === 'eraser') {
      maskContext.beginPath()
      maskContext.moveTo(from[0], from[1])
      maskContext.lineTo(to[0], to[1])
      maskContext.stroke()
    } else if (state.tool === 'line') {
      maskContext.beginPath()
      maskContext.moveTo(from[0], from[1])
      maskContext.lineTo(to[0], to[1])
      maskContext.stroke()
    } else if (state.tool === 'rect') {
      maskContext.fillRect(
        Math.min(from[0], to[0]),
        Math.min(from[1], to[1]),
        Math.abs(to[0] - from[0]),
        Math.abs(to[1] - from[1]),
      )
    } else if (state.tool === 'ellipse') {
      maskContext.beginPath()
      maskContext.ellipse(
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        Math.abs(to[0] - from[0]) / 2,
        Math.abs(to[1] - from[1]) / 2,
        0,
        0,
        Math.PI * 2,
      )
      maskContext.fill()
    } else if (state.tool === 'gradient') {
      const gradient = maskContext.createLinearGradient(from[0], from[1], to[0], to[1])
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      maskContext.fillStyle = gradient
      maskContext.fillRect(rect.x, rect.y, rect.w, rect.h)
    } else if (state.tool === 'fill') {
      maskContext.fillRect(rect.x, rect.y, rect.w, rect.h)
    } else return

    if (!committing) return
    const before = readRect(rect)
    const coverage = maskContext.getImageData(rect.x, rect.y, rect.w, rect.h).data
    blend(rect, coverage, state.tool === 'eraser')
    pushPatch({ kind: 'rect', rect, before, after: readRect(rect) })
  }

  const editor: ImageEditor = {
    root,

    get pixels(): ImageData {
      return pixels
    },

    get tool(): ImageTool {
      return state.tool
    },
    set tool(value: ImageTool) {
      state.tool = value
      syncStatus()
    },

    get channel(): ImageChannel {
      return state.channel
    },
    set channel(value: ImageChannel) {
      state.channel = value
      syncStatus()
    },

    get colour(): string {
      return state.colour
    },
    set colour(value: string) {
      state.colour = value
      swatch.value = value
    },

    get selection(): ImageRect | undefined {
      return state.selection
    },
    set selection(value: ImageRect | undefined) {
      state.selection = value
      syncActions()
    },

    undo() {
      const patch = undoStack.pop()
      if (patch === undefined) return false
      if (patch.kind === 'rect') applyRect(patch.rect, patch.before)
      else
        pixels = new ImageData(
          new Uint8ClampedArray(patch.before.data),
          patch.before.width,
          patch.before.height,
        )
      redoStack.push(patch)
      syncActions()
      options.onChange?.(pixels)
      return true
    },

    redo() {
      const patch = redoStack.pop()
      if (patch === undefined) return false
      if (patch.kind === 'rect') applyRect(patch.rect, patch.after)
      else
        pixels = new ImageData(
          new Uint8ClampedArray(patch.after.data),
          patch.after.width,
          patch.after.height,
        )
      undoStack.push(patch)
      syncActions()
      options.onChange?.(pixels)
      return true
    },

    cropToSelection() {
      const rect = state.selection
      if (rect === undefined || rect.w === 0 || rect.h === 0) return false
      const before = pixels
      const cropped = new ImageData(rect.w, rect.h)
      for (let row = 0; row < rect.h; row += 1) {
        const source = ((rect.y + row) * width() + rect.x) * 4
        cropped.data.set(pixels.data.subarray(source, source + rect.w * 4), row * rect.w * 4)
      }
      pixels = cropped
      // The scratch mask is sized to the buffer; leaving it oversized would waste a full
      // clearRect every stroke and hide a coordinate mismatch if the crop ever grew the image.
      maskCanvas.width = cropped.width
      maskCanvas.height = cropped.height
      state.selection = undefined
      // A crop changes the buffer's dimensions, so it cannot be expressed as a rect patch.
      pushPatch({ kind: 'full', before, after: cropped })
      return true
    },

    attach(canvas, signal) {
      const listen = signal === undefined ? {} : { signal }
      let anchor: readonly [number, number] | undefined
      let last: readonly [number, number] | undefined

      const toImage = (event: PointerEvent): readonly [number, number] => {
        const box = canvas.getBoundingClientRect()
        return [
          clampInt(((event.clientX - box.left) / box.width) * width(), 0, width()),
          clampInt(((event.clientY - box.top) / box.height) * height(), 0, height()),
        ]
      }

      canvas.addEventListener(
        'pointerdown',
        event => {
          const point = toImage(event)
          anchor = point
          last = point
          try {
            canvas.setPointerCapture(event.pointerId)
          } catch {
            // Synthetic accessibility/test activation has no active platform pointer to capture;
            // the edit itself is still well-defined and the matching pointerup remains on canvas.
          }

          if (state.tool === 'eyedropper') {
            const offset = (point[1] * width() + point[0]) * 4
            const channels = [0, 1, 2].map(index =>
              (pixels.data[offset + index] as number).toString(16).padStart(2, '0'),
            )
            editor.colour = `#${channels.join('')}`
            anchor = undefined
          }
        },
        listen,
      )

      canvas.addEventListener(
        'pointermove',
        event => {
          if (anchor === undefined) return
          const point = toImage(event)
          if (state.tool === 'select') {
            state.selection = {
              x: Math.min(anchor[0], point[0]),
              y: Math.min(anchor[1], point[1]),
              w: Math.abs(point[0] - anchor[0]),
              h: Math.abs(point[1] - anchor[1]),
            }
            syncActions()
          } else if (state.tool === 'brush' || state.tool === 'eraser') {
            // Freehand commits per segment so a long stroke survives an interrupted pointer.
            paint(last ?? anchor, point, true)
          }
          last = point
        },
        listen,
      )

      const finish = (event: PointerEvent): void => {
        if (anchor === undefined) return
        const point = toImage(event)
        if (state.tool !== 'select' && state.tool !== 'brush' && state.tool !== 'eraser') {
          paint(anchor, point, true)
        }
        anchor = undefined
        last = undefined
      }
      canvas.addEventListener('pointerup', finish, listen)
      canvas.addEventListener('pointercancel', finish, listen)
    },

    destroy() {
      root.remove()
    },
  }

  setPart(root, 'imageedit')
  syncActions()
  return editor
}
