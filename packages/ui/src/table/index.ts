import type {
  AnyDescriptor,
  AssetOperationId,
  CellCoord,
  JsonValue,
  KnowledgeHit,
  Page,
  Row,
  SubjectCandidateProvider,
  TableDataSource,
  TableValueCompletion,
  TableValueHighlight,
  ViewerModule,
  ViewerWorkspaceDocument,
} from '@modkit/sdk'
import { createToolbar, type ToolbarHandle, type ToolbarSpec } from '../toolbar/index.js'
import {
  createSurface,
  createViewerMount,
  setPart,
  defineViewerModule,
  element,
  invokeOperation,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { attachValueAssist } from './value-assist.js'
import { type FieldEditorRegistry } from '../field-editor/index.js'
import { fieldWriteRefusal, mountFieldEditTarget, mountInlineField } from '../field-write/index.js'
import { renderValueWithSpans } from '../spans/index.js'
import { type UiLocalizationOptions } from '../localization/index.js'
import { TABLE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import { mountVariantTable, type VariantTable } from './variants.js'
import type { GameTemplateImageResolver } from '../template/index.js'

export const TABLE_PAGE_ROWS = 200
export const TABLE_KNOWLEDGE_SUMMARY_CHARACTERS = 512
export const TABLE_KNOWLEDGE_SOURCE_TITLE_CHARACTERS = 160
export const TABLE_KNOWLEDGE_MISSING = 'Description is not available yet.'
/** Rows and columns an arrow key moves the focus between cells. */
const CELL_STEPS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

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
   * On for variant tables by default: `rows()` returns display
   * text and the runs live in `cell()`, so highlighting costs one call per cell the reader touches.
   * Other tables opt in. A host may explicitly disable it for either kind of table.
   */
  readonly highlight?: boolean
  /**
   * A toolbar above the table.
   *
   * Same contract as the tree's: the viewer draws what the host specifies and reports clicks, so a
   * format contributes its own filters without the table learning about any of them.
   */
  readonly toolbar?: ToolbarSpec
  readonly onToolbar?: (handle: ToolbarHandle) => void
  /**
   * Called after a write this table committed. The open session is pinned to the old revision, so
   * a host that can reopens the subject and answers `true`; otherwise the table stops offering
   * writes and says why, instead of letting the next one fail as a conflict.
   */
  readonly onCommitted?: (descriptor: AnyDescriptor) => boolean | Promise<boolean>
  /** Pixels for the inline images a rendered value names; the host resolves the logical ids. */
  readonly images?: GameTemplateImageResolver
}

export function createTableViewer(options: TableViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TABLE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.table'))
      if (options.toolbar !== undefined) {
        const handle = createToolbar(root, options.toolbar)
        scope.cleanup(() => handle.destroy())
        options.onToolbar?.(handle)
      }
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
      const variantMode = shape.columnInfo?.some(column => column.role === 'variant') === true
      if (shape.header !== undefined) {
        const head = table.createTHead().insertRow()
        setPart(head, 'table.head')
        if (variantMode) head.append(table.ownerDocument.createElement('th'))
        for (const label of shape.header) {
          const th = table.ownerDocument.createElement('th')
          th.scope = 'col'
          setViewerText(th, label)
          head.append(th)
        }
      }
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
      const editTarget = element(root, 'aside', {
        className: 'modkit-viewer__table-edit-target',
        part: 'viewer.status',
      })
      editTarget.hidden = true
      const clearEditTarget = (): void => {
        editTarget.replaceChildren()
        editTarget.hidden = true
      }
      let variants: VariantTable | undefined
      /** Why this table no longer writes, once a commit left its session behind. */
      let stale: string | undefined
      const activeEdits = new Set<() => Promise<void>>()
      /** Open editors of draft cells: a save first puts what they hold into the draft. */
      const openDrafts = new Set<() => Promise<void>>()
      scope.cleanup(async () => {
        for (const dispose of activeEdits) await dispose()
      })
      const committed = async (): Promise<void> => {
        const reopened = (await options.onCommitted?.(args.descriptor)) === true
        if (!reopened) stale = localizer.text('table.stale')
      }
      /** The documents around the subject, read once and passed to the codec's value operations. */
      let surroundings: Promise<readonly ViewerWorkspaceDocument[] | undefined> | undefined
      const documents = () =>
        (surroundings ??=
          args.workspaceDocuments === undefined
            ? Promise.resolve(undefined)
            : args.workspaceDocuments.read({ signal: scope.signal }).then(
                answer => answer.documents,
                () => undefined,
              ))
      /** A codec's JSON answer, or nothing when it refuses; value help is never worth an error. */
      const answer = async <T>(
        operation: AssetOperationId,
        input: JsonValue,
        signal: AbortSignal,
      ): Promise<T | undefined> => {
        const result = await invokeOperation(args.descriptor, args.operations, operation, input, {
          signal,
        })
        return result.state === 'ok' && result.output.kind === 'json'
          ? (result.output.value as unknown as T)
          : undefined
      }
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
        clearEditTarget()
        const revision = lookupRevision
        const controller = new AbortController()
        lookupController = controller
        const catalog = args.knowledge
        if (catalog !== undefined) {
          knowledge.dataset['knowledgeState'] = 'loading'
          knowledge.replaceChildren()
          setViewerText(knowledge, localizer.text('card.loadingDescription'))
        }
        void (async () => {
          try {
            const facts = await model.cell(coord, controller.signal)
            if (controller.signal.aborted || revision !== lookupRevision) return
            editTarget.replaceChildren()
            const target = mountFieldEditTarget(editTarget, facts.editTarget)
            editTarget.hidden = target === undefined
            if (catalog === undefined) {
              showMissingKnowledge()
              return
            }
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
      /** The cell drawn at `coord` now, in a variant table, whose rows start with the selection. */
      const drawnCell = (coord: CellCoord) =>
        body.querySelector<HTMLTableCellElement>(
          `tr[data-row="${coord.row}"] > td:nth-child(${coord.column + 2})`,
        )
      /** The value cell `rows` rows or `columns` columns away from `cell`, as drawn now. */
      const besideCell = (
        cell: HTMLTableCellElement,
        rows: number,
        columns: number,
      ): HTMLTableCellElement | undefined => {
        const isValue = (item: Element | null | undefined): item is HTMLTableCellElement =>
          item instanceof HTMLTableCellElement && item.dataset['mkPart'] === 'table.cell'
        const row = cell.parentElement
        if (rows !== 0) {
          const next = rows > 0 ? row?.nextElementSibling : row?.previousElementSibling
          const target =
            next instanceof HTMLTableRowElement ? next.cells[cell.cellIndex] : undefined
          return isValue(target) ? target : undefined
        }
        let target = columns > 0 ? cell.nextElementSibling : cell.previousElementSibling
        while (target !== null && !isValue(target))
          target = columns > 0 ? target.nextElementSibling : target.previousElementSibling
        return isValue(target) ? target : undefined
      }
      const beginEdit = async (cell: HTMLTableCellElement, coord: CellCoord): Promise<void> => {
        if (cell.dataset['editing'] === 'true') return
        // One draft cell editor at a time: the open one keeps its value, as leaving a cell does, and
        // the page is drawn again, so the cell asked for is the one now drawn at its place.
        if (openDrafts.size > 0 && variants?.drafts(coord.column) === true) {
          for (const keep of [...openDrafts]) await keep()
          const drawn = drawnCell(coord)
          if (drawn === null) return
          cell = drawn
        }
        const facts = await model.cell(coord, scope.signal)
        if (scope.signal.aborted || !body.contains(cell) || cell.dataset['editing'] === 'true')
          return
        if (facts.type === undefined) return
        if (stale !== undefined) {
          cell.title = stale
          return
        }
        const refusal =
          fieldWriteRefusal(args.descriptor, facts.editable, {
            ...(args.commit === undefined ? {} : { commit: args.commit }),
            ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
          }) ?? variants?.refusal(coord.column)
        if (refusal !== undefined) {
          cell.title = refusal
          return
        }
        // A locale value of a table with a draft is edited there and written by Save.
        const drafting = variants?.drafts(coord.column) === true
        // What was drawn — highlighted or rendered — comes back as it was when the edit is dropped.
        const previous = [...cell.childNodes]
        let written: string | undefined
        cell.dataset['editing'] = 'true'
        cell.replaceChildren()
        const header = shape.header?.[coord.column]
        const mount = await mountInlineField(cell, {
          label: header ?? String(coord.column),
          type: facts.type,
          value:
            (drafting ? variants?.value(coord.row, coord.column) : undefined) ??
            facts.typedValue ??
            facts.value,
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
          onWritten: value => {
            written = value === null || value === undefined ? '' : String(value)
          },
        })
        // A locale value gets the codec's syntax, problems and suggestions while it is typed.
        const { highlightValue, completeValue } = shape.actions ?? {}
        const control = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          'input[type="text"], textarea',
        )
        const assist =
          shape.columnInfo?.[coord.column]?.role === 'variant' &&
          control !== null &&
          (highlightValue !== undefined || completeValue !== undefined)
            ? attachValueAssist(cell, control, {
                label: localizer.text('table.suggestions'),
                ...(highlightValue === undefined
                  ? {}
                  : {
                      highlight: (text: string, signal: AbortSignal) =>
                        answer<TableValueHighlight>(
                          highlightValue,
                          { column: coord.column, text },
                          signal,
                        ),
                    }),
                ...(completeValue === undefined
                  ? {}
                  : {
                      complete: async (text: string, offset: number, signal: AbortSignal) => {
                        const workspaceDocuments = await documents()
                        return answer<TableValueCompletion>(
                          completeValue,
                          {
                            row: coord.row,
                            column: coord.column,
                            text,
                            offset,
                            ...(workspaceDocuments === undefined ? {} : { workspaceDocuments }),
                          } as unknown as JsonValue,
                          signal,
                        )
                      },
                    }),
              })
            : undefined
        let finished = false
        let finishing = false
        const dispose = async () => {
          if (finished) return
          finished = true
          assist?.dispose()
          activeEdits.delete(dispose)
          openDrafts.delete(keep)
          cell.removeEventListener('keydown', onKey)
          delete cell.dataset['editing']
          await mount.unmount()
        }
        const finish = async (write: boolean) => {
          if (finished || finishing) return
          finishing = true
          try {
            if (write && drafting) {
              const typed = mount.read()
              if (typed === undefined) return // the field says why; stay open
              await dispose()
              const value = typed.value === null ? '' : String(typed.value)
              // The draft draws the page again; the cell keeps the focus it had.
              if (variants?.draft(coord.row, coord.column, value) === true) {
                drawnCell(coord)?.focus()
              } else {
                cell.replaceChildren(...previous)
              }
              return
            }
            const accepted = write ? await mount.commit() : false
            if (!accepted && write) return // the field explains the refusal; stay open
            await dispose()
            if (written === undefined) {
              cell.replaceChildren(...previous)
            } else {
              setViewerText(cell, written)
              variants?.written(coord.row, coord.column, written)
              await committed()
            }
          } catch (error) {
            setViewerText(knowledge, error instanceof Error ? error.message : String(error))
          } finally {
            finishing = false
          }
        }
        const keep = () => finish(true)
        const onKey = (event: KeyboardEvent) => {
          // Shift+Enter is the field's own line break, as in MK2's table, not a save
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void finish(true)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            void finish(false)
          }
          // ↑/↓ at the field's first or last line save it and go on to the cell above or below
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const step = event.key === 'ArrowDown' ? 1 : -1
          const control = event.target
          const atEdge =
            control instanceof HTMLTextAreaElement
              ? step > 0
                ? !control.value.slice(control.selectionEnd).includes('\n')
                : !control.value.slice(0, control.selectionStart).includes('\n')
              : control instanceof HTMLInputElement &&
                (control.type === 'text' || control.type === 'search')
          const next = atEdge ? besideCell(cell, step, 0) : undefined
          const nextRow = next?.parentElement?.dataset['row']
          if (next === undefined || nextRow === undefined) return
          event.preventDefault()
          const index = cell.cellIndex
          void finish(true).then(() => {
            if (!finished) return // refused: the field says why and stays open
            // a draft draws the page again, so the cell is found where it is drawn now
            const target = body.querySelector<HTMLTableRowElement>(`tr[data-row="${nextRow}"]`)
              ?.cells[index]
            if (target === undefined) return
            target.focus()
            void beginEdit(target, { row: Number(nextRow), column: coord.column }).catch(
              () => undefined,
            )
          })
        }
        if (scope.signal.aborted || !body.contains(cell)) {
          await dispose()
          return
        }
        activeEdits.add(dispose)
        if (drafting) openDrafts.add(keep)
        cell.addEventListener('keydown', onKey)
        cell.querySelector<HTMLElement>('input, textarea, select')?.focus()
      }

      const render = (rows: readonly Row[]): readonly HTMLTableRowElement[] => {
        cancelLookup('table-page-changed')
        clearEditTarget()
        showMissingKnowledge()
        for (const dispose of activeEdits) void dispose()
        body.replaceChildren()
        const drawn: HTMLTableRowElement[] = []
        for (const row of rows) {
          const tr = body.insertRow()
          drawn.push(tr)
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
            if (options.highlight ?? variantMode) {
              // Once per cell: the runs do not change until the value does, and a re-render replaces
              // the whole body anyway.
              const highlight = () => {
                if (
                  cell.dataset['highlighted'] === 'true' ||
                  cell.dataset['editing'] === 'true' ||
                  cell.dataset['rendered'] === 'true'
                ) {
                  return
                }
                cell.dataset['highlighted'] = 'true'
                void model
                  .cell(coord, scope.signal)
                  .then(facts => {
                    if (
                      scope.signal.aborted ||
                      !body.contains(cell) ||
                      facts.value !== value ||
                      facts.spans === undefined ||
                      cell.dataset['editing'] === 'true' ||
                      cell.dataset['rendered'] === 'true'
                    )
                      return
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
            const begin = () =>
              void beginEdit(cell, coord).catch(error => {
                delete cell.dataset['editing']
                setViewerText(knowledge, error instanceof Error ? error.message : String(error))
              })
            cell.addEventListener('dblclick', begin)
            const onKey = (event: KeyboardEvent) => {
              if (cell.dataset['editing'] === 'true') return
              if (event.key === 'Enter') {
                event.preventDefault()
                begin()
                return
              }
              // the arrows move between cells, as in a spreadsheet
              const step = CELL_STEPS[event.key]
              const next = step === undefined ? undefined : besideCell(cell, step[0], step[1])
              if (next === undefined) return
              event.preventDefault()
              next.focus()
            }
            cell.addEventListener('keydown', onKey)
            scope.cleanup(() => {
              cell.removeEventListener('dblclick', begin)
              cell.removeEventListener('keydown', onKey)
            })
          }
        }
        return drawn
      }
      if (variantMode) {
        variants = await mountVariantTable({
          root,
          source: model.source,
          shape,
          descriptor: args.descriptor,
          operations: args.operations,
          ...(args.commit === undefined ? {} : { commit: args.commit }),
          ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
          signal: scope.signal,
          ...(options.localizer === undefined ? {} : { localizer: options.localizer }),
          documents,
          ...(options.images === undefined ? {} : { images: options.images }),
          render,
          committed,
          writeRefusal: () => stale,
          before: table,
          flush: async () => {
            for (const keep of [...openDrafts]) await keep()
          },
        })
        return createViewerMount(root, scope, args, ({ descriptor }) => {
          cancelLookup('viewer-updated')
          clearEditTarget()
          root.dataset['revision'] = descriptor.revision
        })
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
        clearEditTarget()
        showMissingKnowledge()
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const tableViewer: ViewerModule = createTableViewer()

export default tableViewer
