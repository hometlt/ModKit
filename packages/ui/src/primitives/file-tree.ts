/**
 * FileTree — the MK2 archive-explorer tree, as a primitive.
 *
 * A primitive, not a viewer contribution: it has no manifest and no ABI. Viewers and workbench
 * surfaces import it and feed it nodes. Children load lazily through the supplied callback, so a
 * CASC root with a hundred thousand entries never materialises.
 *
 * Keyboard model follows the ARIA tree pattern: one tab stop, arrows move and expand, Home/End
 * jump, Enter/Space activate, `*` expands every sibling.
 */
import { setPart, setState, type StateName } from '../parts.js'
import { setToken } from '../tokens/index.js'
import { safeViewerText } from '../viewer/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { PRIMITIVES_FILE_TREE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export interface FileTreeNode {
  readonly id: string
  readonly label: string
  /** Directory-like nodes get a twisty even before their children are known. */
  readonly hasChildren: boolean
  /** Free-form glyph or short text shown before the label; the caller owns icon policy. */
  readonly icon?: string
  /** Right-aligned annotation: entry count, size, compression, anything short. */
  readonly badge?: string
  /**
   * Size in bytes, carried so a caller that rebuilds an entry from a node does not lose it. The
   * badge is a formatted string for the eye; a host deciding whether a file is too large to read
   * needs the number, and without it that decision moves from "before the read" to "after".
   */
  readonly size?: number
  readonly kind?: string
  /** Buttons rendered on this row. They never alter tree selection or expansion. */
  readonly actions?: readonly FileTreeAction[]
}
export interface FileTreeAction {
  readonly id: string
  readonly label: string
  readonly title?: string
  readonly confirm?: string
}

export interface FileTreeOptions {
  readonly localizer?: UiLocalizer
  readonly label: string
  loadChildren(
    node: FileTreeNode | undefined,
    signal?: AbortSignal,
  ): Promise<readonly FileTreeNode[]>
  onSelect?(node: FileTreeNode): void
  onActivate?(node: FileTreeNode): void
  onAction?(node: FileTreeNode, action: FileTreeAction): void
  /** Rows whose label does not match are hidden; ancestors of a match stay visible. */
  matches?(node: FileTreeNode): boolean
}

export interface FileTree {
  readonly root: HTMLElement
  readonly toolbar: HTMLElement
  refresh(): Promise<void>
  collapseAll(): void
  expandAll(): Promise<void>
  /** Re-apply the current filter without reloading anything. */
  applyFilter(): void
  selected(): FileTreeNode | undefined
  destroy(): void
}

interface Row {
  readonly node: FileTreeNode
  readonly depth: number
  readonly element: HTMLElement
  readonly childrenHost: HTMLElement
  expanded: boolean
  loaded: boolean
}

