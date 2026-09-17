/**
 * Image editing — MK2 `assetsTextureViewer`'s Edit section, ported as a shared module.
 *
 * It lives in a sidebar section of whichever viewer shows the pixels and works through a small
 * `ImageEditSurface`, so the image viewer, a sprite viewer or a map texture layer can all host it.
 * The behaviour is MK2's, not a redesign:
 *
 *  - Tools rasterise onto a scratch mask and blend it into the committed pixels, never onto the
 *    visible canvas; a drag previews on a throwaway copy over the union of every rect it touched.
 *  - A channel isolate restricts the write to that one byte (normal-map and mask painting); erase
 *    always clears alpha.
 *  - Editing is live only while the Edit section is expanded, so a plain drag pans by default.
 *  - Crop and Clear act on a selection; Resize is a dialog raised from the host status bar.
 *  - Undo depth 100; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; M B E L R C G I tool shortcuts.
 *
 * The module owns pixels and history only. Saving goes to `onSave`, which the host wires to the
 * codec's `edit.content` operation, so the same tools write a PNG, a DDS or anything else.
 */
import { setPart, setState, type PartName } from '../parts.js'
import type { UiLocalizer } from '../localization/index.js'
import { IMAGE_EDITING_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export type ImageEditTool =
  'select' | 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'gradient' | 'eyedropper'

export type ImageEditChannel = 'rgb' | 'r' | 'g' | 'b' | 'a'

export interface EditRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** What the hosting viewer lends the editor. Coordinates are image pixels. */
export interface ImageEditSurface {
  /** The committed pixels; the editor mutates them in place. */
  pixels(): ImageData | undefined
  /** Swap in a buffer of a different size (crop, resize, full undo). */
  replace(next: ImageData): void
  /** Repaint: `preview` over `rect` while dragging, or the committed pixels when omitted. */
  show(preview?: ImageData, rect?: EditRect): void
  /** Pointer position in image pixels, clamped to the image. */
  toImage(event: PointerEvent | MouseEvent): { x: number; y: number }
  /** An image rect in CSS pixels relative to `overlay`. */
  toScreen(rect: EditRect): { left: number; top: number; width: number; height: number }
  channel(): ImageEditChannel
}

export interface ImageEditingOptions {
  readonly localizer?: UiLocalizer
  readonly surface: ImageEditSurface
  /** Positioned element over the render area: marquee, resize dialog and busy note go here. */
  readonly overlay: HTMLElement
  /** False: the codec cannot write this subject; the section says so instead of offering tools. */
  readonly editable: boolean
  /** Why editing is unavailable, when `editable` is false. */
  readonly unavailableReason?: string
  readonly recentColors?: readonly string[]
  onRecentColors?(colors: readonly string[]): void
  onDirty?(dirty: boolean): void
  /**
   * One committed edit. A host whose editor owns the undo stack turns each of these into one entry
   * there and drives `undo()` / `redo()` itself — which is why this module handles no undo keys.
   */
  onEdit?(): void
  onSave?(pixels: ImageData): Promise<void>
}

export interface ImageEditing {
  readonly root: HTMLElement
  readonly dirty: boolean
  /** The host's own Undo, Redo and Save drive these; the section draws no buttons for them. */
  undo(): boolean
  redo(): boolean
  save(): Promise<void>
  /** Tools engage only while the section is expanded (MK2's zoom/pan default). */
  setActive(active: boolean): void
  readonly active: boolean
  /** Pointer events from the render area; `true` = consumed, do not pan. */
  pointerDown(event: PointerEvent): boolean
  pointerMove(event: PointerEvent): boolean
  pointerUp(event: PointerEvent): boolean
  /** Keyboard shortcuts; `true` = consumed. */
  keyDown(event: KeyboardEvent): boolean
  openResize(): void
  /** Re-place the marquee after the view moved. */
  refresh(): void
  destroy(): void
}

export const IMAGE_EDIT_UNDO_DEPTH = 100

/**
 * Tool-palette icons — MK2's stroke SVGs (a brush, a bucket, a pipette, a dashed marquee…),
 * `currentColor` so they follow the button's hover and active colours.
 */
const TOOL_ICONS: Readonly<Record<ImageEditTool, string>> = Object.freeze({
  select: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="2.5" width="11" height="11" rx=".5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 2"/></svg>`,
  brush: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M12.1 1.9a1.6 1.6 0 0 1 2 2.4L7.8 10.6a2.4 2.4 0 0 1-1.5.7l-2.1.2.2-2.1c.1-.6.4-1.1.7-1.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.2 11.4c.2 1.6-1 2.8-2.6 2.8.6-1 .8-2.2.5-3.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  eraser: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="3.6" y="6.3" width="9.6" height="5.2" rx="1" transform="rotate(-25 8.4 8.9)" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.6 11.6h6.4" stroke="currentColor" stroke-width="1" transform="rotate(-25 8.4 8.9)"/></svg>`,
  line: `<svg viewBox="0 0 16 16" width="16" height="16"><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="3" cy="13" r="1.2" fill="currentColor"/><circle cx="13" cy="3" r="1.2" fill="currentColor"/></svg>`,
  rect: `<svg viewBox="0 0 16 16" width="16" height="16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  ellipse: `<svg viewBox="0 0 16 16" width="16" height="16"><ellipse cx="8" cy="8" rx="5.4" ry="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  fill: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 7.6 8.4 2.2l5 5-5.3 5.3a2.7 2.7 0 0 1-3.8 0L3 11.2a2.7 2.7 0 0 1 0-3.6Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.3 8.1h9.4" stroke="currentColor" stroke-width="1"/><circle cx="13" cy="12.2" r="1.4" fill="currentColor"/></svg>`,
  gradient: `<svg viewBox="0 0 16 16" width="16" height="16"><defs><linearGradient id="mk-edit-tool-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="url(#mk-edit-tool-gradient)" stroke="currentColor" stroke-width="1.1"/></svg>`,
  eyedropper: `<svg viewBox="0 0 16 16" width="16" height="16"><path d="M11.1 2.3 13.7 4.9 6.3 12.3 3.4 12.9l.6-2.9Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.1 4.3 11.7 6.9" stroke="currentColor" stroke-width="1"/><circle cx="3.7" cy="12.3" r=".7" fill="currentColor"/></svg>`,
})

const TOOLS: readonly (readonly [ImageEditTool, string])[] = [
  ['select', 'M'],
  ['brush', 'B'],
  ['eraser', 'E'],
  ['line', 'L'],
  ['rect', 'R'],
  ['ellipse', 'C'],
  ['fill', 'G'],
  ['gradient', ''],
  ['eyedropper', 'I'],
]
const TOOL_SHORTCUTS: Readonly<Record<string, ImageEditTool>> = Object.freeze(
  Object.fromEntries(
    TOOLS.filter(([, key]) => key !== '').map(([tool, key]) => [key.toLowerCase(), tool]),
  ),
)
/** Which of Size / Tolerance a tool uses; Brush settings shows only what applies. */
const SIZE_TOOLS: ReadonlySet<ImageEditTool> = new Set([
  'brush',
  'eraser',
  'line',
  'rect',
  'ellipse',
])
const TOLERANCE_TOOLS: ReadonlySet<ImageEditTool> = new Set(['fill'])

interface RectPatch {
  readonly kind: 'rect'
  readonly rect: EditRect
  readonly before: Uint8ClampedArray
  readonly after: Uint8ClampedArray
}
interface FullPatch {
  readonly kind: 'full'
  readonly before: ImageData
  readonly after: ImageData
}
type Patch = RectPatch | FullPatch

// ------------------------------------------------------------------ pixel helpers
export function clampRect(rect: EditRect, width: number, height: number): EditRect {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

function unionRect(a: EditRect | undefined, b: EditRect): EditRect {
  if (a === undefined) return b
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  return {
    x: x0,
    y: y0,
    w: Math.max(a.x + a.w, b.x + b.w) - x0,
    h: Math.max(a.y + a.h, b.y + b.h) - y0,
  }
}

function snapshot(image: ImageData, rect: EditRect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4)
  for (let y = 0; y < rect.h; y += 1) {
    const offset = ((rect.y + y) * image.width + rect.x) * 4
    out.set(image.data.subarray(offset, offset + rect.w * 4), y * rect.w * 4)
  }
  return out
}

function restore(image: ImageData, rect: EditRect, patch: Uint8ClampedArray): void {
  for (let y = 0; y < rect.h; y += 1) {
    image.data.set(
      patch.subarray(y * rect.w * 4, (y + 1) * rect.w * 4),
      ((rect.y + y) * image.width + rect.x) * 4,
    )
  }
}

const copyImage = (image: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)

interface Ink {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Blend an alpha-coverage mask (`rect`-sized, coverage in the alpha byte) into `image`.
 * `rgb`: source-over of the ink. A channel isolate writes the ink's red component into that one
 * byte. `erase` ignores the isolate and clears alpha.
 */
export function blendMask(
  image: ImageData,
  rect: EditRect,
  mask: Uint8ClampedArray,
  mode: 'paint' | 'erase',
  ink: Ink,
  channel: ImageEditChannel,
): void {
  const { data, width } = image
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const coverage = (mask[(y * rect.w + x) * 4 + 3] as number) / 255
      if (coverage <= 0) continue
      const o = ((rect.y + y) * width + rect.x + x) * 4
      if (mode === 'erase') {
        data[o + 3] = Math.round((data[o + 3] as number) * (1 - coverage))
        continue
      }
      const srcA = (ink.a / 255) * coverage
      if (channel === 'rgb') {
        const dstA = (data[o + 3] as number) / 255
        const outA = srcA + dstA * (1 - srcA)
        if (outA <= 0) {
          data.fill(0, o, o + 4)
          continue
        }
        data[o] = Math.round((ink.r * srcA + (data[o] as number) * dstA * (1 - srcA)) / outA)
        data[o + 1] = Math.round(
          (ink.g * srcA + (data[o + 1] as number) * dstA * (1 - srcA)) / outA,
        )
        data[o + 2] = Math.round(
          (ink.b * srcA + (data[o + 2] as number) * dstA * (1 - srcA)) / outA,
        )
        data[o + 3] = Math.round(outA * 255)
      } else {
        const index = o + { r: 0, g: 1, b: 2, a: 3 }[channel]
        data[index] = Math.round(ink.r * srcA + (data[index] as number) * (1 - srcA))
      }
    }
  }
}

/** MK2's 4-way flood fill: every pixel within `tolerance` (sum of RGBA deltas) of the start. */
export function floodMask(
  image: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
): { rect: EditRect; mask: Uint8ClampedArray } | undefined {
  const { data, width, height } = image
  const x0 = Math.floor(startX)
  const y0 = Math.floor(startY)
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return undefined
  const t = (y0 * width + x0) * 4
  const target = [data[t], data[t + 1], data[t + 2], data[t + 3]] as number[]
  const visited = new Uint8Array(width * height)
  const stack: number[] = [x0, y0]
  let minX = x0
  let minY = y0
  let maxX = x0
  let maxY = y0
  while (stack.length > 0) {
    const y = stack.pop() as number
    const x = stack.pop() as number
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const index = y * width + x
    if (visited[index] === 1) continue
    const o = index * 4
    const delta =
      Math.abs((data[o] as number) - (target[0] as number)) +
      Math.abs((data[o + 1] as number) - (target[1] as number)) +
      Math.abs((data[o + 2] as number) - (target[2] as number)) +
      Math.abs((data[o + 3] as number) - (target[3] as number))
    if (delta > tolerance) continue
    visited[index] = 1
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  const mask = new Uint8ClampedArray(rect.w * rect.h * 4)
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      if (visited[(rect.y + y) * width + rect.x + x] === 1) mask[(y * rect.w + x) * 4 + 3] = 255
    }
  }
  return { rect, mask }
}

