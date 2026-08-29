import type {
  CellCoord,
  KnowledgeHit,
  Page,
  Row,
  TableDataSource,
  ViewerModule,
} from '@modkitx-x3/sdk'
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

export const TABLE_PAGE_ROWS = 200
export const TABLE_KNOWLEDGE_SUMMARY_CHARACTERS = 512
export const TABLE_KNOWLEDGE_SOURCE_TITLE_CHARACTERS = 160
export const TABLE_KNOWLEDGE_MISSING = 'Description is not available yet.'
const TABLE_KNOWLEDGE_LOADING = 'Loading description…'

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

export const tableViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Table viewer')
    const lease = await unknownSourceLease(args.sources, args.slot, 'common.view/table-data-source')
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
    setViewerText(caption, `${shape.rows} rows, ${shape.columns} columns`)
    const body = table.createTBody()
    setPart(body, 'table.body')
    const knowledge = element(root, 'aside', {
      className: 'modkit-viewer__table-knowledge',
      part: 'viewer.status',
      role: 'status',
      text: TABLE_KNOWLEDGE_MISSING,
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
      setViewerText(knowledge, TABLE_KNOWLEDGE_MISSING)
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
      setViewerText(knowledge, TABLE_KNOWLEDGE_LOADING)
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
          const inspect = () => inspectCell({ row: row.index, column })
          cell.addEventListener('focus', inspect)
          cell.addEventListener('mouseenter', inspect)
        }
      }
    }
    const first = await model.first(0, scope.signal)
    render(first.items)
    const next = element(root, 'button', {
      text: 'Next rows',
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

export default tableViewer
