/**
 * The archive explorer's gallery pane, click/double-click/Enter open semantics, the "Open in Tab"
 * context menu item and lazy hierarchical listing. The document is a fake because this package's
 * unit tests run in Node; the browser end is covered by the e2e suite (see `template-canvas.test.ts`
 * and `workbench.test.ts` for the same pattern).
 */
import { describe, expect, it } from 'vitest'
import type { NamespaceEntry, NamespaceEntrySource } from '@modkit/sdk'
import { createArchiveViewer, type ArchiveViewerOptions } from '../src/archive/index.js'

// ---------------------------------------------------------------------------------- fake DOM

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<(event: never) => void>>()
  addEventListener(type: string, handler: (event: never) => void): void {
    let set = this.listeners.get(type)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(handler)
  }
  removeEventListener(type: string, handler: (event: never) => void): void {
    this.listeners.get(type)?.delete(handler)
  }
  dispatchEvent(event: { readonly type: string }): boolean {
    for (const handler of [...(this.listeners.get(event.type) ?? [])]) handler(event as never)
    return true
  }
}

class FakeElement extends FakeEventTarget {
  readonly ownerDocument: FakeDocument
  parentNode: FakeElement | null = null
  readonly childNodes: FakeElement[] = []
  private readonly attrs = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  readonly style = {
    props: new Map<string, string>(),
    setProperty(name: string, value: string): void {
      this.props.set(name, value)
    },
    removeProperty(name: string): void {
      this.props.delete(name)
    },
  }
  className = ''
  title = ''
  type = ''
  hidden = false
  value = ''
  placeholder = ''
  textContent = ''

  constructor(document: FakeDocument) {
    super()
    this.ownerDocument = document
  }

  get children(): FakeElement[] {
    return this.childNodes
  }

  get firstElementChild(): FakeElement | null {
    return this.childNodes[0] ?? null
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentNode = this
      this.childNodes.push(node)
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes.length = 0
    this.append(...nodes)
  }

  remove(): void {
    const at = this.parentNode?.childNodes.indexOf(this) ?? -1
    if (at >= 0) this.parentNode?.childNodes.splice(at, 1)
    this.parentNode = null
  }

  replaceWith(...nodes: FakeElement[]): void {
    const parent = this.parentNode
    if (parent === null) return
    const at = parent.childNodes.indexOf(this)
    if (at < 0) return
    for (const node of nodes) node.parentNode = parent
    parent.childNodes.splice(at, 1, ...nodes)
    this.parentNode = null
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value))
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }

  contains(node: unknown): boolean {
    let cursor = node as FakeElement | null
    while (cursor !== null) {
      if ((cursor as unknown) === this) return true
      cursor = cursor.parentNode
    }
    return false
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }

  focus(): void {}
  select(): void {}
  setPointerCapture(): void {}
}

class FakeDocument extends FakeEventTarget {
  activeElement: FakeElement | null = null
  createElement(): FakeElement {
    return new FakeElement(this)
  }
}

/** Every descendant (this node included) carrying the given `data-mk-part`, depth first. */
function partsIn(root: FakeElement, part: string): FakeElement[] {
  const found: FakeElement[] = []
  if (root.getAttribute('data-mk-part') === part) found.push(root)
  for (const child of root.children) found.push(...partsIn(child, part))
  return found
}

function firstPart(root: FakeElement, part: string): FakeElement | undefined {
  return partsIn(root, part)[0]
}

/** A rendered tree row (file or folder) by its visible name. */
function rowNamed(root: FakeElement, name: string): FakeElement | undefined {
  return partsIn(root, 'archive.row').find(
    button => firstPart(button, 'archive.name')?.textContent === name,
  )
}