export function createFileTree(document: Document, options: FileTreeOptions): FileTree {
  const localizer = withEnglishUiFallback(options.localizer, PRIMITIVES_FILE_TREE_FALLBACK_MESSAGES)
  const root = document.createElement('div')
  root.className = 'modkit-filetree'
  setPart(root, 'filetree')

  const toolbar = document.createElement('div')
  toolbar.className = 'modkit-filetree__toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute(
    'aria-label',
    localizer.text('primitives.treeActions', { label: options.label }),
  )
  setPart(toolbar, 'filetree.toolbar')
  root.append(toolbar)

  const list = document.createElement('div')
  list.className = 'modkit-filetree__list'
  list.setAttribute('role', 'tree')
  list.setAttribute('aria-label', options.label)
  list.tabIndex = 0
  setPart(list, 'filetree.list')
  root.append(list)

  const rows = new Map<string, Row>()
  let order: Row[] = []
  let active: Row | undefined
  const controller = new AbortController()

  const setActive = (row: Row | undefined, focus = true): void => {
    if (active !== undefined) {
      active.element.setAttribute('aria-selected', 'false')
      setState(active.element, [])
      active.element.tabIndex = -1
    }
    active = row
    if (row === undefined) return
    row.element.setAttribute('aria-selected', 'true')
    setState(row.element, ['selected'])
    row.element.tabIndex = 0
    if (focus) row.element.focus()
    options.onSelect?.(row.node)
  }

  /** Visible rows in document order; the keyboard model walks this, not the DOM. */
  const rebuildOrder = (): void => {
    order = [...rows.values()]
      .filter(row => row.element.isConnected && row.element.offsetParent !== null)
      .sort((left, right) => {
        const position = left.element.compareDocumentPosition(right.element)
        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      })
  }

  const renderRow = (node: FileTreeNode, depth: number, host: HTMLElement): Row => {
    const element = document.createElement('div')
    element.className = 'modkit-filetree__node'
    element.setAttribute('role', 'treeitem')
    element.setAttribute('aria-level', String(depth + 1))
    element.setAttribute('aria-selected', 'false')
    element.tabIndex = -1
    element.dataset['nodeId'] = node.id
    if (node.kind !== undefined) element.dataset['kind'] = node.kind
    setPart(element, 'filetree.node')

    const line = document.createElement('div')
    line.className = 'modkit-filetree__row'
    setPart(line, 'filetree.row')
    // C3: indentation travels as a registered token, validated before it reaches the CSSOM.
    setToken(line, 'tree.indent-level', String(depth))
    element.append(line)

    const twisty = document.createElement('span')
    twisty.className = 'modkit-filetree__twisty'
    twisty.setAttribute('aria-hidden', 'true')
    setPart(twisty, 'filetree.twisty')
    twisty.textContent = node.hasChildren ? '›' : ''
    line.append(twisty)

    if (node.icon !== undefined) {
      const icon = document.createElement('span')
      icon.className = 'modkit-filetree__icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = safeViewerText(node.icon, 4)
      setPart(icon, 'filetree.icon')
      line.append(icon)
    }

    const label = document.createElement('span')
    label.className = 'modkit-filetree__label'
    label.textContent = safeViewerText(node.label, 512)
    setPart(label, 'filetree.label')
    line.append(label)

    if (node.badge !== undefined) {
      const badge = document.createElement('span')
      badge.className = 'modkit-filetree__badge'
      badge.textContent = safeViewerText(node.badge, 32)
      setPart(badge, 'filetree.badge')
      line.append(badge)
    }

    for (const action of node.actions ?? []) {
      const control = document.createElement('button')
      control.type = 'button'
      control.className = 'modkit-filetree__action'
      control.textContent = safeViewerText(action.label, 48)
      control.title = safeViewerText(action.title ?? action.label, 160)
      setPart(control, 'filetree.action')
      control.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        options.onAction?.(node, action)
      })
      line.append(control)
    }

    const childrenHost = document.createElement('div')
    childrenHost.className = 'modkit-filetree__children'
    childrenHost.setAttribute('role', 'group')
    childrenHost.hidden = true
    setPart(childrenHost, 'filetree.children')
    element.append(childrenHost)

    const row: Row = { node, depth, element, childrenHost, expanded: false, loaded: false }
    if (node.hasChildren) element.setAttribute('aria-expanded', 'false')

    line.addEventListener('click', () => {
      setActive(row)
      if (node.hasChildren) void toggle(row)
      else options.onActivate?.(node)
    })
    line.addEventListener('dblclick', () => options.onActivate?.(node))

    host.append(element)
    rows.set(node.id, row)
    return row
  }

  const loadInto = async (
    row: Row | undefined,
    host: HTMLElement,
    depth: number,
  ): Promise<void> => {
    const children = await options.loadChildren(row?.node, controller.signal)
    host.replaceChildren()
    if (children.length === 0 && row === undefined) {
      const empty = document.createElement('p')
      empty.className = 'modkit-filetree__empty'
      empty.textContent = localizer.text('primitives.nothingToShow')
      setPart(empty, 'filetree.empty')
      host.append(empty)
      return
    }
    for (const child of children) renderRow(child, depth, host)
    if (row !== undefined) row.loaded = true
    applyFilter()
    rebuildOrder()
  }

  const toggle = async (row: Row): Promise<void> => {
    if (!row.node.hasChildren) return
    row.expanded = !row.expanded
    row.element.setAttribute('aria-expanded', String(row.expanded))
    row.childrenHost.hidden = !row.expanded
    setState(row.element, row.expanded ? ['active'] : [])
    if (row.expanded && !row.loaded) {
      setState(row.element, ['loading'] as StateName[])
      await loadInto(row, row.childrenHost, row.depth + 1)
      setState(row.element, ['active'])
    }
    rebuildOrder()
  }

  function applyFilter(): void {
    const predicate = options.matches
    if (predicate === undefined) {
      for (const row of rows.values()) row.element.hidden = false
      rebuildOrder()
      return
    }
    // A node survives when it matches, or when any descendant already loaded matches.
    const keep = new Set<string>()
    const visit = (row: Row): boolean => {
      const children = [...rows.values()].filter(
        other => other.element.parentElement === row.childrenHost,
      )
      let descendant = false
      for (const child of children) descendant = visit(child) || descendant
      const self = predicate(row.node)
      if (self || descendant) keep.add(row.node.id)
      return self || descendant
    }
    for (const row of rows.values()) {
      if (row.element.parentElement === list) visit(row)
    }
    for (const row of rows.values()) row.element.hidden = !keep.has(row.node.id)
    rebuildOrder()
  }

  list.addEventListener('keydown', event => {
    if (order.length === 0) rebuildOrder()
    const index = active === undefined ? -1 : order.indexOf(active)
    const move = (to: number): void => {
      const next = order[Math.max(0, Math.min(order.length - 1, to))]
      if (next !== undefined) setActive(next)
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(index + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(index - 1)
        break
      case 'ArrowRight':
        event.preventDefault()
        if (active !== undefined && active.node.hasChildren && !active.expanded) void toggle(active)
        else move(index + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        if (active !== undefined && active.expanded) void toggle(active)
        else move(index - 1)
        break
      case 'Home':
        event.preventDefault()
        move(0)
        break
      case 'End':
        event.preventDefault()
        move(order.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (active !== undefined) {
          if (active.node.hasChildren) void toggle(active)
          else options.onActivate?.(active.node)
        }
        break
      default:
        break
    }
  })

  const refresh = async (): Promise<void> => {
    rows.clear()
    active = undefined
    await loadInto(undefined, list, 0)
  }

  return {
    root,
    toolbar,
    refresh,
    collapseAll() {
      for (const row of rows.values()) {
        if (!row.expanded) continue
        row.expanded = false
        row.childrenHost.hidden = true
        row.element.setAttribute('aria-expanded', 'false')
        setState(row.element, [])
      }
      rebuildOrder()
    },
    async expandAll() {
      for (const row of [...rows.values()]) {
        if (row.node.hasChildren && !row.expanded) await toggle(row)
      }
    },
    applyFilter,
    selected: () => active?.node,
    destroy() {
      controller.abort('file-tree-destroyed')
      root.remove()
    },
  }
}
