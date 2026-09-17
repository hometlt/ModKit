/**
 * MediaShell — the MK2 viewer shell (`@modkitx/viewer-shell`) as a shared MK3 layout.
 *
 * Three panes: a gallery of sibling subjects on the left, the render area in the middle and a
 * sidebar of collapsible sections on the right. The only chrome is two floating toggles over the
 * render area and two splitters. Image, video and model viewers mount their main render into
 * `stage` and publish everything else as sidebar sections, so every media type reads the same.
 * Status (zoom, channels, dimensions) is not drawn here: it goes to the host status bar.
 */
import type { ViewerGalleryItem, ViewerGalleryPort } from '@modkit/sdk'
import { setPart, type PartName } from '../parts.js'
import type { UiLocalizer } from '../localization/index.js'
import { MEDIA_SHELL_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export interface MediaShellState {
  leftWidth?: number
  rightWidth?: number
  leftCollapsed?: boolean
  rightCollapsed?: boolean
  galleryMode?: GalleryMode
  collapsedSections?: readonly string[]
}

export type GalleryMode = 'list' | 'small' | 'big'

export interface MediaShellOptions {
  readonly localizer?: UiLocalizer
  /** Previous layout, e.g. from the host's per-view state. */
  readonly state?: MediaShellState
  /** Called whenever the layout changes, so a host can remember it. */
  onStateChange?(state: MediaShellState): void
  /** No gallery port: the left pane starts collapsed and its toggle is hidden. */
  readonly gallery?: ViewerGalleryPort
}

export interface MediaShellSection {
  readonly root: HTMLElement
  readonly body: HTMLElement
  setCollapsed(collapsed: boolean): void
}

export interface MediaShell {
  readonly root: HTMLElement
  /** The render area; the viewer owns everything inside it. */
  readonly stage: HTMLElement
  /** Add (or return the existing) sidebar section. */
  section(id: string, title: string, options?: { collapsed?: boolean }): MediaShellSection
  /** Remove every sidebar section, e.g. before a remount. */
  clearSections(): void
  /** Refill the gallery from the port. */
  refreshGallery(signal?: AbortSignal): Promise<void>
  destroy(): void
}

const MIN_PANE = 120
const MAX_PANE = 640
const THUMB_EDGE = { small: 60, big: 112 } as const

function el<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  part: PartName,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  setPart(node, part)
  parent?.append(node)
  return node
}