/** Nearest or bilinear resample (MK2 ran `resizeRgba` in the host; it is cheap enough here). */
export function resampleImage(
  image: ImageData,
  width: number,
  height: number,
  algorithm: 'nearest' | 'bilinear',
): ImageData {
  const out = new ImageData(width, height)
  const sx = image.width / width
  const sy = image.height / height
  const src = image.data
  const at = (x: number, y: number, c: number): number =>
    src[
      (Math.min(image.height - 1, y) * image.width + Math.min(image.width - 1, x)) * 4 + c
    ] as number
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4
      if (algorithm === 'nearest') {
        const nx = Math.floor((x + 0.5) * sx)
        const ny = Math.floor((y + 0.5) * sy)
        for (let c = 0; c < 4; c += 1) out.data[o + c] = at(nx, ny, c)
        continue
      }
      const fx = Math.max(0, (x + 0.5) * sx - 0.5)
      const fy = Math.max(0, (y + 0.5) * sy - 0.5)
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const dx = fx - ix
      const dy = fy - iy
      for (let c = 0; c < 4; c += 1) {
        const top = at(ix, iy, c) * (1 - dx) + at(ix + 1, iy, c) * dx
        const bottom = at(ix, iy + 1, c) * (1 - dx) + at(ix + 1, iy + 1, c) * dx
        out.data[o + c] = Math.round(top * (1 - dy) + bottom * dy)
      }
    }
  }
  return out
}

