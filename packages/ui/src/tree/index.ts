import type { TreeDataSource, TreeNodeRef, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export class LazyTreeModel {
  readonly #facts = new Map<string, Awaited<ReturnType<TreeDataSource['facts']>>>()
  constructor(readonly source: TreeDataSource) {}

  root(): Promise<TreeNodeRef> {
    return this.source.root()
  }

  async facts(node: TreeNodeRef) {
    const existing = this.#facts.get(node.id)
    if (existing !== undefined) return existing
    const value = await this.source.facts(node)
    this.#facts.set(node.id, value)
    return value
  }

  children(node: TreeNodeRef, cursor?: string, signal?: AbortSignal) {
    return this.source.children(
      node,
      { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      signal,
    )
  }
}

export const treeViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Tree viewer')
    root.setAttribute('role', 'tree')
    const lease = await unknownSourceLease(args.sources, args.slot, 'common.view/tree-data-source')
    if (lease === undefined) throw new TypeError('tree binding is unavailable')
    scope.lease(lease)
    const model = new LazyTreeModel(lease.value as TreeDataSource)
    const list = element(root, 'ul', { className: 'modkit-viewer__tree' })
    list.setAttribute('role', 'group')

    const renderNode = async (node: TreeNodeRef, parent: HTMLElement) => {
      const facts = await model.facts(node)
      const item = element(parent, 'li')
      item.setAttribute('role', 'treeitem')
      item.dataset['nodeId'] = node.id
      item.setAttribute('aria-expanded', node.hasChildren ? 'false' : 'undefined')
      const label = element(item, 'button', { text: facts.label }) as HTMLButtonElement
      label.type = 'button'
      label.disabled = !node.hasChildren
      if (facts.preview !== undefined) label.title = facts.preview
      const children = element(item, 'ul')
      children.hidden = true
      children.setAttribute('role', 'group')
      let loaded = false
      const expand = async () => {
        if (!loaded) {
          const page = await model.children(node, undefined, scope.signal)
          for (const child of page.items) await renderNode(child, children)
          loaded = true
        }
        children.hidden = !children.hidden
        item.setAttribute('aria-expanded', String(!children.hidden))
      }
      label.addEventListener('click', expand)
      scope.cleanup(() => label.removeEventListener('click', expand))
      setViewerText(label, facts.label)
    }

    await renderNode(await model.root(), list)
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})

export default treeViewer