/** Flushes fire-and-forget gallery refreshes and folder expansions started by a dispatched event. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const CLICK = { type: 'click' }
const DBLCLICK = { type: 'dblclick' }
const ENTER = { type: 'keydown', key: 'Enter', shiftKey: false, preventDefault(): void {} }
const CONTEXTMENU = {
  type: 'contextmenu',
  clientX: 1,
  clientY: 1,
  preventDefault(): void {},
  stopPropagation(): void {},
}

// ---------------------------------------------------------------------------------- fixtures

const entry = (id: string, path: string, kind: 'file' | 'directory' = 'file'): NamespaceEntry =>
  ({ id, path, name: path.split('/').filter(Boolean).at(-1), kind, revision: 'r' }) as never

async function mountArchive(
  source: NamespaceEntrySource,
  overrides: Partial<ArchiveViewerOptions> = {},
): Promise<{ readonly root: FakeElement }> {
  const document = new FakeDocument()
  const container = document.createElement()
  const viewer = createArchiveViewer(overrides)
  const sources = {
    async get() {
      return { value: source, async release() {} }
    },
    async getUnknown() {
      return undefined
    },
  }
  const slot = {
    slotId: 'stage',
    kind: 'stage',
    contributionId: 'test/archive',
    extensionId: 'test',
    priority: 0,
    bindings: [{ bindingId: 'source', contract: 'common.view/namespace-entry-source', major: 1 }],
  }
  await viewer.mount({
    container,
    descriptor: {} as never,
    slot: slot as never,
    sources: sources as never,
    operations: {} as never,
  })
  const root = container.children[0]
  if (root === undefined) throw new Error('archive viewer did not mount a surface')
  return { root }
}

describe('archive viewer', () => {
  it('builds the gallery from accepted files grouped by folder; click selects, dblclick and Enter open', async () => {
    const items = [
      entry('a', 'tex/a.dds'),
      entry('b', 'tex/b.dds'),
      entry('c', 'root.dds'),
      entry('e', 'root2.dds'),
      entry('d', 'tex/readme.txt'),
    ]
    const source: NamespaceEntrySource = {
      async list() {
        return { items }
      },
      async openEntry(id) {
        return { value: { id, uri: `mem://${id}` } as never, async release() {} }
      },
    }
    const opened: string[] = []
    const { root } = await mountArchive(source, {
      openEntry: found => {
        opened.push(found.id)
      },
      gallery: {
        accepts: found => found.name.endsWith('.dds'),
        thumbnail: async () => undefined,
      },
    })
    await flush()

    const groups = partsIn(root, 'media-shell.gallery-group').map(group => {
      const header = firstPart(group, 'media-shell.gallery-group-header')
      const label =
        header === undefined ? undefined : firstPart(header, 'media-shell.gallery-label')?.textContent
      const labels = partsIn(group, 'media-shell.gallery-item')
        .map(cell => firstPart(cell, 'media-shell.gallery-label')?.textContent)
        .sort()
      return { label, labels }
    })
    expect(groups.find(group => group.label === 'tex')?.labels).toEqual(['a.dds', 'b.dds'])
    expect(groups.find(group => group.label === 'Archive')?.labels).toEqual(['root.dds', 'root2.dds'])
    expect(partsIn(root, 'media-shell.gallery-item')).toHaveLength(4) // readme.txt is not accepted

    const rowRoot = rowNamed(root, 'root.dds')
    if (rowRoot === undefined) throw new Error('row not found')
    rowRoot.dispatchEvent(CLICK)
    expect(opened).toEqual([]) // a single click must not open a tab
    await flush()
    const cellRoot = partsIn(root, 'media-shell.gallery-item').find(
      cell => firstPart(cell, 'media-shell.gallery-label')?.textContent === 'root.dds',
    )
    expect(cellRoot?.getAttribute('aria-current')).toBe('true') // but it does mark the gallery item active

    rowRoot.dispatchEvent(DBLCLICK)
    expect(opened).toEqual(['c'])

    const rowRoot2 = rowNamed(root, 'root2.dds')
    if (rowRoot2 === undefined) throw new Error('row not found')
    rowRoot2.dispatchEvent(ENTER)
    expect(opened).toEqual(['c', 'e'])
  })

  it('offers only "Open in Tab" when openEntry is given without act, and the menu item opens the file', async () => {
    const source: NamespaceEntrySource = {
      async list() {
        return { items: [entry('a', 'a.txt')] }
      },
      async openEntry(id) {
        return { value: { id, uri: `mem://${id}` } as never, async release() {} }
      },
    }
    const opened: string[] = []
    const { root } = await mountArchive(source, {
      openEntry: found => {
        opened.push(found.id)
      },
    })
    const rowA = rowNamed(root, 'a.txt')
    if (rowA === undefined) throw new Error('row not found')
    rowA.dispatchEvent(CONTEXTMENU)
    const menuItems = partsIn(root, 'explorer.tabmenu-item')
    expect(menuItems).toHaveLength(1)
    expect(menuItems[0]?.textContent).toBe('Open in Tab')
    menuItems[0]?.dispatchEvent(CLICK)
    expect(opened).toEqual(['a'])
  })

  it('lists the root via children() and fetches a folder\'s children only once it is expanded', async () => {
    const calls: string[] = []
    const source: NamespaceEntrySource = {
      async list() {
        throw new Error('list must not be called when children() exists')
      },
      async children(path: string) {
        calls.push(path)
        if (path === '') {
          return { items: [entry('dir', 'dir', 'directory'), entry('root-file', 'root.txt')] }
        }
        if (path === 'dir') return { items: [entry('nested', 'dir/nested.txt')] }
        return { items: [] }
      },
      async openEntry(id) {
        return { value: { id, uri: `mem://${id}` } as never, async release() {} }
      },
    }
    const { root } = await mountArchive(source)
    expect(calls).toEqual([''])
    expect(rowNamed(root, 'nested.txt')).toBeUndefined()

    const folderRow = rowNamed(root, 'dir')
    if (folderRow === undefined) throw new Error('folder row not found')
    folderRow.dispatchEvent(CLICK)
    await flush()
    expect(calls).toEqual(['', 'dir'])
    expect(rowNamed(root, 'nested.txt')).toBeDefined()
  })
})
