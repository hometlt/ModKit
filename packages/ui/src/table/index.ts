import type {
  CellCoord,
  KnowledgeHit,
  Page,
  Row,
  SubjectCandidateProvider,
  TableDataSource,
  ViewerModule,
} from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  setPart,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type FieldEditorRegistry } from '../field-editor/index.js'
import { fieldWriteRefusal, mountInlineField } from '../field-write/index.js'
import { renderValueWithSpans } from '../spans/index.js'
import { type UiLocalizationOptions } from '../localization/index.js'
import { TABLE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const TABLE_PAGE_ROWS = 200
export const TABLE_KNOWLEDGE_SUMMARY_CHARACTERS = 512
export const TABLE_KNOWLEDGE_SOURCE_TITLE_CHARACTERS = 160
export const TABLE_KNOWLEDGE_MISSING = 'Description is not available yet.'

export class LazyTableModel {
  #cursor: string | undefined
  constructor(readonly source: TableDataSource) {}

  shape() {
    return this.source.shape()
  }

  cell(coord: CellCoord, signal?: AbortSignal) {
    return this.source.cell(coord, signal)
  }

  async first(from = 0, signal?: AbortSignal): Promise<Page<Row>> {
    const page = await this.source.rows({ kind: 'range', from, count: TABLE_PAGE_ROWS }, signal)
    this.#cursor = page.nextCursor
    return page
  }

  async next(signal?: AbortSignal): Promise<Page<Row> | undefined> {
    if (this.#cursor === undefined) return undefined
    const page = await this.source.rows(
      { kind: 'cursor', cursor: this.#cursor, count: TABLE_PAGE_ROWS },
      signal,
    )
    this.#cursor = page.nextCursor
    return page
  }
}

export interface TableViewerOptions extends UiLocalizationOptions {
  readonly fieldEditors?: FieldEditorRegistry
  readonly candidates?: SubjectCandidateProvider
  /**
   * Draw each cell's syntax runs, when the codec publishes them.
   *
   * Off by default, and deliberately a decision rather than a side effect: `rows()` returns display
   * text and the runs live in `cell()`, so highlighting costs one call per cell the reader touches.
   * A host that wants it says so; a host that does not keeps the calls it makes today.
   */
  readonly highlight?: boolean
}

export function createTableViewer(options: TableViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TABLE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.table'))
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/table-data-source',
      )
      if (lease === undefined) throw new TypeError('table binding is unavailable')
      scope.lease(lease)
      const model = new LazyTableModel(lease.value as TableDataSource)
      const table = element(root, 'table', {
        className: 'modkit-viewer__table',
        part: 'table',
      }) as HTMLTableElement
      const caption = table.createCaption()
      setPart(caption, 'table.caption')
      const shape = await model.shape()
      setViewerText(
        caption,
        localizer.text('viewer.tableShape', { rows: shape.rows, columns: shape.columns }),
      )
      const body = table.createTBody()
      setPart(body, 'table.body')
      const knowledge = element(root, 'aside', {
        className: 'modkit-viewer__table-knowledge',
        part: 'viewer.status',
        role: 'status',
        text: localizer.text('card.descriptionUnavailable'),
      })
      knowledge.setAttribute('aria-live', 'polite')
      knowledge.dataset['knowledgeState'] = 'missing'
      let lookupRevision = 0
      let lookupController: AbortController | undefined

      const cancelLookup = (reason: string): void => {
        lookupRevision += 1
        lookupController?.abort(reason)
        lookupController = undefined
      }
      scope.cleanup(() => cancelLookup('viewer-unmounted'))

      const showMissingKnowledge = (): void => {
        knowledge.dataset['knowledgeState'] = 'missing'
        knowledge.replaceChildren()
        setViewerText(knowledge, localizer.text('card.descriptionUnavailable'))
      }

      const directSource = (
        hit: KnowledgeHit,
      ): { readonly title: string; readonly url: URL } | undefined => {
        for (const source of hit.entry.sources) {
          if (source.url === undefined) continue
          try {
            const url = new URL(source.url)
            if (url.protocol === 'https:') return { title: source.title, url }
          } catch {
            // Untrusted catalog implementations can still return malformed URLs; omit them.
          }
        }
        return undefined
      }

      const showKnowledge = (hit: KnowledgeHit): void => {
        knowledge.dataset['knowledgeState'] = 'resolved'
        knowledge.replaceChildren()
        const summary = knowledge.ownerDocument.createElement('span')
        setViewerText(summary, hit.entry.summary, TABLE_KNOWLEDGE_SUMMARY_CHARACTERS)
        knowledge.append(summary)
        const source = directSource(hit)
        if (source === undefined) return
        knowledge.append(knowledge.ownerDocument.createTextNode(' '))
        const link = knowledge.ownerDocument.createElement('a')
        link.href = source.url.href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.referrerPolicy = 'no-referrer'
        setViewerText(link, source.title, TABLE_KNOWLEDGE_SOURCE_TITLE_CHARACTERS)
        knowledge.append(link)
      }

      const inspectCell = (coord: CellCoord): void => {
        if (scope.signal.aborted) return
        cancelLookup('table-cell-changed')
        const revision = lookupRevision
        const catalog = args.knowledge
        if (catalog === undefined) {
          showMissingKnowledge()
          return
        }
        const controller = new AbortController()
        lookupController = controller
        knowledge.dataset['knowledgeState'] = 'loading'
        knowledge.replaceChildren()
        setViewerText(knowledge, localizer.text('card.loadingDescription'))
        void (async () => {
          try {
            const facts = await model.cell(coord, controller.signal)
            if (controller.signal.aborted || revision !== lookupRevision) return
            if (facts.knowledgeTarget === undefined) {
              showMissingKnowledge()
              return
            }
            const page = await catalog.resolve(
              { target: facts.knowledgeTarget, locales: [], limit: 1 },
              controller.signal,
            )
            if (controller.signal.aborted || revision !== lookupRevision) return
            const hit = page.items[0]
            if (hit === undefined) showMissingKnowledge()
            else showKnowledge(hit)
          } catch {
            if (!controller.signal.aborted && revision === lookupRevision) showMissingKnowledge()
          } finally {
            if (revision === lookupRevision) lookupController = undefined
          }
        })()
      }

      /**
       * Turn one cell into a control, or say why it cannot become one.
       *
       * The cell keeps its display text until the codec accepts the write. That ordering matters:
       * showing the typed value immediately and reverting on refusal is how a surface ends up
       * lying about what is in the file.
       */
      const beginEdit = async (cell: HTMLTableCellElement, coord: CellCoord): Promise<void> => {
        if (cell.dataset['editing'] === 'true') return
        const facts = await model.cell(coord, scope.signal)
        if (scope.signal.aborted) return
        if (facts.type === undefined) return
        const refusal = fieldWriteRefusal(args.descriptor, facts.editable, {
          ...(args.commit === undefined ? {} : { commit: args.commit }),
          ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
        })
        if (refusal !== undefined) {
          cell.title = refusal
          return
        }
        const previous = cell.textContent ?? ''
        cell.dataset['editing'] = 'true'
        cell.replaceChildren()
        const header = shape.header?.[coord.column]
        const mount = await mountInlineField(cell, {
          label: header ?? String(coord.column),
          type: facts.type,
          value: facts.typedValue ?? facts.value,
          ...(facts.unit === undefined ? {} : { unit: facts.unit }),
          ...(facts.editable === undefined ? {} : { editable: facts.editable }),
          target: {
            groupId: 'table',
            key: header ?? String(coord.column),
            path: [String(coord.row), String(coord.column)],
          },
          descriptor: args.descriptor,
          operations: args.operations,
          ...(args.commit === undefined ? {} : { commit: args.commit }),
          ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
          signal: scope.signal,
          ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
          ...(options.candidates === undefined ? {} : { candidates: options.candidates }),
        })
        const finish = async (write: boolean) => {
          const accepted = write ? await mount.commit() : false
          if (!accepted && write) return // the status line inside the field says why; stay open
          const settled = accepted ? await model.cell(coord, scope.signal) : undefined
          await mount.unmount()
          delete cell.dataset['editing']
          setViewerText(cell, settled?.value ?? previous)
        }
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void finish(true)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            void finish(false)
          }
        }
        cell.addEventListener('keydown', onKey)
        scope.cleanup(() => cell.removeEventListener('keydown', onKey))
      }

      const render = (rows: readonly Row[]) => {
        cancelLookup('table-page-changed')
        showMissingKnowledge()
        body.replaceChildren()
        for (const row of rows) {
          const tr = body.insertRow()
          setPart(tr, 'table.row')
          tr.dataset['row'] = String(row.index)
          for (const [column, value] of row.cells.entries()) {
            const cell = tr.insertCell()
            setPart(cell, 'table.cell')
            cell.tabIndex = 0
            setViewerText(cell, value)
            const coord = { row: row.index, column }
            const inspect = () => inspectCell(coord)
            cell.addEventListener('focus', inspect)
            cell.addEventListener('mouseenter', inspect)
            if (options.highlight === true) {
              // Once per cell: the runs do not change until the value does, and a re-render replaces
              // the whole body anyway.
              const highlight = () => {
                if (cell.dataset['highlighted'] === 'true' || cell.dataset['editing'] === 'true') {
                  return
                }
                cell.dataset['highlighted'] = 'true'
                void model
                  .cell(coord, scope.signal)
                  .then(facts => {
                    if (facts.spans === undefined || cell.dataset['editing'] === 'true') return
                    renderValueWithSpans(cell, facts.value, facts.spans)
                  })
                  .catch(() => undefined)
              }
              cell.addEventListener('focus', highlight)
              cell.addEventListener('mouseenter', highlight)
            }
            /*
             * Editing is on demand, not on render. `rows()` returns display text only; the type and
             * the write declaration live in `cell(coord)`, one call per cell. A localisation table
             * of eleven thousand rows must not make eleven thousand of those calls to draw itself,
             * so the facts are fetched when the reader actually asks to edit that one cell.
             */
            const begin = () => void beginEdit(cell, coord)
            cell.addEventListener('dblclick', begin)
            const onKey = (event: KeyboardEvent) => {
              if (event.key === 'Enter' && cell.dataset['editing'] !== 'true') {
                event.preventDefault()
                begin()
              }
            }
            cell.addEventListener('keydown', onKey)
            scope.cleanup(() => {
              cell.removeEventListener('dblclick', begin)
              cell.removeEventListener('keydown', onKey)
            })
          }
        }
      }
      const first = await model.first(0, scope.signal)
      render(first.items)
      const next = element(root, 'button', {
        text: localizer.text('viewer.nextRows'),
        part: 'table.next',
      }) as HTMLButtonElement
      next.type = 'button'
      next.disabled = first.nextCursor === undefined
      const advance = async () => {
        const page = await model.next(scope.signal)
        if (page === undefined) {
          next.disabled = true
          return
        }
        render(page.items)
        next.disabled = page.nextCursor === undefined
      }
      next.addEventListener('click', advance)
      scope.cleanup(() => next.removeEventListener('click', advance))
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        cancelLookup('viewer-updated')
        showMissingKnowledge()
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const tableViewer: ViewerModule = createTableViewer()

export default tableViewer
