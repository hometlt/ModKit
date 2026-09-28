/**
 * MediaShell — the MK2 viewer shell (`@modkitx/viewer-shell`) and its media gallery, ported.
 *
 * Three panes: a gallery of sibling subjects on the left, the render area in the middle and a
 * sidebar of collapsible sections on the right. The only chrome is two floating codicon toggles
 * over the render area and two splitters. Image, video and model viewers mount their main render
 * into `stage` (full size, no margins) and publish everything else as sidebar sections, so every
 * media type reads the same. Status (zoom, channels, size, format) goes to the host status bar.
 *
 * The gallery is MK2's `media-viewer-shell.ts`: folder groups with a chevron and a count
 * (collapsed unless they hold the open file or a filter is typed), list / small / big views,
 * thumbnails only for expanded groups, and the case / word / regex quick filter.
 */
import type { ViewerGalleryItem, ViewerGalleryPort, ViewerModule } from '@modkit/sdk'
import { setPart, setState, type PartName } from '../parts.js'
import { icon, iconButton } from '../icons/index.js'
import { createFilterWidget, textMatches } from '../filter/index.js'
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
  filterCase?: boolean
  filterWord?: boolean
  filterRegex?: boolean
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

export interface MediaShellSectionOptions {
  readonly collapsed?: boolean
  /** Codicon name drawn before the title. */
  readonly icon?: string
}

export interface MediaShellSection {
  readonly root: HTMLElement
  readonly body: HTMLElement
  readonly collapsed: boolean
  setCollapsed(collapsed: boolean): void
  /** Called after the person expands or collapses the section. */
  onToggle(listener: (collapsed: boolean) => void): void
}

export interface MediaShell {
  readonly root: HTMLElement
  /** The render area; the viewer owns everything inside it. */
  readonly stage: HTMLElement
  /** Add (or return the existing) sidebar section. */
  section(id: string, title: string, options?: MediaShellSectionOptions): MediaShellSection
  /** Remove sidebar sections (all, or every one not in `keep`), e.g. before a re-render. */
  clearSections(keep?: readonly string[]): void
  /** Refill the gallery from the port. */
  refreshGallery(signal?: AbortSignal): Promise<void>
  destroy(): void
}

/** A sidebar section a host or an extension adds to a media view: a viewer module of its own. */
export interface MediaShellContribution {
  readonly id: string
  readonly title: string
  /** Codicon name for the section header. */
  readonly icon?: string
  readonly collapsed?: boolean
  readonly module: ViewerModule
}

/**
 * Mount contributed sections into the sidebar, each module over the view's own arguments; each
 * mounted section's teardown goes to `onMounted`. A section whose module cannot bind here (no such
 * data source, nothing to offer) is removed rather than left empty.
 */
export function mountContributedSections(
  shell: MediaShell,
  sections: readonly MediaShellContribution[] | undefined,
  args: Parameters<ViewerModule['mount']>[0],
  onMounted: (unmount: () => void) => void,
): void {
  for (const contributed of sections ?? []) {
    const section = shell.section(contributed.id, contributed.title, {
      ...(contributed.icon === undefined ? {} : { icon: contributed.icon }),
      collapsed: contributed.collapsed ?? true,
    })
    void contributed.module
      .mount({ ...args, container: section.body })
      .then(mounted => onMounted(() => void mounted.unmount()))
      .catch(() => section.root.remove())
  }
}

