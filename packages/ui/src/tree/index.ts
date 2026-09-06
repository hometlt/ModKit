import type {
  FieldEditable,
  SubjectCandidateProvider,
  TreeDataSource,
  TreeNodeRef,
  ViewerModule,
} from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type FieldEditorRegistry } from '../field-editor/index.js'
import { fieldWriteRefusal, mountInlineField } from '../field-write/index.js'
import { type UiLocalizationOptions } from '../localization/index.js'
import { TREE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

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

  /** Drop one node's cached facts so the next read reflects a write the codec accepted. */
  forget(node: TreeNodeRef): void {
    this.#facts.delete(node.id)
  }

  children(node: TreeNodeRef, cursor?: string, signal?: AbortSignal) {
    return this.source.children(
      node,
      { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      signal,
    )
  }
}

/**
 * The disclosure chevron, drawn as the glyph Monaco uses for folding a range.
 *
 * Monaco renders folding controls from the codicon font; a viewer that must work in any host cannot
 * assume that font is loaded, so the same path is inlined as SVG. Pointing right and rotating on
 * expand keeps one element and one transition, which is also how the archive tree behaves.
 */
function chevron(document: Document): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('d', 'M5.7 13.7L5 13l4.6-5L5 3.7l.7-.7 5 5v.7l-5 5z')
  svg.append(path)
  return svg
}

export interface TreeViewerOptions extends UiLocalizationOptions {
  readonly fieldEditors?: FieldEditorRegistry
  readonly candidates?: SubjectCandidateProvider
}

export function createTreeViewer(options: TreeViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TREE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.tree'))
      root.setAttribute('role', 'tree')
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/tree-data-source',
      )
      if (lease === undefined) throw new TypeError('tree binding is unavailable')
      scope.lease(lease)
      const model = new LazyTreeModel(lease.value as TreeDataSource)
      const list = element(root, 'ul', { className: 'modkit-viewer__tree', part: 'tree.list' })
      list.setAttribute('role', 'group')

      const renderNode = async (node: TreeNodeRef, parent: HTMLElement) => {
        const facts = await model.facts(node)
        const item = element(parent, 'li', { part: 'tree.item' })
        item.setAttribute('role', 'treeitem')
        item.dataset['nodeId'] = node.id
        if (node.hasChildren) item.setAttribute('aria-expanded', 'false')

        /*
         * The row is the layout unit: chevron, label, value. The chevron follows the same shape as
         * the archive tree's twisty — one disclosure glyph everywhere — and a leaf keeps the slot
         * so labels stay on one optical column instead of stepping left at every leaf.
         */
        const row = element(item, 'div', { part: 'tree.row' })
        const key = element(row, 'div', { part: 'tree.key' })
        const twisty = element(key, 'span', { part: 'tree.twisty' })
        twisty.setAttribute('aria-hidden', 'true')
        if (node.hasChildren) twisty.append(chevron(twisty.ownerDocument))

        const label = element(key, 'button', { part: 'tree.label' }) as HTMLButtonElement
        label.type = 'button'
        label.disabled = !node.hasChildren
        if (facts.preview !== undefined) label.title = facts.preview
        setViewerText(label, facts.label)

        /*
         * The value column shows what the node holds, and becomes a control when the codec says the
         * value is writable. Two separate sources feed it: `value`, which is typed and may be
         * edited, and `preview`, which is prose for a reader. Preferring the typed one keeps a
         * number rendering as a number; falling back to the preview keeps every existing codec
         * looking exactly as it did before this column existed.
         */
        const editable: FieldEditable | undefined = facts.editable
        if (facts.value !== undefined && facts.type !== undefined) {
          const route = {
            ...(args.commit === undefined ? {} : { commit: args.commit }),
            ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
          }
          const writable = fieldWriteRefusal(args.descriptor, editable, route) === undefined
          if (writable) {
            const cell = element(row, 'div', { part: 'tree.value' })
            const mount = await mountInlineField(cell, {
              label: facts.label,
              type: facts.type,
              value: facts.value,
              ...(facts.unit === undefined ? {} : { unit: facts.unit }),
              ...(editable === undefined ? {} : { editable }),
              target: {
                groupId: 'tree',
                key: facts.label,
                ...(facts.semanticPath === undefined ? {} : { path: facts.semanticPath }),
              },
              descriptor: args.descriptor,
              operations: args.operations,
              ...route,
              signal: scope.signal,
              ...(options.fieldEditors === undefined
                ? {}
                : { fieldEditors: options.fieldEditors }),
              ...(options.candidates === undefined ? {} : { candidates: options.candidates }),
              onWritten: () => model.forget(node),
            })
            const commit = () => void mount.commit()
            cell.addEventListener('change', commit)
            scope.cleanup(() => cell.removeEventListener('change', commit))
            scope.cleanup(() => void mount.unmount())
          } else {
            const cell = element(row, 'div', { part: 'tree.value' })
            setViewerText(cell, facts.value, 4096)
            cell.title = fieldWriteRefusal(args.descriptor, editable, route) ?? ''
          }
        } else if (facts.preview !== undefined) {
          const cell = element(row, 'div', { part: 'tree.value' })
          setViewerText(cell, facts.preview, 4096)
        }

        const children = element(item, 'ul', { part: 'tree.children' })
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
      }

      await renderNode(await model.root(), list)
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const treeViewer: ViewerModule = createTreeViewer()

export default treeViewer
