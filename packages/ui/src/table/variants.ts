/**
 * A table whose value columns are variants of one another — a localization table is the case.
 *
 * Everything format-specific arrives as data: `columnInfo` says which column is the key, which are
 * variants (and which of those is the base), and `actions` names the operations for adding a row,
 * comparing a variant with the base and translating. This module only searches, filters and routes
 * requests; every write is an edit plan through `commitOperationWrite`.
 */
import type {
  AnyDescriptor,
  JsonValue,
  OperationSession,
  Row,
  TableActions,
  TableColumnInfo,
  TableDataSource,
  TableValueRendering,
  TableVariantComparison,
  CommitCoordinator,
  EditAuthorizationPort,
  ViewerWorkspaceDocument,
  ViewerWorkspaceDocuments,
} from '@modkit/sdk'
import { isGameTemplateTextRun, type GameTemplateTextRun } from '@modkit/sdk/templates'
import type { GameTemplateImageResolver } from '../template/index.js'
import { createToolbar } from '../toolbar/index.js'
import { element, invokeOperation, setPart, setViewerText } from '../viewer/index.js'
import { commitOperationWrite } from '../field-write/index.js'
import { invokeRefusalMessage } from '../field-editor/index.js'
import type { UiLocalizer } from '../localization/index.js'
import { TABLE_VARIANTS_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** Rows drawn per page of the filtered list. */
export const VARIANT_PAGE_ROWS = 200
/** Rows read per request while loading the whole table. */
const LOAD_PAGE_ROWS = 1000
/** Cells one translate click sends; the rest wait for the next click. */
export const TRANSLATE_BATCH = 50
/** Values one render request carries: a page of a dozen locales is a few requests, not one per cell. */
export const RENDER_BATCH = 400
/** A run's colour is drawn only in this form; anything else stays the default colour. */
const RUN_COLOR = /^#[0-9a-f]{6}$/iu

const FILTER_LABELS = {
  missing: 'table.filterMissing',
  untranslated: 'table.filterUntranslated',
  duplicate: 'table.filterDuplicate',
  changed: 'table.filterChanged',
} as const
const COMPARE_LABELS = {
  missing: 'table.filterMissing',
  untranslated: 'table.filterUntranslated',
  empty: 'table.compareEmpty',
  orphaned: 'table.compareOrphaned',
} as const

type Shape = Awaited<ReturnType<TableDataSource['shape']>>

export interface VariantTableArgs {
  readonly root: HTMLElement
  readonly source: TableDataSource
  readonly shape: Shape
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly commit?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
  readonly signal: AbortSignal
  readonly localizer?: UiLocalizer
  /** Draws rows with the table's own cells and inline editing. */
  readonly render: (rows: readonly Row[]) => readonly HTMLTableRowElement[]
  /** Called after any committed write; `true` means the host reopens the subject. */
  readonly committed: () => Promise<void>
  readonly writeRefusal?: () => string | undefined
  /** The rows' own element; the controls are placed above it. */
  readonly before: HTMLElement
  /** The documents around the subject, for the codec's render operation (its style sheet, say). */
  readonly workspaceDocuments?: ViewerWorkspaceDocuments
  /** Pixels for the inline images a rendered value names. */
  readonly images?: GameTemplateImageResolver
}

export interface VariantTable {
  /** A cell write the table committed, so filters and status follow it. */
  written(row: number, column: number, value: string): void
}

/**
 * One value as runs. Text goes in through `textContent` and a colour only as `#rrggbb`; an image is
 * a named slot the host's pixels replace later, and an unresolved run is marked with why.
 */
function drawRuns(cell: HTMLTableCellElement, runs: readonly GameTemplateTextRun[]): void {
  const document = cell.ownerDocument
  cell.dataset['rendered'] = 'true'
  cell.replaceChildren()
  for (const run of runs) {
    if (run.asset !== undefined) {
      const slot = document.createElement('span')
      setPart(slot, 'table.asset')
      slot.dataset['asset'] = run.asset
      slot.title = run.asset
      setViewerText(slot, run.asset.split(/[\\/]/u).pop() ?? run.asset)
      cell.append(slot)
      continue
    }
    run.text.split('\n').forEach((line, index) => {
      if (index > 0) cell.append(document.createElement('br'))
      if (line === '') return
      const span = document.createElement('span')
      setViewerText(span, line)
      if (run.color !== undefined && RUN_COLOR.test(run.color)) span.style.color = run.color
      if (run.bold === true) span.style.fontWeight = 'bold'
      if (run.italic === true) span.style.fontStyle = 'italic'
      if (run.underline === true) span.style.textDecoration = 'underline'
      // A style sheet's glyph height, relative to a 16-unit body and kept readable in a row.
      if (run.size !== undefined) {
        span.style.fontSize = `${Math.min(2, Math.max(0.75, run.size / 16))}em`
      }
      if (run.unresolved !== undefined) {
        setPart(span, 'table.unresolved')
        span.title = run.unresolved
      }
      cell.append(span)
    })
  }
}

/** Filter state kept across a reopen of the same subject. */
interface FilterState {
  search: string
  group: string
  statuses: string[]
  /** Headers of the columns the reader hid; a dozen locales do not fit side by side. */
  hidden: string[]
  /** Values drawn as the game shows them rather than as stored. */
  render: boolean
}
const remembered = new Map<string, FilterState>()

export async function mountVariantTable(args: VariantTableArgs): Promise<VariantTable> {
  const text = withEnglishUiFallback(args.localizer, TABLE_VARIANTS_FALLBACK_MESSAGES).text
  const info: readonly TableColumnInfo[] = args.shape.columnInfo ?? []
  const actions: TableActions = args.shape.actions ?? {}
  const header = args.shape.header ?? []
  const keyColumn = Math.max(
    0,
    info.findIndex(column => column.role === 'key'),
  )
  const statusColumn = info.findIndex(column => column.role === 'status')
  const variants = info.flatMap((column, index) =>
    column.role === 'variant' && column.variant !== undefined ? [{ ...column, index }] : [],
  )
  const base = variants.find(column => column.base === true) ?? variants[0]
  const separator = args.shape.keySeparator

  // The whole table, once: search and filters work on every row, not on the page on screen.
  const rows: Row[] = []
  for (let from = 0; ; from += LOAD_PAGE_ROWS) {
    const page = await args.source.rows({ kind: 'range', from, count: LOAD_PAGE_ROWS }, args.signal)
    rows.push(...page.items.map(row => ({ index: row.index, cells: [...row.cells] })))
    if (page.nextCursor === undefined || page.items.length === 0) break
  }
  const changed = new Set<number>()
  const selected = new Set<number>()
  const statusOf = (row: Row): readonly string[] => [
    ...(statusColumn < 0 ? [] : (row.cells[statusColumn] ?? '').split(' ').filter(Boolean)),
    ...(changed.has(row.index) ? ['changed'] : []),
  ]
  const state: FilterState = remembered.get(args.descriptor.subjectUri) ?? {
    search: '',
    group: '',
    statuses: [],
    hidden: [],
    render: false,
  }
  remembered.set(args.descriptor.subjectUri, state)

  const bar = element(args.root, 'div', { part: 'table.controls' })
  const status = element(args.root, 'output', { part: 'viewer.status' })
  status.setAttribute('role', 'status')
  const say = (message: string): void => setViewerText(status, message, 1024)
  const panel = element(args.root, 'section', { part: 'table.panel' })
  panel.hidden = true
  args.before.before(bar, status, panel)
  const statuses = ['missing', 'untranslated', 'duplicate', 'changed'] as const
  const toolbar = createToolbar(bar, {
    label: text('table.filters'),
    items: [
      {
        kind: 'search',
        id: 'search',
        label: text('table.search'),
        placeholder: text('table.search'),
        value: state.search,
        onInput: value => {
          state.search = value
          refresh()
        },
      },
      ...statuses.map(id => ({
        kind: 'chip' as const,
        id,
        label: text(FILTER_LABELS[id]),
        active: state.statuses.includes(id),
        onToggle: (active: boolean) => {
          state.statuses = active
            ? [...state.statuses, id]
            : state.statuses.filter(item => item !== id)
          toolbar.setActive(id, active)
          refresh()
        },
      })),
      { kind: 'separator' },
      ...(actions.renderValues === undefined
        ? []
        : [
            {
              kind: 'toggle' as const,
              id: 'render',
              label: text('table.render'),
              active: state.render,
              onToggle: (active: boolean) => {
                state.render = active
                toolbar.setActive('render', active)
                draw()
              },
            },
          ]),
      ...(actions.addRow === undefined || base === undefined
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'add',
              label: text('table.addKey'),
              onActivate: () => showAdd(),
            },
          ]),
      ...(actions.compareVariants === undefined || variants.length < 2
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'compare',
              label: text('table.compare'),
              onActivate: () => void compare(),
            },
          ]),
      ...(actions.translateVariant === undefined || variants.length < 2
        ? []
        : [
            {
              kind: 'action' as const,
              id: 'translate',
              label: text('table.translate'),
              disabled: true,
              onActivate: () => void translate(),
            },
          ]),
    ],
  })

  // Key groups from the key path, so one area can be worked through at a time.
  const group = element(bar, 'select', { part: 'table.group' }) as HTMLSelectElement
  group.setAttribute('aria-label', text('table.group'))
  const counts = new Map<string, number>()
  if (separator !== undefined) {
    for (const row of rows) {
      const parts = (row.cells[keyColumn] ?? '').split(separator)
      for (let depth = 1; depth < Math.min(parts.length, 3); depth += 1) {
        const prefix = parts.slice(0, depth).join(separator) + separator
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
      }
    }
  }
  const option = (value: string, label: string) => {
    const node = group.ownerDocument.createElement('option')
    node.value = value
    node.textContent = label
    group.append(node)
  }
  option('', text('table.groupAll'))
  for (const [prefix, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    option(prefix, `${prefix} (${count})`)
  }
  group.value = state.group
  group.hidden = counts.size === 0
  group.addEventListener('change', () => {
    state.group = group.value
    refresh()
  })

  const target = element(bar, 'select', { part: 'table.group' }) as HTMLSelectElement
  target.setAttribute('aria-label', text('table.translateTarget'))
  for (const column of variants.filter(column => column !== base)) {
    const node = target.ownerDocument.createElement('option')
    node.value = String(column.index)
    node.textContent = column.variant ?? header[column.index] ?? ''
    target.append(node)
  }
  target.hidden = actions.translateVariant === undefined || variants.length < 2

  // Every column but the key can be hidden; the choice follows the subject across reopens.
  const columns = element(bar, 'details', { part: 'table.columns' })
  element(columns, 'summary', { text: text('table.columns') })
  const choices = element(columns, 'div', {})
  const isHidden = (column: number): boolean => state.hidden.includes(header[column] ?? '')
  const showColumns = (): void => {
    const head = (args.before as HTMLTableElement).tHead?.rows[0]
    // Each drawn row and the head start with the selection cell, so column c sits at c + 1.
    for (const tr of [...(head === undefined ? [] : [head]), ...drawnRows]) {
      header.forEach((_, column) => {
        const cell = tr.cells[column + 1]
        if (cell !== undefined) cell.hidden = isHidden(column)
      })
    }
  }
  header.forEach((label, column) => {
    if (column === keyColumn) return
    const line = element(choices, 'label', {})
    const box = element(line, 'input', {}) as HTMLInputElement
    box.type = 'checkbox'
    box.checked = !isHidden(column)
    line.append(line.ownerDocument.createTextNode(` ${label}`))
    box.addEventListener('change', () => {
      state.hidden = box.checked
        ? state.hidden.filter(item => item !== label)
        : [...state.hidden, label]
      showColumns()
    })
  })
  columns.hidden = header.length < 3

  const more = element(args.root, 'button', {
    part: 'table.next',
    text: text('table.more'),
  }) as HTMLButtonElement
  more.type = 'button'
  let visible: Row[] = []
  let shown = 0
  let keyFilter: ReadonlySet<string> | undefined
  let drawnRows: readonly HTMLTableRowElement[] = []

  const matches = (row: Row): boolean => {
    const key = row.cells[keyColumn] ?? ''
    if (keyFilter !== undefined && !keyFilter.has(key)) return false
    if (state.group !== '' && !key.startsWith(state.group)) return false
    const flags = statusOf(row)
    if (state.statuses.length > 0 && !state.statuses.some(item => flags.includes(item)))
      return false
    const needle = state.search.toLocaleLowerCase()
    return needle === '' || row.cells.some(cell => cell.toLocaleLowerCase().includes(needle))
  }

  const draw = (): void => {
    const page = visible.slice(0, shown)
    const drawn = args.render(page)
    drawn.forEach((tr, position) => {
      const row = page[position]
      if (row === undefined) return
      const cell = tr.insertCell(0)
      setPart(cell, 'table.select')
      const box = cell.ownerDocument.createElement('input')
      box.type = 'checkbox'
      box.checked = selected.has(row.index)
      box.setAttribute('aria-label', text('table.selectRow', { key: row.cells[keyColumn] ?? '' }))
      box.addEventListener('change', () => {
        if (box.checked) selected.add(row.index)
        else selected.delete(row.index)
      })
      cell.append(box)
    })
    drawnRows = drawn
    showColumns()
    more.hidden = shown >= visible.length
    say(text('table.shown', { shown: Math.min(shown, visible.length), total: rows.length }))
    void renderPage(drawn, page).catch(error => {
      if (!args.signal.aborted) {
        say(text('table.renderRefused', { reason: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  let renderPass = 0
  let surroundings: Promise<readonly ViewerWorkspaceDocument[] | undefined> | undefined
  /** The page's values as the game shows them, asked for in batches; a newer draw drops the answer. */
  const renderPage = async (
    drawn: readonly HTMLTableRowElement[],
    page: readonly Row[],
  ): Promise<void> => {
    const pass = ++renderPass
    if (!state.render || actions.renderValues === undefined) return
    const cells: { cell: HTMLTableCellElement; column: number; text: string }[] = []
    drawn.forEach((tr, position) => {
      const row = page[position]
      if (row === undefined) return
      for (const column of variants) {
        const value = row.cells[column.index] ?? ''
        // Each drawn row starts with the selection cell, so column c sits at c + 1.
        const cell = tr.cells[column.index + 1]
        if (value !== '' && cell !== undefined) cells.push({ cell, column: column.index, text: value })
      }
    })
    surroundings ??=
      args.workspaceDocuments === undefined
        ? Promise.resolve(undefined)
        : args.workspaceDocuments.read({ signal: args.signal }).then(
            answer => answer.documents,
            () => undefined,
          )
    const workspaceDocuments = await surroundings
    for (let from = 0; from < cells.length; from += RENDER_BATCH) {
      const batch = cells.slice(from, from + RENDER_BATCH)
      const result = await invokeOperation(
        args.descriptor,
        args.operations,
        actions.renderValues,
        {
          items: batch.map(({ column, text }) => ({ column, text })),
          ...(workspaceDocuments === undefined ? {} : { workspaceDocuments }),
        } as unknown as JsonValue,
        { signal: args.signal },
      )
      if (pass !== renderPass || args.signal.aborted) return
      if (result.state !== 'ok' || result.output.kind !== 'json') {
        const reason = result.state === 'ok' ? result.output.kind : invokeRefusalMessage(result)
        say(text('table.renderRefused', { reason }))
        return
      }
      const answer = result.output.value as unknown as Partial<TableValueRendering>
      const assets = new Set<string>()
      batch.forEach((item, index) => {
        const runs = answer.items?.[index]?.runs
        if (!Array.isArray(runs) || item.cell.dataset['editing'] === 'true') return
        const valid = runs.filter(isGameTemplateTextRun)
        drawRuns(item.cell, valid)
        for (const run of valid) if (run.asset !== undefined) assets.add(run.asset)
      })
      if (assets.size === 0 || args.images === undefined) continue
      const pixels = await args.images(args.descriptor, [...assets], args.signal)
      if (pass !== renderPass || args.signal.aborted) return
      for (const { cell } of batch) {
        for (const slot of cell.querySelectorAll<HTMLElement>('[data-asset]')) {
          const url = pixels.get(slot.dataset['asset'] ?? '')
          if (url === undefined) continue
          const image = slot.ownerDocument.createElement('img')
          image.src = url
          image.alt = slot.title
          image.title = slot.title
          image.style.height = '1.2em'
          image.style.verticalAlign = 'text-bottom'
          slot.replaceWith(image)
        }
      }
    }
  }

  const refresh = (): void => {
    visible = rows.filter(matches)
    shown = VARIANT_PAGE_ROWS
    for (const id of statuses) {
      toolbar.setCount(id, rows.filter(row => statusOf(row).includes(id)).length)
    }
    draw()
  }
  more.addEventListener('click', () => {
    shown += VARIANT_PAGE_ROWS
    draw()
  })

  const route = {
    descriptor: args.descriptor,
    operations: args.operations,
    ...(args.commit === undefined ? {} : { commit: args.commit }),
    ...(args.authorization === undefined ? {} : { authorization: args.authorization }),
  }
  let writing = false
  const write = async (operation: string, input: JsonValue): Promise<boolean> => {
    if (writing || args.signal.aborted) return false
    const stale = args.writeRefusal?.()
    if (stale !== undefined) {
      say(text('table.refused', { reason: stale }))
      return false
    }
    writing = true
    try {
      say(text('table.working'))
      const refusal = await commitOperationWrite(route, operation, input, args.signal)
      if (refusal !== undefined) {
        say(text('table.refused', { reason: refusal }))
        return false
      }
      say(text('table.saved'))
      await args.committed()
      return true
    } catch (error) {
      say(text('table.refused', { reason: error instanceof Error ? error.message : String(error) }))
      return false
    } finally {
      writing = false
    }
  }

  const showAdd = (): void => {
    if (actions.addRow === undefined || base === undefined) return
    panel.hidden = false
    panel.replaceChildren()
    const form = element(panel, 'form', { part: 'table.add' }) as HTMLFormElement
    const key = element(form, 'input', { part: 'toolbar.search-input' }) as HTMLInputElement
    key.placeholder = text('table.addKeyName')
    key.setAttribute('aria-label', text('table.addKeyName'))
    key.required = true
    const value = element(form, 'input', { part: 'toolbar.search-input' }) as HTMLInputElement
    const valueLabel = text('table.addKeyValue', { variant: base.variant ?? '' })
    value.placeholder = valueLabel
    value.setAttribute('aria-label', valueLabel)
    const submit = element(form, 'button', {
      part: 'toolbar.action',
      text: text('table.addKeySubmit'),
    })
    ;(submit as HTMLButtonElement).type = 'submit'
    form.addEventListener('submit', event => {
      event.preventDefault()
      const name = key.value.trim()
      if (name === '') return
      if (rows.some(row => row.cells[keyColumn] === name)) {
        say(text('table.refused', { reason: text('table.keyExists', { key: name }) }))
        return
      }
      const request = { action: 'add', key: name, value: value.value, variant: base.variant ?? '' }
      void write(actions.addRow as string, request).then(done => {
        if (!done) return
        const cells = header.map((_, index) =>
          index === keyColumn ? name : index === base.index ? value.value : '',
        )
        if (statusColumn >= 0) cells[statusColumn] = variants.length > 1 ? 'missing' : ''
        const row = { index: rows.length, cells }
        rows.push(row)
        changed.add(row.index)
        panel.hidden = true
        refresh()
      })
    })
    key.focus()
  }

  const compare = async (): Promise<void> => {
    if (actions.compareVariants === undefined || base === undefined) return
    panel.hidden = false
    panel.replaceChildren()
    for (const column of variants.filter(item => item !== base)) {
      const result = await invokeOperation(
        args.descriptor,
        args.operations,
        actions.compareVariants,
        { variant: column.variant ?? '' },
        { signal: args.signal },
      )
      const line = element(panel, 'p', { part: 'table.compare' })
      if (result.state !== 'ok' || result.output.kind !== 'json') {
        const reason = result.state === 'ok' ? result.output.kind : invokeRefusalMessage(result)
        setViewerText(line, text('table.refused', { reason }), 1024)
        continue
      }
      const value = result.output.value as unknown as TableVariantComparison
      setViewerText(
        line,
        text('table.compareLine', {
          variant: column.variant ?? '',
          base: base.variant ?? '',
          translated: value.translated,
          total: value.total,
          missing: value.missing.length,
          identical: value.identical.length,
          empty: value.empty.length,
          orphaned: value.orphaned.length,
        }),
        1024,
      )
      for (const [name, keys] of [
        ['missing', value.missing],
        ['untranslated', value.identical],
        ['empty', value.empty],
        ['orphaned', value.orphaned],
      ] as const) {
        if (keys.length === 0) continue
        const show = element(line, 'button', {
          part: 'toolbar.chip',
          text: `${text(COMPARE_LABELS[name])} ${keys.length}`,
        })
        ;(show as HTMLButtonElement).type = 'button'
        show.addEventListener('click', () => {
          keyFilter = new Set(keys)
          refresh()
        })
      }
    }
    const clear = element(panel, 'button', { part: 'toolbar.action', text: text('table.showAll') })
    ;(clear as HTMLButtonElement).type = 'button'
    clear.addEventListener('click', () => {
      keyFilter = undefined
      refresh()
    })
  }

  // Translation is offered only once the codec says a service can answer; otherwise say why.
  if (actions.translateVariant !== undefined && variants.length > 1) {
    const probe = await invokeOperation(
      args.descriptor,
      args.operations,
      actions.translateVariant,
      { probe: true },
      { signal: args.signal },
    )
    const answer =
      probe.state === 'ok' && probe.output.kind === 'json'
        ? (probe.output.value as { available?: boolean; reason?: string })
        : undefined
    const reason =
      probe.state !== 'ok'
        ? invokeRefusalMessage(probe)
        : answer?.available === true
          ? undefined
          : (answer?.reason ?? 'unavailable')
    toolbar.setDisabled('translate', reason !== undefined)
    if (reason !== undefined) {
      const message = text('table.translateUnavailable', { reason })
      const button = [...toolbar.root.querySelectorAll('button')].find(
        node => node.getAttribute('aria-label') === text('table.translate'),
      )
      if (button !== undefined) button.title = message
      const note = element(bar, 'small', { part: 'table.note' })
      note.dataset['translate'] = 'unavailable'
      setViewerText(note, message, 1024)
    }
  }

  let translating = false
  const translate = async (): Promise<void> => {
    if (translating || args.signal.aborted) return
    if (actions.translateVariant === undefined || base === undefined) return
    const column = variants.find(item => String(item.index) === target.value)
    if (column === undefined) return
    const chosen = visible.filter(row => selected.size === 0 || selected.has(row.index))
    const empty = chosen.filter(
      row => (row.cells[column.index] ?? '') === '' && (row.cells[base.index] ?? '') !== '',
    )
    panel.hidden = false
    panel.replaceChildren()
    if (empty.length === 0) {
      setViewerText(
        element(panel, 'p', {}),
        text('table.translateNothing', { variant: column.variant ?? '' }),
      )
      return
    }
    translating = true
    toolbar.setDisabled('translate', true)
    try {
      const ready: { key: string; value: string }[] = []
      say(text('table.working'))
      for (const row of empty.slice(0, TRANSLATE_BATCH)) {
        if (args.signal.aborted) return
        const key = row.cells[keyColumn] ?? ''
        const result = await invokeOperation(
          args.descriptor,
          args.operations,
          actions.translateVariant,
          {
            key,
            sourceVariant: base.variant ?? '',
            targetVariant: column.variant ?? '',
            sourceLanguage: base.language ?? base.variant ?? '',
            targetLanguage: column.language ?? column.variant ?? '',
          },
          { signal: args.signal },
        )
        const value =
          result.state === 'ok' && result.output.kind === 'json'
            ? (result.output.value as { translated?: string; refused?: string; changed?: boolean })
            : undefined
        const refused = result.state !== 'ok' ? invokeRefusalMessage(result) : value?.refused
        const line = element(panel, 'p', { part: 'table.compare' })
        if (refused !== undefined || typeof value?.translated !== 'string') {
          setViewerText(
            line,
            text('table.translateRefused', { key, reason: refused ?? 'no answer' }),
            1024,
          )
          continue
        }
        setViewerText(line, `${key} → ${value.translated}`, 1024)
        if (value.changed !== false) ready.push({ key, value: value.translated })
      }
      say(text('table.translateReady', { count: ready.length, variant: column.variant ?? '' }))
      if (ready.length === 0 || actions.addRow === undefined) return
      // A human accepts the batch; one plan writes the whole batch into one locale file.
      const apply = element(panel, 'button', {
        part: 'toolbar.action',
        text: text('table.translateApply'),
      })
      ;(apply as HTMLButtonElement).type = 'button'
      apply.addEventListener('click', () => {
        void write(actions.addRow as string, {
          action: 'set-many',
          variant: column.variant ?? '',
          entries: ready,
        }).then(done => {
          if (!done) return
          for (const entry of ready) {
            const row = rows.find(item => item.cells[keyColumn] === entry.key)
            if (row === undefined) continue
            ;(row.cells as string[])[column.index] = entry.value
            changed.add(row.index)
          }
          panel.hidden = true
          refresh()
        })
      })
    } catch (error) {
      say(text('table.refused', { reason: error instanceof Error ? error.message : String(error) }))
    } finally {
      translating = false
      if (!args.signal.aborted) toolbar.setDisabled('translate', false)
    }
  }

  refresh()
  return {
    written(row, column, value) {
      const entry = rows.find(item => item.index === row)
      if (entry === undefined) return
      ;(entry.cells as string[])[column] = value
      changed.add(row)
      refresh()
    },
  }
}
