import type {
  FieldEditable,
  SubjectCandidateProvider,
  TreeDataSource,
  TreeNodeRef,
  ViewerModule,
} from '@modkit/sdk'
import { createToolbar, type ToolbarHandle, type ToolbarSpec } from '../toolbar/index.js'
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
import {
  fieldWriteRefusal,
  mountFieldEditTarget,
  mountInlineField,
} from '../field-write/index.js'
import { renderValueWithSpans } from '../spans/index.js'
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
  /**
   * A toolbar above the tree.
   *
   * The viewer draws it and reports clicks; it does not decide what belongs in it. Which filters a
   * format has is the host's knowledge, and a tree that invented its own would be wrong for every
   * format but the one it was written against. `handle` hands the built toolbar back so the host can
   * set counts and pressed states as its own model changes.
   */
  readonly toolbar?: ToolbarSpec
  readonly onToolbar?: (handle: ToolbarHandle) => void
}

export function createTreeViewer(options: TreeViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TREE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.tree'))
      /*
       * The toolbar sits inside the viewer surface but outside the tree itself: `role="tree"` on the
       * surface would make the buttons children of a tree, which is a lie to a screen reader. So the
       * role moves to the list that actually holds the rows.
       */
      if (options.toolbar !== undefined) {
        const handle = createToolbar(root, options.toolbar)
        scope.cleanup(() => handle.destroy())
        options.onToolbar?.(handle)
      }
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/tree-data-source',
      )
      if (lease === undefined) throw new TypeError('tree binding is unavailable')
      scope.lease(lease)
      const model = new LazyTreeModel(lease.value as TreeDataSource)
      const list = element(root, 'ul', { className: 'modkit-viewer__tree', part: 'tree.list' })
      // The tree is this list, not the surface: a toolbar above it must not be a tree item.
      list.setAttribute('role', 'tree')

      const renderNode = async (
        node: TreeNodeRef,
        parent: HTMLElement,
        nodeScope: ViewerMountScope = scope,
      ): Promise<void> => {
        const facts = await model.facts(node)
        if (nodeScope.signal.aborted) return
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
          /*
           * A value with syntax runs is shown, not replaced by an input.
           *
           * A single-line control renders markup as one flat string, which throws away exactly the
           * structure the codec went to the trouble of describing — a localization entry stops
           * being readable the moment it becomes a text box. So a value that has grammar is drawn
           * with it and turns into the editor when the reader activates it; a value with none, a
           * number or a flag, gets its control straight away, because there is nothing to lose.
           */
          // Narrowed once here so the closure below does not have to re-prove what the branch
          // condition already established.
          const fieldType = facts.type
          const fieldValue = facts.value
          const mountEditor = async (cell: HTMLElement) => {
            const mount = await mountInlineField(cell, {
              label: facts.label,
              type: fieldType,
              value: fieldValue,
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
              signal: nodeScope.signal,
              ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
              ...(options.candidates === undefined ? {} : { candidates: options.candidates }),
              onWritten: () => model.forget(node),
            })
            if (nodeScope.signal.aborted) {
              await mount.unmount()
              return
            }
            const commit = () => void mount.commit()
            cell.addEventListener('change', commit)
            nodeScope.cleanup(() => cell.removeEventListener('change', commit))
            nodeScope.cleanup(() => mount.unmount())
          }

          if (writable && (facts.spans === undefined || facts.spans.length === 0)) {
            const cell = element(row, 'div', { part: 'tree.value' })
            await mountEditor(cell)
          } else if (writable) {
            const cell = element(row, 'div', { part: 'tree.value' })
            renderValueWithSpans(cell, String(facts.value ?? ''), facts.spans)
            cell.tabIndex = 0
            cell.title = 'click to edit'
            const open = () => {
              if (cell.dataset['editing'] === 'true') return
              cell.dataset['editing'] = 'true'
              cell.replaceChildren()
              void mountEditor(cell)
            }
            cell.addEventListener('dblclick', open)
            const onKey = (event: KeyboardEvent) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                open()
              }
            }
            cell.addEventListener('keydown', onKey)
            nodeScope.cleanup(() => {
              cell.removeEventListener('dblclick', open)
              cell.removeEventListener('keydown', onKey)
            })
          } else {
            const cell = element(row, 'div', { part: 'tree.value' })
            renderValueWithSpans(cell, String(facts.value ?? ''), facts.spans)
            cell.title = fieldWriteRefusal(args.descriptor, editable, route) ?? ''
          }
        } else if (facts.preview !== undefined) {
          const cell = element(row, 'div', { part: 'tree.value' })
          // A preview is prose unless the codec described its grammar; then it is drawn as code.
          renderValueWithSpans(cell, facts.preview, facts.spans)
        }

        mountFieldEditTarget(row, facts.editTarget)

        if (!node.hasChildren) return
        const children = element(item, 'ul', { part: 'tree.children' })
        children.hidden = true
        children.setAttribute('role', 'group')
        let loaded = false
        let loading = false
        let cursor: string | undefined
        const seenIds = new Set<string>()
        const seenCursors = new Set<string>()
        const paging = element(children, 'li', { part: 'tree.item' })
        paging.setAttribute('role', 'none')
        paging.hidden = true
        const more = element(paging, 'button', { part: 'tree.label' }) as HTMLButtonElement
        more.type = 'button'
        setViewerText(more, localizer.text('tree.more'))
        const status = element(paging, 'span', { part: 'tree.value' })
        status.setAttribute('role', 'status')
        const loadPage = async () => {
          if (loading || nodeScope.signal.aborted || (loaded && cursor === undefined)) return
          loading = true
          more.disabled = true
          setViewerText(status, '')
          // A failed facts request can retry the whole page without duplicating visible rows.
          const staging = children.ownerDocument.createElement('ul')
          const pageScope = new ViewerMountScope(nodeScope.signal)
          let adopted = false
          try {
            const page = await model.children(node, cursor, nodeScope.signal)
            if (nodeScope.signal.aborted) return
            const ids = new Set(page.items.map(child => child.id))
            if (
              page.items.length > 200 ||
              ids.size !== page.items.length ||
              page.items.some(child => seenIds.has(child.id)) ||
              (page.nextCursor !== undefined &&
                (page.nextCursor === cursor ||
                  seenCursors.has(page.nextCursor) ||
                  page.items.length === 0))
            )
              throw new TypeError('tree source returned a non-progressing page')
            for (const child of page.items) {
              await renderNode(child, staging, pageScope)
              if (nodeScope.signal.aborted) return
            }
            while (staging.firstChild) children.insertBefore(staging.firstChild, paging)
            for (const id of ids) seenIds.add(id)
            if (cursor !== undefined) seenCursors.add(cursor)
            cursor = page.nextCursor
            loaded = true
            nodeScope.cleanup(() => pageScope.close())
            adopted = true
            paging.hidden = cursor === undefined
          } catch {
            if (!nodeScope.signal.aborted) {
              paging.hidden = false
              setViewerText(status, localizer.text('tree.loadFailed'))
            }
          } finally {
            if (!adopted) await pageScope.close()
            loading = false
            if (!nodeScope.signal.aborted) more.disabled = false
          }
        }
        const expand = () => {
          children.hidden = !children.hidden
          item.setAttribute('aria-expanded', String(!children.hidden))
          if (!children.hidden && !loaded) void loadPage()
        }
        const next = () => void loadPage()
        more.addEventListener('click', next)
        nodeScope.cleanup(() => more.removeEventListener('click', next))
        label.addEventListener('click', expand)
        nodeScope.cleanup(() => label.removeEventListener('click', expand))
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
