import type { Page, Row, TableDataSource, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export const TABLE_PAGE_ROWS = 200

export class LazyTableModel {
  #cursor: string | undefined
  constructor(readonly source: TableDataSource) {}

  shape() {
    return this.source.shape()
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
    const table = element(root, 'table', { className: 'modkit-viewer__table' }) as HTMLTableElement
    const caption = table.createCaption()
    const shape = await model.shape()
    setViewerText(caption, `${shape.rows} rows, ${shape.columns} columns`)
    const body = table.createTBody()
    const render = (rows: readonly Row[]) => {
      body.replaceChildren()
      for (const row of rows) {
        const tr = body.insertRow()
        tr.dataset['row'] = String(row.index)
        for (const value of row.cells) setViewerText(tr.insertCell(), value)
      }
    }
    const first = await model.first(0, scope.signal)
    render(first.items)
    const next = element(root, 'button', { text: 'Next rows' }) as HTMLButtonElement
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
      root.dataset['revision'] = descriptor.revision
    })
  },
})

export default tableViewer