export const nearestPowerOfTwo = (value: number): number =>
  Math.max(1, 2 ** Math.round(Math.log2(Math.max(1, value))))

const hex2 = (value: number): string => value.toString(16).padStart(2, '0')

// ------------------------------------------------------------------ component
export function createImageEditing(
  parent: HTMLElement,
  options: ImageEditingOptions,
): ImageEditing {
  const localizer = withEnglishUiFallback(options.localizer, IMAGE_EDITING_FALLBACK_MESSAGES)
  const document = parent.ownerDocument
  const { surface, overlay } = options
  const listeners = new AbortController()
  const listen = { signal: listeners.signal }

  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    part: PartName,
    host: HTMLElement,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const created = document.createElement(tag)
    setPart(created, part)
    if (text !== undefined) created.textContent = text
    host.append(created)
    return created
  }
  const chip = (host: HTMLElement, text: string, onClick: () => void): HTMLButtonElement => {
    const button = node('button', 'image-editing.chip', host, text)
    button.type = 'button'
    button.addEventListener('click', onClick, listen)
    return button
  }
  const toolButton = (
    host: HTMLElement,
    title: string,
    content: string | HTMLElement,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = node('button', 'image-editing.tool', host)
    button.type = 'button'
    button.title = title
    button.setAttribute('aria-label', title)
    if (typeof content === 'string') {
      // Static, module-owned SVG markup; never built from input.
      const template = document.createElement('template')
      template.innerHTML = content
      button.append(template.content)
    } else button.append(content)
    button.addEventListener('click', onClick, listen)
    return button
  }
  const group = (title?: string): HTMLElement => {
    const box = node('div', 'image-editing.group', root)
    if (title !== undefined) node('div', 'image-editing.group-title', box, title)
    return box
  }
  const row = (host: HTMLElement): HTMLElement => node('div', 'image-editing.row', host)
  const range = (
    host: HTMLElement,
    label: string,
    min: number,
    max: number,
    value: number,
    onInput: (value: number) => void,
  ): { row: HTMLElement; input: HTMLInputElement } => {
    const line = row(host)
    node('label', 'image-editing.label', line, label)
    const input = node('input', 'image-editing.range', line)
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.value = String(value)
    input.setAttribute('aria-label', label)
    const readout = node('span', 'image-editing.value', line, String(value))
    input.addEventListener(
      'input',
      () => {
        readout.textContent = input.value
        onInput(Number(input.value))
      },
      listen,
    )
    return { row: line, input }
  }

  const root = document.createElement('div')
  setPart(root, 'image-editing')
  parent.append(root)

  // ---------------------------------------------------------------- state
  let tool: ImageEditTool = 'select'
  let ink: Ink = { r: 0xff, g: 0x3b, b: 0x30, a: 255 }
  let brushSize = 12
  let tolerance = 24
  let recent = [...(options.recentColors ?? [])]
  let selection: EditRect | undefined
  let active = false
  let dirty = false
  const undoStack: Patch[] = []
  const redoStack: Patch[] = []
  const maskCanvas = document.createElement('canvas')
  const mask = maskCanvas.getContext('2d', { willReadFrequently: true })
  let dragStart: { x: number; y: number } | undefined
  let dirtyRect: EditRect | undefined
  const strokePoints: { x: number; y: number }[] = []

  const markDirty = (value: boolean): void => {
    if (dirty === value) return
    dirty = value
    options.onDirty?.(value)
    syncButtons()
  }
  const push = (patch: Patch): void => {
    undoStack.push(patch)
    if (undoStack.length > IMAGE_EDIT_UNDO_DEPTH) undoStack.shift()
    redoStack.length = 0
    markDirty(true)
    syncButtons()
    options.onEdit?.()
  }

  // ---------------------------------------------------------------- unavailable
  if (!options.editable) {
    node(
      'p',
      'image-editing.note',
      root,
      options.unavailableReason ?? localizer.text('imageEditing.unavailable'),
    )
  }

  // ---------------------------------------------------------------- tools
  const toolGroup = group(localizer.text('imageEditing.tool'))
  toolGroup.hidden = !options.editable
  const status = node('output', 'image-editing.value', toolGroup)
  const grid = node('div', 'image-editing.tools', toolGroup)
  grid.setAttribute('role', 'toolbar')
  const toolButtons = new Map<ImageEditTool, HTMLButtonElement>()
  for (const [id, key] of TOOLS) {
    const title = localizer.text(`imageEditing.tool.${id}`) + (key === '' ? '' : ` (${key})`)
    toolButtons.set(
      id,
      toolButton(grid, title, TOOL_ICONS[id], () => selectTool(id)),
    )
  }
  const selectionRow = row(toolGroup)
  const clearButton = chip(selectionRow, localizer.text('imageEditing.clearSelection'), () =>
    clearSelection(),
  )
  const cropButton = chip(selectionRow, localizer.text('imageEditing.crop'), () => cropSelection())

  // ---------------------------------------------------------------- colour
  const colourGroup = group(localizer.text('imageEditing.color'))
  colourGroup.hidden = !options.editable
  const colourRow = row(colourGroup)
  const swatchButton = node('button', 'image-editing.swatch-button', colourRow)
  swatchButton.type = 'button'
  swatchButton.title = localizer.text('imageEditing.colorAlpha')
  swatchButton.setAttribute('aria-label', swatchButton.title)
  const swatchAlpha = node('span', 'image-editing.swatch-alpha', swatchButton)
  const colourText = node('span', 'image-editing.value', colourRow)
  const swatches = node('div', 'image-editing.swatches', colourGroup)
  const popover = node('div', 'image-editing.popover', colourGroup)
  popover.hidden = true
  const pickerRow = row(popover)
  node('label', 'image-editing.label', pickerRow, 'RGB')
  const picker = node('input', 'image-editing.color', pickerRow)
  picker.type = 'color'
  picker.setAttribute('aria-label', localizer.text('imageEditing.color'))
  range(popover, localizer.text('imageEditing.alpha'), 0, 255, 255, value => {
    ink = { ...ink, a: value }
    syncColour()
  })
  const popoverActions = node('div', 'image-editing.actions', popover)
  chip(popoverActions, localizer.text('imageEditing.done'), () => {
    popover.hidden = true
  })
  swatchButton.addEventListener(
    'click',
    () => {
      popover.hidden = !popover.hidden
    },
    listen,
  )
  picker.addEventListener('input', () => setColour(picker.value), listen)

  // ---------------------------------------------------------------- brush settings
  const brushGroup = group(localizer.text('imageEditing.brushSettings'))
  const size = range(brushGroup, localizer.text('imageEditing.size'), 1, 200, brushSize, value => {
    brushSize = value
  })
  const fill = range(
    brushGroup,
    localizer.text('imageEditing.tolerance'),
    0,
    255,
    tolerance,
    value => {
      tolerance = value
    },
  )

  // ---------------------------------------------------------------- overlay
  const marquee = document.createElement('div')
  setPart(marquee, 'image-editing.marquee')
  marquee.hidden = true
  overlay.append(marquee)

  const dialog = document.createElement('div')
  setPart(dialog, 'image-editing.dialog')
  dialog.hidden = true
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', localizer.text('imageEditing.resize'))
  overlay.append(dialog)
  const sizeRow = row(dialog)
  const widthInput = node('input', 'image-editing.number', sizeRow)
  widthInput.type = 'number'
  widthInput.min = '1'
  widthInput.setAttribute('aria-label', localizer.text('imageEditing.width'))
  node('span', 'image-editing.value', sizeRow, '×')
  const heightInput = node('input', 'image-editing.number', sizeRow)
  heightInput.type = 'number'
  heightInput.min = '1'
  heightInput.setAttribute('aria-label', localizer.text('imageEditing.height'))
  const potButton = chip(sizeRow, 'PoT', () => {
    widthInput.value = String(nearestPowerOfTwo(Number(widthInput.value) || 1))
    heightInput.value = String(nearestPowerOfTwo(Number(heightInput.value) || 1))
  })
  potButton.title = localizer.text('imageEditing.powerOfTwo')
  const optionRow = row(dialog)
  const lockLabel = node('label', 'image-editing.check', optionRow)
  const lock = document.createElement('input')
  lock.type = 'checkbox'
  lock.checked = true
  lockLabel.append(lock, ` ${localizer.text('imageEditing.lockAspect')}`)
  const algorithm = node('select', 'image-editing.select', optionRow)
  algorithm.setAttribute('aria-label', localizer.text('imageEditing.resample'))
  for (const [value, label] of [
    ['nearest', localizer.text('imageEditing.nearest')],
    ['bilinear', localizer.text('imageEditing.bilinear')],
  ] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    algorithm.append(option)
  }
  algorithm.value = 'bilinear'
  const dialogActions = node('div', 'image-editing.actions', dialog)
  chip(dialogActions, localizer.text('imageEditing.cancel'), () => {
    dialog.hidden = true
  })
  chip(dialogActions, localizer.text('imageEditing.apply'), () => applyResize())
  widthInput.addEventListener(
    'input',
    () => {
      const image = surface.pixels()
      if (!lock.checked || image === undefined) return
      const width = Number(widthInput.value) || image.width
      heightInput.value = String(Math.max(1, Math.round((width * image.height) / image.width)))
    },
    listen,
  )
  heightInput.addEventListener(
    'input',
    () => {
      const image = surface.pixels()
      if (!lock.checked || image === undefined) return
      const height = Number(heightInput.value) || image.height
      widthInput.value = String(Math.max(1, Math.round((height * image.width) / image.height)))
    },
    listen,
  )

  // ---------------------------------------------------------------- behaviour
  function syncButtons(): void {
    clearButton.disabled = selection === undefined
    cropButton.disabled = selection === undefined
    const image = surface.pixels()
    status.textContent = image === undefined ? '' : `${image.width} × ${image.height}`
  }

  function syncColour(): void {
    const hex = `#${hex2(ink.r)}${hex2(ink.g)}${hex2(ink.b)}`
    picker.value = hex
    swatchAlpha.style.backgroundColor = `rgba(${ink.r},${ink.g},${ink.b},${ink.a / 255})`
    colourText.textContent = `${hex.toUpperCase()} · ${ink.a}`
  }

  function renderSwatches(): void {
    swatches.replaceChildren()
    for (const colour of recent) {
      const swatch = node('button', 'image-editing.swatch', swatches)
      swatch.type = 'button'
      swatch.title = colour
      swatch.setAttribute('aria-label', colour)
      swatch.style.backgroundColor = colour
      swatch.addEventListener('click', () => setColour(colour), listen)
    }
  }

  function setColour(hex: string): void {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex)
    if (match === null) return
    ink = {
      r: Number.parseInt(match[1] as string, 16),
      g: Number.parseInt(match[2] as string, 16),
      b: Number.parseInt(match[3] as string, 16),
      a: ink.a,
    }
    const normal =
      `#${(match[1] as string) + (match[2] as string) + (match[3] as string)}`.toLowerCase()
    recent = [normal, ...recent.filter(colour => colour !== normal)].slice(0, 12)
    options.onRecentColors?.(recent)
    renderSwatches()
    syncColour()
  }

  function selectTool(next: ImageEditTool): void {
    tool = next
    for (const [id, button] of toolButtons) {
      button.setAttribute('aria-pressed', String(id === next))
      setState(button, id === next ? ['active'] : [])
    }
    size.row.hidden = !SIZE_TOOLS.has(next)
    fill.row.hidden = !TOLERANCE_TOOLS.has(next)
    brushGroup.hidden = !options.editable || (!SIZE_TOOLS.has(next) && !TOLERANCE_TOOLS.has(next))
  }

  function showMarquee(): void {
    if (selection === undefined || selection.w <= 0 || selection.h <= 0 || !active) {
      marquee.hidden = true
      return
    }
    const box = surface.toScreen(selection)
    marquee.hidden = false
    marquee.style.left = `${box.left}px`
    marquee.style.top = `${box.top}px`
    marquee.style.width = `${box.width}px`
    marquee.style.height = `${box.height}px`
  }

  const maskData = (rect: EditRect): Uint8ClampedArray =>
    rect.w <= 0 || rect.h <= 0 || mask === null
      ? new Uint8ClampedArray(0)
      : mask.getImageData(rect.x, rect.y, rect.w, rect.h).data

  function beginStroke(point: { x: number; y: number }, image: ImageData): void {
    strokePoints.length = 0
    strokePoints.push(point)
    maskCanvas.width = image.width
    maskCanvas.height = image.height
    dirtyRect = undefined
  }

  function rasterize(end: { x: number; y: number }, image: ImageData): EditRect | undefined {
    if (mask === null) return undefined
    const start = strokePoints[0] as { x: number; y: number }
    mask.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    mask.lineCap = 'round'
    mask.lineJoin = 'round'
    mask.lineWidth = brushSize
    mask.strokeStyle = '#fff'
    const pad = brushSize
    if (tool === 'brush' || tool === 'eraser') {
      mask.beginPath()
      mask.moveTo(start.x, start.y)
      for (const point of strokePoints.slice(1)) mask.lineTo(point.x, point.y)
      if (strokePoints.length === 1) mask.lineTo(start.x + 0.01, start.y + 0.01)
      mask.stroke()
      const xs = strokePoints.map(point => point.x)
      const ys = strokePoints.map(point => point.y)
      return clampRect(
        {
          x: Math.min(...xs) - pad,
          y: Math.min(...ys) - pad,
          w: Math.max(...xs) - Math.min(...xs) + pad * 2,
          h: Math.max(...ys) - Math.min(...ys) + pad * 2,
        },
        image.width,
        image.height,
      )
    }
    if (tool === 'gradient') {
      const rect = clampRect(
        selection ?? { x: 0, y: 0, w: image.width, h: image.height },
        image.width,
        image.height,
      )
      const gradient = mask.createLinearGradient(start.x, start.y, end.x, end.y)
      gradient.addColorStop(0, 'rgba(255,255,255,1)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      mask.fillStyle = gradient
      mask.fillRect(rect.x, rect.y, rect.w, rect.h)
      return rect
    }
    mask.beginPath()
    if (tool === 'line') {
      mask.moveTo(start.x, start.y)
      mask.lineTo(end.x, end.y)
    } else if (tool === 'rect') {
      mask.rect(start.x, start.y, end.x - start.x, end.y - start.y)
    } else if (tool === 'ellipse') {
      mask.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0,
        0,
        Math.PI * 2,
      )
    } else return undefined
    mask.stroke()
    return clampRect(
      {
        x: Math.min(start.x, end.x) - pad,
        y: Math.min(start.y, end.y) - pad,
        w: Math.abs(end.x - start.x) + pad * 2,
        h: Math.abs(end.y - start.y) + pad * 2,
      },
      image.width,
      image.height,
    )
  }

  /** Blend onto a throwaway copy over everything this drag has touched, then show it. */
  function preview(rect: EditRect, image: ImageData): void {
    dirtyRect = clampRect(unionRect(dirtyRect, rect), image.width, image.height)
    const scratch = copyImage(image)
    blendMask(
      scratch,
      dirtyRect,
      maskData(dirtyRect),
      tool === 'eraser' ? 'erase' : 'paint',
      ink,
      surface.channel(),
    )
    surface.show(scratch, dirtyRect)
  }

  function commit(rect: EditRect, image: ImageData, coverage = maskData(rect)): void {
    if (rect.w <= 0 || rect.h <= 0) return
    const before = snapshot(image, rect)
    blendMask(image, rect, coverage, tool === 'eraser' ? 'erase' : 'paint', ink, surface.channel())
    push({ kind: 'rect', rect, before, after: snapshot(image, rect) })
    surface.show()
  }

  function undo(): boolean {
    const patch = undoStack.pop()
    const image = surface.pixels()
    if (patch === undefined || image === undefined) return false
    redoStack.push(patch)
    if (patch.kind === 'full') surface.replace(copyImage(patch.before))
    else {
      restore(image, patch.rect, patch.before)
      surface.show()
    }
    markDirty(undoStack.length > 0)
    syncButtons()
    return true
  }

  function redo(): boolean {
    const patch = redoStack.pop()
    const image = surface.pixels()
    if (patch === undefined || image === undefined) return false
    undoStack.push(patch)
    if (patch.kind === 'full') surface.replace(copyImage(patch.after))
    else {
      restore(image, patch.rect, patch.after)
      surface.show()
    }
    markDirty(true)
    syncButtons()
    return true
  }

  function clearSelection(): void {
    const image = surface.pixels()
    if (selection === undefined || image === undefined) return
    const rect = clampRect(selection, image.width, image.height)
    const before = snapshot(image, rect)
    for (let y = 0; y < rect.h; y += 1) {
      const o = ((rect.y + y) * image.width + rect.x) * 4
      image.data.fill(0, o, o + rect.w * 4)
    }
    push({ kind: 'rect', rect, before, after: snapshot(image, rect) })
    surface.show()
  }

  function replaceAll(next: ImageData): void {
    const image = surface.pixels()
    if (image === undefined) return
    const before = copyImage(image)
    surface.replace(next)
    push({ kind: 'full', before, after: copyImage(next) })
  }

  function cropSelection(): void {
    const image = surface.pixels()
    if (selection === undefined || image === undefined) return
    const rect = clampRect(selection, image.width, image.height)
    if (rect.w < 1 || rect.h < 1) return
    const cropped = new ImageData(rect.w, rect.h)
    cropped.data.set(snapshot(image, rect))
    selection = undefined
    showMarquee()
    replaceAll(cropped)
  }

  function applyResize(): void {
    const image = surface.pixels()
    if (image === undefined) return
    const width = Math.max(1, Math.round(Number(widthInput.value) || 1))
    const height = Math.max(1, Math.round(Number(heightInput.value) || 1))
    dialog.hidden = true
    if (width === image.width && height === image.height) return
    selection = undefined
    showMarquee()
    replaceAll(
      resampleImage(image, width, height, algorithm.value === 'nearest' ? 'nearest' : 'bilinear'),
    )
  }

  async function save(): Promise<void> {
    const image = surface.pixels()
    if (image === undefined || options.onSave === undefined || !dirty) return
    try {
      await options.onSave(image)
      undoStack.length = 0
      redoStack.length = 0
      markDirty(false)
    } finally {
      syncButtons()
    }
  }

  const engaged = (): boolean => active && options.editable

  const editing: ImageEditing = {
    root,
    get dirty() {
      return dirty
    },
    undo,
    redo,
    save,
    get active() {
      return engaged()
    },
    setActive(next) {
      active = next
      showMarquee()
    },
    pointerDown(event) {
      if (!engaged() || event.button !== 0) return false
      const image = surface.pixels()
      if (image === undefined) return false
      const point = surface.toImage(event)
      if (tool === 'eyedropper') {
        const o = (Math.floor(point.y) * image.width + Math.floor(point.x)) * 4
        setColour(
          `#${hex2(image.data[o] as number)}${hex2(image.data[o + 1] as number)}${hex2(image.data[o + 2] as number)}`,
        )
        return true
      }
      if (tool === 'fill') {
        const found = floodMask(image, point.x, point.y, tolerance)
        if (found !== undefined) commit(found.rect, image, found.mask)
        return true
      }
      dragStart = point
      if (tool === 'select') {
        selection = { x: point.x, y: point.y, w: 0, h: 0 }
        showMarquee()
        syncButtons()
        return true
      }
      beginStroke(point, image)
      if (tool === 'brush' || tool === 'eraser') {
        const rect = rasterize(point, image)
        if (rect !== undefined) preview(rect, image)
      }
      return true
    },
    pointerMove(event) {
      if (!engaged() || dragStart === undefined) return false
      const image = surface.pixels()
      if (image === undefined) return false
      const point = surface.toImage(event)
      if (tool === 'select') {
        selection = {
          x: Math.min(dragStart.x, point.x),
          y: Math.min(dragStart.y, point.y),
          w: Math.abs(point.x - dragStart.x),
          h: Math.abs(point.y - dragStart.y),
        }
        showMarquee()
        return true
      }
      if (tool === 'brush' || tool === 'eraser') strokePoints.push(point)
      const rect = rasterize(point, image)
      if (rect !== undefined) preview(rect, image)
      return true
    },
    pointerUp() {
      if (dragStart === undefined) return false
      dragStart = undefined
      if (tool === 'select') {
        if (selection !== undefined) {
          const image = surface.pixels()
          selection =
            image === undefined ? undefined : clampRect(selection, image.width, image.height)
          if (selection !== undefined && (selection.w < 1 || selection.h < 1)) selection = undefined
        }
        showMarquee()
        syncButtons()
        return true
      }
      const image = surface.pixels()
      // Commit over the whole previewed area: a shape that shrank mid-drag covers nothing outside.
      if (image !== undefined && dirtyRect !== undefined) commit(dirtyRect, image)
      dirtyRect = undefined
      return true
    },
    keyDown(event) {
      if (!engaged()) return false
      // No Ctrl+Z here: the host's editor owns the undo stack and calls `undo()` itself.
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey || event.altKey) return false
      const target = event.target
      if (target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/u.test(target.tagName)) {
        return false
      }
      const next = TOOL_SHORTCUTS[key]
      if (next === undefined) return false
      selectTool(next)
      return true
    },
    openResize() {
      const image = surface.pixels()
      if (image === undefined || !options.editable) return
      widthInput.value = String(image.width)
      heightInput.value = String(image.height)
      dialog.hidden = false
      widthInput.focus()
    },
    refresh() {
      showMarquee()
      syncButtons()
    },
    destroy() {
      listeners.abort()
      marquee.remove()
      dialog.remove()
      root.remove()
    },
  }

  selectTool(tool)
  renderSwatches()
  syncColour()
  syncButtons()
  return editing
}