export function createMediaShell(document: Document, options: MediaShellOptions): MediaShell {
  const localizer = withEnglishUiFallback(options.localizer, MEDIA_SHELL_FALLBACK_MESSAGES)
  const state: MediaShellState = {
    leftWidth: 240,
    rightWidth: 300,
    leftCollapsed: options.gallery === undefined,
    rightCollapsed: false,
    galleryMode: 'small',
    collapsedSections: [],
    ...options.state,
  }
  if (options.gallery === undefined) state.leftCollapsed = true
  const cleanup: (() => void)[] = []

  const root = el(document, 'div', 'media-shell')
  const toggleLeft = el(document, 'button', 'media-shell.toggle', root)
  toggleLeft.dataset['side'] = 'left'
  toggleLeft.type = 'button'
  toggleLeft.title = localizer.text('mediaShell.toggleGallery')
  toggleLeft.setAttribute('aria-label', toggleLeft.title)
  toggleLeft.hidden = options.gallery === undefined
  const toggleRight = el(document, 'button', 'media-shell.toggle', root)
  toggleRight.dataset['side'] = 'right'
  toggleRight.type = 'button'
  toggleRight.title = localizer.text('mediaShell.toggleSidebar')
  toggleRight.setAttribute('aria-label', toggleRight.title)
  const left = el(document, 'aside', 'media-shell.gallery', root)
  left.setAttribute('aria-label', localizer.text('mediaShell.gallery'))
  const splitLeft = el(document, 'div', 'media-shell.splitter', root)
  splitLeft.dataset['side'] = 'left'
  splitLeft.setAttribute('role', 'separator')
  splitLeft.setAttribute('aria-orientation', 'vertical')
  const stage = el(document, 'main', 'media-shell.stage', root)
  const splitRight = el(document, 'div', 'media-shell.splitter', root)
  splitRight.dataset['side'] = 'right'
  splitRight.setAttribute('role', 'separator')
  splitRight.setAttribute('aria-orientation', 'vertical')
  const right = el(document, 'aside', 'media-shell.sidebar', root)
  right.setAttribute('aria-label', localizer.text('mediaShell.sidebar'))

  const emit = (): void => options.onStateChange?.({ ...state })
  const applyLayout = (): void => {
    root.style.setProperty('--shell-left', `${state.leftWidth}px`)
    root.style.setProperty('--shell-right', `${state.rightWidth}px`)
    const flags: ('left-collapsed' | 'right-collapsed')[] = []
    if (state.leftCollapsed) flags.push('left-collapsed')
    if (state.rightCollapsed) flags.push('right-collapsed')
    root.dataset['layout'] = flags.join(' ')
    left.hidden = state.leftCollapsed === true
    splitLeft.hidden = state.leftCollapsed === true
    right.hidden = state.rightCollapsed === true
    splitRight.hidden = state.rightCollapsed === true
    toggleLeft.setAttribute('aria-pressed', String(!state.leftCollapsed))
    toggleRight.setAttribute('aria-pressed', String(!state.rightCollapsed))
  }
  toggleLeft.addEventListener('click', () => {
    state.leftCollapsed = !state.leftCollapsed
    applyLayout()
    emit()
  })
  toggleRight.addEventListener('click', () => {
    state.rightCollapsed = !state.rightCollapsed
    applyLayout()
    emit()
  })

  const dragSplitter = (splitter: HTMLElement, side: 'left' | 'right'): void => {
    splitter.addEventListener('pointerdown', down => {
      down.preventDefault()
      const startX = down.clientX
      const startWidth = (side === 'left' ? state.leftWidth : state.rightWidth) ?? 240
      splitter.setPointerCapture(down.pointerId)
      root.dataset['resizing'] = 'true'
      const move = (event: PointerEvent): void => {
        const delta = side === 'left' ? event.clientX - startX : startX - event.clientX
        const width = Math.min(MAX_PANE, Math.max(MIN_PANE, startWidth + delta))
        if (side === 'left') state.leftWidth = width
        else state.rightWidth = width
        applyLayout()
      }
      const up = (): void => {
        splitter.removeEventListener('pointermove', move)
        splitter.removeEventListener('pointerup', up)
        splitter.removeEventListener('pointercancel', up)
        delete root.dataset['resizing']
        emit()
      }
      splitter.addEventListener('pointermove', move)
      splitter.addEventListener('pointerup', up)
      splitter.addEventListener('pointercancel', up)
    })
  }
  dragSplitter(splitLeft, 'left')
  dragSplitter(splitRight, 'right')

  // ------------------------------------------------------------------ sections
  const sections = new Map<string, MediaShellSection>()
  const section = (
    id: string,
    title: string,
    sectionOptions: { collapsed?: boolean } = {},
  ): MediaShellSection => {
    const existing = sections.get(id)
    if (existing !== undefined) return existing
    const box = el(document, 'section', 'media-shell.section', right)
    box.dataset['sectionId'] = id
    const header = el(document, 'button', 'media-shell.section-header', box)
    header.type = 'button'
    const chevron = el(document, 'span', 'media-shell.section-chevron', header)
    chevron.setAttribute('aria-hidden', 'true')
    el(document, 'span', 'media-shell.section-title', header).textContent = title
    const body = el(document, 'div', 'media-shell.section-body', box)
    const setCollapsed = (collapsed: boolean): void => {
      box.dataset['collapsed'] = String(collapsed)
      header.setAttribute('aria-expanded', String(!collapsed))
      body.hidden = collapsed
    }
    const remembered = state.collapsedSections?.includes(id)
    setCollapsed(remembered ?? sectionOptions.collapsed ?? false)
    header.addEventListener('click', () => {
      const collapsed = box.dataset['collapsed'] !== 'true'
      setCollapsed(collapsed)
      const others = (state.collapsedSections ?? []).filter(item => item !== id)
      state.collapsedSections = collapsed ? [...others, id] : others
      emit()
    })
    const created = { root: box, body, setCollapsed }
    sections.set(id, created)
    return created
  }
  const clearSections = (): void => {
    sections.clear()
    right.replaceChildren()
  }

  // ------------------------------------------------------------------ gallery
  const toolbar = el(document, 'div', 'media-shell.gallery-toolbar', left)
  const modes: GalleryMode[] = ['list', 'small', 'big']
  const modeButtons = modes.map(mode => {
    const button = el(document, 'button', 'media-shell.gallery-mode', toolbar)
    button.type = 'button'
    button.dataset['mode'] = mode
    button.title = localizer.text(
      mode === 'list'
        ? 'mediaShell.galleryList'
        : mode === 'small'
          ? 'mediaShell.gallerySmall'
          : 'mediaShell.galleryBig',
    )
    button.setAttribute('aria-label', button.title)
    return button
  })
  const filter = el(document, 'input', 'media-shell.gallery-filter', toolbar)
  filter.type = 'search'
  filter.placeholder = localizer.text('mediaShell.galleryFilter')
  filter.setAttribute('aria-label', filter.placeholder)
  const list = el(document, 'div', 'media-shell.gallery-list', left)
  let items: readonly ViewerGalleryItem[] = []
  let thumbnails: AbortController | undefined

  const renderGallery = (): void => {
    thumbnails?.abort()
    thumbnails = new AbortController()
    const signal = thumbnails.signal
    const mode = state.galleryMode ?? 'small'
    for (const button of modeButtons)
      button.setAttribute('aria-pressed', String(button.dataset['mode'] === mode))
    list.dataset['mode'] = mode
    list.replaceChildren()
    const query = filter.value.trim().toLowerCase()
    const shown = items.filter(item => query === '' || item.label.toLowerCase().includes(query))
    const groups = new Map<string, ViewerGalleryItem[]>()
    for (const item of shown) {
      const key = item.group ?? ''
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    for (const [group, members] of groups) {
      const groupBox = el(document, 'div', 'media-shell.gallery-group', list)
      if (group !== '') {
        const heading = el(document, 'div', 'media-shell.gallery-group-header', groupBox)
        heading.textContent = group
        el(document, 'span', 'media-shell.gallery-count', heading).textContent = String(
          members.length,
        )
      }
      const cells = el(document, 'div', 'media-shell.gallery-cells', groupBox)
      for (const item of members) {
        const cell = el(document, 'button', 'media-shell.gallery-item', cells)
        cell.type = 'button'
        cell.title = item.label
        if (item.active === true) cell.setAttribute('aria-current', 'true')
        if (mode !== 'list') {
          const thumb = el(document, 'canvas', 'media-shell.gallery-thumb', cell)
          const edge = THUMB_EDGE[mode]
          thumb.width = edge
          thumb.height = edge
          void drawThumbnail(options.gallery, item.id, thumb, edge, signal)
        }
        el(document, 'span', 'media-shell.gallery-label', cell).textContent = item.label
        cell.addEventListener('click', () => {
          if (item.active === true) return
          void options.gallery?.open(item.id)
        })
      }
    }
  }
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      state.galleryMode = button.dataset['mode'] as GalleryMode
      renderGallery()
      emit()
    })
  }
  filter.addEventListener('input', renderGallery)

  const refreshGallery = async (signal?: AbortSignal): Promise<void> => {
    if (options.gallery === undefined) return
    items = await options.gallery.list(signal)
    renderGallery()
  }

  applyLayout()
  cleanup.push(() => thumbnails?.abort())
  return {
    root,
    stage,
    section,
    clearSections,
    refreshGallery,
    destroy() {
      for (const callback of cleanup) callback()
      root.remove()
    },
  }
}

async function drawThumbnail(
  gallery: ViewerGalleryPort | undefined,
  id: string,
  canvas: HTMLCanvasElement,
  edge: number,
  signal: AbortSignal,
): Promise<void> {
  if (gallery?.thumbnail === undefined) return
  try {
    const thumb = await gallery.thumbnail(id, edge, signal)
    if (thumb === undefined || signal.aborted) return
    const context = canvas.getContext('2d')
    if (context === null) return
    const pixels = new Uint8ClampedArray(thumb.width * thumb.height * 4)
    pixels.set(thumb.rgba.subarray(0, pixels.length))
    const bitmap = await createImageBitmap(new ImageData(pixels, thumb.width, thumb.height))
    const scale = Math.min(edge / bitmap.width, edge / bitmap.height, 1)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    context.clearRect(0, 0, edge, edge)
    context.imageSmoothingEnabled = scale < 1
    context.drawImage(bitmap, (edge - width) / 2, (edge - height) / 2, width, height)
    bitmap.close()
  } catch {
    // A thumbnail is decoration: a sibling that cannot be decoded keeps its label.
  }
}