const MIN_PANE = 120
const MAX_PANE = 640
const THUMB_EDGE = { small: 76, big: 128 } as const
const THUMB_CONCURRENCY = 6
/** A group auto-expands the first time it appears, only while the gallery holds this many items. */
const AUTO_EXPAND_MAX_ITEMS = 200

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
    rightWidth: 280,
    leftCollapsed: false,
    rightCollapsed: false,
    galleryMode: 'list',
    collapsedSections: [],
    ...options.state,
  }
  if (options.gallery === undefined) state.leftCollapsed = true
  const cleanup: (() => void)[] = []

  const root = el(document, 'div', 'media-shell')
  const toggleLeft = iconButton(
    root,
    'layout-sidebar-left',
    localizer.text('mediaShell.toggleGallery'),
  )
  setPart(toggleLeft, 'media-shell.toggle')
  toggleLeft.dataset['side'] = 'left'
  toggleLeft.hidden = options.gallery === undefined
  const toggleRight = iconButton(
    root,
    'layout-sidebar-right',
    localizer.text('mediaShell.toggleSidebar'),
  )
  setPart(toggleRight, 'media-shell.toggle')
  toggleRight.dataset['side'] = 'right'
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
    const flags: string[] = []
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
    if (!state.leftCollapsed) renderGallery()
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
      setState(splitter, ['active'])
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
        setState(splitter, [])
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
    sectionOptions: MediaShellSectionOptions = {},
  ): MediaShellSection => {
    const existing = sections.get(id)
    if (existing !== undefined) return existing
    const box = el(document, 'section', 'media-shell.section', right)
    box.dataset['sectionId'] = id
    const header = el(document, 'button', 'media-shell.section-header', box)
    header.type = 'button'
    const chevron = icon(document, 'chevron-down')
    setPart(chevron, 'media-shell.section-chevron')
    header.append(chevron)
    if (sectionOptions.icon !== undefined) {
      const glyph = icon(document, sectionOptions.icon)
      setPart(glyph, 'media-shell.section-icon')
      header.append(glyph)
    }
    el(document, 'span', 'media-shell.section-title', header).textContent = title
    const body = el(document, 'div', 'media-shell.section-body', box)
    const listeners: ((collapsed: boolean) => void)[] = []
    const setCollapsed = (collapsed: boolean): void => {
      box.dataset['collapsed'] = String(collapsed)
      header.setAttribute('aria-expanded', String(!collapsed))
      body.hidden = collapsed
    }
    const remembered = state.collapsedSections?.includes(id)
    setCollapsed(remembered === true ? true : (sectionOptions.collapsed ?? false))
    header.addEventListener('click', () => {
      const collapsed = box.dataset['collapsed'] !== 'true'
      setCollapsed(collapsed)
      const others = (state.collapsedSections ?? []).filter(item => item !== id)
      state.collapsedSections = collapsed ? [...others, id] : others
      for (const listener of listeners) listener(collapsed)
      emit()
    })
    const created: MediaShellSection = {
      root: box,
      body,
      get collapsed() {
        return box.dataset['collapsed'] === 'true'
      },
      setCollapsed,
      onToggle(listener) {
        listeners.push(listener)
      },
    }
    sections.set(id, created)
    return created
  }
  const clearSections = (keep: readonly string[] = []): void => {
    for (const [id, item] of sections) {
      if (keep.includes(id)) continue
      item.root.remove()
      sections.delete(id)
    }
  }

  // ------------------------------------------------------------------ gallery
  const toolbar = el(document, 'div', 'media-shell.gallery-toolbar', left)
  const modes = [
    ['list', 'list-flat', 'mediaShell.galleryList'],
    ['small', 'circle-small-filled', 'mediaShell.gallerySmall'],
    ['big', 'circle-large-filled', 'mediaShell.galleryBig'],
  ] as const satisfies readonly (readonly [GalleryMode, string, `${string}.${string}`])[]
  const modeButtons = modes.map(([mode, glyph, label]) => {
    const button = iconButton(toolbar, glyph, localizer.text(label), () => {
      state.galleryMode = mode
      renderGallery()
      emit()
    })
    setPart(button, 'media-shell.gallery-mode')
    button.dataset['mode'] = mode
    return button
  })
  const filter = createFilterWidget(toolbar, {
    localizer,
    initial: {
      caseSensitive: state.filterCase ?? false,
      wholeWord: state.filterWord ?? false,
      regex: state.filterRegex ?? false,
    },
    onChange(value) {
      const toggled =
        value.caseSensitive !== state.filterCase ||
        value.wholeWord !== state.filterWord ||
        value.regex !== state.filterRegex
      state.filterCase = value.caseSensitive
      state.filterWord = value.wholeWord
      state.filterRegex = value.regex
      renderGallery()
      if (toggled) emit()
    },
  })
  const list = el(document, 'div', 'media-shell.gallery-list', left)
  let items: readonly ViewerGalleryItem[] = []
  const expanded = new Set<string>()
  let thumbnails: AbortController | undefined
  /** Groups the gallery has shown before; only a group seen for the first time auto-expands. */
  const seenGroups = new Set<string>()

  const renderGallery = (): void => {
    thumbnails?.abort()
    thumbnails = new AbortController()
    const signal = thumbnails.signal
    const mode = state.galleryMode ?? 'list'
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset['mode'] === mode))
    }
    list.dataset['mode'] = mode
    list.replaceChildren()
    const matcher = filter.matcher()
    const filtering = filter.options.text !== ''
    const groups = new Map<string, ViewerGalleryItem[]>()
    for (const item of items) {
      if (filtering && !textMatches(item.label, matcher)) continue
      const key = item.group ?? ''
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    const pending: (() => Promise<void>)[] = []
    for (const [group, members] of groups) {
      const open = filtering || group === '' || expanded.has(group)
      const groupBox = el(document, 'div', 'media-shell.gallery-group', list)
      groupBox.dataset['collapsed'] = String(!open)
      if (group !== '') {
        const heading = el(document, 'button', 'media-shell.gallery-group-header', groupBox)
        heading.type = 'button'
        heading.setAttribute('aria-expanded', String(open))
        const chevron = icon(document, 'chevron-down')
        setPart(chevron, 'media-shell.section-chevron')
        heading.append(chevron)
        const label = el(document, 'span', 'media-shell.gallery-label', heading)
        label.textContent = group
        label.title = group
        el(document, 'span', 'media-shell.gallery-count', heading).textContent = String(
          members.length,
        )
        if (!filtering) {
          heading.addEventListener('click', () => {
            if (expanded.has(group)) expanded.delete(group)
            else expanded.add(group)
            renderGallery()
          })
        }
      }
      if (!open) continue
      const cells = el(document, 'div', 'media-shell.gallery-cells', groupBox)
      for (const item of members) {
        const cell = el(document, 'button', 'media-shell.gallery-item', cells)
        cell.type = 'button'
        cell.title = item.id
        if (item.active === true) {
          cell.setAttribute('aria-current', 'true')
          setState(cell, ['active'])
        }
        if (mode === 'list') {
          cell.append(icon(document, 'file-media'))
        } else {
          const wrap = el(document, 'span', 'media-shell.gallery-thumb-box', cell)
          const thumb = el(document, 'canvas', 'media-shell.gallery-thumb', wrap)
          thumb.width = 0
          thumb.height = 0
          const placeholder = icon(document, 'file-media')
          wrap.append(placeholder)
          pending.push(() =>
            drawThumbnail(options.gallery, item.id, thumb, THUMB_EDGE[mode], signal).then(drawn => {
              // The icon stands in for the picture; a stylesheet cannot retract it, because the
              // icon font's own rule is unlayered and outranks every layered one.
              if (drawn) placeholder.remove()
            }),
          )
        }
        el(document, 'span', 'media-shell.gallery-label', cell).textContent = item.label
        cell.addEventListener('click', () => {
          if (item.active === true) return
          void options.gallery?.open(item.id)
        })
      }
    }
    if (groups.size === 0) {
      el(document, 'div', 'media-shell.gallery-empty', list).textContent = localizer.text(
        filtering ? 'mediaShell.galleryNoMatch' : 'mediaShell.galleryEmpty',
      )
    }
    // MK2 decoded six thumbnails at a time so a big folder does not stall the host.
    const next = async (): Promise<void> => {
      for (let job = pending.shift(); job !== undefined && !signal.aborted; job = pending.shift()) {
        await job()
      }
    }
    for (let worker = 0; worker < THUMB_CONCURRENCY; worker += 1) void next()
  }

  const refreshGallery = async (signal?: AbortSignal): Promise<void> => {
    if (options.gallery === undefined) return
    items = await options.gallery.list(signal)
    if (items.length === 0) {
      // Nothing to show yet: never leave an empty gallery pane open by default.
      state.leftCollapsed = true
      applyLayout()
    }
    // A group that appears (the first fill, or a folder the viewer loaded later) opens while the
    // gallery is small; one the user has already seen keeps whatever state they left it in.
    for (const item of items) {
      if (item.group === undefined || seenGroups.has(item.group)) continue
      seenGroups.add(item.group)
      if (items.length <= AUTO_EXPAND_MAX_ITEMS) expanded.add(item.group)
    }
    for (const item of items) {
      if (item.active === true && item.group !== undefined) expanded.add(item.group)
    }
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
): Promise<boolean> {
  if (gallery?.thumbnail === undefined) return false
  try {
    const thumb = await gallery.thumbnail(id, edge, signal)
    if (thumb === undefined || signal.aborted) return false
    const context = canvas.getContext('2d')
    if (context === null) return false
    const pixels = new Uint8ClampedArray(thumb.width * thumb.height * 4)
    pixels.set(thumb.rgba.subarray(0, pixels.length))
    const bitmap = await createImageBitmap(new ImageData(pixels, thumb.width, thumb.height))
    // Sized to the image, so the checkerboard behind it has no transparent letterbox.
    const scale = Math.min(edge / bitmap.width, edge / bitmap.height, 1)
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    context.imageSmoothingEnabled = scale < 1
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    canvas.dataset['loaded'] = 'true'
    return true
  } catch {
    // A thumbnail is decoration: a sibling that cannot be decoded keeps its icon and label.
    return false
  }
}
